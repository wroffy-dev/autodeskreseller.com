import 'server-only';
import type { Prisma, UrlChangeReason } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { listCountries } from '@/lib/country/registry';
import { listAccessibleCountries } from '@/lib/country/access';
import type { CountryContext } from '@/lib/country/types';
import type { SessionUser } from '@/lib/auth/guards';
import { recordAudit } from '@/lib/services/audit';
import { entityKey, patternScopeKey } from './snapshot';
import { checkPattern, checkRelativePath, fillPattern, joinMarket, pathKey, stripMarket } from './path';
import { listRegistrableContent, loadContentInfo, patternRelativePath, type ContentInfo } from './content';
import { bumpRegistryVersion, placeContent, withRegistry, type Tx } from './registry';
import { userCanEditType, loadPatterns } from './manager';
import { readImport } from './csv';
import {
  DEFAULT_PATTERNS,
  PATTERN_TYPES,
  SLUGLESS_TYPES,
  URL_TYPE_LABELS,
  type UrlContentType,
  type UrlRouteModeValue,
} from './types';

/**
 * Bulk URL changes: preview, validate, apply.
 *
 * Every bulk change — selected rows, a prefix replacement, a pattern change,
 * a CSV import — becomes a plan: one line per piece of content, each marked
 * as a change, unchanged, a conflict, invalid or excluded, with the reason.
 * Nothing is applied until the plan has been looked at.
 *
 * Applying re-checks every line under the registry lock and refuses any line
 * whose address has changed since the preview (each carries the route
 * version it was planned against), so a stale preview can never overwrite a
 * newer edit. Small plans apply in one transaction; large ones apply in
 * batches recorded on an operation that shows its progress and can be
 * resumed if it is interrupted.
 */

export type PlanStatus = 'change' | 'unchanged' | 'conflict' | 'invalid' | 'excluded' | 'duplicate';

export type PlanItem = {
  entityId: string;
  countryId: string;
  type: UrlContentType;
  label: string;
  from: string | null;
  to: string | null;
  mode: UrlRouteModeValue;
  expectedVersion: number | null;
  status: PlanStatus;
  reason: string | null;
  /** Whether the old address had been public, and so will redirect. */
  redirects: boolean;
};

export type Plan = {
  kind: 'selection' | 'prefix' | 'pattern' | 'csv';
  summary: string;
  items: PlanItem[];
  counts: Record<PlanStatus, number>;
  /** For a pattern change: what is saved when it is applied. */
  pattern?: { type: UrlContentType; countryId: string | null; value: string | null; expectedVersion: number | null };
};

/** Plans at or under this size apply in one transaction; bigger ones in batches. */
export const SINGLE_TRANSACTION_LIMIT = 50;
const CHUNK = 25;

type Target =
  | { entityId: string; countryId: string; type: UrlContentType; to: string; mode?: 'custom' }
  | { entityId: string; countryId: string; type: UrlContentType; to: '@pattern' };

function emptyCounts(): Record<PlanStatus, number> {
  return { change: 0, unchanged: 0, conflict: 0, invalid: 0, excluded: 0, duplicate: 0 };
}

async function access(user: SessionUser) {
  const [all, mine] = await Promise.all([
    listCountries(),
    listAccessibleCountries(user, { includeInactive: true }),
  ]);
  const root = all.find((country) => country.isDefault) ?? all[0]!;
  return { all, root, allowed: new Set(mine.map((country) => country.id)), everyMarket: mine.length >= all.length };
}

/**
 * Validates a set of intended addresses against the registry, and against
 * each other.
 */
async function validate(
  user: SessionUser,
  targets: readonly Target[],
  context: { all: readonly CountryContext[]; root: CountryContext; allowed: ReadonlySet<string> },
  patterns: Map<string, string>,
  patternOverride?: { type: UrlContentType; countryId: string | null; value: string },
): Promise<PlanItem[]> {
  const infos = await loadContentInfo(
    targets.map((target) => ({ type: target.type, entityId: target.entityId, countryId: target.countryId })),
    context.root.id,
  );
  const routes = await prisma.urlRoute.findMany({
    where: { kind: 'CONTENT', entityId: { in: [...new Set(targets.map((target) => target.entityId))] } },
    select: { entityId: true, countryId: true, path: true, pathKey: true, version: true, mode: true },
  });
  const routeOf = new Map(routes.map((route) => [entityKey(route.entityId ?? '', route.countryId), route]));
  const prefixes = context.all.map((country) => country.slug).filter(Boolean);

  const effectivePatterns = new Map(patterns);
  if (patternOverride) {
    effectivePatterns.set(patternScopeKey(patternOverride.type, patternOverride.countryId), patternOverride.value);
  }

  const seen = new Set<string>();
  const items: PlanItem[] = [];
  for (const target of targets) {
    const key = entityKey(target.entityId, target.countryId);
    const info = infos.get(key);
    const route = routeOf.get(key);
    const market = context.all.find((country) => country.id === target.countryId);
    const base = {
      entityId: target.entityId,
      countryId: target.countryId,
      type: info?.type ?? target.type,
      label: info?.label ?? target.entityId,
      from: route?.path ?? null,
      to: null,
      mode: 'PATTERN' as UrlRouteModeValue,
      expectedVersion: route?.version ?? null,
      redirects: Boolean(info?.wasPublished),
    };
    if (!info || !market) {
      items.push({ ...base, status: 'invalid', reason: 'No such content in that market.' });
      continue;
    }
    if (!context.allowed.has(target.countryId) || !userCanEditType(user, info.type)) {
      items.push({ ...base, status: 'excluded', reason: 'You cannot change addresses of this content in this market.' });
      continue;
    }
    if (seen.has(key)) {
      items.push({ ...base, status: 'duplicate', reason: 'This content appears more than once.' });
      continue;
    }
    seen.add(key);

    const patternRel = patternRelativePath(info, { patterns: effectivePatterns });
    let relative: string;
    let mode: UrlRouteModeValue;
    if (target.to === '@pattern') {
      relative = patternRel;
      mode = 'PATTERN';
    } else {
      const given = target.to.startsWith(`/${market.slug}/`) && market.slug
        ? stripMarket(market.slug, target.to)
        : target.to;
      const checked = checkRelativePath(given, { marketPrefixes: prefixes });
      if (!checked.ok) {
        items.push({ ...base, status: 'invalid', reason: checked.error });
        continue;
      }
      relative = checked.relative;
      mode = relative === patternRel ? 'PATTERN' : 'CUSTOM';
    }
    const to = joinMarket(market.slug, relative);
    if (route && route.path === to && route.mode === mode) {
      items.push({ ...base, to, mode, status: 'unchanged', reason: null });
      continue;
    }
    items.push({ ...base, to, mode, status: 'change', reason: null });
  }

  // Against each other: two items may not want one address.
  const wanted = new Map<string, PlanItem[]>();
  for (const item of items) {
    if (item.status !== 'change' || !item.to) continue;
    const key = pathKey(item.to)!;
    wanted.set(key, [...(wanted.get(key) ?? []), item]);
  }
  for (const group of wanted.values()) {
    if (group.length < 2) continue;
    for (const item of group) {
      item.status = 'conflict';
      item.reason = `${group.length} items in this change want ${item.to}.`;
    }
  }

  // Against the registry: the address must be free, this content's own, a
  // historical address of this content, or vacated in this same change by
  // content that was never public (a public address becomes a redirect).
  const moving = new Map(
    items
      .filter((item) => item.status === 'change' && item.from)
      .map((item) => [pathKey(item.from!)!, item]),
  );
  const keys = [...wanted.keys()];
  const claims = await prisma.urlRoute.findMany({
    where: { pathKey: { in: keys } },
    include: { redirect: { select: { origin: true, targetEntityId: true, targetCountryId: true, allMarkets: true, destination: true } } },
  });
  const claimOf = new Map(claims.map((claim) => [claim.pathKey, claim]));
  for (const item of items) {
    if (item.status !== 'change' || !item.to) continue;
    const key = pathKey(item.to)!;
    const claim = claimOf.get(key);
    if (!claim) continue;
    if (claim.kind === 'CONTENT') {
      if (claim.entityId === item.entityId && claim.countryId === item.countryId) continue;
      const leaving = moving.get(key);
      if (leaving && !leaving.redirects) continue;
      item.status = 'conflict';
      item.reason = leaving
        ? `${item.to} is being vacated by “${leaving.label}”, which has been public, so it will redirect there.`
        : `${item.to} is already the address of ${claim.type ? URL_TYPE_LABELS[claim.type as UrlContentType].toLowerCase() : 'other content'}.`;
      continue;
    }
    const rule = claim.redirect;
    if (rule?.origin === 'AUTOMATIC' && rule.targetEntityId === item.entityId && rule.targetCountryId === item.countryId) continue;
    if (rule?.allMarkets) continue;
    item.status = 'conflict';
    item.reason = `${item.to} is used by a redirect to ${rule?.destination ?? 'another address'}.`;
  }

  return items;
}

function finish(kind: Plan['kind'], summary: string, items: PlanItem[], pattern?: Plan['pattern']): Plan {
  const counts = emptyCounts();
  for (const item of items) counts[item.status] += 1;
  return { kind, summary, items, counts, ...(pattern ? { pattern } : {}) };
}

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

export type SelectionRef = { entityId: string; countryId: string; type: UrlContentType };

/** Selected rows back to their inherited pattern. */
export async function planReset(user: SessionUser, refs: readonly SelectionRef[]): Promise<Plan> {
  const context = await access(user);
  const patterns = await loadPatterns();
  const items = await validate(user, refs.map((ref) => ({ ...ref, to: '@pattern' as const })), context, patterns);
  return finish('selection', `Reset ${refs.length} address(es) to their pattern`, items);
}

/** Replace a leading path prefix on the selected rows: `/products` → `/software`, or → nothing. */
export async function planPrefix(
  user: SessionUser,
  refs: readonly SelectionRef[],
  from: string,
  to: string,
): Promise<Plan> {
  const context = await access(user);
  const patterns = await loadPatterns();
  const fromSegments = from.split('/').filter(Boolean);
  const toSegments = to.split('/').filter(Boolean);
  const routes = await prisma.urlRoute.findMany({
    where: { kind: 'CONTENT', entityId: { in: refs.map((ref) => ref.entityId) } },
    select: { entityId: true, countryId: true, path: true },
  });
  const pathOf = new Map(routes.map((route) => [entityKey(route.entityId ?? '', route.countryId), route.path]));

  const targets: Target[] = [];
  const skipped: PlanItem[] = [];
  for (const ref of refs) {
    const market = context.all.find((country) => country.id === ref.countryId);
    const current = pathOf.get(entityKey(ref.entityId, ref.countryId));
    if (!market || !current) {
      skipped.push({
        ...ref,
        label: ref.entityId,
        from: current ?? null,
        to: null,
        mode: 'CUSTOM',
        expectedVersion: null,
        status: 'invalid',
        reason: 'No current address to change.',
        redirects: false,
      });
      continue;
    }
    const relative = stripMarket(market.slug, current).split('/').filter(Boolean);
    const matches = fromSegments.every((segment, index) => relative[index]?.toLowerCase() === segment.toLowerCase());
    if (!matches) {
      targets.push({ ...ref, to: `/${relative.join('/')}` });
      continue;
    }
    const next = [...toSegments, ...relative.slice(fromSegments.length)];
    targets.push({ ...ref, to: `/${next.join('/')}` });
  }
  const items = await validate(user, targets, context, patterns);
  return finish('prefix', `Replace ${from || '/'} with ${to || '/'} on ${refs.length} address(es)`, [...items, ...skipped]);
}

/**
 * A pattern change: every address of that type, in every market the pattern
 * applies to, that follows the pattern moves; custom addresses are excluded
 * and listed.
 */
export async function planPattern(
  user: SessionUser,
  input: { type: UrlContentType; countryId: string | null; pattern: string | null },
): Promise<Plan | { error: string }> {
  const context = await access(user);
  if (!PATTERN_TYPES.includes(input.type)) return { error: 'That content type has no configurable pattern.' };
  // A pattern decides where every future piece of that content lives, so it
  // needs the same permission as editing that content.
  if (!userCanEditType(user, input.type)) {
    return { error: `You cannot change where ${URL_TYPE_LABELS[input.type].toLowerCase()} addresses live.` };
  }
  if (input.countryId ? !context.allowed.has(input.countryId) : !context.everyMarket) {
    return { error: input.countryId ? 'You cannot change patterns in that market.' : 'Only someone with access to every market can change a global pattern.' };
  }
  const prefixes = context.all.map((country) => country.slug).filter(Boolean);
  let value: string | null = null;
  if (input.pattern !== null) {
    const checked = checkPattern(input.pattern, { marketPrefixes: prefixes }, { needsSlug: !SLUGLESS_TYPES.has(input.type) });
    if (!checked.ok) return { error: checked.error };
    value = checked.pattern;
  }

  const patterns = await loadPatterns();
  const current = await prisma.urlPattern.findUnique({
    where: { scopeKey: patternScopeKey(input.type, input.countryId) },
    select: { version: true },
  });
  // Markets this pattern governs: the one market, or every market that has no
  // override of its own.
  const governed = context.all.filter((country) =>
    input.countryId ? country.id === input.countryId : !patterns.has(patternScopeKey(input.type, country.id)),
  );
  const content = await listRegistrableContent({ rootCountryId: context.root.id, types: [input.type] });
  const routes = await prisma.urlRoute.findMany({
    where: { kind: 'CONTENT', type: input.type },
    select: { entityId: true, countryId: true, mode: true },
  });
  const modeOf = new Map(routes.map((route) => [entityKey(route.entityId ?? '', route.countryId), route.mode]));

  const effective = value ?? (input.countryId ? patterns.get(patternScopeKey(input.type, null)) ?? DEFAULT_PATTERNS[input.type] : DEFAULT_PATTERNS[input.type]);
  const targets: Target[] = [];
  const excluded: PlanItem[] = [];
  for (const info of content) {
    if (!governed.some((country) => country.id === info.countryId)) continue;
    if (modeOf.get(entityKey(info.entityId, info.countryId)) === 'CUSTOM') {
      excluded.push({
        entityId: info.entityId,
        countryId: info.countryId,
        type: info.type,
        label: info.label,
        from: null,
        to: null,
        mode: 'CUSTOM',
        expectedVersion: null,
        status: 'excluded',
        reason: 'Has a custom address, which a pattern change never overrides.',
        redirects: false,
      });
      continue;
    }
    targets.push({ entityId: info.entityId, countryId: info.countryId, type: info.type, to: fillFor(effective, info) });
  }
  const items = await validate(user, targets, context, patterns, {
    type: input.type,
    countryId: input.countryId,
    value: effective,
  });
  const scope = input.countryId ? context.all.find((country) => country.id === input.countryId)?.name : 'every market';
  return finish(
    'pattern',
    `${URL_TYPE_LABELS[input.type]} pattern for ${scope}: ${value ?? '(inherit)'}`,
    [...items, ...excluded],
    { type: input.type, countryId: input.countryId, value, expectedVersion: current?.version ?? null },
  );
}

function fillFor(pattern: string, info: ContentInfo): string {
  return info.type === 'BLOG_ARCHIVE' ? pattern : fillPattern(pattern, info.slug);
}

/** A CSV import, validated row by row. */
export async function planCsv(user: SessionUser, text: string): Promise<Plan | { error: string }> {
  const parsed = readImport(text);
  if (!parsed.ok) return { error: parsed.error };
  const context = await access(user);
  const patterns = await loadPatterns();

  const targets: Target[] = [];
  const rejected: PlanItem[] = [];
  const routes = await prisma.urlRoute.findMany({
    where: { kind: 'CONTENT', entityId: { in: parsed.rows.map((row) => row.entityId).filter(Boolean) } },
    select: { entityId: true, countryId: true, type: true },
  });
  for (const row of parsed.rows) {
    const market = context.all.find((country) => country.code === row.country || country.id === row.country);
    const reject = (reason: string, status: PlanStatus = 'invalid') =>
      rejected.push({
        entityId: row.entityId || `line ${row.line}`,
        countryId: market?.id ?? row.country,
        type: 'PAGE',
        label: `Line ${row.line}`,
        from: null,
        to: row.target || null,
        mode: 'CUSTOM',
        expectedVersion: null,
        status,
        reason,
        redirects: false,
      });
    if (!row.entityId) {
      reject('Missing entity_id.');
      continue;
    }
    if (!market) {
      reject(`Unknown country “${row.country}”.`);
      continue;
    }
    if (!row.target) continue; // blank target: leave unchanged
    const route = routes.find((entry) => entry.entityId === row.entityId && entry.countryId === market.id);
    const type = (route?.type as UrlContentType | undefined) ?? (row.type as UrlContentType);
    if (!type || !(type in URL_TYPE_LABELS)) {
      reject('Unknown content: give the type column when the content has no address yet.');
      continue;
    }
    targets.push(
      row.target.toLowerCase() === '@pattern'
        ? { entityId: row.entityId, countryId: market.id, type, to: '@pattern' }
        : { entityId: row.entityId, countryId: market.id, type, to: row.target },
    );
  }
  const items = await validate(user, targets, context, patterns);
  return finish('csv', `CSV import: ${parsed.rows.length} row(s)`, [...items, ...rejected]);
}

// ---------------------------------------------------------------------------
// Applying
// ---------------------------------------------------------------------------

export type ItemResult = { key: string; ok: boolean; message: string; oldPath: string | null; newPath: string | null };

/** What the history calls a change made by each kind of plan. */
const REASON_OF: Record<Plan['kind'], UrlChangeReason> = {
  selection: 'BULK',
  prefix: 'BULK',
  pattern: 'PATTERN',
  csv: 'IMPORT',
};

async function applyItems(
  tx: Tx,
  user: SessionUser,
  items: readonly PlanItem[],
  batchId: string,
  countries: readonly CountryContext[],
  reason: UrlChangeReason,
): Promise<ItemResult[]> {
  const results: ItemResult[] = [];
  const root = countries.find((country) => country.isDefault) ?? countries[0]!;
  // Vacate before claim: items whose target is another item's current address
  // go after that item.
  const ordered = orderMoves(items);
  const infos = await loadContentInfo(ordered, root.id, tx);
  for (const item of ordered) {
    const key = entityKey(item.entityId, item.countryId);
    const market = countries.find((country) => country.id === item.countryId);
    const info = infos.get(key);
    if (!market || !info || !item.to) {
      results.push({ key, ok: false, message: 'No longer exists.', oldPath: item.from, newPath: null });
      continue;
    }
    const result = await placeContent(tx, {
      type: info.type,
      entityId: item.entityId,
      countryId: item.countryId,
      marketSlug: market.slug,
      relativePath: stripMarket(market.slug, item.to),
      mode: item.mode,
      label: info.label,
      wasPublished: info.wasPublished,
      reason,
      actor: user,
      batchId,
      expectedVersion: item.expectedVersion,
    });
    results.push(
      result.ok
        ? { key, ok: true, message: result.changed ? 'Moved.' : 'Unchanged.', oldPath: result.oldPath, newPath: result.newPath }
        : { key, ok: false, message: result.message, oldPath: item.from, newPath: null },
    );
  }
  return results;
}

function orderMoves(items: readonly PlanItem[]): PlanItem[] {
  const pending = [...items];
  const out: PlanItem[] = [];
  const leaving = new Set(pending.map((item) => (item.from ? pathKey(item.from) : null)).filter(Boolean));
  // Items whose target nobody is leaving can go first, then the rest.
  out.push(...pending.filter((item) => !leaving.has(pathKey(item.to ?? '') ?? '')));
  out.push(...pending.filter((item) => leaving.has(pathKey(item.to ?? '') ?? '')));
  return out;
}

export type OperationView = {
  id: string;
  kind: string;
  status: string;
  summary: string;
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  results: ItemResult[];
  createdAt: string;
};

function view(row: Prisma.UrlOperationGetPayload<object>): OperationView {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    summary: row.summary,
    total: row.total,
    processed: row.processed,
    succeeded: row.succeeded,
    failed: row.failed,
    results: ((row.results as unknown as ItemResult[] | null) ?? []).slice(-200),
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Starts applying a plan. The plan is re-derived by the caller from current
 * data just before this, so what is recorded is what was last shown.
 */
export async function startOperation(user: SessionUser, plan: Plan): Promise<OperationView> {
  const items = plan.items.filter((item) => item.status === 'change');
  // The pattern first: if it changed since the preview, nothing is started.
  if (plan.pattern) await savePattern(user, plan.pattern);
  const operation = await prisma.urlOperation.create({
    data: {
      kind: plan.kind,
      status: 'PENDING',
      summary: plan.summary,
      total: items.length,
      plan: { items, pattern: plan.pattern ?? null } as unknown as Prisma.InputJsonValue,
      results: [],
      actorId: user.id,
      actorEmail: user.email,
    },
  });

  await recordAudit({
    actor: user,
    action: 'urls.bulk.started',
    entity: 'UrlOperation',
    entityId: operation.id,
    summary: `${plan.summary} — ${items.length} change(s)`,
  });

  // Small enough to be one transaction: do it now.
  if (items.length <= SINGLE_TRANSACTION_LIMIT) return runOperation(user, operation.id, items.length || 1);
  return view(operation);
}

async function savePattern(user: SessionUser, pattern: NonNullable<Plan['pattern']>): Promise<void> {
  await withRegistry(async (tx) => {
    const scopeKey = patternScopeKey(pattern.type, pattern.countryId);
    const current = await tx.urlPattern.findUnique({ where: { scopeKey } });
    if ((current?.version ?? null) !== pattern.expectedVersion) {
      throw new Error('That pattern was changed by someone else since the preview. Review the new preview.');
    }
    if (pattern.value === null) {
      if (current) await tx.urlPattern.delete({ where: { scopeKey } });
    } else if (current) {
      await tx.urlPattern.update({
        where: { scopeKey },
        data: { pattern: pattern.value, version: { increment: 1 }, updatedById: user.id },
      });
    } else {
      await tx.urlPattern.create({
        data: { type: pattern.type, countryId: pattern.countryId, scopeKey, pattern: pattern.value, updatedById: user.id },
      });
    }
    await bumpRegistryVersion(tx);
  });
  await recordAudit({
    actor: user,
    action: 'urls.pattern',
    entity: 'UrlPattern',
    entityId: patternScopeKey(pattern.type, pattern.countryId),
    summary: `${URL_TYPE_LABELS[pattern.type]} pattern set to ${pattern.value ?? '(inherit)'}`,
  });
}

/**
 * Applies the next batch of an operation, and reports progress.
 *
 * The batch is read, applied and recorded in one transaction under the
 * registry lock: two people resuming the same operation at once take turns,
 * and the second continues from where the first stopped instead of applying
 * the same batch again. A batch that fails rolls back as a whole and is
 * recorded, so it can be retried.
 */
export async function runOperation(user: SessionUser, id: string, batch = CHUNK): Promise<OperationView> {
  const countries = await listCountries();
  let outcome: { row: Prisma.UrlOperationGetPayload<object>; finishedNow: boolean };
  try {
    outcome = await withRegistry(
      async (tx) => {
        const operation = await tx.urlOperation.findUnique({ where: { id } });
        if (!operation) throw new Error('That operation no longer exists.');
        if (operation.status === 'COMPLETED' || operation.status === 'PARTIAL' || operation.status === 'FAILED') {
          return { row: operation, finishedNow: false };
        }
        const items = (operation.plan as unknown as { items: PlanItem[] }).items ?? [];
        const next = items.slice(operation.processed, operation.processed + batch);
        if (next.length === 0) {
          const done = await tx.urlOperation.update({
            where: { id },
            data: { status: operation.failed > 0 ? 'PARTIAL' : 'COMPLETED', finishedAt: new Date() },
          });
          return { row: done, finishedNow: true };
        }

        const results = await applyItems(
          tx,
          user,
          next,
          operation.id,
          countries,
          REASON_OF[operation.kind as Plan['kind']] ?? 'BULK',
        );
        const processed = operation.processed + next.length;
        const succeeded = operation.succeeded + results.filter((result) => result.ok).length;
        const failedCount = operation.failed + results.filter((result) => !result.ok).length;
        const finished = processed >= items.length;
        const updated = await tx.urlOperation.update({
          where: { id },
          data: {
            processed,
            succeeded,
            failed: failedCount,
            status: finished ? (failedCount > 0 ? 'PARTIAL' : 'COMPLETED') : 'RUNNING',
            finishedAt: finished ? new Date() : null,
            results: [
              ...((operation.results as unknown as ItemResult[] | null) ?? []),
              ...results,
            ] as unknown as Prisma.InputJsonValue,
          },
        });
        return { row: updated, finishedNow: finished };
      },
      { timeoutMs: 60_000 },
    );
  } catch (error) {
    const operation = await prisma.urlOperation.findUnique({ where: { id } });
    if (!operation) throw error;
    // The batch rolled back as a whole; record why and let it be retried.
    const message = error instanceof Error ? error.message : 'The batch failed.';
    const failed = await prisma.urlOperation.update({
      where: { id },
      data: {
        status: 'RUNNING',
        results: [
          ...((operation.results as unknown as ItemResult[] | null) ?? []),
          { key: 'batch', ok: false, message: `Batch not applied: ${message}`, oldPath: null, newPath: null },
        ] as unknown as Prisma.InputJsonValue,
      },
    });
    return view(failed);
  }

  if (outcome.finishedNow) {
    await recordAudit({
      actor: user,
      action: 'urls.bulk.finished',
      entity: 'UrlOperation',
      entityId: id,
      summary: `${outcome.row.summary} — ${outcome.row.succeeded} applied, ${outcome.row.failed} not applied`,
    });
  }
  return view(outcome.row);
}

export async function listOperations(): Promise<OperationView[]> {
  // Address changes only: redirect imports are listed on the Redirects tab.
  const rows = await prisma.urlOperation.findMany({
    where: { kind: { not: 'redirect-import' } },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  return rows.map(view);
}

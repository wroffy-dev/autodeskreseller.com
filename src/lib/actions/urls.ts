'use server';

import { createHash } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { authorize, type SessionUser } from '@/lib/auth/guards';
import { recordAudit } from '@/lib/services/audit';
import { assertCountryAccess, listAccessibleCountries } from '@/lib/country/access';
import { invalidateCountryCache, listCountries } from '@/lib/country/registry';
import { success, failure, toActionError, type ActionResult } from '@/lib/utils/result';
import { refreshSeoScores } from '@/lib/seo/intelligence/refresh';
import { runUrlScan, type ScanReport } from '@/lib/urls/backfill';
import {
  checkContentPath,
  listUrls,
  loadInfo,
  loadManagerOverview,
  patternOverview,
  type ManagerOverview,
  type PatternOverview,
  previewReset,
  saveContentAddress,
  urlDetail,
  userCanEditType,
  type PathCheckResult,
  type SaveAddressResult,
  type UrlDetail,
  type UrlListResult,
} from '@/lib/urls/manager';
import {
  listOperations,
  planCsv,
  planPattern,
  planPrefix,
  planReset,
  runOperation,
  startOperation,
  type OperationView,
  type Plan,
  type SelectionRef,
} from '@/lib/urls/bulk';
import { applyReferences, findReferences, type AddressChange, type Reference } from '@/lib/urls/references';
import { listHistory, previewRestore, restoreFromHistory, type HistoryRow, type RestorePreview } from '@/lib/urls/history';
import {
  brokenInternalLinks,
  listNotFound,
  redirectProblems,
  type BrokenLink,
  type NotFoundRow,
  type RedirectProblem,
} from '@/lib/urls/health-report';
import {
  REDIRECT_IMPORT_KIND,
  getRedirectImport,
  importResultsCsv,
  listRedirectImports,
  planRedirectImport,
  runRedirectImport,
  startRedirectImport,
  type RedirectImportPlan,
  type RedirectImportView,
} from '@/lib/urls/redirect-import';
import {
  listRedirectRows,
  normaliseSource,
  saveRedirectRule,
  type RedirectRow,
} from '@/lib/urls/redirect-rules';
import { conflictReport, suggestAlternatives, type ConflictReport } from '@/lib/urls/conflicts';
import { joinMarket, pathKey } from '@/lib/urls/path';
import { revalidateAddresses } from '@/lib/urls/revalidate';
import { toCsv, CSV_COLUMNS } from '@/lib/urls/csv';
import { isLive } from '@/lib/urls/live';
import { DEFAULT_PATTERNS, URL_CONTENT_TYPES, type UrlContentType } from '@/lib/urls/types';
import { UrlRegistryError } from '@/lib/urls/errors';

/**
 * Server Actions behind the Slug & URL Manager.
 *
 * Every action checks, on the server: the SEO permission; for anything that
 * changes a piece of content's address, the permission to edit that kind of
 * content; and market access for every market it touches — including bulk
 * changes, where each row is checked on its own, and redirects, which belong
 * to the market their address lives in.
 */

const typeSchema = z.enum(URL_CONTENT_TYPES);
const refSchema = z.object({
  entityId: z.string().min(1).max(60),
  countryId: z.string().min(1).max(60),
  type: typeSchema,
});

async function everyMarket(user: SessionUser): Promise<boolean> {
  const [mine, all] = await Promise.all([
    listAccessibleCountries(user, { includeInactive: true }),
    listCountries(),
  ]);
  return mine.length >= all.length;
}

async function assertCanEdit(user: SessionUser, ref: { countryId: string; type: UrlContentType }) {
  await assertCountryAccess(user, ref.countryId);
  if (!userCanEditType(user, ref.type)) {
    throw new UrlRegistryError('You cannot change addresses of this content.', 'invalid', 'path');
  }
}

/**
 * Addresses are changed here only while the registry answers public requests.
 * Before that the previous router serves the site from slugs alone, and would
 * not follow a custom address, a pattern or a restore made in the registry.
 * Content saves keep the registry in step either way.
 */
async function assertRegistryOn() {
  const settings = await prisma.urlSettings.findUnique({ where: { id: 'singleton' }, select: { resolverEnabled: true } });
  if (!settings?.resolverEnabled) {
    throw new UrlRegistryError(
      'Switch the URL registry on first: until then the previous router serves the site and would not follow this change.',
      'invalid',
      'path',
    );
  }
}

function revalidateManager() {
  revalidatePath('/admin/slug-manager');
}

/** The manager's header figures, refreshed after a change without reloading the page. */
export async function overviewAction(): Promise<ActionResult<ManagerOverview>> {
  try {
    const user = await authorize('seo.manage');
    return success(await loadManagerOverview(user));
  } catch (error) {
    return toActionError(error);
  }
}

// ---------------------------------------------------------------------------
// All URLs
// ---------------------------------------------------------------------------

const listSchema = z.object({
  q: z.string().max(200).optional(),
  countryId: z.string().max(60).optional(),
  type: z.union([typeSchema, z.literal('')]).optional(),
  state: z.enum(['live', 'scheduled', 'draft', 'archived', 'hidden', '']).optional(),
  mode: z.enum(['PATTERN', 'CUSTOM', 'UNREGISTERED', '']).optional(),
  page: z.number().int().min(1).max(100_000).optional(),
  pageSize: z.number().int().min(10).max(100).optional(),
  sort: z.enum(['path', 'label', 'type']).optional(),
});

export async function listUrlsAction(input: unknown): Promise<ActionResult<UrlListResult>> {
  try {
    const user = await authorize('seo.manage');
    return success(await listUrls(user, listSchema.parse(input)));
  } catch (error) {
    return toActionError(error);
  }
}

export async function urlDetailAction(input: unknown): Promise<ActionResult<UrlDetail>> {
  try {
    const user = await authorize('seo.manage');
    const ref = refSchema.parse(input);
    const detail = await urlDetail(user, ref);
    return detail ? success(detail) : failure('That content is not available.');
  } catch (error) {
    return toActionError(error);
  }
}

export async function checkUrlPathAction(input: unknown): Promise<ActionResult<PathCheckResult>> {
  try {
    const user = await authorize('seo.manage');
    const { path, ...ref } = refSchema.extend({ path: z.string().max(400) }).parse(input);
    return success(await checkContentPath(user, ref, path));
  } catch (error) {
    return toActionError(error);
  }
}

export async function previewResetAction(input: unknown) {
  try {
    const user = await authorize('seo.manage');
    const ref = refSchema.parse(input);
    await assertCanEdit(user, ref);
    return success(await previewReset(user, ref));
  } catch (error) {
    return toActionError(error);
  }
}

const saveSchema = z.discriminatedUnion('kind', [
  refSchema.extend({ kind: z.literal('custom'), relativePath: z.string().max(400), expectedVersion: z.number().int().nullable() }),
  refSchema.extend({ kind: z.literal('reset'), expectedVersion: z.number().int().nullable() }),
  refSchema.extend({ kind: z.literal('slug'), slug: z.string().max(300), expectedVersion: z.number().int().nullable() }),
]);

/**
 * Changes one address. The route, the automatic redirect from the address it
 * leaves (when that had been public), the history row and — for a slug — the
 * content itself are saved in one transaction.
 */
export async function saveUrlAddressAction(input: unknown): Promise<ActionResult<SaveAddressResult>> {
  try {
    const user = await authorize('seo.manage');
    const parsed = saveSchema.parse(input);
    await assertCanEdit(user, parsed);
    await assertRegistryOn();
    const result = await saveContentAddress(parsed, user);

    await recordAudit({
      actor: user,
      action: `url.${parsed.kind}`,
      entity: 'UrlRoute',
      entityId: parsed.entityId,
      summary: result.changed
        ? `${result.oldPath ?? '(none)'} → ${result.newPath}`
        : `Address unchanged at ${result.newPath}`,
      before: { path: result.oldPath },
      after: { path: result.newPath, redirect: result.redirectId },
    });

    revalidateAddresses([result.oldPath, result.newPath, ...result.alsoMoved.flatMap((move) => [move.oldPath, move.newPath])]);
    revalidateManager();
    refreshSeoScores(
      parsed.type === 'PRODUCT'
        ? [{ type: 'PRODUCT_MARKET', id: parsed.entityId, countryId: parsed.countryId }]
        : parsed.type === 'BLOG_POST' || parsed.type === 'BLOG_CATEGORY' || parsed.type === 'BLOG_TAG'
          ? [{ type: parsed.type, id: parsed.entityId }]
          : parsed.type === 'BLOG_ARCHIVE'
            ? []
            : [{ type: 'PAGE', id: parsed.entityId, countryId: parsed.countryId }],
    );

    const message = !result.changed
      ? 'Nothing to change.'
      : result.redirectId
        ? `Saved. ${result.oldPath} now redirects permanently to ${result.newPath}.`
        : `Saved at ${result.newPath}.`;
    return success(result, message);
  } catch (error) {
    if (error instanceof UrlRegistryError) return failure(error.message, { path: [error.message] });
    return toActionError(error);
  }
}

// ---------------------------------------------------------------------------
// Stored links
// ---------------------------------------------------------------------------

const changesSchema = z
  .array(z.object({ oldPath: z.string().min(1).max(500), newPath: z.string().min(1).max(500), countryId: z.string().min(1).max(60) }))
  .min(1)
  .max(500);

export async function findReferencesAction(input: unknown): Promise<ActionResult<Reference[]>> {
  try {
    const user = await authorize('seo.manage');
    const changes = changesSchema.parse(input) as AddressChange[];
    for (const countryId of new Set(changes.map((change) => change.countryId))) {
      await assertCountryAccess(user, countryId);
    }
    return success(await findReferences(changes));
  } catch (error) {
    return toActionError(error);
  }
}

export async function applyReferencesAction(input: unknown) {
  try {
    const user = await authorize('seo.manage');
    const { changes, chosen } = z
      .object({
        changes: changesSchema,
        chosen: z.array(z.object({ id: z.string().min(1).max(200), fingerprint: z.string().min(1).max(64) })).min(1).max(2_000),
      })
      .parse(input);
    for (const countryId of new Set(changes.map((change) => change.countryId))) {
      await assertCountryAccess(user, countryId);
    }
    const outcome = await applyReferences(changes, chosen, user);
    revalidatePath('/', 'layout');
    revalidateManager();
    return success(
      outcome,
      outcome.skipped.length > 0
        ? `Updated ${outcome.updated}; ${outcome.skipped.length} skipped because they changed since the preview.`
        : `Updated ${outcome.updated} stored link(s).`,
    );
  } catch (error) {
    return toActionError(error);
  }
}

// ---------------------------------------------------------------------------
// Bulk changes, patterns and CSV
// ---------------------------------------------------------------------------

export async function patternsAction(): Promise<ActionResult<PatternOverview>> {
  try {
    const user = await authorize('seo.manage');
    return success(await patternOverview(user));
  } catch (error) {
    return toActionError(error);
  }
}

const planInput = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('reset'), refs: z.array(refSchema).min(1).max(2_000) }),
  z.object({
    kind: z.literal('prefix'),
    refs: z.array(refSchema).min(1).max(2_000),
    from: z.string().max(200),
    to: z.string().max(200),
  }),
  z.object({
    kind: z.literal('pattern'),
    type: typeSchema,
    countryId: z.string().max(60).nullable(),
    pattern: z.string().max(200).nullable(),
  }),
  z.object({ kind: z.literal('csv'), text: z.string().max(2_000_000) }),
]);

type PlanInput = z.infer<typeof planInput>;

async function buildPlan(user: SessionUser, input: PlanInput): Promise<Plan | { error: string }> {
  switch (input.kind) {
    case 'reset':
      return planReset(user, input.refs as SelectionRef[]);
    case 'prefix':
      return planPrefix(user, input.refs as SelectionRef[], input.from, input.to);
    case 'pattern':
      return planPattern(user, input);
    case 'csv':
      return planCsv(user, input.text);
  }
}

/** What a preview committed to, so an out-of-date one is never applied. */
function fingerprint(plan: Plan): string {
  const lines = plan.items
    .filter((item) => item.status === 'change')
    .map((item) => [item.entityId, item.countryId, item.to, item.expectedVersion].join('|'))
    .sort();
  return createHash('sha256')
    .update(JSON.stringify({ lines, pattern: plan.pattern ?? null }))
    .digest('hex')
    .slice(0, 24);
}

export async function previewPlanAction(
  input: unknown,
): Promise<ActionResult<{ plan: Plan; fingerprint: string }>> {
  try {
    const user = await authorize('seo.manage');
    const plan = await buildPlan(user, planInput.parse(input));
    if ('error' in plan) return failure(plan.error);
    return success({ plan, fingerprint: fingerprint(plan) });
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * Applies a previewed change. The plan is worked out again from current data
 * and must match the preview exactly; if anything moved in between, nothing
 * is applied and the new preview is returned instead.
 */
export async function applyPlanAction(
  input: unknown,
): Promise<ActionResult<{ operation: OperationView } | { stale: true; plan: Plan; fingerprint: string }>> {
  try {
    const user = await authorize('seo.manage');
    const { plan: raw, fingerprint: expected } = z
      .object({ plan: planInput, fingerprint: z.string().min(1).max(64) })
      .parse(input);
    await assertRegistryOn();
    const plan = await buildPlan(user, raw);
    if ('error' in plan) return failure(plan.error);
    const current = fingerprint(plan);
    if (current !== expected) {
      return success(
        { stale: true as const, plan, fingerprint: current },
        'The addresses changed since the preview. Review the updated preview before applying.',
      );
    }
    const operation = await startOperation(user, plan);
    revalidateManager();
    if (plan.pattern) revalidatePath('/', 'layout');
    return success({ operation }, operation.status === 'COMPLETED' ? 'Applied.' : 'Started.');
  } catch (error) {
    return toActionError(error);
  }
}

export async function runOperationAction(input: unknown): Promise<ActionResult<OperationView>> {
  try {
    const user = await authorize('seo.manage');
    const id = z.string().min(1).max(60).parse(input);
    const operation = await prisma.urlOperation.findUnique({ where: { id }, select: { actorId: true, kind: true } });
    if (!operation) return failure('That operation no longer exists.');
    if (operation.kind === REDIRECT_IMPORT_KIND) {
      return failure('Resume a redirect import from Redirects → Import CSV.');
    }
    await assertRegistryOn();
    const result = await runOperation(user, id);
    if (result.status === 'COMPLETED' || result.status === 'PARTIAL') {
      revalidatePath('/', 'layout');
      revalidateManager();
    }
    return success(result);
  } catch (error) {
    return toActionError(error);
  }
}

export async function listOperationsAction(): Promise<ActionResult<OperationView[]>> {
  try {
    await authorize('seo.manage');
    return success(await listOperations());
  } catch (error) {
    return toActionError(error);
  }
}

/** Every URL the user can see, as a CSV to edit and import back. */
export async function exportUrlsCsvAction(input: unknown): Promise<ActionResult<{ csv: string; filename: string }>> {
  try {
    const user = await authorize('seo.manage');
    const query = listSchema.parse(input);
    const result = await listUrls(user, { ...query, page: 1, pageSize: 100 });
    const rows = [...result.rows];
    for (let page = 2; page <= result.pages && rows.length < 20_000; page += 1) {
      rows.push(...(await listUrls(user, { ...query, page, pageSize: 100 })).rows);
    }
    const table = [
      [...CSV_COLUMNS],
      ...rows.map((row) => [
        row.entityId,
        row.countryCode,
        row.type,
        row.label,
        row.state,
        row.mode ?? 'UNREGISTERED',
        row.path ?? '',
        row.patternPath,
        '',
      ]),
    ];
    return success({ csv: toCsv(table), filename: `urls-${new Date().toISOString().slice(0, 10)}.csv` });
  } catch (error) {
    return toActionError(error);
  }
}

// ---------------------------------------------------------------------------
// Redirects
// ---------------------------------------------------------------------------

export async function redirectsAction(
  input: unknown,
): Promise<ActionResult<{ rows: RedirectRow[]; total: number; page: number; pages: number }>> {
  try {
    const user = await authorize('seo.manage');
    const query = z
      .object({
        q: z.string().max(200).optional(),
        origin: z.enum(['MANUAL', 'AUTOMATIC', '']).optional(),
        status: z.enum(['active', 'disabled', 'dormant', '']).optional(),
        countryId: z.string().max(60).optional(),
        page: z.number().int().min(1).max(100_000).optional(),
      })
      .parse(input);
    const mine = await listAccessibleCountries(user, { includeInactive: true });
    return success(await listRedirectRows(mine.map((country) => country.id), query));
  } catch (error) {
    return toActionError(error);
  }
}

// ---------------------------------------------------------------------------
// Redirect CSV import
// ---------------------------------------------------------------------------

const redirectImportInput = z.object({
  text: z.string().min(1, 'Choose a file or paste the CSV.').max(2_000_000, 'That file is larger than 2 MB. Import it in parts.'),
  type: z.enum(['PERMANENT', 'TEMPORARY']).default('PERMANENT'),
  resolutions: z.record(z.string().regex(/^\d{1,6}$/), z.enum(['keep', 'replace'])).default({}),
});

/**
 * Redirect imports decide who owns an address by asking the registry, so the
 * registry must have been scanned at least once: before that, content the
 * scan has not registered would look free.
 */
async function assertRegistryScanned() {
  const settings = await prisma.urlSettings.findUnique({ where: { id: 'singleton' }, select: { lastScanAt: true } });
  if (!settings?.lastScanAt) {
    throw new UrlRegistryError(
      'Run the first scan (Slug & URL Manager header) before importing redirects: until then the registry cannot tell which addresses belong to content.',
      'invalid',
      'path',
    );
  }
}

/** Validates a redirect CSV and returns the plan. Nothing is written. */
export async function previewRedirectImportAction(input: unknown): Promise<ActionResult<RedirectImportPlan>> {
  try {
    const user = await authorize('seo.manage');
    const parsed = redirectImportInput.parse(input);
    await assertRegistryScanned();
    const plan = await planRedirectImport(user, parsed);
    if ('error' in plan) return failure(plan.error);
    return success(plan);
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * Applies a previewed redirect import. The plan is worked out again from
 * current data and must match the preview; if anything changed in between,
 * nothing is applied and the new preview is returned instead.
 */
export async function applyRedirectImportAction(
  input: unknown,
): Promise<ActionResult<{ operation: RedirectImportView } | { stale: true; plan: RedirectImportPlan }>> {
  try {
    const user = await authorize('seo.manage');
    const { fingerprint, ...rest } = redirectImportInput
      .extend({ fingerprint: z.string().min(1).max(64) })
      .parse(input);
    await assertRegistryScanned();
    const plan = await planRedirectImport(user, rest);
    if ('error' in plan) return failure(plan.error);
    if (plan.fingerprint !== fingerprint) {
      return success(
        { stale: true as const, plan },
        'The redirects or addresses changed since the preview. Review the updated preview before importing.',
      );
    }
    if (plan.undecided > 0) {
      return failure(`Decide what to do with ${plan.undecided} conflicting row${plan.undecided === 1 ? '' : 's'} first: keep the existing redirect or replace it.`);
    }
    if (plan.writes === 0) return failure('There is nothing to import: every row is unchanged, kept or not importable.');
    const operation = await startRedirectImport(user, plan);
    revalidateManager();
    if (operation.status === 'COMPLETED' || operation.status === 'PARTIAL') revalidatePath('/', 'layout');
    return success({ operation }, operation.status === 'COMPLETED' ? 'Imported.' : 'Import started.');
  } catch (error) {
    return toActionError(error);
  }
}

/** Continues an import that runs in batches, or retries a batch that failed. */
export async function runRedirectImportAction(input: unknown): Promise<ActionResult<RedirectImportView>> {
  try {
    const user = await authorize('seo.manage');
    const id = z.string().min(1).max(60).parse(input);
    const existing = await getRedirectImport(id);
    if (!existing) return failure('That import no longer exists.');
    const result = await runRedirectImport(user, id);
    if (result.status === 'COMPLETED' || result.status === 'PARTIAL') {
      revalidatePath('/', 'layout');
      revalidateManager();
    }
    return success(result);
  } catch (error) {
    return toActionError(error);
  }
}

/** Recent redirect imports, for resuming one that did not finish. */
export async function listRedirectImportsAction(): Promise<ActionResult<RedirectImportView[]>> {
  try {
    await authorize('seo.manage');
    return success(await listRedirectImports());
  } catch (error) {
    return toActionError(error);
  }
}

/** One redirect import with its row-level results. */
export async function redirectImportAction(input: unknown): Promise<ActionResult<RedirectImportView>> {
  try {
    await authorize('seo.manage');
    const view = await getRedirectImport(z.string().min(1).max(60).parse(input));
    return view ? success(view) : failure('That import no longer exists.');
  } catch (error) {
    return toActionError(error);
  }
}

/** The row-level results of an import, as a CSV. */
export async function redirectImportResultsCsvAction(input: unknown): Promise<ActionResult<{ csv: string; filename: string }>> {
  try {
    await authorize('seo.manage');
    const id = z.string().min(1).max(60).parse(input);
    const view = await getRedirectImport(id);
    if (!view) return failure('That import no longer exists.');
    return success({ csv: toCsv(importResultsCsv(view)), filename: `redirect-import-${view.createdAt.slice(0, 10)}.csv` });
  } catch (error) {
    return toActionError(error);
  }
}

// ---------------------------------------------------------------------------
// Conflicts
// ---------------------------------------------------------------------------

export async function conflictsAction(): Promise<ActionResult<ConflictReport>> {
  try {
    const user = await authorize('seo.manage');
    return success(await conflictReport(user));
  } catch (error) {
    return toActionError(error);
  }
}

/** Free alternatives near a wanted path, to choose from — never applied automatically. */
export async function suggestPathsAction(input: unknown): Promise<ActionResult<string[]>> {
  try {
    const user = await authorize('seo.manage');
    const { path, ...ref } = refSchema.extend({ path: z.string().max(400) }).parse(input);
    await assertCountryAccess(user, ref.countryId);
    const countries = await listCountries();
    const market = countries.find((country) => country.id === ref.countryId);
    const root = countries.find((country) => country.isDefault) ?? countries[0];
    if (!market || !root) return failure('That market no longer exists.');
    const info = await loadInfo(ref.entityId, ref.countryId, ref.type, root);
    if (!info) return failure('That content is not available.');
    const suggestions = await suggestAlternatives(
      async (relative) => (await checkContentPath(user, ref, relative)).ok,
      {
        type: ref.type,
        slug: info.slug,
        wanted: path,
        marketSlug: market.slug,
        defaultPattern: ref.type === 'PAGE' ? null : DEFAULT_PATTERNS[ref.type],
      },
    );
    return success(suggestions.map((relative) => joinMarket(market.slug, relative)));
  } catch (error) {
    return toActionError(error);
  }
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

const historySchema = z.object({
  q: z.string().max(200).optional(),
  countryId: z.string().max(60).optional(),
  type: z.union([typeSchema, z.literal('')]).optional(),
  reason: z
    .enum(['CREATE', 'EDIT', 'SLUG', 'PATTERN', 'BULK', 'IMPORT', 'RESTORE', 'DELETE', 'BACKFILL', 'MARKET', ''])
    .optional(),
  page: z.number().int().min(1).max(100_000).optional(),
});

export async function historyAction(
  input: unknown,
): Promise<ActionResult<{ rows: HistoryRow[]; total: number; page: number; pages: number }>> {
  try {
    const user = await authorize('seo.manage');
    return success(await listHistory(user, historySchema.parse(input)));
  } catch (error) {
    return toActionError(error);
  }
}

export async function previewRestoreAction(input: unknown): Promise<ActionResult<RestorePreview>> {
  try {
    const user = await authorize('seo.manage');
    return success(await previewRestore(user, z.string().min(1).max(60).parse(input)));
  } catch (error) {
    return toActionError(error);
  }
}

export async function restoreHistoryAction(input: unknown) {
  try {
    const user = await authorize('seo.manage');
    const id = z.string().min(1).max(60).parse(input);
    await assertRegistryOn();
    const result = await restoreFromHistory(user, id);
    await recordAudit({
      actor: user,
      action: 'url.restored',
      entity: 'UrlHistory',
      entityId: id,
      summary: `${result.oldPath ?? '(none)'} → ${result.newPath}`,
    });
    revalidateAddresses([result.oldPath, result.newPath]);
    revalidateManager();
    return success(
      result,
      result.redirectId
        ? `Restored to ${result.newPath}. ${result.oldPath} now redirects there.`
        : `Restored to ${result.newPath}.`,
    );
  } catch (error) {
    if (error instanceof UrlRegistryError) return failure(error.message);
    return toActionError(error);
  }
}

// ---------------------------------------------------------------------------
// Destinations, for mapping an address somewhere deliberate
// ---------------------------------------------------------------------------

export type Destination = {
  entityId: string;
  countryId: string;
  type: UrlContentType;
  label: string;
  path: string;
  countryName: string;
};

/** Published content the user may send visitors to, by name or address. */
export async function searchDestinationsAction(input: unknown): Promise<ActionResult<Destination[]>> {
  try {
    const user = await authorize('seo.manage');
    const { q } = z.object({ q: z.string().max(200) }).parse(input);
    const result = await listUrls(user, { q, state: 'live', pageSize: 20 });
    return success(
      result.rows
        .filter((row) => row.path)
        .map((row) => ({
          entityId: row.entityId,
          countryId: row.countryId,
          type: row.type,
          label: row.label,
          path: row.path!,
          countryName: row.countryName,
        })),
    );
  } catch (error) {
    return toActionError(error);
  }
}

const homeSchema = z.object({
  source: z.string().min(1).max(500),
  target: z.object({ entityId: z.string().min(1).max(60), countryId: z.string().min(1).max(60), type: typeSchema }),
  notFoundId: z.string().max(60).optional().nullable(),
  note: z.string().max(200).optional().nullable(),
});

/**
 * Gives an address that answers 404 — a deleted page's old URL, a recorded
 * miss — a deliberate new home: a permanent redirect to published content the
 * user chose. Never to anything unpublished, and never by default.
 *
 * An address can already be held by a redirect that no longer delivers
 * anything: the automatic redirect from an earlier address of content that
 * has since been deleted, or a rule that is switched off. That rule is
 * re-pointed rather than refused, and becomes a manual rule — a person chose
 * where it goes now. A rule that works is never taken over from here.
 */
export async function giveAddressHomeAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await authorize('seo.manage');
    const parsed = homeSchema.parse(input);
    await assertCountryAccess(user, parsed.target.countryId);
    if (!(await isLive(parsed.target.type, parsed.target.entityId, parsed.target.countryId))) {
      return failure('Choose published content as the destination.');
    }
    const source = normaliseSource(parsed.source);
    if (!source.ok) return failure(source.error);

    let adopt: { id: string; updatedAt: string; note: string | null } | null = null;
    const held = await prisma.urlRoute.findUnique({ where: { pathKey: pathKey(source.path)! }, include: { redirect: true } });
    if (held?.kind === 'CONTENT') {
      return failure(`${held.path} is the address of existing content, so it does not need a new home.`);
    }
    if (held?.redirect) {
      const rule = held.redirect;
      const delivers =
        rule.isActive &&
        (rule.targetType && rule.targetEntityId && rule.targetCountryId
          ? await isLive(rule.targetType as UrlContentType, rule.targetEntityId, rule.targetCountryId)
          : true);
      if (delivers || rule.allMarkets) {
        return failure(`A redirect already answers for ${held.path}. Change it under Redirects.`);
      }
      adopt = { id: rule.id, updatedAt: rule.updatedAt.toISOString(), note: rule.note };
    }

    const mine = await listAccessibleCountries(user, { includeInactive: true });
    const result = await saveRedirectRule(
      {
        id: adopt?.id ?? null,
        expectedUpdatedAt: adopt?.updatedAt ?? null,
        source: source.path,
        destination: '',
        target: { entityId: parsed.target.entityId, countryId: parsed.target.countryId },
        type: 'PERMANENT',
        isActive: true,
        note: parsed.note ?? adopt?.note ?? null,
        origin: 'MANUAL',
      },
      user,
      { countryIds: new Set(mine.map((country) => country.id)), everyMarket: await everyMarket(user) },
    );
    if (!result.ok) return failure(result.error);

    if (parsed.notFoundId) {
      await prisma.urlNotFound.updateMany({
        where: { id: parsed.notFoundId },
        data: { status: 'RESOLVED', redirectId: result.id },
      });
    }
    // Every recorded miss at this address is answered now.
    await prisma.urlNotFound.updateMany({
      where: { pathKey: pathKey(source.path)!, status: 'OPEN' },
      data: { status: 'RESOLVED', redirectId: result.id },
    });
    await recordAudit({
      actor: user,
      action: 'url.mapped',
      entity: 'Redirect',
      entityId: result.id,
      summary: adopt ? `Re-pointed the redirect at ${source.path}` : `Gave ${source.path} a new home`,
    });
    revalidateAddresses([source.path]);
    revalidateManager();
    return success({ id: result.id }, `${source.path} now redirects permanently to the content you chose.`);
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * Saves a rule again as it is, which sends it straight to where its
 * destination ends up: a chain saved before the registry, or one that formed
 * when its destination became a redirect, collapses to a single hop.
 */
export async function straightenRedirectAction(input: unknown): Promise<ActionResult<{ id: string; flattened: boolean }>> {
  try {
    const user = await authorize('seo.manage');
    const id = z.string().min(1).max(60).parse(input);
    const rule = await prisma.redirect.findUnique({ where: { id } });
    if (!rule) return failure('That redirect no longer exists.');
    const mine = await listAccessibleCountries(user, { includeInactive: true });
    const result = await saveRedirectRule(
      {
        id: rule.id,
        expectedUpdatedAt: rule.updatedAt.toISOString(),
        source: rule.source,
        destination: rule.destination,
        target:
          rule.targetEntityId && rule.targetCountryId
            ? { entityId: rule.targetEntityId, countryId: rule.targetCountryId }
            : null,
        type: rule.type,
        isActive: rule.isActive,
        note: rule.note,
        allMarkets: rule.allMarkets,
      },
      user,
      { countryIds: new Set(mine.map((country) => country.id)), everyMarket: await everyMarket(user) },
    );
    if (!result.ok) return failure(result.error);
    await recordAudit({
      actor: user,
      action: 'redirect.straightened',
      entity: 'Redirect',
      entityId: rule.id,
      summary: `Sent ${rule.source} straight to its destination`,
    });
    revalidateAddresses([rule.source]);
    revalidateManager();
    return success(
      { id: result.id, flattened: result.flattened },
      result.flattened ? `${rule.source} now goes straight to its destination.` : 'That redirect was already direct.',
    );
  } catch (error) {
    return toActionError(error);
  }
}

// ---------------------------------------------------------------------------
// URL Health
// ---------------------------------------------------------------------------

export async function notFoundAction(
  input: unknown,
): Promise<ActionResult<{ rows: NotFoundRow[]; total: number; page: number; pages: number }>> {
  try {
    const user = await authorize('seo.manage');
    const query = z
      .object({
        status: z.enum(['OPEN', 'IGNORED', 'RESOLVED', '']).optional(),
        q: z.string().max(200).optional(),
        page: z.number().int().min(1).max(100_000).optional(),
      })
      .parse(input);
    return success(await listNotFound(user, query));
  } catch (error) {
    return toActionError(error);
  }
}

export async function setNotFoundStatusAction(input: unknown) {
  try {
    await authorize('seo.manage');
    const { id, status } = z
      .object({ id: z.string().min(1).max(60), status: z.enum(['OPEN', 'IGNORED']) })
      .parse(input);
    await prisma.urlNotFound.update({ where: { id }, data: { status } });
    revalidateManager();
    return success(undefined, status === 'IGNORED' ? 'Ignored.' : 'Reopened.');
  } catch (error) {
    return toActionError(error);
  }
}

export async function healthAction(): Promise<
  ActionResult<{ redirects: RedirectProblem[]; broken: { links: BrokenLink[]; scanned: number; truncated: boolean } }>
> {
  try {
    await authorize('seo.manage');
    const [redirects, broken] = await Promise.all([redirectProblems(), brokenInternalLinks()]);
    return success({ redirects, broken });
  } catch (error) {
    return toActionError(error);
  }
}

// ---------------------------------------------------------------------------
// The registry itself
// ---------------------------------------------------------------------------

/**
 * Scans the site and registers every address it serves. Idempotent and
 * non-destructive: it never moves an address. Site-wide, so it needs access
 * to every market.
 */
export async function runScanAction(): Promise<ActionResult<ScanReport>> {
  try {
    const user = await authorize('seo.manage');
    if (!(await everyMarket(user))) return failure('Scanning covers every market, so it needs access to all of them.');
    invalidateCountryCache();
    const report = await runUrlScan(user);
    await recordAudit({
      actor: user,
      action: 'urls.scan',
      entity: 'UrlSettings',
      summary: `Registered ${report.registered} address(es); ${report.collisions.length} collision(s)`,
    });
    revalidateManager();
    return success(report, `Scan complete: ${report.registered} new address(es) registered.`);
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * Switches public routing to the registry — or back. Switching on needs a
 * scan first, and any collisions it reported acknowledged; switching off is
 * always allowed, and immediately restores the old router.
 */
export async function setResolverAction(input: unknown) {
  try {
    const user = await authorize('seo.manage');
    const { enabled, acknowledged } = z
      .object({ enabled: z.boolean(), acknowledged: z.boolean().default(false) })
      .parse(input);
    if (!(await everyMarket(user))) return failure('This changes routing for every market, so it needs access to all of them.');

    const settings = await prisma.urlSettings.upsert({ where: { id: 'singleton' }, update: {}, create: { id: 'singleton' } });
    if (enabled) {
      if (!settings.lastScanAt) return failure('Run a scan first, so every existing address is registered.');
      const report = settings.lastScan as unknown as ScanReport | null;
      if ((report?.collisions.length ?? 0) > 0 && !acknowledged) {
        return failure(
          `The last scan reported ${report!.collisions.length} collision(s). Review them under Conflicts and confirm before switching on.`,
        );
      }
    }
    await prisma.urlSettings.update({
      where: { id: 'singleton' },
      data: {
        resolverEnabled: enabled,
        version: { increment: 1 },
        ...(enabled ? { activatedAt: new Date(), activatedById: user.id } : {}),
      },
    });
    await recordAudit({
      actor: user,
      action: enabled ? 'urls.resolver.on' : 'urls.resolver.off',
      entity: 'UrlSettings',
      summary: enabled ? 'Public routing switched to the URL registry' : 'Public routing switched back to the previous router',
    });
    revalidatePath('/', 'layout');
    revalidateManager();
    return success(undefined, enabled ? 'The URL registry now answers every public address.' : 'Switched back to the previous router.');
  } catch (error) {
    return toActionError(error);
  }
}

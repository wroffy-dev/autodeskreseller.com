import 'server-only';
import { prisma } from '@/lib/db/prisma';
import type { SessionUser } from '@/lib/auth/guards';
import { listCountries } from '@/lib/country/registry';
import type { ScanCollision, ScanRedirectIssue, ScanReport } from './backfill';
import { describeOwner, loadContentInfo } from './content';
import { checkAvailability } from './registry';
import { listUrls, type UrlRow } from './manager';
import { entityKey } from './snapshot';
import { isReservedFirstSegment, pathKey, segmentsOf, stripMarket } from './path';
import { redirectProblems, type RedirectProblem } from './health-report';
import { isPageType, type UrlContentType } from './types';

/**
 * Conflicts: content that has no public address, and why.
 *
 * The reason is worked out now, from the registry as it is — not read back
 * from the last scan, which may be out of date. The scan's own explanation is
 * kept only where the current state cannot reproduce it: an address the
 * previous router could never reach, while that router still serves the site.
 */

export type ConflictReason = ScanCollision['reason'] | 'free';

export type ConflictOwner = {
  kind: 'content' | 'redirect' | 'city';
  description: string;
  path: string;
  editHref: string | null;
};

export type ConflictRow = {
  row: UrlRow;
  /** The full path the content would take: its page path, or its pattern's. */
  wanted: string;
  reason: ConflictReason;
  detail: string;
  owner: ConflictOwner | null;
};

export type ConflictReport = {
  scan: ScanReport | null;
  scannedAt: string | null;
  resolverEnabled: boolean;
  rows: ConflictRow[];
  /** Content without an address that the user can see, beyond the rows shown. */
  total: number;
  /** Collisions the last scan reported that are resolved now. */
  resolvedSinceScan: number;
  redirectIssues: ScanRedirectIssue[];
  dormant: RedirectProblem[];
};

const LIMIT = 100;

export async function conflictReport(user: SessionUser): Promise<ConflictReport> {
  const [settings, unregistered, countries, problems] = await Promise.all([
    prisma.urlSettings.findUnique({ where: { id: 'singleton' } }),
    listUrls(user, { mode: 'UNREGISTERED', pageSize: LIMIT }),
    listCountries(),
    redirectProblems(),
  ]);
  const scan = (settings?.lastScan as unknown as ScanReport | null) ?? null;
  const resolverEnabled = Boolean(settings?.resolverEnabled);
  const prefixes = countries.map((country) => country.slug).filter(Boolean);
  const root = countries.find((country) => country.isDefault) ?? countries[0];
  const collisions = new Map(
    (scan?.collisions ?? []).map((collision) => [entityKey(collision.entityId, collision.countryId), collision]),
  );

  const rows: ConflictRow[] = [];
  const contentOwners: Array<{ index: number; type: UrlContentType; entityId: string; countryId: string }> = [];
  for (const row of unregistered.rows) {
    const collision = collisions.get(row.key);
    const wanted = collision?.path ?? row.patternPath;
    const key = pathKey(wanted);
    if (!key) {
      rows.push({ row, wanted, reason: 'invalid', detail: 'The address is not a valid URL path.', owner: null });
      continue;
    }
    const first = segmentsOf(stripMarket(row.marketPrefix.slice(1), wanted))[0];
    if (first && isReservedFirstSegment(first, { marketPrefixes: prefixes })) {
      rows.push({
        row,
        wanted,
        reason: 'reserved',
        detail: prefixes.includes(first)
          ? `“/${first}” is a market prefix, so this address belongs to that market.`
          : `“/${first}” is a system route, so this address can never reach content.`,
        owner: null,
      });
      continue;
    }
    const availability = await checkAvailability(prisma, key, {
      entityId: row.entityId,
      countryId: row.countryId,
      type: row.type,
    });
    if (!availability.ok) {
      const owner = availability.owner;
      if (owner.kind === 'content' && owner.type && owner.entityId) {
        contentOwners.push({ index: rows.length, type: owner.type, entityId: owner.entityId, countryId: owner.countryId });
      }
      rows.push({
        row,
        wanted,
        reason: 'taken',
        detail: `Already used by ${owner.description}.`,
        owner: {
          kind: owner.kind,
          description: owner.description,
          path: owner.path,
          editHref: owner.kind === 'city' && owner.cityId ? `/admin/cities/${owner.cityId}` : null,
        },
      });
      continue;
    }
    if (!resolverEnabled && collision?.reason === 'shadowed') {
      rows.push({ row, wanted, reason: 'shadowed', detail: collision.detail, owner: null });
      continue;
    }
    rows.push({
      row,
      wanted,
      reason: 'free',
      detail: 'Nothing holds this address now. Give the content its address to make it reachable.',
      owner: null,
    });
  }

  // Name the content that holds each taken address, in one batch.
  if (contentOwners.length > 0 && root) {
    const infos = await loadContentInfo(contentOwners, root.id);
    for (const owner of contentOwners) {
      const info = infos.get(entityKey(owner.entityId, owner.countryId));
      const target = rows[owner.index];
      if (!info || !target?.owner) continue;
      target.owner = { ...target.owner, description: describeOwner(info), editHref: info.editHref };
      target.detail = `Already used by ${describeOwner(info)}.`;
    }
  }

  const stillOpen = new Set(unregistered.rows.map((row) => row.key));
  const resolvedSinceScan = (scan?.collisions ?? []).filter(
    (collision) => !stillOpen.has(entityKey(collision.entityId, collision.countryId)),
  ).length;

  return {
    scan,
    scannedAt: settings?.lastScanAt?.toISOString() ?? null,
    resolverEnabled,
    rows,
    total: unregistered.total,
    resolvedSinceScan: unregistered.total > LIMIT ? 0 : resolvedSinceScan,
    redirectIssues: scan?.redirectIssues ?? [],
    dormant: problems.filter((problem) => problem.problem === 'dormant'),
  };
}

/**
 * Free addresses near the one content wanted — offered, never applied.
 *
 * The content type's built-in address comes first when it differs (a product
 * that cannot have /autocad can usually have /products/autocad), then numbered
 * variants of the wanted path.
 */
export async function suggestAlternatives(
  isFree: (relative: string) => Promise<boolean>,
  input: { type: UrlContentType; slug: string; wanted: string; marketSlug: string; defaultPattern: string | null },
): Promise<string[]> {
  const relative = stripMarket(input.marketSlug, input.wanted);
  const candidates: string[] = [];
  if (input.defaultPattern && !isPageType(input.type)) {
    const fallback = input.defaultPattern.replace('{slug}', input.slug);
    if (fallback !== relative) candidates.push(fallback);
  }
  const base = relative.replace(/-\d+$/, '').replace(/\/+$/, '') || '/';
  if (base !== '/') for (let n = 2; n <= 9; n += 1) candidates.push(`${base}-${n}`);

  const found: string[] = [];
  for (const candidate of candidates) {
    if (found.length >= 3) break;
    if (await isFree(candidate)) found.push(candidate);
  }
  return found;
}

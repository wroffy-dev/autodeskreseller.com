import 'server-only';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { storedIssues } from '@/lib/seo/recommendations';
import { SEO_ENGINE_VERSION, type SeoAuditResult, type SeoDocument } from '@/lib/seo/types';
import { forgetSeoContext, loadSeoContext, type SeoContext } from './context';
import { auditEntities, forgetMarketIndexes, type EntityRef } from './audit';
import { listAuditTargets, targetKey, type AuditTarget } from './targets';

/**
 * The score cache.
 *
 * Rows in `SeoAudit` are what the dashboard lists, filters and sorts. Each is
 * recalculated from the content it describes — never edited — and carries the
 * fingerprints it was calculated from, so a row whose content, settings or
 * engine version has moved on is known to be stale without recalculating it.
 */

export type AuditRowStatus = 'live' | 'scheduled' | 'draft' | 'archived' | 'not-served';

export function rowStatus(doc: SeoDocument): AuditRowStatus {
  if (doc.status.live) return 'live';
  if (doc.status.notServedReason && doc.status.value === 'PUBLISHED') {
    const scheduled = doc.status.publishedAt && new Date(doc.status.publishedAt) > new Date();
    if (!scheduled) return 'not-served';
  }
  if (doc.status.value === 'SCHEDULED' || doc.status.value === 'PUBLISHED') return 'scheduled';
  return doc.status.value === 'ARCHIVED' ? 'archived' : 'draft';
}

function rowData(
  ctx: SeoContext,
  doc: SeoDocument,
  result: SeoAuditResult,
  target: AuditTarget | undefined,
): Omit<Prisma.SeoAuditUncheckedCreateInput, 'id'> {
  return {
    entityType: doc.entityType,
    entityId: doc.entityId,
    countryId: doc.country.id,
    kind: doc.kind,
    title: doc.name.slice(0, 500),
    url: doc.path,
    status: rowStatus(doc),
    indexable: result.flags.indexable,
    noIndex: doc.robots.noIndex,
    seoScore: result.seo.score,
    aeoScore: result.aeo.score,
    geoScore: result.geo.score,
    overallScore: result.overall,
    criticalCount: result.counts.critical,
    warningCount: result.counts.warnings,
    suggestionCount: result.counts.suggestions,
    issueCount: result.counts.issues,
    missingMetadata: result.flags.missingMetadata,
    missingSchema: result.flags.missingSchema,
    missingKeywords: result.flags.missingKeywords,
    indexingConflict: result.flags.indexingConflict,
    issues: storedIssues(result) as unknown as Prisma.InputJsonValue,
    keywords: result.keywords as unknown as Prisma.InputJsonValue,
    engineVersion: SEO_ENGINE_VERSION,
    contentUpdatedAt: target?.contentUpdatedAt ?? new Date(doc.updatedAt),
    contentFingerprint: target?.contentFingerprint ?? '',
    contextFingerprint: ctx.fingerprint,
    calculatedAt: new Date(),
  };
}

export async function storeAudits(
  ctx: SeoContext,
  audited: ReadonlyArray<{ doc: SeoDocument; result: SeoAuditResult }>,
  targets: ReadonlyMap<string, AuditTarget>,
): Promise<void> {
  const writes = audited.map(({ doc, result }) => {
    const data = rowData(ctx, doc, result, targets.get(targetKey({ entityType: doc.entityType, entityId: doc.entityId, countryId: doc.country.id })));
    return prisma.seoAudit.upsert({
      where: {
        entityType_entityId_countryId: {
          entityType: doc.entityType,
          entityId: doc.entityId,
          countryId: doc.country.id,
        },
      },
      create: data,
      update: data,
    });
  });
  for (let start = 0; start < writes.length; start += 25) {
    await prisma.$transaction(writes.slice(start, start + 25));
  }
}

/** Recalculates and stores the given URLs from their saved content. */
export async function recalculateEntities(
  refs: readonly EntityRef[],
): Promise<Array<{ doc: SeoDocument; result: SeoAuditResult }>> {
  if (refs.length === 0) return [];
  const ctx = await loadSeoContext();
  const countries = [...new Set(refs.map((ref) => ref.countryId))];
  const [audited, targets] = await Promise.all([
    auditEntities(ctx, refs),
    listAuditTargets(ctx, { countryIds: countries }),
  ]);
  const byKey = new Map(targets.map((target) => [targetKey(target), target]));
  // Only URLs that exist as targets are cached: a product previewed in a
  // market it is not sold in is scored, never listed.
  const listed = audited.filter(({ doc }) =>
    byKey.has(targetKey({ entityType: doc.entityType, entityId: doc.entityId, countryId: doc.country.id })),
  );
  await storeAudits(ctx, listed, byKey);
  return audited;
}

export type Staleness = {
  total: number;
  fresh: number;
  stale: number;
  missing: number;
  /** Keys of targets whose cached row is stale or absent. */
  outdated: Set<string>;
  /** Keys of targets that have a cached row, stale or not. */
  cached: Set<string>;
  /** Ids of cached rows that no longer match their content, settings or engine. */
  outdatedIds: Set<string>;
  targets: Map<string, AuditTarget>;
};

type CachedFingerprint = {
  id: string;
  entityType: string;
  entityId: string;
  countryId: string;
  engineVersion: string;
  contentFingerprint: string;
  contextFingerprint: string;
};

export function isStale(
  row: Pick<CachedFingerprint, 'engineVersion' | 'contentFingerprint' | 'contextFingerprint'>,
  target: AuditTarget | undefined,
  ctx: Pick<SeoContext, 'fingerprint'>,
): boolean {
  return (
    !target ||
    row.engineVersion !== SEO_ENGINE_VERSION ||
    row.contextFingerprint !== ctx.fingerprint ||
    row.contentFingerprint !== target.contentFingerprint
  );
}

/**
 * Which cached rows are fresh, which are stale and which URLs have none.
 * Rows for URLs that no longer exist — a deleted page — are removed here.
 */
export async function staleness(ctx: SeoContext): Promise<Staleness> {
  const [targets, rows] = await Promise.all([
    listAuditTargets(ctx),
    prisma.seoAudit.findMany({
      select: {
        id: true,
        entityType: true,
        entityId: true,
        countryId: true,
        engineVersion: true,
        contentFingerprint: true,
        contextFingerprint: true,
      },
    }),
  ]);
  const byKey = new Map(targets.map((target) => [targetKey(target), target]));
  const seen = new Set<string>();
  const orphans: string[] = [];
  const outdated = new Set<string>();
  const outdatedIds = new Set<string>();
  let fresh = 0;

  for (const row of rows) {
    const key = targetKey(row as { entityType: AuditTarget['entityType']; entityId: string; countryId: string });
    const target = byKey.get(key);
    if (!target) {
      orphans.push(row.id);
      continue;
    }
    seen.add(key);
    if (isStale(row, target, ctx)) {
      outdated.add(key);
      outdatedIds.add(row.id);
    } else fresh += 1;
  }
  for (const key of byKey.keys()) if (!seen.has(key)) outdated.add(key);
  if (orphans.length > 0) await prisma.seoAudit.deleteMany({ where: { id: { in: orphans } } });

  return {
    total: targets.length,
    fresh,
    stale: [...outdated].filter((key) => seen.has(key)).length,
    missing: targets.length - seen.size,
    outdated,
    outdatedIds,
    cached: seen,
    targets: byKey,
  };
}

export type BatchProgress = {
  /** URLs recalculated by this call. */
  processed: number;
  /** URLs still to go after this call. */
  remaining: number;
  /** Where the next batch starts; null when the run is finished. */
  nextCursor: string | null;
};

/**
 * Recalculates the next batch of URLs after `cursor`.
 *
 * The caller loops until `nextCursor` is null, so a site of any size is
 * recalculated in small, bounded steps rather than one long request, and a
 * run that is interrupted simply resumes from its cursor. `onlyOutdated`
 * skips URLs whose cached score is still fresh.
 */
export async function recalculateBatch(options: {
  cursor: string | null;
  size?: number;
  onlyOutdated?: boolean;
  countryIds?: readonly string[];
}): Promise<BatchProgress> {
  const size = Math.min(Math.max(options.size ?? 20, 1), 50);
  if (!options.cursor) {
    // A new run reads settings and market comparisons afresh.
    forgetSeoContext();
    forgetMarketIndexes();
  }
  const ctx = await loadSeoContext();
  const state = await staleness(ctx);
  let queue = [...state.targets.values()];
  if (options.countryIds) {
    const allowed = new Set(options.countryIds);
    queue = queue.filter((target) => allowed.has(target.countryId));
  }
  if (options.onlyOutdated) queue = queue.filter((target) => state.outdated.has(targetKey(target)));

  const start = options.cursor ? queue.findIndex((target) => targetKey(target) > options.cursor!) : 0;
  const from = start === -1 ? queue.length : start;
  const batch = queue.slice(from, from + size);

  if (batch.length > 0) {
    const audited = await auditEntities(
      ctx,
      batch.map((target) => ({ type: target.entityType, id: target.entityId, countryId: target.countryId })),
    );
    await storeAudits(ctx, audited, state.targets);
  }

  const remaining = Math.max(0, queue.length - from - batch.length);
  return {
    processed: batch.length,
    remaining,
    nextCursor: remaining > 0 && batch.length > 0 ? targetKey(batch[batch.length - 1]!) : null,
  };
}

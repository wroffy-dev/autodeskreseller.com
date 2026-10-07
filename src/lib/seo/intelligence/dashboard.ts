import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { siteScoresFromTotals, type SiteScores } from '@/lib/seo/score-overall';
import { SCORE_STATE_LABELS, type ScoreState } from '@/lib/seo/score-state';
import type { StoredCheck } from '@/lib/seo/recommendations';
import { SEO_PAGE_KINDS, type SeoEntityType, type SeoPageKind } from '@/lib/seo/types';
import type { AuditRowStatus } from './cache';

/**
 * What the SEO Intelligence dashboard reads.
 *
 * Everything comes from the cached `SeoAudit` rows, never from scoring pages
 * on the spot: the summary is one aggregate query, the site score is summed
 * per kind of URL in the database, and the table is one page of rows. Opening
 * the dashboard costs the same for ten URLs as for ten thousand.
 */

export const AUDIT_ROW_STATUSES: readonly AuditRowStatus[] = [
  'live',
  'scheduled',
  'draft',
  'archived',
  'not-served',
];

export const AUDIT_ROW_STATUS_LABELS: Record<AuditRowStatus, string> = {
  live: 'Live',
  scheduled: 'Scheduled',
  draft: 'Draft',
  archived: 'Archived',
  'not-served': 'Not served',
};

/** URLs scoring below this are listed as needing attention. */
export const ATTENTION_BELOW = 60;

/** The overall-score filter: the four states, and everything that needs work. */
export const SCORE_FILTERS = {
  attention: { label: 'Needs attention', min: 0, max: ATTENTION_BELOW - 1 },
  poor: { label: SCORE_STATE_LABELS.poor, min: 0, max: 39 },
  'needs-improvement': { label: SCORE_STATE_LABELS['needs-improvement'], min: 40, max: 59 },
  good: { label: SCORE_STATE_LABELS.good, min: 60, max: 79 },
  excellent: { label: SCORE_STATE_LABELS.excellent, min: 80, max: 100 },
} as const;

export type ScoreFilter = keyof typeof SCORE_FILTERS;

export const ISSUE_FILTERS = {
  critical: 'Has critical issues',
  metadata: 'Missing metadata',
  schema: 'Missing structured data',
  keywords: 'No primary keywords',
  conflict: 'Indexing conflicts',
} as const;

export type IssueFilter = keyof typeof ISSUE_FILTERS;

export const INDEX_FILTERS = {
  indexable: 'Indexable',
  noindex: 'Noindex',
  'not-live': 'Not live',
} as const;

export type IndexFilter = keyof typeof INDEX_FILTERS;

/** The most severe issue a URL has. */
export const SEVERITY_FILTERS = {
  critical: 'Critical issues',
  warning: 'Warnings',
  suggestion: 'Suggestions only',
  clean: 'No issues',
} as const;

export type SeverityFilter = keyof typeof SEVERITY_FILTERS;

/** Whether a cached score still matches its content, settings and engine version. */
export const AUDIT_STATE_FILTERS = {
  current: 'Up to date',
  outdated: 'Outdated — content changed since',
} as const;

export type AuditStateFilter = keyof typeof AUDIT_STATE_FILTERS;

export type AuditFilters = {
  /** The markets in view. Always the user's accessible ones at most. */
  countryIds: readonly string[];
  kind?: SeoPageKind;
  status?: AuditRowStatus;
  score?: ScoreFilter;
  index?: IndexFilter;
  issue?: IssueFilter;
  severity?: SeverityFilter;
  /** With `outdatedIds`, the rows the staleness check found out of date. */
  audit?: AuditStateFilter;
  outdatedIds?: readonly string[];
  q?: string;
  /** Only these pages: a city's, resolved by the caller from a city it has checked access to. */
  pageIds?: readonly string[];
};

export const AUDIT_SORTS = ['overall', 'seo', 'aeo', 'geo', 'issues', 'updated', 'title'] as const;
export type AuditSort = (typeof AUDIT_SORTS)[number];

/** Reads a query-string value as one of a known set, or nothing. */
export function oneOf<T extends string>(value: string | undefined, allowed: readonly T[]): T | undefined {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

export function parseAuditFilters(
  params: Record<string, string | undefined>,
  countryIds: readonly string[],
): AuditFilters {
  return {
    countryIds,
    kind: oneOf(params.type, SEO_PAGE_KINDS),
    status: oneOf(params.status, AUDIT_ROW_STATUSES),
    score: oneOf(params.score, Object.keys(SCORE_FILTERS) as ScoreFilter[]),
    index: oneOf(params.index, Object.keys(INDEX_FILTERS) as IndexFilter[]),
    issue: oneOf(params.issue, Object.keys(ISSUE_FILTERS) as IssueFilter[]),
    severity: oneOf(params.severity, Object.keys(SEVERITY_FILTERS) as SeverityFilter[]),
    audit: oneOf(params.audit, Object.keys(AUDIT_STATE_FILTERS) as AuditStateFilter[]),
    q: params.q?.trim().slice(0, 200) || undefined,
  };
}

export function auditWhere(filters: AuditFilters): Prisma.SeoAuditWhereInput {
  const where: Prisma.SeoAuditWhereInput = { countryId: { in: [...filters.countryIds] } };
  const and: Prisma.SeoAuditWhereInput[] = [];
  // The home page is a page too, so "Pages" includes it.
  if (filters.kind) where.kind = filters.kind === 'page' ? { in: ['page', 'homepage'] } : filters.kind;
  if (filters.status) where.status = filters.status;
  if (filters.score) {
    const { min, max } = SCORE_FILTERS[filters.score];
    where.overallScore = { gte: min, lte: max };
  }
  if (filters.index === 'indexable') where.indexable = true;
  if (filters.index === 'noindex') where.noIndex = true;
  if (filters.index === 'not-live') and.push({ status: { not: 'live' } });
  switch (filters.issue) {
    case 'critical':
      where.criticalCount = { gt: 0 };
      break;
    case 'metadata':
      where.missingMetadata = true;
      break;
    case 'schema':
      where.missingSchema = true;
      break;
    case 'keywords':
      where.missingKeywords = true;
      break;
    case 'conflict':
      where.indexingConflict = true;
      break;
    default:
      break;
  }
  switch (filters.severity) {
    case 'critical':
      and.push({ criticalCount: { gt: 0 } });
      break;
    case 'warning':
      and.push({ criticalCount: 0, warningCount: { gt: 0 } });
      break;
    case 'suggestion':
      and.push({ criticalCount: 0, warningCount: 0, suggestionCount: { gt: 0 } });
      break;
    case 'clean':
      and.push({ criticalCount: 0, warningCount: 0, suggestionCount: 0 });
      break;
    default:
      break;
  }
  if (filters.audit && filters.outdatedIds) {
    and.push({ id: filters.audit === 'outdated' ? { in: [...filters.outdatedIds] } : { notIn: [...filters.outdatedIds] } });
  }
  if (filters.q) {
    and.push({
      OR: [
        { title: { contains: filters.q, mode: 'insensitive' } },
        { url: { contains: filters.q, mode: 'insensitive' } },
      ],
    });
  }
  if (filters.pageIds) and.push({ entityType: 'PAGE', entityId: { in: [...filters.pageIds] } });
  if (and.length > 0) where.AND = and;
  return where;
}

export function auditOrderBy(
  sort: AuditSort | undefined,
  dir: 'asc' | 'desc' | undefined,
): Prisma.SeoAuditOrderByWithRelationInput[] {
  // Lowest overall score first: the top of the list is what needs work.
  const direction = dir ?? (sort === 'issues' || sort === 'updated' ? 'desc' : 'asc');
  const tiebreak: Prisma.SeoAuditOrderByWithRelationInput[] = [{ title: 'asc' }, { id: 'asc' }];
  switch (sort) {
    case 'seo':
      return [{ seoScore: direction }, ...tiebreak];
    case 'aeo':
      return [{ aeoScore: direction }, ...tiebreak];
    case 'geo':
      return [{ geoScore: direction }, ...tiebreak];
    case 'issues':
      return [{ issueCount: direction }, { criticalCount: direction }, ...tiebreak];
    case 'updated':
      return [{ contentUpdatedAt: direction }, ...tiebreak];
    case 'title':
      return [{ title: direction }, { id: 'asc' }];
    case 'overall':
    default:
      return [{ overallScore: direction }, { criticalCount: 'desc' }, ...tiebreak];
  }
}

export type AuditListRow = {
  id: string;
  entityType: SeoEntityType;
  entityId: string;
  countryId: string;
  countryName: string;
  countryCode: string;
  kind: SeoPageKind;
  title: string;
  url: string;
  status: AuditRowStatus;
  indexable: boolean;
  noIndex: boolean;
  seoScore: number;
  aeoScore: number;
  geoScore: number;
  overallScore: number;
  criticalCount: number;
  warningCount: number;
  suggestionCount: number;
  issueCount: number;
  /** The most costly thing to fix, for a one-line summary. */
  topIssue: string | null;
  contentUpdatedAt: Date;
  calculatedAt: Date;
};

export async function listAudits(
  filters: AuditFilters,
  options: { sort?: AuditSort; dir?: 'asc' | 'desc'; page: number; perPage: number },
): Promise<{ rows: AuditListRow[]; total: number }> {
  if (filters.countryIds.length === 0) return { rows: [], total: 0 };
  const where = auditWhere(filters);
  const [rows, total] = await Promise.all([
    prisma.seoAudit.findMany({
      where,
      orderBy: auditOrderBy(options.sort, options.dir),
      skip: (options.page - 1) * options.perPage,
      take: options.perPage,
      select: {
        id: true,
        entityType: true,
        entityId: true,
        countryId: true,
        kind: true,
        title: true,
        url: true,
        status: true,
        indexable: true,
        noIndex: true,
        seoScore: true,
        aeoScore: true,
        geoScore: true,
        overallScore: true,
        criticalCount: true,
        warningCount: true,
        suggestionCount: true,
        issueCount: true,
        issues: true,
        contentUpdatedAt: true,
        calculatedAt: true,
        country: { select: { name: true, code: true } },
      },
    }),
    prisma.seoAudit.count({ where }),
  ]);

  return {
    total,
    rows: rows.map((row) => ({
      id: row.id,
      entityType: row.entityType as SeoEntityType,
      entityId: row.entityId,
      countryId: row.countryId,
      countryName: row.country.name,
      countryCode: row.country.code,
      kind: row.kind as SeoPageKind,
      title: row.title,
      url: row.url,
      status: row.status as AuditRowStatus,
      indexable: row.indexable,
      noIndex: row.noIndex,
      seoScore: row.seoScore,
      aeoScore: row.aeoScore,
      geoScore: row.geoScore,
      overallScore: row.overallScore,
      criticalCount: row.criticalCount,
      warningCount: row.warningCount,
      suggestionCount: row.suggestionCount,
      issueCount: row.issueCount,
      topIssue: topIssueOf(row.issues),
      contentUpdatedAt: row.contentUpdatedAt,
      calculatedAt: row.calculatedAt,
    })),
  };
}

const BUCKET_RANK = { critical: 0, improvement: 1, suggestion: 2 } as const;

function topIssueOf(raw: Prisma.JsonValue): string | null {
  if (!Array.isArray(raw)) return null;
  const checks = (raw as unknown as StoredCheck[]).filter(
    (check) => check && (check.status === 'FAIL' || check.status === 'WARNING'),
  );
  if (checks.length === 0) return null;
  const rank = (check: StoredCheck) =>
    check.status === 'FAIL' && check.severity === 'critical' ? 0 : 1 + (BUCKET_RANK[check.severity] ?? 2);
  const [top] = [...checks].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      b.pointsAvailable - b.pointsEarned - (a.pointsAvailable - a.pointsEarned),
  );
  return top ? top.message : null;
}

// ---------------------------------------------------------------------------
// The summary
// ---------------------------------------------------------------------------

export type AuditSummary = {
  site: SiteScores | null;
  total: number;
  indexable: number;
  live: number;
  noIndex: number;
  critical: number;
  criticalUrls: number;
  warnings: number;
  warningUrls: number;
  suggestions: number;
  pagesNeedingAttention: number;
  productsNeedingAttention: number;
  missingMetadata: number;
  missingSchema: number;
  missingKeywords: number;
  indexingConflicts: number;
  distribution: Record<ScoreState, number>;
  lastCalculated: Date | null;
};

const EMPTY_SUMMARY: AuditSummary = {
  site: null,
  total: 0,
  indexable: 0,
  live: 0,
  noIndex: 0,
  critical: 0,
  criticalUrls: 0,
  warnings: 0,
  warningUrls: 0,
  suggestions: 0,
  pagesNeedingAttention: 0,
  productsNeedingAttention: 0,
  missingMetadata: 0,
  missingSchema: 0,
  missingKeywords: 0,
  indexingConflicts: 0,
  distribution: { poor: 0, 'needs-improvement': 0, good: 0, excellent: 0 },
  lastCalculated: null,
};

type SummaryRow = {
  total: number;
  indexable: number;
  live: number;
  noIndex: number;
  critical: number;
  criticalUrls: number;
  warnings: number;
  warningUrls: number;
  suggestions: number;
  pagesNeedingAttention: number;
  productsNeedingAttention: number;
  missingMetadata: number;
  missingSchema: number;
  missingKeywords: number;
  indexingConflicts: number;
  poor: number;
  needsImprovement: number;
  good: number;
  excellent: number;
  lastCalculated: Date | null;
};

export async function auditSummary(countryIds: readonly string[]): Promise<AuditSummary> {
  if (countryIds.length === 0) return EMPTY_SUMMARY;
  const inScope = Prisma.sql`"countryId" IN (${Prisma.join([...countryIds])})`;

  const [rows, kinds] = await Promise.all([
    prisma.$queryRaw<SummaryRow[]>`
      SELECT
        count(*)::int AS "total",
        count(*) FILTER (WHERE "indexable")::int AS "indexable",
        count(*) FILTER (WHERE "status" = 'live')::int AS "live",
        count(*) FILTER (WHERE "noIndex")::int AS "noIndex",
        coalesce(sum("criticalCount"), 0)::int AS "critical",
        count(*) FILTER (WHERE "criticalCount" > 0)::int AS "criticalUrls",
        coalesce(sum("warningCount"), 0)::int AS "warnings",
        count(*) FILTER (WHERE "warningCount" > 0)::int AS "warningUrls",
        coalesce(sum("suggestionCount"), 0)::int AS "suggestions",
        count(*) FILTER (WHERE "kind" IN ('homepage', 'page') AND "overallScore" < ${ATTENTION_BELOW})::int AS "pagesNeedingAttention",
        count(*) FILTER (WHERE "kind" = 'product' AND "overallScore" < ${ATTENTION_BELOW})::int AS "productsNeedingAttention",
        count(*) FILTER (WHERE "missingMetadata")::int AS "missingMetadata",
        count(*) FILTER (WHERE "missingSchema")::int AS "missingSchema",
        count(*) FILTER (WHERE "missingKeywords")::int AS "missingKeywords",
        count(*) FILTER (WHERE "indexingConflict")::int AS "indexingConflicts",
        count(*) FILTER (WHERE "indexable" AND "overallScore" < 40)::int AS "poor",
        count(*) FILTER (WHERE "indexable" AND "overallScore" >= 40 AND "overallScore" < 60)::int AS "needsImprovement",
        count(*) FILTER (WHERE "indexable" AND "overallScore" >= 60 AND "overallScore" < 80)::int AS "good",
        count(*) FILTER (WHERE "indexable" AND "overallScore" >= 80)::int AS "excellent",
        max("calculatedAt") AS "lastCalculated"
      FROM "SeoAudit"
      WHERE ${inScope}
    `,
    prisma.seoAudit.groupBy({
      by: ['kind'],
      where: { countryId: { in: [...countryIds] }, indexable: true },
      _count: { _all: true },
      _sum: { seoScore: true, aeoScore: true, geoScore: true, overallScore: true },
    }),
  ]);

  const row = rows[0];
  if (!row) return EMPTY_SUMMARY;
  return {
    site: siteScoresFromTotals(
      kinds.map((group) => ({
        kind: group.kind as SeoPageKind,
        count: group._count._all,
        seo: group._sum.seoScore ?? 0,
        aeo: group._sum.aeoScore ?? 0,
        geo: group._sum.geoScore ?? 0,
        overall: group._sum.overallScore ?? 0,
      })),
    ),
    total: row.total,
    indexable: row.indexable,
    live: row.live,
    noIndex: row.noIndex,
    critical: row.critical,
    criticalUrls: row.criticalUrls,
    warnings: row.warnings,
    warningUrls: row.warningUrls,
    suggestions: row.suggestions,
    pagesNeedingAttention: row.pagesNeedingAttention,
    productsNeedingAttention: row.productsNeedingAttention,
    missingMetadata: row.missingMetadata,
    missingSchema: row.missingSchema,
    missingKeywords: row.missingKeywords,
    indexingConflicts: row.indexingConflicts,
    distribution: {
      poor: row.poor,
      'needs-improvement': row.needsImprovement,
      good: row.good,
      excellent: row.excellent,
    },
    lastCalculated: row.lastCalculated,
  };
}

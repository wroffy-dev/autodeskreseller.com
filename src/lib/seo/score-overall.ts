import { analyzeDocument } from './analysis';
import { schemaGaps } from './schema-analysis';
import { scoreAeo } from './score-aeo';
import { scoreGeo } from './score-geo';
import { scoreSeo } from './score-seo';
import { checkBucket } from './score-state';
import {
  SEO_ENGINE_VERSION,
  type AuditCounts,
  type AuditFlags,
  type CheckResult,
  type SeoAuditResult,
  type SeoDocument,
  type SeoPageKind,
} from './types';

/**
 * The overall score, and the site's.
 *
 * Overall is a weighted blend of the three component scores, which are always
 * shown beside it — one number alone would hide which kind of work a page
 * needs. The weights live here and nowhere else, so changing the balance is a
 * one-line change that every screen follows.
 */
export const OVERALL_WEIGHTS = { seo: 0.5, aeo: 0.25, geo: 0.25 } as const;

const clamp = (value: number) => Math.min(100, Math.max(0, Math.round(value)));

export { checkBucket, scoreState, SCORE_STATE_LABELS, type ScoreState } from './score-state';

export function overallScore(
  scores: { seo: number; aeo: number; geo: number },
  weights: { seo: number; aeo: number; geo: number } = OVERALL_WEIGHTS,
): number {
  const total = weights.seo + weights.aeo + weights.geo;
  if (total <= 0) return 0;
  return clamp((scores.seo * weights.seo + scores.aeo * weights.aeo + scores.geo * weights.geo) / total);
}

function countChecks(checks: CheckResult[]): AuditCounts {
  const counts = { critical: 0, warnings: 0, suggestions: 0, passed: 0, info: 0, issues: 0 };
  for (const check of checks) {
    const bucket = checkBucket(check);
    if (bucket === 'critical') counts.critical += 1;
    else if (bucket === 'warning') counts.warnings += 1;
    else if (bucket === 'suggestion') counts.suggestions += 1;
    else if (bucket === 'passed') counts.passed += 1;
    else if (bucket === 'info') counts.info += 1;
  }
  counts.issues = counts.critical + counts.warnings;
  return counts;
}

/**
 * Audits one document: every check, every score, and the flags the dashboard
 * filters on. Pure: the same document always produces the same result.
 */
export function auditDocument(doc: SeoDocument): SeoAuditResult {
  const analysis = analyzeDocument(doc);
  const seo = scoreSeo(doc, analysis);
  const aeo = scoreAeo(doc, analysis);
  const geo = scoreGeo(doc, analysis);
  const checks = [...seo.checks, ...aeo.checks, ...geo.checks];

  const gaps = schemaGaps(analysis.schema);
  const conflictIds = new Set(['seo.tech.robots', 'seo.tech.conflicts', 'seo.canonical']);
  const flags: AuditFlags = {
    live: doc.status.live,
    indexable: doc.status.live && !doc.robots.noIndex,
    intentionallyExcluded: doc.robots.noIndex,
    missingMetadata: doc.meta.titleSource !== 'seo' || doc.meta.descriptionSource !== 'seo',
    missingSchema: gaps.absent.length > 0,
    missingKeywords: doc.meta.keywords.length === 0,
    indexingConflict: checks.some(
      (check) => conflictIds.has(check.id) && (check.status === 'FAIL' || check.status === 'WARNING'),
    ),
  };

  return {
    engineVersion: SEO_ENGINE_VERSION,
    entityType: doc.entityType,
    entityId: doc.entityId,
    countryId: doc.country.id,
    kind: doc.kind,
    name: doc.name,
    path: doc.path,
    absoluteUrl: doc.absoluteUrl,
    editPath: doc.editPath,
    overall: overallScore({ seo: seo.score, aeo: aeo.score, geo: geo.score }),
    seo,
    aeo,
    geo,
    keywords: analysis.keywords,
    structuredData: analysis.schema,
    counts: countChecks(checks),
    flags,
  };
}

// ---------------------------------------------------------------------------
// The site as a whole
// ---------------------------------------------------------------------------

/**
 * How much each kind of URL counts towards the site score.
 *
 * Not a blind average: the home page and the product pages are what the site
 * exists to rank, and a hundred tag archives should not outweigh them.
 */
export const SITE_KIND_WEIGHTS: Record<SeoPageKind, number> = {
  homepage: 3,
  product: 2,
  page: 1.5,
  article: 1,
  category: 0.75,
  archive: 0.75,
  tag: 0.5,
};

export type SiteScoreRow = {
  kind: SeoPageKind;
  indexable: boolean;
  seoScore: number;
  aeoScore: number;
  geoScore: number;
  overallScore: number;
};

export type SiteScores = {
  overall: number;
  seo: number;
  aeo: number;
  geo: number;
  /** The URLs the scores are made of: live and indexable only. */
  counted: number;
};

/** Scores summed per kind of URL, as a database can add them up. */
export type SiteScoreTotals = {
  kind: SeoPageKind;
  count: number;
  seo: number;
  aeo: number;
  geo: number;
  overall: number;
};

/**
 * The site's scores from per-kind totals of its live, indexable URLs.
 *
 * Each URL counts by its kind's weight, so this is the same number
 * `siteScores` gives for the rows themselves — the dashboard adds the rows up
 * in the database instead of loading every one. Null when nothing is live.
 */
export function siteScoresFromTotals(groups: readonly SiteScoreTotals[]): SiteScores | null {
  let weight = 0;
  let counted = 0;
  const totals = { overall: 0, seo: 0, aeo: 0, geo: 0 };
  for (const group of groups) {
    if (group.count <= 0) continue;
    const w = SITE_KIND_WEIGHTS[group.kind] ?? 1;
    weight += w * group.count;
    counted += group.count;
    totals.overall += group.overall * w;
    totals.seo += group.seo * w;
    totals.aeo += group.aeo * w;
    totals.geo += group.geo * w;
  }
  if (counted === 0 || weight <= 0) return null;
  return {
    overall: clamp(totals.overall / weight),
    seo: clamp(totals.seo / weight),
    aeo: clamp(totals.aeo / weight),
    geo: clamp(totals.geo / weight),
    counted,
  };
}

/**
 * The site's scores, from its live, indexable URLs only.
 *
 * Drafts are not what visitors or search engines see, and a noindex page was
 * kept out of search on purpose, so neither moves the site's number. Each URL
 * is weighted by its kind. Null when nothing is live yet.
 */
export function siteScores(rows: readonly SiteScoreRow[]): SiteScores | null {
  const groups = new Map<SeoPageKind, SiteScoreTotals>();
  for (const row of rows) {
    if (!row.indexable) continue;
    const group = groups.get(row.kind) ?? { kind: row.kind, count: 0, seo: 0, aeo: 0, geo: 0, overall: 0 };
    group.count += 1;
    group.seo += row.seoScore;
    group.aeo += row.aeoScore;
    group.geo += row.geoScore;
    group.overall += row.overallScore;
    groups.set(row.kind, group);
  }
  return siteScoresFromTotals([...groups.values()]);
}

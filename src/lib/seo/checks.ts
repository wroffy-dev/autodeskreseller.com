import type { DocumentAnalysis } from './analysis';
import type {
  CheckCategory,
  CheckResult,
  CheckSeverity,
  CheckStatus,
  ScoreBreakdown,
  SeoDimension,
  SeoDocument,
  SeoFieldTarget,
  SeoPageKind,
} from './types';

/**
 * The check engine.
 *
 * A check is a small, self-describing rule: an id, a label, how many points it
 * is worth, which kinds of page it applies to, and an `evaluate` that looks at
 * one document and says how it did. SEO, AEO and GEO are three lists of these;
 * adding a check means adding an entry to a list, never touching this file.
 *
 * Scoring is plain arithmetic over the list. A pass earns the check's weight, a
 * fail earns nothing, a warning earns the share the check reports. INFO and
 * NOT_APPLICABLE earn nothing and cost nothing — they are not counted in the
 * points available, so a noindex page, or a check that does not fit the page,
 * never pulls a score down. The score is earned over available, as 0–100.
 */

export type CheckOutcome = {
  status: CheckStatus;
  /** Share of the check's points earned, for a WARNING. PASS is 1, FAIL 0. */
  ratio?: number;
  message: string;
  recommendation?: string | null;
  /** Overrides the check's own severity for this outcome. */
  severity?: CheckSeverity;
  target?: SeoFieldTarget;
};

export type SeoCheck = {
  id: string;
  dimension: SeoDimension;
  category: CheckCategory;
  label: string;
  /** Points the check is worth when it applies. */
  weight: number;
  /** How much a failure matters. */
  severity: CheckSeverity;
  applicableTo: readonly SeoPageKind[] | 'all';
  target?: SeoFieldTarget;
  evaluate: (doc: SeoDocument, analysis: DocumentAnalysis) => CheckOutcome;
};

export const KIND_LABELS: Record<SeoPageKind, string> = {
  homepage: 'home page',
  page: 'page',
  product: 'product page',
  article: 'article',
  category: 'category archive',
  tag: 'tag archive',
  archive: 'blog archive',
};

/** The kind with its indefinite article: "a page", "an article". */
export const A_KIND: Record<SeoPageKind, string> = {
  homepage: 'a home page',
  page: 'a page',
  product: 'a product page',
  article: 'an article',
  category: 'a category archive',
  tag: 'a tag archive',
  archive: 'a blog archive',
};

export const pass = (message: string): CheckOutcome => ({ status: 'PASS', message });

export const warn = (
  ratio: number,
  message: string,
  recommendation: string,
  extra: Partial<CheckOutcome> = {},
): CheckOutcome => ({ status: 'WARNING', ratio, message, recommendation, ...extra });

export const fail = (
  message: string,
  recommendation: string,
  extra: Partial<CheckOutcome> = {},
): CheckOutcome => ({ status: 'FAIL', message, recommendation, ...extra });

export const info = (message: string, recommendation: string | null = null): CheckOutcome => ({
  status: 'INFO',
  message,
  recommendation,
});

export const notApplicable = (message: string): CheckOutcome => ({
  status: 'NOT_APPLICABLE',
  message,
});

const round1 = (value: number) => Math.round(value * 10) / 10;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function applies(check: SeoCheck, kind: SeoPageKind): boolean {
  return check.applicableTo === 'all' || check.applicableTo.includes(kind);
}

export function evaluateCheck(
  check: SeoCheck,
  doc: SeoDocument,
  analysis: DocumentAnalysis,
): CheckResult {
  let outcome: CheckOutcome;
  if (!applies(check, doc.kind)) {
    outcome = notApplicable(`Not assessed on ${A_KIND[doc.kind]}.`);
  } else {
    try {
      outcome = check.evaluate(doc, analysis);
    } catch {
      // A check that cannot read the document says so rather than failing the
      // whole audit or silently awarding itself points.
      outcome = info('This check could not be evaluated for this page.');
    }
  }

  const scored = outcome.status === 'PASS' || outcome.status === 'WARNING' || outcome.status === 'FAIL';
  const ratio =
    outcome.status === 'PASS' ? 1 : outcome.status === 'WARNING' ? clamp(outcome.ratio ?? 0.5, 0, 1) : 0;

  return {
    id: check.id,
    dimension: check.dimension,
    category: check.category,
    label: check.label,
    status: outcome.status,
    severity: outcome.severity ?? check.severity,
    pointsAvailable: scored ? check.weight : 0,
    pointsEarned: scored ? round1(check.weight * ratio) : 0,
    message: outcome.message,
    recommendation: outcome.status === 'PASS' ? null : (outcome.recommendation ?? null),
    ...((outcome.target ?? check.target) ? { target: outcome.target ?? check.target } : {}),
  };
}

/** A score from its checks: earned over available, 0–100, never outside. */
export function scoreChecks(checks: CheckResult[]): ScoreBreakdown {
  const pointsAvailable = round1(checks.reduce((total, check) => total + check.pointsAvailable, 0));
  const pointsEarned = round1(checks.reduce((total, check) => total + check.pointsEarned, 0));
  const score = pointsAvailable > 0 ? Math.round((pointsEarned / pointsAvailable) * 100) : 0;
  return {
    score: clamp(score, 0, 100),
    maxScore: 100,
    pointsEarned,
    pointsAvailable,
    checks,
  };
}

export function runChecks(
  checks: readonly SeoCheck[],
  doc: SeoDocument,
  analysis: DocumentAnalysis,
): ScoreBreakdown {
  return scoreChecks(checks.map((check) => evaluateCheck(check, doc, analysis)));
}

/** Joins names for a message: "A", "A and B", "A, B and 2 more". */
export function listNames(names: readonly string[], limit = 3): string {
  const unique = [...new Set(names.filter(Boolean))];
  if (unique.length === 0) return '';
  if (unique.length === 1) return unique[0]!;
  if (unique.length <= limit) return `${unique.slice(0, -1).join(', ')} and ${unique[unique.length - 1]}`;
  return `${unique.slice(0, limit).join(', ')} and ${unique.length - limit} more`;
}

export const quote = (value: string, length = 70) => {
  const text = value.replace(/\s+/g, ' ').trim();
  return `“${text.length > length ? `${text.slice(0, length - 1).trimEnd()}…` : text}”`;
};

export const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

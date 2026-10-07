import type { CheckResult, SeoEntityType, SeoPageKind } from './types';

/**
 * How a score reads, and where a check is listed.
 *
 * Kept apart from the engine so the editor panels and the dashboard can label
 * scores without shipping every check to the browser.
 */

/** Shown wherever scores are, so nobody mistakes them for a search engine's own. */
export const SEO_DISCLAIMER =
  'SEO, AEO and GEO scores are internal indicators worked out from your site’s own content and configuration. AEO and GEO are content-readiness assessments: they do not measure real AI citations, Google rankings or guaranteed visibility, and none of these scores is issued by Google or an AI platform.';

export type ScoreState = 'poor' | 'needs-improvement' | 'good' | 'excellent';

export const SCORE_STATE_LABELS: Record<ScoreState, string> = {
  poor: 'Poor',
  'needs-improvement': 'Needs improvement',
  good: 'Good',
  excellent: 'Excellent',
};

/** 0–39 poor, 40–59 needs improvement, 60–79 good, 80–100 excellent. */
export function scoreState(score: number): ScoreState {
  if (score >= 80) return 'excellent';
  if (score >= 60) return 'good';
  if (score >= 40) return 'needs-improvement';
  return 'poor';
}

/** Where a check lands in the editor's Issues / Warnings / Suggestions / Passed. */
export function checkBucket(
  check: Pick<CheckResult, 'status' | 'severity'>,
): 'critical' | 'warning' | 'suggestion' | 'passed' | 'info' | 'na' {
  if (check.status === 'PASS') return 'passed';
  if (check.status === 'INFO') return 'info';
  if (check.status === 'NOT_APPLICABLE') return 'na';
  if (check.severity === 'suggestion') return 'suggestion';
  if (check.status === 'FAIL' && check.severity === 'critical') return 'critical';
  return 'warning';
}

export const PAGE_KIND_LABELS: Record<SeoPageKind, string> = {
  homepage: 'Home page',
  page: 'Page',
  product: 'Product',
  article: 'Article',
  category: 'Blog category',
  tag: 'Blog tag',
  archive: 'Blog archive',
};

export const KEYWORD_STATUS_LABELS = {
  strong: 'Strong',
  good: 'Good',
  weak: 'Weak',
  missing: 'Missing',
  overused: 'Overused',
} as const;

// ---------------------------------------------------------------------------
// Audit links
// ---------------------------------------------------------------------------

const ENTITY_SLUGS: Record<SeoEntityType, string> = {
  PAGE: 'page',
  PRODUCT_MARKET: 'product',
  BLOG_POST: 'post',
  BLOG_CATEGORY: 'category',
  BLOG_TAG: 'tag',
  BLOG_ARCHIVE: 'archive',
};

export function entityTypeFromSlug(slug: string): SeoEntityType | null {
  const match = Object.entries(ENTITY_SLUGS).find(([, value]) => value === slug);
  return match ? (match[0] as SeoEntityType) : null;
}

/** Where a URL's content is edited in the admin. */
export function editPathFor(type: SeoEntityType, id: string): string {
  switch (type) {
    case 'PAGE':
      return `/admin/pages/${id}`;
    case 'PRODUCT_MARKET':
      return `/admin/products/${id}`;
    case 'BLOG_POST':
      return `/admin/blog/${id}`;
    case 'BLOG_CATEGORY':
      return '/admin/blog/categories';
    case 'BLOG_TAG':
      return '/admin/blog/tags';
    case 'BLOG_ARCHIVE':
      return '/admin/blog/design';
  }
}

/** The full audit of one URL. A product is audited per market, so it names one. */
export function auditHref(ref: { type: SeoEntityType; id: string; countryId?: string | null }): string {
  const base = `/admin/seo-intelligence/${ENTITY_SLUGS[ref.type]}/${encodeURIComponent(ref.id)}`;
  return ref.type === 'PRODUCT_MARKET' && ref.countryId
    ? `${base}?market=${encodeURIComponent(ref.countryId)}`
    : base;
}

/**
 * The vocabulary of the URL registry, shared by the server and the admin UI.
 *
 * Plain values only — no Prisma import — so client components can use the
 * labels and defaults without pulling the database client into the browser.
 */

export const URL_CONTENT_TYPES = [
  'PAGE',
  'CATEGORY_PAGE',
  'BRAND_PAGE',
  'PRODUCT',
  'BLOG_POST',
  'BLOG_CATEGORY',
  'BLOG_TAG',
  'BLOG_ARCHIVE',
] as const;

export type UrlContentType = (typeof URL_CONTENT_TYPES)[number];

export const URL_TYPE_LABELS: Record<UrlContentType, string> = {
  PAGE: 'Page',
  CATEGORY_PAGE: 'Category page',
  BRAND_PAGE: 'Brand page',
  PRODUCT: 'Product',
  BLOG_POST: 'Blog post',
  BLOG_CATEGORY: 'Blog category',
  BLOG_TAG: 'Blog tag',
  BLOG_ARCHIVE: 'Blog archive',
};

/**
 * The address each type had before the registry existed, as a pattern.
 *
 * These are the global defaults until an administrator saves a different one,
 * which is why switching the registry on changes no URL: every piece of content
 * starts exactly where it already was.
 *
 * A page's pattern is its own path — pages have always been addressed by
 * whatever path the editor gave them — so it is not configurable.
 */
export const DEFAULT_PATTERNS: Record<UrlContentType, string> = {
  PAGE: '/{slug}',
  CATEGORY_PAGE: '/categories/{slug}',
  BRAND_PAGE: '/brands/{slug}',
  PRODUCT: '/products/{slug}',
  BLOG_POST: '/blog/{slug}',
  BLOG_CATEGORY: '/blog/category/{slug}',
  BLOG_TAG: '/blog/tag/{slug}',
  BLOG_ARCHIVE: '/blog',
};

/** Types whose pattern an administrator can change. */
export const PATTERN_TYPES: readonly UrlContentType[] = [
  'PRODUCT',
  'CATEGORY_PAGE',
  'BRAND_PAGE',
  'BLOG_POST',
  'BLOG_CATEGORY',
  'BLOG_TAG',
  'BLOG_ARCHIVE',
];

/**
 * The blog lives at the site root only: one archive, one set of articles,
 * categories and tags, linked from every market. These types are registered
 * in the root market alone.
 */
export const ROOT_ONLY_TYPES: ReadonlySet<UrlContentType> = new Set([
  'BLOG_POST',
  'BLOG_CATEGORY',
  'BLOG_TAG',
  'BLOG_ARCHIVE',
]);

/** Content that is a CMS page, whose slug is its path within its market. */
export const PAGE_TYPES: ReadonlySet<UrlContentType> = new Set(['PAGE', 'CATEGORY_PAGE', 'BRAND_PAGE']);

export function isPageType(type: UrlContentType): boolean {
  return PAGE_TYPES.has(type);
}

/** Types whose pattern has no `{slug}`. */
export const SLUGLESS_TYPES: ReadonlySet<UrlContentType> = new Set(['BLOG_ARCHIVE']);

/** The blog archive's entity id: there is exactly one archive. */
export const BLOG_ARCHIVE_ID = 'blog';

export type UrlRouteModeValue = 'PATTERN' | 'CUSTOM';

/** How a piece of content's liveness reads in the manager. */
export type UrlPublicationState = 'live' | 'scheduled' | 'draft' | 'archived' | 'hidden';

export const PUBLICATION_LABELS: Record<UrlPublicationState, string> = {
  live: 'Published',
  scheduled: 'Scheduled',
  draft: 'Draft',
  archived: 'Archived',
  hidden: 'Hidden',
};

/** Which permission edits the content itself, per type — checked with seo.manage. */
export const CONTENT_EDIT_PERMISSION: Record<UrlContentType, string> = {
  PAGE: 'pages.edit',
  CATEGORY_PAGE: 'pages.edit',
  BRAND_PAGE: 'pages.edit',
  PRODUCT: 'products.edit',
  BLOG_POST: 'blog.edit',
  BLOG_CATEGORY: 'blog.categories',
  BLOG_TAG: 'blog.tags',
  BLOG_ARCHIVE: 'blog.design',
};

/**
 * Redirect status codes as they are actually sent.
 *
 * Redirects are issued with Next.js's own helpers, which answer 308 for a
 * permanent move and 307 for a temporary one. Both keep the request method,
 * and search engines treat 308 exactly like 301 — but the labels say what is
 * sent, not what is conventional.
 */
export const REDIRECT_STATUS = { PERMANENT: 308, TEMPORARY: 307 } as const;

export const REDIRECT_TYPE_LABELS = {
  PERMANENT: '308 Permanent',
  TEMPORARY: '307 Temporary',
} as const;

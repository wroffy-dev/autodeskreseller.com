import { countryPath } from '@/lib/country/routing';
import { fillPattern, joinMarket } from './path';
import {
  currentUrlSnapshot,
  entityKey,
  resolvePattern,
  type UrlSnapshot,
} from './snapshot';
import { BLOG_ARCHIVE_ID, DEFAULT_PATTERNS, ROOT_ONLY_TYPES, type UrlContentType } from './types';

/**
 * The one way a public URL is built.
 *
 * Every link to a piece of content — a product card, a menu item, a
 * breadcrumb, a canonical tag, a sitemap entry — comes from here, keyed by
 * the content's stable id and market. The registered address wins; where
 * there is none (the registry is switched off, or a snapshot has not been
 * loaded in this process) the address is built from the patterns, which by
 * default are exactly the addresses the site has always used.
 *
 * Blog content is root-only: whatever market a link is rendered in, it points
 * at the one root address, never at a prefixed copy that would only redirect.
 */

type MarketLike = { id: string; slug: string; isDefault?: boolean };
type SlugRef = { id: string; slug: string };

/** Placeholder market for root-only content, whose market is looked up. */
const ROOT: MarketLike = { id: '', slug: '' };

function snapshot(): UrlSnapshot | null {
  const snap = currentUrlSnapshot();
  return snap?.enabled ? snap : null;
}

function rootMarket(snap: UrlSnapshot | null): { id: string | null; slug: string } {
  if (!snap) return { id: null, slug: '' };
  const root = snap.countries.find((country) => country.isDefault);
  return { id: root?.id ?? snap.rootCountryId, slug: root?.slug ?? '' };
}

/** The address of any registered content, built from its pattern when unregistered. */
export function contentHref(
  type: UrlContentType,
  country: MarketLike,
  ref: SlugRef,
): string {
  const snap = snapshot();

  if (ROOT_ONLY_TYPES.has(type)) {
    const root = rootMarket(snap);
    if (snap && root.id) {
      const registered = snap.routes.get(entityKey(ref.id, root.id));
      if (registered) return registered.path;
    }
    const pattern = resolvePattern(snap, type, root.id);
    return joinMarket(root.slug, type === 'BLOG_ARCHIVE' ? pattern : fillPattern(pattern, ref.slug));
  }

  if (snap) {
    const registered = snap.routes.get(entityKey(ref.id, country.id));
    if (registered) return registered.path;
  }

  if (type === 'PAGE' || type === 'CATEGORY_PAGE' || type === 'BRAND_PAGE') {
    // A page's slug is its path within its market.
    return countryPath(country, ref.slug);
  }
  const pattern = snap ? resolvePattern(snap, type, country.id) : DEFAULT_PATTERNS[type];
  return joinMarket(country.slug, fillPattern(pattern, ref.slug));
}

export const productHref = (country: MarketLike, product: SlugRef) =>
  contentHref('PRODUCT', country, product);

export const pageHref = (country: MarketLike, page: SlugRef) =>
  contentHref('PAGE', country, page);

export const postHref = (post: SlugRef) => contentHref('BLOG_POST', ROOT, post);

export const blogCategoryHref = (category: SlugRef) =>
  contentHref('BLOG_CATEGORY', ROOT, category);

export const blogTagHref = (tag: SlugRef) => contentHref('BLOG_TAG', ROOT, tag);

export const blogArchiveHref = () =>
  contentHref('BLOG_ARCHIVE', ROOT, { id: BLOG_ARCHIVE_ID, slug: '' });

// ---------------------------------------------------------------------------
// Links an editor typed
// ---------------------------------------------------------------------------

/**
 * Re-exported from the snapshot module, where they live so the routing
 * engine can use them without importing this module.
 */
export {
  currentRegisteredLink as registeredLink,
  isRootOnlyPath as isRootOnlyLink,
} from './snapshot';

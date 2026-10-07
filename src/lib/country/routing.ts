import type { CountryContext } from './types';
import { RESERVED_SEGMENTS, isReservedSegment } from './reserved';
import { currentRegisteredLink, isRootOnlyPath, urlRegistryActive } from '@/lib/urls/snapshot';

/**
 * The country routing engine.
 *
 * Everything in this module is pure and free of Next.js and Prisma, so the
 * rules that decide "which market is this URL in?" and "what does this link
 * look like in that market?" can be unit-tested on their own and reused on the
 * server, in the browser and in the admin.
 *
 * Two invariants hold everywhere:
 *
 *   - the default market owns the site root, so its URLs never gain a prefix
 *     and the original single-country URLs keep working byte-for-byte;
 *   - a path whose first segment is a system route is never read as a market,
 *     so /admin, /api and the rest cannot be captured by a market prefix.
 */

export { RESERVED_SEGMENTS, isReservedSegment } from './reserved';

/**
 * Prefixes a market may not claim.
 *
 * A wider set than `RESERVED_SEGMENTS`, and deliberately not the same question.
 * `RESERVED_SEGMENTS` answers "is this URL a system path that must never be
 * market-prefixed?" — `/admin` is, `/products/dropbox-business` is not, because
 * a product page genuinely lives at `/ae/products/...`.
 *
 * This answers "may a market's prefix be this word?", and there `blog` and
 * `products` must be refused: both are literal segments in the app router, and
 * Next matches a literal route before a catch-all, so a market called
 * `products` would simply never resolve. Putting them in the routing set
 * instead would stop every product link being prefixed at all.
 */
const RESERVED_COUNTRY_PREFIXES: ReadonlySet<string> = new Set([
  ...RESERVED_SEGMENTS,
  'blog',
  'products',
]);

/**
 * The blog lives at the site root only. (With the URL registry switched on,
 * link generation asks the registry instead — the blog may have moved.)
 *
 * Articles are written once and are not per-market: there is one `/blog`, one
 * set of categories and one set of tags, and every market links to them. So a
 * blog path is never given a market prefix — `/ae/blog/x` would be a second URL
 * for the same article, which is duplicate content that splits its own ranking.
 *
 * This is the single test for "is this a blog URL", used by link generation,
 * by the redirect that retires the prefixed copies, and by the sitemaps.
 */
export function isBlogPath(path: string): boolean {
  return pathSegments(path)[0] === 'blog';
}

export function isReservedCountryPrefix(prefix: string): boolean {
  const value = prefix.trim().toLowerCase();
  if (!value) return false;
  return RESERVED_COUNTRY_PREFIXES.has(value) || value.includes('.');
}

/** Splits a pathname into clean, decoded segments. */
export function pathSegments(pathname: string): string[] {
  const withoutQuery = pathname.split(/[?#]/)[0] ?? '';
  return withoutQuery
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean);
}

/** Normalises a content path to the app's convention: leading slash, no trailing slash. */
export function normalisePath(path: string): string {
  const segments = pathSegments(path);
  return segments.length > 0 ? `/${segments.join('/')}` : '/';
}

/**
 * The public URL of `path` within `country`.
 *
 * ```
 * countryPath(india, 'dropbox-business') === '/dropbox-business'
 * countryPath(uae,   'dropbox-business') === '/ae/dropbox-business'
 * countryPath(qatar, 'dropbox-business') === '/qa/dropbox-business'
 * countryPath(uae,   '')                 === '/ae'
 * ```
 *
 * This is the only place a market prefix is ever written. Nothing else in the
 * codebase concatenates one.
 */
export function countryPath(country: Pick<CountryContext, 'slug'>, path = ''): string {
  const rest = pathSegments(path);
  const prefix = country.slug.trim().replace(/^\/+|\/+$/g, '');
  const all = prefix ? [prefix, ...rest] : rest;
  return all.length > 0 ? `/${all.join('/')}` : '/';
}

/**
 * Rewrites an internal link so it stays inside `country`.
 *
 * Left untouched: external URLs, anchors, query-only links, `mailto:`/`tel:`,
 * protocol-relative URLs, system routes, and any path that already carries a
 * market prefix. Everything else — the root-relative links an editor types
 * into a CTA — gains the current market's prefix.
 *
 * With the URL registry switched on, a link to an address the registry knows
 * is rendered at that content's current address in `country` (see below).
 * Otherwise, for the default market this is the identity function, which is
 * why the root market's rendered HTML is unchanged by the multi-market
 * conversion.
 */
export function countryHref(country: CountryContext, href: string | null | undefined): string {
  if (!href) return href ?? '';
  const value = href.trim();
  if (!value) return href;

  // Not an internal path: external, anchor, query, mailto/tel, or //host.
  if (!value.startsWith('/') || value.startsWith('//')) return href;

  const [pathPart = '', ...restParts] = value.split(/(?=[?#])/);
  const suffix = restParts.join('');
  const segments = pathSegments(pathPart);
  const first = segments[0];

  if (first && isReservedSegment(first)) return href;
  // Addressed to another market on purpose — the editor meant that market.
  if (first && first !== country.slug && country.prefixes.includes(first)) return href;

  /*
   * The URL registry knows the address: render where it is now, in this
   * market. A link to a page that has since moved goes straight to its new
   * address instead of through a redirect, and a root link rendered in the
   * UAE goes to the UAE's own address for the same content, whatever that
   * address is.
   */
  const registered = currentRegisteredLink(country, pathPart);
  if (registered) return `${registered}${suffix}`;

  if (country.isDefault || !country.slug) return href;
  /*
   * The blog is root-only, so a link to it stays root-relative in every
   * market. Prefixing it would produce a URL that only exists to redirect
   * back here — and a country navigation linking to the blog is exactly what
   * is wanted.
   */
  if (isRootOnlyPath(pathPart)) return href;
  // Already addressed to this market.
  if (first && first === country.slug) return href;

  const localised = countryPath(country, segments.join('/'));
  return `${localised}${suffix}`;
}

/**
 * Splits a public pathname into the market that owns it and the path within
 * that market.
 *
 * `countries` is the full configured list. Only active, non-default markets can
 * claim a prefix, so deactivating a market immediately stops its prefix
 * behaving like a storefront — `/qa/anything` then resolves in the default
 * market, where it will simply not be found.
 */
export function splitCountryPath(
  pathname: string,
  countries: readonly CountryContext[],
): { country: CountryContext | null; path: string; matchedPrefix: boolean } {
  const segments = pathSegments(pathname);
  const fallback = countries.find((c) => c.isDefault) ?? countries[0] ?? null;
  const first = segments[0];

  if (first && !isReservedSegment(first)) {
    const match = countries.find(
      (candidate) => candidate.slug !== '' && candidate.slug === first && candidate.isActive,
    );
    if (match) {
      return { country: match, path: normalisePath(segments.slice(1).join('/')), matchedPrefix: true };
    }
  }

  return { country: fallback, path: normalisePath(segments.join('/')), matchedPrefix: false };
}

/**
 * The content slug for a path: no leading slash, no trailing slash.
 * `""` is the homepage, matching `Page.slug`.
 */
export function contentSlug(path: string): string {
  return pathSegments(path).join('/');
}

/**
 * Deep-rewrites the internal links inside a stored CMS payload.
 *
 * Editors type plain paths (`/contact`, `/products/dropbox-business`) into
 * block content, and those paths must resolve inside the market the block is
 * rendered in. Rewriting here — once, at the render boundary — keeps every
 * block component free of market logic.
 *
 * For the default market the payload is returned by reference and nothing is
 * walked at all — unless the URL registry is on, when even the root market's
 * links are brought to their content's current address. System routes and
 * links addressed to another market are left alone by `countryHref`.
 */
export function localiseContent<T>(content: T, country: CountryContext): T {
  if ((country.isDefault || !country.slug) && !urlRegistryActive()) return content;
  return walk(content, country) as T;
}

/**
 * Rewrites the root-relative `href`/`src` attributes inside a fragment of
 * editor HTML so they resolve inside `country`.
 *
 * Rich text is the one place an internal link is not a field of its own, so it
 * gets the same treatment the structured fields get — and the same exemptions,
 * because every candidate still goes through `countryHref`.
 */
export function localiseHtml(html: string, country: CountryContext): string {
  if ((country.isDefault || !country.slug) && !urlRegistryActive()) return html;
  if (!html.includes('/')) return html;
  return html.replace(
    /\b(href|src)=("|')(\/[^"']*)\2/gi,
    (match, attribute: string, quote: string, url: string) =>
      `${attribute}=${quote}${countryHref(country, url)}${quote}`,
  );
}

function walk(value: unknown, country: CountryContext): unknown {
  if (typeof value === 'string') {
    // A root-relative path is localised directly; anything else is prose, which
    // may still carry markup links.
    if (value.startsWith('/')) return countryHref(country, value);
    return value.includes('<') ? localiseHtml(value, country) : value;
  }
  if (Array.isArray(value)) return value.map((item) => walk(item, country));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = walk(item, country);
    }
    return out;
  }
  return value;
}

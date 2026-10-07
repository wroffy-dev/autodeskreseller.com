import 'server-only';
import { cache } from 'react';
import { headers } from 'next/headers';
import { notFound, permanentRedirect, redirect } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { listCountries, resolveCountryPath } from '@/lib/country/registry';
import { contentSlug } from '@/lib/country/routing';
import type { CountryContext } from '@/lib/country/types';
import { blogSlugExists } from '@/lib/services/blog';
import { redirectOrNotFound } from '@/lib/services/redirects';
import { liveRoutePath } from './live';
import { getUrlSnapshot, isResolverEnabled } from './load';
import { keyFromSegments, pathKey, segmentsOf, stripMarket, withForwardedQuery, withSuffix } from './path';
import { afterResponse, countRedirectHit, recordNotFound } from './health';
import { ROOT_ONLY_TYPES, type UrlContentType } from './types';

/**
 * What a public address is.
 *
 * Every public route — the catch-all and the concrete `/products` and `/blog`
 * routes alike — asks this one function, so an address means the same thing
 * whichever route file happens to receive it. Redirects are decided here,
 * before anything is rendered: the route calls this at the top of the page,
 * where Next.js answers `permanentRedirect()` with a real 308 and a Location
 * header rather than a client-side navigation.
 *
 * With the registry switched on, the answer is one indexed lookup of the
 * address. With it off, the old routing rules are applied exactly as before,
 * which is what makes switching it on and off safe.
 */

export type PublicKind = 'page' | 'product' | 'post' | 'category' | 'tag' | 'blog';

export type PublicTarget = {
  kind: PublicKind;
  country: CountryContext;
  /** The content's stable id, or null when the old router found nothing. */
  id: string | null;
  /** The address being served, market prefix included. */
  path: string;
  /** Legacy mode only: the market-relative path to try redirects for when the content is missing. */
  fallbackPath: string | null;
  mode: 'registry' | 'legacy';
};

const KIND_OF: Record<UrlContentType, PublicKind> = {
  PAGE: 'page',
  CATEGORY_PAGE: 'page',
  BRAND_PAGE: 'page',
  PRODUCT: 'product',
  BLOG_POST: 'post',
  BLOG_CATEGORY: 'category',
  BLOG_TAG: 'tag',
  BLOG_ARCHIVE: 'blog',
};

async function referrer(): Promise<string | null> {
  try {
    return (await headers()).get('referer');
  } catch {
    return null;
  }
}

/** Answers 404 and records the address for URL Health, after the response. */
export async function notFoundAndRecord(path: string, countryId?: string | null): Promise<never> {
  const from = await referrer();
  afterResponse(() => recordNotFound(path, { countryId, referrer: from }));
  notFound();
}

/**
 * Resolves a public request. Returns what to render; redirects and 404s are
 * thrown, as Next.js expects.
 *
 * `path` is the request path as the router decoded it (`/ae/autocad`), and
 * `search` its query string, carried onto any redirect.
 */
export const resolvePublic = cache(async (path: string, search: string): Promise<PublicTarget> => {
  // Loading the snapshot here also refreshes it for the links this request
  // renders, before any of them is built.
  const [enabled] = await Promise.all([isResolverEnabled(), getUrlSnapshot()]);
  return enabled ? resolveThroughRegistry(path, search) : resolveLegacy(path);
});

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

async function resolveThroughRegistry(path: string, search: string): Promise<PublicTarget> {
  const segments = segmentsOf(path);
  const key = keyFromSegments(segments);
  if (!key) notFound();

  const countries = await listCountries();
  const claim = await prisma.urlRoute.findUnique({ where: { pathKey: key }, include: { redirect: true } });

  if (!claim) {
    await retiredBlogPrefix(key, countries, search);
    return notFoundAndRecord(key, marketOfKey(key, countries)?.id ?? null);
  }

  const country = countries.find((candidate) => candidate.id === claim.countryId);
  if (!country || (!country.isActive && !country.isDefault)) {
    return notFoundAndRecord(key, claim.countryId);
  }

  if (claim.kind === 'REDIRECT') {
    const rule = claim.redirect;
    if (!rule || !rule.isActive) return notFoundAndRecord(key, claim.countryId);

    let destination: string | null = rule.destination;
    if (rule.targetEntityId && rule.targetCountryId && rule.targetType) {
      const live = await liveRoutePath(
        rule.targetType as UrlContentType,
        rule.targetEntityId,
        rule.targetCountryId,
      );
      destination = live ? withSuffix(live, rule.destinationSuffix) : null;
    }
    // A redirect to content that is gone or not public answers 404: it never
    // reveals a draft's address and never sends a visitor to a dead end.
    if (!destination) return notFoundAndRecord(key, claim.countryId);
    if (pathKey(destination) === key) return notFoundAndRecord(key, claim.countryId);

    const id = rule.id;
    afterResponse(() => countRedirectHit(id));
    const location = withForwardedQuery(destination, new URLSearchParams(search));
    if (rule.type === 'PERMANENT') permanentRedirect(location);
    redirect(location);
  }

  // One address per piece of content: a different spelling of it — capitals,
  // a trailing slash — is sent to the canonical one.
  const requested = `/${segments.join('/')}`;
  if (requested !== claim.path) {
    permanentRedirect(withForwardedQuery(claim.path, new URLSearchParams(search)));
  }

  return {
    kind: KIND_OF[claim.type as UrlContentType],
    country,
    id: claim.entityId,
    path: claim.path,
    fallbackPath: null,
    mode: 'registry',
  };
}

function marketOfKey(key: string, countries: readonly CountryContext[]): CountryContext | undefined {
  const first = segmentsOf(key)[0];
  return countries.find((country) => country.slug && country.slug === first) ??
    countries.find((country) => country.isDefault);
}

/**
 * The blog is root-only. A market-prefixed blog address that nobody owns —
 * `/ae/blog/x`, which the site used to serve — is sent permanently to the
 * root address of the same article, category or tag when there is one.
 */
async function retiredBlogPrefix(
  key: string,
  countries: readonly CountryContext[],
  search: string,
): Promise<void> {
  const market = marketOfKey(key, countries);
  if (!market || market.isDefault || !market.slug) return;
  const rest = pathKey(stripMarket(market.slug, key));
  if (!rest || rest === '/') return;
  const root = countries.find((country) => country.isDefault);
  const claim = await prisma.urlRoute.findUnique({ where: { pathKey: rest }, include: { redirect: true } });
  if (
    claim?.kind === 'CONTENT' &&
    claim.type &&
    ROOT_ONLY_TYPES.has(claim.type as UrlContentType) &&
    claim.countryId === root?.id
  ) {
    permanentRedirect(withForwardedQuery(claim.path, new URLSearchParams(search)));
  }
  // The root address itself has moved since (`/blog/x` → `/insights/x`): go
  // straight to where the article lives now, not through a second redirect.
  const rule = claim?.redirect;
  if (
    rule?.isActive &&
    rule.targetType &&
    rule.targetEntityId &&
    rule.targetCountryId === root?.id &&
    ROOT_ONLY_TYPES.has(rule.targetType as UrlContentType)
  ) {
    const destination = await liveRoutePath(rule.targetType as UrlContentType, rule.targetEntityId, rule.targetCountryId);
    if (destination) permanentRedirect(withForwardedQuery(destination, new URLSearchParams(search)));
  }
}

// ---------------------------------------------------------------------------
// Legacy: the routing rules from before the registry, unchanged
// ---------------------------------------------------------------------------

type LegacySurface =
  | { kind: 'page'; slug: string }
  | { kind: 'blog' }
  | { kind: 'post'; slug: string }
  | { kind: 'category'; slug: string }
  | { kind: 'tag'; slug: string }
  | { kind: 'product'; slug: string }
  | { kind: 'missing' };

function classify(segments: string[]): LegacySurface {
  if (segments[0] === 'blog') {
    const [, second, third] = segments;
    if (segments.length === 1) return { kind: 'blog' };
    if (second === 'category') {
      return third && segments.length === 3 ? { kind: 'category', slug: third } : { kind: 'missing' };
    }
    if (second === 'tag') {
      return third && segments.length === 3 ? { kind: 'tag', slug: third } : { kind: 'missing' };
    }
    return second && segments.length === 2 ? { kind: 'post', slug: second } : { kind: 'missing' };
  }
  if (segments[0] === 'products') {
    const [, second] = segments;
    return second && segments.length === 2 ? { kind: 'product', slug: second } : { kind: 'missing' };
  }
  return { kind: 'page', slug: segments.join('/') };
}

const BLOG_KINDS = new Set(['blog', 'post', 'category', 'tag']);

async function resolveLegacy(path: string): Promise<PublicTarget> {
  const { country, path: within } = await resolveCountryPath(path);
  const slug = contentSlug(within);
  const surface = classify(slug ? slug.split('/') : []);

  // The blog is root-only; see `retiredBlogPrefix`.
  if (!country.isDefault && BLOG_KINDS.has(surface.kind)) {
    const target = await rootBlogEquivalent(surface);
    if (target) permanentRedirect(target);
    return notFoundAndRecord(path, country.id);
  }

  const base = { country, path, mode: 'legacy' as const };
  switch (surface.kind) {
    case 'blog':
      return { ...base, kind: 'blog', id: 'blog', fallbackPath: 'blog' };
    case 'post': {
      const post = await prisma.blogPost.findFirst({
        where: { countryId: country.id, slug: surface.slug, deletedAt: null },
        select: { id: true },
      });
      return { ...base, kind: 'post', id: post?.id ?? null, fallbackPath: `blog/${surface.slug}` };
    }
    case 'category': {
      const category = await prisma.blogCategory.findUnique({ where: { slug: surface.slug }, select: { id: true } });
      return { ...base, kind: 'category', id: category?.id ?? null, fallbackPath: `blog/category/${surface.slug}` };
    }
    case 'tag': {
      const tag = await prisma.blogTag.findUnique({ where: { slug: surface.slug }, select: { id: true } });
      return { ...base, kind: 'tag', id: tag?.id ?? null, fallbackPath: `blog/tag/${surface.slug}` };
    }
    case 'product': {
      const product = await prisma.product.findFirst({
        where: { slug: surface.slug, deletedAt: null },
        select: { id: true },
      });
      return { ...base, kind: 'product', id: product?.id ?? null, fallbackPath: `products/${surface.slug}` };
    }
    case 'page': {
      const page = await prisma.page.findFirst({
        where: { countryId: country.id, slug: surface.slug, deletedAt: null },
        select: { id: true },
      });
      return { ...base, kind: 'page', id: page?.id ?? null, fallbackPath: surface.slug };
    }
    default:
      return redirectOrNotFound(country, slug);
  }
}

async function rootBlogEquivalent(surface: LegacySurface): Promise<string | null> {
  switch (surface.kind) {
    case 'blog':
      return '/blog';
    case 'post':
      return (await blogSlugExists('post', surface.slug)) ? `/blog/${surface.slug}` : null;
    case 'category':
      return (await blogSlugExists('category', surface.slug)) ? `/blog/category/${surface.slug}` : null;
    case 'tag':
      return (await blogSlugExists('tag', surface.slug)) ? `/blog/tag/${surface.slug}` : null;
    default:
      return null;
  }
}

/**
 * What a surface does when the content it was given is not public: in the
 * registry, the address belongs to that content, so it is a 404; under the old
 * router, a redirect written for the address is followed first.
 */
export async function missingContent(target: PublicTarget): Promise<never> {
  if (target.mode === 'legacy' && target.fallbackPath !== null) {
    return redirectOrNotFound(target.country, target.fallbackPath);
  }
  return notFoundAndRecord(target.path, target.country.id);
}

/** A query string from the page's searchParams, for carrying onto redirects. */
export function searchString(params: Record<string, string | string[] | undefined>): string {
  const out = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) out.append(key, item);
  }
  return out.toString();
}

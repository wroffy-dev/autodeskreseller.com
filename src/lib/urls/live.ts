import 'server-only';
import { prisma } from '@/lib/db/prisma';
import { listCountries } from '@/lib/country/registry';
import { publishedPageWhere } from '@/lib/services/pages';
import { publishedPostWhere } from '@/lib/services/blog';
import { publishedProductWhere } from '@/lib/services/products';
import { loadContentInfo } from './content';
import { fillPattern, joinMarket, pathKey } from './path';
import { entityKey } from './snapshot';
import { DEFAULT_PATTERNS, ROOT_ONLY_TYPES, isPageType, type UrlContentType } from './types';

/**
 * Whether content is public, by the same rules its own page applies.
 *
 * A redirect only ever sends a visitor to content that is live: a redirect to
 * a draft answers 404 rather than disclosing where the draft will be, and a
 * redirect to deleted content answers 404 rather than sending anyone to a dead
 * end or, worse, the home page.
 */

/** The current address of content, or null unless the content is public. */
export async function liveRoutePath(
  type: UrlContentType,
  entityId: string,
  countryId: string,
): Promise<string | null> {
  const route = await prisma.urlRoute.findUnique({
    where: { entityId_countryId: { entityId, countryId } },
    select: { path: true, type: true },
  });
  if (!route) return null;
  return (await isLive((route.type as UrlContentType) ?? type, entityId, countryId)) ? route.path : null;
}

/** Whether content is public in a market, by the same rules its page uses. */
export async function isLive(type: UrlContentType, entityId: string, countryId: string): Promise<boolean> {
  switch (type) {
    case 'PAGE':
    case 'CATEGORY_PAGE':
    case 'BRAND_PAGE':
      return Boolean(
        await prisma.page.findFirst({
          where: { ...publishedPageWhere(), id: entityId, countryId },
          select: { id: true },
        }),
      );
    case 'PRODUCT':
      return Boolean(
        await prisma.productCountry.findFirst({
          where: { ...publishedProductWhere(countryId), productId: entityId },
          select: { id: true },
        }),
      );
    case 'BLOG_POST':
      return Boolean(
        await prisma.blogPost.findFirst({
          where: { ...publishedPostWhere(countryId), id: entityId },
          select: { id: true },
        }),
      );
    case 'BLOG_CATEGORY':
      return Boolean(await prisma.blogCategory.findUnique({ where: { id: entityId }, select: { id: true } }));
    case 'BLOG_TAG':
      return Boolean(await prisma.blogTag.findUnique({ where: { id: entityId }, select: { id: true } }));
    case 'BLOG_ARCHIVE':
      return true;
  }
}


// ---------------------------------------------------------------------------
// While the registry is switched off
// ---------------------------------------------------------------------------

/**
 * Where the previous router serves content — `/products/<slug>`,
 * `/blog/<slug>`, a page at its own path — or null unless it is public.
 *
 * Only used while the registry is switched off, which is the rollback: the
 * previous router serves content at these addresses whatever the registry
 * says, so that is where a redirect to the content has to go.
 */
export async function previousRouterPath(
  type: UrlContentType,
  entityId: string,
  countryId: string,
): Promise<string | null> {
  if (!(await isLive(type, entityId, countryId))) return null;
  const countries = await listCountries();
  const root = countries.find((country) => country.isDefault) ?? countries[0];
  const market = ROOT_ONLY_TYPES.has(type) ? root : countries.find((country) => country.id === countryId);
  if (!root || !market) return null;
  if (type === 'BLOG_ARCHIVE') return joinMarket(root.slug, DEFAULT_PATTERNS.BLOG_ARCHIVE);
  const info = (await loadContentInfo([{ type, entityId, countryId }], root.id)).get(entityKey(entityId, countryId));
  if (!info) return null;
  return isPageType(type)
    ? joinMarket(market.slug, `/${info.pageSlug ?? info.slug}`)
    : joinMarket(market.slug, fillPattern(DEFAULT_PATTERNS[type], info.slug));
}

/**
 * While the registry is switched off, where an address it gave out has gone.
 *
 * Addresses the registry handed out — `/autocad` for a product the previous
 * router serves at `/products/autocad` — would otherwise answer 404 for as
 * long as it stays off, although the content is still there. They lead to
 * the content's address under the previous router instead. Callers send them
 * there with a temporary redirect: switching the registry back on makes them
 * the real addresses again, and a cached permanent redirect would outlive that.
 */
export async function previousRouterAddressFor(path: string): Promise<string | null> {
  const key = pathKey(path);
  if (!key) return null;
  const claim = await prisma.urlRoute.findUnique({ where: { pathKey: key }, include: { redirect: true } });
  const target =
    claim?.kind === 'CONTENT' && claim.type && claim.entityId
      ? { type: claim.type as UrlContentType, entityId: claim.entityId, countryId: claim.countryId }
      : claim?.redirect?.isActive && claim.redirect.targetType && claim.redirect.targetEntityId && claim.redirect.targetCountryId
        ? {
            type: claim.redirect.targetType as UrlContentType,
            entityId: claim.redirect.targetEntityId,
            countryId: claim.redirect.targetCountryId,
          }
        : null;
  if (!target) return null;
  const destination = await previousRouterPath(target.type, target.entityId, target.countryId);
  return destination && pathKey(destination) !== key ? destination : null;
}

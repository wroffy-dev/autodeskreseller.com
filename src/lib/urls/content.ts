import 'server-only';
import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import type { CountryContext } from '@/lib/country/types';
import { fillPattern, joinMarket } from './path';
import { entityKey, resolvePattern, type UrlSnapshot } from './snapshot';
import {
  BLOG_ARCHIVE_ID,
  URL_TYPE_LABELS,
  type UrlContentType,
  type UrlPublicationState,
} from './types';

/**
 * What the registry knows about the content behind an address.
 *
 * Each content type keeps its own status rules — a page is live when it is
 * published and its publish date has passed, a product when that market's
 * configuration is, a blog category always (a hidden one keeps its URL) — and
 * this module is the one place those rules are read for URL purposes. It
 * loads in batches, one query per content type, never one per row.
 */

export type ContentInfo = {
  type: UrlContentType;
  entityId: string;
  countryId: string;
  label: string;
  /** The value `{slug}` takes in this content's pattern. */
  slug: string;
  state: UrlPublicationState;
  /** Whether the content has ever been public, which is what earns an old address a redirect. */
  wasPublished: boolean;
  editHref: string;
  /** Pages only: the page's own slug, which is its path within its market. */
  pageSlug?: string;
  /** Pages only: the city whose address space the page is in. */
  city?: { id: string; name: string } | null;
};

type PatternSource = Pick<UrlSnapshot, 'patterns'> | null;

/** The client to read with: a transaction's, so a save in progress is visible. */
export type Db = Prisma.TransactionClient | PrismaClient;

function publicationState(
  status: string,
  publishedAt: Date | null,
  now: Date,
): UrlPublicationState {
  if (status === 'PUBLISHED') return publishedAt && publishedAt > now ? 'scheduled' : 'live';
  if (status === 'SCHEDULED') return 'scheduled';
  if (status === 'ARCHIVED') return 'archived';
  return 'draft';
}

const everPublished = (status: string, publishedAt: Date | null, now: Date) =>
  (status === 'PUBLISHED' && (!publishedAt || publishedAt <= now)) ||
  (publishedAt !== null && publishedAt <= now);

function pageType(page: { landingCategoryId: string | null; landingBrandId: string | null }): UrlContentType {
  if (page.landingCategoryId) return 'CATEGORY_PAGE';
  if (page.landingBrandId) return 'BRAND_PAGE';
  return 'PAGE';
}

/** The market-relative path a piece of content gets from its pattern. */
export function patternRelativePath(
  info: Pick<ContentInfo, 'type' | 'slug' | 'countryId'>,
  patterns: PatternSource,
): string {
  const pattern = resolvePattern(patterns as UrlSnapshot | null, info.type, info.countryId);
  return info.type === 'BLOG_ARCHIVE' ? pattern : fillPattern(pattern, info.slug);
}

/** The full public path a piece of content gets from its pattern in its market. */
export function patternPath(
  info: Pick<ContentInfo, 'type' | 'slug' | 'countryId'>,
  patterns: PatternSource,
  countries: readonly Pick<CountryContext, 'id' | 'slug'>[],
): string {
  const market = countries.find((country) => country.id === info.countryId);
  return joinMarket(market?.slug ?? '', patternRelativePath(info, patterns));
}

type Scope = { countryId?: string; types?: readonly UrlContentType[]; rootCountryId: string };

const wants = (scope: Scope, ...types: UrlContentType[]) =>
  !scope.types || types.some((type) => scope.types!.includes(type));

/**
 * Every piece of content that should have a public address, with the facts
 * the registry needs about it.
 *
 * Pages and products are per market; blog content exists in the root market
 * only, because the blog is root-only — an article stored against another
 * market has never had an address of its own and is not given one here.
 */
export async function listRegistrableContent(scope: Scope, db: Db = prisma): Promise<ContentInfo[]> {
  const now = new Date();
  const inMarket = (countryId: string) => !scope.countryId || scope.countryId === countryId;
  const rootWanted = inMarket(scope.rootCountryId);

  const [pages, products, posts, categories, tags] = await Promise.all([
    wants(scope, 'PAGE', 'CATEGORY_PAGE', 'BRAND_PAGE')
      ? db.page.findMany({
          where: { deletedAt: null, ...(scope.countryId ? { countryId: scope.countryId } : {}) },
          select: {
            id: true,
            countryId: true,
            title: true,
            slug: true,
            status: true,
            publishedAt: true,
            landingCategoryId: true,
            landingBrandId: true,
            landingCategory: { select: { slug: true } },
            landingBrand: { select: { slug: true } },
            city: { select: { id: true, name: true } },
          },
        })
      : [],
    wants(scope, 'PRODUCT')
      ? db.productCountry.findMany({
          where: {
            deletedAt: null,
            product: { deletedAt: null },
            ...(scope.countryId ? { countryId: scope.countryId } : {}),
          },
          select: {
            countryId: true,
            status: true,
            publishedAt: true,
            product: { select: { id: true, name: true, slug: true } },
          },
        })
      : [],
    wants(scope, 'BLOG_POST') && rootWanted
      ? db.blogPost.findMany({
          where: { deletedAt: null, countryId: scope.rootCountryId },
          select: { id: true, title: true, slug: true, status: true, publishedAt: true },
        })
      : [],
    wants(scope, 'BLOG_CATEGORY') && rootWanted
      ? db.blogCategory.findMany({ select: { id: true, name: true, slug: true, isActive: true } })
      : [],
    wants(scope, 'BLOG_TAG') && rootWanted
      ? db.blogTag.findMany({ select: { id: true, name: true, slug: true, isActive: true } })
      : [],
  ]);

  const out: ContentInfo[] = [];

  for (const page of pages) {
    const type = pageType(page);
    if (scope.types && !scope.types.includes(type)) continue;
    out.push({
      type,
      entityId: page.id,
      countryId: page.countryId,
      label: page.title,
      slug:
        type === 'CATEGORY_PAGE'
          ? (page.landingCategory?.slug ?? page.slug)
          : type === 'BRAND_PAGE'
            ? (page.landingBrand?.slug ?? page.slug)
            : page.slug,
      state: publicationState(page.status, page.publishedAt, now),
      wasPublished: everPublished(page.status, page.publishedAt, now),
      editHref: `/admin/pages/${page.id}`,
      pageSlug: page.slug,
      city: page.city,
    });
  }

  for (const row of products) {
    out.push({
      type: 'PRODUCT',
      entityId: row.product.id,
      countryId: row.countryId,
      label: row.product.name,
      slug: row.product.slug,
      state: publicationState(row.status, row.publishedAt, now),
      wasPublished: everPublished(row.status, row.publishedAt, now),
      editHref: `/admin/products/${row.product.id}`,
    });
  }

  for (const post of posts) {
    out.push({
      type: 'BLOG_POST',
      entityId: post.id,
      countryId: scope.rootCountryId,
      label: post.title,
      slug: post.slug,
      state: publicationState(post.status, post.publishedAt, now),
      wasPublished: everPublished(post.status, post.publishedAt, now),
      editHref: `/admin/blog/${post.id}`,
    });
  }

  for (const category of categories) {
    out.push({
      type: 'BLOG_CATEGORY',
      entityId: category.id,
      countryId: scope.rootCountryId,
      label: category.name,
      slug: category.slug,
      // A hidden category keeps its archive URL working; it is only left out
      // of the category filters.
      state: category.isActive ? 'live' : 'hidden',
      wasPublished: true,
      editHref: '/admin/blog/categories',
    });
  }

  for (const tag of tags) {
    out.push({
      type: 'BLOG_TAG',
      entityId: tag.id,
      countryId: scope.rootCountryId,
      label: tag.name,
      slug: tag.slug,
      state: tag.isActive ? 'live' : 'hidden',
      wasPublished: true,
      editHref: '/admin/blog/tags',
    });
  }

  if (wants(scope, 'BLOG_ARCHIVE') && rootWanted) {
    out.push(blogArchiveInfo(scope.rootCountryId));
  }

  return out;
}

export function blogArchiveInfo(rootCountryId: string): ContentInfo {
  return {
    type: 'BLOG_ARCHIVE',
    entityId: BLOG_ARCHIVE_ID,
    countryId: rootCountryId,
    label: 'Blog archive',
    slug: '',
    state: 'live',
    wasPublished: true,
    editHref: '/admin/blog/layout',
  };
}

/**
 * The facts for specific content, by stable id and market.
 *
 * Batched by type. Content that no longer exists is simply absent from the
 * result, which callers treat as "deleted".
 */
export async function loadContentInfo(
  refs: ReadonlyArray<{ type: UrlContentType; entityId: string; countryId: string }>,
  rootCountryId: string,
  db: Db = prisma,
): Promise<Map<string, ContentInfo>> {
  const now = new Date();
  const ids = (types: UrlContentType[]) => [
    ...new Set(refs.filter((ref) => types.includes(ref.type)).map((ref) => ref.entityId)),
  ];

  const pageIds = ids(['PAGE', 'CATEGORY_PAGE', 'BRAND_PAGE']);
  const productIds = ids(['PRODUCT']);
  const postIds = ids(['BLOG_POST']);
  const categoryIds = ids(['BLOG_CATEGORY']);
  const tagIds = ids(['BLOG_TAG']);

  const [pages, products, posts, categories, tags] = await Promise.all([
    pageIds.length
      ? db.page.findMany({
          where: { id: { in: pageIds } },
          select: {
            id: true,
            countryId: true,
            title: true,
            slug: true,
            status: true,
            publishedAt: true,
            deletedAt: true,
            landingCategoryId: true,
            landingBrandId: true,
            landingCategory: { select: { slug: true } },
            landingBrand: { select: { slug: true } },
            city: { select: { id: true, name: true } },
          },
        })
      : [],
    productIds.length
      ? db.productCountry.findMany({
          where: { productId: { in: productIds } },
          select: {
            countryId: true,
            status: true,
            publishedAt: true,
            deletedAt: true,
            product: { select: { id: true, name: true, slug: true, deletedAt: true } },
          },
        })
      : [],
    postIds.length
      ? db.blogPost.findMany({
          where: { id: { in: postIds } },
          select: {
            id: true,
            countryId: true,
            title: true,
            slug: true,
            status: true,
            publishedAt: true,
            deletedAt: true,
          },
        })
      : [],
    categoryIds.length
      ? db.blogCategory.findMany({
          where: { id: { in: categoryIds } },
          select: { id: true, name: true, slug: true, isActive: true },
        })
      : [],
    tagIds.length
      ? db.blogTag.findMany({
          where: { id: { in: tagIds } },
          select: { id: true, name: true, slug: true, isActive: true },
        })
      : [],
  ]);

  const out = new Map<string, ContentInfo>();
  for (const page of pages) {
    if (page.deletedAt) continue;
    const type = pageType(page);
    out.set(entityKey(page.id, page.countryId), {
      type,
      entityId: page.id,
      countryId: page.countryId,
      label: page.title,
      slug:
        type === 'CATEGORY_PAGE'
          ? (page.landingCategory?.slug ?? page.slug)
          : type === 'BRAND_PAGE'
            ? (page.landingBrand?.slug ?? page.slug)
            : page.slug,
      state: publicationState(page.status, page.publishedAt, now),
      wasPublished: everPublished(page.status, page.publishedAt, now),
      editHref: `/admin/pages/${page.id}`,
      pageSlug: page.slug,
      city: page.city,
    });
  }
  for (const row of products) {
    if (row.deletedAt || row.product.deletedAt) continue;
    out.set(entityKey(row.product.id, row.countryId), {
      type: 'PRODUCT',
      entityId: row.product.id,
      countryId: row.countryId,
      label: row.product.name,
      slug: row.product.slug,
      state: publicationState(row.status, row.publishedAt, now),
      wasPublished: everPublished(row.status, row.publishedAt, now),
      editHref: `/admin/products/${row.product.id}`,
    });
  }
  for (const post of posts) {
    // The blog is root-only: an article stored against another market has no
    // public address, so it has no route either.
    if (post.deletedAt || post.countryId !== rootCountryId) continue;
    out.set(entityKey(post.id, rootCountryId), {
      type: 'BLOG_POST',
      entityId: post.id,
      countryId: rootCountryId,
      label: post.title,
      slug: post.slug,
      state: publicationState(post.status, post.publishedAt, now),
      wasPublished: everPublished(post.status, post.publishedAt, now),
      editHref: `/admin/blog/${post.id}`,
    });
  }
  for (const category of categories) {
    out.set(entityKey(category.id, rootCountryId), {
      type: 'BLOG_CATEGORY',
      entityId: category.id,
      countryId: rootCountryId,
      label: category.name,
      slug: category.slug,
      state: category.isActive ? 'live' : 'hidden',
      wasPublished: true,
      editHref: '/admin/blog/categories',
    });
  }
  for (const tag of tags) {
    out.set(entityKey(tag.id, rootCountryId), {
      type: 'BLOG_TAG',
      entityId: tag.id,
      countryId: rootCountryId,
      label: tag.name,
      slug: tag.slug,
      state: tag.isActive ? 'live' : 'hidden',
      wasPublished: true,
      editHref: '/admin/blog/tags',
    });
  }
  if (refs.some((ref) => ref.type === 'BLOG_ARCHIVE')) {
    out.set(entityKey(BLOG_ARCHIVE_ID, rootCountryId), blogArchiveInfo(rootCountryId));
  }
  return out;
}

/** "Product “AutoCAD LT”" — how an owner is named in a conflict message. */
export function describeOwner(info: Pick<ContentInfo, 'type' | 'label'>): string {
  return `${URL_TYPE_LABELS[info.type].toLowerCase()} “${info.label}”`;
}

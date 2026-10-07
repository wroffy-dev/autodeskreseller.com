import 'server-only';
import { cache } from 'react';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';

/**
 * Reading cities.
 *
 * The public side needs a city for two things — a city page's search fields
 * and the contact details its layout shows — and reads it by id or by the
 * first segment of the address, one indexed lookup each, cached per request.
 * The admin side lists and edits them.
 */

const CITY_PUBLIC_SELECT = {
  id: true,
  countryId: true,
  name: true,
  slug: true,
  region: true,
  isActive: true,
  isPublished: true,
  salesPhone: true,
  whatsappNumber: true,
  salesEmail: true,
  address: true,
  postalCode: true,
  latitude: true,
  longitude: true,
  seoTitle: true,
  seoDescription: true,
  primaryKeyword1: true,
  primaryKeyword2: true,
  primaryKeyword3: true,
  noIndex: true,
  excludeFromSitemap: true,
} satisfies Prisma.CitySelect;

export type PublicCity = Prisma.CityGetPayload<{ select: typeof CITY_PUBLIC_SELECT }>;

/** A city by id: the city a page belongs to. */
export const getCityById = cache(async (id: string): Promise<PublicCity | null> => {
  return prisma.city.findUnique({ where: { id }, select: CITY_PUBLIC_SELECT });
});

/**
 * The active city whose address space a market-relative path is in, or null.
 * An inactive city's pages answer 404, so its details are never shown.
 */
export const getActiveCityAt = cache(async (countryId: string, relativePath: string): Promise<PublicCity | null> => {
  const first = relativePath.split('/').find(Boolean)?.toLowerCase();
  if (!first) return null;
  const city = await prisma.city.findUnique({
    where: { countryId_slug: { countryId, slug: first } },
    select: CITY_PUBLIC_SELECT,
  });
  return city?.isActive ? city : null;
});

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export const CITY_STATUS_FILTERS = ['draft', 'published', 'archived', 'all', 'no-landing'] as const;
export type CityStatusFilter = (typeof CITY_STATUS_FILTERS)[number];

export type CityListFilters = {
  /** One market, or null for every market in `countryIds`. */
  countryId: string | null;
  /** The markets the user may see. */
  countryIds: readonly string[];
  q?: string;
  status?: string;
  page: number;
  perPage: number;
};

export type CityListRow = {
  id: string;
  name: string;
  slug: string;
  region: string | null;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  isActive: boolean;
  isPublished: boolean;
  noIndex: boolean;
  excludeFromSitemap: boolean;
  sortOrder: number;
  country: { id: string; name: string; code: string; slug: string };
  /** Live pages in the city, the landing page included. */
  pageCount: number;
  landing: { id: string; title: string; status: string } | null;
  /** SEO Intelligence's last overall score for the landing page, when it has one. */
  landingScore: number | null;
};

export async function listCities(filters: CityListFilters): Promise<{ rows: CityListRow[]; total: number }> {
  const where: Prisma.CityWhereInput = {
    countryId: filters.countryId ?? { in: [...filters.countryIds] },
  };
  const q = filters.q?.trim();
  if (q) {
    where.OR = [
      { name: { contains: q, mode: 'insensitive' } },
      { slug: { contains: q.toLowerCase() } },
      { region: { contains: q, mode: 'insensitive' } },
    ];
  }
  // Archived cities are out of the way unless asked for.
  switch (filters.status as CityStatusFilter | undefined) {
    case 'draft':
      where.status = 'DRAFT';
      break;
    case 'published':
      where.status = 'PUBLISHED';
      break;
    case 'archived':
      where.status = 'ARCHIVED';
      break;
    case 'all':
      break;
    case 'no-landing':
      where.status = { not: 'ARCHIVED' };
      where.pages = { none: { isCityHomepage: true, deletedAt: null } };
      break;
    default:
      where.status = { not: 'ARCHIVED' };
  }

  const [cities, total] = await Promise.all([
    prisma.city.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      skip: (filters.page - 1) * filters.perPage,
      take: filters.perPage,
      select: {
        id: true,
        name: true,
        slug: true,
        region: true,
        status: true,
        isActive: true,
        isPublished: true,
        noIndex: true,
        excludeFromSitemap: true,
        sortOrder: true,
        country: { select: { id: true, name: true, code: true, slug: true } },
        _count: { select: { pages: { where: { deletedAt: null } } } },
      },
    }),
    prisma.city.count({ where }),
  ]);

  const ids = cities.map((city) => city.id);
  const landings = ids.length
    ? await prisma.page.findMany({
        where: { cityId: { in: ids }, isCityHomepage: true, deletedAt: null },
        select: { id: true, cityId: true, title: true, status: true, countryId: true },
      })
    : [];
  const audits = landings.length
    ? await prisma.seoAudit.findMany({
        where: { entityType: 'PAGE', entityId: { in: landings.map((page) => page.id) } },
        select: { entityId: true, countryId: true, overallScore: true },
      })
    : [];

  const landingOf = new Map(landings.map((page) => [page.cityId!, page]));
  const scoreOf = new Map(audits.map((audit) => [`${audit.entityId}|${audit.countryId}`, audit.overallScore]));

  return {
    total,
    rows: cities.map((city) => {
      const landing = landingOf.get(city.id);
      return {
        id: city.id,
        name: city.name,
        slug: city.slug,
        region: city.region,
        status: city.status,
        isActive: city.isActive,
        isPublished: city.isPublished,
        noIndex: city.noIndex,
        excludeFromSitemap: city.excludeFromSitemap,
        sortOrder: city.sortOrder,
        country: city.country,
        pageCount: city._count.pages,
        landing: landing ? { id: landing.id, title: landing.title, status: landing.status } : null,
        landingScore: landing ? (scoreOf.get(`${landing.id}|${landing.countryId}`) ?? null) : null,
      };
    }),
  };
}

/** One city for its edit screen, with its market. */
export async function getCityForAdmin(id: string) {
  return prisma.city.findUnique({
    where: { id },
    include: { country: { select: { id: true, name: true, code: true, slug: true, isDefault: true } } },
  });
}

export type CityAdminDetail = NonNullable<Awaited<ReturnType<typeof getCityForAdmin>>>;

/** The city's live pages, landing page first, for its edit screen. */
export async function listCityPages(cityId: string, take = 100) {
  const [pages, total] = await Promise.all([
    prisma.page.findMany({
      where: { cityId, deletedAt: null },
      orderBy: [{ isCityHomepage: 'desc' }, { slug: 'asc' }],
      take,
      select: {
        id: true,
        title: true,
        slug: true,
        status: true,
        isCityHomepage: true,
        updatedAt: true,
        generatedAt: true,
        generatedFrom: { select: { id: true, title: true } },
      },
    }),
    prisma.page.count({ where: { cityId, deletedAt: null } }),
  ]);
  return { pages, total };
}

/** Last overall SEO scores for some pages, keyed by page id. */
export async function pageScores(pageIds: readonly string[]): Promise<Map<string, number>> {
  if (pageIds.length === 0) return new Map();
  const audits = await prisma.seoAudit.findMany({
    where: { entityType: 'PAGE', entityId: { in: [...pageIds] } },
    select: { entityId: true, overallScore: true },
  });
  return new Map(audits.map((audit) => [audit.entityId, audit.overallScore]));
}

/** The city's explicit city/product pages. */
export async function listCityProducts(cityId: string) {
  return prisma.cityProduct.findMany({
    where: { cityId },
    orderBy: { product: { name: 'asc' } },
    select: {
      productId: true,
      product: { select: { name: true, slug: true, deletedAt: true } },
      page: { select: { id: true, title: true, slug: true, status: true, deletedAt: true } },
    },
  });
}

/** Cities in markets the user may see, for pickers: the generator, the page list's filter. */
export async function listCityOptions(countryIds: readonly string[]) {
  if (countryIds.length === 0) return [];
  return prisma.city.findMany({
    where: { countryId: { in: [...countryIds] } },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: { id: true, name: true, slug: true, region: true, countryId: true, isActive: true, isPublished: true, status: true },
  });
}

/** The generator's recent runs in the markets the user may see. */
export async function listRecentBatches(countryIds: readonly string[], take = 10) {
  if (countryIds.length === 0) return [];
  return prisma.cityPageBatch.findMany({
    where: { countryId: { in: [...countryIds] } },
    orderBy: { createdAt: 'desc' },
    take,
    select: {
      id: true,
      sourceTitle: true,
      sourceSlug: true,
      sourcePageId: true,
      created: true,
      skipped: true,
      failed: true,
      actorEmail: true,
      createdAt: true,
      country: { select: { name: true, code: true } },
    },
  });
}

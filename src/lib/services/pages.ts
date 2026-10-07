import 'server-only';
import { cache } from 'react';
import { prisma } from '@/lib/db/prisma';
import type { Page, PageSection } from '@prisma/client';

export type PageWithSections = Page & { sections: PageSection[] };

/*
 * A page in a city is also subject to its city. The conditions sit under
 * `AND`, so a caller that adds its own `OR` cannot drop them by accident.
 */

/** Served: outside any city, or in an active one. An inactive city's pages answer 404. */
const CITY_SERVED = { OR: [{ cityId: null }, { city: { isActive: true } }] };

/** Indexable: an active city that does not ask search engines to stay away. */
const CITY_INDEXABLE = { OR: [{ cityId: null }, { city: { isActive: true, noIndex: false } }] };

/** Listed in sitemaps: an active, published city that is neither noindexed nor excluded. */
const CITY_LISTED = {
  OR: [
    { cityId: null },
    { city: { isActive: true, isPublished: true, noIndex: false, excludeFromSitemap: false } },
  ],
};

/**
 * Only content that is genuinely live is ever returned to a public request.
 *
 * This must be a function: a module-level constant would freeze `new Date()` at
 * import time, so anything published after the server started would stay hidden
 * until the process restarted.
 */
export function publishedPageWhere() {
  return {
    deletedAt: null,
    status: 'PUBLISHED' as const,
    OR: [{ publishedAt: null }, { publishedAt: { lte: new Date() } }],
    AND: [CITY_SERVED],
  };
}

/** Live and open to search engines: what hreflang may point at. */
export function indexablePageWhere() {
  return { ...publishedPageWhere(), noIndex: false, AND: [CITY_INDEXABLE] };
}

/**
 * Live, indexable and meant for the sitemap. A market's own publication and
 * sitemap switches are applied by the sitemap per market; a city's are here,
 * because they are per page.
 */
export function listedPageWhere() {
  return { ...publishedPageWhere(), noIndex: false, AND: [CITY_LISTED] };
}

/**
 * A published page in one market.
 *
 * The market is part of the lookup, never inferred: `/dropbox-business` and
 * `/ae/dropbox-business` are two independent pages that happen to share a slug,
 * and a missing UAE page must 404 rather than silently fall back to India's.
 */
export const getPublishedPage = cache(
  async (countryId: string, slug: string): Promise<PageWithSections | null> => {
    return prisma.page.findFirst({
      where: { ...publishedPageWhere(), countryId, slug },
      include: { sections: { orderBy: { sortOrder: 'asc' } } },
    });
  },
);

/**
 * A published page by its stable id, in the market it belongs to.
 *
 * What the URL registry resolves to: an address names a page by id, so the
 * page is found the same way whatever its slug is today.
 */
export const getPublishedPageById = cache(
  async (countryId: string, id: string): Promise<PageWithSections | null> => {
    return prisma.page.findFirst({
      where: { ...publishedPageWhere(), countryId, id },
      include: { sections: { orderBy: { sortOrder: 'asc' } } },
    });
  },
);

/** Preview bypasses the publish gate. Callers must check authorisation first. */
export const getPageForPreview = cache(async (id: string): Promise<PageWithSections | null> => {
  return prisma.page.findFirst({
    where: { id, deletedAt: null },
    include: { sections: { orderBy: { sortOrder: 'asc' } } },
  });
});

/**
 * Whether an equivalent page is live in another market.
 *
 * Used by the market switcher and by hreflang, both of which must only ever
 * point at content that actually exists and is published.
 */
export const findPublishedPageCountries = cache(
  async (slug: string): Promise<string[]> => {
    const rows = await prisma.page.findMany({
      where: { ...indexablePageWhere(), slug },
      select: { countryId: true },
    });
    return rows.map((row) => row.countryId);
  },
);

/** Markets where this page exists and is published, ignoring robots directives. */
export const findLivePageCountries = cache(async (slug: string): Promise<string[]> => {
  const rows = await prisma.page.findMany({
    where: { ...publishedPageWhere(), slug },
    select: { countryId: true },
  });
  return rows.map((row) => row.countryId);
});

import 'server-only';
import { prisma } from '@/lib/db/prisma';
import { listActiveCountries } from '@/lib/country/registry';
import { indexablePageWhere, publishedPageWhere } from '@/lib/services/pages';
import { pageHref, productHref } from './links';

/**
 * The same content in other markets, with each market's own address.
 *
 * Found by identity — the same product, or the same page group — so a market
 * whose URL differs (`/autocad` at the root, `/ae/software/autocad-lt`
 * in the UAE) is still recognised as the equivalent. Used for hreflang and the
 * market switcher; only content that is actually public is ever offered.
 */

export type Alternate = { countryId: string; path: string };

/** Markets where a product is on sale, and its address in each. */
export async function productAlternates(product: { id: string; slug: string }): Promise<Alternate[]> {
  const [rows, countries] = await Promise.all([
    prisma.productCountry.findMany({
      where: {
        productId: product.id,
        deletedAt: null,
        status: 'PUBLISHED',
        OR: [{ publishedAt: null }, { publishedAt: { lte: new Date() } }],
        product: { deletedAt: null },
      },
      select: { countryId: true },
    }),
    listActiveCountries(),
  ]);
  return rows.flatMap((row) => {
    const country = countries.find((candidate) => candidate.id === row.countryId);
    return country ? [{ countryId: country.id, path: productHref(country, product) }] : [];
  });
}

/**
 * Markets where the same page is published, and its address in each.
 *
 * `indexableOnly` leaves out pages asking not to be indexed, which is what
 * hreflang wants; the market switcher wants every published page.
 */
export async function pageAlternates(
  page: { id: string; slug: string; groupKey: string | null },
  { indexableOnly }: { indexableOnly: boolean },
): Promise<Alternate[]> {
  const [rows, countries] = await Promise.all([
    prisma.page.findMany({
      where: {
        ...(indexableOnly ? indexablePageWhere() : publishedPageWhere()),
        // Pages grouped since the registry's first scan are matched by group;
        // anything not yet grouped falls back to the old rule, the same slug.
        ...(page.groupKey ? { groupKey: page.groupKey } : { slug: page.slug }),
      },
      select: { id: true, slug: true, countryId: true },
    }),
    listActiveCountries(),
  ]);
  return rows.flatMap((row) => {
    const country = countries.find((candidate) => candidate.id === row.countryId);
    return country ? [{ countryId: country.id, path: pageHref(country, row) }] : [];
  });
}

import 'server-only';
import { cache } from 'react';
import { prisma } from '@/lib/db/prisma';
import { decimalToString } from '@/lib/utils/money';
import { countryHref, localiseHtml } from '@/lib/country/routing';
import { productHref } from '@/lib/urls/links';
import type { CountryContext } from '@/lib/country/types';
import type { Prisma } from '@prisma/client';

/**
 * Products, resolved for one market.
 *
 * `Product` stays the global master — a product's identity, SKU, brand,
 * category, shared specification and imagery are the same everywhere. What a
 * market owns is whether the product is on sale there, what it costs, in which
 * currency, its local copy, its call to action and its SEO; all of that lives
 * in `ProductCountry`.
 *
 * Money is never converted at render time. A price is whatever an administrator
 * entered for that market, in that market's currency, because a rate-derived
 * price would change under the visitor and could not be quoted.
 */

export type PublicProduct = {
  id: string;
  name: string;
  slug: string;
  /** The product's URL inside the market it was resolved for. */
  href: string;
  sku: string | null;
  shortDescription: string | null;
  description: string | null;
  storage: string | null;
  minUsers: number | null;
  maxUsers: number | null;
  currency: string;
  monthlyPrice: string | null;
  annualPrice: string | null;
  compareAtPrice: string | null;
  discountPercent: number | null;
  priceSuffix: string | null;
  priceNote: string | null;
  isFeatured: boolean;
  features: string[];
  benefits: string[];
  specs: Array<{ label: string; value: string }>;
  ctaLabel: string;
  ctaUrl: string | null;
  ctaFormSlug: string | null;
  imageUrl: string | null;
  imageAlt: string | null;
  galleryIds: string[];
  categoryName: string | null;
  categorySlug: string | null;
  /** Carried so a block can ask for "other products in this category". */
  categoryId: string | null;
  brandName: string | null;
  brandSlug: string | null;
  brandId: string | null;
};

const productSelect = {
  id: true,
  name: true,
  slug: true,
  sku: true,
  shortDescription: true,
  description: true,
  storage: true,
  minUsers: true,
  maxUsers: true,
  currency: true,
  monthlyPrice: true,
  annualPrice: true,
  compareAtPrice: true,
  discountPercent: true,
  priceSuffix: true,
  priceNote: true,
  features: true,
  benefits: true,
  specs: true,
  ctaLabel: true,
  ctaUrl: true,
  ctaForm: { select: { slug: true, isActive: true } },
  image: { select: { url: true, altText: true } },
  galleryIds: true,
  category: { select: { id: true, name: true, slug: true, deletedAt: true } },
  brand: { select: { id: true, name: true, slug: true, deletedAt: true } },
} satisfies Prisma.ProductSelect;

/**
 * A category or brand as visitors may see it. One in the recycle bin keeps
 * its products pointing at it, so restoring it reconnects them — but while it
 * is deleted it is not shown, linked or described in structured data.
 */
function shownTaxonomy<T extends { deletedAt: Date | null }>(row: T | null): T | null {
  return row && !row.deletedAt ? row : null;
}

const countrySelect = {
  id: true,
  countryId: true,
  isFeatured: true,
  sortOrder: true,
  featuredOrder: true,
  currency: true,
  monthlyPrice: true,
  annualPrice: true,
  compareAtPrice: true,
  discountPercent: true,
  priceSuffix: true,
  priceNote: true,
  shortDescription: true,
  description: true,
  ctaLabel: true,
  ctaUrl: true,
  ctaForm: { select: { slug: true, isActive: true } },
  product: { select: productSelect },
} satisfies Prisma.ProductCountrySelect;

type ProductCountryRow = Prisma.ProductCountryGetPayload<{ select: typeof countrySelect }>;

function toStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((v) => String(v)).filter(Boolean);
}

function toSpecs(raw: unknown): Array<{ label: string; value: string }> {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s): s is { label?: unknown; value?: unknown } => typeof s === 'object' && s !== null)
    .map((s) => ({ label: String(s.label ?? ''), value: String(s.value ?? '') }))
    .filter((s) => s.label);
}

const pick = (local: string | null, global: string | null): string | null => {
  const trimmed = local?.trim();
  return trimmed ? local : global;
};

/** A stored URL, resolved inside the market being rendered. */
const localiseUrl = (value: string | null, country: CountryContext): string | null =>
  value ? countryHref(country, value) : value;

/** Prose, with any links inside it resolved inside the market being rendered. */
const localise = (value: string | null, country: CountryContext): string | null =>
  value ? localiseHtml(value, country) : value;

/**
 * Merges a market's configuration over the global product.
 *
 * Copy falls back to the master record, so a market that has nothing to say
 * about a product still shows a complete page. Money never falls back: an empty
 * AED price shows the market's price note, never India's rupee figure.
 */
export function toPublicProduct(row: ProductCountryRow, country: CountryContext): PublicProduct {
  const product = row.product;
  const ctaForm = row.ctaForm?.isActive ? row.ctaForm : product.ctaForm?.isActive ? product.ctaForm : null;

  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    href: productHref(country, product),
    sku: product.sku,
    // Copy can carry links the editor typed by hand, and a market's page must
    // not send its visitor into another market's.
    shortDescription: localise(pick(row.shortDescription, product.shortDescription), country),
    description: localise(pick(row.description, product.description), country),
    storage: product.storage,
    minUsers: product.minUsers,
    maxUsers: product.maxUsers,
    currency: row.currency || country.currency,
    monthlyPrice: decimalToString(row.monthlyPrice),
    annualPrice: decimalToString(row.annualPrice),
    compareAtPrice: decimalToString(row.compareAtPrice),
    discountPercent: row.discountPercent,
    priceSuffix: pick(row.priceSuffix, product.priceSuffix),
    priceNote: pick(row.priceNote, product.priceNote),
    isFeatured: row.isFeatured,
    features: toStringArray(product.features),
    benefits: toStringArray(product.benefits),
    specs: toSpecs(product.specs),
    ctaLabel: pick(row.ctaLabel, product.ctaLabel) || 'Get Started',
    /*
     * The configured CTA is a link like any other. `href` above is built for
     * this market; a hand-typed `/contact` has to be too, or the button walks
     * the visitor out of the market they are reading.
     */
    ctaUrl: localiseUrl(pick(row.ctaUrl, product.ctaUrl), country),
    ctaFormSlug: ctaForm?.slug ?? null,
    imageUrl: product.image?.url ?? null,
    imageAlt: product.image?.altText ?? product.name,
    galleryIds: toStringArray(product.galleryIds),
    categoryName: shownTaxonomy(product.category)?.name ?? null,
    categorySlug: shownTaxonomy(product.category)?.slug ?? null,
    categoryId: shownTaxonomy(product.category)?.id ?? null,
    brandName: shownTaxonomy(product.brand)?.name ?? null,
    brandSlug: shownTaxonomy(product.brand)?.slug ?? null,
    brandId: shownTaxonomy(product.brand)?.id ?? null,
  };
}

/**
 * Evaluated per call so `new Date()` reflects the current request rather than
 * the moment the module was first imported.
 */
export function publishedProductWhere(countryId: string): Prisma.ProductCountryWhereInput {
  return {
    countryId,
    // Withdrawn from this market. The product may still be on sale elsewhere,
    // which is exactly why the flag is on the market's row and not the product.
    deletedAt: null,
    status: 'PUBLISHED',
    OR: [{ publishedAt: null }, { publishedAt: { lte: new Date() } }],
    product: { deletedAt: null },
  };
}

export type ProductSource = 'featured' | 'all' | 'category' | 'brand' | 'selected' | 'latest';

export type ProductSelection = {
  source: ProductSource;
  productIds?: string[];
  categoryId?: string | null;
  brandId?: string | null;
  limit?: number;
};

/**
 * Resolves the product-source configuration shared by every product block.
 *
 * Ordering is always explicit and admin-controlled, and it is now the market's
 * ordering: a plan can lead the UAE catalogue and sit third in India's.
 *  - hand-picked keeps the order the admin dragged them into;
 *  - featured uses the market's featured order;
 *  - everything else uses the market's catalogue sort order, never creation date.
 */
export const selectProducts = cache(
  async (country: CountryContext, selection: ProductSelection): Promise<PublicProduct[]> => {
    const take = Math.min(Math.max(selection.limit ?? 3, 1), 24);
    const base = publishedProductWhere(country.id);

    if (selection.source === 'selected') {
      const ids = selection.productIds ?? [];
      if (ids.length === 0) return [];
      const rows = await prisma.productCountry.findMany({
        where: { ...base, productId: { in: ids } },
        select: countrySelect,
      });
      // Preserve the admin's hand-picked order.
      const byId = new Map(rows.map((r) => [r.product.id, r]));
      return ids
        .map((id) => byId.get(id))
        .filter((r): r is ProductCountryRow => Boolean(r))
        .slice(0, take)
        .map((row) => toPublicProduct(row, country));
    }

    const where: Prisma.ProductCountryWhereInput = { ...base };
    if (selection.source === 'featured') where.isFeatured = true;
    if (selection.source === 'category' && selection.categoryId) {
      where.product = { deletedAt: null, categoryId: selection.categoryId };
    }
    if (selection.source === 'brand' && selection.brandId) {
      where.product = { deletedAt: null, brandId: selection.brandId };
    }

    const orderBy: Prisma.ProductCountryOrderByWithRelationInput[] =
      selection.source === 'latest'
        ? [{ publishedAt: 'desc' }, { createdAt: 'desc' }]
        : selection.source === 'featured'
          ? [{ featuredOrder: 'asc' }, { sortOrder: 'asc' }, { product: { name: 'asc' } }]
          : [{ sortOrder: 'asc' }, { product: { name: 'asc' } }];

    const rows = await prisma.productCountry.findMany({
      where,
      orderBy,
      take,
      select: countrySelect,
    });
    return rows.map((row) => toPublicProduct(row, country));
  },
);

export const getPublicProduct = cache(
  async (country: CountryContext, slug: string): Promise<PublicProduct | null> => {
    const row = await prisma.productCountry.findFirst({
      where: { ...publishedProductWhere(country.id), product: { deletedAt: null, slug } },
      select: countrySelect,
    });
    return row ? toPublicProduct(row, country) : null;
  },
);

/** A product on sale in a market, by the stable id the URL registry resolves to. */
export const getPublicProductById = cache(
  async (country: CountryContext, productId: string): Promise<PublicProduct | null> => {
    const row = await prisma.productCountry.findFirst({
      where: { ...publishedProductWhere(country.id), productId },
      select: countrySelect,
    });
    return row ? toPublicProduct(row, country) : null;
  },
);

/** The market-level SEO record for a product page, by product id. */
export const getProductSeoById = cache(async (countryId: string, productId: string) => {
  return prisma.productCountry.findFirst({
    where: { ...publishedProductWhere(countryId), productId },
    select: productSeoSelect,
  });
});

/** The market-level SEO record for a product page, without loading the product. */
const productSeoSelect = {
  seoTitle: true,
  seoDescription: true,
  canonicalUrl: true,
  noIndex: true,
  primaryKeyword1: true,
  primaryKeyword2: true,
  primaryKeyword3: true,
  ogImage: { select: { url: true } },
  product: {
    select: {
      id: true,
      name: true,
      slug: true,
      seoTitle: true,
      seoDescription: true,
      shortDescription: true,
      canonicalUrl: true,
      noIndex: true,
      primaryKeyword1: true,
      primaryKeyword2: true,
      primaryKeyword3: true,
      ogImage: { select: { url: true } },
      image: { select: { url: true } },
    },
  },
} satisfies Prisma.ProductCountrySelect;

export const getProductSeo = cache(async (countryId: string, slug: string) => {
  return prisma.productCountry.findFirst({
    where: { ...publishedProductWhere(countryId), product: { deletedAt: null, slug } },
    select: productSeoSelect,
  });
});

/** Markets in which a product is published — for hreflang and the market switcher. */
export const findLiveProductCountries = cache(async (slug: string): Promise<string[]> => {
  const rows = await prisma.productCountry.findMany({
    where: {
      deletedAt: null,
      status: 'PUBLISHED',
      OR: [{ publishedAt: null }, { publishedAt: { lte: new Date() } }],
      product: { deletedAt: null, slug },
    },
    select: { countryId: true },
  });
  return rows.map((row) => row.countryId);
});

/** Variant pricing for a market, falling back to the variant's global price. */
export const getVariantPricing = cache(
  async (productId: string, countryId: string) => {
    const variants = await prisma.productVariant.findMany({
      where: { productId },
      orderBy: { sortOrder: 'asc' },
      include: { countries: { where: { countryId } } },
    });

    return variants
      .map((variant) => {
        const local = variant.countries[0] ?? null;
        return {
          id: variant.id,
          name: variant.name,
          sku: variant.sku,
          storage: variant.storage,
          users: variant.users,
          isDefault: variant.isDefault,
          isAvailable: local ? local.isAvailable : true,
          currency: local?.currency ?? null,
          monthlyPrice: decimalToString(local?.monthlyPrice ?? variant.monthlyPrice),
          annualPrice: decimalToString(local?.annualPrice ?? variant.annualPrice),
        };
      })
      .filter((variant) => variant.isAvailable);
  },
);

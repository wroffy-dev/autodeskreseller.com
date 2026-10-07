import 'server-only';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { indexablePageWhere, publishedPageWhere } from '@/lib/services/pages';
import { publishedPostWhere } from '@/lib/services/blog';
import { synthesiseProductSections } from '@/lib/cms/product-defaults';
import { parseBlockContent } from '@/lib/cms/blocks';
import { decimalToString } from '@/lib/utils/money';
import { pageSlug, slugify } from '@/lib/utils/slug';
import { countryPath } from '@/lib/country/routing';
import { pageHref, productHref, registeredLink } from '@/lib/urls/links';
import { stripMarket } from '@/lib/urls/path';
import { blogPath, categoryPath, postPath, tagPath } from '@/lib/cms/blog-render';
import type { CountryContext } from '@/lib/country/types';
import { effectiveKeywords, primaryKeywords } from '@/lib/seo/keywords';
import {
  articleVisibility,
  extractSections,
  sectionMediaIds,
  specRows,
  type ExtractMedia,
  type ProductFacts,
  type SectionForExtraction,
} from '@/lib/seo/content/sections';
import { htmlToText } from '@/lib/seo/content/html';
import { countWords } from '@/lib/seo/content/text';
import { editPathFor } from '@/lib/seo/score-state';
import {
  blogArchiveJsonLd,
  blogCategoryJsonLd,
  blogPostJsonLd,
  blogTagJsonLd,
  cmsPageJsonLd,
  productPageJsonLd,
  siteJsonLd,
} from '@/lib/seo/page-schema';
import {
  overlay,
  type PageDraft,
  type PostDraft,
  type ProductDraft,
  type ProductMarketDraft,
} from '@/lib/seo/drafts';
import type { SeoDocument } from '@/lib/seo/types';
import { cityPageSeo } from '@/lib/cities/seo';
import { withCityDetails } from '@/lib/cities/local';
import type { SeoContext } from './context';
import {
  absolute,
  alternatesOf,
  citySitemapExclusion,
  countryRef,
  entityOf,
  isPublished,
  localOf,
  marketPath,
  marketSitemapExclusion,
  noIndexReasons,
  renderCanonical,
  renderDescription,
  renderTitle,
  robotsOf,
  socialOf,
} from './meta';

/**
 * Saved records, turned into documents the scoring engine can read.
 *
 * One builder per kind of URL. Each loads its records in a handful of batched
 * queries — never one query per record — resolves them exactly as the public
 * surface renders them (title fallbacks, market overrides, layouts, the JSON-LD
 * from the same builders the surface uses) and, for live scoring, lays an
 * editor's unsaved draft over the saved record first.
 */

const emptyCollisions = (): SeoDocument['collisions'] => ({
  title: [],
  description: [],
  keyword: [],
  content: [],
});

const clean = (value: string | null | undefined): string | null => value?.trim() || null;

/** Blank draft values mean "cleared", exactly as the save action treats them. */
const draftText = (saved: string | null, draft: string | undefined): string | null =>
  draft === undefined ? saved : clean(draft);

function draftDate(saved: Date | null, draft: string | undefined): Date | null {
  if (draft === undefined) return saved;
  if (!draft.trim()) return null;
  const date = new Date(draft);
  return Number.isNaN(date.getTime()) ? saved : date;
}

const draftMoney = (saved: string | null, draft: string | undefined): string | null => {
  if (draft === undefined) return saved;
  const value = draft.replace(/[,\s]/g, '');
  return /^\d+(\.\d{1,2})?$/.test(value) ? value : null;
};

async function loadMedia(ids: Iterable<string | null | undefined>): Promise<Map<string, ExtractMedia>> {
  const unique = [...new Set([...ids].filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map();
  const rows = await prisma.media.findMany({
    where: { id: { in: unique }, deletedAt: null },
    select: { id: true, url: true, altText: true, width: true, height: true, size: true, mimeType: true },
  });
  return new Map(
    rows.map((row) => [
      row.id,
      {
        url: row.url,
        altText: row.altText,
        width: row.width,
        height: row.height,
        size: row.size,
        mimeType: row.mimeType,
      },
    ]),
  );
}

const toSection = (row: {
  id: string;
  blockType: string;
  content: unknown;
  isVisible: boolean;
  sortOrder: number;
}): SectionForExtraction => ({
  id: row.id,
  blockType: row.blockType,
  content: row.content,
  isVisible: row.isVisible,
  sortOrder: row.sortOrder,
});

const marketOf = (ctx: SeoContext, countryId: string): CountryContext => ctx.byId.get(countryId) ?? ctx.root;

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

export async function buildPageDocuments(
  ctx: SeoContext,
  where: Prisma.PageWhereInput,
  drafts?: ReadonlyMap<string, PageDraft>,
): Promise<SeoDocument[]> {
  const rows = await prisma.page.findMany({
    where: { ...where, deletedAt: null },
    include: { sections: { orderBy: { sortOrder: 'asc' } } },
  });
  if (rows.length === 0) return [];

  const pages = rows.map((row) => {
    const draft = drafts?.get(row.id);
    if (!draft) return row;
    const isHomepage = overlay(row.isHomepage, draft.isHomepage);
    return {
      ...row,
      title: draft.title?.trim() || row.title,
      isHomepage,
      slug: isHomepage ? '' : draft.slug !== undefined ? pageSlug(draft.slug) : row.slug,
      status: (draft.status as typeof row.status | undefined) ?? row.status,
      publishedAt: draftDate(row.publishedAt, draft.publishedAt),
      seoTitle: draftText(row.seoTitle, draft.seoTitle),
      seoDescription: draftText(row.seoDescription, draft.seoDescription),
      canonicalUrl: draftText(row.canonicalUrl, draft.canonicalUrl),
      noIndex: overlay(row.noIndex, draft.noIndex),
      noFollow: overlay(row.noFollow, draft.noFollow),
      ogTitle: draftText(row.ogTitle, draft.ogTitle),
      ogDescription: draftText(row.ogDescription, draft.ogDescription),
      ogImageId: draft.ogImageId === undefined ? row.ogImageId : draft.ogImageId,
      twitterTitle: draftText(row.twitterTitle, draft.twitterTitle),
      twitterDescription: draftText(row.twitterDescription, draft.twitterDescription),
      twitterImageId: draft.twitterImageId === undefined ? row.twitterImageId : draft.twitterImageId,
      primaryKeyword1: draftText(row.primaryKeyword1, draft.primaryKeyword1),
      primaryKeyword2: draftText(row.primaryKeyword2, draft.primaryKeyword2),
      primaryKeyword3: draftText(row.primaryKeyword3, draft.primaryKeyword3),
    };
  });

  // The same page in other markets: by group where pages have been grouped,
  // by slug where they have not yet.
  const slugs = [...new Set(pages.map((page) => page.slug))];
  const groups = [...new Set(pages.map((page) => page.groupKey).filter((key): key is string => Boolean(key)))];
  const cityIds = [...new Set(pages.map((page) => page.cityId).filter((id): id is string => Boolean(id)))];
  const [liveRows, media, cities] = await Promise.all([
    prisma.page.findMany({
      where: {
        ...indexablePageWhere(),
        OR: [{ slug: { in: slugs } }, ...(groups.length > 0 ? [{ groupKey: { in: groups } }] : [])],
      },
      select: { id: true, slug: true, countryId: true, groupKey: true },
    }),
    loadMedia(
      pages.flatMap((page) => [
        page.ogImageId,
        page.twitterImageId,
        ...sectionMediaIds(page.sections.map(toSection)),
      ]),
    ),
    cityIds.length > 0 ? prisma.city.findMany({ where: { id: { in: cityIds } } }) : [],
  ]);
  const cityOf = new Map(cities.map((city) => [city.id, city]));

  return pages.map((page) => {
    const country = marketOf(ctx, page.countryId);
    // Inside a city, the city's details and search defaults come first —
    // resolved by the same functions the public page uses.
    const city = page.cityId ? (cityOf.get(page.cityId) ?? null) : null;
    const local = withCityDetails(localOf(ctx, country), city);
    const citySeo = cityPageSeo(page, city);
    const slug = page.isHomepage ? '' : page.slug;
    const path = marketPath(country, slug);
    const published = isPublished(page.status, page.publishedAt);
    const sections = page.sections.map(toSection);

    const title = renderTitle(ctx, local, { seo: [page.seoTitle, citySeo.cityTitle], fallback: [page.title] });
    const description = renderDescription(local, { seo: [page.seoDescription, citySeo.cityDescription], fallback: [] });
    const keywords = citySeo.keywords;
    const reasons = noIndexReasons(ctx, local, { entity: page.noIndex, city: Boolean(city?.noIndex) });
    const exclusion = marketSitemapExclusion(ctx, country) ?? citySitemapExclusion(city);
    const cityOff = Boolean(city && !city.isActive);

    // hreflang: the markets where an indexable page with this slug is live,
    // this page's own draft state standing in for its saved one.
    const liveIn = new Set(
      liveRows
        .filter((row) => (page.groupKey ? row.groupKey === page.groupKey : row.slug === page.slug) && row.id !== page.id)
        .map((row) => row.countryId),
    );
    if (published && !citySeo.noIndex && !cityOff) liveIn.add(page.countryId);

    return {
      entityType: 'PAGE',
      entityId: page.id,
      kind: page.isHomepage || slug === '' ? 'homepage' : 'page',
      name: page.title,
      country: countryRef(country),
      path,
      slug,
      absoluteUrl: absolute(ctx, path),
      editPath: editPathFor('PAGE', page.id),
      status: {
        value: page.status,
        live: published && country.isActive && !cityOff,
        publishedAt: page.publishedAt?.toISOString() ?? null,
        notServedReason:
          published && !country.isActive
            ? `the ${country.name} market is switched off.`
            : published && cityOff
              ? `the city ${city!.name} is switched off.`
              : null,
      },
      updatedAt: page.updatedAt.toISOString(),
      meta: {
        ...title,
        ...description,
        canonical: renderCanonical(ctx, country, page.canonicalUrl, path),
        keywords,
        keywordsSource: keywords.length === 0 ? 'none' : citySeo.inherited.keywords ? 'city' : 'own',
      },
      robots: robotsOf(ctx, path, {
        reasons,
        noFollow: page.noFollow,
        inSitemap: published && !citySeo.noIndex && !exclusion,
        sitemapExclusion: exclusion,
      }),
      social: socialOf(ctx, local, {
        title: title.title,
        description: description.description,
        ogTitle: page.ogTitle,
        ogDescription: page.ogDescription,
        twitterTitle: page.twitterTitle,
        ogImage: page.ogImageId ? (media.get(page.ogImageId)?.url ?? null) : null,
      }),
      content: extractSections(sections, { media, allowFirstH1: true }),
      schema: [
        ...siteJsonLd(country, local, ctx.site),
        ...cmsPageJsonLd(country, { title: page.title, slug, sections }, ctx.site.siteName),
      ],
      alternates: alternatesOf(ctx, [...liveIn], reasons.length > 0),
      entity: entityOf(ctx, local),
      collisions: emptyCollisions(),
    } satisfies SeoDocument;
  });
}

// ---------------------------------------------------------------------------
// Products, one market at a time
// ---------------------------------------------------------------------------

export type ProductMarketRef = { productId: string; countryId: string };

export type ProductMarketDrafts = ReadonlyMap<
  string,
  { product?: ProductDraft; market?: ProductMarketDraft }
>;

export const productMarketKey = (ref: ProductMarketRef) => `${ref.productId}:${ref.countryId}`;

const asStrings = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((item) => String(item ?? '').trim()).filter(Boolean) : [];

const asSpecs = (value: unknown): Array<{ label: string; value: string }> =>
  Array.isArray(value)
    ? value
        .filter((item): item is { label?: unknown; value?: unknown } => typeof item === 'object' && item !== null)
        .map((item) => ({ label: String(item.label ?? '').trim(), value: String(item.value ?? '').trim() }))
        .filter((item) => item.label)
    : [];

const pick = (local: string | null | undefined, global: string | null | undefined) =>
  local?.trim() ? local : (global ?? null);

/** A category or brand in the recycle bin is still referenced but not shown. */
function shownTaxonomy<T extends { deletedAt: Date | null }>(row: T | null): T | null {
  return row && !row.deletedAt ? row : null;
}

export async function buildProductMarketDocuments(
  ctx: SeoContext,
  refs: readonly ProductMarketRef[],
  drafts?: ProductMarketDrafts,
): Promise<SeoDocument[]> {
  if (refs.length === 0) return [];
  const productIds = [...new Set(refs.map((ref) => ref.productId))];
  const products = await prisma.product.findMany({
    where: { id: { in: productIds }, deletedAt: null },
    include: {
      category: { select: { id: true, name: true, slug: true, deletedAt: true } },
      brand: { select: { id: true, name: true, slug: true, deletedAt: true } },
      countries: true,
      sections: { orderBy: { sortOrder: 'asc' } },
    },
  });
  const byId = new Map(products.map((product) => [product.id, product]));

  // Taxonomy a draft points at that the product does not have loaded yet.
  const draftCategoryIds = new Set<string>();
  const draftBrandIds = new Set<string>();
  for (const draft of drafts?.values() ?? []) {
    if (draft.product?.categoryId) draftCategoryIds.add(draft.product.categoryId);
    if (draft.product?.brandId) draftBrandIds.add(draft.product.brandId);
  }
  const [draftCategories, draftBrands] = await Promise.all([
    draftCategoryIds.size > 0
      ? prisma.productCategory.findMany({
          where: { id: { in: [...draftCategoryIds] }, deletedAt: null },
          select: { id: true, name: true, slug: true },
        })
      : [],
    draftBrandIds.size > 0
      ? prisma.brand.findMany({
          where: { id: { in: [...draftBrandIds] }, deletedAt: null },
          select: { id: true, name: true, slug: true },
        })
      : [],
  ]);

  type Resolved = {
    ref: ProductMarketRef;
    product: (typeof products)[number];
    shared: ProductDraft | undefined;
    market: ProductMarketDraft | undefined;
    row: (typeof products)[number]['countries'][number] | null;
    detail: SectionForExtraction[];
    sidebar: SectionForExtraction[];
    imageId: string | null;
    galleryIds: string[];
    category: { id: string; name: string; slug: string } | null;
    brand: { id: string; name: string; slug: string } | null;
  };

  const resolved: Resolved[] = [];
  for (const ref of refs) {
    const product = byId.get(ref.productId);
    if (!product) continue;
    const draft = drafts?.get(productMarketKey(ref));
    const shared = draft?.product;
    const row = product.countries.find((entry) => entry.countryId === ref.countryId && !entry.deletedAt) ?? null;
    const stored = (surface: 'DETAIL' | 'SIDEBAR') => {
      const own = product.sections.filter((section) => section.surface === surface).map(toSection);
      return own.length > 0 ? own : synthesiseProductSections(surface).map(toSection);
    };
    const categoryId = shared?.categoryId === undefined ? product.categoryId : shared.categoryId;
    const brandId = shared?.brandId === undefined ? product.brandId : shared.brandId;
    resolved.push({
      ref,
      product,
      shared,
      market: draft?.market,
      row,
      detail: stored('DETAIL'),
      sidebar: stored('SIDEBAR'),
      imageId: shared?.imageId === undefined ? product.imageId : shared.imageId,
      galleryIds: shared?.galleryIds ?? asStrings(product.galleryIds),
      // As the public page shows them: nothing for one in the recycle bin.
      category:
        categoryId === product.categoryId
          ? shownTaxonomy(product.category)
          : (draftCategories.find((entry) => entry.id === categoryId) ?? null),
      brand:
        brandId === product.brandId
          ? shownTaxonomy(product.brand)
          : (draftBrands.find((entry) => entry.id === brandId) ?? null),
    });
  }

  // Landing pages are linked to their category or brand by id, so a page that
  // was renamed is still found and a page that merely shares the URL is not.
  const categoryIds = new Set<string>();
  const brandIds = new Set<string>();
  for (const item of resolved) {
    if (item.category) categoryIds.add(item.category.id);
    if (item.brand) brandIds.add(item.brand.id);
  }
  const [taxonomyPages, media] = await Promise.all([
    categoryIds.size + brandIds.size > 0
      ? prisma.page.findMany({
          where: {
            ...publishedPageWhere(),
            OR: [
              { landingCategoryId: { in: [...categoryIds] } },
              { landingBrandId: { in: [...brandIds] } },
            ],
          },
          select: { id: true, slug: true, countryId: true, landingCategoryId: true, landingBrandId: true },
        })
      : [],
    loadMedia(
      resolved.flatMap((item) => [
        item.imageId,
        item.shared?.ogImageId === undefined ? item.product.ogImageId : item.shared.ogImageId,
        item.row?.ogImageId,
        ...item.galleryIds,
        ...sectionMediaIds(item.detail),
        ...sectionMediaIds(item.sidebar),
      ]),
    ),
  ]);

  const now = new Date();
  return resolved.map((item) => {
    const { product, shared, market, ref } = item;
    const country = marketOf(ctx, ref.countryId);
    const local = localOf(ctx, country);

    // The shared product, with the product form's draft over it.
    const name = shared?.name?.trim() || product.name;
    const slug = shared?.slug !== undefined ? slugify(shared.slug) || product.slug : product.slug;
    const sku = draftText(product.sku, shared?.sku);
    const sharedShort = draftText(product.shortDescription, shared?.shortDescription);
    const sharedDescription = draftText(product.description, shared?.description);
    const storage = draftText(product.storage, shared?.storage);
    const minUsers = shared?.minUsers !== undefined ? Number(shared.minUsers) || null : product.minUsers;
    const maxUsers = shared?.maxUsers !== undefined ? Number(shared.maxUsers) || null : product.maxUsers;
    const users =
      minUsers && maxUsers ? `${minUsers}–${maxUsers}` : minUsers ? `${minUsers}+` : maxUsers ? `Up to ${maxUsers}` : null;
    const features = shared?.features?.map((entry) => entry.trim()).filter(Boolean) ?? asStrings(product.features);
    const benefits = shared?.benefits?.map((entry) => entry.trim()).filter(Boolean) ?? asStrings(product.benefits);
    const specs = shared?.specs?.filter((spec) => spec.label.trim()) ?? asSpecs(product.specs);
    const productNoIndex = overlay(product.noIndex, shared?.noIndex);
    const productOgImageId = shared?.ogImageId === undefined ? product.ogImageId : shared.ogImageId;
    const sharedKeywords = {
      primaryKeyword1: draftText(product.primaryKeyword1, shared?.primaryKeyword1),
      primaryKeyword2: draftText(product.primaryKeyword2, shared?.primaryKeyword2),
      primaryKeyword3: draftText(product.primaryKeyword3, shared?.primaryKeyword3),
    };

    // The market row: saved, with the country panel's draft over it — or,
    // where the product is not sold yet, a preview of the draft alone. The
    // product form edits the market it is working in, so its price and
    // status fields land here too.
    const saved = item.row;
    const base = saved
      ? {
          status: saved.status as string,
          publishedAt: saved.publishedAt,
          currency: saved.currency,
          monthlyPrice: decimalToString(saved.monthlyPrice),
          annualPrice: decimalToString(saved.annualPrice),
          compareAtPrice: decimalToString(saved.compareAtPrice),
          priceSuffix: saved.priceSuffix,
          priceNote: saved.priceNote,
          shortDescription: saved.shortDescription,
          description: saved.description,
          ctaLabel: saved.ctaLabel,
          seoTitle: saved.seoTitle,
          seoDescription: saved.seoDescription,
          canonicalUrl: saved.canonicalUrl,
          noIndex: saved.noIndex,
          ogImageId: saved.ogImageId,
          primaryKeyword1: saved.primaryKeyword1,
          primaryKeyword2: saved.primaryKeyword2,
          primaryKeyword3: saved.primaryKeyword3,
          updatedAt: saved.updatedAt,
        }
      : null;
    const pricing = { ...shared, ...market };
    const row =
      base || market || shared
        ? {
            status: (market?.status ?? shared?.status ?? base?.status ?? 'DRAFT') as string,
            publishedAt: base?.publishedAt ?? null,
            currency: (pricing.currency?.trim() || base?.currency || country.currency).toUpperCase(),
            monthlyPrice: draftMoney(base?.monthlyPrice ?? null, pricing.monthlyPrice),
            annualPrice: draftMoney(base?.annualPrice ?? null, pricing.annualPrice),
            compareAtPrice: draftMoney(base?.compareAtPrice ?? null, market?.compareAtPrice),
            priceSuffix: draftText(base?.priceSuffix ?? null, pricing.priceSuffix),
            priceNote: draftText(base?.priceNote ?? null, pricing.priceNote),
            shortDescription: draftText(base?.shortDescription ?? null, market?.shortDescription),
            description: base?.description ?? null,
            ctaLabel: draftText(base?.ctaLabel ?? null, pricing.ctaLabel),
            seoTitle: draftText(base?.seoTitle ?? null, market?.seoTitle),
            seoDescription: draftText(base?.seoDescription ?? null, market?.seoDescription),
            canonicalUrl: draftText(base?.canonicalUrl ?? null, market?.canonicalUrl),
            noIndex: overlay(base?.noIndex ?? false, market?.noIndex),
            ogImageId: base?.ogImageId ?? null,
            primaryKeyword1: draftText(base?.primaryKeyword1 ?? null, market?.primaryKeyword1),
            primaryKeyword2: draftText(base?.primaryKeyword2 ?? null, market?.primaryKeyword2),
            primaryKeyword3: draftText(base?.primaryKeyword3 ?? null, market?.primaryKeyword3),
          }
        : null;

    // Saving the product form puts the product on sale in the market it is
    // working in, so its draft previews the product as sold there.
    const sold = Boolean(saved) || Boolean(market) || Boolean(shared);
    const published = Boolean(row && sold && isPublished(row.status, row.publishedAt, now));
    const path = productHref(country, { id: product.id, slug });
    const image = item.imageId ? (media.get(item.imageId) ?? null) : null;
    const gallery = item.galleryIds.map((id) => media.get(id)).filter((entry): entry is ExtractMedia => Boolean(entry));
    const shortDescription = pick(row?.shortDescription, sharedShort);
    const descriptionHtml = pick(row?.description, sharedDescription);
    const categoryPage = item.category
      ? taxonomyPages.find((page) => page.countryId === country.id && page.landingCategoryId === item.category!.id)
      : undefined;
    const brandPage = item.brand
      ? taxonomyPages.find((page) => page.countryId === country.id && page.landingBrandId === item.brand!.id)
      : undefined;
    const categoryHref = categoryPage ? pageHref(country, categoryPage) : null;
    const brandHref = brandPage ? pageHref(country, brandPage) : null;

    const facts: ProductFacts = {
      name,
      shortDescription,
      descriptionHtml,
      categoryName: item.category?.name ?? null,
      categoryHref,
      brandName: item.brand?.name ?? null,
      brandHref,
      sku,
      image: image ? { ...image, alt: image.altText ?? name } : null,
      gallery,
      features,
      benefits,
      specs,
      storage,
      users,
      currency: row?.currency ?? country.currency,
      monthlyPrice: row?.monthlyPrice ?? null,
      annualPrice: row?.annualPrice ?? null,
      compareAtPrice: row?.compareAtPrice ?? null,
      priceSuffix: pick(row?.priceSuffix, product.priceSuffix),
      priceNote: pick(row?.priceNote, product.priceNote),
      ctaLabel: pick(row?.ctaLabel, product.ctaLabel) || 'Get Started',
      homeHref: countryPath(country),
      productsHref: registeredLink(country, '/pricing') ?? countryPath(country, 'pricing'),
    };

    const visible = [...item.detail, ...item.sidebar].filter((section) => section.isVisible);
    const specsVisible = visible.some((section) => {
      if (section.blockType === 'productSpecs') {
        const content = parseBlockContent<{ showStorage: boolean; showUsers: boolean; showSku: boolean }>(
          'productSpecs',
          section.content,
        );
        return specRows(facts, { storage: content.showStorage, users: content.showUsers, sku: content.showSku }).length > 0;
      }
      if (section.blockType === 'productPriceBox') {
        return parseBlockContent<{ showSpecs: boolean }>('productPriceBox', section.content).showSpecs && specs.length > 0;
      }
      return false;
    });

    const title = renderTitle(ctx, local, {
      seo: [row?.seoTitle, draftText(product.seoTitle, shared?.seoTitle)],
      fallback: [name],
    });
    // The metadata falls back to the shared short description, never the
    // market's own — exactly as the product page's metadata does.
    const description = renderDescription(local, {
      seo: [row?.seoDescription, draftText(product.seoDescription, shared?.seoDescription)],
      fallback: [sharedShort],
    });
    const keywords = effectiveKeywords(row, sharedKeywords);
    const overrides: NonNullable<SeoDocument['meta']['overrides']> = [];
    if (row?.seoTitle) overrides.push('title');
    if (row?.seoDescription) overrides.push('description');
    if (row?.canonicalUrl) overrides.push('canonical');
    if (keywords.source === 'market') overrides.push('keywords');

    const rowNoIndex = row?.noIndex ?? false;
    const reasons = noIndexReasons(ctx, local, { entity: rowNoIndex, shared: productNoIndex });
    const exclusion = marketSitemapExclusion(ctx, country);
    const liveIn = product.countries
      .filter((entry) => !entry.deletedAt && isPublished(entry.status, entry.publishedAt, now) && entry.countryId !== country.id)
      .map((entry) => entry.countryId);
    if (published) liveIn.push(country.id);

    const ogImageId = row?.ogImageId ?? productOgImageId;

    return {
      entityType: 'PRODUCT_MARKET',
      entityId: product.id,
      kind: 'product',
      name,
      country: countryRef(country),
      path,
      slug: stripMarket(country.slug, path).replace(/^\//, ''),
      absoluteUrl: absolute(ctx, path),
      editPath: editPathFor('PRODUCT_MARKET', product.id),
      status: {
        value: (row?.status ?? 'DRAFT') as SeoDocument['status']['value'],
        live: published && country.isActive,
        publishedAt: row?.publishedAt?.toISOString() ?? null,
        notServedReason: !sold
          ? `the product is not on sale in ${country.name}.`
          : published && !country.isActive
            ? `the ${country.name} market is switched off.`
            : null,
      },
      updatedAt: new Date(
        Math.max(product.updatedAt.getTime(), saved?.updatedAt.getTime() ?? 0),
      ).toISOString(),
      meta: {
        ...title,
        ...description,
        canonical: renderCanonical(ctx, country, row?.canonicalUrl || draftText(product.canonicalUrl, shared?.canonicalUrl), path),
        keywords: keywords.keywords,
        keywordsSource: keywords.source === 'market' ? 'own' : keywords.source,
        overrides,
      },
      robots: robotsOf(ctx, path, {
        reasons,
        noFollow: false,
        inSitemap: published && !rowNoIndex && !productNoIndex && !exclusion,
        sitemapExclusion: exclusion,
      }),
      social: socialOf(ctx, local, {
        title: title.title,
        description: description.description,
        ogImage: ogImageId ? (media.get(ogImageId)?.url ?? null) : null,
        fallbackImage: image?.url ?? null,
      }),
      content: [
        ...extractSections(item.detail, { media, allowFirstH1: true, product: facts }),
        ...extractSections(item.sidebar, { media, allowFirstH1: false, product: facts }),
      ],
      schema: [
        ...siteJsonLd(country, local, ctx.site),
        ...productPageJsonLd(
          country,
          {
            name,
            slug,
            href: path,
            shortDescription,
            imageUrl: image?.url ?? null,
            monthlyPrice: row?.monthlyPrice ?? null,
            currency: row?.currency ?? country.currency,
            sku,
            brandName: item.brand?.name ?? null,
          },
          ctx.site.siteName,
          item.detail,
        ),
      ],
      alternates: alternatesOf(ctx, liveIn, reasons.length > 0),
      entity: entityOf(ctx, local),
      product: {
        name,
        brand: item.brand?.name ?? null,
        category: item.category?.name ?? null,
        sku,
        shortDescription: shortDescription ?? '',
        descriptionWords: countWords(htmlToText(descriptionHtml)),
        currency: row?.currency ?? country.currency,
        price: row?.monthlyPrice ?? null,
        annualPrice: row?.annualPrice ?? null,
        priceNote: facts.priceNote,
        storage,
        users,
        specs,
        features,
        benefits,
        hasImage: Boolean(image),
        imageAlt: image ? (image.altText ?? name) : null,
        galleryCount: gallery.length,
        specsVisible,
      },
      collisions: emptyCollisions(),
    } satisfies SeoDocument;
  });
}

// ---------------------------------------------------------------------------
// Articles
// ---------------------------------------------------------------------------

export async function buildPostDocuments(
  ctx: SeoContext,
  where: Prisma.BlogPostWhereInput,
  drafts?: ReadonlyMap<string, PostDraft>,
): Promise<SeoDocument[]> {
  const rows = await prisma.blogPost.findMany({
    where: { ...where, deletedAt: null },
    include: {
      category: {
        select: { id: true, name: true, slug: true, parent: { select: { id: true, name: true, slug: true } } },
      },
      author: {
        select: { id: true, name: true, jobTitle: true, bio: true, linkedinUrl: true, websiteUrl: true },
      },
      tags: { include: { tag: { select: { id: true, name: true, slug: true } } } },
    },
  });
  if (rows.length === 0) return [];

  const draftCategoryIds = new Set<string>();
  const draftAuthorIds = new Set<string>();
  for (const draft of drafts?.values() ?? []) {
    if (draft.categoryId) draftCategoryIds.add(draft.categoryId);
    if (draft.authorId) draftAuthorIds.add(draft.authorId);
  }
  const [draftCategories, draftAuthors] = await Promise.all([
    draftCategoryIds.size > 0
      ? prisma.blogCategory.findMany({
          where: { id: { in: [...draftCategoryIds] } },
          select: { id: true, name: true, slug: true, parent: { select: { id: true, name: true, slug: true } } },
        })
      : [],
    draftAuthorIds.size > 0
      ? prisma.user.findMany({
          where: { id: { in: [...draftAuthorIds] } },
          select: { id: true, name: true, jobTitle: true, bio: true, linkedinUrl: true, websiteUrl: true },
        })
      : [],
  ]);

  const posts = rows.map((row) => {
    const draft = drafts?.get(row.id);
    if (!draft) return row;
    const categoryId = draft.categoryId === undefined ? row.categoryId : draft.categoryId || null;
    const authorId = draft.authorId === undefined ? row.authorId : draft.authorId || null;
    return {
      ...row,
      title: draft.title?.trim() || row.title,
      slug: draft.slug !== undefined ? slugify(draft.slug) || row.slug : row.slug,
      subtitle: draftText(row.subtitle, draft.subtitle),
      status: (draft.status as typeof row.status | undefined) ?? row.status,
      publishedAt: draftDate(row.publishedAt, draft.publishedAt),
      excerpt: draftText(row.excerpt, draft.excerpt),
      content: draft.content ?? row.content,
      categoryId,
      category:
        categoryId === row.categoryId
          ? row.category
          : (draftCategories.find((entry) => entry.id === categoryId) ?? null),
      authorId,
      author: authorId === row.authorId ? row.author : (draftAuthors.find((entry) => entry.id === authorId) ?? null),
      tags: draft.tags
        ? draft.tags.map((name) => ({ tag: { id: `draft:${slugify(name)}`, name, slug: slugify(name) } }))
        : row.tags,
      featuredImageId: draft.featuredImageId === undefined ? row.featuredImageId : draft.featuredImageId,
      ogImageId: draft.ogImageId === undefined ? row.ogImageId : draft.ogImageId,
      twitterImageId: draft.twitterImageId === undefined ? row.twitterImageId : draft.twitterImageId,
      seoTitle: draftText(row.seoTitle, draft.seoTitle),
      seoDescription: draftText(row.seoDescription, draft.seoDescription),
      canonicalUrl: draftText(row.canonicalUrl, draft.canonicalUrl),
      noIndex: overlay(row.noIndex, draft.noIndex),
      noFollow: overlay(row.noFollow, draft.noFollow),
      ogTitle: draftText(row.ogTitle, draft.ogTitle),
      ogDescription: draftText(row.ogDescription, draft.ogDescription),
      primaryKeyword1: draftText(row.primaryKeyword1, draft.primaryKeyword1),
      primaryKeyword2: draftText(row.primaryKeyword2, draft.primaryKeyword2),
      primaryKeyword3: draftText(row.primaryKeyword3, draft.primaryKeyword3),
    };
  });

  const slugs = [...new Set(posts.map((post) => post.slug))];
  const [liveRows, media] = await Promise.all([
    prisma.blogPost.findMany({
      where: { ...publishedPostWhere(), slug: { in: slugs } },
      select: { id: true, slug: true, countryId: true },
    }),
    loadMedia([
      ...posts.flatMap((post) => [post.featuredImageId, post.ogImageId, post.twitterImageId]),
      ...sectionMediaIds(ctx.articleSections),
    ]),
  ]);

  const root = ctx.root;
  const rootLocal = localOf(ctx, root);
  const visibility = articleVisibility(ctx.articleSections);
  const now = new Date();

  return posts.map((post) => {
    const country = marketOf(ctx, post.countryId);
    const path = postPath(post);
    const published = isPublished(post.status, post.publishedAt, now);
    const atRoot = post.countryId === root.id;
    const featured = post.featuredImageId ? (media.get(post.featuredImageId) ?? null) : null;
    const ogImage = post.ogImageId ? (media.get(post.ogImageId) ?? null) : null;

    const title = renderTitle(ctx, rootLocal, { seo: [post.seoTitle], fallback: [post.title] });
    const description = renderDescription(rootLocal, { seo: [post.seoDescription], fallback: [post.excerpt] });
    const own = primaryKeywords(post);
    const keywords = own.length > 0 ? own : primaryKeywords({ primaryKeyword1: post.focusKeyword });
    const reasons = noIndexReasons(ctx, rootLocal, { entity: post.noIndex });
    const sitemapExclusion = !ctx.seo.sitemapEnabled
      ? 'sitemaps are switched off in Admin → SEO'
      : ctx.blog.noIndex
        ? 'the blog is set to noindex, which leaves every article out of the sitemap'
        : null;

    const liveIn = liveRows
      .filter((row) => row.slug === post.slug && row.id !== post.id)
      .map((row) => row.countryId);
    if (published) liveIn.push(post.countryId);

    const tagLinks = post.tags.map(({ tag }) => ({ name: tag.name, href: tagPath(tag) }));
    const schemaPost = {
      id: post.id,
      title: post.title,
      slug: post.slug,
      seoDescription: post.seoDescription,
      excerpt: post.excerpt,
      content: post.content,
      publishedAt: post.publishedAt,
      updatedAt: post.updatedAt,
      featuredImage: featured ? { url: featured.url } : null,
      ogImage: ogImage ? { url: ogImage.url } : null,
      tags: post.tags.map(({ tag }) => ({ tag: { name: tag.name } })),
      category: post.category
        ? { id: post.category.id, name: post.category.name, slug: post.category.slug }
        : null,
      author: post.author
        ? {
            name: post.author.name,
            jobTitle: post.author.jobTitle,
            linkedinUrl: post.author.linkedinUrl,
            websiteUrl: post.author.websiteUrl,
          }
        : null,
    };

    return {
      entityType: 'BLOG_POST',
      entityId: post.id,
      kind: 'article',
      name: post.title,
      country: countryRef(country),
      path,
      slug: post.slug,
      absoluteUrl: absolute(ctx, path),
      editPath: editPathFor('BLOG_POST', post.id),
      status: {
        value: post.status,
        live: published && atRoot && root.isActive,
        publishedAt: post.publishedAt?.toISOString() ?? null,
        notServedReason:
          published && !atRoot
            ? `articles are served from the ${root.name} market only, so this ${country.name} article is never shown at ${path}.`
            : null,
      },
      updatedAt: post.updatedAt.toISOString(),
      meta: {
        ...title,
        ...description,
        canonical: renderCanonical(ctx, root, post.canonicalUrl, path),
        keywords,
        keywordsSource: keywords.length > 0 ? 'own' : 'none',
      },
      robots: robotsOf(ctx, path, {
        reasons,
        noFollow: post.noFollow,
        inSitemap: published && atRoot && !post.noIndex && !sitemapExclusion,
        sitemapExclusion,
      }),
      social: socialOf(ctx, rootLocal, {
        title: title.title,
        description: description.description,
        ogTitle: post.ogTitle,
        ogDescription: post.ogDescription,
        ogImage: ogImage?.url ?? null,
        fallbackImage: featured?.url ?? null,
      }),
      content: extractSections(ctx.articleSections, {
        media,
        allowFirstH1: false,
        article: {
          title: post.title,
          subtitle: post.subtitle,
          excerpt: post.excerpt,
          contentHtml: post.content,
          categoryName: post.category?.name ?? null,
          categoryHref: post.category ? categoryPath(post.category) : null,
          featuredImage: featured,
          author: post.author ? { name: post.author.name, jobTitle: post.author.jobTitle, bio: post.author.bio } : null,
          tags: tagLinks,
          hasPublishedDate: Boolean(post.publishedAt),
          blogHref: blogPath(),
          homeHref: '/',
        },
      }),
      schema: [...siteJsonLd(root, rootLocal, ctx.site), ...blogPostJsonLd(root, schemaPost, ctx.site, ctx.seo)],
      alternates: alternatesOf(ctx, liveIn, reasons.length > 0),
      entity: entityOf(ctx, rootLocal),
      article: {
        author: post.author
          ? {
              name: post.author.name,
              jobTitle: post.author.jobTitle,
              url: post.author.linkedinUrl || post.author.websiteUrl,
              bio: Boolean(post.author.bio?.trim()),
            }
          : null,
        authorVisible: visibility.author && Boolean(post.author),
        publishedAt: post.publishedAt?.toISOString() ?? null,
        updatedAt: post.updatedAt.toISOString(),
        datesVisible: visibility.dates && Boolean(post.publishedAt),
        category: post.category?.name ?? null,
        tags: post.tags.map(({ tag }) => tag.name),
        excerpt: post.excerpt ?? '',
        hasFeaturedImage: Boolean(featured),
      },
      collisions: emptyCollisions(),
    } satisfies SeoDocument;
  });
}

// ---------------------------------------------------------------------------
// Blog archives
// ---------------------------------------------------------------------------

/**
 * The blog's listing layout, read for an archive with `postCount` articles.
 *
 * Every archive renders the same layout, so its media and the category count
 * are loaded once and the returned function is called per archive.
 */
async function archiveContentFor(ctx: SeoContext) {
  const [media, categoryCount] = await Promise.all([
    loadMedia(sectionMediaIds(ctx.listingSections)),
    prisma.blogCategory.count({ where: { isActive: true } }),
  ]);
  return (postCount: number) =>
    extractSections(ctx.listingSections, {
      media,
      allowFirstH1: true,
      archive: { postCount: Math.min(postCount, ctx.blog.postsPerPage), categoryCount, homeHref: '/' },
    });
}

const blogSitemapExclusion = (ctx: SeoContext): string | null =>
  !ctx.seo.sitemapEnabled
    ? 'sitemaps are switched off in Admin → SEO'
    : ctx.blog.noIndex
      ? 'the blog is set to noindex, which leaves the blog sitemap empty'
      : null;

export async function buildArchiveDocument(ctx: SeoContext): Promise<SeoDocument> {
  const root = ctx.root;
  const local = localOf(ctx, root);
  const blog = ctx.blog;
  const path = blogPath();
  const [postCount, archiveContent] = await Promise.all([
    prisma.blogPost.count({ where: publishedPostWhere(root.id) }),
    archiveContentFor(ctx),
  ]);
  const title = renderTitle(ctx, local, { seo: [blog.seoTitle], fallback: ['Blog'] });
  const description = renderDescription(local, {
    seo: [blog.seoDescription],
    fallback: ['Guides, migration playbooks and administration tips for teams running AutoCAD.'],
  });
  const reasons = noIndexReasons(ctx, local, { entity: blog.noIndex });
  const exclusion = blogSitemapExclusion(ctx);

  return {
    entityType: 'BLOG_ARCHIVE',
    entityId: 'blog',
    kind: 'archive',
    name: 'Blog',
    country: countryRef(root),
    path,
    slug: path.replace(/^\//, ''),
    absoluteUrl: absolute(ctx, path),
    editPath: editPathFor('BLOG_ARCHIVE', 'blog'),
    status: { value: 'PUBLISHED', live: root.isActive, publishedAt: null, notServedReason: null },
    updatedAt: new Date().toISOString(),
    meta: {
      ...title,
      ...description,
      canonical: renderCanonical(ctx, root, blog.canonicalUrl, path),
      keywords: [],
      keywordsSource: 'none',
    },
    robots: robotsOf(ctx, path, {
      reasons,
      noFollow: blog.noFollow,
      inSitemap: !blog.noIndex && !exclusion,
      sitemapExclusion: exclusion,
    }),
    social: socialOf(ctx, local, {
      title: title.title,
      description: description.description,
      ogTitle: blog.ogTitle,
      ogDescription: blog.ogDescription,
      ogImage: blog.ogImageUrl,
    }),
    content: archiveContent(postCount),
    schema: [...siteJsonLd(root, local, ctx.site), blogArchiveJsonLd(root)],
    alternates: alternatesOf(ctx, [], reasons.length > 0),
    entity: entityOf(ctx, local),
    archive: { itemCount: postCount },
    collisions: emptyCollisions(),
  };
}

export async function buildCategoryDocuments(
  ctx: SeoContext,
  where: Prisma.BlogCategoryWhereInput,
): Promise<SeoDocument[]> {
  const root = ctx.root;
  const local = localOf(ctx, root);
  const categories = await prisma.blogCategory.findMany({
    where,
    include: {
      parent: { select: { id: true, name: true, slug: true } },
      countries: { where: { countryId: root.id }, take: 1 },
    },
  });
  if (categories.length === 0) return [];
  const ids = categories.map((category) => category.id);
  const [rootCounts, anyCounts, media, archiveContent] = await Promise.all([
    prisma.blogPost.groupBy({
      by: ['categoryId'],
      where: { ...publishedPostWhere(root.id), categoryId: { in: ids } },
      _count: { _all: true },
    }),
    prisma.blogPost.groupBy({
      by: ['categoryId'],
      where: { ...publishedPostWhere(), categoryId: { in: ids } },
      _count: { _all: true },
    }),
    loadMedia(categories.flatMap((category) => [category.ogImageId, category.bannerImageId])),
    archiveContentFor(ctx),
  ]);
  const count = (rows: typeof rootCounts, id: string) => rows.find((row) => row.categoryId === id)?._count._all ?? 0;
  const listing = categories.map((category) => archiveContent(count(rootCounts, category.id)));
  const exclusionBase = blogSitemapExclusion(ctx);

  return categories.map((category, index) => {
    const override = category.countries[0] ?? null;
    const path = categoryPath(category);
    const title = renderTitle(ctx, local, {
      seo: [override?.seoTitle, category.seoTitle],
      fallback: [override?.archiveTitle, category.archiveTitle, `${category.name} articles`],
    });
    const description = renderDescription(local, {
      seo: [override?.seoDescription, category.seoDescription],
      fallback: [override?.archiveDescription, category.archiveDescription, category.description],
    });
    const noIndex = override ? override.noIndex : category.noIndex;
    const reasons = noIndexReasons(ctx, local, { entity: noIndex });
    const published = count(anyCounts, category.id);
    const exclusion =
      exclusionBase ??
      (!category.isActive
        ? 'the category is hidden from the blog filters'
        : published === 0
          ? 'the category has no published articles yet'
          : null);
    const ogImage = category.ogImageId ? (media.get(category.ogImageId)?.url ?? null) : null;
    const banner = category.bannerImageId ? (media.get(category.bannerImageId)?.url ?? null) : null;
    const keywords = primaryKeywords(category);

    return {
      entityType: 'BLOG_CATEGORY',
      entityId: category.id,
      kind: 'category',
      name: category.name,
      country: countryRef(root),
      path,
      slug: path.replace(/^\//, ''),
      absoluteUrl: absolute(ctx, path),
      editPath: editPathFor('BLOG_CATEGORY', category.id),
      status: { value: 'PUBLISHED', live: root.isActive, publishedAt: null, notServedReason: null },
      updatedAt: new Date(Math.max(category.updatedAt.getTime(), override?.updatedAt.getTime() ?? 0)).toISOString(),
      meta: {
        ...title,
        ...description,
        canonical: renderCanonical(ctx, root, override?.canonicalUrl || category.canonicalUrl, path),
        keywords,
        keywordsSource: keywords.length > 0 ? 'own' : 'none',
      },
      robots: robotsOf(ctx, path, {
        reasons,
        noFollow: override ? override.noFollow : category.noFollow,
        inSitemap: !category.noIndex && !exclusion,
        sitemapExclusion: exclusion,
      }),
      social: socialOf(ctx, local, {
        title: title.title,
        description: description.description,
        ogTitle: override?.ogTitle || category.ogTitle,
        ogDescription: override?.ogDescription || category.ogDescription,
        ogImage,
        fallbackImage: banner,
      }),
      content: listing[index]!,
      schema: [
        ...siteJsonLd(root, local, ctx.site),
        blogCategoryJsonLd(root, {
          id: category.id,
          name: category.name,
          slug: category.slug,
          parent: category.parent,
        }),
      ],
      alternates: alternatesOf(ctx, [], reasons.length > 0),
      entity: entityOf(ctx, local),
      archive: { itemCount: count(rootCounts, category.id) },
      collisions: emptyCollisions(),
    } satisfies SeoDocument;
  });
}

export async function buildTagDocuments(
  ctx: SeoContext,
  where: Prisma.BlogTagWhereInput,
): Promise<SeoDocument[]> {
  const root = ctx.root;
  const local = localOf(ctx, root);
  const tags = await prisma.blogTag.findMany({ where });
  if (tags.length === 0) return [];
  const ids = tags.map((tag) => tag.id);
  const [rootCounts, anyCounts, archiveContent] = await Promise.all([
    prisma.blogPostTag.groupBy({
      by: ['tagId'],
      where: { tagId: { in: ids }, post: publishedPostWhere(root.id) },
      _count: { _all: true },
    }),
    prisma.blogPostTag.groupBy({
      by: ['tagId'],
      where: { tagId: { in: ids }, post: publishedPostWhere() },
      _count: { _all: true },
    }),
    archiveContentFor(ctx),
  ]);
  const count = (rows: typeof rootCounts, id: string) => rows.find((row) => row.tagId === id)?._count._all ?? 0;
  const listing = tags.map((tag) => archiveContent(count(rootCounts, tag.id)));
  const exclusionBase = blogSitemapExclusion(ctx);

  return tags.map((tag, index) => {
    const path = tagPath(tag);
    const title = renderTitle(ctx, local, { seo: [tag.seoTitle], fallback: [`${tag.name} articles`] });
    const description = renderDescription(local, { seo: [tag.seoDescription], fallback: [tag.description] });
    const reasons = noIndexReasons(ctx, local, { entity: tag.noIndex });
    const exclusion =
      exclusionBase ??
      (!tag.isActive
        ? 'the tag is hidden'
        : count(anyCounts, tag.id) === 0
          ? 'the tag has no published articles yet'
          : null);
    return {
      entityType: 'BLOG_TAG',
      entityId: tag.id,
      kind: 'tag',
      name: tag.name,
      country: countryRef(root),
      path,
      slug: path.replace(/^\//, ''),
      absoluteUrl: absolute(ctx, path),
      editPath: editPathFor('BLOG_TAG', tag.id),
      status: { value: 'PUBLISHED', live: root.isActive, publishedAt: null, notServedReason: null },
      updatedAt: (tag.updatedAt ?? tag.createdAt).toISOString(),
      meta: {
        ...title,
        ...description,
        canonical: renderCanonical(ctx, root, tag.canonicalUrl, path),
        keywords: [],
        keywordsSource: 'none',
      },
      robots: robotsOf(ctx, path, {
        reasons,
        noFollow: false,
        inSitemap: !tag.noIndex && !exclusion,
        sitemapExclusion: exclusion,
      }),
      social: socialOf(ctx, local, { title: title.title, description: description.description }),
      content: listing[index]!,
      schema: [...siteJsonLd(root, local, ctx.site), blogTagJsonLd(root, { id: tag.id, name: tag.name, slug: tag.slug })],
      alternates: alternatesOf(ctx, [], reasons.length > 0),
      entity: entityOf(ctx, local),
      archive: { itemCount: count(rootCounts, tag.id) },
      collisions: emptyCollisions(),
    } satisfies SeoDocument;
  });
}

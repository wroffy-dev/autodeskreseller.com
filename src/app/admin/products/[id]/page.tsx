import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { ExternalLink, LayoutTemplate } from 'lucide-react';
import { prisma } from '@/lib/db/prisma';
import { requirePermission, userCan } from '@/lib/auth/guards';
import { AdminPageHeader } from '@/components/admin/page-header';
import { ProductForm, type ProductFormValues } from '@/components/admin/products/product-form';
import { effectivePattern, patternHint } from '@/lib/urls/hints';
import {
  ProductCountryPricing,
  type ProductCountryValues,
} from '@/components/admin/products/product-country-pricing';
import { listAccessibleCountries } from '@/lib/country/access';
import { scopeForUser } from '@/lib/country/admin';
import { productHref } from '@/lib/urls/links';
import { getUrlSnapshot } from '@/lib/urls/load';
import { ContentStatusBadge } from '@/components/admin/lead-status-badge';
import { buttonClasses } from '@/components/ui/button';
import { decimalToString } from '@/lib/utils/money';
import { primaryKeywords } from '@/lib/seo/keywords';
import type { SpecItem } from '@/components/admin/list-editor';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const product = await prisma.product.findUnique({ where: { id }, select: { name: true } });
  return { title: product ? `Edit ${product.name}` : 'Product' };
}

function toLocalInput(date: Date | null): string {
  if (!date) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function asStringArray(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.map((v) => String(v)) : [];
}

function asSpecs(raw: unknown): SpecItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s): s is { label?: unknown; value?: unknown } => typeof s === 'object' && s !== null)
    .map((s) => ({ label: String(s.label ?? ''), value: String(s.value ?? '') }));
}

export default async function EditProduct({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission('products.view');
  const { id } = await params;

  const [product, categories, brands, forms, countries, scope] = await Promise.all([
    prisma.product.findFirst({
      where: { id, deletedAt: null },
      include: {
        ctaForm: { select: { slug: true } },
        countries: true,
        _count: { select: { leads: true } },
      },
    }),
    prisma.productCategory.findMany({
      where: { deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true },
    }),
    prisma.brand.findMany({
      where: { deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true },
    }),
    prisma.form.findMany({
      where: { deletedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, slug: true, name: true },
    }),
    listAccessibleCountries(user),
    scopeForUser(user),
  ]);
  if (!product) notFound();

  const initial: ProductFormValues = {
    id: product.id,
    name: product.name,
    slug: product.slug,
    sku: product.sku ?? '',
    status: product.status,
    publishedAt: toLocalInput(product.publishedAt),
    isFeatured: product.isFeatured,
    sortOrder: String(product.sortOrder),
    featuredOrder: String(product.featuredOrder),
    shortDescription: product.shortDescription ?? '',
    description: product.description ?? '',
    storage: product.storage ?? '',
    minUsers: product.minUsers === null ? '' : String(product.minUsers),
    maxUsers: product.maxUsers === null ? '' : String(product.maxUsers),
    billingPeriod: product.billingPeriod,
    currency: product.currency,
    monthlyPrice: decimalToString(product.monthlyPrice) ?? '',
    annualPrice: decimalToString(product.annualPrice) ?? '',
    compareAtPrice: decimalToString(product.compareAtPrice) ?? '',
    discountPercent: product.discountPercent === null ? '' : String(product.discountPercent),
    priceSuffix: product.priceSuffix ?? '',
    priceNote: product.priceNote ?? '',
    features: asStringArray(product.features),
    benefits: asStringArray(product.benefits),
    specs: asSpecs(product.specs),
    ctaLabel: product.ctaLabel ?? '',
    ctaUrl: product.ctaUrl ?? '',
    ctaFormSlug: product.ctaForm?.slug ?? '',
    imageId: product.imageId,
    galleryIds: asStringArray(product.galleryIds),
    ogImageId: product.ogImageId,
    categoryId: product.categoryId ?? '',
    brandId: product.brandId ?? '',
    seoTitle: product.seoTitle ?? '',
    seoDescription: product.seoDescription ?? '',
    canonicalUrl: product.canonicalUrl ?? '',
    noIndex: product.noIndex,
    primaryKeyword1: product.primaryKeyword1 ?? '',
    primaryKeyword2: product.primaryKeyword2 ?? '',
    primaryKeyword3: product.primaryKeyword3 ?? '',
  };

  /*
   * One row per market the editor can reach, whether or not the product is
   * already sold there. A market with no stored row starts from the shared
   * product's values as a sensible draft, but is saved only when somebody
   * deliberately puts the product on sale there.
   */
  const countryRows: ProductCountryValues[] = countries.map((country) => {
    const row = product.countries.find((entry) => entry.countryId === country.id);
    return {
      countryId: country.id,
      countryName: country.name,
      countryCode: country.code,
      defaultCurrency: country.currency,
      exists: Boolean(row),
      status: row?.status ?? 'DRAFT',
      isFeatured: row?.isFeatured ?? false,
      sortOrder: String(row?.sortOrder ?? product.sortOrder),
      featuredOrder: String(row?.featuredOrder ?? product.featuredOrder),
      currency: row?.currency ?? country.currency,
      monthlyPrice: decimalToString(row?.monthlyPrice) ?? '',
      annualPrice: decimalToString(row?.annualPrice) ?? '',
      compareAtPrice: decimalToString(row?.compareAtPrice) ?? '',
      discountPercent: row?.discountPercent === null || row?.discountPercent === undefined
        ? ''
        : String(row.discountPercent),
      priceSuffix: row?.priceSuffix ?? '',
      priceNote: row?.priceNote ?? '',
      shortDescription: row?.shortDescription ?? '',
      ctaLabel: row?.ctaLabel ?? '',
      ctaUrl: row?.ctaUrl ?? '',
      ctaFormId: row?.ctaFormId ?? '',
      seoTitle: row?.seoTitle ?? '',
      seoDescription: row?.seoDescription ?? '',
      canonicalUrl: row?.canonicalUrl ?? '',
      noIndex: row?.noIndex ?? false,
      primaryKeyword1: row?.primaryKeyword1 ?? '',
      primaryKeyword2: row?.primaryKeyword2 ?? '',
      primaryKeyword3: row?.primaryKeyword3 ?? '',
    };
  });

  // "View live" points at a market that actually publishes the product, at
  // the address the URL registry has for it there.
  await getUrlSnapshot();
  const liveIn = countries.find((country) =>
    product.countries.some(
      (entry) => entry.countryId === country.id && entry.status === 'PUBLISHED',
    ),
  );

  return (
    <div className="max-w-3xl">
      <AdminPageHeader
        title={product.name}
        description={`${product._count.leads} lead(s) attributed to this product`}
        crumbs={[{ label: 'Products', href: '/admin/products' }, { label: product.name }]}
        actions={
          <>
            <ContentStatusBadge status={product.status} />
            {/* This product's own page layout: its sections, in its order. */}
            <Link
              href={`/admin/products/${product.id}/layout`}
              className={buttonClasses('outline', 'sm')}
            >
              <LayoutTemplate className="h-4 w-4" aria-hidden="true" />
              Page layout
            </Link>
            {liveIn ? (
              <Link
                href={productHref(liveIn, product)}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonClasses('outline', 'sm')}
              >
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
                View live
              </Link>
            ) : null}
          </>
        }
      />
      <ProductForm
        initial={initial}
        categories={categories}
        brands={brands}
        formIdBySlug={Object.fromEntries(forms.map((f) => [f.slug, f.id]))}
        mode="edit"
        // Saving this form updates the product in the market being worked
        // in, so that is the product page its SEO score describes.
        seoMarket={{ id: scope.country.id, name: scope.country.name }}
        urlHint={patternHint(await effectivePattern('PRODUCT', scope.country.id), scope.country.slug)}
      />

      <ProductCountryPricing
        productId={product.id}
        rows={countryRows}
        forms={forms.map((form) => ({ id: form.id, name: form.name }))}
        canEdit={userCan(user, 'products.edit')}
        sharedKeywords={primaryKeywords(product)}
      />
    </div>
  );
}

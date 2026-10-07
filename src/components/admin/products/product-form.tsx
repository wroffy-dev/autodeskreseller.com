'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createProduct, updateProduct } from '@/lib/actions/products';
import { Field, Input, Textarea, Select, Switch } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { AdminTabs, TabPanel } from '@/components/admin/admin-tabs';
import { MediaPicker } from '@/components/admin/media-picker';
import { GalleryPicker } from '@/components/admin/gallery-picker';
import { RichTextEditor } from '@/components/cms/rich-text-editor';
import { StringListEditor, SpecListEditor, type SpecItem } from '@/components/admin/list-editor';
import { PrimaryKeywordsFields } from '@/components/admin/seo/primary-keywords-fields';
import { SeoScorePanel } from '@/components/admin/seo/seo-score-panel';
import { jumpResolver } from '@/components/admin/seo/jump';
import { FormSelect } from '@/components/cms/form-select';
import { useToast } from '@/components/ui/toast';
import { Spinner } from '@/components/ui/icons';
import { slugify } from '@/lib/utils/slug';
import { SUPPORTED_CURRENCIES, formatMoney } from '@/lib/utils/money';
import { cn } from '@/lib/utils/cn';

export type ProductFormValues = {
  id?: string;
  name: string;
  slug: string;
  sku: string;
  status: string;
  publishedAt: string;
  isFeatured: boolean;
  sortOrder: string;
  shortDescription: string;
  description: string;
  storage: string;
  minUsers: string;
  maxUsers: string;
  billingPeriod: string;
  currency: string;
  monthlyPrice: string;
  annualPrice: string;
  compareAtPrice: string;
  discountPercent: string;
  priceSuffix: string;
  priceNote: string;
  features: string[];
  benefits: string[];
  specs: SpecItem[];
  ctaLabel: string;
  ctaUrl: string;
  ctaFormSlug: string;
  imageId: string | null;
  galleryIds: string[];
  ogImageId: string | null;
  categoryId: string;
  brandId: string;
  featuredOrder: string;
  seoTitle: string;
  seoDescription: string;
  canonicalUrl: string;
  noIndex: boolean;
  primaryKeyword1: string;
  primaryKeyword2: string;
  primaryKeyword3: string;
};

export const EMPTY_PRODUCT: ProductFormValues = {
  name: '',
  slug: '',
  sku: '',
  status: 'DRAFT',
  publishedAt: '',
  isFeatured: false,
  sortOrder: '0',
  shortDescription: '',
  description: '',
  storage: '',
  minUsers: '',
  maxUsers: '',
  billingPeriod: 'BOTH',
  currency: 'INR',
  monthlyPrice: '',
  annualPrice: '',
  compareAtPrice: '',
  discountPercent: '',
  priceSuffix: 'per user / month',
  priceNote: '',
  features: [],
  benefits: [],
  specs: [],
  ctaLabel: 'Get Started',
  ctaUrl: '',
  ctaFormSlug: '',
  imageId: null,
  galleryIds: [],
  ogImageId: null,
  categoryId: '',
  brandId: '',
  featuredOrder: '0',
  seoTitle: '',
  seoDescription: '',
  canonicalUrl: '',
  noIndex: false,
  primaryKeyword1: '',
  primaryKeyword2: '',
  primaryKeyword3: '',
};

const TABS = [
  { id: 'details', label: 'Details' },
  { id: 'pricing', label: 'Pricing' },
  { id: 'content', label: 'Features' },
  { id: 'cta', label: 'Call to action' },
  { id: 'seo', label: 'SEO' },
] as const;

type TabId = (typeof TABS)[number]['id'];

/** Where each field an SEO check can point at lives on this form. */
const SEO_FIELDS: Partial<Record<string, { tab: TabId; id: string }>> = {
  name: { tab: 'details', id: 'name' },
  slug: { tab: 'details', id: 'slug' },
  status: { tab: 'details', id: 'status' },
  content: { tab: 'details', id: 'product-description' },
  specs: { tab: 'content', id: 'product-specs' },
  seoTitle: { tab: 'seo', id: 'seoTitle' },
  seoDescription: { tab: 'seo', id: 'seoDescription' },
  canonicalUrl: { tab: 'seo', id: 'canonicalUrl' },
  noIndex: { tab: 'seo', id: 'noIndex' },
  primaryKeyword1: { tab: 'seo', id: 'primaryKeyword1' },
  ogImage: { tab: 'seo', id: 'product-og-image' },
};

export function ProductForm({
  initial,
  categories,
  brands,
  formIdBySlug,
  mode,
  seoMarket = null,
  urlHint = '/products/…',
}: {
  initial: ProductFormValues;
  categories: Array<{ id: string; name: string }>;
  brands: Array<{ id: string; name: string }>;
  formIdBySlug: Record<string, string>;
  mode: 'create' | 'edit';
  /**
   * The market this form saves prices and status into, which is the product
   * page the SEO score describes. Null before the product exists.
   */
  seoMarket?: { id: string; name: string } | null;
  /** Where products live, from the URL pattern the site serves now. */
  urlHint?: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [values, setValues] = React.useState(initial);
  const [errors, setErrors] = React.useState<Record<string, string[]>>({});
  const [pending, setPending] = React.useState(false);
  const [tab, setTab] = React.useState<TabId>('details');
  const [slugTouched, setSlugTouched] = React.useState(mode === 'edit');

  const set = <K extends keyof ProductFormValues>(key: K, value: ProductFormValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  const productId = initial.id;
  const resolveJump = React.useMemo(
    () =>
      jumpResolver<TabId>({
        fields: SEO_FIELDS,
        areas: {
          general: { tab: 'details', label: 'Go to details' },
          content: { tab: 'details', id: 'product-description', label: 'Go to description' },
          media: { tab: 'details', id: 'product-image', label: 'Go to images' },
          pricing: { tab: 'pricing', label: 'Go to pricing' },
          seo: { tab: 'seo', label: 'Go to SEO settings' },
          ...(productId
            ? {
                sections: {
                  label: 'Open page layout',
                  run: () => {
                    window.open(`/admin/products/${productId}/layout`, '_blank', 'noopener');
                  },
                },
              }
            : {}),
        },
        openTab: setTab,
      }),
    [productId],
  );

  // What the score panel scores: the form as it stands, saved or not.
  const seoDraft = {
    name: values.name,
    slug: values.slug,
    sku: values.sku,
    status: values.status,
    shortDescription: values.shortDescription,
    description: values.description,
    storage: values.storage,
    minUsers: values.minUsers,
    maxUsers: values.maxUsers,
    features: values.features,
    benefits: values.benefits,
    specs: values.specs,
    imageId: values.imageId,
    galleryIds: values.galleryIds,
    categoryId: values.categoryId,
    brandId: values.brandId,
    currency: values.currency,
    monthlyPrice: values.monthlyPrice,
    annualPrice: values.annualPrice,
    priceSuffix: values.priceSuffix,
    priceNote: values.priceNote,
    ctaLabel: values.ctaLabel,
    seoTitle: values.seoTitle,
    seoDescription: values.seoDescription,
    canonicalUrl: values.canonicalUrl,
    noIndex: values.noIndex,
    ogImageId: values.ogImageId,
    primaryKeyword1: values.primaryKeyword1,
    primaryKeyword2: values.primaryKeyword2,
    primaryKeyword3: values.primaryKeyword3,
  };

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setErrors({});

    const data = new FormData();
    const simple: Array<keyof ProductFormValues> = [
      'name',
      'slug',
      'sku',
      'status',
      'publishedAt',
      'sortOrder',
      'shortDescription',
      'description',
      'storage',
      'minUsers',
      'maxUsers',
      'billingPeriod',
      'currency',
      'monthlyPrice',
      'annualPrice',
      'compareAtPrice',
      'discountPercent',
      'priceSuffix',
      'priceNote',
      'ctaLabel',
      'ctaUrl',
      'categoryId',
      'brandId',
      'featuredOrder',
      'seoTitle',
      'seoDescription',
      'canonicalUrl',
      'primaryKeyword1',
      'primaryKeyword2',
      'primaryKeyword3',
    ];
    for (const key of simple) data.set(key, String(values[key] ?? ''));
    data.set('isFeatured', String(values.isFeatured));
    data.set('noIndex', String(values.noIndex));
    data.set('imageId', values.imageId ?? '');
    data.set('ogImageId', values.ogImageId ?? '');
    data.set('ctaFormId', values.ctaFormSlug ? (formIdBySlug[values.ctaFormSlug] ?? '') : '');
    data.set('features', JSON.stringify(values.features.filter(Boolean)));
    data.set('benefits', JSON.stringify(values.benefits.filter(Boolean)));
    data.set('specs', JSON.stringify(values.specs.filter((s) => s.label)));
    data.set('galleryIds', JSON.stringify(values.galleryIds));

    const result =
      mode === 'create' ? await createProduct(data) : await updateProduct(initial.id!, data);
    setPending(false);

    if (!result.ok) {
      setErrors(result.fieldErrors ?? {});
      toast(result.error, 'error');
      // Jump to the tab holding the first error so it is never hidden.
      const firstError = Object.keys(result.fieldErrors ?? {})[0];
      if (firstError) setTab(tabForField(firstError));
      return;
    }

    toast(result.message ?? 'Saved.');
    if (mode === 'create' && result.data && 'id' in result.data) {
      router.push(`/admin/products/${(result.data as { id: string }).id}`);
    } else {
      router.refresh();
    }
  }

  const annualSaving =
    values.monthlyPrice && values.annualPrice
      ? Number(values.monthlyPrice) * 12 - Number(values.annualPrice)
      : null;

  return (
    <form onSubmit={onSubmit}>
      <Card>
        <AdminTabs
          tabs={[...TABS]}
          active={tab}
          onChange={(next) => setTab(next as TabId)}
          className="px-3"
        />

        <CardBody className="space-y-4">
          <TabPanel id="details" active={tab} className="space-y-4">
            <>
              <Field label="Product name" htmlFor="name" required error={errors.name}>
                <Input
                  id="name"
                  value={values.name}
                  required
                  onChange={(e) => {
                    set('name', e.target.value);
                    if (!slugTouched) set('slug', slugify(e.target.value));
                  }}
                />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="URL" htmlFor="slug" error={errors.slug} hint={urlHint}>
                  <Input
                    id="slug"
                    value={values.slug}
                    onChange={(e) => {
                      setSlugTouched(true);
                      set('slug', e.target.value);
                    }}
                    onBlur={(e) => set('slug', slugify(e.target.value))}
                  />
                </Field>
                <Field label="SKU / reference" htmlFor="sku" error={errors.sku}>
                  <Input id="sku" value={values.sku} onChange={(e) => set('sku', e.target.value)} />
                </Field>
              </div>

              <Field
                label="Short description"
                htmlFor="shortDescription"
                hint="Shown on product cards and in comparison tables."
                error={errors.shortDescription}
              >
                <Textarea
                  id="shortDescription"
                  rows={2}
                  value={values.shortDescription}
                  onChange={(e) => set('shortDescription', e.target.value)}
                />
              </Field>

              <Field id="product-description" label="Full description" hint="Shown on the product page.">
                <RichTextEditor
                  value={values.description}
                  onChange={(v) => set('description', v)}
                />
              </Field>

              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Storage" htmlFor="storage" hint="e.g. 5 TB">
                  <Input
                    id="storage"
                    value={values.storage}
                    onChange={(e) => set('storage', e.target.value)}
                  />
                </Field>
                <Field label="Minimum users" htmlFor="minUsers" error={errors.minUsers}>
                  <Input
                    id="minUsers"
                    type="number"
                    min={0}
                    value={values.minUsers}
                    onChange={(e) => set('minUsers', e.target.value)}
                  />
                </Field>
                <Field label="Maximum users" htmlFor="maxUsers" error={errors.maxUsers}>
                  <Input
                    id="maxUsers"
                    type="number"
                    min={0}
                    value={values.maxUsers}
                    onChange={(e) => set('maxUsers', e.target.value)}
                  />
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Category" htmlFor="categoryId">
                  <Select
                    id="categoryId"
                    value={values.categoryId}
                    onChange={(e) => set('categoryId', e.target.value)}
                  >
                    <option value="">Uncategorised</option>
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Brand" htmlFor="brandId">
                  <Select
                    id="brandId"
                    value={values.brandId}
                    onChange={(e) => set('brandId', e.target.value)}
                  >
                    <option value="">No brand</option>
                    {brands.map((brand) => (
                      <option key={brand.id} value={brand.id}>
                        {brand.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field
                  label="Sort order"
                  htmlFor="sortOrder"
                  hint="Lower numbers appear first. Drag products on the list page to set this visually."
                >
                  <Input
                    id="sortOrder"
                    type="number"
                    min={0}
                    value={values.sortOrder}
                    onChange={(e) => set('sortOrder', e.target.value)}
                  />
                </Field>
                <Field
                  label="Featured order"
                  htmlFor="featuredOrder"
                  hint="Position among featured products only."
                >
                  <Input
                    id="featuredOrder"
                    type="number"
                    min={0}
                    value={values.featuredOrder}
                    onChange={(e) => set('featuredOrder', e.target.value)}
                    disabled={!values.isFeatured}
                  />
                </Field>
              </div>

              <Field
                id="product-image"
                label="Product image"
                hint="Shown on cards and at the top of the product page."
              >
                <MediaPicker
                  value={values.imageId}
                  onChange={(id) => set('imageId', id)}
                  label="Product image"
                />
              </Field>

              <Field label="Gallery" hint="Additional images. Drag the arrows to reorder.">
                <GalleryPicker
                  value={values.galleryIds}
                  onChange={(next) => set('galleryIds', next)}
                />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Status" htmlFor="status">
                  <Select
                    id="status"
                    value={values.status}
                    onChange={(e) => set('status', e.target.value)}
                  >
                    <option value="DRAFT">Draft</option>
                    <option value="PUBLISHED">Published</option>
                    <option value="SCHEDULED">Scheduled</option>
                    <option value="ARCHIVED">Archived</option>
                  </Select>
                </Field>
                <Field
                  label={values.status === 'SCHEDULED' ? 'Publish at' : 'Published date'}
                  htmlFor="publishedAt"
                  error={errors.publishedAt}
                >
                  <Input
                    id="publishedAt"
                    type="datetime-local"
                    value={values.publishedAt}
                    onChange={(e) => set('publishedAt', e.target.value)}
                  />
                </Field>
              </div>

              <div className="rounded-lg border border-hairline p-4">
                <Switch
                  checked={values.isFeatured}
                  onChange={(next) => set('isFeatured', next)}
                  label="Featured product"
                  hint="Any number of products can be featured. Order them under Products → Featured."
                />
              </div>
            </>
          </TabPanel>

          <TabPanel id="pricing" active={tab} className="space-y-4">
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Currency" htmlFor="currency">
                  <Select
                    id="currency"
                    value={values.currency}
                    onChange={(e) => set('currency', e.target.value)}
                  >
                    {SUPPORTED_CURRENCIES.map((code) => (
                      <option key={code} value={code}>
                        {code}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Billing period" htmlFor="billingPeriod">
                  <Select
                    id="billingPeriod"
                    value={values.billingPeriod}
                    onChange={(e) => set('billingPeriod', e.target.value)}
                  >
                    <option value="BOTH">Monthly and annual</option>
                    <option value="MONTHLY">Monthly only</option>
                    <option value="ANNUAL">Annual only</option>
                    <option value="ONE_TIME">One-time</option>
                  </Select>
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Monthly price"
                  htmlFor="monthlyPrice"
                  error={errors.monthlyPrice}
                  hint="Leave blank for “on request”."
                >
                  <Input
                    id="monthlyPrice"
                    inputMode="decimal"
                    value={values.monthlyPrice}
                    placeholder="1250.00"
                    onChange={(e) => set('monthlyPrice', e.target.value)}
                  />
                </Field>
                <Field label="Annual price" htmlFor="annualPrice" error={errors.annualPrice}>
                  <Input
                    id="annualPrice"
                    inputMode="decimal"
                    value={values.annualPrice}
                    placeholder="12500.00"
                    onChange={(e) => set('annualPrice', e.target.value)}
                  />
                </Field>
              </div>

              {annualSaving !== null && annualSaving > 0 ? (
                <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                  Annual billing saves {formatMoney(String(annualSaving), values.currency)} per year
                  versus paying monthly.
                </p>
              ) : null}

              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Compare-at price"
                  htmlFor="compareAtPrice"
                  error={errors.compareAtPrice}
                  hint="Shown struck through next to the monthly price."
                >
                  <Input
                    id="compareAtPrice"
                    inputMode="decimal"
                    value={values.compareAtPrice}
                    onChange={(e) => set('compareAtPrice', e.target.value)}
                  />
                </Field>
                <Field label="Discount %" htmlFor="discountPercent" error={errors.discountPercent}>
                  <Input
                    id="discountPercent"
                    type="number"
                    min={0}
                    max={100}
                    value={values.discountPercent}
                    onChange={(e) => set('discountPercent', e.target.value)}
                  />
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Price suffix" htmlFor="priceSuffix" hint="e.g. per user / month">
                  <Input
                    id="priceSuffix"
                    value={values.priceSuffix}
                    onChange={(e) => set('priceSuffix', e.target.value)}
                  />
                </Field>
                <Field
                  label="Price note"
                  htmlFor="priceNote"
                  hint="Used instead of a price when both prices are blank."
                >
                  <Input
                    id="priceNote"
                    value={values.priceNote}
                    placeholder="Custom pricing"
                    onChange={(e) => set('priceNote', e.target.value)}
                  />
                </Field>
              </div>
            </>
          </TabPanel>

          <TabPanel id="content" active={tab} className="space-y-4">
            <>
              <StringListEditor
                label="Features"
                itemLabel="feature"
                value={values.features}
                onChange={(next) => set('features', next)}
                placeholder="5 TB shared team storage"
              />
              <StringListEditor
                label="Benefits"
                itemLabel="benefit"
                value={values.benefits}
                onChange={(next) => set('benefits', next)}
                placeholder="Replace ageing file servers without retraining"
              />
              <div id="product-specs">
                <SpecListEditor
                  label="Specifications"
                  value={values.specs}
                  onChange={(next) => set('specs', next)}
                />
              </div>
            </>
          </TabPanel>

          <TabPanel id="cta" active={tab} className="space-y-4">
            <>
              <p className="rounded-lg bg-sky-50 px-3 py-2.5 text-sm text-sky-900">
                There is no checkout. The product button captures a lead — pick the form it should
                open. Every lead records the product, page, button label and campaign attribution.
              </p>
              <Field label="Button label" htmlFor="ctaLabel">
                <Input
                  id="ctaLabel"
                  value={values.ctaLabel}
                  placeholder="Get Started"
                  onChange={(e) => set('ctaLabel', e.target.value)}
                />
              </Field>
              <Field
                label="Lead form"
                htmlFor="ctaFormSlug"
                hint="Opens in a dialog when the button is clicked."
              >
                <FormSelect
                  id="ctaFormSlug"
                  value={values.ctaFormSlug}
                  onChange={(v) => set('ctaFormSlug', v)}
                />
              </Field>
              <Field
                label="Button link"
                htmlFor="ctaUrl"
                hint="Used only when no form is selected — for example a dedicated landing page."
              >
                <Input
                  id="ctaUrl"
                  value={values.ctaUrl}
                  placeholder="/contact"
                  onChange={(e) => set('ctaUrl', e.target.value)}
                />
              </Field>
            </>
          </TabPanel>

          <TabPanel id="seo" active={tab} className="space-y-4">
            <>
              <SeoScorePanel
                entity={
                  productId && seoMarket
                    ? { type: 'PRODUCT_MARKET', id: productId, countryId: seoMarket.id }
                    : null
                }
                marketName={seoMarket?.name}
                payload={{ productDraft: seoDraft }}
                resolveJump={resolveJump}
                emptyMessage="Save this product to see its SEO, AEO and GEO scores. From then on they update as you edit."
              />
              <Field
                label="SEO title"
                htmlFor="seoTitle"
                hint={`${values.seoTitle.length}/60 characters used.`}
              >
                <Input
                  id="seoTitle"
                  value={values.seoTitle}
                  placeholder={values.name}
                  onChange={(e) => set('seoTitle', e.target.value)}
                />
              </Field>
              <Field
                label="Meta description"
                htmlFor="seoDescription"
                hint={`${values.seoDescription.length} characters. Aim for 140–160.`}
              >
                <Textarea
                  id="seoDescription"
                  rows={3}
                  value={values.seoDescription}
                  placeholder={values.shortDescription}
                  onChange={(e) => set('seoDescription', e.target.value)}
                />
              </Field>
              <PrimaryKeywordsFields
                values={values}
                onChange={(field, value) => set(field, value)}
                errors={errors}
                description="The searches this product is written to answer, in every market that does not set its own under Country pricing. SEO Intelligence checks for them in the title, description, URL, headings and copy. They are analysis inputs only: nothing is added to the page’s markup."
              />
              <Field label="Canonical URL" htmlFor="canonicalUrl">
                <Input
                  id="canonicalUrl"
                  value={values.canonicalUrl}
                  onChange={(e) => set('canonicalUrl', e.target.value)}
                />
              </Field>
              <Field id="product-og-image" label="Social share image" hint="Recommended 1200×630.">
                <MediaPicker
                  value={values.ogImageId}
                  onChange={(id) => set('ogImageId', id)}
                  label="OG image"
                />
              </Field>
              <div className="rounded-lg border border-hairline p-4">
                <Switch
                  id="noIndex"
                  checked={values.noIndex}
                  onChange={(next) => set('noIndex', next)}
                  label="Hide from search engines (noindex)"
                />
              </div>
            </>
          </TabPanel>
        </CardBody>

        <div className="flex items-center justify-end gap-2 border-t border-hairline bg-muted/[0.03] px-4 py-3 sm:px-5">
          <Link
            href="/admin/products"
            className="rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:text-content"
          >
            Cancel
          </Link>
          <Button type="submit" disabled={pending}>
            {pending ? (
              <>
                <Spinner className="h-4 w-4 animate-spin" aria-hidden="true" />
                Saving…
              </>
            ) : mode === 'create' ? (
              'Create product'
            ) : (
              'Save product'
            )}
          </Button>
        </div>
      </Card>
    </form>
  );
}

function tabForField(field: string): TabId {
  if (
    ['monthlyPrice', 'annualPrice', 'compareAtPrice', 'discountPercent', 'currency'].includes(field)
  ) {
    return 'pricing';
  }
  if (['features', 'benefits', 'specs'].includes(field)) return 'content';
  if (['ctaLabel', 'ctaUrl', 'ctaFormId'].includes(field)) return 'cta';
  if (
    [
      'seoTitle',
      'seoDescription',
      'canonicalUrl',
      'noIndex',
      'primaryKeyword1',
      'primaryKeyword2',
      'primaryKeyword3',
    ].includes(field)
  ) {
    return 'seo';
  }
  return 'details';
}

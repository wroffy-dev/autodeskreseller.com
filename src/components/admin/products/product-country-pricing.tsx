'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash } from 'lucide-react';
import { saveProductCountry, removeProductCountry } from '@/lib/actions/countries';
import { Card, CardBody } from '@/components/ui/card';
import { Field, Input, Select, Textarea, Switch } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/dialog';
import { AdminTabs } from '@/components/admin/admin-tabs';
import { SettingsSection, SettingsDivider } from '@/components/admin/settings-section';
import { useToast } from '@/components/ui/toast';
import { Spinner } from '@/components/ui/icons';
import { SUPPORTED_CURRENCIES } from '@/lib/utils/money';
import { PrimaryKeywordsFields } from '@/components/admin/seo/primary-keywords-fields';
import { SeoScorePanel } from '@/components/admin/seo/seo-score-panel';
import { jumpResolver } from '@/components/admin/seo/jump';
import type { PrimaryKeywordField } from '@/lib/seo/keywords';

/** The fields of this panel an SEO check can point at. */
const SEO_FIELDS = {
  status: { id: 'pc-status' },
  seoTitle: { id: 'pc-seo-title' },
  seoDescription: { id: 'pc-seo-description' },
  canonicalUrl: { id: 'pc-canonical' },
  noIndex: { id: 'pc-noindex' },
  primaryKeyword1: { id: 'pc-primaryKeyword1' },
};

const resolveJump = jumpResolver({ fields: SEO_FIELDS });

/**
 * A product's configuration per market.
 *
 * The product record above this panel stays the global master — name, SKU,
 * brand, category, specification and imagery are the same product everywhere.
 * What each market owns is whether it sells the product at all, at what price,
 * in which currency, with what local copy, call to action and SEO.
 *
 * Prices are entered, never converted. A market with no row here does not sell
 * the product, which is deliberately different from selling it at no price.
 */

export type ProductCountryValues = {
  countryId: string;
  countryName: string;
  countryCode: string;
  defaultCurrency: string;
  /** False when this market does not sell the product yet. */
  exists: boolean;
  status: string;
  isFeatured: boolean;
  sortOrder: string;
  featuredOrder: string;
  currency: string;
  monthlyPrice: string;
  annualPrice: string;
  compareAtPrice: string;
  discountPercent: string;
  priceSuffix: string;
  priceNote: string;
  shortDescription: string;
  ctaLabel: string;
  ctaUrl: string;
  ctaFormId: string;
  seoTitle: string;
  seoDescription: string;
  canonicalUrl: string;
  noIndex: boolean;
  primaryKeyword1: string;
  primaryKeyword2: string;
  primaryKeyword3: string;
};

export function ProductCountryPricing({
  productId,
  rows,
  forms,
  canEdit,
  sharedKeywords = [],
}: {
  productId: string;
  rows: ProductCountryValues[];
  forms: Array<{ id: string; name: string }>;
  canEdit: boolean;
  /** The product's own keywords, which a market with none of its own uses. */
  sharedKeywords?: string[];
}) {
  const [errors, setErrors] = React.useState<Record<string, string[]>>({});
  const router = useRouter();
  const { toast } = useToast();
  const [values, setValues] = React.useState(rows);
  const [activeId, setActiveId] = React.useState(rows[0]?.countryId ?? '');
  const [pending, setPending] = React.useState(false);
  const [confirmRemove, setConfirmRemove] = React.useState<ProductCountryValues | null>(null);

  // A market added or removed elsewhere reloads the panel from the server.
  React.useEffect(() => {
    setValues(rows);
    setActiveId((current) => (rows.some((row) => row.countryId === current) ? current : rows[0]?.countryId ?? ''));
  }, [rows]);

  if (values.length === 0) return null;

  const active = values.find((row) => row.countryId === activeId) ?? values[0];
  if (!active) return null;

  const set = (patch: Partial<ProductCountryValues>) =>
    setValues((current) =>
      current.map((row) => (row.countryId === active.countryId ? { ...row, ...patch } : row)),
    );

  async function save(row: ProductCountryValues) {
    setPending(true);
    const data = new FormData();
    data.set('productId', productId);
    data.set('countryId', row.countryId);
    data.set('status', row.status);
    data.set('isFeatured', String(row.isFeatured));
    data.set('sortOrder', row.sortOrder || '0');
    data.set('featuredOrder', row.featuredOrder || '0');
    data.set('currency', row.currency || row.defaultCurrency);
    data.set('monthlyPrice', row.monthlyPrice);
    data.set('annualPrice', row.annualPrice);
    data.set('compareAtPrice', row.compareAtPrice);
    data.set('discountPercent', row.discountPercent);
    data.set('priceSuffix', row.priceSuffix);
    data.set('priceNote', row.priceNote);
    data.set('shortDescription', row.shortDescription);
    data.set('ctaLabel', row.ctaLabel);
    data.set('ctaUrl', row.ctaUrl);
    data.set('ctaFormId', row.ctaFormId);
    data.set('seoTitle', row.seoTitle);
    data.set('seoDescription', row.seoDescription);
    data.set('canonicalUrl', row.canonicalUrl);
    data.set('noIndex', String(row.noIndex));
    data.set('primaryKeyword1', row.primaryKeyword1);
    data.set('primaryKeyword2', row.primaryKeyword2);
    data.set('primaryKeyword3', row.primaryKeyword3);

    setErrors({});
    const result = await saveProductCountry(data);
    setPending(false);
    if (!result.ok) {
      setErrors(result.fieldErrors ?? {});
      toast(result.error, 'error');
      return;
    }
    toast(result.message ?? 'Saved.');
    router.refresh();
  }

  return (
    <Card className="mt-6">
      <div className="border-b border-hairline px-4 py-3 sm:px-5">
        <h2 className="font-heading text-sm font-semibold text-content">Country pricing</h2>
        <p className="mt-0.5 text-xs leading-relaxed text-muted">
          The details above are shared by every country. Set what this product costs and says in
          each market here. A country with no pricing does not sell this product.
        </p>
      </div>

      <div className="px-4 pt-3 sm:px-5">
        <AdminTabs
          tabs={values.map((row) => ({
            id: row.countryId,
            label: row.countryName,
            badge: row.exists ? undefined : '—',
          }))}
          active={active.countryId}
          onChange={setActiveId}
        />
      </div>

      <CardBody className="divide-y divide-hairline py-0">
        <SettingsSection
          title={`${active.countryName} availability`}
          description="Publishing here puts the product on that country's storefront only."
          actions={
            <Badge tone={active.exists && active.status === 'PUBLISHED' ? 'success' : 'neutral'}>
              {!active.exists ? 'Not sold' : active.status === 'PUBLISHED' ? 'Live' : 'Draft'}
            </Badge>
          }
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Status" htmlFor="pc-status">
              <Select
                id="pc-status"
                value={active.status}
                disabled={!canEdit}
                onChange={(e) => set({ status: e.target.value })}
              >
                <option value="DRAFT">Draft</option>
                <option value="PUBLISHED">Published</option>
                <option value="ARCHIVED">Archived</option>
              </Select>
            </Field>
            <Field label="Catalogue order" htmlFor="pc-sort" hint="Lower numbers appear first.">
              <Input
                id="pc-sort"
                type="number"
                min={0}
                value={active.sortOrder}
                disabled={!canEdit}
                onChange={(e) => set({ sortOrder: e.target.value })}
              />
            </Field>
            <div className="sm:col-span-2">
              <Switch
                checked={active.isFeatured}
                onChange={(next) => set({ isFeatured: next })}
                label="Featured in this country"
                hint="Featured ordering is per country — a plan can lead one market and sit third in another."
              />
            </div>
            <Field label="Featured order" htmlFor="pc-featured-order">
              <Input
                id="pc-featured-order"
                type="number"
                min={0}
                value={active.featuredOrder}
                disabled={!canEdit}
                onChange={(e) => set({ featuredOrder: e.target.value })}
              />
            </Field>
          </div>
        </SettingsSection>

        <SettingsDivider />

        <SettingsSection
          title="Pricing"
          description="Entered per country and never converted from another market's currency."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Currency" htmlFor="pc-currency">
              <Select
                id="pc-currency"
                value={active.currency}
                disabled={!canEdit}
                onChange={(e) => set({ currency: e.target.value })}
              >
                {SUPPORTED_CURRENCIES.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Monthly price" htmlFor="pc-monthly">
              <Input
                id="pc-monthly"
                inputMode="decimal"
                value={active.monthlyPrice}
                disabled={!canEdit}
                onChange={(e) => set({ monthlyPrice: e.target.value })}
              />
            </Field>
            <Field label="Annual price" htmlFor="pc-annual">
              <Input
                id="pc-annual"
                inputMode="decimal"
                value={active.annualPrice}
                disabled={!canEdit}
                onChange={(e) => set({ annualPrice: e.target.value })}
              />
            </Field>
            <Field label="Compare-at price" htmlFor="pc-compare">
              <Input
                id="pc-compare"
                inputMode="decimal"
                value={active.compareAtPrice}
                disabled={!canEdit}
                onChange={(e) => set({ compareAtPrice: e.target.value })}
              />
            </Field>
            <Field label="Discount %" htmlFor="pc-discount">
              <Input
                id="pc-discount"
                type="number"
                min={0}
                max={100}
                value={active.discountPercent}
                disabled={!canEdit}
                onChange={(e) => set({ discountPercent: e.target.value })}
              />
            </Field>
            <Field label="Price suffix" htmlFor="pc-suffix">
              <Input
                id="pc-suffix"
                value={active.priceSuffix}
                placeholder="per user / month"
                disabled={!canEdit}
                onChange={(e) => set({ priceSuffix: e.target.value })}
              />
            </Field>
            <Field
              label="Price note"
              htmlFor="pc-note"
              hint="Shown instead of a price when no monthly price is set."
            >
              <Input
                id="pc-note"
                value={active.priceNote}
                disabled={!canEdit}
                onChange={(e) => set({ priceNote: e.target.value })}
              />
            </Field>
          </div>
        </SettingsSection>

        <SettingsDivider />

        <SettingsSection
          title="Local copy and CTA"
          description="Anything left blank falls back to the shared product above."
        >
          <Field label="Short description" htmlFor="pc-short">
            <Textarea
              id="pc-short"
              rows={3}
              value={active.shortDescription}
              disabled={!canEdit}
              onChange={(e) => set({ shortDescription: e.target.value })}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Button label" htmlFor="pc-cta-label">
              <Input
                id="pc-cta-label"
                value={active.ctaLabel}
                disabled={!canEdit}
                onChange={(e) => set({ ctaLabel: e.target.value })}
              />
            </Field>
            <Field
              label="Button URL"
              htmlFor="pc-cta-url"
              hint="A path is resolved inside this country."
            >
              <Input
                id="pc-cta-url"
                value={active.ctaUrl}
                disabled={!canEdit}
                onChange={(e) => set({ ctaUrl: e.target.value })}
              />
            </Field>
            <Field label="Button form" htmlFor="pc-cta-form">
              <Select
                id="pc-cta-form"
                value={active.ctaFormId}
                disabled={!canEdit}
                onChange={(e) => set({ ctaFormId: e.target.value })}
              >
                <option value="">Use the shared product form</option>
                {forms.map((form) => (
                  <option key={form.id} value={form.id}>
                    {form.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </SettingsSection>

        <SettingsDivider />

        <SettingsSection
          title="SEO"
          description="This country's product page canonicals to its own URL, never to another market's."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="SEO title" htmlFor="pc-seo-title">
              <Input
                id="pc-seo-title"
                value={active.seoTitle}
                disabled={!canEdit}
                onChange={(e) => set({ seoTitle: e.target.value })}
              />
            </Field>
            <Field label="Canonical URL" htmlFor="pc-canonical">
              <Input
                id="pc-canonical"
                value={active.canonicalUrl}
                disabled={!canEdit}
                onChange={(e) => set({ canonicalUrl: e.target.value })}
              />
            </Field>
          </div>
          <Field label="Meta description" htmlFor="pc-seo-description">
            <Textarea
              id="pc-seo-description"
              rows={3}
              value={active.seoDescription}
              disabled={!canEdit}
              onChange={(e) => set({ seoDescription: e.target.value })}
            />
          </Field>
          <PrimaryKeywordsFields
            idPrefix="pc-"
            values={active}
            onChange={(field: PrimaryKeywordField, value) => set({ [field]: value })}
            errors={errors}
            disabled={!canEdit}
            placeholders={{
              primaryKeyword1: sharedKeywords[0] ?? '',
              primaryKeyword2: sharedKeywords[1] ?? '',
              primaryKeyword3: sharedKeywords[2] ?? '',
            }}
            description={
              sharedKeywords.length > 0
                ? `Leave all three blank to use the product's own keywords (shown in grey). Set any to target different searches in ${active.countryName}.`
                : `The searches this product page should answer in ${active.countryName}. Blank uses the product's own keywords, set under SEO above.`
            }
          />
          <Switch
            id="pc-noindex"
            checked={active.noIndex}
            onChange={(next) => set({ noIndex: next })}
            label="Hide from search engines in this country"
          />
          <SeoScorePanel
            key={active.countryId}
            entity={{ type: 'PRODUCT_MARKET', id: productId, countryId: active.countryId }}
            marketName={active.countryName}
            payload={{
              marketDraft: {
                status: active.status,
                currency: active.currency,
                monthlyPrice: active.monthlyPrice,
                annualPrice: active.annualPrice,
                compareAtPrice: active.compareAtPrice,
                priceSuffix: active.priceSuffix,
                priceNote: active.priceNote,
                shortDescription: active.shortDescription,
                ctaLabel: active.ctaLabel,
                seoTitle: active.seoTitle,
                seoDescription: active.seoDescription,
                canonicalUrl: active.canonicalUrl,
                noIndex: active.noIndex,
                primaryKeyword1: active.primaryKeyword1,
                primaryKeyword2: active.primaryKeyword2,
                primaryKeyword3: active.primaryKeyword3,
              },
            }}
            resolveJump={resolveJump}
            defaultExpanded={false}
            rememberExpanded={false}
          />
          {!active.exists ? (
            <p className="text-xs text-muted">
              {active.countryName} does not sell this product yet, so this is a preview of its page
              there once it is published.
            </p>
          ) : null}
        </SettingsSection>
      </CardBody>

      {canEdit ? (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-hairline px-4 py-3 sm:px-5">
          {active.exists ? (
            <Button variant="outline" disabled={pending} onClick={() => setConfirmRemove(active)}>
              <Trash className="h-4 w-4" aria-hidden="true" />
              Remove from {active.countryName}
            </Button>
          ) : null}
          <Button disabled={pending} onClick={() => save(active)}>
            {pending ? (
              <>
                <Spinner className="h-4 w-4 animate-spin" aria-hidden="true" />
                Saving…
              </>
            ) : active.exists ? (
              `Save ${active.countryName}`
            ) : (
              <>
                <Plus className="h-4 w-4" aria-hidden="true" />
                Sell in {active.countryName}
              </>
            )}
          </Button>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmRemove !== null}
        onClose={() => setConfirmRemove(null)}
        onConfirm={async () => {
          const target = confirmRemove;
          setConfirmRemove(null);
          if (!target) return;
          setPending(true);
          const result = await removeProductCountry({
            productId,
            countryId: target.countryId,
          });
          setPending(false);
          if (!result.ok) {
            toast(result.error, 'error');
            return;
          }
          toast(result.message ?? 'Removed.');
          router.refresh();
        }}
        title={`Stop selling in ${confirmRemove?.countryName ?? ''}?`}
        message="The product page disappears from that country's storefront and its pricing is deleted. The product itself, and every other country, is untouched."
        pending={pending}
      />
    </Card>
  );
}

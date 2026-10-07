'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Pencil, Trash, Globe, Copy } from 'lucide-react';
import {
  saveCountry,
  setCountryActive,
  deleteCountry,
  saveCountrySettings,
} from '@/lib/actions/countries';
import { Card, CardBody } from '@/components/ui/card';
import { Table, TableWrap, Th, Td, Tr } from '@/components/ui/table';
import { Field, Input, Select, Switch, Textarea } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, ConfirmDialog } from '@/components/ui/dialog';
import { SettingsSection, SettingsDivider } from '@/components/admin/settings-section';
import { useToast } from '@/components/ui/toast';
import { Spinner } from '@/components/ui/icons';
import { SUPPORTED_CURRENCIES } from '@/lib/utils/money';
import { CountryPicker } from './country-picker';
import { SyncPanel } from './sync-panel';
import { suggestedSlug, suggestedLocale } from '@/lib/country/iso';
import { cn } from '@/lib/utils/cn';

/**
 * Countries and their settings.
 *
 * Two things live on this screen because they are the same job: which markets
 * exist, and what each one says about itself. Adding a market here — a name, a
 * two-letter code, a URL prefix, a currency — is all the application needs to
 * start serving `/<prefix>/`; nothing else has to be written or deployed.
 */

export type CountryRow = {
  id: string;
  name: string;
  code: string;
  slug: string;
  locale: string;
  currency: string;
  currencySymbol: string;
  phoneCode: string | null;
  timezone: string;
  isDefault: boolean;
  isActive: boolean;
  isPublished: boolean;
  sortOrder: number;
  pageCount: number;
  postCount: number;
  productCount: number;
};

export type CountrySettingsValues = Record<string, string>;

const BLANK: CountryRow = {
  id: '',
  name: '',
  code: '',
  slug: '',
  locale: 'en',
  currency: 'USD',
  currencySymbol: '$',
  phoneCode: '',
  timezone: 'UTC',
  isDefault: false,
  isActive: true,
  isPublished: true,
  sortOrder: 10,
  pageCount: 0,
  postCount: 0,
  productCount: 0,
};

export function CountriesManager({
  countries,
  settings,
  selectedId,
  sourceName,
  canEdit,
}: {
  countries: CountryRow[];
  /** The selected country's settings, already merged for display. */
  settings: CountrySettingsValues;
  selectedId: string;
  /** The default market's name — the one content is copied from. */
  sourceName: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [editing, setEditing] = React.useState<CountryRow | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState<CountryRow | null>(null);
  /*
   * The second step, shown only for a market that still holds something: the
   * server has counted it and said what would go, and that sentence is what
   * gets shown rather than anything guessed from the table.
   */
  const [confirmWipe, setConfirmWipe] = React.useState<{
    country: CountryRow;
    warning: string;
  } | null>(null);
  const [pending, setPending] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string[]>>({});

  const selected = countries.find((country) => country.id === selectedId) ?? countries[0] ?? null;

  async function run(fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) {
    setPending(true);
    const result = await fn();
    setPending(false);
    if (!result.ok) {
      toast(result.error ?? 'Something went wrong.', 'error');
      return false;
    }
    // An empty message means the action handed control to a confirmation
    // dialog rather than completing, so there is nothing to announce yet.
    if (result.message !== '') toast(result.message ?? 'Saved.');
    router.refresh();
    return true;
  }

  async function submitCountry() {
    if (!editing) return;
    setPending(true);
    setErrors({});

    const data = new FormData();
    data.set('name', editing.name);
    data.set('code', editing.code);
    data.set('slug', editing.slug);
    data.set('locale', editing.locale);
    data.set('currency', editing.currency);
    data.set('currencySymbol', editing.currencySymbol);
    data.set('phoneCode', editing.phoneCode ?? '');
    data.set('timezone', editing.timezone);
    data.set('isDefault', String(editing.isDefault));
    data.set('isActive', String(editing.isActive));
    data.set('isPublished', String(editing.isPublished));
    data.set('sortOrder', String(editing.sortOrder));

    const result = await saveCountry(editing.id || null, data);
    setPending(false);

    if (!result.ok) {
      setErrors(result.fieldErrors ?? {});
      toast(result.error, 'error');
      return;
    }
    toast(result.message ?? 'Saved.');
    setEditing(null);
    router.refresh();
  }

  return (
    <>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline px-4 py-3 sm:px-5">
          <div>
            <h2 className="font-heading text-sm font-semibold text-content">Countries</h2>
            <p className="mt-0.5 text-xs text-muted">
              The default country is served from the site root. Every other country is served from
              its own URL prefix.
            </p>
          </div>
          {canEdit ? (
            <Button onClick={() => setEditing({ ...BLANK })} disabled={pending}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add country
            </Button>
          ) : null}
        </div>

        <TableWrap>
          <Table>
            <caption className="sr-only">Configured countries</caption>
            <thead>
              <tr>
                <Th>Country</Th>
                <Th>URL</Th>
                <Th>Currency</Th>
                <Th>Locale</Th>
                <Th align="center">Content</Th>
                <Th>Status</Th>
                <Th align="right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {countries.map((country) => (
                <Tr key={country.id} className={cn(country.id === selected?.id && 'bg-brand/[0.04]')}>
                  <Td>
                    <span className="font-medium text-content">{country.name}</span>
                    <span className="ml-2 text-xs text-muted">{country.code}</span>
                    {country.isDefault ? (
                      <Badge tone="brand" className="ml-2">
                        Default
                      </Badge>
                    ) : null}
                  </Td>
                  <Td>
                    <code className="rounded bg-muted/10 px-1.5 py-0.5 font-mono text-xs text-muted">
                      /{country.slug}
                    </code>
                  </Td>
                  <Td className="text-sm text-muted">
                    {country.currency} {country.currencySymbol}
                  </Td>
                  <Td className="text-sm text-muted">{country.locale}</Td>
                  <Td align="center" className="whitespace-nowrap text-xs text-muted">
                    {country.pageCount} pages · {country.postCount} posts · {country.productCount}{' '}
                    products
                  </Td>
                  <Td>
                    <Badge tone={country.isActive ? 'success' : 'neutral'}>
                      {country.isActive ? 'Live' : 'Inactive'}
                    </Badge>
                    {country.isActive && !country.isPublished ? (
                      <Badge tone="warning">Unpublished</Badge>
                    ) : null}
                  </Td>
                  <Td align="right">
                    <div className="flex items-center justify-end gap-1">
                      <a
                        href={`?country=${country.id}`}
                        className="rounded p-1.5 text-muted transition-colors hover:bg-muted/10 hover:text-content"
                        aria-label={`Edit ${country.name} settings`}
                        title="Edit settings"
                      >
                        <Globe className="h-4 w-4" />
                      </a>
                      {/*
                        * Every market except the source gets the button, and it
                        * is a link to that market's own row — selecting it is
                        * what brings up the panel below, so the button and the
                        * panel can never disagree about which market is being
                        * synced.
                        *
                        * The source market never shows it: there is nothing to
                        * copy into the market everything is copied from, and
                        * offering it would invite exactly the mistake the
                        * server action refuses.
                        */}
                      {!country.isDefault && sourceName && canEdit ? (
                        <a
                          href={`?country=${country.id}#sync`}
                          className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium text-brand transition-colors hover:bg-brand/10"
                          title={`Add ${sourceName}'s content to ${country.name}`}
                        >
                          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                          Sync from {sourceName}
                        </a>
                      ) : null}
                      {canEdit ? (
                        <>
                          <button
                            type="button"
                            onClick={() => setEditing({ ...country })}
                            className="rounded p-1.5 text-muted transition-colors hover:bg-muted/10 hover:text-content"
                            aria-label={`Edit ${country.name}`}
                            title="Edit country"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          {!country.isDefault ? (
                            <button
                              type="button"
                              onClick={() => setConfirmDelete(country)}
                              className="rounded p-1.5 text-muted transition-colors hover:bg-red-50 hover:text-red-600"
                              aria-label={`Delete ${country.name}`}
                              title="Delete country"
                            >
                              <Trash className="h-4 w-4" />
                            </button>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      </Card>

      {selected ? (
        <CountrySettingsForm
          key={selected.id}
          country={selected}
          initial={settings}
          canEdit={canEdit}
        />
      ) : null}

      {/*
        * Only on a destination market. The source has nothing to copy into it,
        * and offering the button there would invite exactly the mistake the
        * action refuses.
        */}
      {selected && !selected.isDefault && sourceName ? (
        <div id="sync" className="scroll-mt-24">
        <SyncPanel
          key={`sync-${selected.id}`}
          sourceName={sourceName}
          target={{ id: selected.id, name: selected.name, currency: selected.currency }}
          canSync={canEdit}
        />
        </div>
      ) : null}

      <Dialog
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing?.id ? `Edit ${editing.name || 'country'}` : 'Add country'}
        description="A country is a storefront. Its prefix becomes the first part of every URL it serves."
        size="md"
        footer={
          <>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={submitCountry} disabled={pending || !editing?.name.trim()}>
              {pending ? (
                <>
                  <Spinner className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Saving…
                </>
              ) : (
                'Save country'
              )}
            </Button>
          </>
        }
      >
        {editing ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field
                label="Country"
                htmlFor="country-picker"
                required
                error={errors.code ?? errors.name}
                hint={
                  editing.id
                    ? 'Changing the country rewrites the stored ISO code. The prefix, locale and currency below stay as you have them.'
                    : 'Search all 249 ISO 3166-1 countries. Choosing one fills in the prefix, locale and currency — all editable.'
                }
              >
                <CountryPicker
                  id="country-picker"
                  value={editing.code}
                  invalid={Boolean(errors.code)}
                  /*
                   * Countries already added cannot be chosen again, so a
                   * duplicate is impossible to submit rather than rejected
                   * after the fact. The row being edited is excluded, or it
                   * would disable itself.
                   */
                  disabledCodes={countries
                    .filter((country) => country.id !== editing.id)
                    .map((country) => country.code)}
                  onSelect={(country) =>
                    setEditing((current) =>
                      current
                        ? {
                            ...current,
                            code: country.code,
                            name: country.name,
                            // Suggestions only, and only where the field is
                            // still empty or was itself a suggestion — an
                            // administrator who typed "uk" keeps it.
                            slug: current.isDefault ? '' : suggestedSlug(country.code),
                            locale: suggestedLocale(country.code),
                            currency: country.currency || current.currency,
                            currencySymbol: country.symbol || current.currencySymbol,
                          }
                        : current,
                    )
                  }
                />
              </Field>
            </div>
            <Field
              label="URL prefix"
              htmlFor="country-slug"
              error={errors.slug}
              hint={
                editing.isDefault
                  ? 'The default country is served from the site root and has no prefix.'
                  : 'Pages are served under /<prefix>/. Usually the lower-case ISO code.'
              }
            >
              <Input
                id="country-slug"
                value={editing.slug}
                disabled={editing.isDefault}
                placeholder="qa"
                onChange={(e) =>
                  setEditing({ ...editing, slug: e.target.value.toLowerCase().replace(/\s+/g, '') })
                }
              />
            </Field>
            <Field
              label="Locale"
              htmlFor="country-locale"
              required
              error={errors.locale}
              hint="Used for hreflang, e.g. en-QA."
            >
              <Input
                id="country-locale"
                value={editing.locale}
                placeholder="en-QA"
                onChange={(e) => setEditing({ ...editing, locale: e.target.value })}
              />
            </Field>
            <Field label="Currency" htmlFor="country-currency" required error={errors.currency}>
              <Select
                id="country-currency"
                value={editing.currency}
                onChange={(e) => setEditing({ ...editing, currency: e.target.value })}
              >
                {SUPPORTED_CURRENCIES.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Currency symbol"
              htmlFor="country-symbol"
              required
              error={errors.currencySymbol}
            >
              <Input
                id="country-symbol"
                value={editing.currencySymbol}
                maxLength={8}
                onChange={(e) => setEditing({ ...editing, currencySymbol: e.target.value })}
              />
            </Field>
            <Field label="Phone code" htmlFor="country-phone" error={errors.phoneCode}>
              <Input
                id="country-phone"
                value={editing.phoneCode ?? ''}
                placeholder="+974"
                onChange={(e) => setEditing({ ...editing, phoneCode: e.target.value })}
              />
            </Field>
            <Field label="Time zone" htmlFor="country-tz" required error={errors.timezone}>
              <Input
                id="country-tz"
                value={editing.timezone}
                placeholder="Asia/Qatar"
                onChange={(e) => setEditing({ ...editing, timezone: e.target.value })}
              />
            </Field>
            <Field label="Order" htmlFor="country-order" hint="Lower numbers appear first.">
              <Input
                id="country-order"
                type="number"
                min={0}
                value={editing.sortOrder}
                onChange={(e) => setEditing({ ...editing, sortOrder: Number(e.target.value) })}
              />
            </Field>
            <div className="space-y-3 sm:col-span-2">
              <Switch
                checked={editing.isActive}
                onChange={(next) => setEditing({ ...editing, isActive: next })}
                label="Serve this country publicly"
                hint="An inactive country keeps all of its content but stops answering requests."
              />
              <Switch
                checked={editing.isPublished}
                onChange={(next) => setEditing({ ...editing, isPublished: next })}
                label="Published to search engines"
                hint="Off keeps the market reachable by anyone with the link but out of every sitemap, so it can be built in the open before it is announced."
              />
              <Switch
                checked={editing.isDefault}
                onChange={(next) =>
                  setEditing({ ...editing, isDefault: next, slug: next ? '' : editing.slug })
                }
                label="Default country"
                hint="Served from the site root. Exactly one country holds this."
              />
            </div>
          </div>
        ) : null}
      </Dialog>

      <ConfirmDialog
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        onConfirm={async () => {
          const target = confirmDelete;
          setConfirmDelete(null);
          if (!target) return;
          await run(async () => {
            const result = await deleteCountry(target.id);
            // It still holds content: say exactly what, and ask again.
            if (!result.ok && result.fieldErrors?._confirm) {
              setConfirmWipe({ country: target, warning: result.error });
              return { ok: true, message: '' };
            }
            return result;
          });
        }}
        title={`Delete ${confirmDelete?.name ?? 'this country'}?`}
        message="The market goes, along with everything that belongs only to it — its pages, articles, menus, leads and product pricing. Deactivating it instead takes the storefront offline and keeps all of that."
        pending={pending}
      />

      <ConfirmDialog
        open={confirmWipe !== null}
        onClose={() => setConfirmWipe(null)}
        onConfirm={async () => {
          const target = confirmWipe?.country;
          setConfirmWipe(null);
          if (!target) return;
          await run(() => deleteCountry(target.id, { confirmed: true }));
        }}
        title={`Delete ${confirmWipe?.country.name ?? 'this country'} and its content?`}
        message={confirmWipe?.warning ?? ''}
        confirmLabel="Delete everything"
        pending={pending}
      />

      {canEdit && selected && !selected.isDefault ? (
        <div className="mt-6 flex justify-end">
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => run(() => setCountryActive(selected.id, !selected.isActive))}
          >
            {selected.isActive ? `Take ${selected.name} offline` : `Bring ${selected.name} online`}
          </Button>
        </div>
      ) : null}
    </>
  );
}

/** The per-market company identity, contact details and SEO defaults. */
function CountrySettingsForm({
  country,
  initial,
  canEdit,
}: {
  country: CountryRow;
  initial: CountrySettingsValues;
  canEdit: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [values, setValues] = React.useState(initial);
  const [pending, setPending] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string[]>>({});
  // Each field's label, so a failed save can say which fields to fix.
  const labels = React.useRef<Record<string, string>>({});

  const set = (key: string, value: string) =>
    setValues((current) => ({ ...current, [key]: value }));

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setErrors({});
    const data = new FormData();
    for (const [key, value] of Object.entries(values)) data.set(key, value);
    const result = await saveCountrySettings(country.id, data);
    setPending(false);
    if (!result.ok) {
      /*
       * The whole form is one save, crawler switches included, so a field that
       * fails validation keeps every other change from being stored. Say which
       * one, beside it and in the toast, and take the editor to it — a vague
       * "correct the highlighted fields" with nothing highlighted is how a
       * switch appeared to turn itself back on.
       */
      const fieldErrors = result.fieldErrors ?? {};
      setErrors(fieldErrors);
      const keys = Object.keys(fieldErrors);
      if (keys.length > 0) {
        const names = keys.map((key) => labels.current[key] ?? key);
        toast(`Not saved. Check ${names.join(', ')}.`, 'error');
        const first = document.getElementById(`cs-${keys[0]}`);
        first?.scrollIntoView({ block: 'center' });
        first?.focus({ preventScroll: true });
      } else {
        toast(result.error, 'error');
      }
      return;
    }
    toast(result.message ?? 'Saved.');
    router.refresh();
  }

  const text = (key: string, label: string, hint?: string, placeholder?: string) => {
    labels.current[key] = label;
    return (
      <Field label={label} htmlFor={`cs-${key}`} hint={hint} error={errors[key]}>
        <Input
          id={`cs-${key}`}
          value={values[key] ?? ''}
          placeholder={placeholder}
          disabled={!canEdit}
          aria-invalid={errors[key] ? true : undefined}
          onChange={(e) => set(key, e.target.value)}
        />
      </Field>
    );
  };

  /** A multi-line field, for the one-path-per-line crawler rules. */
  const area = (key: string, label: string, hint?: string) => {
    labels.current[key] = label;
    return (
      <Field label={label} htmlFor={`cs-${key}`} hint={hint} error={errors[key]}>
        <Textarea
          id={`cs-${key}`}
          rows={4}
          value={values[key] ?? ''}
          placeholder={'/thanks\n/internal-preview'}
          disabled={!canEdit}
          aria-invalid={errors[key] ? true : undefined}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => set(key, e.target.value)}
        />
      </Field>
    );
  };

  return (
    <form onSubmit={onSubmit} className="mt-6">
      <Card>
        <CardBody className="divide-y divide-hairline py-0">
          <SettingsSection
            title={`${country.name} identity`}
            description="Shown wherever this storefront names the company. Anything left blank falls back to the global website settings, so a country you have not configured looks exactly like the site does today."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              {text('companyName', 'Company name', undefined, 'Acme FZ-LLC')}
              {text('legalName', 'Legal name')}
              {text('salesPhone', 'Sales phone', undefined, '+971 4 000 0000')}
              {text('supportPhone', 'Support phone')}
              {text('whatsappNumber', 'WhatsApp number')}
              {text('salesEmail', 'Sales email')}
              {text('supportEmail', 'Support email')}
              {text('businessHours', 'Business hours', undefined, 'Sun–Thu 09:00–18:00')}
            </div>
          </SettingsSection>

          <SettingsDivider />

          <SettingsSection
            title="Address"
            description="Used in the footer and in the organisation structured data this country emits."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              {text('addressLine1', 'Address line 1')}
              {text('addressLine2', 'Address line 2')}
              {text('city', 'City')}
              {text('region', 'State / emirate')}
              {text('postalCode', 'Postal code')}
              {text('address', 'Single-line address', 'Shown in the footer when set.')}
              {text('taxLabel', 'Tax label', undefined, 'VAT')}
              {text('taxNumber', 'Tax number')}
            </div>
          </SettingsSection>

          <SettingsDivider />

          <SettingsSection
            title="Calls to action"
            description="The header button and the sales copy for this market."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              {text('headerCtaLabel', 'Header button label')}
              {text('headerCtaUrl', 'Header button URL', 'A path is resolved inside this country.')}
              {text('salesCtaText', 'Sales CTA text')}
            </div>
          </SettingsSection>

          <SettingsDivider />

          <SettingsSection
            title="SEO defaults"
            description="Used when a page in this country has no SEO of its own. Canonicals always point at this country's own URLs."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              {text('defaultTitle', 'Default title')}
              {text('titleTemplate', 'Title template', 'Use %s for the page title.')}
              {text('organizationName', 'Organisation name')}
              {text('organizationType', 'Organisation type', 'Schema.org type.')}
              {text('organizationLogoUrl', 'Organisation logo URL')}
              {text('defaultOgImageUrl', 'Default social image URL')}
              {text('localBusinessType', 'LocalBusiness type', 'Leave blank for Organization.')}
              {text('latitude', 'Latitude')}
              {text('longitude', 'Longitude')}
            </div>
            {text('defaultDescription', 'Default description')}
          </SettingsSection>

          <SettingsDivider />

          <SettingsSection
            title="Crawler rules"
            description={`Paths here are written relative to this market and compiled into the site's single robots.txt at the host root. ${country.slug ? `A rule of “/thanks” becomes “/${country.slug}/thanks”.` : 'This market is served from the root, so a rule of “/thanks” stays “/thanks”.'}`}
          >
            <div className="rounded-lg border border-amber-500/30 bg-amber-50/50 p-3 text-xs leading-relaxed text-amber-900">
              <strong className="font-semibold">There is only one robots.txt.</strong> Crawlers read
              it from the host root, so {country.slug ? `/${country.slug}/robots.txt` : '/robots.txt'}{' '}
              is not a separate file — these rules are merged into the one below every market shares.
              <br />
              <strong className="font-semibold">Blocking is not hiding.</strong> Disallow stops a
              crawler <em>fetching</em> a URL; noindex asks it not to <em>list</em> one. A blocked
              page is never fetched, so its noindex is never read and it can still appear in
              results. To keep a page out of search, leave it crawlable and set noindex.
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {area(
                'robotsDisallow',
                'Disallow paths',
                'One per line. Paths that serve the CSS, JavaScript and images a page needs are refused — blocking those makes search engines judge the page on a broken version of itself.',
              )}
              {area('robotsAllow', 'Allow paths', 'One per line. Use to carve an exception out of a broader Disallow.')}
            </div>

            <div className="mt-4 space-y-3">
              <Switch
                checked={values.noIndexCountry === 'true'}
                onChange={(next) => set('noIndexCountry', String(next))}
                label="Ask search engines not to index this market"
                hint="Adds a robots noindex meta tag to every page of this market, and only this market. Deliberately not a Disallow rule, for the reason above."
                disabled={!canEdit}
              />
              <Switch
                checked={values.excludeFromSitemap === 'true'}
                onChange={(next) => set('excludeFromSitemap', String(next))}
                label="Leave this market out of the sitemaps"
                hint="The pages still serve; they are simply not listed. A market asked not to be indexed is never listed either."
                disabled={!canEdit}
              />
            </div>
          </SettingsSection>
        </CardBody>
      </Card>

      {canEdit ? (
        <div className="mt-4 flex justify-end">
          <Button type="submit" disabled={pending}>
            {pending ? (
              <>
                <Spinner className="h-4 w-4 animate-spin" aria-hidden="true" />
                Saving…
              </>
            ) : (
              `Save ${country.name} settings`
            )}
          </Button>
        </div>
      ) : null}
    </form>
  );
}

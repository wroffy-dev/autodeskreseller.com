'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, AlertTriangle } from 'lucide-react';
import { checkCitySlug, saveCity } from '@/lib/actions/cities';
import { Card, CardBody } from '@/components/ui/card';
import { Field, Input, Select, Switch, Textarea, Checkbox } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/icons';
import { useToast } from '@/components/ui/toast';
import { SettingsSection, SettingsDivider } from '@/components/admin/settings-section';
import { suggestCitySlug } from '@/lib/validation/city';
import { CITY_STATUSES, CITY_STATUS_HELP, CITY_STATUS_LABELS, type CityStatus } from '@/lib/cities/status';
import { fillPlaceholders, placeholderValues } from '@/lib/cities/template';
import { joinMarket } from '@/lib/urls/path';
import type { CityFormMarket, CityFormValues } from './city-form-values';

export type { CityFormValues, CityFormMarket };

type SlugState =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'free'; path: string }
  | { state: 'taken'; message: string };

/**
 * A city's settings. Content is not here: the landing page and every other
 * page of the city are ordinary pages, edited in the Page Builder.
 */
export function CityForm({
  initial,
  markets,
  pageCount = 0,
  canPublish,
  canEdit = true,
}: {
  initial: CityFormValues;
  /** Markets a new city can be added to; an existing city's own market only. */
  markets: CityFormMarket[];
  /** The city's live pages, which move with a changed slug. */
  pageCount?: number;
  canPublish: boolean;
  /** False shows the settings without letting them change. The server refuses regardless. */
  canEdit?: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const editing = Boolean(initial.id);
  const [values, setValues] = React.useState<CityFormValues>(initial);
  const [slugTouched, setSlugTouched] = React.useState(editing);
  const [createLanding, setCreateLanding] = React.useState(true);
  const [landingTitle, setLandingTitle] = React.useState('{{city}}');
  const [errors, setErrors] = React.useState<Record<string, string[]>>({});
  const [pending, setPending] = React.useState(false);
  const [slugState, setSlugState] = React.useState<SlugState>({
    state: 'idle',
  });

  const market = markets.find((row) => row.id === values.countryId) ?? markets[0];
  const set = <K extends keyof CityFormValues>(key: K, value: CityFormValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  // The slug follows the name until somebody edits it.
  function setName(name: string) {
    setValues((current) => ({
      ...current,
      name,
      slug: slugTouched ? current.slug : suggestCitySlug(name),
    }));
  }

  // Whether the slug's address space is free, checked as it is typed. Saving
  // checks again on the server under the registry lock.
  React.useEffect(() => {
    const slug = values.slug.trim();
    if (!slug || !market || (editing && slug === initial.slug)) {
      setSlugState({ state: 'idle' });
      return;
    }
    setSlugState({ state: 'checking' });
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const result = await checkCitySlug({
        countryId: market.id,
        slug,
        cityId: initial.id,
      });
      if (cancelled) return;
      if (!result.ok) {
        setSlugState({ state: 'taken', message: result.error });
        return;
      }
      const data = result.data!;
      setSlugState(data.message ? { state: 'taken', message: data.message } : { state: 'free', path: data.path });
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [values.slug, market, editing, initial.slug, initial.id]);

  const preview = market
    ? fillPlaceholders(
        landingTitle || '{{city}}',
        placeholderValues({
          city: {
            name: values.name || 'City',
            slug: values.slug || 'city',
            region: values.region || null,
          },
          country: market,
          page: { title: values.name || 'City', slug: values.slug || 'city' },
        }),
      )
    : '';

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!market) return;
    setPending(true);
    setErrors({});
    const data = new FormData();
    data.set('countryId', market.id);
    for (const [key, value] of Object.entries(values)) {
      if (key === 'id' || key === 'countryId') continue;
      data.set(key, typeof value === 'boolean' ? String(value) : String(value ?? ''));
    }
    if (!editing) {
      data.set('createLanding', String(createLanding));
      data.set('landingTitle', landingTitle);
    }
    const result = await saveCity(initial.id, data);
    setPending(false);
    if (!result.ok) {
      setErrors(result.fieldErrors ?? {});
      toast(result.error, 'error');
      return;
    }
    toast(result.message ?? 'Saved.');
    if (!editing && result.data) {
      router.push(`/admin/cities/${result.data.id}`);
      return;
    }
    router.refresh();
  }

  const slugChanged = editing && values.slug.trim() !== initial.slug;
  const publicPath = market ? joinMarket(market.slug, values.slug.trim() || '…') : '';
  // Publishing a city puts its pages in front of visitors: that needs the
  // publish permission. The server refuses it regardless.
  const publishLocked = !canPublish && initial.status !== 'PUBLISHED';

  return (
    <form onSubmit={submit} noValidate>
      <fieldset disabled={!canEdit} className="min-w-0">
        <Card>
          <CardBody className="divide-y-0 px-4 sm:px-6">
            <SettingsSection
              title="City"
              description="A city belongs to one market. Its slug becomes the first segment of every address in it."
            >
              <Field label="Country" htmlFor="city-country" required error={errors.countryId}>
                {editing ? (
                  <p id="city-country" className="text-sm text-content">
                    {market?.name ?? '—'} <span className="text-xs text-muted">(a city stays in its market)</span>
                  </p>
                ) : (
                  <Select
                    id="city-country"
                    value={values.countryId}
                    onChange={(event) => set('countryId', event.target.value)}
                  >
                    {markets.map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.name} ({row.slug ? `/${row.slug}` : 'site root'})
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="City name" htmlFor="city-name" required error={errors.name}>
                  <Input
                    id="city-name"
                    value={values.name}
                    onChange={(event) => setName(event.target.value)}
                    maxLength={120}
                    autoComplete="off"
                    required
                  />
                </Field>
                <Field
                  label="Slug"
                  htmlFor="city-slug"
                  required
                  error={errors.slug}
                  hint={slugState.state === 'idle' || slugState.state === 'free' ? `Address: ${publicPath}` : undefined}
                >
                  <Input
                    id="city-slug"
                    value={values.slug}
                    onChange={(event) => {
                      setSlugTouched(true);
                      set('slug', event.target.value.toLowerCase());
                    }}
                    maxLength={80}
                    autoComplete="off"
                    spellCheck={false}
                    required
                    aria-describedby="city-slug-state"
                  />
                  <p id="city-slug-state" className="text-xs" aria-live="polite">
                    {slugState.state === 'checking' ? (
                      <span className="inline-flex items-center gap-1 text-muted">
                        <Spinner className="h-3 w-3 animate-spin" aria-hidden="true" /> Checking the address…
                      </span>
                    ) : slugState.state === 'free' ? (
                      <span className="inline-flex items-center gap-1 text-emerald-700">
                        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> {slugState.path} is free.
                      </span>
                    ) : slugState.state === 'taken' && !errors.slug ? (
                      <span className="inline-flex items-start gap-1 text-red-600">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /> {slugState.message}
                      </span>
                    ) : null}
                  </p>
                </Field>
              </div>
              {slugChanged && pageCount > 0 ? (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  Saving moves the city’s {pageCount} page
                  {pageCount === 1 ? '' : 's'} to {publicPath}. Published pages keep working at their old addresses
                  through automatic redirects.
                </p>
              ) : null}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Region"
                  htmlFor="city-region"
                  error={errors.region}
                  hint="Optional — state, emirate or province. Nothing requires it."
                >
                  <Input
                    id="city-region"
                    value={values.region}
                    onChange={(event) => set('region', event.target.value)}
                    maxLength={120}
                  />
                </Field>
                <Field
                  label="Sort order"
                  htmlFor="city-sort"
                  error={errors.sortOrder}
                  hint="Lower numbers are listed first."
                >
                  <Input
                    id="city-sort"
                    type="number"
                    min={0}
                    max={9999}
                    value={values.sortOrder}
                    onChange={(event) => set('sortOrder', Number(event.target.value) || 0)}
                  />
                </Field>
              </div>
              <Field
                label="Status"
                htmlFor="city-status"
                error={errors.status}
                hint={
                  publishLocked && values.status !== 'PUBLISHED'
                    ? `${CITY_STATUS_HELP[values.status]} Publishing needs the publish permission.`
                    : CITY_STATUS_HELP[values.status]
                }
              >
                <Select
                  id="city-status"
                  value={values.status}
                  onChange={(event) => set('status', event.target.value as CityStatus)}
                >
                  {CITY_STATUSES.map((status) => (
                    <option key={status} value={status} disabled={status === 'PUBLISHED' && publishLocked}>
                      {CITY_STATUS_LABELS[status]}
                    </option>
                  ))}
                </Select>
              </Field>
            </SettingsSection>

            {!editing ? (
              <>
                <SettingsDivider />
                <SettingsSection
                  title="Landing page"
                  description="The page at the city’s own address. It is an ordinary page, built in the Page Builder."
                >
                  <Checkbox
                    checked={createLanding}
                    onChange={(event) => setCreateLanding(event.target.checked)}
                    label="Create the city’s landing page"
                    hint={`An empty draft at ${publicPath}. Publish it when it is ready.`}
                  />
                  {createLanding ? (
                    <Field
                      label="Landing page title"
                      htmlFor="city-landing-title"
                      error={errors.landingTitle}
                      hint={`Placeholders such as {{city}} and {{region}} are filled in once — for example “Autodesk reseller in {{city}}”. Title: “${preview}”.`}
                    >
                      <Input
                        id="city-landing-title"
                        value={landingTitle}
                        onChange={(event) => setLandingTitle(event.target.value)}
                        maxLength={200}
                      />
                    </Field>
                  ) : null}
                </SettingsSection>
              </>
            ) : null}

            <SettingsDivider />
            <SettingsSection
              title="Local business details"
              description="Shown on the city’s pages instead of the market’s. Leave a field blank to use the market’s."
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Sales phone" htmlFor="city-phone" error={errors.salesPhone}>
                  <Input
                    id="city-phone"
                    type="tel"
                    value={values.salesPhone}
                    onChange={(event) => set('salesPhone', event.target.value)}
                    maxLength={40}
                  />
                </Field>
                <Field label="WhatsApp number" htmlFor="city-whatsapp" error={errors.whatsappNumber}>
                  <Input
                    id="city-whatsapp"
                    type="tel"
                    value={values.whatsappNumber}
                    onChange={(event) => set('whatsappNumber', event.target.value)}
                    maxLength={40}
                  />
                </Field>
              </div>
              <Field label="Sales email" htmlFor="city-email" error={errors.salesEmail}>
                <Input
                  id="city-email"
                  type="email"
                  value={values.salesEmail}
                  onChange={(event) => set('salesEmail', event.target.value)}
                  maxLength={200}
                />
              </Field>
              <Field
                label="Address"
                htmlFor="city-address"
                error={errors.address}
                hint="A city with its own address replaces the market’s whole address on its pages."
              >
                <Textarea
                  id="city-address"
                  rows={3}
                  value={values.address}
                  onChange={(event) => set('address', event.target.value)}
                  maxLength={600}
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Postal code" htmlFor="city-postal" error={errors.postalCode}>
                  <Input
                    id="city-postal"
                    value={values.postalCode}
                    onChange={(event) => set('postalCode', event.target.value)}
                    maxLength={24}
                  />
                </Field>
                <Field label="Latitude" htmlFor="city-lat" error={errors.latitude}>
                  <Input
                    id="city-lat"
                    inputMode="decimal"
                    value={values.latitude}
                    onChange={(event) => set('latitude', event.target.value)}
                    maxLength={24}
                  />
                </Field>
                <Field label="Longitude" htmlFor="city-lng" error={errors.longitude}>
                  <Input
                    id="city-lng"
                    inputMode="decimal"
                    value={values.longitude}
                    onChange={(event) => set('longitude', event.target.value)}
                    maxLength={24}
                  />
                </Field>
              </div>
            </SettingsSection>

            <SettingsDivider />
            <SettingsSection
              title="Search"
              description="Defaults for the city’s pages where their own fields are blank. The page always wins."
            >
              <Field
                label="SEO title"
                htmlFor="city-seo-title"
                error={errors.seoTitle}
                hint="Used by the landing page when it has no SEO title of its own."
              >
                <Input
                  id="city-seo-title"
                  value={values.seoTitle}
                  onChange={(event) => set('seoTitle', event.target.value)}
                  maxLength={200}
                />
              </Field>
              <Field
                label="SEO description"
                htmlFor="city-seo-description"
                error={errors.seoDescription}
                hint="Used by any page in the city that has no description of its own, before the market’s default."
              >
                <Textarea
                  id="city-seo-description"
                  rows={3}
                  value={values.seoDescription}
                  onChange={(event) => set('seoDescription', event.target.value)}
                  maxLength={400}
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-3">
                {(['primaryKeyword1', 'primaryKeyword2', 'primaryKeyword3'] as const).map((key, index) => (
                  <Field key={key} label={`Primary keyword ${index + 1}`} htmlFor={`city-${key}`} error={errors[key]}>
                    <Input
                      id={`city-${key}`}
                      value={values[key]}
                      onChange={(event) => set(key, event.target.value)}
                      maxLength={100}
                    />
                  </Field>
                ))}
              </div>
              <p className="text-xs text-muted">
                The keywords apply to the landing page when it names none of its own. Nothing generates variations of
                them.
              </p>
              <Switch
                checked={values.noIndex}
                onChange={(next) => set('noIndex', next)}
                label="Ask search engines not to index this city"
                hint="Sends noindex on every page in the city."
              />
              <Switch
                checked={values.excludeFromSitemap}
                onChange={(next) => set('excludeFromSitemap', next)}
                label="Exclude from the sitemap"
                hint="Keeps the city’s pages out of the sitemap without noindexing them."
              />
            </SettingsSection>
          </CardBody>
        </Card>
      </fieldset>

      {canEdit ? (
        <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
          <Button type="button" variant="outline" onClick={() => router.push('/admin/cities')} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending || !values.name.trim()}>
            {pending ? <Spinner className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {editing ? 'Save city' : 'Create city'}
          </Button>
        </div>
      ) : null}
    </form>
  );
}

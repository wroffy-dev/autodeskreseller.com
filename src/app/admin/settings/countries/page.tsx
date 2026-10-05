import type { Metadata } from 'next';
import { prisma } from '@/lib/db/prisma';
import { requirePermission, userCan } from '@/lib/auth/guards';
import { AdminPageHeader } from '@/components/admin/page-header';
import { Alert } from '@/components/ui/states';
import {
  CountriesManager,
  type CountryRow,
  type CountrySettingsValues,
} from '@/components/admin/settings/countries-manager';
import { listCountries, getCountryById, getDefaultCountry } from '@/lib/country/registry';
import { getCountrySettingsRow } from '@/lib/country/settings';

export const metadata: Metadata = { title: 'Countries' };
export const dynamic = 'force-dynamic';

/**
 * Countries.
 *
 * Everything a market needs is on this one screen: whether it exists, whether
 * it is served, what its URL prefix and currency are, and what it says about
 * itself. Adding Qatar is a row here plus its content — there is no code path
 * that has to learn about a new market.
 */
export default async function CountriesAdmin({
  searchParams,
}: {
  searchParams: Promise<{ country?: string }>;
}) {
  const user = await requirePermission('settings.manage');
  const params = await searchParams;

  const countries = await listCountries();
  const selected =
    (await getCountryById(params.country)) ?? (await getDefaultCountry());

  const [pageCounts, postCounts, productCounts, settings] = await Promise.all([
    prisma.page.groupBy({ by: ['countryId'], where: { deletedAt: null }, _count: { _all: true } }),
    prisma.blogPost.groupBy({
      by: ['countryId'],
      where: { deletedAt: null },
      _count: { _all: true },
    }),
    // Only what each market actually offers: a withdrawn product is not part
    // of that market's catalogue, so counting it would overstate every number
    // on this screen.
    prisma.productCountry.groupBy({
      by: ['countryId'],
      where: { deletedAt: null },
      _count: { _all: true },
    }),
    getCountrySettingsRow(selected.id),
  ]);

  const countOf = (
    rows: Array<{ countryId: string; _count: { _all: number } }>,
    countryId: string,
  ) => rows.find((row) => row.countryId === countryId)?._count._all ?? 0;

  const rows: CountryRow[] = countries.map((country) => ({
    id: country.id,
    name: country.name,
    code: country.code,
    slug: country.slug,
    locale: country.locale,
    currency: country.currency,
    currencySymbol: country.currencySymbol,
    phoneCode: country.phoneCode,
    timezone: country.timezone,
    isDefault: country.isDefault,
    isActive: country.isActive,
    isPublished: country.isPublished,
    sortOrder: country.sortOrder,
    pageCount: countOf(pageCounts, country.id),
    postCount: countOf(postCounts, country.id),
    productCount: countOf(productCounts, country.id),
  }));

  // Only the editable columns; the form owns every one of them and an empty
  // value means "inherit the global setting".
  const settingsValues: CountrySettingsValues = Object.fromEntries(
    (
      [
        'companyName',
        'legalName',
        'salesPhone',
        'supportPhone',
        'whatsappNumber',
        'salesEmail',
        'supportEmail',
        'addressLine1',
        'addressLine2',
        'city',
        'region',
        'postalCode',
        'address',
        'businessHours',
        'taxLabel',
        'taxNumber',
        'headerCtaLabel',
        'headerCtaUrl',
        'salesCtaText',
        'defaultTitle',
        'titleTemplate',
        'defaultDescription',
        'defaultOgImageUrl',
        'organizationName',
        'organizationType',
        'organizationLogoUrl',
        'localBusinessType',
        'latitude',
        'longitude',
        'robotsDisallow',
        'robotsAllow',
      ] as const
    ).map((key) => [key, settings?.[key] ?? '']),
  );

  // The two booleans travel as strings, like every other value in this form.
  settingsValues.noIndexCountry = String(settings?.noIndexCountry ?? false);
  settingsValues.excludeFromSitemap = String(settings?.excludeFromSitemap ?? false);

  return (
    <div className="max-w-5xl">
      <AdminPageHeader
        title="Countries"
        description="Each country is a storefront with its own URLs, pricing, content and contact details."
        crumbs={[{ label: 'Settings', href: '/admin/settings' }, { label: 'Countries' }]}
      />

      <Alert tone="info" className="mb-5">
        The default country is served from the site root — its URLs have no prefix and never change.
        Every other country is served from its own prefix, for example{' '}
        <code className="font-mono text-xs">/ae/dropbox-business</code>. Pages, articles, menus and
        pricing all belong to exactly one country.
      </Alert>

      <CountriesManager
        countries={rows}
        settings={settingsValues}
        sourceName={rows.find((country) => country.isDefault)?.name ?? null}
        selectedId={selected.id}
        canEdit={userCan(user, 'settings.manage')}
      />
    </div>
  );
}

import type { Metadata } from 'next';
import { Plus, Wand2 } from 'lucide-react';
import { requirePermission, userCan } from '@/lib/auth/guards';
import { AdminPageHeader } from '@/components/admin/page-header';
import { FilterBar } from '@/components/admin/filter-bar';
import { StatCard } from '@/components/admin/stat-card';
import { CityImportButton } from '@/components/admin/cities/city-import-dialog';
import { prisma } from '@/lib/db/prisma';
import type { FilterDefinition, FilterPreset } from '@/lib/admin/filters';
import { AdminPagination } from '@/components/admin/admin-pagination';
import { Card } from '@/components/ui/card';
import { ButtonLink } from '@/components/ui/button';
import { CitiesTable, type CityTableRow } from '@/components/admin/cities/cities-table';
import { resolveListCountry, countryFilterDefinition } from '@/lib/admin/country-filter';
import { listCities } from '@/lib/services/cities';
import { joinMarket } from '@/lib/urls/path';

export const metadata: Metadata = { title: 'Cities' };
export const dynamic = 'force-dynamic';

const PER_PAGE = 25;

export default async function CitiesAdmin({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; country?: string; page?: string }>;
}) {
  const user = await requirePermission('pages.view');
  const params = await searchParams;

  // Like every market-scoped list: the market chosen in the topbar, unless
  // the editor asks for another one or for all of them.
  const country = await resolveListCountry(user, params.country);
  const page = Math.max(1, Number(params.page) || 1);

  const { rows, total } = await listCities({
    countryId: country.countryId,
    countryIds: country.countries.map((row) => row.id),
    q: params.q,
    status: params.status,
    page,
    perPage: PER_PAGE,
  });

  const can = {
    create: userCan(user, 'pages.create'),
    edit: userCan(user, 'pages.edit'),
    publish: userCan(user, 'pages.publish'),
    delete: userCan(user, 'pages.delete'),
  };

  const tableRows: CityTableRow[] = rows.map((row) => ({
    ...row,
    path: joinMarket(row.country.slug, row.slug),
  }));

  const definitions: FilterDefinition[] = [
    ...countryFilterDefinition(country),
    {
      name: 'status',
      label: 'Status',
      allLabel: 'Draft and published',
      options: [
        { label: 'Draft', value: 'draft' },
        { label: 'Published', value: 'published' },
        { label: 'Archived', value: 'archived' },
        { label: 'Every status', value: 'all' },
        { label: 'No landing page', value: 'no-landing' },
      ],
    },
  ];

  const presets: FilterPreset[] = [
    { id: 'current', label: 'Current cities', params: {} },
    { id: 'draft', label: 'Drafts', params: { status: 'draft' } },
    { id: 'published', label: 'Published', params: { status: 'published' } },
    { id: 'archived', label: 'Archived', params: { status: 'archived' } },
  ];

  // The cities at a glance, in the same scope as the list (one market, or every
  // market this user may see) and unaffected by the filters below.
  const scope = country.countryId
    ? { countryId: country.countryId }
    : { countryId: { in: country.countries.map((row) => row.id) } };
  const [publishedTotal, draftTotal, archivedTotal, cityPageTotal] = await Promise.all([
    prisma.city.count({ where: { ...scope, status: 'PUBLISHED' } }),
    prisma.city.count({ where: { ...scope, status: 'DRAFT' } }),
    prisma.city.count({ where: { ...scope, status: 'ARCHIVED' } }),
    prisma.page.count({ where: { deletedAt: null, city: scope } }),
  ]);
  const withCountry = (query: string) =>
    `/admin/cities?${query}${params.country ? `&country=${encodeURIComponent(params.country)}` : ''}`;

  return (
    <>
      <AdminPageHeader
        title="Cities"
        description={
          country.multiCountry
            ? `Local address spaces inside a market — /delhi, /gurugram, /ae/dubai. You are looking at ${country.countryId ? country.current.name : 'all countries'}.`
            : 'Local address spaces inside the market, such as /delhi. Each city’s pages are ordinary pages built in the Page Builder.'
        }
        crumbs={[{ label: 'Locations' }, { label: 'Cities' }]}
        actions={
          <>
            {can.create ? <CityImportButton /> : null}
            {can.create ? (
              <ButtonLink href="/admin/cities/generator" variant="outline">
                <Wand2 className="h-4 w-4" aria-hidden="true" />
                City Page Generator
              </ButtonLink>
            ) : null}
            {can.create ? (
              <ButtonLink href="/admin/cities/new">
                <Plus className="h-4 w-4" aria-hidden="true" />
                New city
              </ButtonLink>
            ) : null}
          </>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard
          label="Published cities"
          value={publishedTotal}
          href={withCountry('status=published')}
          icon="globe"
          tone="success"
          hint="Their published pages are public"
        />
        <StatCard
          label="Draft cities"
          value={draftTotal}
          href={withCountry('status=draft')}
          icon="map-pin"
          tone={draftTotal > 0 ? 'warning' : 'default'}
          hint="Not public until published"
        />
        <StatCard label="Archived" value={archivedTotal} href={withCountry('status=archived')} icon="history" hint="Hidden; nothing deleted" />
        <StatCard label="City pages" value={cityPageTotal} href="/admin/pages" icon="layout" hint="Ordinary pages in a city’s address space" />
      </div>

      <FilterBar searchPlaceholder="Search cities by name, slug or region" definitions={definitions} presets={presets} />

      <Card>
        <CitiesTable
          rows={tableRows}
          can={can}
          showCountry={country.multiCountry}
          filtered={Boolean(params.q || params.status)}
        />
        {tableRows.length > 0 ? (
          <AdminPagination
            page={page}
            pages={Math.max(1, Math.ceil(total / PER_PAGE))}
            total={total}
            basePath="/admin/cities"
            params={params}
          />
        ) : null}
      </Card>
    </>
  );
}

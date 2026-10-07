import type { Metadata } from 'next';
import { Plus, FolderTree } from 'lucide-react';
import { prisma } from '@/lib/db/prisma';
import { requirePermission, userCan } from '@/lib/auth/guards';
import { AdminPageHeader } from '@/components/admin/page-header';
import { FilterBar } from '@/components/admin/filter-bar';
import type { FilterDefinition, FilterPreset } from '@/lib/admin/filters';
import { AdminPagination } from '@/components/admin/admin-pagination';
import { PagesTable, type PageRow } from '@/components/admin/pages/pages-table';
import { Card } from '@/components/ui/card';
import { ButtonLink, buttonClasses } from '@/components/ui/button';
import Link from 'next/link';
import { listPageCategoryOptions } from '@/lib/services/page-categories';
import { resolveListCountry, countryFilterDefinition } from '@/lib/admin/country-filter';
import { listCityOptions } from '@/lib/services/cities';
import type { Prisma } from '@prisma/client';

export const metadata: Metadata = { title: 'Pages' };
export const dynamic = 'force-dynamic';

const PER_PAGE = 20;

export default async function PagesAdmin({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    category?: string;
    country?: string;
    city?: string;
    page?: string;
  }>;
}) {
  const user = await requirePermission('pages.view');
  const params = await searchParams;

  // Pages belong to a market, so the list follows the market chosen in the
  // topbar unless the editor explicitly asks for another or for all of them.
  const country = await resolveListCountry(user, params.country);

  const page = Math.max(1, Number(params.page) || 1);
  const where: Prisma.PageWhereInput = { deletedAt: null };
  if (country.countryId) where.countryId = country.countryId;
  if (params.q?.trim()) {
    where.OR = [
      { title: { contains: params.q.trim(), mode: 'insensitive' } },
      { slug: { contains: params.q.trim(), mode: 'insensitive' } },
    ];
  }
  if (params.status) where.status = params.status as Prisma.PageWhereInput['status'];
  // 'none' is the sentinel for pages that have no category, so the filter can
  // express "uncategorised" as well as a specific category.
  if (params.category === 'none') where.categoryId = null;
  else if (params.category) where.categoryId = params.category;

  // A city's pages, or pages outside every city. The city must be in a market
  // in view; any other id is ignored.
  const cityOptions = await listCityOptions(
    country.countryId ? [country.countryId] : country.countries.map((row) => row.id),
  );
  const city = cityOptions.find((option) => option.id === params.city);
  if (params.city === 'none') where.cityId = null;
  else if (city) where.cityId = city.id;

  const [rows, total, categoryOptions] = await Promise.all([
    prisma.page.findMany({
      where,
      orderBy: [{ isHomepage: 'desc' }, { updatedAt: 'desc' }],
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
      select: {
        id: true,
        title: true,
        slug: true,
        status: true,
        isHomepage: true,
        updatedAt: true,
        country: { select: { code: true, name: true, slug: true } },
        category: { select: { id: true, name: true } },
        city: { select: { name: true } },
        isCityHomepage: true,
        _count: { select: { sections: true } },
      },
    }),
    prisma.page.count({ where }),
    listPageCategoryOptions(),
  ]);

  const can = {
    edit: userCan(user, 'pages.edit'),
    publish: userCan(user, 'pages.publish'),
    create: userCan(user, 'pages.create'),
    delete: userCan(user, 'pages.delete'),
  };

  const tableRows: PageRow[] = rows.map((row) => ({
    id: row.id,
    title: row.title,
    slug: row.slug,
    status: row.status,
    isHomepage: row.isHomepage,
    updatedAt: row.updatedAt.toISOString(),
    categoryName: row.category?.name ?? null,
    cityName: row.city?.name ?? null,
    isCityHomepage: row.isCityHomepage,
    countryName: row.country.name,
    countryCode: row.country.code,
    countrySlug: row.country.slug,
    sectionCount: row._count.sections,
  }));

  const definitions: FilterDefinition[] = [
    ...countryFilterDefinition(country),
    {
      name: 'status',
      label: 'Status',
      allLabel: 'Any status',
      options: [
        { label: 'Published', value: 'PUBLISHED' },
        { label: 'Draft', value: 'DRAFT' },
        { label: 'Scheduled', value: 'SCHEDULED' },
        { label: 'Archived', value: 'ARCHIVED' },
      ],
    },
    ...(cityOptions.length > 0
      ? [
          {
            name: 'city',
            label: 'City',
            allLabel: 'Any city',
            options: [
              { label: 'Not in a city', value: 'none' },
              ...cityOptions.map((option) => ({ label: option.name, value: option.id })),
            ],
          },
        ]
      : []),
    {
      name: 'category',
      label: 'Category',
      allLabel: 'Any category',
      options: [
        { label: 'Uncategorised', value: 'none' },
        ...categoryOptions.map((option) => ({
          // The em-dashes mirror the tree depth so the dropdown reads as a
          // hierarchy rather than a flat list.
          label: `${'— '.repeat(option.depth)}${option.name}`,
          value: option.id,
        })),
      ],
    },
  ];

  const presets: FilterPreset[] = [
    { id: 'all', label: 'All pages', params: {} },
    { id: 'published', label: 'Published', params: { status: 'PUBLISHED' } },
    { id: 'drafts', label: 'Drafts', params: { status: 'DRAFT' } },
  ];

  return (
    <>
      <AdminPageHeader
        title="Pages"
        description={
          country.multiCountry
            ? `Every page on the website. You are working in ${country.countryId ? country.current.name : 'all countries'}.`
            : 'Every page on the website. Create, arrange sections and publish without touching code.'
        }
        crumbs={[{ label: 'Pages' }]}
        actions={
          <>
            {can.edit ? (
              <Link href="/admin/pages/categories" className={buttonClasses('outline', 'md')}>
                <FolderTree className="h-4 w-4" aria-hidden="true" />
                Categories
              </Link>
            ) : null}
            {can.create ? (
              <ButtonLink href="/admin/pages/new">
                <Plus className="h-4 w-4" aria-hidden="true" />
                New page
              </ButtonLink>
            ) : null}
          </>
        }
      />

      <FilterBar
        searchPlaceholder="Search pages by title or URL"
        definitions={definitions}
        presets={presets}
      />

      <Card>
        <PagesTable
          rows={tableRows}
          can={can}
          showCountry={country.multiCountry}
          countries={country.countries
            .filter((row) => row.isActive)
            .map((row) => ({ id: row.id, code: row.code, name: row.name }))}
          filtered={Boolean(params.q || params.status || params.city)}
        />
        {tableRows.length > 0 ? (
          <AdminPagination
            page={page}
            pages={Math.max(1, Math.ceil(total / PER_PAGE))}
            total={total}
            basePath="/admin/pages"
            params={params}
          />
        ) : null}
      </Card>
    </>
  );
}

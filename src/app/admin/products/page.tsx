import type { Metadata } from 'next';
import { getUrlSnapshot } from '@/lib/urls/load';
import { productHref } from '@/lib/urls/links';
import Link from 'next/link';
import { Plus, Tag, ArrowUpDown, Building2, Trash2 } from 'lucide-react';
import { prisma } from '@/lib/db/prisma';
import { requirePermission, userCan } from '@/lib/auth/guards';
import { AdminPageHeader } from '@/components/admin/page-header';
import { FilterBar } from '@/components/admin/filter-bar';
import type { FilterDefinition, FilterPreset } from '@/lib/admin/filters';
import { AdminPagination } from '@/components/admin/admin-pagination';
import { ProductsTable, type ProductRow } from '@/components/admin/products/products-table';
import { Card } from '@/components/ui/card';
import { ButtonLink, buttonClasses } from '@/components/ui/button';
import { decimalToString } from '@/lib/utils/money';
import { getAdminCountryScope } from '@/lib/country/admin';
import type { Prisma } from '@prisma/client';

export const metadata: Metadata = { title: 'Products' };
export const dynamic = 'force-dynamic';

const PER_PAGE = 20;

export default async function ProductsAdmin({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    category?: string;
    brand?: string;
    featured?: string;
    page?: string;
  }>;
}) {
  const user = await requirePermission('products.view');
  const scope = await getAdminCountryScope();
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);

  /*
   * The catalogue of the market being worked in, not the global one.
   *
   * A product is in a market's catalogue when that market has a live
   * `ProductCountry` row for it. Listing every product regardless meant a UAE
   * administrator saw India's plans, could delete one, and — before deletion
   * was scoped — removed it from India by doing so.
   *
   * The market's own status is what the Status filter matches, for the same
   * reason: "Published" on this screen has to mean published *here*.
   */
  const where: Prisma.ProductWhereInput = {
    deletedAt: null,
    countries: { some: { countryId: scope.country.id, deletedAt: null } },
  };
  if (params.q?.trim()) {
    where.OR = [
      { name: { contains: params.q.trim(), mode: 'insensitive' } },
      { slug: { contains: params.q.trim(), mode: 'insensitive' } },
      { sku: { contains: params.q.trim(), mode: 'insensitive' } },
    ];
  }
  if (params.status) {
    where.countries = {
      some: {
        countryId: scope.country.id,
        deletedAt: null,
        status: params.status as Prisma.ProductCountryWhereInput['status'],
      },
    };
  }
  if (params.category) where.categoryId = params.category;
  if (params.brand) where.brandId = params.brand;
  if (params.featured === 'yes' || params.featured === 'no') {
    const existing = (where.countries?.some ?? {}) as Prisma.ProductCountryWhereInput;
    where.countries = {
      some: { ...existing, isFeatured: params.featured === 'yes' },
    };
  }

  const [rows, total, categories, brands] = await Promise.all([
    prisma.product.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
      select: {
        id: true,
        name: true,
        slug: true,
        sku: true,
        status: true,
        isFeatured: true,
        storage: true,
        currency: true,
        monthlyPrice: true,
        annualPrice: true,
        category: { select: { name: true } },
        /*
         * Every market that still offers it, in one go: this market's own row
         * supplies the status, price and currency the screen shows — the
         * global row's INR price is not what the UAE charges — and the rest
         * supply the "live in" badges. Two filtered selects of the same
         * relation are not possible in one query, and two queries would be a
         * second round trip for something already in hand.
         */
        countries: {
          where: { deletedAt: null },
          select: {
            countryId: true,
            status: true,
            isFeatured: true,
            currency: true,
            monthlyPrice: true,
            annualPrice: true,
            country: { select: { code: true } },
          },
        },
        _count: { select: { leads: true } },
      },
    }),
    prisma.product.count({ where }),
    prisma.productCategory.findMany({
      where: { deletedAt: null },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.brand.findMany({
      where: { deletedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
  ]);

  const can = {
    edit: userCan(user, 'products.edit'),
    create: userCan(user, 'products.create'),
    delete: userCan(user, 'products.delete'),
  };

  // "View" opens the product where the URL registry has it in this market.
  await getUrlSnapshot();
  const tableRows: ProductRow[] = rows.map((row) => {
    // This market's configuration. Present by construction — the query only
    // returns products this market offers — but read defensively so a race
    // with a withdrawal renders a row rather than throwing.
    const here = row.countries.find((entry) => entry.countryId === scope.country.id);

    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      publicPath: productHref(scope.country, row),
      sku: row.sku,
      status: here?.status ?? row.status,
      isFeatured: here?.isFeatured ?? row.isFeatured,
      categoryName: row.category?.name ?? null,
      storage: row.storage,
      currency: here?.currency ?? row.currency,
      monthlyPrice: decimalToString(here?.monthlyPrice ?? row.monthlyPrice),
      annualPrice: decimalToString(here?.annualPrice ?? row.annualPrice),
      liveIn: row.countries
        .filter((entry) => entry.status === 'PUBLISHED')
        .map((entry) => entry.country.code),
      leadCount: row._count.leads,
    };
  });

  const definitions: FilterDefinition[] = [
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
    {
      name: 'category',
      label: 'Category',
      allLabel: 'Any category',
      options: categories.map((category) => ({
        label: category.name,
        value: category.id,
      })),
    },
    {
      name: 'brand',
      label: 'Brand',
      allLabel: 'Any brand',
      advanced: true,
      options: brands.map((brand) => ({ label: brand.name, value: brand.id })),
    },
    {
      name: 'featured',
      label: 'Featured',
      allLabel: 'Featured or not',
      options: [
        { label: 'Featured only', value: 'yes' },
        { label: 'Not featured', value: 'no' },
      ],
    },
  ];

  const presets: FilterPreset[] = [
    { id: 'all', label: 'All products', params: {} },
    { id: 'published', label: 'Published', params: { status: 'PUBLISHED' } },
    { id: 'drafts', label: 'Drafts', params: { status: 'DRAFT' } },
    { id: 'featured', label: 'Featured', params: { featured: 'yes' } },
  ];

  return (
    <>
      <AdminPageHeader
        title="Products"
        description="Plans shown on the website. Pricing here drives every product card and comparison table."
        crumbs={[{ label: 'Products' }]}
        actions={
          <>
            {can.edit ? (
              <>
                <Link href="/admin/products/order" className={buttonClasses('outline', 'md')}>
                  <ArrowUpDown className="h-4 w-4" aria-hidden="true" />
                  Order
                </Link>
                <Link href="/admin/products/brands" className={buttonClasses('outline', 'md')}>
                  <Building2 className="h-4 w-4" aria-hidden="true" />
                  Brands
                </Link>
                <Link href="/admin/products/categories" className={buttonClasses('outline', 'md')}>
                  <Tag className="h-4 w-4" aria-hidden="true" />
                  Categories
                </Link>
                {/* Where a removed product waits, and where its URL comes back from. */}
                <Link href="/admin/products/trash" className={buttonClasses('outline', 'md')}>
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  Removed
                </Link>
              </>
            ) : null}
            {can.create ? (
              <ButtonLink href="/admin/products/new">
                <Plus className="h-4 w-4" aria-hidden="true" />
                New product
              </ButtonLink>
            ) : null}
          </>
        }
      />

      <FilterBar
        searchPlaceholder="Search products by name or SKU"
        definitions={definitions}
        presets={presets}
      />

      <Card>
        <ProductsTable
          rows={tableRows}
          can={can}
          filtered={Boolean(
            params.q || params.status || params.category || params.brand || params.featured,
          )}
          showCountries={scope.canSwitch}
          countryName={scope.canSwitch ? scope.country.name : undefined}
          isDefaultCountry={scope.country.isDefault}
        />
        {tableRows.length > 0 ? (
          <AdminPagination
            page={page}
            pages={Math.max(1, Math.ceil(total / PER_PAGE))}
            total={total}
            basePath="/admin/products"
            params={params}
          />
        ) : null}
      </Card>
    </>
  );
}

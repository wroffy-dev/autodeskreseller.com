import type { Metadata } from 'next';
import Link from 'next/link';
import { Package } from 'lucide-react';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { requirePermission, userCan } from '@/lib/auth/guards';
import { getAdminCountryScope } from '@/lib/country/admin';
import { joinMarket } from '@/lib/urls/path';
import { effectivePattern } from '@/lib/urls/hints';
import { originalSlug } from '@/lib/utils/slug';
import { AdminPageHeader } from '@/components/admin/page-header';
import {
  ProductTrashTable,
  type TrashedProduct,
} from '@/components/admin/products/product-trash-table';
import { buttonClasses } from '@/components/ui/button';

export const metadata: Metadata = { title: 'Removed products' };
export const dynamic = 'force-dynamic';

/**
 * Removed products, for the market being worked in.
 *
 * Two things end up here, and the difference matters: a product this market
 * withdrew while another still sells it, and a product no market offers any
 * more. The first is still a live product elsewhere — its URL is genuinely
 * taken — and the second is retired, which is when its URL was freed and when
 * deleting it for good becomes possible.
 */
export default async function ProductTrashAdmin() {
  const user = await requirePermission('products.view');
  const scope = await getAdminCountryScope();

  const where: Prisma.ProductWhereInput = {
    OR: [
      // Retired: no market offers it.
      { deletedAt: { not: null } },
      // Withdrawn from this market only.
      {
        deletedAt: null,
        countries: { some: { countryId: scope.country.id, deletedAt: { not: null } } },
      },
    ],
  };

  const rows = await prisma.product.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
    take: 100,
    select: {
      id: true,
      name: true,
      slug: true,
      sku: true,
      deletedAt: true,
      countries: {
        select: { countryId: true, deletedAt: true },
      },
      _count: { select: { leads: true } },
    },
  });

  const products: TrashedProduct[] = rows.map((row) => {
    const here = row.countries.find((country) => country.countryId === scope.country.id);
    return {
      id: row.id,
      name: row.name,
      // The URL it is known by, not the mangled one it was parked under.
      slug: originalSlug(row.slug),
      sku: row.sku,
      removedAt: (row.deletedAt ?? here?.deletedAt ?? null)?.toISOString() ?? null,
      retired: row.deletedAt !== null,
      marketName: scope.country.name,
      stillSoldIn: row.countries.filter((country) => country.deletedAt === null).length,
      leads: row._count.leads,
    };
  });

  return (
    <>
      <AdminPageHeader
        title="Removed products"
        description="Products taken out of the catalogue. Restore one to bring it back as a draft, with the URL it had."
        crumbs={[{ label: 'Products', href: '/admin/products' }, { label: 'Removed' }]}
        actions={
          <Link href="/admin/products" className={buttonClasses('outline', 'md')}>
            <Package className="h-4 w-4" aria-hidden="true" />
            All products
          </Link>
        }
      />

      <ProductTrashTable
        products={products}
        canManage={userCan(user, 'products.delete')}
        urlPattern={joinMarket(scope.country.slug, await effectivePattern('PRODUCT', scope.country.id))}
      />
    </>
  );
}

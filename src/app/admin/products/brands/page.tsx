import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@/lib/db/prisma';
import { requirePermission, userCan } from '@/lib/auth/guards';
import { getAdminCountryScope } from '@/lib/country/admin';
import { AdminPageHeader } from '@/components/admin/page-header';
import { BrandManager, type BrandRow } from '@/components/admin/products/brand-manager';
import { Card } from '@/components/ui/card';
import { buttonClasses } from '@/components/ui/button';
import { taxonomyPageMap } from '@/lib/services/taxonomy-pages';

export const metadata: Metadata = { title: 'Brands' };
export const dynamic = 'force-dynamic';

export default async function BrandsAdmin() {
  const user = await requirePermission('products.view');
  const scope = await getAdminCountryScope();

  const brands = await prisma.brand.findMany({
    // Only what this market carries. See the categories screen.
    where: { deletedAt: null, countries: { some: { countryId: scope.country.id } } },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    include: {
      logo: { select: { url: true } },
      _count: { select: { products: true } },
    },
  });

  // Which of them already have their page in this market. See the categories
  // screen — same reasoning, same shape.
  const pages = await taxonomyPageMap('brand', brands, scope.country.id);

  const rows: BrandRow[] = brands.map((brand) => ({
    id: brand.id,
    name: brand.name,
    slug: brand.slug,
    description: brand.description,
    websiteUrl: brand.websiteUrl,
    sortOrder: brand.sortOrder,
    logoId: brand.logoId,
    logoUrl: brand.logo?.url ?? null,
    productCount: brand._count.products,
    pageId: pages.get(brand.id) ?? null,
  }));

  return (
    <>
      <AdminPageHeader
        title="Brands"
        description="Group products by vendor. A product section can then show everything from one brand."
        crumbs={[{ label: 'Products', href: '/admin/products' }, { label: 'Brands' }]}
        actions={
          <Link href="/admin/products/categories" className={buttonClasses('outline', 'sm')}>
            Categories
          </Link>
        }
      />
      <Card>
        <BrandManager
          rows={rows}
          canEdit={userCan(user, 'products.edit')}
          canDelete={userCan(user, 'products.delete')}
        />
      </Card>
    </>
  );
}

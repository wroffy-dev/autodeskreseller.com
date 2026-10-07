import type { Metadata } from 'next';
import { prisma } from '@/lib/db/prisma';
import { requirePermission, userCan } from '@/lib/auth/guards';
import { getAdminCountryScope } from '@/lib/country/admin';
import { AdminPageHeader } from '@/components/admin/page-header';
import { CategoryManager, type CategoryRow } from '@/components/admin/products/category-manager';
import { Card } from '@/components/ui/card';
import { taxonomyPageMap } from '@/lib/services/taxonomy-pages';

export const metadata: Metadata = { title: 'Product categories' };
export const dynamic = 'force-dynamic';

export default async function ProductCategories() {
  const user = await requirePermission('products.view');
  const scope = await getAdminCountryScope();

  const rows = await prisma.productCategory.findMany({
    // Only what this market offers. The rows are shared, so an unfiltered
    // list would show another market's categories and invite removing them.
    where: { deletedAt: null, countries: { some: { countryId: scope.country.id } } },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      sortOrder: true,
      imageId: true,
      _count: { select: { products: { where: { deletedAt: null } } } },
    },
  });

  // Which of them already have their page in this market, so the screen can
  // link to it rather than offer to make a second one.
  const pages = await taxonomyPageMap('category', rows, scope.country.id);

  const categories: CategoryRow[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    sortOrder: row.sortOrder,
    imageId: row.imageId,
    productCount: row._count.products,
    pageId: pages.get(row.id) ?? null,
  }));

  return (
    <div className="max-w-4xl">
      <AdminPageHeader
        title="Product categories"
        description="Group plans so a product block can pull “everything in this category”."
        crumbs={[{ label: 'Products', href: '/admin/products' }, { label: 'Categories' }]}
      />
      <Card className="p-4 sm:p-5">
        <CategoryManager
          rows={categories}
          canEdit={userCan(user, 'products.edit')}
          canDelete={userCan(user, 'products.delete')}
        />
      </Card>
    </div>
  );
}

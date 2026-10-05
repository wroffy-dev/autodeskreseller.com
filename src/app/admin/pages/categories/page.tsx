import type { Metadata } from 'next';
import { prisma } from '@/lib/db/prisma';
import { requirePermission, userCan } from '@/lib/auth/guards';
import { getAdminCountryScope } from '@/lib/country/admin';
import { AdminPageHeader } from '@/components/admin/page-header';
import { PageCategoryManager } from '@/components/admin/pages/page-category-manager';
import type { CategoryRow } from '@/components/admin/category-tree-manager';
import { Card } from '@/components/ui/card';

export const metadata: Metadata = { title: 'Page categories' };
export const dynamic = 'force-dynamic';

export default async function PageCategories() {
  const user = await requirePermission('pages.view');
  const scope = await getAdminCountryScope();

  const rows = await prisma.pageCategory.findMany({
    // Only what this market uses. See the product categories screen.
    where: { countries: { some: { countryId: scope.country.id } } },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      parentId: true,
      sortOrder: true,
      _count: { select: { pages: { where: { deletedAt: null } } } },
    },
  });

  const categories: CategoryRow[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    parentId: row.parentId,
    sortOrder: row.sortOrder,
    itemCount: row._count.pages,
  }));

  return (
    <div className="max-w-4xl">
      <AdminPageHeader
        title="Page categories"
        description="Group pages into a nested structure, e.g. Solutions → Cloud Solutions. Deleting a category never deletes its pages."
        crumbs={[{ label: 'Pages', href: '/admin/pages' }, { label: 'Categories' }]}
      />
      <Card className="p-4 sm:p-5">
        <PageCategoryManager
          rows={categories}
          canEdit={userCan(user, 'pages.edit')}
          canDelete={userCan(user, 'pages.delete')}
        />
      </Card>
    </div>
  );
}

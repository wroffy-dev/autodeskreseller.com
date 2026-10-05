import type { Metadata } from 'next';
import { prisma } from '@/lib/db/prisma';
import { requirePermission } from '@/lib/auth/guards';
import { AdminPageHeader } from '@/components/admin/page-header';
import { ProductForm, EMPTY_PRODUCT } from '@/components/admin/products/product-form';

export const metadata: Metadata = { title: 'New product' };
export const dynamic = 'force-dynamic';

export default async function NewProduct() {
  await requirePermission('products.create');

  const [categories, brands, forms] = await Promise.all([
    prisma.productCategory.findMany({
      where: { deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true },
    }),
    prisma.brand.findMany({
      where: { deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true },
    }),
    prisma.form.findMany({ where: { deletedAt: null }, select: { id: true, slug: true } }),
  ]);

  return (
    <div className="max-w-3xl">
      <AdminPageHeader
        title="New product"
        description="Add the plan, its pricing and the form its button should open."
        crumbs={[{ label: 'Products', href: '/admin/products' }, { label: 'New' }]}
      />
      <ProductForm
        initial={EMPTY_PRODUCT}
        categories={categories}
        brands={brands}
        formIdBySlug={Object.fromEntries(forms.map((f) => [f.slug, f.id]))}
        mode="create"
      />
    </div>
  );
}

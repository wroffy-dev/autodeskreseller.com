import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Eye, Palette, Pencil } from 'lucide-react';
import type { ProductSurface } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { requirePermission, userCan } from '@/lib/auth/guards';
import { getProductSectionRows } from '@/lib/services/product-cms';
import { parseBlockContent } from '@/lib/cms/blocks';
import { AdminPageHeader } from '@/components/admin/page-header';
import { ProductLayoutBuilder } from '@/components/admin/products/product-layout-builder';
import type { BuilderSection } from '@/components/cms/section-builder';
import { buttonClasses } from '@/components/ui/button';
import { productHref } from '@/lib/urls/links';
import { getUrlSnapshot } from '@/lib/urls/load';
import { getAdminCountryScope } from '@/lib/country/admin';

export const metadata: Metadata = { title: 'Product layout' };
export const dynamic = 'force-dynamic';

/**
 * One product's page structure.
 *
 * Sections belong to the product, so this screen hangs off the product rather
 * than off the catalogue: what is arranged here changes this product's page
 * and nothing else. A product that has never been arranged shows the built-in
 * arrangement and an invitation to take it over.
 */
export default async function ProductLayoutAdmin({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requirePermission('products.view');

  const product = await prisma.product.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, name: true, slug: true },
  });
  if (!product) notFound();

  const [detail, sidebar, scope] = await Promise.all([
    getProductSectionRows(product.id, 'DETAIL'),
    getProductSectionRows(product.id, 'SIDEBAR'),
    getAdminCountryScope(),
    getUrlSnapshot(),
  ]);
  // "View product" opens it where the URL registry has it in this market.
  const root = scope.country;

  const toBuilder = (rows: typeof detail): BuilderSection[] =>
    rows.map((row) => ({
      id: row.id,
      blockType: row.blockType,
      name: row.name,
      isVisible: row.isVisible,
      sortOrder: row.sortOrder,
      content: parseBlockContent(row.blockType, row.content),
      settings: (row.settings ?? {}) as Record<string, unknown>,
    }));

  const surfaces: Record<ProductSurface, BuilderSection[]> = {
    DETAIL: toBuilder(detail),
    SIDEBAR: toBuilder(sidebar),
  };

  return (
    <>
      <AdminPageHeader
        title={`${product.name} — layout`}
        description="Drag this product's sections into any order, add anything you can add to a page, and hide what it does not need. Only this product is affected."
        crumbs={[
          { label: 'Products', href: '/admin/products' },
          { label: product.name, href: `/admin/products/${product.id}` },
          { label: 'Layout' },
        ]}
        actions={
          <>
            <Link
              href={`/admin/products/${product.id}`}
              className={buttonClasses('outline', 'md')}
            >
              <Pencil className="h-4 w-4" aria-hidden="true" />
              Edit details
            </Link>
            <Link href="/admin/products/design" className={buttonClasses('outline', 'md')}>
              <Palette className="h-4 w-4" aria-hidden="true" />
              Product design
            </Link>
            <Link
              href={productHref(root, product)}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonClasses('outline', 'md')}
            >
              <Eye className="h-4 w-4" aria-hidden="true" />
              View product
            </Link>
          </>
        }
      />

      <ProductLayoutBuilder
        productId={product.id}
        surfaces={surfaces}
        canEdit={userCan(user, 'products.edit')}
      />
    </>
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';
import { Gauge } from 'lucide-react';
import { prisma } from '@/lib/db/prisma';
import { requirePermission, userCan } from '@/lib/auth/guards';
import { AdminPageHeader } from '@/components/admin/page-header';
import { BlogCategoryManager } from '@/components/admin/blog/category-manager';
import type { CategoryRow } from '@/components/admin/category-tree-manager';
import { Card } from '@/components/ui/card';
import { buttonClasses } from '@/components/ui/button';
import { effectivePattern } from '@/lib/urls/hints';

export const metadata: Metadata = { title: 'Blog categories' };
export const dynamic = 'force-dynamic';

export default async function BlogCategories() {
  const user = await requirePermission('blog.view');

  const rows = await prisma.blogCategory.findMany({
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      parentId: true,
      sortOrder: true,
      seoTitle: true,
      seoDescription: true,
      isActive: true,
      imageId: true,
      bannerImageId: true,
      archiveTitle: true,
      archiveDescription: true,
      canonicalUrl: true,
      ogTitle: true,
      ogDescription: true,
      ogImageId: true,
      noIndex: true,
      noFollow: true,
      primaryKeyword1: true,
      primaryKeyword2: true,
      primaryKeyword3: true,
      _count: { select: { posts: { where: { deletedAt: null } } } },
    },
  });

  const categories: CategoryRow[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    parentId: row.parentId,
    sortOrder: row.sortOrder,
    seoTitle: row.seoTitle,
    seoDescription: row.seoDescription,
    itemCount: row._count.posts,
    extra: {
      isActive: row.isActive,
      imageId: row.imageId,
      bannerImageId: row.bannerImageId,
      archiveTitle: row.archiveTitle,
      archiveDescription: row.archiveDescription,
      canonicalUrl: row.canonicalUrl,
      ogTitle: row.ogTitle,
      ogDescription: row.ogDescription,
      ogImageId: row.ogImageId,
      noIndex: row.noIndex,
      noFollow: row.noFollow,
      primaryKeyword1: row.primaryKeyword1 ?? '',
      primaryKeyword2: row.primaryKeyword2 ?? '',
      primaryKeyword3: row.primaryKeyword3 ?? '',
    },
  }));

  return (
    <div className="max-w-4xl">
      <AdminPageHeader
        title="Blog categories"
        description="Each category gets its own archive page and appears in the blog filter bar. Categories can nest, e.g. Microsoft → Azure."
        crumbs={[{ label: 'Blog', href: '/admin/blog' }, { label: 'Categories' }]}
        actions={
          userCan(user, 'seo.manage') ? (
            <Link
              href="/admin/seo-intelligence?type=category"
              className={buttonClasses('outline', 'md')}
            >
              <Gauge className="h-4 w-4" aria-hidden="true" />
              SEO scores
            </Link>
          ) : undefined
        }
      />
      <Card className="p-4 sm:p-5">
        <BlogCategoryManager
          rows={categories}
          canEdit={userCan(user, 'blog.edit')}
          canDelete={userCan(user, 'blog.delete')}
          urlPattern={await effectivePattern('BLOG_CATEGORY', null)}
        />
      </Card>
    </div>
  );
}

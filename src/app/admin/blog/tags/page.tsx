import type { Metadata } from 'next';
import { prisma } from '@/lib/db/prisma';
import { requirePermission, userCan } from '@/lib/auth/guards';
import { AdminPageHeader } from '@/components/admin/page-header';
import { TagManager, type TagRow } from '@/components/admin/blog/tag-manager';
import { Card } from '@/components/ui/card';
import { effectivePattern } from '@/lib/urls/hints';

export const metadata: Metadata = { title: 'Blog tags' };
export const dynamic = 'force-dynamic';

export default async function BlogTags({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const user = await requirePermission('blog.view');
  const params = await searchParams;
  const query = params.q?.trim() ?? '';

  // Filtering happens here, not in the browser, so the page stays cheap as the
  // tag list grows.
  const rows = await prisma.blogTag.findMany({
    where: query
      ? {
          OR: [
            { name: { contains: query, mode: 'insensitive' } },
            { slug: { contains: query, mode: 'insensitive' } },
          ],
        }
      : undefined,
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    take: 500,
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      isActive: true,
      seoTitle: true,
      seoDescription: true,
      canonicalUrl: true,
      noIndex: true,
      _count: { select: { posts: true } },
    },
  });

  const tags: TagRow[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    postCount: row._count.posts,
    description: row.description,
    isActive: row.isActive,
    seoTitle: row.seoTitle,
    seoDescription: row.seoDescription,
    canonicalUrl: row.canonicalUrl,
    noIndex: row.noIndex,
  }));

  return (
    <div className="max-w-4xl">
      <AdminPageHeader
        title="Blog tags"
        description="Tags are created automatically when a post uses a new one. Rename, re-slug or clear out unused ones here."
        crumbs={[{ label: 'Blog', href: '/admin/blog' }, { label: 'Tags' }]}
      />
      <Card className="p-4 sm:p-5">
        <TagManager
          rows={tags}
          query={query}
          canEdit={userCan(user, 'blog.edit')}
          canDelete={userCan(user, 'blog.delete')}
          urlPattern={await effectivePattern('BLOG_TAG', null)}
        />
      </Card>
    </div>
  );
}

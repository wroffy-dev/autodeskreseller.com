import type { Metadata } from 'next';
import { prisma } from '@/lib/db/prisma';
import { requirePermission, userCan } from '@/lib/auth/guards';
import { AdminPageHeader } from '@/components/admin/page-header';
import { PostForm } from '@/components/admin/blog/post-form';
import { EMPTY_POST } from '@/lib/cms/post-model';
import { getAdminCountryScope } from '@/lib/country/admin';
import { effectivePattern, patternHint } from '@/lib/urls/hints';

export const metadata: Metadata = { title: 'New post' };
export const dynamic = 'force-dynamic';

export default async function NewPost() {
  const user = await requirePermission('blog.create');

  const scope = await getAdminCountryScope();

  const [categories, authors, posts] = await Promise.all([
    prisma.blogCategory.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, parent: { select: { name: true } } },
    }),
    prisma.user.findMany({
      where: { deletedAt: null, status: 'ACTIVE' },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    // Related-article options are this market's articles: a relation to another
    // market's article would never render on the published page.
    prisma.blogPost.findMany({
      where: { deletedAt: null, countryId: scope.country.id },
      orderBy: { publishedAt: 'desc' },
      take: 100,
      select: { id: true, title: true },
    }),
  ]);

  return (
    <>
      <AdminPageHeader
        title="New post"
        description={
          scope.canSwitch
            ? `Write the article for ${scope.country.name}, set its category and tags, then publish.`
            : 'Write the article, set its category and tags, then publish.'
        }
        crumbs={[{ label: 'Blog', href: '/admin/blog' }, { label: 'New' }]}
      />
      <PostForm
        initial={{ ...EMPTY_POST, authorId: user.id }}
        categories={categories.map((category) => ({
          id: category.id,
          name: category.name,
          parentName: category.parent?.name ?? null,
        }))}
        authors={authors}
        posts={posts}
        canPublish={userCan(user, 'blog.publish')}
        canEdit
        mode="create"
        urlHint={patternHint(await effectivePattern('BLOG_POST', null))}
      />
    </>
  );
}

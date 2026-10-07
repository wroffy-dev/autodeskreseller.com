import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { ExternalLink, Eye } from 'lucide-react';
import { prisma } from '@/lib/db/prisma';
import { requirePermission, userCan, userCanAny } from '@/lib/auth/guards';
import { getBlogSectionRows } from '@/lib/services/blog-cms';
import { parsePostOptions } from '@/lib/cms/blog-settings';
import { AdminPageHeader } from '@/components/admin/page-header';
import { PostForm } from '@/components/admin/blog/post-form';
import { PostSidebarBuilder } from '@/components/admin/blog/post-sidebar-builder';
import type { PostFormValues } from '@/lib/cms/post-model';
import type { BuilderSection } from '@/components/cms/section-builder';
import { ContentStatusBadge } from '@/components/admin/lead-status-badge';
import { buttonClasses } from '@/components/ui/button';
import { getCountryById, getDefaultCountry, listActiveCountries } from '@/lib/country/registry';
import { postPath } from '@/lib/cms/blog-render';
import { getUrlSnapshot } from '@/lib/urls/load';
import { effectivePattern, patternHint } from '@/lib/urls/hints';
import { parseBlockContent } from '@/lib/cms/blocks';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const post = await prisma.blogPost.findUnique({ where: { id }, select: { title: true } });
  return { title: post ? `Edit ${post.title}` : 'Post' };
}

function toLocalInput(date: Date | null): string {
  if (!date) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export default async function EditPost({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission('blog.view');
  const { id } = await params;

  // Loaded first so the related-article options can be scoped to this
  // article's own market: a relation across markets would never render.
  const owner = await prisma.blogPost.findFirst({
    where: { id, deletedAt: null },
    select: { countryId: true },
  });
  if (!owner) notFound();

  const [post, categories, authors, posts, sidebarRows] = await Promise.all([
    prisma.blogPost.findFirst({
      where: { id, deletedAt: null },
      include: {
        tags: { include: { tag: true } },
        relatedTo: { orderBy: { sortOrder: 'asc' }, select: { targetId: true } },
      },
    }),
    prisma.blogCategory.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, parent: { select: { name: true } } },
    }),
    prisma.user.findMany({
      where: { deletedAt: null, status: 'ACTIVE' },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.blogPost.findMany({
      where: { deletedAt: null, countryId: owner.countryId, id: { not: id } },
      orderBy: { publishedAt: 'desc' },
      take: 100,
      select: { id: true, title: true },
    }),
    getBlogSectionRows('SIDEBAR', id),
  ]);
  if (!post) notFound();

  // The market the article belongs to, named in the header so an editor is
  // never in doubt about which storefront they are changing.
  const [country, countries] = await Promise.all([
    getCountryById(post.countryId).then(async (row) => row ?? (await getDefaultCountry())),
    listActiveCountries(),
  ]);
  // Where the article lives, from the URL registry. The blog is root-only, so
  // an article in another market has no address of its own.
  await getUrlSnapshot();
  const publicPath = postPath(post);

  const initial: PostFormValues = {
    id: post.id,
    title: post.title,
    slug: post.slug,
    subtitle: post.subtitle ?? '',
    status: post.status,
    publishedAt: toLocalInput(post.publishedAt),
    excerpt: post.excerpt ?? '',
    content: post.content,
    isFeatured: post.isFeatured,
    featuredPriority: post.featuredPriority,
    featuredImageId: post.featuredImageId,
    thumbnailId: post.thumbnailId,
    categoryId: post.categoryId ?? '',
    authorId: post.authorId ?? '',
    tags: post.tags.map((t) => t.tag.name),
    relatedIds: post.relatedTo.map((r) => r.targetId),
    options: parsePostOptions(post.options),
    sidebarMode: post.sidebarMode,
    seoTitle: post.seoTitle ?? '',
    seoDescription: post.seoDescription ?? '',
    // The migration copied every focus keyword into keyword 1; the fallback
    // covers an article saved by an older build in between.
    primaryKeyword1: post.primaryKeyword1 ?? post.focusKeyword ?? '',
    primaryKeyword2: post.primaryKeyword2 ?? '',
    primaryKeyword3: post.primaryKeyword3 ?? '',
    canonicalUrl: post.canonicalUrl ?? '',
    noIndex: post.noIndex,
    noFollow: post.noFollow,
    ogTitle: post.ogTitle ?? '',
    ogDescription: post.ogDescription ?? '',
    ogImageId: post.ogImageId,
    twitterImageId: post.twitterImageId,
  };

  const sidebarSections: BuilderSection[] = sidebarRows.map((row) => ({
    id: row.id,
    blockType: row.blockType,
    name: row.name,
    isVisible: row.isVisible,
    sortOrder: row.sortOrder,
    content: parseBlockContent(row.blockType, row.content),
    settings: (row.settings ?? {}) as Record<string, unknown>,
  }));

  return (
    <>
      <AdminPageHeader
        title={post.title}
        description={`${countries.length > 1 ? `${country.name} · ` : ''}${publicPath} · ${post.readingTime} min read`}
        crumbs={[{ label: 'Blog', href: '/admin/blog' }, { label: post.title }]}
        actions={
          <>
            <ContentStatusBadge status={post.status} />
            <Link
              href={`/admin/blog/${post.id}/preview`}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonClasses('outline', 'sm')}
            >
              <Eye className="h-4 w-4" aria-hidden="true" />
              Preview
            </Link>
            {post.status === 'PUBLISHED' ? (
              <Link
                href={publicPath}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonClasses('outline', 'sm')}
              >
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
                View live
              </Link>
            ) : null}
          </>
        }
      />
      <PostForm
        initial={initial}
        categories={categories.map((category) => ({
          id: category.id,
          name: category.name,
          parentName: category.parent?.name ?? null,
        }))}
        authors={authors}
        posts={posts}
        canPublish={userCan(user, 'blog.publish')}
        canEdit={userCan(user, 'blog.edit')}
        mode="edit"
        urlHint={patternHint(await effectivePattern('BLOG_POST', null))}
        sidebarSlot={
          post.sidebarMode === 'CUSTOM' ? (
            <PostSidebarBuilder
              postId={post.id}
              initialSections={sidebarSections}
              canEdit={userCanAny(user, ['blog.sidebar', 'blog.edit'])}
            />
          ) : null
        }
      />
    </>
  );
}

import type { Metadata } from 'next';
import { after } from 'next/server';
import {
  getPublishedPostById,
  recordPostView,
  getCategoryById,
  getTagById,
} from '@/lib/services/blog';
import { getBlogSettings } from '@/lib/services/blog-cms';
import { getSeoSettings, getWebsiteSettings } from '@/lib/services/settings';
import { buildMetadata } from '@/lib/seo/metadata';
import { primaryKeywords } from '@/lib/seo/keywords';
import { JsonLd } from '@/components/seo/json-ld';
import {
  blogArchiveJsonLd,
  blogCategoryJsonLd,
  blogPostJsonLd,
  blogTagJsonLd,
} from '@/lib/seo/page-schema';
import { BlogArchive } from '@/components/blog/blog-archive';
import { BlogArticle } from '@/components/blog/blog-article';
import { missingContent, type PublicTarget } from '@/lib/urls/resolve';

/**
 * Every blog surface.
 *
 * The archive, an article, a category archive and a tag archive, rendered
 * with the content the URL registry resolved — by id, so the blog can live at
 * `/blog` or `/insights` and an article keep its identity through any number
 * of renames. The blog is root-only: these surfaces are only ever reached in
 * the root market.
 */

export type BlogSearchParams = { page?: string; q?: string; tag?: string };

const notFoundMeta = (what: string): Metadata => ({
  title: `${what} not found`,
  robots: { index: false, follow: false },
});

// ---------------------------------------------------------------------------
// Archive
// ---------------------------------------------------------------------------

export async function blogArchiveMetadata(
  target: PublicTarget,
  params: BlogSearchParams,
): Promise<Metadata> {
  const settings = await getBlogSettings();
  const page = Math.max(1, Number(params.page) || 1);

  return buildMetadata({
    title: settings.seoTitle || 'Blog',
    description:
      settings.seoDescription ||
      'Guides, migration playbooks and administration tips for teams running Dropbox.',
    publicPath: target.path,
    country: target.country,
    canonicalUrl: settings.canonicalUrl,
    // A search result or page 2+ is not a page to index — the articles
    // themselves are already indexed on their own URLs.
    noIndex: settings.noIndex || page > 1 || Boolean(params.q?.trim()),
    noFollow: settings.noFollow,
    ogTitle: settings.ogTitle,
    ogDescription: settings.ogDescription,
    ogImageUrl: settings.ogImageUrl,
  });
}

export async function BlogArchiveSurface({
  target,
  searchParams,
}: {
  target: PublicTarget;
  searchParams: BlogSearchParams;
}) {
  return (
    <>
      <BlogArchive country={target.country} basePath={target.path} searchParams={searchParams} />
      <JsonLd data={blogArchiveJsonLd(target.country)} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Article
// ---------------------------------------------------------------------------

export async function blogPostMetadata(target: PublicTarget): Promise<Metadata> {
  const post = target.id ? await getPublishedPostById(target.country.id, target.id) : null;
  if (!post) return notFoundMeta('Article');

  return buildMetadata({
    title: post.seoTitle || post.title,
    description: post.seoDescription || post.excerpt,
    publicPath: target.path,
    country: target.country,
    // Root-only: there is one address, so there are no alternates to list.
    canonicalUrl: post.canonicalUrl,
    noIndex: post.noIndex,
    noFollow: post.noFollow,
    ogTitle: post.ogTitle,
    ogDescription: post.ogDescription,
    ogImageUrl: post.ogImage?.url ?? post.featuredImage?.url ?? null,
    twitterImageUrl: post.twitterImage?.url ?? null,
    type: 'article',
    publishedTime: post.publishedAt,
    modifiedTime: post.updatedAt,
    authorName: post.author?.name ?? null,
    keywords: primaryKeywords(post),
  });
}

export async function BlogPostSurface({ target }: { target: PublicTarget }) {
  const post = target.id ? await getPublishedPostById(target.country.id, target.id) : null;
  if (!post) return missingContent(target);

  const [site, seo] = await Promise.all([getWebsiteSettings(), getSeoSettings()]);

  // The view counter feeds the "Popular posts" sources. It runs after the
  // response so a write can never delay or fail the page.
  after(() => recordPostView(post.id));

  return (
    <>
      <BlogArticle post={post} country={target.country} />

      <JsonLd data={blogPostJsonLd(target.country, post, site, seo)} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Category archive
// ---------------------------------------------------------------------------

export async function blogCategoryMetadata(
  target: PublicTarget,
  params: BlogSearchParams,
): Promise<Metadata> {
  const category = target.id ? await getCategoryById(target.id, target.country.id) : null;
  if (!category) return notFoundMeta('Category');

  const page = Math.max(1, Number(params.page) || 1);
  // The market's own archive copy and SEO, when it has set any.
  const local = category.countries?.[0] ?? null;

  return buildMetadata({
    title:
      local?.seoTitle ||
      local?.archiveTitle ||
      category.seoTitle ||
      category.archiveTitle ||
      `${category.name} articles`,
    description:
      local?.seoDescription ||
      local?.archiveDescription ||
      category.seoDescription ||
      category.archiveDescription ||
      category.description,
    publicPath: target.path,
    country: target.country,
    canonicalUrl: local?.canonicalUrl || category.canonicalUrl,
    noIndex: (local?.noIndex ?? category.noIndex) || page > 1,
    noFollow: local?.noFollow ?? category.noFollow,
    ogTitle: local?.ogTitle || category.ogTitle,
    ogDescription: local?.ogDescription || category.ogDescription,
    ogImageUrl: category.ogImage?.url ?? category.bannerImage?.url ?? null,
    keywords: primaryKeywords(category),
  });
}

export async function BlogCategorySurface({
  target,
  searchParams,
}: {
  target: PublicTarget;
  searchParams: BlogSearchParams;
}) {
  const category = target.id ? await getCategoryById(target.id, target.country.id) : null;
  if (!category) return missingContent(target);

  return (
    <>
      <BlogArchive
        country={target.country}
        basePath={target.path}
        categorySlug={category.slug}
        categoryId={category.id}
        searchParams={searchParams}
      />
      <JsonLd data={blogCategoryJsonLd(target.country, category)} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Tag archive
// ---------------------------------------------------------------------------

export async function blogTagMetadata(
  target: PublicTarget,
  params: BlogSearchParams,
): Promise<Metadata> {
  const tag = target.id ? await getTagById(target.id) : null;
  if (!tag) return notFoundMeta('Tag');

  const page = Math.max(1, Number(params.page) || 1);

  return buildMetadata({
    title: tag.seoTitle || `${tag.name} articles`,
    description: tag.seoDescription || tag.description,
    publicPath: target.path,
    country: target.country,
    canonicalUrl: tag.canonicalUrl,
    noIndex: tag.noIndex || page > 1,
  });
}

export async function BlogTagSurface({
  target,
  searchParams,
}: {
  target: PublicTarget;
  searchParams: BlogSearchParams;
}) {
  const tag = target.id ? await getTagById(target.id) : null;
  if (!tag) return missingContent(target);

  return (
    <>
      <BlogArchive
        country={target.country}
        basePath={target.path}
        tagSlug={tag.slug}
        searchParams={searchParams}
      />
      <JsonLd data={blogTagJsonLd(target.country, tag)} />
    </>
  );
}

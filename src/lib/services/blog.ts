import 'server-only';
import { cache } from 'react';
import { prisma } from '@/lib/db/prisma';
import type { Prisma } from '@prisma/client';
import type { PostSource } from '@/lib/cms/blog-blocks';

/**
 * Evaluated per call so `new Date()` reflects the current request rather than
 * the moment the module was first imported.
 *
 * Pass a market to scope the clause to it. Omitting it deliberately spans every
 * market, which is what the hreflang and market-switcher lookups need.
 */
export function publishedPostWhere(countryId?: string) {
  return {
    deletedAt: null,
    status: 'PUBLISHED' as const,
    ...(countryId ? { countryId } : {}),
    OR: [{ publishedAt: null }, { publishedAt: { lte: new Date() } }],
  };
}

export const POSTS_PER_PAGE = 9;

const listSelect = {
  id: true,
  title: true,
  slug: true,
  subtitle: true,
  excerpt: true,
  publishedAt: true,
  updatedAt: true,
  readingTime: true,
  isFeatured: true,
  featuredImage: { select: { url: true, altText: true, width: true, height: true } },
  thumbnail: { select: { url: true, altText: true, width: true, height: true } },
  category: { select: { id: true, name: true, slug: true } },
  author: { select: { name: true, image: true, jobTitle: true } },
  tags: { select: { tag: { select: { id: true, name: true, slug: true } } } },
} satisfies Prisma.BlogPostSelect;

export type BlogListItem = Prisma.BlogPostGetPayload<{ select: typeof listSelect }>;

/** Selection every blog list shares, exported for the CMS block renderers. */
export const blogListSelect = listSelect;

// ---------------------------------------------------------------------------
// Category helpers
// ---------------------------------------------------------------------------

const allCategories = cache(async () =>
  prisma.blogCategory.findMany({ select: { id: true, parentId: true, slug: true } }),
);

/**
 * A category plus everything nested beneath it.
 *
 * "Dropbox" showing its Dropbox Business and Dropbox Sign articles is the point
 * of the hierarchy, so a category archive includes its descendants unless the
 * section explicitly asks not to.
 */
export async function categoryIdsWithChildren(categoryId: string): Promise<string[]> {
  const rows = await allCategories();
  const ids = [categoryId];
  let frontier = [categoryId];
  // The tree is small and cycle-free (the save action rejects cycles), but the
  // depth bound makes that independent of the data.
  for (let depth = 0; depth < 10 && frontier.length > 0; depth += 1) {
    const next = rows.filter((row) => row.parentId && frontier.includes(row.parentId)).map((r) => r.id);
    const fresh = next.filter((id) => !ids.includes(id));
    ids.push(...fresh);
    frontier = fresh;
  }
  return ids;
}

/**
 * A blog category with, when one exists, the current market's overrides.
 *
 * The taxonomy itself is global — one tree, not one per market — but an archive
 * can carry its own heading, description and SEO per market. A market with no
 * override row simply renders the category's global values.
 */
export const getCategoryBySlug = cache(async (slug: string, countryId?: string) =>
  prisma.blogCategory.findUnique({
    where: { slug },
    include: {
      bannerImage: { select: { url: true, altText: true, width: true, height: true } },
      image: { select: { url: true, altText: true, width: true, height: true } },
      ogImage: { select: { url: true } },
      parent: { select: { name: true, slug: true } },
      countries: countryId ? { where: { countryId }, take: 1 } : false,
    },
  }),
);

export const getTagBySlug = cache(async (slug: string) =>
  prisma.blogTag.findUnique({ where: { slug } }),
);

/** The same category, by the stable id the URL registry resolves to. */
export const getCategoryById = cache(async (id: string, countryId?: string) =>
  prisma.blogCategory.findUnique({
    where: { id },
    include: {
      bannerImage: { select: { url: true, altText: true, width: true, height: true } },
      image: { select: { url: true, altText: true, width: true, height: true } },
      ogImage: { select: { url: true } },
      parent: { select: { id: true, name: true, slug: true } },
      countries: countryId ? { where: { countryId }, take: 1 } : false,
    },
  }),
);

export const getTagById = cache(async (id: string) => prisma.blogTag.findUnique({ where: { id } }));

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

export type ListPostsOptions = {
  /** The market whose articles to list. Always supplied by public callers. */
  countryId?: string;
  page?: number;
  categorySlug?: string;
  categoryIds?: string[];
  tagSlug?: string;
  tagId?: string;
  query?: string;
  perPage?: number;
  featuredOnly?: boolean;
  excludeIds?: string[];
  includeIds?: string[];
  orderBy?: 'publishedAt' | 'updatedAt' | 'title' | 'views';
  orderDir?: 'asc' | 'desc';
};

function orderFor(options: ListPostsOptions): Prisma.BlogPostOrderByWithRelationInput[] {
  const dir = options.orderDir ?? 'desc';
  switch (options.orderBy) {
    case 'updatedAt':
      return [{ updatedAt: dir }];
    case 'title':
      return [{ title: dir }];
    case 'views':
      return [{ viewCount: dir }, { publishedAt: 'desc' }];
    default:
      return [{ publishedAt: dir }, { createdAt: dir }];
  }
}

/**
 * Builds the WHERE clause for a public article list.
 *
 * Search spans the title, subtitle, excerpt, body, category name and tag names,
 * which is what a visitor typing "migration" expects — and all of it runs in
 * Postgres, so a blog with thousands of posts still only ships one page.
 */
function postsWhere(options: ListPostsOptions): Prisma.BlogPostWhereInput {
  const where: Prisma.BlogPostWhereInput = { ...publishedPostWhere(options.countryId) };
  const and: Prisma.BlogPostWhereInput[] = [];

  if (options.categorySlug) where.category = { slug: options.categorySlug };
  if (options.categoryIds?.length) and.push({ categoryId: { in: options.categoryIds } });
  if (options.tagSlug) and.push({ tags: { some: { tag: { slug: options.tagSlug } } } });
  if (options.tagId) and.push({ tags: { some: { tagId: options.tagId } } });
  if (options.featuredOnly) and.push({ isFeatured: true });
  if (options.excludeIds?.length) and.push({ id: { notIn: options.excludeIds } });
  if (options.includeIds?.length) and.push({ id: { in: options.includeIds } });

  const q = options.query?.trim();
  if (q) {
    and.push({
      OR: [
        { title: { contains: q, mode: 'insensitive' } },
        { subtitle: { contains: q, mode: 'insensitive' } },
        { excerpt: { contains: q, mode: 'insensitive' } },
        { content: { contains: q, mode: 'insensitive' } },
        { category: { name: { contains: q, mode: 'insensitive' } } },
        { tags: { some: { tag: { name: { contains: q, mode: 'insensitive' } } } } },
      ],
    });
  }

  if (and.length > 0) where.AND = and;
  return where;
}

export async function listPosts(
  options: ListPostsOptions,
): Promise<{ posts: BlogListItem[]; total: number; pages: number; page: number }> {
  const perPage = Math.min(Math.max(options.perPage ?? POSTS_PER_PAGE, 1), 48);
  const page = Math.max(1, options.page ?? 1);
  const where = postsWhere(options);

  const [posts, total] = await Promise.all([
    prisma.blogPost.findMany({
      where,
      orderBy: options.featuredOnly
        ? [{ featuredPriority: 'asc' }, ...orderFor(options)]
        : orderFor(options),
      skip: (page - 1) * perPage,
      take: perPage,
      select: listSelect,
    }),
    prisma.blogPost.count({ where }),
  ]);

  return { posts, total, pages: Math.max(1, Math.ceil(total / perPage)), page };
}

export async function countPosts(options: ListPostsOptions = {}): Promise<number> {
  return prisma.blogPost.count({ where: postsWhere(options) });
}

/**
 * Runs one section's configured source.
 *
 * Every grid, carousel and sidebar list funnels through here, so "Latest",
 * "Popular", "Category", "Tag" and "Hand-picked" behave identically wherever
 * an administrator places them.
 */
export async function resolvePostSource(
  countryId: string,
  source: PostSource,
  context: { currentPostId?: string | null; currentCategoryId?: string | null } = {},
): Promise<BlogListItem[]> {
  const excludeIds = [...source.excludeIds];
  if (source.excludeCurrent && context.currentPostId) excludeIds.push(context.currentPostId);

  if (source.source === 'manual') {
    if (source.postIds.length === 0) return [];
    const rows = await prisma.blogPost.findMany({
      where: {
        ...publishedPostWhere(countryId),
        id: { in: source.postIds.filter((id) => !excludeIds.includes(id)) },
      },
      select: listSelect,
    });
    // Preserve the order the administrator arranged.
    const byId = new Map(rows.map((row) => [row.id, row]));
    return source.postIds
      .map((id) => byId.get(id))
      .filter((row): row is BlogListItem => Boolean(row))
      .slice(0, source.limit);
  }

  if (source.source === 'related') {
    return getRelatedPosts({
      countryId,
      postId: context.currentPostId ?? null,
      categoryId: context.currentCategoryId ?? null,
      limit: source.limit,
      excludeIds,
    });
  }

  const categoryIds =
    source.source === 'category' && source.categoryId
      ? source.includeChildCategories
        ? await categoryIdsWithChildren(source.categoryId)
        : [source.categoryId]
      : undefined;

  const { posts } = await listPosts({
    countryId,
    perPage: source.limit,
    categoryIds,
    tagId: source.source === 'tag' ? (source.tagId ?? undefined) : undefined,
    featuredOnly: source.source === 'featured',
    orderBy: source.source === 'popular' ? 'views' : source.orderBy,
    orderDir: source.orderDir,
    excludeIds,
  });
  return posts;
}

// ---------------------------------------------------------------------------
// Single post
// ---------------------------------------------------------------------------

const postInclude = {
  featuredImage: true,
  thumbnail: true,
  ogImage: { select: { url: true } },
  twitterImage: { select: { url: true } },
  category: {
    select: { id: true, name: true, slug: true, parent: { select: { id: true, name: true, slug: true } } },
  },
  author: {
    select: {
      id: true,
      name: true,
      image: true,
      jobTitle: true,
      bio: true,
      linkedinUrl: true,
      twitterUrl: true,
      websiteUrl: true,
    },
  },
  tags: { include: { tag: true } },
} satisfies Prisma.BlogPostInclude;

export type BlogPostDetail = Prisma.BlogPostGetPayload<{ include: typeof postInclude }>;

export const getPublishedPost = cache(
  async (countryId: string, slug: string): Promise<BlogPostDetail | null> => {
    return prisma.blogPost.findFirst({
      where: { ...publishedPostWhere(countryId), slug },
      include: postInclude,
    });
  },
);

/** A published article by the stable id the URL registry resolves to. */
export const getPublishedPostById = cache(
  async (countryId: string, id: string): Promise<BlogPostDetail | null> => {
    return prisma.blogPost.findFirst({
      where: { ...publishedPostWhere(countryId), id },
      include: postInclude,
    });
  },
);

/** Markets in which an article with this slug is published — for hreflang. */
export const findLivePostCountries = cache(async (slug: string): Promise<string[]> => {
  const rows = await prisma.blogPost.findMany({
    where: { ...publishedPostWhere(), slug },
    select: { countryId: true },
  });
  return rows.map((row) => row.countryId);
});

/** Any post by id, published or not — for the authenticated preview only. */
export const getPostForPreview = cache(async (id: string): Promise<BlogPostDetail | null> => {
  return prisma.blogPost.findFirst({ where: { id, deletedAt: null }, include: postInclude });
});

/**
 * Related posts, in the priority the CMS documents: hand-picked first, then
 * the same category, then shared tags, then recent articles.
 */
export async function getRelatedPosts(input: {
  countryId: string;
  postId: string | null;
  categoryId: string | null;
  limit?: number;
  excludeIds?: string[];
}): Promise<BlogListItem[]> {
  const limit = Math.min(Math.max(input.limit ?? 3, 1), 24);
  const results: BlogListItem[] = [];
  const seen = new Set<string>([...(input.excludeIds ?? [])]);
  if (input.postId) seen.add(input.postId);

  const push = (rows: BlogListItem[]) => {
    for (const row of rows) {
      if (results.length >= limit) return;
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      results.push(row);
    }
  };

  if (input.postId) {
    const explicit = await prisma.blogPostRelation.findMany({
      where: { sourceId: input.postId, target: publishedPostWhere(input.countryId) },
      orderBy: { sortOrder: 'asc' },
      take: limit,
      include: { target: { select: listSelect } },
    });
    push(explicit.map((row) => row.target));
  }

  if (results.length < limit && input.categoryId) {
    const sameCategory = await prisma.blogPost.findMany({
      where: {
        ...publishedPostWhere(input.countryId),
        categoryId: input.categoryId,
        id: { notIn: Array.from(seen) },
      },
      orderBy: [{ publishedAt: 'desc' }],
      take: limit - results.length,
      select: listSelect,
    });
    push(sameCategory);
  }

  if (results.length < limit && input.postId) {
    const tagIds = (
      await prisma.blogPostTag.findMany({ where: { postId: input.postId }, select: { tagId: true } })
    ).map((row) => row.tagId);

    if (tagIds.length > 0) {
      const sharedTags = await prisma.blogPost.findMany({
        where: {
          ...publishedPostWhere(input.countryId),
          id: { notIn: Array.from(seen) },
          tags: { some: { tagId: { in: tagIds } } },
        },
        orderBy: [{ publishedAt: 'desc' }],
        take: limit - results.length,
        select: listSelect,
      });
      push(sharedTags);
    }
  }

  if (results.length < limit) {
    const recent = await prisma.blogPost.findMany({
      where: { ...publishedPostWhere(input.countryId), id: { notIn: Array.from(seen) } },
      orderBy: [{ publishedAt: 'desc' }],
      take: limit - results.length,
      select: listSelect,
    });
    push(recent);
  }

  return results;
}

/** The articles either side of this one, by publish date. */
export async function getAdjacentPosts(input: {
  countryId: string;
  postId: string;
  publishedAt: Date | null;
  categoryId: string | null;
  sameCategory: boolean;
}): Promise<{ previous: BlogListItem | null; next: BlogListItem | null }> {
  const pivot = input.publishedAt ?? new Date();
  const scope: Prisma.BlogPostWhereInput = {
    ...publishedPostWhere(input.countryId),
    id: { not: input.postId },
    ...(input.sameCategory && input.categoryId ? { categoryId: input.categoryId } : {}),
  };

  const [previous, next] = await Promise.all([
    prisma.blogPost.findFirst({
      where: { ...scope, publishedAt: { lt: pivot } },
      orderBy: { publishedAt: 'desc' },
      select: listSelect,
    }),
    prisma.blogPost.findFirst({
      where: { ...scope, publishedAt: { gt: pivot } },
      orderBy: { publishedAt: 'asc' },
      select: listSelect,
    }),
  ]);

  return { previous, next };
}

// ---------------------------------------------------------------------------
// Taxonomy
// ---------------------------------------------------------------------------

export type BlogCategoryItem = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  parentId: string | null;
  sortOrder: number;
  count: number;
};

/**
 * Every active category with its published-article count.
 *
 * Counts include descendants so a parent chip is never shown as empty when its
 * subcategories carry the articles.
 */
export const getBlogCategories = cache(async (countryId: string): Promise<BlogCategoryItem[]> => {
  const rows = await prisma.blogCategory.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      parentId: true,
      sortOrder: true,
      // Counts are per market, so a category with only India articles does not
      // advertise itself on the UAE archive.
      _count: { select: { posts: { where: publishedPostWhere(countryId) } } },
    },
  });

  const direct = new Map(rows.map((row) => [row.id, row._count.posts]));
  const childrenOf = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.parentId) continue;
    childrenOf.set(row.parentId, [...(childrenOf.get(row.parentId) ?? []), row.id]);
  }

  const total = (id: string, depth = 0): number => {
    const own = direct.get(id) ?? 0;
    if (depth > 8) return own;
    return (childrenOf.get(id) ?? []).reduce((sum, child) => sum + total(child, depth + 1), own);
  };

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    parentId: row.parentId,
    sortOrder: row.sortOrder,
    count: total(row.id),
  }));
});

export type BlogTagItem = { id: string; name: string; slug: string; count: number };

export const getBlogTags = cache(async (countryId: string, limit = 40): Promise<BlogTagItem[]> => {
  const rows = await prisma.blogTag.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    take: Math.min(Math.max(limit, 1), 200),
    select: {
      id: true,
      name: true,
      slug: true,
      _count: { select: { posts: { where: { post: publishedPostWhere(countryId) } } } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    count: row._count.posts,
  }));
});

/**
 * Records a view for the "Popular posts" sources.
 *
 * Deliberately fire-and-forget and failure-tolerant: an analytics counter must
 * never be the reason an article fails to render.
 */
export async function recordPostView(postId: string): Promise<void> {
  try {
    await prisma.blogPost.update({
      where: { id: postId },
      data: { viewCount: { increment: 1 } },
    });
  } catch {
    // Ignored on purpose — see above.
  }
}

/**
 * Does the root blog actually have this slug?
 *
 * Used by the redirect that retires the market-prefixed blog URLs. A prefixed
 * URL for an article that never existed should 404 rather than bounce the
 * visitor to an archive they did not ask for, so the redirect only fires when
 * there is a real equivalent to send them to.
 */
export const blogSlugExists = cache(
  async (kind: 'post' | 'category' | 'tag', slug: string): Promise<boolean> => {
    if (!slug) return false;
    if (kind === 'post') {
      const post = await prisma.blogPost.findFirst({
        where: { slug, deletedAt: null },
        select: { id: true },
      });
      return Boolean(post);
    }
    if (kind === 'category') {
      const category = await prisma.blogCategory.findFirst({
        where: { slug },
        select: { id: true },
      });
      return Boolean(category);
    }
    const tag = await prisma.blogTag.findFirst({ where: { slug }, select: { id: true } });
    return Boolean(tag);
  },
);

'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { authorize } from '@/lib/auth/guards';
import { recordAudit } from '@/lib/services/audit';
import { canSetParent } from '@/lib/utils/tree';
import { blogPostSchema, blogCategorySchema } from '@/lib/validation/blog';
import { uniqueSlug, slugify } from '@/lib/utils/slug';
import { sectionCopy } from '@/lib/cms/section-copy';
import { sanitizeHtml, sanitizeText } from '@/lib/utils/sanitize';
import { keywordColumns, keywordsFromForm } from '@/lib/seo/keywords';
import { readingTimeMinutes, plainExcerpt } from '@/lib/utils/format';
import { success, failure, toActionError, type ActionResult } from '@/lib/utils/result';
import { resolveActionCountry } from '@/lib/country/admin';
import { assertCountryAccess } from '@/lib/country/access';
import { getCountryById, listActiveCountries } from '@/lib/country/registry';
import { revalidateCountryBlog, revalidateAllCountryBlogs } from '@/lib/country/revalidate';
import {
  captureBefore,
  describeTakenAddress,
  isAddressTaken,
  patternAddress,
  releaseRoutes,
  syncRoutes,
} from '@/lib/urls/content-sync';
import { revalidateAddresses } from '@/lib/urls/revalidate';
import { getDefaultCountry } from '@/lib/country/registry';
import { refreshSeoScores } from '@/lib/seo/intelligence/refresh';

/** Revalidates a market's blog surfaces. */
async function revalidatePost(countryId: string, slug?: string | null) {
  const country = await getCountryById(countryId);
  if (!country) return;
  revalidateCountryBlog(country, slug ?? null);
}

function readPostForm(formData: FormData) {
  const parseJson = <T>(key: string, fallback: T): T => {
    const raw = formData.get(key);
    if (typeof raw !== 'string' || !raw.trim()) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  };

  return blogPostSchema.parse({
    title: formData.get('title'),
    slug: formData.get('slug') || String(formData.get('title') ?? ''),
    subtitle: formData.get('subtitle'),
    status: formData.get('status') || 'DRAFT',
    publishedAt: formData.get('publishedAt') || null,
    excerpt: formData.get('excerpt'),
    content: formData.get('content') ?? '',
    isFeatured: formData.get('isFeatured') === 'true',
    featuredPriority: formData.get('featuredPriority') || 0,
    featuredImageId: formData.get('featuredImageId'),
    thumbnailId: formData.get('thumbnailId'),
    categoryId: formData.get('categoryId'),
    authorId: formData.get('authorId'),
    tags: parseJson<string[]>('tags', []),
    relatedIds: parseJson<string[]>('relatedIds', []),
    options: parseJson<Record<string, unknown>>('options', {}),
    sidebarMode: formData.get('sidebarMode') || 'GLOBAL',
    seoTitle: formData.get('seoTitle'),
    seoDescription: formData.get('seoDescription'),
    focusKeyword: formData.get('focusKeyword'),
    canonicalUrl: formData.get('canonicalUrl'),
    noIndex: formData.get('noIndex') === 'true',
    noFollow: formData.get('noFollow') === 'true',
    ogTitle: formData.get('ogTitle'),
    ogDescription: formData.get('ogDescription'),
    ogImageId: formData.get('ogImageId'),
    twitterImageId: formData.get('twitterImageId'),
    ...postKeywordsFromForm(formData),
  });
}

/**
 * The three keywords, from a form that may still send the old focus keyword.
 *
 * The editor sends primaryKeyword1–3. A caller written before they existed
 * sends focusKeyword only, and that keyword becomes the first primary one
 * rather than being dropped.
 */
function postKeywordsFromForm(formData: FormData) {
  const keywords = keywordsFromForm(formData);
  if (!formData.has('primaryKeyword1') && formData.has('focusKeyword')) {
    keywords.primaryKeyword1 = String(formData.get('focusKeyword') ?? '');
  }
  return keywords;
}

/** Resolves tag names to ids, creating any that do not exist yet. */
async function resolveTagIds(names: string[]): Promise<string[]> {
  const cleaned = Array.from(
    new Set(names.map((name) => sanitizeText(name).trim()).filter(Boolean)),
  ).slice(0, 20);
  const ids: string[] = [];

  const created: string[] = [];
  for (const name of cleaned) {
    const slug = slugify(name);
    if (!slug) continue;
    const existing = await prisma.blogTag.findUnique({ where: { slug }, select: { id: true } });
    if (existing) {
      ids.push(existing.id);
      continue;
    }
    const tag = await prisma.blogTag.upsert({
      where: { slug },
      update: {},
      create: { name, slug },
    });
    ids.push(tag.id);
    created.push(tag.id);
  }

  // A tag typed into an article gets its archive's address like any other.
  // Best effort: a tag whose address is taken is still a tag, and the Slug &
  // URL Manager lists it under Conflicts until someone gives it one.
  if (created.length > 0) {
    const root = await getDefaultCountry();
    try {
      await prisma.$transaction((tx) =>
        syncRoutes(
          tx,
          created.map((entityId) => ({ type: 'BLOG_TAG' as const, entityId, countryId: root.id })),
          { actor: null, reason: 'CREATE' },
        ),
      );
    } catch (error) {
      console.error('[blog] tag address not registered', error instanceof Error ? error.message : error);
    }
  }
  return ids;
}

export async function createBlogPost(formData: FormData): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await authorize('blog.create');
    const input = readPostForm(formData);
    if (input.status === 'PUBLISHED') await authorize('blog.publish');

    // The market comes from the admin's current selection unless the form names
    // one, and is validated against the user's market access either way.
    const country = await resolveActionCountry(user, formData.get('countryId')?.toString() || null);

    // Article slugs are unique per market, so the same guide can exist in both.
    // The blog is root-only, so a root-market article's address must also be
    // free of every other kind of content.
    const root = await getDefaultCountry();
    const address = (candidate: string) =>
      patternAddress(prisma, { type: 'BLOG_POST', countryId: root.id, marketSlug: root.slug, slug: candidate });
    const taken = async (candidate: string) => {
      const existing = await prisma.blogPost.findUnique({
        where: { countryId_slug: { countryId: country.id, slug: candidate } },
        select: { id: true },
      });
      if (existing) return true;
      return country.id === root.id && (await isAddressTaken(prisma, await address(candidate)));
    };
    const typed = String(formData.get('slug') ?? '').trim() !== '';
    if (typed && input.slug && (await taken(input.slug))) {
      const why =
        (country.id === root.id ? await describeTakenAddress(prisma, await address(input.slug)) : null) ??
        'Another post already uses that URL.';
      return failure(why, { slug: [why] });
    }
    const slug = await uniqueSlug(input.slug || slugify(input.title), taken);

    const content = sanitizeHtml(input.content);
    const tagIds = await resolveTagIds(input.tags);

    const post = await prisma.$transaction(async (tx) => {
      const created = await tx.blogPost.create({
        data: {
          countryId: country.id,
          title: sanitizeText(input.title),
          slug,
          status: input.status,
          publishedAt:
            input.status === 'PUBLISHED' ? (input.publishedAt ?? new Date()) : input.publishedAt,
          subtitle: input.subtitle ? sanitizeText(input.subtitle) : null,
          excerpt: input.excerpt ? sanitizeText(input.excerpt) : plainExcerpt(content, 200) || null,
          content,
          readingTime: readingTimeMinutes(content),
          isFeatured: input.isFeatured,
          featuredPriority: input.featuredPriority,
          featuredImageId: input.featuredImageId,
          thumbnailId: input.thumbnailId,
          categoryId: input.categoryId,
          authorId: input.authorId ?? user.id,
          options: input.options as unknown as object,
          sidebarMode: input.sidebarMode,
          seoTitle: input.seoTitle,
          seoDescription: input.seoDescription,
          // Kept equal to the first primary keyword, which replaced it.
          focusKeyword: input.primaryKeyword1,
          ...keywordColumns(input),
          canonicalUrl: input.canonicalUrl,
          noIndex: input.noIndex,
          noFollow: input.noFollow,
          ogTitle: input.ogTitle,
          ogDescription: input.ogDescription,
          ogImageId: input.ogImageId,
          twitterImageId: input.twitterImageId,
          tags: { create: tagIds.map((tagId) => ({ tagId })) },
          relatedTo: {
            create: input.relatedIds.map((targetId, index) => ({ targetId, sortOrder: index * 10 })),
          },
        },
      });
      await syncRoutes(tx, [{ type: 'BLOG_POST', entityId: created.id, countryId: country.id }], {
        actor: user,
        reason: 'CREATE',
      });
      return created;
    });

    await recordAudit({
      actor: user,
      action: 'created',
      entity: 'BlogPost',
      entityId: post.id,
      summary: `Created post “${post.title}”`,
    });

    revalidatePath('/admin/blog');
    await revalidatePost(post.countryId, slug);
    refreshSeoScores([{ type: 'BLOG_POST', id: post.id, countryId: post.countryId }]);
    return success({ id: post.id }, 'Post created.');
  } catch (error) {
    return toActionError(error);
  }
}

export async function updateBlogPost(postId: string, formData: FormData): Promise<ActionResult> {
  try {
    const user = await authorize('blog.edit');
    const before = await prisma.blogPost.findUnique({ where: { id: postId } });
    if (!before || before.deletedAt) return failure('That post no longer exists.');

    const input = readPostForm(formData);
    if (input.status === 'PUBLISHED' && before.status !== 'PUBLISHED')
      await authorize('blog.publish');

    // The address follows the slug field, never the title: a blank slug keeps
    // the article where it is.
    const typedSlug = String(formData.get('slug') ?? '').trim();
    const slug = typedSlug ? input.slug || before.slug : before.slug;
    if (slug !== before.slug) {
      const clash = await prisma.blogPost.findFirst({
        where: { slug, countryId: before.countryId, id: { not: postId } },
        select: { id: true },
      });
      if (clash)
        return failure('Another post already uses that URL.', { slug: ['This URL is taken'] });
    }

    const content = sanitizeHtml(input.content);
    const tagIds = await resolveTagIds(input.tags);
    // Related posts must not include the post itself.
    const relatedIds = input.relatedIds.filter((id) => id !== postId);

    const ref = { type: 'BLOG_POST' as const, entityId: postId, countryId: before.countryId };
    const [updated, moves] = await prisma.$transaction(async (tx) => {
      const snapshot = await captureBefore(tx, [ref]);
      await tx.blogPostTag.deleteMany({ where: { postId } });
      await tx.blogPostRelation.deleteMany({ where: { sourceId: postId } });

      const saved = await tx.blogPost.update({
        where: { id: postId },
        data: {
          title: sanitizeText(input.title),
          slug,
          status: input.status,
          publishedAt:
            input.status === 'PUBLISHED'
              ? (input.publishedAt ?? before.publishedAt ?? new Date())
              : input.publishedAt,
          subtitle: input.subtitle ? sanitizeText(input.subtitle) : null,
          excerpt: input.excerpt ? sanitizeText(input.excerpt) : plainExcerpt(content, 200) || null,
          content,
          readingTime: readingTimeMinutes(content),
          isFeatured: input.isFeatured,
          featuredPriority: input.featuredPriority,
          featuredImageId: input.featuredImageId,
          thumbnailId: input.thumbnailId,
          categoryId: input.categoryId,
          authorId: input.authorId,
          options: input.options as unknown as object,
          sidebarMode: input.sidebarMode,
          seoTitle: input.seoTitle,
          seoDescription: input.seoDescription,
          // Kept equal to the first primary keyword, which replaced it.
          focusKeyword: input.primaryKeyword1,
          ...keywordColumns(input),
          canonicalUrl: input.canonicalUrl,
          noIndex: input.noIndex,
          noFollow: input.noFollow,
          ogTitle: input.ogTitle,
          ogDescription: input.ogDescription,
          ogImageId: input.ogImageId,
          twitterImageId: input.twitterImageId,
          tags: { create: tagIds.map((tagId) => ({ tagId })) },
          relatedTo: {
            create: relatedIds.map((targetId, index) => ({ targetId, sortOrder: index * 10 })),
          },
        },
      });
      // The article's address, the redirect from its old one (when it had
      // been public) and the history row, with the save or not at all.
      const outcome = await syncRoutes(tx, [ref], {
        actor: user,
        reason: slug !== before.slug ? 'SLUG' : 'EDIT',
        before: snapshot,
      });
      return [saved, outcome] as const;
    });

    await recordAudit({
      actor: user,
      action: 'updated',
      entity: 'BlogPost',
      entityId: postId,
      summary: `Updated post “${updated.title}”`,
      before: { status: before.status, slug: before.slug },
      after: { status: updated.status, slug: updated.slug },
    });

    revalidatePath('/admin/blog');
    revalidatePath(`/admin/blog/${postId}`);
    await revalidatePost(before.countryId, before.slug);
    if (slug !== before.slug) await revalidatePost(before.countryId, slug);
    revalidateAddresses(moves.flatMap((move) => [move.oldPath, move.newPath]));
    refreshSeoScores([{ type: 'BLOG_POST', id: postId, countryId: before.countryId }]);
    const moved = moves.find((move) => move.status === 'moved' && move.redirectId);
    return success(
      undefined,
      moved ? `Post saved. ${moved.oldPath} now redirects to ${moved.newPath}.` : 'Post saved.',
    );
  } catch (error) {
    return toActionError(error);
  }
}

export async function setBlogPostStatus(
  postId: string,
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED',
): Promise<ActionResult> {
  try {
    const user =
      status === 'PUBLISHED' ? await authorize('blog.publish') : await authorize('blog.edit');
    const post = await prisma.blogPost.findUnique({ where: { id: postId } });
    if (!post) return failure('That post no longer exists.');

    await prisma.blogPost.update({
      where: { id: postId },
      data: {
        status,
        publishedAt: status === 'PUBLISHED' ? (post.publishedAt ?? new Date()) : post.publishedAt,
      },
    });

    await recordAudit({
      actor: user,
      action: status.toLowerCase(),
      entity: 'BlogPost',
      entityId: postId,
      summary: `Set “${post.title}” to ${status.toLowerCase()}`,
    });

    revalidatePath('/admin/blog');
    await revalidatePost(post.countryId, post.slug);
    refreshSeoScores([{ type: 'BLOG_POST', id: postId, countryId: post.countryId }]);
    return success(undefined, `Post ${status.toLowerCase()}.`);
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * Copies an article into another market.
 *
 * The copy keeps the source's slug, so `/blog/x` and `/ae/blog/x` are the same
 * article told for two audiences and hreflang can pair them. It is always a
 * DRAFT and never featured: a duplicated article must be reviewed and localised
 * before it can appear in search results next to the original.
 *
 * An article already at that URL in the target market is never overwritten
 * silently — the action refuses and says so, and replaces it only when the
 * caller comes back having confirmed it.
 */
export async function duplicateBlogPostToCountry(
  postId: string,
  targetCountryId: string,
  options: { replaceExisting?: boolean } = {},
): Promise<ActionResult<{ id: string; replaced: boolean }>> {
  try {
    const user = await authorize('blog.create');

    const source = await prisma.blogPost.findUnique({
      where: { id: postId },
      include: { tags: true, sections: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!source || source.deletedAt) return failure('That post no longer exists.');
    await assertCountryAccess(user, source.countryId);

    const target = await resolveActionCountry(user, targetCountryId);
    if (target.id === source.countryId) {
      return failure('That article already belongs to this country.');
    }

    const existing = await prisma.blogPost.findUnique({
      where: { countryId_slug: { countryId: target.id, slug: source.slug } },
      select: { id: true, title: true, deletedAt: true },
    });

    if (existing && !existing.deletedAt && !options.replaceExisting) {
      return failure(
        `${target.name} already has an article at /blog/${source.slug} (“${existing.title}”). Confirm to replace it.`,
        { _confirm: ['exists'] },
      );
    }

    const shared = {
      title: source.title,
      subtitle: source.subtitle,
      status: 'DRAFT' as const,
      publishedAt: null,
      excerpt: source.excerpt,
      content: source.content,
      readingTime: source.readingTime,
      isFeatured: false,
      featuredPriority: source.featuredPriority,
      featuredImageId: source.featuredImageId,
      thumbnailId: source.thumbnailId,
      categoryId: source.categoryId,
      authorId: user.id,
      options: source.options as object,
      sidebarMode: source.sidebarMode,
      seoTitle: source.seoTitle,
      seoDescription: source.seoDescription,
      focusKeyword: source.focusKeyword,
      ...keywordColumns(source),
      // Not copied on purpose: a market canonicals to its own URL.
      canonicalUrl: null,
      noIndex: source.noIndex,
      noFollow: source.noFollow,
      ogTitle: source.ogTitle,
      ogDescription: source.ogDescription,
      ogImageId: source.ogImageId,
      twitterImageId: source.twitterImageId,
    };

    const sectionData = source.sections.map((section) => ({
      ...sectionCopy(section),
      surface: section.surface,
    }));

    const copy = await prisma.$transaction(async (tx) => {
      let saved;
      if (existing) {
        await tx.blogPostTag.deleteMany({ where: { postId: existing.id } });
        await tx.blogSection.deleteMany({ where: { postId: existing.id } });
        saved = await tx.blogPost.update({
          where: { id: existing.id },
          data: {
            ...shared,
            slug: source.slug,
            deletedAt: null,
            tags: { create: source.tags.map((tag) => ({ tagId: tag.tagId })) },
            sections: { create: sectionData },
          },
        });
      } else {
        saved = await tx.blogPost.create({
          data: {
            ...shared,
            countryId: target.id,
            slug: source.slug,
            tags: { create: source.tags.map((tag) => ({ tagId: tag.tagId })) },
            sections: { create: sectionData },
          },
        });
      }
      // Only the root market's articles have addresses; for any other market
      // this registers nothing.
      await syncRoutes(tx, [{ type: 'BLOG_POST', entityId: saved.id, countryId: target.id }], {
        actor: user,
        reason: existing ? 'EDIT' : 'CREATE',
      });
      return saved;
    });

    await recordAudit({
      actor: user,
      action: existing ? 'duplicated.replaced' : 'duplicated.country',
      entity: 'BlogPost',
      entityId: copy.id,
      summary: `Copied “${source.title}” to ${target.name} as a draft`,
      after: { slug: copy.slug, country: target.code, status: copy.status },
    });

    revalidatePath('/admin/blog');
    await revalidatePost(target.id, copy.slug);
    return success(
      { id: copy.id, replaced: Boolean(existing) },
      `Copied to ${target.name} as a draft.`,
    );
  } catch (error) {
    return toActionError(error);
  }
}

export async function duplicateBlogPost(postId: string): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await authorize('blog.create');
    const source = await prisma.blogPost.findUnique({
      where: { id: postId },
      include: { tags: true, sections: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!source) return failure('That post no longer exists.');
    await assertCountryAccess(user, source.countryId);

    const root = await getDefaultCountry();
    const slug = await uniqueSlug(`${source.slug}-copy`, async (candidate) => {
      const existing = await prisma.blogPost.findUnique({
        where: { countryId_slug: { countryId: source.countryId, slug: candidate } },
        select: { id: true },
      });
      if (existing) return true;
      if (source.countryId !== root.id) return false;
      const address = await patternAddress(prisma, {
        type: 'BLOG_POST',
        countryId: root.id,
        marketSlug: root.slug,
        slug: candidate,
      });
      return isAddressTaken(prisma, address);
    });

    const copy = await prisma.$transaction(async (tx) => {
      const created = await tx.blogPost.create({
        data: {
          countryId: source.countryId,
          title: `${source.title} (copy)`,
          slug,
          status: 'DRAFT',
          subtitle: source.subtitle,
          excerpt: source.excerpt,
          content: source.content,
          readingTime: source.readingTime,
          // A copy is never featured: two articles sharing the featured slot is
          // never what duplicating was for.
          isFeatured: false,
          featuredPriority: source.featuredPriority,
          featuredImageId: source.featuredImageId,
          thumbnailId: source.thumbnailId,
          categoryId: source.categoryId,
          authorId: user.id,
          options: source.options as object,
          sidebarMode: source.sidebarMode,
          seoTitle: source.seoTitle,
          seoDescription: source.seoDescription,
          focusKeyword: source.focusKeyword,
          ...keywordColumns(source),
          noIndex: source.noIndex,
          noFollow: source.noFollow,
          ogTitle: source.ogTitle,
          ogDescription: source.ogDescription,
          ogImageId: source.ogImageId,
          twitterImageId: source.twitterImageId,
          tags: { create: source.tags.map((t) => ({ tagId: t.tagId })) },
          // A post that overrides its own sidebar keeps that override; a post
          // that uses the blog-wide set has no rows and goes on using it.
          sections: {
            create: source.sections.map((section) => ({
              ...sectionCopy(section),
              surface: section.surface,
            })),
          },
        },
      });
      await syncRoutes(tx, [{ type: 'BLOG_POST', entityId: created.id, countryId: source.countryId }], {
        actor: user,
        reason: 'CREATE',
      });
      return created;
    });

    await recordAudit({
      actor: user,
      action: 'duplicated',
      entity: 'BlogPost',
      entityId: copy.id,
      summary: `Duplicated post “${source.title}”`,
    });

    revalidatePath('/admin/blog');
    return success({ id: copy.id }, 'Post duplicated.');
  } catch (error) {
    return toActionError(error);
  }
}

export async function deleteBlogPost(postId: string): Promise<ActionResult> {
  try {
    const user = await authorize('blog.delete');
    const post = await prisma.blogPost.findUnique({ where: { id: postId } });
    if (!post) return failure('That post no longer exists.');

    // The address is released, never redirected by default; see deletePage.
    await prisma.$transaction(async (tx) => {
      await tx.blogPost.update({
        where: { id: postId },
        data: {
          deletedAt: new Date(),
          status: 'ARCHIVED',
          slug: `${post.slug}-deleted-${Date.now()}`,
          isFeatured: false,
        },
      });
      await releaseRoutes(
        tx,
        [{ type: 'BLOG_POST', entityId: postId, countryId: post.countryId, label: post.title }],
        { actor: user },
      );
    });

    await recordAudit({
      actor: user,
      action: 'deleted',
      entity: 'BlogPost',
      entityId: postId,
      summary: `Deleted post “${post.title}”`,
    });

    revalidatePath('/admin/blog');
    await revalidatePost(post.countryId, post.slug);
    return success(undefined, 'Post deleted.');
  } catch (error) {
    return toActionError(error);
  }
}

export async function saveBlogCategory(
  categoryId: string | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await authorize('blog.edit');
    const input = blogCategorySchema.parse({
      name: formData.get('name'),
      slug: formData.get('slug') || String(formData.get('name') ?? ''),
      description: formData.get('description'),
      parentId: formData.get('parentId'),
      sortOrder: formData.get('sortOrder') || 0,
      isActive: formData.get('isActive') !== 'false',
      imageId: formData.get('imageId'),
      bannerImageId: formData.get('bannerImageId'),
      archiveTitle: formData.get('archiveTitle'),
      archiveDescription: formData.get('archiveDescription'),
      seoTitle: formData.get('seoTitle'),
      seoDescription: formData.get('seoDescription'),
      canonicalUrl: formData.get('canonicalUrl'),
      ogTitle: formData.get('ogTitle'),
      ogDescription: formData.get('ogDescription'),
      ogImageId: formData.get('ogImageId'),
      noIndex: formData.get('noIndex') === 'true',
      noFollow: formData.get('noFollow') === 'true',
      ...keywordsFromForm(formData),
    });

    // A category may not sit inside itself or inside one of its own children;
    // a cycle would make the tree and breadcrumb reads loop forever.
    const parentCheck = canSetParent(
      await prisma.blogCategory.findMany({ select: { id: true, parentId: true } }),
      categoryId,
      input.parentId,
      {
        self: 'A category cannot be its own parent.',
        cycle: 'That would place a category inside one of its own subcategories.',
        missing: 'That parent category no longer exists.',
      },
    );
    if (!parentCheck.ok) return failure(parentCheck.error);

    // On edit the address follows the slug field, never the name: a blank slug
    // keeps the category where it is.
    const existingCategory = categoryId
      ? await prisma.blogCategory.findUnique({ where: { id: categoryId }, select: { slug: true } })
      : null;
    if (categoryId && !existingCategory) return failure('That category no longer exists.');
    const typedSlug = String(formData.get('slug') ?? '').trim();
    const slug =
      categoryId === null
        ? await uniqueSlug(input.slug || slugify(input.name), async (candidate) => {
            const existing = await prisma.blogCategory.findUnique({
              where: { slug: candidate },
              select: { id: true },
            });
            return Boolean(existing);
          })
        : typedSlug
          ? input.slug
          : existingCategory!.slug;

    const data = {
      name: sanitizeText(input.name),
      slug,
      description: input.description ? sanitizeText(input.description) : null,
      parentId: input.parentId,
      sortOrder: input.sortOrder,
      isActive: input.isActive,
      imageId: input.imageId,
      bannerImageId: input.bannerImageId,
      archiveTitle: input.archiveTitle,
      archiveDescription: input.archiveDescription,
      seoTitle: input.seoTitle,
      seoDescription: input.seoDescription,
      canonicalUrl: input.canonicalUrl,
      ogTitle: input.ogTitle,
      ogDescription: input.ogDescription,
      ogImageId: input.ogImageId,
      noIndex: input.noIndex,
      noFollow: input.noFollow,
      ...keywordColumns(input),
    };

    // The category, its archive's address and the redirect from its old one
    // are saved together; a taken address fails the whole save.
    const category = await prisma.$transaction(async (tx) => {
      const root = await getDefaultCountry();
      if (!categoryId) {
        const created = await tx.blogCategory.create({ data });
        await syncRoutes(tx, [{ type: 'BLOG_CATEGORY', entityId: created.id, countryId: root.id }], {
          actor: user,
          reason: 'CREATE',
        });
        return created;
      }
      const ref = { type: 'BLOG_CATEGORY' as const, entityId: categoryId, countryId: root.id };
      const snapshot = await captureBefore(tx, [ref]);
      const saved = await tx.blogCategory.update({ where: { id: categoryId }, data });
      await syncRoutes(tx, [ref], {
        actor: user,
        reason: slug !== existingCategory?.slug ? 'SLUG' : 'EDIT',
        before: snapshot,
      });
      return saved;
    });

    await recordAudit({
      actor: user,
      action: categoryId ? 'updated' : 'created',
      entity: 'BlogCategory',
      entityId: category.id,
      summary: `${categoryId ? 'Updated' : 'Created'} category “${category.name}”`,
    });

    revalidatePath('/admin/blog/categories');
    // Categories are shared by every market, so every blog is affected.
    await revalidateAllCountryBlogs();
    refreshSeoScores([{ type: 'BLOG_CATEGORY', id: category.id }]);
    return success({ id: category.id }, 'Category saved.');
  } catch (error) {
    return toActionError(error);
  }
}

export async function deleteBlogCategory(categoryId: string): Promise<ActionResult> {
  try {
    const user = await authorize('blog.delete');
    const category = await prisma.blogCategory.findUnique({
      where: { id: categoryId },
      include: { _count: { select: { posts: true, children: true } } },
    });
    if (!category) return failure('That category no longer exists.');

    const root = await getDefaultCountry();
    await prisma.$transaction(async (tx) => {
      // Subcategories rise to the deleted category's own parent rather than
      // being orphaned at the root — the hierarchy stays meaningful.
      await tx.blogCategory.updateMany({
        where: { parentId: categoryId },
        data: { parentId: category.parentId },
      });
      await tx.blogCategory.delete({ where: { id: categoryId } });
      // Its archive's address is released; its history is kept.
      await releaseRoutes(
        tx,
        [{ type: 'BLOG_CATEGORY', entityId: categoryId, countryId: root.id, label: category.name }],
        { actor: user },
      );
    });

    await recordAudit({
      actor: user,
      action: 'deleted',
      entity: 'BlogCategory',
      entityId: categoryId,
      summary:
        `Deleted category “${category.name}” — ${category._count.posts} post(s) uncategorised, ` +
        `${category._count.children} subcategory(ies) promoted`,
    });

    revalidatePath('/admin/blog/categories');
    // Categories are shared by every market, so every blog is affected.
    await revalidateAllCountryBlogs();
    return success(
      undefined,
      category._count.posts > 0
        ? `Category deleted. ${category._count.posts} post(s) are now uncategorised.`
        : 'Category deleted.',
    );
  } catch (error) {
    return toActionError(error);
  }
}

const bulkSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(100),
  action: z.enum(['publish', 'draft', 'archive', 'delete']),
});

export async function bulkBlogAction(input: unknown): Promise<ActionResult> {
  try {
    const { ids, action } = bulkSchema.parse(input);
    const user =
      action === 'delete'
        ? await authorize('blog.delete')
        : action === 'publish'
          ? await authorize('blog.publish')
          : await authorize('blog.edit');

    const posts = await prisma.blogPost.findMany({ where: { id: { in: ids }, deletedAt: null } });

    if (action === 'delete') {
      await prisma.$transaction(async (tx) => {
        for (const post of posts) {
          await tx.blogPost.update({
            where: { id: post.id },
            data: {
              deletedAt: new Date(),
              status: 'ARCHIVED',
              slug: `${post.slug}-deleted-${Date.now()}`,
              isFeatured: false,
            },
          });
        }
        await releaseRoutes(
          tx,
          posts.map((post) => ({ type: 'BLOG_POST' as const, entityId: post.id, countryId: post.countryId, label: post.title })),
          { actor: user },
        );
      });
    } else {
      const status = action === 'publish' ? 'PUBLISHED' : action === 'draft' ? 'DRAFT' : 'ARCHIVED';
      await prisma.blogPost.updateMany({
        where: { id: { in: posts.map((p) => p.id) } },
        data: { status, ...(status === 'PUBLISHED' ? { publishedAt: new Date() } : {}) },
      });
    }

    await recordAudit({
      actor: user,
      action: `bulk.${action}`,
      entity: 'BlogPost',
      summary: `${action} applied to ${posts.length} post(s)`,
    });

    revalidatePath('/admin/blog');
    for (const countryId of new Set(posts.map((post) => post.countryId))) {
      await revalidatePost(countryId);
    }
    refreshSeoScores(posts.slice(0, 50).map((post) => ({ type: 'BLOG_POST' as const, id: post.id, countryId: post.countryId })));
    return success(undefined, `${posts.length} post(s) updated.`);
  } catch (error) {
    return toActionError(error);
  }
}

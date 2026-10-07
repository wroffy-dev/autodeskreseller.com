'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { authorize } from '@/lib/auth/guards';
import { recordAudit } from '@/lib/services/audit';
import { pageInputSchema, sectionOrderSchema } from '@/lib/validation/page';
import { blockDefaults, getBlock } from '@/lib/cms/blocks';
import { parseSectionDesign, DEFAULT_SECTION_DESIGN } from '@/lib/cms/design';
import { uniqueSlug, pageSlug } from '@/lib/utils/slug';
import { sectionCopies } from '@/lib/cms/section-copy';
import { success, failure, toActionError, type ActionResult } from '@/lib/utils/result';
import { sanitizeText } from '@/lib/utils/sanitize';
import { keywordColumns, keywordsFromForm } from '@/lib/seo/keywords';
import { resolveActionCountry } from '@/lib/country/admin';
import { assertCountryAccess } from '@/lib/country/access';
import { getCountryById } from '@/lib/country/registry';
import { revalidateCountryPage } from '@/lib/country/revalidate';
import type { CountryContext } from '@/lib/country/types';
import { refreshSeoScores } from '@/lib/seo/intelligence/refresh';
import {
  captureBefore,
  describeTakenAddress,
  isAddressTaken,
  releaseRoutes,
  syncRoutes,
} from '@/lib/urls/content-sync';
import { joinMarket } from '@/lib/urls/path';
import { revalidateAddresses } from '@/lib/urls/revalidate';

/** Revalidates the public surfaces a page change can affect, in its market. */
async function revalidatePage(countryId: string, slug: string) {
  const country = await getCountryById(countryId);
  if (!country) return;
  revalidateCountryPage(country, slug);
}

/**
 * Guards a page a Server Action is about to touch.
 *
 * Authorisation is two-sided: the role has to permit the operation, and the
 * user has to have access to the market the record belongs to. Both are checked
 * against the record loaded from the database, never against an id in the
 * request body, so a page id alone cannot reach a market the user cannot edit.
 */
async function assertPageAccess(
  user: Awaited<ReturnType<typeof authorize>>,
  countryId: string,
): Promise<void> {
  await assertCountryAccess(user, countryId);
}

export async function createPage(formData: FormData): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await authorize('pages.create');

    const parsed = pageInputSchema.parse({
      title: formData.get('title'),
      slug: formData.get('slug') || String(formData.get('title') ?? ''),
      status: formData.get('status') || 'DRAFT',
      categoryId: formData.get('categoryId'),
      publishedAt: formData.get('publishedAt') || null,
      isHomepage: formData.get('isHomepage') === 'true',
      showHeader: formData.get('showHeader') !== 'false',
      showFooter: formData.get('showFooter') !== 'false',
      seoTitle: formData.get('seoTitle'),
      seoDescription: formData.get('seoDescription'),
      canonicalUrl: formData.get('canonicalUrl'),
      noIndex: formData.get('noIndex') === 'true',
      noFollow: formData.get('noFollow') === 'true',
      ogTitle: formData.get('ogTitle'),
      ogDescription: formData.get('ogDescription'),
      ogImageId: formData.get('ogImageId'),
      twitterTitle: formData.get('twitterTitle'),
      twitterDescription: formData.get('twitterDescription'),
      twitterImageId: formData.get('twitterImageId'),
      ...keywordsFromForm(formData),
    });

    if (parsed.status === 'PUBLISHED') await authorize('pages.publish');

    // The market comes from the admin's current selection unless the form names
    // one, and either way it is validated against the user's market access.
    const country = await resolveActionCountry(user, formData.get('countryId')?.toString() || null);

    // Slugs are unique per market, so the UAE can own "dropbox-business" while
    // India already does — and an address is unique across every kind of
    // content, so a page cannot take a product's URL either.
    const taken = async (candidate: string) => {
      const existing = await prisma.page.findUnique({
        where: { countryId_slug: { countryId: country.id, slug: candidate } },
        select: { id: true },
      });
      return Boolean(existing) || (await isAddressTaken(prisma, joinMarket(country.slug, candidate)));
    };
    // A slug the editor typed is theirs: if it is taken, say so rather than
    // quietly publishing the page somewhere else. One made from the title can
    // simply be made unique.
    const typed = String(formData.get('slug') ?? '').trim() !== '';
    if (typed && parsed.slug && (await taken(parsed.slug))) {
      const why =
        (await describeTakenAddress(prisma, joinMarket(country.slug, parsed.slug))) ??
        'Another page already uses that URL.';
      return failure(why, { slug: [why] });
    }
    const slug = await uniqueSlug(parsed.slug || pageSlug(parsed.title), taken);

    const page = await prisma.$transaction(async (tx) => {
      if (parsed.isHomepage) {
        // Each market has exactly one homepage; another market's is untouched.
        await tx.page.updateMany({
          where: { isHomepage: true, countryId: country.id },
          data: { isHomepage: false },
        });
      }
      const created = await tx.page.create({
        data: {
          ...parsed,
          countryId: country.id,
          slug,
          title: sanitizeText(parsed.title),
          publishedAt:
            parsed.status === 'PUBLISHED' ? (parsed.publishedAt ?? new Date()) : parsed.publishedAt,
          createdById: user.id,
          updatedById: user.id,
        },
      });
      // A new page is its own group until it is copied to another market.
      await tx.page.update({ where: { id: created.id }, data: { groupKey: created.id } });
      await syncRoutes(tx, [{ type: 'PAGE', entityId: created.id, countryId: country.id }], {
        actor: user,
        reason: 'CREATE',
      });
      return created;
    });

    await recordAudit({
      actor: user,
      action: 'created',
      entity: 'Page',
      entityId: page.id,
      summary: `Created page “${page.title}” (${country.code})`,
      after: { title: page.title, slug: page.slug, status: page.status, country: country.code },
    });

    revalidatePath('/admin/pages');
    await revalidatePage(page.countryId, slug);
    refreshSeoScores([{ type: 'PAGE', id: page.id, countryId: page.countryId }]);
    return success({ id: page.id }, 'Page created.');
  } catch (error) {
    return toActionError(error);
  }
}

export async function updatePage(pageId: string, formData: FormData): Promise<ActionResult> {
  try {
    const user = await authorize('pages.edit');

    const before = await prisma.page.findUnique({ where: { id: pageId } });
    if (!before || before.deletedAt) return failure('That page no longer exists.');
    await assertPageAccess(user, before.countryId);

    const parsed = pageInputSchema.parse({
      title: formData.get('title'),
      slug: formData.get('slug'),
      status: formData.get('status') || before.status,
      categoryId: formData.get('categoryId'),
      publishedAt: formData.get('publishedAt') || null,
      isHomepage: formData.get('isHomepage') === 'true',
      showHeader: formData.get('showHeader') !== 'false',
      showFooter: formData.get('showFooter') !== 'false',
      seoTitle: formData.get('seoTitle'),
      seoDescription: formData.get('seoDescription'),
      canonicalUrl: formData.get('canonicalUrl'),
      noIndex: formData.get('noIndex') === 'true',
      noFollow: formData.get('noFollow') === 'true',
      ogTitle: formData.get('ogTitle'),
      ogDescription: formData.get('ogDescription'),
      ogImageId: formData.get('ogImageId'),
      twitterTitle: formData.get('twitterTitle'),
      twitterDescription: formData.get('twitterDescription'),
      twitterImageId: formData.get('twitterImageId'),
      ...keywordsFromForm(formData),
    });

    if (parsed.status === 'PUBLISHED' && before.status !== 'PUBLISHED') {
      await authorize('pages.publish');
    }

    // The homepage must keep an addressable slug of "".
    const slug = before.isHomepage && parsed.isHomepage ? before.slug : parsed.slug;

    if (slug !== before.slug) {
      const clash = await prisma.page.findFirst({
        where: { slug, countryId: before.countryId, id: { not: pageId } },
        select: { id: true },
      });
      if (clash)
        return failure('Another page already uses that URL.', { slug: ['This URL is taken'] });
    }

    /*
     * The page, its address, the redirect from the address it leaves (when it
     * had been public) and the URL history are saved together. If the new
     * address belongs to anything else, none of it is.
     */
    const ref = { type: 'PAGE' as const, entityId: pageId, countryId: before.countryId };
    const [updated, moves] = await prisma.$transaction(async (tx) => {
      const snapshot = await captureBefore(tx, [ref]);
      if (parsed.isHomepage && !before.isHomepage) {
        await tx.page.updateMany({
          where: { isHomepage: true, countryId: before.countryId },
          data: { isHomepage: false },
        });
      }
      const saved = await tx.page.update({
        where: { id: pageId },
        data: {
          ...parsed,
          slug,
          title: sanitizeText(parsed.title),
          publishedAt:
            parsed.status === 'PUBLISHED'
              ? (parsed.publishedAt ?? before.publishedAt ?? new Date())
              : parsed.publishedAt,
          updatedById: user.id,
        },
      });
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
      entity: 'Page',
      entityId: pageId,
      summary: `Updated page “${updated.title}”`,
      before: { title: before.title, slug: before.slug, status: before.status },
      after: { title: updated.title, slug: updated.slug, status: updated.status },
    });

    revalidatePath('/admin/pages');
    revalidatePath(`/admin/pages/${pageId}`);
    await revalidatePage(before.countryId, before.slug);
    if (slug !== before.slug) await revalidatePage(before.countryId, slug);
    revalidateAddresses(moves.flatMap((move) => [move.oldPath, move.newPath]));
    refreshSeoScores([{ type: 'PAGE', id: pageId, countryId: before.countryId }]);
    const moved = moves.find((move) => move.status === 'moved' && move.redirectId);
    return success(
      undefined,
      moved ? `Page saved. ${moved.oldPath} now redirects to ${moved.newPath}.` : 'Page saved.',
    );
  } catch (error) {
    return toActionError(error);
  }
}

export async function setPageStatus(
  pageId: string,
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED',
): Promise<ActionResult> {
  try {
    const user =
      status === 'PUBLISHED' ? await authorize('pages.publish') : await authorize('pages.edit');
    const page = await prisma.page.findUnique({ where: { id: pageId } });
    if (!page) return failure('That page no longer exists.');
    await assertPageAccess(user, page.countryId);

    await prisma.page.update({
      where: { id: pageId },
      data: {
        status,
        publishedAt: status === 'PUBLISHED' ? (page.publishedAt ?? new Date()) : page.publishedAt,
        updatedById: user.id,
      },
    });

    await recordAudit({
      actor: user,
      action: status.toLowerCase(),
      entity: 'Page',
      entityId: pageId,
      summary: `Set “${page.title}” to ${status.toLowerCase()}`,
      before: { status: page.status },
      after: { status },
    });

    revalidatePath('/admin/pages');
    await revalidatePage(page.countryId, page.slug);
    refreshSeoScores([{ type: 'PAGE', id: pageId, countryId: page.countryId }]);
    return success(undefined, `Page ${status.toLowerCase()}.`);
  } catch (error) {
    return toActionError(error);
  }
}

export async function duplicatePage(pageId: string): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await authorize('pages.create');
    const source = await prisma.page.findUnique({
      where: { id: pageId },
      include: { sections: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!source) return failure('That page no longer exists.');
    await assertPageAccess(user, source.countryId);

    const market = await getCountryById(source.countryId);
    const slug = await uniqueSlug(`${source.slug || 'home'}-copy`, async (candidate) => {
      const existing = await prisma.page.findUnique({
        where: { countryId_slug: { countryId: source.countryId, slug: candidate } },
        select: { id: true },
      });
      return (
        Boolean(existing) ||
        (await isAddressTaken(prisma, joinMarket(market?.slug ?? '', candidate)))
      );
    });

    const copy = await prisma.$transaction(async (tx) => {
      const created = await tx.page.create({
        data: {
          countryId: source.countryId,
          title: `${source.title} (copy)`,
          slug,
          status: 'DRAFT',
          isHomepage: false,
          showHeader: source.showHeader,
          showFooter: source.showFooter,
          seoTitle: source.seoTitle,
          seoDescription: source.seoDescription,
          noIndex: source.noIndex,
          noFollow: source.noFollow,
          ogTitle: source.ogTitle,
          ogDescription: source.ogDescription,
          ogImageId: source.ogImageId,
          ...keywordColumns(source),
          createdById: user.id,
          updatedById: user.id,
          sections: { create: sectionCopies(source.sections) },
        },
      });
      // A copy in the same market is a different page, not the same page's twin.
      await tx.page.update({ where: { id: created.id }, data: { groupKey: created.id } });
      await syncRoutes(tx, [{ type: 'PAGE', entityId: created.id, countryId: source.countryId }], {
        actor: user,
        reason: 'CREATE',
      });
      return created;
    });

    await recordAudit({
      actor: user,
      action: 'duplicated',
      entity: 'Page',
      entityId: copy.id,
      summary: `Duplicated “${source.title}”`,
    });

    revalidatePath('/admin/pages');
    return success({ id: copy.id }, 'Page duplicated.');
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * Copies a page into another market.
 *
 * The whole page comes across — every section, in order, with its block type,
 * content, design settings and media references, plus the layout flags and the
 * SEO fields as an editing starting point. What deliberately does not come
 * across is publication: the copy is always a DRAFT, so a duplicated page can
 * never appear in search results as an unreviewed duplicate of another market's
 * page. It is never the homepage either; that is a decision for the target
 * market to make on purpose.
 *
 * An existing page at the same URL in the target market is never overwritten
 * silently. The action refuses and reports the clash, and only replaces the
 * target's sections when the caller comes back having explicitly confirmed it.
 */
export async function duplicatePageToCountry(
  pageId: string,
  targetCountryId: string,
  options: { replaceExisting?: boolean } = {},
): Promise<ActionResult<{ id: string; replaced: boolean }>> {
  try {
    const user = await authorize('pages.create');

    const source = await prisma.page.findUnique({
      where: { id: pageId },
      include: { sections: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!source || source.deletedAt) return failure('That page no longer exists.');
    await assertPageAccess(user, source.countryId);

    const target = await resolveActionCountry(user, targetCountryId);
    if (target.id === source.countryId) {
      return failure('That page already belongs to this country.');
    }

    const existing = await prisma.page.findUnique({
      where: { countryId_slug: { countryId: target.id, slug: source.slug } },
      select: { id: true, title: true, deletedAt: true },
    });

    if (existing && !existing.deletedAt && !options.replaceExisting) {
      return failure(
        `${target.name} already has a page at /${source.slug || ''} (“${existing.title}”). Confirm to replace its content.`,
        { _confirm: ['exists'] },
      );
    }

    const sectionData = sectionCopies(source.sections);

    const shared = {
      title: source.title,
      status: 'DRAFT' as const,
      publishedAt: null,
      isHomepage: false,
      categoryId: source.categoryId,
      showHeader: source.showHeader,
      showFooter: source.showFooter,
      seoTitle: source.seoTitle,
      seoDescription: source.seoDescription,
      // The canonical is intentionally not copied: a market canonicals to its
      // own URL, and inheriting the source's would point the copy at the other
      // market's page.
      canonicalUrl: null,
      noIndex: source.noIndex,
      noFollow: source.noFollow,
      ogTitle: source.ogTitle,
      ogDescription: source.ogDescription,
      ogImageId: source.ogImageId,
      twitterTitle: source.twitterTitle,
      twitterDescription: source.twitterDescription,
      twitterImageId: source.twitterImageId,
      // A starting point for the other market, like the title: it may well
      // target different searches there, and can change them.
      ...keywordColumns(source),
      updatedById: user.id,
    };

    // The copy is the same page in another market: it joins the source's group,
    // which is how the market switcher and hreflang find it even after either
    // page is given a different URL.
    const groupKey = source.groupKey ?? source.id;
    const copy = await prisma.$transaction(async (tx) => {
      let saved;
      if (existing) {
        await tx.pageSection.deleteMany({ where: { pageId: existing.id } });
        saved = await tx.page.update({
          where: { id: existing.id },
          data: {
            ...shared,
            slug: source.slug,
            groupKey,
            deletedAt: null,
            sections: { create: sectionData },
          },
        });
      } else {
        saved = await tx.page.create({
          data: {
            ...shared,
            countryId: target.id,
            slug: source.slug,
            groupKey,
            createdById: user.id,
            sections: { create: sectionData },
          },
        });
      }
      if (!source.groupKey) {
        await tx.page.update({ where: { id: source.id }, data: { groupKey } });
      }
      await syncRoutes(tx, [{ type: 'PAGE', entityId: saved.id, countryId: target.id }], {
        actor: user,
        reason: existing ? 'EDIT' : 'CREATE',
      });
      return saved;
    });

    await recordAudit({
      actor: user,
      action: existing ? 'duplicated.replaced' : 'duplicated.country',
      entity: 'Page',
      entityId: copy.id,
      summary: `Copied “${source.title}” to ${target.name} as a draft`,
      before: existing ? { id: existing.id, title: existing.title } : undefined,
      after: { slug: copy.slug, country: target.code, status: copy.status },
    });

    revalidatePath('/admin/pages');
    await revalidatePage(target.id, copy.slug);
    return success(
      { id: copy.id, replaced: Boolean(existing) },
      `Copied to ${target.name} as a draft.`,
    );
  } catch (error) {
    return toActionError(error);
  }
}

export async function deletePage(pageId: string): Promise<ActionResult> {
  try {
    const user = await authorize('pages.delete');
    const page = await prisma.page.findUnique({ where: { id: pageId } });
    if (!page) return failure('That page no longer exists.');
    await assertPageAccess(user, page.countryId);
    if (page.isHomepage)
      return failure('Set another page as the homepage before deleting this one.');

    // Soft delete keeps inbound lead attribution intact. The address is
    // released, not redirected: where a deleted page's visitors should go is a
    // decision for a person (Slug & URL Manager → History), never a default.
    await prisma.$transaction(async (tx) => {
      await tx.page.update({
        where: { id: pageId },
        data: {
          deletedAt: new Date(),
          status: 'ARCHIVED',
          slug: `${page.slug}-deleted-${Date.now()}`,
          // A deleted page is nobody's landing page; restoring it files it
          // again from the address it gets back.
          isCityHomepage: false,
        },
      });
      await releaseRoutes(tx, [{ type: 'PAGE', entityId: pageId, countryId: page.countryId, label: page.title }], {
        actor: user,
      });
    });

    await recordAudit({
      actor: user,
      action: 'deleted',
      entity: 'Page',
      entityId: pageId,
      summary: `Deleted page “${page.title}”`,
      before: { title: page.title, slug: page.slug },
    });

    revalidatePath('/admin/pages');
    await revalidatePage(page.countryId, page.slug);
    return success(undefined, 'Page deleted.');
  } catch (error) {
    return toActionError(error);
  }
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

export async function addSection(
  pageId: string,
  blockType: string,
): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await authorize('pages.edit');
    const definition = getBlock(blockType);
    if (!definition) return failure('Unknown block type.');

    const page = await prisma.page.findUnique({
      where: { id: pageId },
      select: { slug: true, countryId: true },
    });
    if (!page) return failure('That page no longer exists.');
    await assertPageAccess(user, page.countryId);

    const last = await prisma.pageSection.findFirst({
      where: { pageId },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });

    const section = await prisma.pageSection.create({
      data: {
        pageId,
        blockType,
        name: definition.label,
        sortOrder: (last?.sortOrder ?? 0) + 10,
        content: blockDefaults(blockType) as object,
        settings: DEFAULT_SECTION_DESIGN as unknown as object,
      },
    });

    await recordAudit({
      actor: user,
      action: 'section.added',
      entity: 'Page',
      entityId: pageId,
      summary: `Added a ${definition.label} section`,
    });

    revalidatePath(`/admin/pages/${pageId}`);
    await revalidatePage(page.countryId, page.slug);
    refreshSeoScores([{ type: 'PAGE', id: pageId, countryId: page.countryId }]);
    return success({ id: section.id }, `${definition.label} added.`);
  } catch (error) {
    return toActionError(error);
  }
}

export async function updateSection(
  sectionId: string,
  payload: { content?: unknown; settings?: unknown; name?: string | null; isVisible?: boolean },
): Promise<ActionResult> {
  try {
    const user = await authorize('pages.edit');

    const section = await prisma.pageSection.findUnique({
      where: { id: sectionId },
      include: { page: { select: { id: true, slug: true, countryId: true } } },
    });
    if (!section) return failure('That section no longer exists.');

    const definition = getBlock(section.blockType);
    const data: Record<string, unknown> = {};

    if (payload.content !== undefined && definition) {
      // Validate against the block's own schema so stored content always parses.
      data.content = definition.schema.parse(payload.content);
    }
    if (payload.settings !== undefined) {
      // parseSectionDesign never throws — it upgrades the original settings
      // shape and falls back to defaults — so a half-saved panel can't 500.
      const design = parseSectionDesign(payload.settings);

      // Anchor IDs address a single element, so they must be unique per page.
      if (design.anchorId) {
        const siblings = await prisma.pageSection.findMany({
          where: { pageId: section.page.id, id: { not: sectionId } },
          select: { settings: true },
        });
        const taken = siblings.some(
          (s) => parseSectionDesign(s.settings).anchorId === design.anchorId,
        );
        if (taken) {
          return failure(
            `Another section on this page already uses the anchor “${design.anchorId}”.`,
            {
              anchorId: ['This anchor is already used on this page'],
            },
          );
        }
      }

      data.settings = design as unknown as object;
    }
    if (payload.name !== undefined) data.name = payload.name ? sanitizeText(payload.name) : null;
    if (payload.isVisible !== undefined) data.isVisible = payload.isVisible;

    await prisma.pageSection.update({ where: { id: sectionId }, data });
    await prisma.page.update({ where: { id: section.page.id }, data: { updatedById: user.id } });

    revalidatePath(`/admin/pages/${section.page.id}`);
    await revalidatePage(section.page.countryId, section.page.slug);
    refreshSeoScores([{ type: 'PAGE', id: section.pageId, countryId: section.page.countryId }]);
    return success(undefined, 'Section saved.');
  } catch (error) {
    return toActionError(error);
  }
}

export async function duplicateSection(sectionId: string): Promise<ActionResult<{ id: string }>> {
  try {
    await authorize('pages.edit');
    const source = await prisma.pageSection.findUnique({
      where: { id: sectionId },
      include: { page: { select: { id: true, slug: true, countryId: true } } },
    });
    if (!source) return failure('That section no longer exists.');

    // The copy keeps every design value except the anchor: two elements cannot
    // share one DOM id, and silently duplicating it would break #links.
    const design = parseSectionDesign(source.settings);

    const copy = await prisma.pageSection.create({
      data: {
        pageId: source.pageId,
        blockType: source.blockType,
        name: source.name ? `${source.name} (copy)` : null,
        sortOrder: source.sortOrder + 5,
        isVisible: source.isVisible,
        content: source.content as object,
        settings: { ...design, anchorId: '' } as unknown as object,
      },
    });

    await normaliseOrder(source.pageId);
    revalidatePath(`/admin/pages/${source.pageId}`);
    await revalidatePage(source.page.countryId, source.page.slug);
    refreshSeoScores([{ type: 'PAGE', id: source.pageId, countryId: source.page.countryId }]);
    return success({ id: copy.id }, 'Section duplicated.');
  } catch (error) {
    return toActionError(error);
  }
}

export async function deleteSection(sectionId: string): Promise<ActionResult> {
  try {
    await authorize('pages.edit');
    const section = await prisma.pageSection.findUnique({
      where: { id: sectionId },
      include: { page: { select: { id: true, slug: true, countryId: true } } },
    });
    if (!section) return failure('That section no longer exists.');

    await prisma.pageSection.delete({ where: { id: sectionId } });
    revalidatePath(`/admin/pages/${section.page.id}`);
    await revalidatePage(section.page.countryId, section.page.slug);
    refreshSeoScores([{ type: 'PAGE', id: section.pageId, countryId: section.page.countryId }]);
    return success(undefined, 'Section removed.');
  } catch (error) {
    return toActionError(error);
  }
}

export async function reorderSections(input: unknown): Promise<ActionResult> {
  try {
    await authorize('pages.edit');
    const { pageId, order } = sectionOrderSchema.parse(input);

    const page = await prisma.page.findUnique({
      where: { id: pageId },
      select: { slug: true, countryId: true },
    });
    if (!page) return failure('That page no longer exists.');

    // Reject ids that do not belong to this page.
    const owned = await prisma.pageSection.findMany({ where: { pageId }, select: { id: true } });
    const ownedIds = new Set(owned.map((s) => s.id));
    if (order.some((id) => !ownedIds.has(id))) return failure('Invalid section order.');

    await prisma.$transaction(
      order.map((id, index) =>
        prisma.pageSection.update({ where: { id }, data: { sortOrder: (index + 1) * 10 } }),
      ),
    );

    revalidatePath(`/admin/pages/${pageId}`);
    await revalidatePage(page.countryId, page.slug);
    refreshSeoScores([{ type: 'PAGE', id: pageId, countryId: page.countryId }]);
    return success(undefined, 'Order saved.');
  } catch (error) {
    return toActionError(error);
  }
}

async function normaliseOrder(pageId: string) {
  const sections = await prisma.pageSection.findMany({
    where: { pageId },
    orderBy: { sortOrder: 'asc' },
    select: { id: true },
  });
  await prisma.$transaction(
    sections.map((section, index) =>
      prisma.pageSection.update({
        where: { id: section.id },
        data: { sortOrder: (index + 1) * 10 },
      }),
    ),
  );
}

export async function toggleSectionVisibility(sectionId: string): Promise<ActionResult> {
  try {
    await authorize('pages.edit');
    const section = await prisma.pageSection.findUnique({
      where: { id: sectionId },
      include: { page: { select: { id: true, slug: true, countryId: true } } },
    });
    if (!section) return failure('That section no longer exists.');

    await prisma.pageSection.update({
      where: { id: sectionId },
      data: { isVisible: !section.isVisible },
    });

    revalidatePath(`/admin/pages/${section.page.id}`);
    await revalidatePage(section.page.countryId, section.page.slug);
    refreshSeoScores([{ type: 'PAGE', id: section.pageId, countryId: section.page.countryId }]);
    return success(undefined, section.isVisible ? 'Section hidden.' : 'Section shown.');
  } catch (error) {
    return toActionError(error);
  }
}

const bulkSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(100),
  action: z.enum(['publish', 'draft', 'archive', 'delete']),
});

export async function bulkPageAction(input: unknown): Promise<ActionResult> {
  try {
    const { ids, action } = bulkSchema.parse(input);
    const user =
      action === 'delete'
        ? await authorize('pages.delete')
        : action === 'publish'
          ? await authorize('pages.publish')
          : await authorize('pages.edit');

    const pages = await prisma.page.findMany({ where: { id: { in: ids }, deletedAt: null } });
    const targets = action === 'delete' ? pages.filter((p) => !p.isHomepage) : pages;

    if (action === 'delete') {
      await prisma.$transaction(async (tx) => {
        for (const page of targets) {
          await tx.page.update({
            where: { id: page.id },
            data: {
              deletedAt: new Date(),
              status: 'ARCHIVED',
              slug: `${page.slug}-deleted-${Date.now()}`,
              isCityHomepage: false,
            },
          });
        }
        await releaseRoutes(
          tx,
          targets.map((page) => ({ type: 'PAGE' as const, entityId: page.id, countryId: page.countryId, label: page.title })),
          { actor: user },
        );
      });
    } else {
      const status = action === 'publish' ? 'PUBLISHED' : action === 'draft' ? 'DRAFT' : 'ARCHIVED';
      await prisma.page.updateMany({
        where: { id: { in: targets.map((p) => p.id) } },
        data: {
          status,
          ...(status === 'PUBLISHED' ? { publishedAt: new Date() } : {}),
          updatedById: user.id,
        },
      });
    }

    await recordAudit({
      actor: user,
      action: `bulk.${action}`,
      entity: 'Page',
      summary: `${action} applied to ${targets.length} page(s)`,
    });

    revalidatePath('/admin/pages');
    for (const page of targets) await revalidatePage(page.countryId, page.slug);
    refreshSeoScores(targets.slice(0, 50).map((page) => ({ type: 'PAGE' as const, id: page.id, countryId: page.countryId })));

    const skipped = pages.length - targets.length;
    return success(
      undefined,
      `${targets.length} page(s) updated.${skipped ? ` ${skipped} skipped (homepage).` : ''}`,
    );
  } catch (error) {
    return toActionError(error);
  }
}

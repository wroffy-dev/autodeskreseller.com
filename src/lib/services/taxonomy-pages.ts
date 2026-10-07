import 'server-only';
import { prisma } from '@/lib/db/prisma';
import { publishedPageWhere } from './pages';
import type { CountryContext } from '@/lib/country/types';
import { blockDefaults } from '@/lib/cms/blocks';
import {
  taxonomyPageSections,
  taxonomyPageSlug,
  taxonomyPageDescription,
  type TaxonomyKind,
  type TaxonomySeed,
} from '@/lib/cms/taxonomy-pages';
import { pageHref } from '@/lib/urls/links';
import { patternRelativePath } from '@/lib/urls/content';
import { syncRoutes } from '@/lib/urls/content-sync';
import { segmentsOf } from '@/lib/urls/path';
import { UrlRegistryError } from '@/lib/urls/errors';
import type { Actor } from '@/lib/urls/registry';

/**
 * Giving a category or a brand its page.
 *
 * Creating one is deliberately idempotent and never destructive: if the
 * taxonomy already has a page in that market it is left exactly as it is,
 * whoever built it and whatever is on it now. Generating is a one-time head
 * start, not a template that reaches back in and overwrites somebody's work
 * every time the category is renamed.
 *
 * The page is linked to its category or brand **by id**. Product pages find it
 * through that link, so renaming the page, re-slugging the category or moving
 * the category-page pattern never breaks the link — and a page that merely
 * happens to sit at `/categories/<slug>` is not mistaken for it.
 */

export type TaxonomyPageResult =
  | { created: boolean; pageId: string; slug: string }
  | { created: false; pageId: null; slug: string; conflict: string };

const linkField = (kind: TaxonomyKind) =>
  kind === 'category' ? ('landingCategoryId' as const) : ('landingBrandId' as const);

/**
 * The page for one category or brand in one market, created if it is missing.
 *
 * Published, because a category page with no products on it is a draft nobody
 * asked for and a category page with its products is the thing that was just
 * asked for. It is an ordinary page from that moment on — unpublish it, edit
 * it, delete it.
 *
 * The address comes from the market's category-page (or brand-page) pattern.
 * When that address already belongs to something else, no page is created and
 * the conflict is reported; nothing is overwritten and nothing is renamed.
 */
export async function ensureTaxonomyPage(
  seed: TaxonomySeed,
  countryId: string,
  userId: string | null,
  actor: Actor = userId ? { id: userId } : null,
): Promise<TaxonomyPageResult> {
  const field = linkField(seed.kind);

  const linked = await prisma.page.findFirst({
    where: { countryId, [field]: seed.id, deletedAt: null },
    select: { id: true, slug: true },
  });
  if (linked) return { created: false, pageId: linked.id, slug: linked.slug };

  // A page at the old conventional address that nobody linked yet is this
  // taxonomy's page: link it rather than making a second one.
  const legacy = await prisma.page.findFirst({
    where: { countryId, slug: taxonomyPageSlug(seed.kind, seed.slug), deletedAt: null, [field]: null },
    select: { id: true, slug: true },
  });
  if (legacy) {
    await prisma.page.update({ where: { id: legacy.id }, data: { [field]: seed.id } });
    return { created: false, pageId: legacy.id, slug: legacy.slug };
  }

  const patterns = new Map(
    (await prisma.urlPattern.findMany({ select: { scopeKey: true, pattern: true } })).map((row) => [
      row.scopeKey,
      row.pattern,
    ]),
  );
  const relative = patternRelativePath(
    { type: seed.kind === 'category' ? 'CATEGORY_PAGE' : 'BRAND_PAGE', slug: seed.slug, countryId },
    { patterns },
  );
  const slug = segmentsOf(relative).join('/');

  try {
    const page = await prisma.$transaction(async (tx) => {
      const created = await tx.page.create({
        data: {
          countryId,
          title: seed.name,
          slug,
          status: 'PUBLISHED',
          publishedAt: new Date(),
          seoTitle: seed.name,
          seoDescription: taxonomyPageDescription(seed),
          [field]: seed.id,
          createdById: userId,
          updatedById: userId,
          sections: {
            create: taxonomyPageSections(seed).map((section, index) => ({
              blockType: section.blockType,
              name: section.name ?? null,
              sortOrder: (index + 1) * 10,
              isVisible: section.isVisible ?? true,
              content: {
                ...(blockDefaults(section.blockType) as object),
                ...(section.content ?? {}),
              } as object,
              settings: (section.settings ?? {}) as object,
            })),
          },
        },
        select: { id: true },
      });
      await tx.page.update({ where: { id: created.id }, data: { groupKey: created.id } });
      await syncRoutes(tx, [{ type: 'PAGE', entityId: created.id, countryId }], {
        actor,
        reason: 'CREATE',
        source: 'pattern',
      });
      return created;
    });
    return { created: true, pageId: page.id, slug };
  } catch (error) {
    if (error instanceof UrlRegistryError) {
      return { created: false, pageId: null, slug, conflict: error.message };
    }
    throw error;
  }
}

/**
 * Which of these taxonomy entries already have a page in this market, by the
 * taxonomy's id. Pages not linked yet are recognised at their old conventional
 * address, so the screen never offers to make a second one.
 */
export async function taxonomyPageMap(
  kind: TaxonomyKind,
  entries: ReadonlyArray<{ id: string; slug: string }>,
  countryId: string,
): Promise<Map<string, string>> {
  if (entries.length === 0) return new Map();
  const field = linkField(kind);

  const pages = await prisma.page.findMany({
    where: {
      countryId,
      deletedAt: null,
      OR: [
        { [field]: { in: entries.map((entry) => entry.id) } },
        { [field]: null, slug: { in: entries.map((entry) => taxonomyPageSlug(kind, entry.slug)) } },
      ],
    },
    select: { id: true, slug: true, landingCategoryId: true, landingBrandId: true },
  });

  const out = new Map<string, string>();
  for (const entry of entries) {
    const page =
      pages.find((row) => row[field] === entry.id) ??
      pages.find((row) => !row[field] && row.slug === taxonomyPageSlug(kind, entry.slug));
    if (page) out.set(entry.id, page.id);
  }
  return out;
}

/**
 * Where a product's category and brand actually link to, in this market.
 *
 * Only a page that is published here produces a link. A category whose page
 * was never generated, or was unpublished or deleted, renders as plain text
 * rather than as a link to a 404 — the name is still worth showing, the dead
 * link is not.
 */
export async function taxonomyHrefs(
  country: Pick<CountryContext, 'id' | 'slug'>,
  taxonomy: {
    categoryId?: string | null;
    categorySlug?: string | null;
    brandId?: string | null;
    brandSlug?: string | null;
  },
): Promise<{ categoryHref: string | null; brandHref: string | null }> {
  const or: object[] = [];
  if (taxonomy.categoryId) {
    or.push({ landingCategoryId: taxonomy.categoryId });
    if (taxonomy.categorySlug) {
      or.push({ landingCategoryId: null, slug: taxonomyPageSlug('category', taxonomy.categorySlug) });
    }
  }
  if (taxonomy.brandId) {
    or.push({ landingBrandId: taxonomy.brandId });
    if (taxonomy.brandSlug) {
      or.push({ landingBrandId: null, slug: taxonomyPageSlug('brand', taxonomy.brandSlug) });
    }
  }
  if (or.length === 0) return { categoryHref: null, brandHref: null };

  const live = await prisma.page.findMany({
    where: { ...publishedPageWhere(), countryId: country.id, OR: or },
    select: { id: true, slug: true, landingCategoryId: true, landingBrandId: true },
  });

  const pick = (
    id: string | null | undefined,
    field: 'landingCategoryId' | 'landingBrandId',
    kind: TaxonomyKind,
    slug: string | null | undefined,
  ) => {
    if (!id) return null;
    const page =
      live.find((row) => row[field] === id) ??
      (slug ? live.find((row) => !row[field] && row.slug === taxonomyPageSlug(kind, slug)) : undefined);
    return page ? pageHref(country, page) : null;
  };

  return {
    categoryHref: pick(taxonomy.categoryId, 'landingCategoryId', 'category', taxonomy.categorySlug),
    brandHref: pick(taxonomy.brandId, 'landingBrandId', 'brand', taxonomy.brandSlug),
  };
}

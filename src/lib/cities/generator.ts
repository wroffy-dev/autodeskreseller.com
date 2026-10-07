import 'server-only';
import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { sectionCopies } from '@/lib/cms/section-copy';
import { keywordColumns } from '@/lib/seo/keywords';
import { describeOwner, loadContentInfo } from '@/lib/urls/content';
import { syncRoutes } from '@/lib/urls/content-sync';
import { UrlRegistryError } from '@/lib/urls/errors';
import { joinMarket, MAX_PATH_LENGTH, MAX_SEGMENTS, pathKey, segmentsOf } from '@/lib/urls/path';
import { checkAvailability, lockRegistry, type Actor } from '@/lib/urls/registry';
import { entityKey } from '@/lib/urls/snapshot';
import type { UrlContentType } from '@/lib/urls/types';
import { sanitizeText } from '@/lib/utils/sanitize';
import { cityPageSlug } from './paths';
import {
  fillPlaceholders,
  fillPlaceholdersDeep,
  placeholderValues,
  placeholdersIn,
  type CityPlaceholder,
  type PlaceholderValues,
} from './template';

/**
 * The City Page Generator.
 *
 * Copies one page into many cities of its market: `autocad` becomes
 * `delhi/autocad`, `gurugram/autocad` and so on, each a complete, ordinary
 * page with every section of the source, its placeholders filled in for that
 * city.
 *
 * The rules:
 *
 *  - **Independent from the moment it exists.** A generated page is a new
 *    Page row with new PageSection rows. It records where it came from
 *    (`generatedFromPageId`, `generationBatchId`, `generatedAt`) and nothing
 *    ever reads that to copy anything again: editing the source changes no
 *    city page, and editing a city page changes nothing else.
 *  - **Never overwrites by default.** A city that already has a page at the
 *    address is skipped, and one whose address is held by anything else — a
 *    redirect, a product — fails with the reason. The preview shows both
 *    before anything is written. Regenerating an existing page is a separate,
 *    explicit choice made per city after the impact preview (which says
 *    whether the page was edited since it was generated, and whether it is
 *    published); the page keeps its id, address and status, and the content
 *    it had is kept in the run's record.
 *  - **All or nothing per city.** Each city's page, its sections and its
 *    address are written in one transaction holding the registry lock, so a
 *    failure never leaves a page without its sections or an address without
 *    its page. One city failing does not stop the others.
 *  - **Always drafts.** Generated pages are drafts, so near-identical copies
 *    are never mass-published: each is reviewed, made specific to its city and
 *    published on its own. A regenerated page keeps the status it had.
 *  - **Explicit city/product pages.** When the run names a product, each page
 *    is recorded as that city's page for the product (`CityProduct`), by id. A
 *    nested address alone never makes a page a city/product page.
 */

const SENTINEL = '__generated_page__';

export type SourcePage = Prisma.PageGetPayload<{ include: { sections: { orderBy: { sortOrder: 'asc' } } } }>;

export type GeneratorCity = { id: string; name: string; slug: string; region: string | null; isActive: boolean };
export type GeneratorCountry = { id: string; name: string; code: string; slug: string };
export type GeneratorProduct = { id: string; name: string; slug: string };

export type PlanOutcome = 'create' | 'exists' | 'replace' | 'conflict' | 'invalid';

/** The page already at a city's address, as the impact preview describes it. */
export type ExistingPage = {
  id: string;
  title: string;
  status: string;
  /** Generated from this same source page. */
  fromThisSource: boolean;
  /** Changed after it was generated — or never generated at all. */
  editedSince: boolean;
  /** In the recycle bin; never regenerated. */
  deleted: boolean;
};

export type PlanRow = {
  cityId: string;
  city: string;
  region: string | null;
  cityActive: boolean;
  slug: string;
  path: string;
  /** The generated page's title. */
  title: string;
  outcome: PlanOutcome;
  reason: string | null;
  /** The page or content already at the address. */
  holder: { description: string; editHref: string | null } | null;
  /** The page at the address, for the regeneration choice. */
  existing: ExistingPage | null;
  /** With a product: the city's page for that product today, when it is another page. */
  productPage: { id: string; title: string } | null;
};

export type RunOutcome = 'created' | 'replaced' | 'skipped' | 'failed';

/** What a regenerated page held before, kept in the run's record. */
export type ReplacedContent = {
  title: string;
  seoTitle: string | null;
  seoDescription: string | null;
  sections: Array<{ blockType: string; name: string | null; sortOrder: number; isVisible: boolean; content: unknown; settings: unknown }>;
};

export type RunRow = {
  cityId: string;
  city: string;
  path: string;
  outcome: RunOutcome;
  pageId: string | null;
  reason: string | null;
  /** For a regenerated page: what it held before. */
  previous?: ReplacedContent;
};

type HashablePage = {
  title: string;
  seoTitle: string | null;
  seoDescription: string | null;
  sections: ReadonlyArray<{ blockType: string; name: string | null; sortOrder: number; isVisible: boolean; content: unknown; settings: unknown }>;
};

/**
 * A fingerprint of what an editor can change on a page: its title, search
 * fields and sections. Stored when the generator writes a page, and compared
 * in the impact preview, so "edited since it was generated" is exact rather
 * than guessed from timestamps.
 */
export function pageContentHash(page: HashablePage): string {
  const sections = [...page.sections]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((section) => [section.blockType, section.name, section.isVisible, section.content, section.settings]);
  return createHash('sha256')
    .update(JSON.stringify([page.title, page.seoTitle, page.seoDescription, sections]))
    .digest('hex')
    .slice(0, 32);
}

function existingPage(
  page: HashablePage & {
    id: string;
    status: string;
    deletedAt: Date | null;
    generatedFromPageId: string | null;
    generatedHash: string | null;
  },
  sourceId: string,
): ExistingPage {
  return {
    id: page.id,
    title: page.title,
    status: page.status,
    fromThisSource: page.generatedFromPageId === sourceId,
    editedSince: !page.generatedHash || page.generatedHash !== pageContentHash(page),
    deleted: Boolean(page.deletedAt),
  };
}

/** Records what the generator just wrote, for the next impact preview. */
async function stampGenerated(tx: Prisma.TransactionClient, pageId: string): Promise<void> {
  const written = await tx.page.findUniqueOrThrow({
    where: { id: pageId },
    select: { title: true, seoTitle: true, seoDescription: true, sections: true },
  });
  await tx.page.update({ where: { id: pageId }, data: { generatedHash: pageContentHash(written) } });
}

/** The generated page's title: the template with placeholders filled, or the source's own title filled. */
export function generatedTitle(template: string | null, source: { title: string }, values: PlaceholderValues): string {
  const raw = template?.trim() || source.title;
  const title = sanitizeText(fillPlaceholders(raw, values)).slice(0, 200);
  return title || values['page.title'] || source.title;
}

function valuesFor(
  city: GeneratorCity,
  country: GeneratorCountry,
  source: { title: string; slug: string },
  product: GeneratorProduct | null = null,
) {
  return placeholderValues({ city, country, page: { title: source.title, slug: source.slug }, product });
}

/** Where the source's copy goes in a city, and whether that address can have it. */
function target(city: GeneratorCity, country: GeneratorCountry, source: { slug: string }) {
  const slug = cityPageSlug(city.slug, source.slug);
  const path = joinMarket(country.slug, slug);
  const invalid =
    segmentsOf(slug).length > MAX_SEGMENTS
      ? `That would be ${segmentsOf(slug).length} segments deep; addresses have at most ${MAX_SEGMENTS}.`
      : path.length > MAX_PATH_LENGTH
        ? `That address would be longer than ${MAX_PATH_LENGTH} characters.`
        : null;
  return { slug, path, invalid };
}

/** The placeholders a source page uses anywhere the generator fills them. */
export function sourcePlaceholders(source: SourcePage): CityPlaceholder[] {
  return placeholdersIn([
    source.title,
    source.seoTitle,
    source.seoDescription,
    source.ogTitle,
    source.ogDescription,
    source.twitterTitle,
    source.twitterDescription,
    source.primaryKeyword1,
    source.primaryKeyword2,
    source.primaryKeyword3,
    ...source.sections.map((section) => [section.name, section.content]),
  ]);
}

/**
 * What generating would do for each city, read-only. The run repeats every
 * check under the registry lock; this is what the screen shows first.
 */
export async function planGeneration(input: {
  source: SourcePage;
  country: GeneratorCountry;
  cities: readonly GeneratorCity[];
  titleTemplate: string | null;
  rootCountryId: string;
  product?: GeneratorProduct | null;
  replaceCityIds?: ReadonlySet<string>;
}): Promise<PlanRow[]> {
  const { source, country } = input;
  const product = input.product ?? null;
  const replace = input.replaceCityIds ?? new Set<string>();
  const targets = input.cities.map((city) => ({ city, ...target(city, country, source) }));

  const existing = await prisma.page.findMany({
    where: { countryId: country.id, slug: { in: targets.map((row) => row.slug) } },
    select: {
      id: true,
      slug: true,
      title: true,
      status: true,
      deletedAt: true,
      generatedFromPageId: true,
      generatedHash: true,
      seoTitle: true,
      seoDescription: true,
      sections: { select: { blockType: true, name: true, sortOrder: true, isVisible: true, content: true, settings: true } },
    },
  });
  const existingBySlug = new Map(existing.map((page) => [page.slug, page]));
  const associations = product
    ? await prisma.cityProduct.findMany({
        where: { productId: product.id, cityId: { in: input.cities.map((city) => city.id) } },
        select: { cityId: true, page: { select: { id: true, title: true, deletedAt: true } } },
      })
    : [];
  const productPageOf = new Map(
    associations
      .filter((row) => row.page && !row.page.deletedAt)
      .map((row) => [row.cityId, { id: row.page!.id, title: row.page!.title }]),
  );

  const rows: PlanRow[] = [];
  const contentHolders: Array<{ index: number; type: UrlContentType; entityId: string; countryId: string }> = [];

  for (const row of targets) {
    const values = valuesFor(row.city, country, source, product);
    const productPage = productPageOf.get(row.city.id) ?? null;
    const base = {
      cityId: row.city.id,
      city: row.city.name,
      region: row.city.region,
      cityActive: row.city.isActive,
      slug: row.slug,
      path: row.path,
      title: generatedTitle(input.titleTemplate, source, values),
      existing: null,
      productPage: null,
    };
    if (row.invalid) {
      rows.push({ ...base, outcome: 'invalid', reason: row.invalid, holder: null });
      continue;
    }
    const page = existingBySlug.get(row.slug);
    if (page) {
      const info = existingPage(page, source.id);
      const holder = { description: `page “${page.title}”`, editHref: `/admin/pages/${page.id}` };
      const otherProductPage = productPage && productPage.id !== page.id ? productPage : null;
      if (page.deletedAt) {
        rows.push({
          ...base,
          existing: info,
          outcome: 'exists',
          reason: `A page in the recycle bin still holds ${row.path}; restore or delete it for good first.`,
          holder,
        });
        continue;
      }
      if (replace.has(row.city.id)) {
        if (otherProductPage) {
          rows.push({
            ...base,
            existing: info,
            productPage: otherProductPage,
            outcome: 'conflict',
            reason: `${row.city.name} already has a page for ${product!.name} (“${otherProductPage.title}”).`,
            holder,
          });
          continue;
        }
        rows.push({
          ...base,
          existing: info,
          outcome: 'replace',
          reason: [
            `Regenerates “${page.title}” from the source: its title, search fields and every section are replaced.`,
            info.editedSince ? 'It was edited after it was generated; those edits are replaced too.' : null,
            page.status === 'PUBLISHED' ? 'It is published, so the new content is public straight away.' : 'It stays a draft.',
          ]
            .filter(Boolean)
            .join(' '),
          holder,
        });
        continue;
      }
      rows.push({
        ...base,
        existing: info,
        productPage: otherProductPage,
        outcome: 'exists',
        reason: `A page is already at ${row.path}; it is left exactly as it is unless you choose to regenerate it.`,
        holder,
      });
      continue;
    }
    if (productPage) {
      rows.push({
        ...base,
        productPage,
        outcome: 'conflict',
        reason: `${row.city.name} already has a page for ${product!.name} (“${productPage.title}”).`,
        holder: { description: `page “${productPage.title}”`, editHref: `/admin/pages/${productPage.id}` },
      });
      continue;
    }
    const availability = await checkAvailability(prisma, pathKey(row.path)!, {
      entityId: SENTINEL,
      countryId: country.id,
      type: 'PAGE',
    });
    if (!availability.ok) {
      const owner = availability.owner;
      const ref = ownerRef(owner);
      if (ref) contentHolders.push({ index: rows.length, ...ref });
      rows.push({
        ...base,
        outcome: 'conflict',
        reason: `${row.path} is already used by ${owner.description}.`,
        holder: { description: owner.description, editHref: null },
      });
      continue;
    }
    rows.push({ ...base, outcome: 'create', reason: null, holder: null });
  }

  if (contentHolders.length > 0) {
    const infos = await loadContentInfo(contentHolders, input.rootCountryId);
    for (const holder of contentHolders) {
      const info = infos.get(entityKey(holder.entityId, holder.countryId));
      const row = rows[holder.index];
      if (!info || !row) continue;
      row.holder = { description: describeOwner(info), editHref: info.editHref };
      row.reason = `${row.path} is already used by ${describeOwner(info)}.`;
    }
  }

  return rows;
}

function ownerRef(owner: { kind: string; type?: UrlContentType; entityId?: string; countryId: string }) {
  return owner.kind === 'content' && owner.type && owner.entityId
    ? { type: owner.type, entityId: owner.entityId, countryId: owner.countryId }
    : null;
}

/**
 * Generates the source's copy in each city, one transaction per city.
 * Never throws for one city's failure; each city's outcome is returned.
 */
export async function runGeneration(input: {
  source: SourcePage;
  country: GeneratorCountry;
  cities: readonly GeneratorCity[];
  titleTemplate: string | null;
  batchId: string;
  actor: Actor & { id: string };
  product?: GeneratorProduct | null;
  /** Cities whose existing page is regenerated; chosen explicitly after the preview. */
  replaceCityIds?: ReadonlySet<string>;
}): Promise<RunRow[]> {
  const { source, country } = input;
  const product = input.product ?? null;
  const replace = input.replaceCityIds ?? new Set<string>();
  const sections = sectionCopies(source.sections);
  const out: RunRow[] = [];

  for (const city of input.cities) {
    const { slug, path, invalid } = target(city, country, source);
    const row = { cityId: city.id, city: city.name, path };
    if (invalid) {
      out.push({ ...row, outcome: 'failed', pageId: null, reason: invalid });
      continue;
    }

    try {
      const result = await prisma.$transaction(
        async (tx) => {
          // Checked again under the lock: the preview may be minutes old.
          await lockRegistry(tx);
          const existing = await tx.page.findUnique({
            where: { countryId_slug: { countryId: country.id, slug } },
            include: { sections: { orderBy: { sortOrder: 'asc' } } },
          });
          const values = valuesFor(city, country, source, product);
          const fill = (value: string | null) => (value ? fillPlaceholders(value, values) : value);
          const now = new Date();

          if (existing && (!replace.has(city.id) || existing.deletedAt)) {
            return {
              outcome: 'skipped' as const,
              pageId: existing.id,
              reason: `A page is already at ${path} (“${existing.title}”); it was left exactly as it is.`,
            };
          }

          if (existing) {
            // Regenerate, chosen for this city: the page keeps its id, address,
            // status and publication date; its content is replaced, and what it
            // held is returned for the run's record.
            if (existing.id === source.id) throw new UrlRegistryError('A page cannot be regenerated from itself.', 'invalid');
            const previous: ReplacedContent = {
              title: existing.title,
              seoTitle: existing.seoTitle,
              seoDescription: existing.seoDescription,
              sections: existing.sections.map((section) => ({
                blockType: section.blockType,
                name: section.name,
                sortOrder: section.sortOrder,
                isVisible: section.isVisible,
                content: section.content,
                settings: section.settings,
              })),
            };
            await tx.pageSection.deleteMany({ where: { pageId: existing.id } });
            await tx.page.update({
              where: { id: existing.id },
              data: {
                title: generatedTitle(input.titleTemplate, source, values),
                seoTitle: fill(source.seoTitle),
                seoDescription: fill(source.seoDescription),
                ogTitle: fill(source.ogTitle),
                ogDescription: fill(source.ogDescription),
                twitterTitle: fill(source.twitterTitle),
                twitterDescription: fill(source.twitterDescription),
                ...keywordColumns({
                  primaryKeyword1: fill(source.primaryKeyword1),
                  primaryKeyword2: fill(source.primaryKeyword2),
                  primaryKeyword3: fill(source.primaryKeyword3),
                }),
                generatedFromPageId: source.id,
                generationBatchId: input.batchId,
                generatedAt: now,
                updatedById: input.actor.id,
                sections: {
                  create: sections.map((section) => ({
                    ...section,
                    name: section.name ? fillPlaceholders(section.name, values) : section.name,
                    content: fillPlaceholdersDeep(section.content, values) as Prisma.InputJsonObject,
                    settings: section.settings as Prisma.InputJsonObject,
                  })),
                },
              },
            });
            await stampGenerated(tx, existing.id);
            if (product) await associateProduct(tx, { cityId: city.id, productId: product.id, pageId: existing.id, actorId: input.actor.id });
            return { outcome: 'replaced' as const, pageId: existing.id, reason: null, previous };
          }
          const availability = await checkAvailability(tx, pathKey(path)!, {
            entityId: SENTINEL,
            countryId: country.id,
            type: 'PAGE',
          });
          if (!availability.ok) {
            throw new UrlRegistryError(`${path} is already used by ${availability.owner.description}.`, 'conflict');
          }

          if (product) {
            const association = await tx.cityProduct.findUnique({
              where: { cityId_productId: { cityId: city.id, productId: product.id } },
              select: { page: { select: { title: true, deletedAt: true } } },
            });
            if (association?.page && !association.page.deletedAt) {
              throw new UrlRegistryError(`${city.name} already has a page for ${product.name} (“${association.page.title}”).`, 'conflict');
            }
          }

          const page = await tx.page.create({
            data: {
              countryId: country.id,
              title: generatedTitle(input.titleTemplate, source, values),
              slug,
              // Always a draft: reviewed and made specific to the city before
              // anyone can find it.
              status: 'DRAFT',
              publishedAt: null,
              isHomepage: false,
              categoryId: source.categoryId,
              showHeader: source.showHeader,
              showFooter: source.showFooter,
              seoTitle: fill(source.seoTitle),
              seoDescription: fill(source.seoDescription),
              // A city page is canonical to its own address, never the source's.
              canonicalUrl: null,
              noIndex: source.noIndex,
              noFollow: source.noFollow,
              ogTitle: fill(source.ogTitle),
              ogDescription: fill(source.ogDescription),
              ogImageId: source.ogImageId,
              twitterTitle: fill(source.twitterTitle),
              twitterDescription: fill(source.twitterDescription),
              twitterImageId: source.twitterImageId,
              ...keywordColumns({
                primaryKeyword1: fill(source.primaryKeyword1),
                primaryKeyword2: fill(source.primaryKeyword2),
                primaryKeyword3: fill(source.primaryKeyword3),
              }),
              // Set here and confirmed by the registry below, from the address.
              cityId: city.id,
              isCityHomepage: segmentsOf(slug).length === 1,
              generatedFromPageId: source.id,
              generationBatchId: input.batchId,
              generatedAt: now,
              createdById: input.actor.id,
              updatedById: input.actor.id,
              sections: {
                create: sections.map((section) => ({
                  ...section,
                  name: section.name ? fillPlaceholders(section.name, values) : section.name,
                  content: fillPlaceholdersDeep(section.content, values) as Prisma.InputJsonObject,
                  settings: section.settings as Prisma.InputJsonObject,
                })),
              },
            },
          });
          // A city page is its own page, not another market's twin of the source.
          await tx.page.update({ where: { id: page.id }, data: { groupKey: page.id } });
          await syncRoutes(tx, [{ type: 'PAGE', entityId: page.id, countryId: country.id }], {
            actor: input.actor,
            reason: 'CREATE',
            batchId: input.batchId,
          });
          await stampGenerated(tx, page.id);
          if (product) await associateProduct(tx, { cityId: city.id, productId: product.id, pageId: page.id, actorId: input.actor.id });
          return { outcome: 'created' as const, pageId: page.id, reason: null };
        },
        { timeout: 30_000, maxWait: 15_000 },
      );
      out.push({ ...row, ...result });
    } catch (error) {
      out.push({ ...row, outcome: 'failed', pageId: null, reason: failureReason(error) });
    }
  }
  return out;
}

/**
 * Records a page as a city's page for one product. The association is by id
 * and explicit; the database refuses a page from another city.
 */
export async function associateProduct(
  tx: Prisma.TransactionClient,
  input: { cityId: string; productId: string; pageId: string; actorId: string | null },
): Promise<void> {
  await tx.cityProduct.upsert({
    where: { cityId_productId: { cityId: input.cityId, productId: input.productId } },
    update: { pageId: input.pageId },
    create: { cityId: input.cityId, productId: input.productId, pageId: input.pageId, createdById: input.actorId },
  });
}

function failureReason(error: unknown): string {
  if (error instanceof UrlRegistryError) return error.message;
  if (error instanceof Error && error.message.includes('Unique constraint')) {
    return 'Another change took this address at the same moment. Run the generator again to skip or retry it.';
  }
  if (error instanceof Error && error.name === 'PlaceholderDepthError') return error.message;
  console.error('[city-generator]', error);
  return 'The page could not be created. Nothing was saved for this city.';
}

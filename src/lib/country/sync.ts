import 'server-only';
import { prisma } from '@/lib/db/prisma';
import { keywordColumns } from '@/lib/seo/keywords';
import { localiseContent } from '@/lib/country/routing';
import { offerIn } from '@/lib/country/availability';
import { syncRoutes } from '@/lib/urls/content-sync';
import { UrlRegistryError } from '@/lib/urls/errors';
import type { CountryContext } from '@/lib/country/types';
import { Prisma } from '@prisma/client';

/**
 * Copying the default market's content into another market.
 *
 * ## Add-only, and why that is the whole design
 *
 * This **adds content a market has never had**. It is not a mirror, and the
 * difference matters more than anything else here: a mirror makes the
 * destination look like the source, which means deleting what the source no
 * longer has and overwriting what the destination has changed. Both of those
 * destroy a market's own decisions.
 *
 * So there are exactly three outcomes per item: create it, skip it because the
 * market already has it, or skip it because the market *had* it and removed it.
 * Nothing is ever updated, and nothing is ever deleted. Source state is never a
 * reason to touch the destination — deleting a page in India does not touch the
 * copy in the UAE, and never will.
 *
 * ## Tombstones
 *
 * `CountrySyncMapping` deliberately has no foreign key to the row it points at,
 * so deleting the copy leaves the mapping standing. That mapping is the only
 * evidence the market once had the item and chose to remove it. Without it the
 * next run would see "missing", helpfully recreate it, and undo a deliberate
 * removal every single time somebody pressed the button.
 *
 * ## What is copied, and what turns out not to need copying
 *
 * Pages, their sections and market-specific forms are genuinely per-market, so
 * they are copied. Categories, brands and products are **shared rows** — one
 * "Cloud storage", one Dropbox, one product — so what a market needs is not a
 * duplicate but an availability record saying it offers them. That is what gets
 * created.
 *
 * ## The allowlist
 *
 * Only the entity kinds below are ever touched, as an explicit list rather than
 * "everything except…". The exclusions — blogs, leads, submissions, consent
 * records, users, permissions, credentials, audit logs, backups and the source
 * market's own settings — must not depend on somebody remembering to add a new
 * model to a deny-list.
 *
 * ## Money
 *
 * Prices are **not** copied. India's ₹1,250 is not 1,250 of anything else, and
 * writing it into a row labelled AED would relabel a value rather than convert
 * it. The destination row is created in the destination's own currency with its
 * prices left empty, and reported as needing localisation — an empty price an
 * administrator must fill in is safe; a wrong one that looks filled in is not.
 */

/*
 * The entity list, labels, outcome and result shapes live in `sync-entities.ts`
 * and are re-exported here, so a caller can keep importing them from the engine
 * while the admin panel imports them without dragging Prisma into the browser.
 */
export {
  SYNC_ENTITIES,
  SYNC_ENTITY_LABELS,
  emptyBreakdown,
  type SyncEntity,
  type SyncOutcome,
  type SyncLogEntry,
  type SyncBreakdown,
  type SyncResult,
} from './sync-entities';

import {
  SYNC_ENTITIES,
  emptyBreakdown,
  type SyncEntity,
  type SyncOutcome,
  type SyncLogEntry,
  type SyncResult,
} from './sync-entities';

const EMPTY: SyncResult = {
  created: 0,
  updated: 0,
  skipped: 0,
  deletedLocally: 0,
  conflicts: 0,
  failed: 0,
  breakdown: emptyBreakdown(),
  log: [],
};

function tally(log: SyncLogEntry[]): SyncResult {
  const breakdown = emptyBreakdown();
  for (const entry of log) {
    const row = breakdown[entry.entity];
    if (entry.outcome === 'created') row.created += 1;
    else if (entry.outcome === 'skipped') row.skipped += 1;
    else if (entry.outcome === 'deleted-locally') row.deletedLocally += 1;
    else if (entry.outcome === 'conflict') row.conflicts += 1;
    else if (entry.outcome === 'failed') row.failed += 1;
  }

  const count = (outcome: SyncOutcome) => log.filter((entry) => entry.outcome === outcome).length;

  return {
    created: count('created'),
    updated: 0,
    skipped: count('skipped'),
    deletedLocally: count('deleted-locally'),
    conflicts: count('conflict'),
    failed: count('failed'),
    breakdown,
    log,
  };
}

/** Values that are about one market and cannot be carried into another. */
function localisationFlags(text: Array<string | null | undefined>): string[] {
  const joined = text.filter(Boolean).join(' ');
  const flags: string[] = [];
  if (/₹|\bINR\b|\brupee/i.test(joined)) flags.push('mentions rupees');
  if (/\bIndia\b|\bIndian\b/i.test(joined)) flags.push('mentions India');
  if (/\bGST\b|\bPAN\b|\bCIN\b/i.test(joined)) flags.push('mentions Indian tax or registration');
  if (/\+91[\s\d-]/.test(joined)) flags.push('contains an Indian phone number');
  return flags;
}

type Ctx = {
  source: CountryContext;
  target: CountryContext;
  previewOnly: boolean;
};

/** One entity's mappings, read once and held for the pass. */
type Mapping = {
  sourceId: string;
  targetId: string;
  deletedInTargetAt: Date | null;
};

/**
 * Runs the sync, or reports what it would do.
 *
 * A preview takes exactly the same decisions as a real run and writes nothing,
 * so the counts an administrator approves are the counts they get.
 *
 * The order is the dependency order: a page may sit in a category, a product
 * may carry a brand, a page section may embed a form. Whatever can be pointed
 * at is made available before the thing that points at it, so no pass can
 * create a reference to something that is not there yet.
 */
export async function runCountrySync(ctx: Ctx): Promise<SyncResult> {
  if (ctx.source.id === ctx.target.id) return EMPTY;

  const log: SyncLogEntry[] = [];

  await syncTaxonomy(ctx, log, 'PAGE_CATEGORY');
  await syncTaxonomy(ctx, log, 'PRODUCT_CATEGORY');
  await syncTaxonomy(ctx, log, 'BRAND');
  await syncForms(ctx, log);
  await syncProducts(ctx, log);
  await syncPages(ctx, log);
  await syncNavigation(ctx, log);
  await syncPopups(ctx, log);

  return tally(log);
}

// --- mappings ---------------------------------------------------------------

/**
 * Every mapping for one entity kind, in one query.
 *
 * Read once per pass rather than per item: a market with a thousand pages would
 * otherwise issue a thousand lookups to answer a question one query answers.
 */
async function mappings(ctx: Ctx, entity: SyncEntity): Promise<Map<string, Mapping>> {
  const rows = await prisma.countrySyncMapping.findMany({
    where: { targetCountryId: ctx.target.id, entityType: entity },
    select: { sourceId: true, targetId: true, deletedInTargetAt: true },
  });
  return new Map(rows.map((row) => [row.sourceId, row]));
}

async function remember(
  ctx: Ctx,
  entity: SyncEntity,
  sourceId: string,
  targetId: string,
  sourceUpdatedAt: Date | null,
  targetUpdatedAt: Date | null,
) {
  await prisma.countrySyncMapping.upsert({
    where: {
      targetCountryId_entityType_sourceId: {
        targetCountryId: ctx.target.id,
        entityType: entity,
        sourceId,
      },
    },
    // A fresh import clears any tombstone: the item is present again because
    // somebody asked for it, which is the one thing that should lift it.
    update: { targetId, sourceUpdatedAt, targetSyncedAt: targetUpdatedAt, deletedInTargetAt: null },
    create: {
      sourceCountryId: ctx.source.id,
      targetCountryId: ctx.target.id,
      entityType: entity,
      sourceId,
      targetId,
      sourceUpdatedAt,
      targetSyncedAt: targetUpdatedAt,
    },
  });
}

/**
 * Records that a previously imported copy is gone, and leaves it gone.
 *
 * Writing the tombstone rather than recreating the item is the single decision
 * that makes repeated syncing safe to press. It is also written on a preview —
 * noticing a deletion is an observation, not a change, and the note has to read
 * the same in the preview as in the run that follows it.
 */
async function tombstone(ctx: Ctx, entity: SyncEntity, sourceId: string): Promise<void> {
  await prisma.countrySyncMapping.updateMany({
    where: {
      targetCountryId: ctx.target.id,
      entityType: entity,
      sourceId,
      deletedInTargetAt: null,
    },
    data: { deletedInTargetAt: new Date() },
  });
}

const REMOVED_NOTE = 'Previously imported but manually removed from this country.';

// --- shared taxonomies ------------------------------------------------------

/**
 * Categories and brands, as availability rather than copies.
 *
 * The rows are shared: one "Cloud storage", one Dropbox. Copying them would
 * give each market its own spelling of the same thing and detach every product
 * that points at one. What a market needs is a record saying it offers them,
 * which is what this creates.
 *
 * A market that removed a category keeps it removed — the mapping remembers it
 * was once offered, and the absence of an availability row is the local
 * decision this must not overturn.
 */
async function syncTaxonomy(
  ctx: Ctx,
  log: SyncLogEntry[],
  entity: 'PAGE_CATEGORY' | 'PRODUCT_CATEGORY' | 'BRAND',
): Promise<void> {
  const sourceIds = await offeredInMarket(entity, ctx.source.id);
  if (sourceIds.length === 0) return;

  const [names, present, known] = await Promise.all([
    taxonomyNames(entity, sourceIds),
    offeredInMarket(entity, ctx.target.id),
    mappings(ctx, entity),
  ]);

  const alreadyOffered = new Set(present);
  const toOffer: string[] = [];

  for (const id of sourceIds) {
    const label = names.get(id) ?? id;
    const mapped = known.get(id);

    if (alreadyOffered.has(id)) {
      log.push({ entity, outcome: 'skipped', label, sourceId: id, targetId: id, note: 'Already available here' });
      continue;
    }

    if (mapped) {
      // Offered once, and not any more. That is a decision, not a gap.
      log.push({ entity, outcome: 'deleted-locally', label, sourceId: id, note: REMOVED_NOTE });
      if (!ctx.previewOnly) await tombstone(ctx, entity, id);
      continue;
    }

    log.push({ entity, outcome: 'created', label, sourceId: id, targetId: id });
    toOffer.push(id);
  }

  if (ctx.previewOnly || toOffer.length === 0) return;

  const kind = entity === 'BRAND' ? 'BRAND' : entity === 'PAGE_CATEGORY' ? 'PAGE_CATEGORY' : 'PRODUCT_CATEGORY';
  await offerIn(kind, toOffer, ctx.target.id);
  for (const id of toOffer) {
    // Source and target are the same shared row, so the mapping records that
    // this market was given it rather than pointing at a copy.
    await remember(ctx, entity, id, id, null, null);
  }
}

/** Which shared rows a market offers. */
async function offeredInMarket(
  entity: 'PAGE_CATEGORY' | 'PRODUCT_CATEGORY' | 'BRAND',
  countryId: string,
): Promise<string[]> {
  if (entity === 'BRAND') {
    const rows = await prisma.brandCountry.findMany({
      where: { countryId },
      select: { brandId: true },
    });
    return rows.map((row) => row.brandId);
  }
  if (entity === 'PAGE_CATEGORY') {
    const rows = await prisma.pageCategoryCountry.findMany({
      where: { countryId },
      select: { categoryId: true },
    });
    return rows.map((row) => row.categoryId);
  }
  const rows = await prisma.productCategoryCountry.findMany({
    where: { countryId },
    select: { categoryId: true },
  });
  return rows.map((row) => row.categoryId);
}

/** Names for the log, in one query per kind. */
async function taxonomyNames(
  entity: 'PAGE_CATEGORY' | 'PRODUCT_CATEGORY' | 'BRAND',
  ids: readonly string[],
): Promise<Map<string, string>> {
  const where = { id: { in: [...ids] } };
  const select = { id: true, name: true } as const;
  const rows =
    entity === 'BRAND'
      ? await prisma.brand.findMany({ where, select })
      : entity === 'PAGE_CATEGORY'
        ? await prisma.pageCategory.findMany({ where, select })
        : await prisma.productCategory.findMany({ where, select });
  return new Map(rows.map((row) => [row.id, row.name]));
}

// --- forms ------------------------------------------------------------------

/**
 * Forms restricted to the source market.
 *
 * A form with no country is already available everywhere, so copying it would
 * produce a second form doing the same job — it is reported as shared and left
 * alone.
 *
 * The copy starts with **no submissions**: only the definition is copied, and
 * submissions, leads, consent records and captured addresses belong to the
 * people who sent them, not to the form.
 */
async function syncForms(ctx: Ctx, log: SyncLogEntry[]): Promise<void> {
  const forms = await prisma.form.findMany({
    where: { countryId: ctx.source.id, deletedAt: null },
    include: { fields: { orderBy: { sortOrder: 'asc' } } },
  });

  const known = await mappings(ctx, 'FORM');
  const live = await liveTargets(
    'FORM',
    [...known.values()].map((row) => row.targetId),
  );

  for (const form of forms) {
    const existing = known.get(form.id);

    if (existing) {
      if (!live.has(existing.targetId)) {
        log.push({ entity: 'FORM', outcome: 'deleted-locally', label: form.name, sourceId: form.id, note: REMOVED_NOTE });
        if (!ctx.previewOnly) await tombstone(ctx, 'FORM', form.id);
        continue;
      }
      log.push({ entity: 'FORM', outcome: 'skipped', label: form.name, sourceId: form.id, targetId: existing.targetId, note: 'Already imported' });
      continue;
    }

    /*
     * The copy keeps the source's slug. Form slugs are unique per market, so
     * the UAE's copy of India's "contact" is also "contact" — no market carries
     * a name that exists only because another market got there first.
     *
     * A market that already has a form under that slug keeps it: the slug is
     * taken by something this market chose, and renaming either one to make
     * room would be a decision the sync is not entitled to make.
     */
    const slug = form.slug;
    const slugTaken = await prisma.form.findFirst({
      where: { countryId: ctx.target.id, slug },
      select: { id: true },
    });
    if (slugTaken) {
      log.push({
        entity: 'FORM',
        outcome: 'conflict',
        label: form.name,
        sourceId: form.id,
        targetId: slugTaken.id,
        note: `This market already has a form called “${slug}”. It was left alone.`,
      });
      continue;
    }

    log.push({
      entity: 'FORM',
      outcome: 'created',
      label: form.name,
      sourceId: form.id,
      localise: localisationFlags([form.name, form.description, form.consentText]),
    });

    if (ctx.previewOnly) continue;

    const created = await prisma.form.create({
      data: {
        name: form.name,
        slug,
        countryId: ctx.target.id,
        description: form.description,
        // Inactive on arrival, like a draft page: a form that starts taking
        // submissions before anyone has read it is worse than one that waits.
        isActive: false,
        submitLabel: form.submitLabel,
        successMessage: form.successMessage,
        redirectUrl: form.redirectUrl,
        leadSource: form.leadSource,
        createsLead: form.createsLead,
        consentText: form.consentText,
        lawfulBasis: form.lawfulBasis,
        collectsPersonalData: form.collectsPersonalData,
        offerMarketingConsent: form.offerMarketingConsent,
        requireTermsAcceptance: form.requireTermsAcceptance,
        consentCombinedLabel: form.consentCombinedLabel,
        requireCaptcha: form.requireCaptcha,
        // A null design means "use the defaults", which is what omitting it does.
        ...(form.design ? { design: form.design as Prisma.InputJsonValue } : {}),
        /*
         * Deliberately not copied: notifyEmails and defaultProductId. Sales
         * notifications go to the team that owns the market, and a default
         * product is a pricing decision. Nothing about submissions, leads or
         * consent records travels at all — the copy starts empty.
         */
        fields: {
          create: form.fields.map((field) => ({
            type: field.type,
            label: field.label,
            name: field.name,
            placeholder: field.placeholder,
            helpText: field.helpText,
            defaultValue: field.defaultValue,
            isRequired: field.isRequired,
            sortOrder: field.sortOrder,
            width: field.width,
            options: (field.options ?? []) as Prisma.InputJsonValue,
            minLength: field.minLength,
            maxLength: field.maxLength,
            pattern: field.pattern,
            showLabel: field.showLabel,
            isEnabled: field.isEnabled,
            isHidden: field.isHidden,
            isReadOnly: field.isReadOnly,
            colSpan: field.colSpan,
            cssClass: field.cssClass,
            settings: (field.settings ?? {}) as Prisma.InputJsonValue,
          })),
        },
      },
      select: { id: true, updatedAt: true },
    });
    await remember(ctx, 'FORM', form.id, created.id, form.updatedAt, created.updatedAt);
  }

  const shared = await prisma.form.count({ where: { countryId: null, deletedAt: null } });
  if (shared > 0) {
    log.push({
      entity: 'FORM',
      outcome: 'skipped',
      label: `${shared} shared form${shared === 1 ? '' : 's'}`,
      sourceId: '-',
      note: 'Available in every market already, so there is nothing to copy.',
    });
  }
}

/**
 * Which previously imported rows still exist, in one query per entity kind.
 *
 * The alternative is a `findUnique` per mapping inside the loop, which is the
 * N+1 this exists to avoid — and on a market with a few hundred imported items
 * it is the difference between one round trip and a few hundred.
 */
async function liveTargets(entity: SyncEntity, ids: readonly string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const where = { id: { in: [...ids] } };
  const select = { id: true } as const;

  const rows =
    entity === 'FORM'
      ? await prisma.form.findMany({ where: { ...where, deletedAt: null }, select })
      : entity === 'PAGE'
        ? await prisma.page.findMany({ where: { ...where, deletedAt: null }, select })
        : entity === 'PRODUCT'
          ? await prisma.productCountry.findMany({ where: { ...where, deletedAt: null }, select })
          : entity === 'NAVIGATION'
            ? await prisma.navigation.findMany({ where, select })
            : entity === 'POPUP'
              ? await prisma.popup.findMany({ where, select })
              : [];

  return new Set(rows.map((row) => row.id));
}

// --- products ---------------------------------------------------------------

/**
 * Products, as destination market configurations.
 *
 * The product row is global and shared, so nothing about it is duplicated —
 * what is created is the `ProductCountry` row that makes the product available
 * in this market, with its own status, order, SEO and pricing.
 *
 * The source set is the source market's **live** configurations. A product the
 * source market has withdrawn simply stops being a source product; it is not
 * removed from anywhere it has already been imported, because source absence is
 * never a reason to touch a destination.
 */
async function syncProducts(ctx: Ctx, log: SyncLogEntry[]): Promise<void> {
  const source = await prisma.productCountry.findMany({
    where: { countryId: ctx.source.id, deletedAt: null, product: { deletedAt: null } },
    include: { product: { select: { id: true, name: true } } },
  });
  if (source.length === 0) return;

  const [known, present] = await Promise.all([
    mappings(ctx, 'PRODUCT'),
    prisma.productCountry.findMany({
      where: { countryId: ctx.target.id, productId: { in: source.map((row) => row.productId) } },
      select: { id: true, productId: true, deletedAt: true, updatedAt: true },
    }),
  ]);

  const live = await liveTargets(
    'PRODUCT',
    [...known.values()].map((row) => row.targetId),
  );
  const byProduct = new Map(present.map((row) => [row.productId, row]));

  for (const row of source) {
    const label = row.product.name;
    const existing = known.get(row.id);

    if (existing) {
      if (!live.has(existing.targetId)) {
        log.push({ entity: 'PRODUCT', outcome: 'deleted-locally', label, sourceId: row.id, note: REMOVED_NOTE });
        if (!ctx.previewOnly) await tombstone(ctx, 'PRODUCT', row.id);
        continue;
      }
      log.push({ entity: 'PRODUCT', outcome: 'skipped', label, sourceId: row.id, targetId: existing.targetId, note: 'Already imported' });
      continue;
    }

    /*
     * The market may already offer the product without this ever having run —
     * somebody added it by hand. That is not a duplicate to create over, and it
     * is not an import either: the mapping records it so a later run recognises
     * it, and nothing about the row is touched.
     */
    const already = byProduct.get(row.productId);
    if (already && !already.deletedAt) {
      log.push({ entity: 'PRODUCT', outcome: 'skipped', label, sourceId: row.id, targetId: already.id, note: 'This market already offers the product.' });
      if (!ctx.previewOnly) {
        await remember(ctx, 'PRODUCT', row.id, already.id, row.updatedAt, already.updatedAt);
      }
      continue;
    }

    // Offered once and withdrawn here. Re-offering it would undo that.
    if (already?.deletedAt) {
      log.push({ entity: 'PRODUCT', outcome: 'deleted-locally', label, sourceId: row.id, targetId: already.id, note: REMOVED_NOTE });
      if (!ctx.previewOnly) await tombstone(ctx, 'PRODUCT', row.id);
      continue;
    }

    log.push({
      entity: 'PRODUCT',
      outcome: 'created',
      label,
      sourceId: row.id,
      localise: [
        `prices are not copied — set them in ${ctx.target.currency}`,
        ...localisationFlags([row.shortDescription, row.description, row.priceNote, row.ctaLabel]),
      ],
    });

    if (ctx.previewOnly) continue;

    /*
     * The market's configuration and the product's address there are created
     * together. When the address is already taken in this market — by a page,
     * say — nothing is created and the item is reported as a conflict, like
     * any other clash the sync refuses to resolve on its own.
     */
    let created: { id: string; updatedAt: Date };
    try {
      created = await prisma.$transaction(async (tx) => {
        const config = await tx.productCountry.create({
      data: {
        productId: row.productId,
        countryId: ctx.target.id,
        // Draft: imported content is never published on somebody's behalf.
        status: 'DRAFT',
        publishedAt: null,
        isFeatured: row.isFeatured,
        sortOrder: row.sortOrder,
        featuredOrder: row.featuredOrder,
        /*
         * The destination's own currency, with no prices.
         *
         * Copying 1250 from an INR row into an AED row would relabel the
         * number, not convert it. An empty price an administrator must fill in
         * is safe; a wrong one that looks filled in is not.
         */
        currency: ctx.target.currency,
        monthlyPrice: null,
        annualPrice: null,
        compareAtPrice: null,
        discountPercent: null,
        priceSuffix: row.priceSuffix,
        priceNote: null,
        shortDescription: row.shortDescription,
        description: row.description,
        ctaLabel: row.ctaLabel,
        ctaUrl: row.ctaUrl,
        seoTitle: row.seoTitle,
        seoDescription: row.seoDescription,
        ...keywordColumns(row),
        /*
         * `canonicalUrl` is deliberately left empty rather than copied: the
         * source value names a URL on the source market's site, and a page in
         * one market must never declare a page in another to be its canonical.
         * Empty lets this market's own canonical generator answer for it.
         *
         * `ctaFormId` is dropped too — it points at a form this market may not
         * have, and the form pass gives it its own copy.
         */
        noIndex: row.noIndex,
        // Media is shared, so the same row is referenced rather than copied —
        // no file is duplicated and none is at risk of being deleted from
        // under the market that still uses it.
        ogImageId: row.ogImageId,
      },
      select: { id: true, updatedAt: true },
        });
        await syncRoutes(tx, [{ type: 'PRODUCT', entityId: row.productId, countryId: ctx.target.id }], {
          actor: null,
          reason: 'CREATE',
        });
        return config;
      });
    } catch (error) {
      if (!(error instanceof UrlRegistryError)) throw error;
      retractCreated(log, row.id);
      log.push({ entity: 'PRODUCT', outcome: 'conflict', label, sourceId: row.id, note: error.message });
      continue;
    }
    await remember(ctx, 'PRODUCT', row.id, created.id, row.updatedAt, created.updatedAt);
  }
}

/** Takes back the "created" lines already logged for an item that was not created after all. */
function retractCreated(log: SyncLogEntry[], sourceId: string): void {
  for (let index = log.length - 1; index >= 0; index -= 1) {
    if (log[index]!.sourceId === sourceId && log[index]!.outcome === 'created') log.splice(index, 1);
  }
}

// --- pages ------------------------------------------------------------------

async function syncPages(ctx: Ctx, log: SyncLogEntry[]): Promise<void> {
  const pages = await prisma.page.findMany({
    // A city belongs to one market, and so do its pages: they are never
    // copied into another market, where no such city exists.
    where: { countryId: ctx.source.id, deletedAt: null, cityId: null },
    include: { sections: { orderBy: { sortOrder: 'asc' } } },
  });
  if (pages.length === 0) return;

  const [known, clashes] = await Promise.all([
    mappings(ctx, 'PAGE'),
    prisma.page.findMany({
      where: { countryId: ctx.target.id, deletedAt: null, slug: { in: pages.map((p) => p.slug) } },
      select: { id: true, slug: true },
    }),
  ]);

  const live = await liveTargets(
    'PAGE',
    [...known.values()].map((row) => row.targetId),
  );
  const bySlug = new Map(clashes.map((row) => [row.slug, row]));

  for (const page of pages) {
    const label = page.title;
    const existing = known.get(page.id);

    if (existing) {
      if (!live.has(existing.targetId)) {
        log.push({ entity: 'PAGE', outcome: 'deleted-locally', label, sourceId: page.id, note: REMOVED_NOTE });
        if (!ctx.previewOnly) await tombstone(ctx, 'PAGE', page.id);
        continue;
      }
      log.push({ entity: 'PAGE', outcome: 'skipped', label, sourceId: page.id, targetId: existing.targetId, note: 'Already imported' });
      continue;
    }

    // A page with this slug may already exist here — created by hand, or by a
    // run whose mapping was removed. Never overwrite it.
    const clash = bySlug.get(page.slug);
    if (clash) {
      log.push({
        entity: 'PAGE',
        outcome: 'conflict',
        label,
        sourceId: page.id,
        targetId: clash.id,
        note: `This market already has a page at “/${page.slug}”. It was left alone.`,
      });
      continue;
    }

    const sectionText = page.sections.map((section) => JSON.stringify(section.content));
    log.push({
      entity: 'PAGE',
      outcome: 'created',
      label,
      sourceId: page.id,
      localise: localisationFlags([page.title, page.seoDescription, ...sectionText]),
    });
    log.push({
      entity: 'PAGE_SECTION',
      outcome: 'created',
      label: `${page.sections.length} section${page.sections.length === 1 ? '' : 's'} of “${page.title}”`,
      sourceId: page.id,
    });

    if (ctx.previewOnly) continue;

    /*
     * The page and its sections in one transaction: a page that arrives without
     * its sections is a blank screen an administrator has to notice and delete,
     * and there is no reason to risk leaving one behind. Per page rather than
     * per run, so a large sync never holds one long lock over the whole table.
     */
    /*
     * The copy is the same page in another market, so it joins the source's
     * group — which is how the market switcher and hreflang pair them even if
     * either is later given a different URL — and its address is registered
     * in the same transaction. A copy whose address is taken in this market
     * is not created; it is reported as a conflict.
     */
    const groupKey = page.groupKey ?? page.id;
    let created: { id: string; updatedAt: Date };
    try {
      created = await prisma.$transaction(async (tx) => {
        if (!page.groupKey) await tx.page.update({ where: { id: page.id }, data: { groupKey } });
        const copy = await tx.page.create({
        data: {
          countryId: ctx.target.id,
          title: page.title,
          slug: page.slug,
          groupKey,
          landingCategoryId: page.landingCategoryId,
          landingBrandId: page.landingBrandId,
          // Draft, always. Imported content is reviewed before it is published,
          // which is also what keeps it out of the sitemaps until then.
          status: 'DRAFT',
          publishedAt: null,
          isHomepage: page.isHomepage,
          // The category is a shared row this market has just been given.
          categoryId: page.categoryId,
          showHeader: page.showHeader,
          showFooter: page.showFooter,
          seoTitle: page.seoTitle,
          seoDescription: page.seoDescription,
          ...keywordColumns(page),
          /*
           * `canonicalUrl` is left empty rather than copied. The source value
           * names a URL on the source market's site; keeping it would tell
           * search engines this market's page is a duplicate of India's and
           * should not be shown. Empty lets this market's own canonical
           * generator answer for it.
           */
          noIndex: page.noIndex,
          noFollow: page.noFollow,
          ogTitle: page.ogTitle,
          ogDescription: page.ogDescription,
          ogImageId: page.ogImageId,
          twitterTitle: page.twitterTitle,
          twitterDescription: page.twitterDescription,
          twitterImageId: page.twitterImageId,
          sections: {
            create: page.sections.map((section) => ({
              blockType: section.blockType,
              name: section.name,
              sortOrder: section.sortOrder,
              isVisible: section.isVisible,
              /*
               * Internal links are rewritten into the destination market by the
               * same function the renderer uses — so external URLs, anchors,
               * mailto/tel and the root-only blog links are all left exactly as
               * they are, because that function already knows which is which.
               */
              content: localiseContent(section.content, ctx.target) as Prisma.InputJsonValue,
              settings: (section.settings ?? {}) as Prisma.InputJsonValue,
            })),
          },
        },
        select: { id: true, updatedAt: true },
        });
        await syncRoutes(tx, [{ type: 'PAGE', entityId: copy.id, countryId: ctx.target.id }], {
          actor: null,
          reason: 'CREATE',
        });
        return copy;
      });
    } catch (error) {
      if (!(error instanceof UrlRegistryError)) throw error;
      retractCreated(log, page.id);
      log.push({ entity: 'PAGE', outcome: 'conflict', label, sourceId: page.id, note: error.message });
      continue;
    }
    await remember(ctx, 'PAGE', page.id, created.id, page.updatedAt, created.updatedAt);
  }
}

// --- navigation -------------------------------------------------------------

/**
 * Menus, with their items and their nesting.
 *
 * Menus are already per-market (`Navigation.countryId`), so these are real
 * copies. Item links are remapped rather than copied verbatim: a link to a
 * source-market page must point at *this* market's copy of that page, or the
 * menu leads visitors out of the market they are browsing.
 *
 * A link whose page has not been imported is dropped rather than left pointing
 * at the source — a missing menu entry is a gap an administrator can see and
 * fill, while a wrong one silently sends people to another market's site.
 */
async function syncNavigation(ctx: Ctx, log: SyncLogEntry[]): Promise<void> {
  const menus = await prisma.navigation.findMany({
    where: { countryId: ctx.source.id },
    include: { items: { orderBy: { sortOrder: 'asc' } } },
  });
  if (menus.length === 0) return;

  const [known, pageMap] = await Promise.all([
    mappings(ctx, 'NAVIGATION'),
    mappings(ctx, 'PAGE'),
  ]);
  const live = await liveTargets(
    'NAVIGATION',
    [...known.values()].map((row) => row.targetId),
  );

  // Source page id → this market's copy, for remapping internal links.
  const pageFor = new Map(
    [...pageMap.values()]
      .filter((row) => !row.deletedInTargetAt)
      .map((row) => [row.sourceId, row.targetId]),
  );

  for (const menu of menus) {
    const existing = known.get(menu.id);

    if (existing) {
      if (!live.has(existing.targetId)) {
        log.push({ entity: 'NAVIGATION', outcome: 'deleted-locally', label: menu.name, sourceId: menu.id, note: REMOVED_NOTE });
        if (!ctx.previewOnly) await tombstone(ctx, 'NAVIGATION', menu.id);
        continue;
      }
      log.push({ entity: 'NAVIGATION', outcome: 'skipped', label: menu.name, sourceId: menu.id, targetId: existing.targetId, note: 'Already imported' });
      continue;
    }

    const clash = await prisma.navigation.findUnique({
      where: { countryId_slug: { countryId: ctx.target.id, slug: menu.slug } },
      select: { id: true },
    });
    if (clash) {
      log.push({
        entity: 'NAVIGATION',
        outcome: 'conflict',
        label: menu.name,
        sourceId: menu.id,
        targetId: clash.id,
        note: `This market already has a “${menu.slug}” menu. It was left alone.`,
      });
      continue;
    }

    const dropped = menu.items.filter(
      (item) => item.pageId !== null && !pageFor.has(item.pageId),
    ).length;

    log.push({
      entity: 'NAVIGATION',
      outcome: 'created',
      label: menu.name,
      sourceId: menu.id,
      localise: dropped > 0 ? [`${dropped} link(s) dropped — their page is not in this market`] : undefined,
    });

    if (ctx.previewOnly) continue;

    const created = await prisma.$transaction(async (tx) => {
      const menuRow = await tx.navigation.create({
        data: {
          countryId: ctx.target.id,
          name: menu.name,
          slug: menu.slug,
          location: menu.location,
        },
        select: { id: true, updatedAt: true },
      });

      /*
       * Parents before children, so a child always has a parent id to point at.
       * Source item id → new item id, built as the top level is written.
       */
      const idFor = new Map<string, string>();
      const ordered = [...menu.items].sort((a, b) => Number(Boolean(a.parentId)) - Number(Boolean(b.parentId)));

      for (const item of ordered) {
        if (item.pageId && !pageFor.has(item.pageId)) continue;
        if (item.parentId && !idFor.has(item.parentId)) continue;

        const row = await tx.navigationItem.create({
          data: {
            navigationId: menuRow.id,
            parentId: item.parentId ? (idFor.get(item.parentId) ?? null) : null,
            label: item.label,
            linkType: item.linkType,
            url: item.url,
            // Remapped to this market's copy of the page.
            pageId: item.pageId ? (pageFor.get(item.pageId) ?? null) : null,
            // Products are one global row, so the id means the same everywhere.
            productId: item.productId,
            /*
             * Blog links are kept as they are. Articles live at the site root
             * only, and the link builder already leaves `/blog` unprefixed —
             * so a market's menu can point at the blog without this creating a
             * country-prefixed blog URL that would redirect.
             */
            blogPostId: item.blogPostId,
            blogCategoryId: item.blogCategoryId,
            description: item.description,
            icon: item.icon,
            openInNewTab: item.openInNewTab,
            isHighlighted: item.isHighlighted,
            sortOrder: item.sortOrder,
            isVisible: item.isVisible,
          },
          select: { id: true },
        });
        idFor.set(item.id, row.id);
      }

      return menuRow;
    });

    await remember(ctx, 'NAVIGATION', menu.id, created.id, menu.updatedAt, created.updatedAt);
  }
}

// --- popups -----------------------------------------------------------------

/**
 * Popups restricted to the source market.
 *
 * A popup with no market already shows everywhere, so copying it would show two
 * of the same thing. The copy arrives inactive and without its form link: the
 * form pass gives this market its own form, and pointing a UAE popup at an
 * Indian form would post UAE enquiries into India's lead list.
 */
async function syncPopups(ctx: Ctx, log: SyncLogEntry[]): Promise<void> {
  const popups = await prisma.popup.findMany({
    where: { countryId: ctx.source.id, deletedAt: null },
  });
  if (popups.length === 0) return;

  const known = await mappings(ctx, 'POPUP');
  const live = await liveTargets(
    'POPUP',
    [...known.values()].map((row) => row.targetId),
  );
  const formMap = await mappings(ctx, 'FORM');
  const formFor = new Map(
    [...formMap.values()].filter((row) => !row.deletedInTargetAt).map((row) => [row.sourceId, row.targetId]),
  );

  for (const popup of popups) {
    const existing = known.get(popup.id);

    if (existing) {
      if (!live.has(existing.targetId)) {
        log.push({ entity: 'POPUP', outcome: 'deleted-locally', label: popup.name, sourceId: popup.id, note: REMOVED_NOTE });
        if (!ctx.previewOnly) await tombstone(ctx, 'POPUP', popup.id);
        continue;
      }
      log.push({ entity: 'POPUP', outcome: 'skipped', label: popup.name, sourceId: popup.id, targetId: existing.targetId, note: 'Already imported' });
      continue;
    }

    log.push({
      entity: 'POPUP',
      outcome: 'created',
      label: popup.name,
      sourceId: popup.id,
      localise: localisationFlags([popup.heading, popup.body, popup.ctaLabel]),
    });

    if (ctx.previewOnly) continue;

    const created = await prisma.popup.create({
      data: {
        name: popup.name,
        type: popup.type,
        // Inactive on arrival: a popup that starts interrupting visitors before
        // anyone has read it is worse than one that waits.
        isActive: false,
        countryId: ctx.target.id,
        heading: popup.heading,
        body: popup.body,
        // Media is shared, so the same asset is referenced rather than copied.
        imageId: popup.imageId,
        // This market's own copy of the form, or none at all.
        formId: popup.formId ? (formFor.get(popup.formId) ?? null) : null,
        // Not copied: leadMagnetId points at a file offer this market may not run.
        ctaLabel: popup.ctaLabel,
        ctaUrl: popup.ctaUrl,
        trigger: popup.trigger,
        delaySeconds: popup.delaySeconds,
        scrollPercent: popup.scrollPercent,
        device: popup.device,
        frequencyDays: popup.frequencyDays,
        urlPatterns: (popup.urlPatterns ?? []) as Prisma.InputJsonValue,
        // Not copied: startsAt/endsAt are one market's campaign window.
      },
      select: { id: true, updatedAt: true },
    });
    await remember(ctx, 'POPUP', popup.id, created.id, popup.updatedAt, created.updatedAt);
  }
}

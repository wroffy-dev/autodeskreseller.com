import 'server-only';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { invalidateCountryCache, listCountries } from '@/lib/country/registry';
import type { CountryContext } from '@/lib/country/types';
import { siteUrl } from '@/lib/env';
import { entityKey } from './snapshot';
import {
  isExternalUrl,
  isReservedFirstSegment,
  joinMarket,
  pathKey,
  segmentsOf,
  splitDestinationSuffix,
  stripMarket,
  withSuffix,
} from './path';
import { listRegistrableContent, patternRelativePath, type ContentInfo } from './content';
import {
  bumpRegistryVersion,
  cityOfPath,
  isPageType,
  lockRegistry,
  placeContent,
  releaseContent,
  type Actor,
  type Tx,
} from './registry';
import { URL_TYPE_LABELS, type UrlContentType } from './types';
import { TAXONOMY_PREFIX } from '@/lib/cms/taxonomy-pages';

/**
 * The first scan, and every scan after it.
 *
 * Registers every public address exactly as the site serves it today, and
 * reports what it could not register instead of guessing. Idempotent: run it
 * once or ten times and the registry ends up the same, because it only ever
 *
 *  - registers content that has no route yet,
 *  - releases routes whose content no longer exists,
 *  - links category and brand landing pages to their taxonomy by id,
 *  - groups the same page across markets, and
 *  - imports redirect rules that have not been imported.
 *
 * It never moves a route that exists and never changes a public address.
 *
 * Before the registry is switched on it reproduces the old router's
 * precedence exactly: the blog and product routes win over a page with the
 * same path, and a page the old router could never reach — under /blog or
 * /products, under a system route, or behind a market prefix — is reported
 * as a collision rather than made reachable by the migration.
 */

export type ScanCollision = {
  type: UrlContentType;
  entityId: string;
  countryId: string;
  label: string;
  path: string;
  reason: 'taken' | 'reserved' | 'shadowed' | 'invalid';
  detail: string;
  editHref: string;
};

export type ScanRedirectIssue = {
  redirectId: string;
  source: string;
  reason: string;
};

export type ScanReport = {
  at: string;
  resolverEnabled: boolean;
  registered: number;
  alreadyRegistered: number;
  released: number;
  landingPagesLinked: number;
  pagesGrouped: number;
  redirects: { imported: number; claims: number; dormantMarkets: number; flattened: number };
  collisions: ScanCollision[];
  redirectIssues: ScanRedirectIssue[];
  totals: { content: number; routes: number };
};

const REPORT_LIMIT = 500;

/** Order in which content claims addresses, mirroring the old router's precedence. */
const CLAIM_ORDER: UrlContentType[] = [
  'BLOG_ARCHIVE',
  'BLOG_POST',
  'BLOG_CATEGORY',
  'BLOG_TAG',
  'PRODUCT',
  'CATEGORY_PAGE',
  'BRAND_PAGE',
  'PAGE',
];

/**
 * Whether the old router could ever have served this address. Only applied
 * before the registry is switched on, so the scan registers exactly what was
 * reachable and nothing more.
 */
function legacyShadow(info: ContentInfo, relative: string): string | null {
  const segments = segmentsOf(relative);
  if (isPageType(info.type)) {
    if (segments[0] === 'blog') return 'The blog routes answer every address under /blog, so this page has never been reachable.';
    if (segments[0] === 'products') return 'The product routes answer every address under /products, so this page has never been reachable.';
  }
  if (info.type === 'BLOG_POST' && (info.slug === 'category' || info.slug === 'tag')) {
    return `/blog/${info.slug} is reserved for blog ${info.slug} archives, so this article has never been reachable.`;
  }
  return null;
}

/** Carries a dry run's report out of the transaction it rolls back. */
class DryRun extends Error {
  constructor(readonly report: ScanReport) {
    super('dry run');
  }
}

/**
 * Runs the scan. With `dryRun` the whole scan runs — under the same lock,
 * against the same data — and is then rolled back, so the report says exactly
 * what a real scan would do and nothing is written.
 */
export async function runUrlScan(actor: Actor, options: { dryRun?: boolean } = {}): Promise<ScanReport> {
  invalidateCountryCache();
  const countries = await listCountries();
  const root = countries.find((country) => country.isDefault) ?? countries[0];
  if (!root) throw new Error('No market is configured.');

  try {
    return await scan(actor, countries, root, Boolean(options.dryRun));
  } catch (error) {
    if (error instanceof DryRun) return error.report;
    throw error;
  }
}

function scan(
  actor: Actor,
  countries: readonly CountryContext[],
  root: CountryContext,
  dryRun: boolean,
): Promise<ScanReport> {
  return prisma.$transaction(
    async (tx) => {
      await lockRegistry(tx);
      const settings = await tx.urlSettings.upsert({
        where: { id: 'singleton' },
        update: {},
        create: { id: 'singleton' },
      });

      const landingPagesLinked = await linkLandingPages(tx);
      const pagesGrouped = await groupPages(tx, root.id);

      const report: ScanReport = {
        at: new Date().toISOString(),
        resolverEnabled: settings.resolverEnabled,
        registered: 0,
        alreadyRegistered: 0,
        released: 0,
        landingPagesLinked,
        pagesGrouped,
        redirects: { imported: 0, claims: 0, dormantMarkets: 0, flattened: 0 },
        collisions: [],
        redirectIssues: [],
        totals: { content: 0, routes: 0 },
      };

      await registerContent(tx, report, countries, root, actor, settings.resolverEnabled);
      await importRedirects(tx, report, countries, root);

      report.totals.routes = await tx.urlRoute.count({ where: { kind: 'CONTENT' } });
      report.collisions = report.collisions.slice(0, REPORT_LIMIT);
      report.redirectIssues = report.redirectIssues.slice(0, REPORT_LIMIT);

      if (dryRun) throw new DryRun(report);
      await tx.urlSettings.update({
        where: { id: 'singleton' },
        data: { lastScanAt: new Date(), lastScan: report as unknown as Prisma.InputJsonValue },
      });
      await bumpRegistryVersion(tx);
      return report;
    },
    { timeout: 300_000, maxWait: 20_000 },
  );
}

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

async function registerContent(
  tx: Tx,
  report: ScanReport,
  countries: readonly CountryContext[],
  root: CountryContext,
  actor: Actor,
  resolverEnabled: boolean,
): Promise<void> {
  const [content, routes, patternRows] = await Promise.all([
    listRegistrableContent({ rootCountryId: root.id }, tx),
    tx.urlRoute.findMany({
      where: { kind: 'CONTENT' },
      select: { id: true, entityId: true, countryId: true, path: true, type: true },
    }),
    tx.urlPattern.findMany({ select: { scopeKey: true, pattern: true } }),
  ]);
  report.totals.content = content.length;
  const patterns = { patterns: new Map(patternRows.map((row) => [row.scopeKey, row.pattern])) };
  const prefixes = countries.map((country) => country.slug).filter(Boolean);

  const wanted = new Set(content.map((info) => entityKey(info.entityId, info.countryId)));
  const registered = new Set<string>();

  // Routes whose content is gone: release them, so the address is free.
  for (const route of routes) {
    const key = entityKey(route.entityId ?? '', route.countryId);
    if (wanted.has(key)) {
      registered.add(key);
      continue;
    }
    await releaseContent(tx, {
      entityId: route.entityId ?? '',
      countryId: route.countryId,
      label: route.path,
      reason: 'DELETE',
      actor,
    });
    report.released += 1;
  }

  const ordered = [...content].sort(
    (a, b) => CLAIM_ORDER.indexOf(a.type) - CLAIM_ORDER.indexOf(b.type),
  );

  for (const info of ordered) {
    const key = entityKey(info.entityId, info.countryId);
    if (registered.has(key)) {
      report.alreadyRegistered += 1;
      continue;
    }
    const market = countries.find((country) => country.id === info.countryId);
    if (!market) continue;

    const patternRel = patternRelativePath(info, patterns);
    const relative = isPageType(info.type) ? `/${info.pageSlug ?? ''}` : patternRel;
    const path = joinMarket(market.slug, relative);

    const collide = (reason: ScanCollision['reason'], detail: string) =>
      report.collisions.push({
        type: info.type,
        entityId: info.entityId,
        countryId: info.countryId,
        label: info.label,
        path,
        reason,
        detail,
        editHref: info.editHref,
      });

    if (!pathKey(path)) {
      collide('invalid', 'The address is not a valid URL path.');
      continue;
    }
    const first = segmentsOf(relative)[0];
    if (first && isReservedFirstSegment(first, { marketPrefixes: prefixes })) {
      collide(
        'reserved',
        prefixes.includes(first)
          ? `“/${first}” is a market prefix, so this address has always belonged to that market.`
          : `“/${first}” is a system route, so this address has never reached the content.`,
      );
      continue;
    }
    if (!resolverEnabled) {
      const shadow = legacyShadow(info, relative);
      if (shadow) {
        collide('shadowed', shadow);
        continue;
      }
    }

    const result = await placeContent(tx, {
      type: info.type,
      entityId: info.entityId,
      countryId: info.countryId,
      marketSlug: market.slug,
      relativePath: relative,
      mode: isPageType(info.type) && relative !== patternRel ? 'CUSTOM' : 'PATTERN',
      label: info.label,
      wasPublished: false,
      reason: 'BACKFILL',
      actor,
    });
    if (result.ok) {
      registered.add(key);
      report.registered += result.created ? 1 : 0;
    } else {
      collide('taken', result.owner ? `Already used by ${result.owner.description} at ${result.owner.path}.` : result.message);
    }
  }
}

// ---------------------------------------------------------------------------
// Landing pages and page groups
// ---------------------------------------------------------------------------

/**
 * Links each generated category and brand page to its taxonomy by id.
 *
 * Until now a product page found its category's page by assuming its URL was
 * `/categories/<slug>`. That assumption is recorded once, here, as an id —
 * after which the page can be renamed and the taxonomy re-slugged without the
 * link breaking.
 */
async function linkLandingPages(tx: Tx): Promise<number> {
  const [categories, brands, pages] = await Promise.all([
    tx.productCategory.findMany({ where: { deletedAt: null }, select: { id: true, slug: true } }),
    tx.brand.findMany({ where: { deletedAt: null }, select: { id: true, slug: true } }),
    tx.page.findMany({
      where: { deletedAt: null },
      select: { id: true, countryId: true, slug: true, landingCategoryId: true, landingBrandId: true },
    }),
  ]);

  const taken = new Set(
    pages.flatMap((page) => [
      page.landingCategoryId ? `c|${page.countryId}|${page.landingCategoryId}` : '',
      page.landingBrandId ? `b|${page.countryId}|${page.landingBrandId}` : '',
    ]),
  );
  const categoryBySlug = new Map(categories.map((row) => [row.slug, row.id]));
  const brandBySlug = new Map(brands.map((row) => [row.slug, row.id]));

  let linked = 0;
  for (const page of pages) {
    if (page.landingCategoryId || page.landingBrandId) continue;
    const [prefix, slug, ...rest] = page.slug.split('/');
    if (!slug || rest.length > 0) continue;

    if (prefix === TAXONOMY_PREFIX.category) {
      const id = categoryBySlug.get(slug);
      if (!id || taken.has(`c|${page.countryId}|${id}`)) continue;
      await tx.page.update({ where: { id: page.id }, data: { landingCategoryId: id } });
      taken.add(`c|${page.countryId}|${id}`);
      linked += 1;
    } else if (prefix === TAXONOMY_PREFIX.brand) {
      const id = brandBySlug.get(slug);
      if (!id || taken.has(`b|${page.countryId}|${id}`)) continue;
      await tx.page.update({ where: { id: page.id }, data: { landingBrandId: id } });
      taken.add(`b|${page.countryId}|${id}`);
      linked += 1;
    }
  }
  return linked;
}

/**
 * Groups the same page across markets.
 *
 * Until now "the UAE's version of this page" meant "the UAE page with the
 * same slug". That is recorded as a shared group key, so the equivalence
 * survives either page being given a different URL.
 */
async function groupPages(tx: Tx, rootId: string): Promise<number> {
  const pages = await tx.page.findMany({
    where: { deletedAt: null },
    select: { id: true, countryId: true, slug: true, groupKey: true },
    orderBy: { createdAt: 'asc' },
  });

  const groupBySlug = new Map<string, string>();
  // Existing groups first, so a re-run joins them rather than starting anew.
  for (const page of pages) {
    if (page.groupKey && !groupBySlug.has(page.slug)) groupBySlug.set(page.slug, page.groupKey);
  }
  // The root market's page names the group where there is one.
  for (const page of pages) {
    if (!groupBySlug.has(page.slug) && page.countryId === rootId) groupBySlug.set(page.slug, page.id);
  }

  const assignments = new Map<string, string[]>();
  for (const page of pages) {
    if (page.groupKey) continue;
    const group = groupBySlug.get(page.slug) ?? page.id;
    groupBySlug.set(page.slug, group);
    assignments.set(group, [...(assignments.get(group) ?? []), page.id]);
  }

  let grouped = 0;
  for (const [group, ids] of assignments) {
    const result = await tx.page.updateMany({ where: { id: { in: ids } }, data: { groupKey: group } });
    grouped += result.count;
  }
  return grouped;
}

// ---------------------------------------------------------------------------
// Redirects
// ---------------------------------------------------------------------------

function siteHosts(): Set<string> {
  try {
    const host = new URL(siteUrl()).hostname.toLowerCase();
    const bare = host.replace(/^www\./, '');
    return new Set([host, bare, `www.${bare}`]);
  } catch {
    return new Set();
  }
}

/**
 * Brings rules written before the registry into it, keeping what each one
 * did: a rule for `/ae/old` answers that one address; a rule for `/old`
 * answered under every market prefix wherever there was no content, so it is
 * claimed in every market where the address is still free. Where content owns
 * the address the rule stays dormant there, exactly as it always was.
 *
 * A destination that is some content's current address is recorded as that
 * content, so the rule follows it if it ever moves; a destination that is
 * itself a redirect is followed to where it ends, so no rule is imported as
 * the first link of a chain.
 */
async function importRedirects(
  tx: Tx,
  report: ScanReport,
  countries: readonly CountryContext[],
  root: CountryContext,
): Promise<void> {
  const rules = await tx.redirect.findMany({
    where: { origin: 'MANUAL', claims: { none: {} } },
    orderBy: { createdAt: 'asc' },
  });
  if (rules.length === 0) return;

  const hosts = siteHosts();
  const active = countries.filter((country) => country.isActive || country.isDefault);

  for (const rule of rules) {
    // Rules that were already looked at and left dormant are not re-reported.
    let source = rule.source.trim();
    if (isExternalUrl(source)) {
      let url: URL | null = null;
      try {
        url = new URL(source);
      } catch {
        url = null;
      }
      if (!url || !hosts.has(url.hostname.toLowerCase())) {
        report.redirectIssues.push({
          redirectId: rule.id,
          source: rule.source,
          reason: 'The source is another site’s URL. Redirects match addresses on this site only.',
        });
        continue;
      }
      if (url.pathname === '/' || url.pathname === '') {
        report.redirectIssues.push({
          redirectId: rule.id,
          source: rule.source,
          reason:
            'The source is a whole domain. Redirects match paths, not hosts; the site address in the environment decides which host is canonical, and the other one is redirected to it automatically.',
        });
        continue;
      }
      source = url.pathname;
    }

    const key = pathKey(source.startsWith('/') ? source : `/${source}`);
    if (!key) {
      report.redirectIssues.push({ redirectId: rule.id, source: rule.source, reason: 'The source is not a valid path.' });
      continue;
    }

    const first = segmentsOf(key)[0] ?? '';
    const market = countries.find((country) => country.slug && country.slug === first);
    const targets = market
      ? [{ country: market, key }]
      : active.map((country) => ({ country, key: pathKey(joinMarket(country.slug, key))! }));

    // Destination: content by identity where possible, following chains.
    const resolved = await resolveImportedDestination(tx, rule.destination);
    if (resolved.flattened) report.redirects.flattened += 1;

    let claims = 0;
    for (const target of targets) {
      const existing = await tx.urlRoute.findUnique({ where: { pathKey: target.key } });
      if (existing) {
        report.redirects.dormantMarkets += 1;
        continue;
      }
      if (resolved.targetKey === target.key) continue;
      // A city's own address is its pages' alone: a manual rule there stays
      // dormant rather than being registered over it.
      const relative = stripMarket(target.country.slug, target.key);
      if (segmentsOf(relative).length === 1 && (await cityOfPath(tx, target.country.id, relative))) {
        report.redirects.dormantMarkets += 1;
        continue;
      }
      await tx.urlRoute.create({
        data: {
          kind: 'REDIRECT',
          path: target.key,
          pathKey: target.key,
          countryId: target.country.id,
          redirectId: rule.id,
        },
      });
      claims += 1;
    }

    await tx.redirect.update({
      where: { id: rule.id },
      data: {
        countryId: market?.id ?? root.id,
        allMarkets: !market,
        // A chain that ended off-site is imported pointing at where it ended.
        ...(resolved.flattened && !resolved.target && resolved.finalDestination
          ? { destination: resolved.finalDestination }
          : {}),
        ...(resolved.target
          ? {
              targetType: resolved.target.type,
              targetEntityId: resolved.target.entityId,
              targetCountryId: resolved.target.countryId,
              destinationSuffix: resolved.suffix,
            }
          : {}),
      },
    });

    if (claims > 0) {
      report.redirects.imported += 1;
      report.redirects.claims += claims;
    } else {
      report.redirectIssues.push({
        redirectId: rule.id,
        source: rule.source,
        reason: 'Every address this rule covers is owned by content, so it has never fired. It is kept, dormant.',
      });
    }
  }
}

type ImportedDestination = {
  target: { type: UrlContentType; entityId: string; countryId: string } | null;
  targetKey: string | null;
  flattened: boolean;
  /** Where a followed chain finally ends, when that is not content. */
  finalDestination: string | null;
  /** With a target: the destination's own query string and fragment. */
  suffix: string | null;
};

async function resolveImportedDestination(tx: Tx, destination: string): Promise<ImportedDestination> {
  if (isExternalUrl(destination)) {
    return { target: null, targetKey: null, flattened: false, finalDestination: destination, suffix: null };
  }
  // The rule's own query string and fragment travel with it to wherever the
  // chain ends.
  const written = splitDestinationSuffix(destination.startsWith('/') ? destination : `/${destination}`);
  let current = written.path;
  let suffix = written.suffix;
  let key = pathKey(current);
  let flattened = false;
  const seen = new Set<string>();
  for (let hop = 0; key && hop < 10 && !seen.has(key); hop += 1) {
    seen.add(key);
    const claim = await tx.urlRoute.findUnique({ where: { pathKey: key }, include: { redirect: true } });
    if (!claim) return { target: null, targetKey: key, flattened, finalDestination: withSuffix(current, suffix), suffix: null };
    if (claim.kind === 'CONTENT' && claim.type && claim.entityId) {
      return {
        target: { type: claim.type as UrlContentType, entityId: claim.entityId, countryId: claim.countryId },
        targetKey: key,
        flattened,
        finalDestination: withSuffix(claim.path, suffix),
        suffix,
      };
    }
    const next = claim.redirect;
    if (!next) return { target: null, targetKey: key, flattened, finalDestination: withSuffix(current, suffix), suffix: null };
    flattened = true;
    if (next.targetEntityId && next.targetCountryId && next.targetType) {
      const kept = suffix ?? next.destinationSuffix ?? null;
      return {
        target: {
          type: next.targetType as UrlContentType,
          entityId: next.targetEntityId,
          countryId: next.targetCountryId,
        },
        targetKey: key,
        flattened,
        finalDestination: withSuffix(splitDestinationSuffix(next.destination).path, kept),
        suffix: kept,
      };
    }
    if (isExternalUrl(next.destination)) {
      return { target: null, targetKey: null, flattened, finalDestination: next.destination, suffix: null };
    }
    const followed = splitDestinationSuffix(next.destination);
    current = followed.path;
    suffix = suffix ?? followed.suffix;
    key = pathKey(current);
  }
  return { target: null, targetKey: key, flattened, finalDestination: withSuffix(current, suffix), suffix: null };
}

/** A human line for a collision's type, used by the report screens. */
export function collisionTypeLabel(type: UrlContentType): string {
  return URL_TYPE_LABELS[type];
}

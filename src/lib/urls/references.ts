import 'server-only';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { listCountries } from '@/lib/country/registry';
import type { CountryContext } from '@/lib/country/types';
import { siteUrl } from '@/lib/env';
import { recordAudit } from '@/lib/services/audit';
import type { SessionUser } from '@/lib/auth/guards';
import { joinMarket, pathKey, segmentsOf, stripMarket } from './path';

/**
 * Links stored in content, found and updated precisely.
 *
 * When an address moves, the old one keeps working through its redirect, and
 * links typed into content are rendered at the new address anyway. This is
 * for putting the stored copy right as well: it finds every reference to an
 * old address, shows it, and rewrites exactly those references — a link field
 * whose whole value is the address, or an `href`/`src` attribute in rich text
 * — and nothing else. Prose that merely mentions a path is never touched.
 *
 * Canonical overrides are found too, but only ever reported for review: an
 * explicit canonical is somebody's deliberate SEO decision, so it is updated
 * one at a time, on purpose, never swept along with the links.
 */

export type AddressChange = { oldPath: string; newPath: string; countryId: string };

export type ReferenceKind = 'link' | 'canonical';

export type Reference = {
  /** `${table}:${recordId}:${field}` */
  id: string;
  table: string;
  recordId: string;
  field: string;
  label: string;
  editHref: string | null;
  kind: ReferenceKind;
  matches: Array<{ before: string; after: string }>;
  /** The field's value when found, so a stale preview never overwrites a newer edit. */
  fingerprint: string;
};

type Market = Pick<CountryContext, 'id' | 'slug' | 'isDefault'>;

type Source = {
  table: string;
  field: string;
  kind: ReferenceKind;
  json?: boolean;
  html?: boolean;
  load: (needles: string[]) => Promise<
    Array<{ id: string; value: unknown; countryId: string | null; label: string; editHref: string | null }>
  >;
  save: (id: string, value: unknown) => Promise<unknown>;
};

const fingerprintOf = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex').slice(0, 16);

const ILIKE_LIMIT = 2_000;

/** Raw-SQL pre-filter for JSON columns: rows whose text mentions any needle. */
function jsonFilter(column: 'content', needles: string[]): Prisma.Sql {
  const patterns = needles.map((needle) => `%${needle.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  return Prisma.sql`${Prisma.raw(`"${column}"`)}::text ILIKE ANY(${patterns})`;
}

const containsAny = (field: string, needles: string[]) => ({
  OR: needles.map((needle) => ({ [field]: { contains: needle, mode: 'insensitive' as const } })),
});

function sources(): Source[] {
  const link = (table: string, field: string, extra: Partial<Source>, rest: Omit<Source, 'table' | 'field' | 'kind'>): Source => ({
    table,
    field,
    kind: 'link',
    ...extra,
    ...rest,
  });
  const canonical = (table: string, rest: Omit<Source, 'table' | 'field' | 'kind'>): Source => ({
    table,
    field: 'canonicalUrl',
    kind: 'canonical',
    ...rest,
  });

  return [
    link('PageSection', 'content', { json: true }, {
      load: async (needles) => {
        const rows = await prisma.$queryRaw<Array<{ id: string; content: unknown; pageId: string }>>(
          Prisma.sql`SELECT id, content, "pageId" FROM "PageSection" WHERE ${jsonFilter('content', needles)} LIMIT ${ILIKE_LIMIT}`,
        );
        const pages = await prisma.page.findMany({
          where: { id: { in: rows.map((row) => row.pageId) }, deletedAt: null },
          select: { id: true, title: true, countryId: true },
        });
        return rows.flatMap((row) => {
          const page = pages.find((entry) => entry.id === row.pageId);
          return page
            ? [{ id: row.id, value: row.content, countryId: page.countryId, label: `Page “${page.title}”`, editHref: `/admin/pages/${page.id}` }]
            : [];
        });
      },
      save: (id, value) => prisma.pageSection.update({ where: { id }, data: { content: value as Prisma.InputJsonValue } }),
    }),
    link('ProductSection', 'content', { json: true }, {
      load: async (needles) => {
        const rows = await prisma.$queryRaw<Array<{ id: string; content: unknown; productId: string }>>(
          Prisma.sql`SELECT id, content, "productId" FROM "ProductSection" WHERE ${jsonFilter('content', needles)} LIMIT ${ILIKE_LIMIT}`,
        );
        const products = await prisma.product.findMany({
          where: { id: { in: rows.map((row) => row.productId) } },
          select: { id: true, name: true },
        });
        return rows.map((row) => {
          const product = products.find((entry) => entry.id === row.productId);
          return {
            id: row.id,
            value: row.content,
            countryId: null,
            label: `Product page “${product?.name ?? 'Product'}”`,
            editHref: `/admin/products/${row.productId}/layout`,
          };
        });
      },
      save: (id, value) => prisma.productSection.update({ where: { id }, data: { content: value as Prisma.InputJsonValue } }),
    }),
    link('BlogSection', 'content', { json: true }, {
      load: async (needles) => {
        const rows = await prisma.$queryRaw<Array<{ id: string; content: unknown; postId: string | null }>>(
          Prisma.sql`SELECT id, content, "postId" FROM "BlogSection" WHERE ${jsonFilter('content', needles)} LIMIT ${ILIKE_LIMIT}`,
        );
        return rows.map((row) => ({
          id: row.id,
          value: row.content,
          countryId: null,
          label: row.postId ? 'Article sidebar' : 'Blog layout',
          editHref: row.postId ? `/admin/blog/${row.postId}` : '/admin/blog/layout',
        }));
      },
      save: (id, value) => prisma.blogSection.update({ where: { id }, data: { content: value as Prisma.InputJsonValue } }),
    }),
    link('BlogPost', 'content', { html: true }, {
      load: async (needles) =>
        (
          await prisma.blogPost.findMany({
            where: { deletedAt: null, ...containsAny('content', needles) },
            select: { id: true, title: true, content: true, countryId: true },
            take: ILIKE_LIMIT,
          })
        ).map((row) => ({ id: row.id, value: row.content, countryId: row.countryId, label: `Article “${row.title}”`, editHref: `/admin/blog/${row.id}` })),
      save: (id, value) => prisma.blogPost.update({ where: { id }, data: { content: String(value) } }),
    }),
    link('Product', 'description', { html: true }, {
      load: async (needles) =>
        (
          await prisma.product.findMany({
            where: { deletedAt: null, ...containsAny('description', needles) },
            select: { id: true, name: true, description: true },
            take: ILIKE_LIMIT,
          })
        ).map((row) => ({ id: row.id, value: row.description, countryId: null, label: `Product “${row.name}” description`, editHref: `/admin/products/${row.id}` })),
      save: (id, value) => prisma.product.update({ where: { id }, data: { description: String(value) } }),
    }),
    link('Product', 'ctaUrl', {}, {
      load: async (needles) =>
        (
          await prisma.product.findMany({
            where: { deletedAt: null, ...containsAny('ctaUrl', needles) },
            select: { id: true, name: true, ctaUrl: true },
            take: ILIKE_LIMIT,
          })
        ).map((row) => ({ id: row.id, value: row.ctaUrl, countryId: null, label: `Product “${row.name}” call to action`, editHref: `/admin/products/${row.id}` })),
      save: (id, value) => prisma.product.update({ where: { id }, data: { ctaUrl: String(value) } }),
    }),
    link('ProductCountry', 'description', { html: true }, {
      load: async (needles) =>
        (
          await prisma.productCountry.findMany({
            where: { deletedAt: null, ...containsAny('description', needles) },
            select: { id: true, countryId: true, description: true, product: { select: { id: true, name: true } } },
            take: ILIKE_LIMIT,
          })
        ).map((row) => ({ id: row.id, value: row.description, countryId: row.countryId, label: `Product “${row.product.name}” market description`, editHref: `/admin/products/${row.product.id}` })),
      save: (id, value) => prisma.productCountry.update({ where: { id }, data: { description: String(value) } }),
    }),
    link('ProductCountry', 'ctaUrl', {}, {
      load: async (needles) =>
        (
          await prisma.productCountry.findMany({
            where: { deletedAt: null, ...containsAny('ctaUrl', needles) },
            select: { id: true, countryId: true, ctaUrl: true, product: { select: { id: true, name: true } } },
            take: ILIKE_LIMIT,
          })
        ).map((row) => ({ id: row.id, value: row.ctaUrl, countryId: row.countryId, label: `Product “${row.product.name}” market call to action`, editHref: `/admin/products/${row.product.id}` })),
      save: (id, value) => prisma.productCountry.update({ where: { id }, data: { ctaUrl: String(value) } }),
    }),
    link('NavigationItem', 'url', {}, {
      load: async (needles) =>
        (
          await prisma.navigationItem.findMany({
            where: containsAny('url', needles),
            select: { id: true, label: true, url: true, navigation: { select: { id: true, name: true, countryId: true } } },
            take: ILIKE_LIMIT,
          })
        ).map((row) => ({
          id: row.id,
          value: row.url,
          countryId: row.navigation.countryId,
          label: `Menu “${row.navigation.name}” → “${row.label}”`,
          editHref: `/admin/navigation`,
        })),
      save: (id, value) => prisma.navigationItem.update({ where: { id }, data: { url: String(value) } }),
    }),
    link('Popup', 'ctaUrl', {}, {
      load: async (needles) =>
        (
          await prisma.popup.findMany({
            where: { deletedAt: null, ...containsAny('ctaUrl', needles) },
            select: { id: true, name: true, ctaUrl: true, countryId: true },
            take: ILIKE_LIMIT,
          })
        ).map((row) => ({ id: row.id, value: row.ctaUrl, countryId: row.countryId, label: `Popup “${row.name}”`, editHref: `/admin/popups` })),
      save: (id, value) => prisma.popup.update({ where: { id }, data: { ctaUrl: String(value) } }),
    }),
    link('Popup', 'body', { html: true }, {
      load: async (needles) =>
        (
          await prisma.popup.findMany({
            where: { deletedAt: null, ...containsAny('body', needles) },
            select: { id: true, name: true, body: true, countryId: true },
            take: ILIKE_LIMIT,
          })
        ).map((row) => ({ id: row.id, value: row.body, countryId: row.countryId, label: `Popup “${row.name}” text`, editHref: `/admin/popups` })),
      save: (id, value) => prisma.popup.update({ where: { id }, data: { body: String(value) } }),
    }),
    link('WebsiteSettings', 'headerCtaUrl', {}, websiteField('headerCtaUrl', 'Header button')),
    link('WebsiteSettings', 'headerSecondaryCtaUrl', {}, websiteField('headerSecondaryCtaUrl', 'Header secondary button')),
    link('WebsiteSettings', 'announcementUrl', {}, websiteField('announcementUrl', 'Announcement bar')),
    link('CountrySettings', 'headerCtaUrl', {}, {
      load: async (needles) =>
        (
          await prisma.countrySettings.findMany({
            where: containsAny('headerCtaUrl', needles),
            select: { id: true, countryId: true, headerCtaUrl: true, country: { select: { name: true } } },
          })
        ).map((row) => ({ id: row.id, value: row.headerCtaUrl, countryId: row.countryId, label: `${row.country.name} header button`, editHref: '/admin/settings' })),
      save: (id, value) => prisma.countrySettings.update({ where: { id }, data: { headerCtaUrl: String(value) } }),
    }),
    link('Form', 'redirectUrl', {}, {
      load: async (needles) =>
        (
          await prisma.form.findMany({
            where: containsAny('redirectUrl', needles),
            select: { id: true, name: true, redirectUrl: true, countryId: true },
            take: ILIKE_LIMIT,
          })
        ).map((row) => ({ id: row.id, value: row.redirectUrl, countryId: row.countryId, label: `Form “${row.name}” thank-you redirect`, editHref: `/admin/forms/${row.id}` })),
      save: (id, value) => prisma.form.update({ where: { id }, data: { redirectUrl: String(value) } }),
    }),
    canonical('Page', {
      load: async (needles) =>
        (
          await prisma.page.findMany({
            where: { deletedAt: null, ...containsAny('canonicalUrl', needles) },
            select: { id: true, title: true, canonicalUrl: true, countryId: true },
            take: ILIKE_LIMIT,
          })
        ).map((row) => ({ id: row.id, value: row.canonicalUrl, countryId: row.countryId, label: `Page “${row.title}” canonical`, editHref: `/admin/pages/${row.id}` })),
      save: (id, value) => prisma.page.update({ where: { id }, data: { canonicalUrl: String(value) } }),
    }),
    canonical('BlogPost', {
      load: async (needles) =>
        (
          await prisma.blogPost.findMany({
            where: { deletedAt: null, ...containsAny('canonicalUrl', needles) },
            select: { id: true, title: true, canonicalUrl: true, countryId: true },
            take: ILIKE_LIMIT,
          })
        ).map((row) => ({ id: row.id, value: row.canonicalUrl, countryId: row.countryId, label: `Article “${row.title}” canonical`, editHref: `/admin/blog/${row.id}` })),
      save: (id, value) => prisma.blogPost.update({ where: { id }, data: { canonicalUrl: String(value) } }),
    }),
    canonical('Product', {
      load: async (needles) =>
        (
          await prisma.product.findMany({
            where: { deletedAt: null, ...containsAny('canonicalUrl', needles) },
            select: { id: true, name: true, canonicalUrl: true },
            take: ILIKE_LIMIT,
          })
        ).map((row) => ({ id: row.id, value: row.canonicalUrl, countryId: null, label: `Product “${row.name}” canonical`, editHref: `/admin/products/${row.id}` })),
      save: (id, value) => prisma.product.update({ where: { id }, data: { canonicalUrl: String(value) } }),
    }),
    canonical('ProductCountry', {
      load: async (needles) =>
        (
          await prisma.productCountry.findMany({
            where: { deletedAt: null, ...containsAny('canonicalUrl', needles) },
            select: { id: true, canonicalUrl: true, countryId: true, product: { select: { id: true, name: true } } },
            take: ILIKE_LIMIT,
          })
        ).map((row) => ({ id: row.id, value: row.canonicalUrl, countryId: row.countryId, label: `Product “${row.product.name}” market canonical`, editHref: `/admin/products/${row.product.id}` })),
      save: (id, value) => prisma.productCountry.update({ where: { id }, data: { canonicalUrl: String(value) } }),
    }),
    canonical('BlogCategory', {
      load: async (needles) =>
        (
          await prisma.blogCategory.findMany({
            where: containsAny('canonicalUrl', needles),
            select: { id: true, name: true, canonicalUrl: true },
            take: ILIKE_LIMIT,
          })
        ).map((row) => ({ id: row.id, value: row.canonicalUrl, countryId: null, label: `Blog category “${row.name}” canonical`, editHref: '/admin/blog/categories' })),
      save: (id, value) => prisma.blogCategory.update({ where: { id }, data: { canonicalUrl: String(value) } }),
    }),
    canonical('BlogTag', {
      load: async (needles) =>
        (
          await prisma.blogTag.findMany({
            where: containsAny('canonicalUrl', needles),
            select: { id: true, name: true, canonicalUrl: true },
            take: ILIKE_LIMIT,
          })
        ).map((row) => ({ id: row.id, value: row.canonicalUrl, countryId: null, label: `Blog tag “${row.name}” canonical`, editHref: '/admin/blog/tags' })),
      save: (id, value) => prisma.blogTag.update({ where: { id }, data: { canonicalUrl: String(value) } }),
    }),
  ];
}

function websiteField(
  field: 'headerCtaUrl' | 'headerSecondaryCtaUrl' | 'announcementUrl',
  label: string,
): Omit<Source, 'table' | 'field' | 'kind'> {
  return {
    load: async (needles) => {
      const row = await prisma.websiteSettings.findFirst({
        where: containsAny(field, needles),
        select: { id: true, [field]: true },
      });
      return row ? [{ id: row.id, value: (row as Record<string, unknown>)[field], countryId: null, label, editHref: '/admin/settings' }] : [];
    },
    save: (id, value) => prisma.websiteSettings.update({ where: { id }, data: { [field]: String(value) } }),
  };
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

type Matcher = (candidate: string, owner: Market | null) => string | null;

function ownHosts(): Set<string> {
  try {
    const host = new URL(siteUrl()).hostname.toLowerCase();
    const bare = host.replace(/^www\./, '');
    return new Set([host, bare, `www.${bare}`]);
  } catch {
    return new Set();
  }
}

/**
 * Builds the matcher for a set of changes: given one stored link and the
 * market whose content it is in, the rewritten link, or null.
 *
 * A link the editor wrote without a market prefix is read in its own market,
 * exactly as it is rendered, and rewritten in the same style.
 */
function buildMatcher(changes: readonly AddressChange[], markets: readonly Market[]): Matcher {
  const byKey = new Map<string, AddressChange>();
  for (const change of changes) {
    const key = pathKey(change.oldPath);
    if (key) byKey.set(key, change);
  }
  const prefixes = new Set(markets.map((market) => market.slug).filter(Boolean));
  const hosts = ownHosts();
  const root = markets.find((market) => market.isDefault) ?? null;

  return (candidate, owner) => {
    const value = candidate.trim();
    let origin = '';
    let rest = value;
    if (/^https?:\/\//i.test(value)) {
      try {
        const url = new URL(value);
        if (!hosts.has(url.hostname.toLowerCase())) return null;
        origin = url.origin;
        rest = `${url.pathname}${url.search}${url.hash}`;
      } catch {
        return null;
      }
    } else if (!value.startsWith('/') || value.startsWith('//')) {
      return null;
    }

    const cut = rest.search(/[?#]/);
    const path = cut >= 0 ? rest.slice(0, cut) : rest;
    const suffix = cut >= 0 ? rest.slice(cut) : '';
    const first = segmentsOf(path)[0] ?? '';
    const prefixed = Boolean(first && prefixes.has(first));
    const market = owner ?? root;

    // The full address this link means where it is rendered.
    const full = prefixed || origin || !market || market.isDefault ? path : joinMarket(market.slug, path);
    const key = pathKey(full);
    const change = key ? byKey.get(key) : undefined;
    if (!change) return null;

    // Written the way it was: prefixed stays prefixed, root-relative stays
    // root-relative within its market, absolute stays absolute.
    const newPath =
      prefixed || origin || !market || market.isDefault ? change.newPath : stripMarket(market.slug, change.newPath);
    return `${origin}${newPath}${suffix}`;
  };
}

/** Rewrites the links in one stored value, returning the new value and what changed. */
function rewrite(
  value: unknown,
  source: Pick<Source, 'json' | 'html'>,
  match: Matcher,
  owner: Market | null,
): { value: unknown; matches: Array<{ before: string; after: string }> } {
  const matches: Array<{ before: string; after: string }> = [];

  const html = (text: string) =>
    text.replace(/\b(href|src)=("|')([^"']*)\2/gi, (whole, attribute: string, quote: string, url: string) => {
      const next = match(url, owner);
      if (!next || next === url) return whole;
      matches.push({ before: url, after: next });
      return `${attribute}=${quote}${next}${quote}`;
    });

  const walk = (node: unknown): unknown => {
    if (typeof node === 'string') {
      if (node.includes('<')) return html(node);
      const next = match(node, owner);
      if (next && next !== node) {
        matches.push({ before: node, after: next });
        return next;
      }
      return node;
    }
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(node as Record<string, unknown>)) out[key] = walk(item);
      return out;
    }
    return node;
  };

  if (source.json) return { value: walk(value), matches };
  if (typeof value !== 'string') return { value, matches };
  if (source.html) return { value: html(value), matches };
  const next = match(value, owner);
  if (next && next !== value) matches.push({ before: value, after: next });
  return { value: next ?? value, matches };
}

/** What to search the database for: each old address's market-relative spelling. */
function needlesFor(changes: readonly AddressChange[], markets: readonly Market[]): string[] {
  const needles = new Set<string>();
  for (const change of changes) {
    const market = markets.find((entry) => entry.id === change.countryId);
    const relative = market?.slug ? stripMarket(market.slug, change.oldPath) : change.oldPath;
    if (relative !== '/') needles.add(relative.toLowerCase());
  }
  return [...needles];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function findReferences(changes: readonly AddressChange[]): Promise<Reference[]> {
  if (changes.length === 0) return [];
  const markets = await listCountries();
  const match = buildMatcher(changes, markets);
  const needles = needlesFor(changes, markets);
  if (needles.length === 0) return [];

  const found: Reference[] = [];
  for (const source of sources()) {
    const rows = await source.load(needles);
    for (const row of rows) {
      const owner = row.countryId ? (markets.find((market) => market.id === row.countryId) ?? null) : null;
      const result = rewrite(row.value, source, match, owner);
      if (result.matches.length === 0) continue;
      found.push({
        id: `${source.table}:${row.id}:${source.field}`,
        table: source.table,
        recordId: row.id,
        field: source.field,
        label: row.label,
        editHref: row.editHref,
        kind: source.kind,
        matches: result.matches,
        fingerprint: fingerprintOf(row.value),
      });
    }
  }
  return found;
}

export type ApplyOutcome = {
  updated: number;
  skipped: Array<{ id: string; reason: string }>;
};

/**
 * Rewrites the chosen references, re-reading each one first: a reference
 * whose field changed since it was previewed is skipped and reported, never
 * overwritten.
 */
export async function applyReferences(
  changes: readonly AddressChange[],
  chosen: ReadonlyArray<{ id: string; fingerprint: string }>,
  actor: SessionUser,
): Promise<ApplyOutcome> {
  const markets = await listCountries();
  const match = buildMatcher(changes, markets);
  const needles = needlesFor(changes, markets);
  const wanted = new Map(chosen.map((entry) => [entry.id, entry.fingerprint]));
  const outcome: ApplyOutcome = { updated: 0, skipped: [] };
  const seen = new Set<string>();

  for (const source of sources()) {
    const rows = await source.load(needles);
    for (const row of rows) {
      const id = `${source.table}:${row.id}:${source.field}`;
      if (!wanted.has(id)) continue;
      seen.add(id);
      if (fingerprintOf(row.value) !== wanted.get(id)) {
        outcome.skipped.push({ id, reason: 'Changed since the preview; open it and check.' });
        continue;
      }
      const owner = row.countryId ? (markets.find((market) => market.id === row.countryId) ?? null) : null;
      const result = rewrite(row.value, source, match, owner);
      if (result.matches.length === 0) continue;
      await source.save(row.id, result.value);
      outcome.updated += 1;
      await recordAudit({
        actor,
        action: 'links.rewritten',
        entity: source.table,
        entityId: row.id,
        summary: `Updated ${result.matches.length} link(s) in ${row.label}`,
        before: result.matches.map((entry) => entry.before),
        after: result.matches.map((entry) => entry.after),
      });
    }
  }
  for (const entry of chosen) {
    if (!seen.has(entry.id)) outcome.skipped.push({ id: entry.id, reason: 'No longer found.' });
  }
  return outcome;
}

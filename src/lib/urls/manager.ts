import 'server-only';
import { prisma } from '@/lib/db/prisma';
import { listCountries } from '@/lib/country/registry';
import { listAccessibleCountries } from '@/lib/country/access';
import type { CountryContext } from '@/lib/country/types';
import type { SessionUser } from '@/lib/auth/guards';
import { getWebsiteSettings } from '@/lib/services/settings';
import { siteUrl } from '@/lib/env';
import { slugify, pageSlug } from '@/lib/utils/slug';
import { entityKey, patternScopeKey } from './snapshot';
import { checkRelativePath, joinMarket, pathKey, segmentsOf, stripMarket } from './path';
import {
  blogArchiveInfo,
  describeOwner,
  listRegistrableContent,
  loadContentInfo,
  patternRelativePath,
  type ContentInfo,
} from './content';
import { checkAvailability, placeContent, withRegistry, type Actor } from './registry';
import { syncRoutes, productRefs } from './content-sync';
import { UrlRegistryError } from './errors';
import {
  CONTENT_EDIT_PERMISSION,
  DEFAULT_PATTERNS,
  PATTERN_TYPES,
  ROOT_ONLY_TYPES,
  SLUGLESS_TYPES,
  isPageType,
  URL_TYPE_LABELS,
  type UrlContentType,
  type UrlPublicationState,
  type UrlRouteModeValue,
} from './types';

/**
 * The Slug & URL Manager's view of the registry: every piece of content with
 * the address it has, the address its pattern would give it, and whether the
 * person looking may change it.
 *
 * Listings are assembled from a handful of batched queries — the content of
 * each type and the routes — and filtered in memory, so a page of results
 * never costs a query per row.
 */

export type UrlRow = {
  key: string;
  entityId: string;
  countryId: string;
  countryName: string;
  countryCode: string;
  marketPrefix: string;
  type: UrlContentType;
  typeLabel: string;
  label: string;
  slug: string;
  /** The registered public path, or null when the content has no address. */
  path: string | null;
  state: UrlPublicationState;
  mode: UrlRouteModeValue | null;
  /** The path the content's pattern gives it, market prefix included. */
  patternPath: string;
  version: number | null;
  editHref: string;
  canEdit: boolean;
  /** The city whose address space a page is in, so city-owned addresses stand out. */
  city: { id: string; name: string } | null;
};

export type UrlListQuery = {
  q?: string;
  countryId?: string;
  type?: UrlContentType | '';
  state?: UrlPublicationState | '';
  mode?: UrlRouteModeValue | 'UNREGISTERED' | '';
  page?: number;
  pageSize?: number;
  sort?: 'path' | 'label' | 'type';
};

export type UrlListResult = {
  rows: UrlRow[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
};

export type PatternTable = Map<string, string>;

export async function loadPatterns(): Promise<PatternTable> {
  const rows = await prisma.urlPattern.findMany({ select: { scopeKey: true, pattern: true } });
  return new Map(rows.map((row) => [row.scopeKey, row.pattern]));
}

/** The public origin, from the website settings, as the spec asks. */
export async function publicOrigin(): Promise<string> {
  const settings = await getWebsiteSettings().catch(() => null);
  const configured = settings?.siteUrl?.trim();
  if (configured && !/localhost/.test(configured)) return configured.replace(/\/+$/, '');
  return siteUrl();
}

export function userCanEditType(user: SessionUser, type: UrlContentType): boolean {
  const can = (permission: string) =>
    user.role === 'super-admin' || user.permissions.includes(permission);
  return can('seo.manage') && can(CONTENT_EDIT_PERMISSION[type]);
}

async function scope(user: SessionUser) {
  const [all, accessible] = await Promise.all([
    listCountries(),
    listAccessibleCountries(user, { includeInactive: true }),
  ]);
  const root = all.find((country) => country.isDefault) ?? all[0]!;
  return { all, accessible, root, allowed: new Set(accessible.map((country) => country.id)) };
}

function toRow(
  info: ContentInfo,
  route: { path: string; mode: string; version: number } | undefined,
  market: CountryContext,
  patterns: PatternTable,
  user: SessionUser,
): UrlRow {
  const patternPath = joinMarket(market.slug, patternRelativePath(info, { patterns }));
  return {
    key: entityKey(info.entityId, info.countryId),
    entityId: info.entityId,
    countryId: info.countryId,
    countryName: market.name,
    countryCode: market.code,
    marketPrefix: market.slug ? `/${market.slug}` : '',
    type: info.type,
    typeLabel: URL_TYPE_LABELS[info.type],
    label: info.label,
    slug: info.slug,
    path: route?.path ?? null,
    state: info.state,
    mode: route ? (route.mode as UrlRouteModeValue) : null,
    patternPath,
    version: route?.version ?? null,
    editHref: info.editHref,
    canEdit: userCanEditType(user, info.type),
    city: info.city ?? null,
  };
}

/** Every URL the user may see, filtered and paginated. */
export async function listUrls(user: SessionUser, query: UrlListQuery): Promise<UrlListResult> {
  const { all, root, allowed } = await scope(user);
  const countryId = query.countryId && allowed.has(query.countryId) ? query.countryId : undefined;
  const [content, routes, patterns] = await Promise.all([
    listRegistrableContent({
      rootCountryId: root.id,
      countryId,
      types: query.type ? [query.type] : undefined,
    }),
    prisma.urlRoute.findMany({
      where: { kind: 'CONTENT', ...(countryId ? { countryId } : {}) },
      select: { entityId: true, countryId: true, path: true, mode: true, version: true },
    }),
    loadPatterns(),
  ]);
  const byKey = new Map(routes.map((route) => [entityKey(route.entityId ?? '', route.countryId), route]));
  const needle = query.q?.trim().toLowerCase() ?? '';

  let rows = content
    .filter((info) => allowed.has(info.countryId))
    .flatMap((info) => {
      const market = all.find((country) => country.id === info.countryId);
      return market ? [toRow(info, byKey.get(entityKey(info.entityId, info.countryId)), market, patterns, user)] : [];
    });

  if (needle) {
    rows = rows.filter(
      (row) =>
        row.label.toLowerCase().includes(needle) ||
        (row.path ?? '').toLowerCase().includes(needle) ||
        row.slug.toLowerCase().includes(needle),
    );
  }
  if (query.state) rows = rows.filter((row) => row.state === query.state);
  if (query.mode === 'UNREGISTERED') rows = rows.filter((row) => row.path === null);
  else if (query.mode) rows = rows.filter((row) => row.mode === query.mode);

  const sort = query.sort ?? 'path';
  rows.sort((a, b) => {
    if (sort === 'label') return a.label.localeCompare(b.label);
    if (sort === 'type') return a.typeLabel.localeCompare(b.typeLabel) || (a.path ?? '').localeCompare(b.path ?? '');
    return (a.path ?? `~${a.patternPath}`).localeCompare(b.path ?? `~${b.patternPath}`);
  });

  const pageSize = Math.min(Math.max(query.pageSize ?? 25, 10), 100);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const page = Math.min(Math.max(query.page ?? 1, 1), pages);
  return {
    rows: rows.slice((page - 1) * pageSize, page * pageSize),
    total: rows.length,
    page,
    pageSize,
    pages,
  };
}

// ---------------------------------------------------------------------------
// One piece of content
// ---------------------------------------------------------------------------

export type PatternSource = 'market' | 'global' | 'default';

export type UrlDetail = {
  row: UrlRow;
  origin: string;
  /** The pattern this content inherits, and where it comes from. */
  pattern: { value: string; source: PatternSource; path: string };
  /** When the address is a custom override, the market-relative path. */
  customPath: string | null;
  /** What the slug field edits: the product slug is shared by every market. */
  slugScope: 'global' | 'market' | 'none';
  redirectsIn: Array<{
    id: string;
    source: string;
    origin: 'MANUAL' | 'AUTOMATIC';
    isActive: boolean;
    hitCount: number;
    type: string;
  }>;
  history: Array<{
    id: string;
    oldPath: string | null;
    newPath: string | null;
    reason: string;
    actorEmail: string | null;
    createdAt: string;
  }>;
  canonicalOverride: string | null;
};

function patternOf(patterns: PatternTable, type: UrlContentType, countryId: string): { value: string; source: PatternSource } {
  if (type === 'PAGE') return { value: DEFAULT_PATTERNS.PAGE, source: 'default' };
  const local = patterns.get(patternScopeKey(type, countryId));
  if (local) return { value: local, source: 'market' };
  const global = patterns.get(patternScopeKey(type, null));
  if (global) return { value: global, source: 'global' };
  return { value: DEFAULT_PATTERNS[type], source: 'default' };
}

async function canonicalOverride(info: ContentInfo): Promise<string | null> {
  switch (info.type) {
    case 'PAGE':
    case 'CATEGORY_PAGE':
    case 'BRAND_PAGE':
      return (await prisma.page.findUnique({ where: { id: info.entityId }, select: { canonicalUrl: true } }))?.canonicalUrl ?? null;
    case 'PRODUCT': {
      const row = await prisma.productCountry.findUnique({
        where: { productId_countryId: { productId: info.entityId, countryId: info.countryId } },
        select: { canonicalUrl: true, product: { select: { canonicalUrl: true } } },
      });
      return row?.canonicalUrl || row?.product.canonicalUrl || null;
    }
    case 'BLOG_POST':
      return (await prisma.blogPost.findUnique({ where: { id: info.entityId }, select: { canonicalUrl: true } }))?.canonicalUrl ?? null;
    case 'BLOG_CATEGORY':
      return (await prisma.blogCategory.findUnique({ where: { id: info.entityId }, select: { canonicalUrl: true } }))?.canonicalUrl ?? null;
    case 'BLOG_TAG':
      return (await prisma.blogTag.findUnique({ where: { id: info.entityId }, select: { canonicalUrl: true } }))?.canonicalUrl ?? null;
    case 'BLOG_ARCHIVE':
      return (await prisma.blogSettings.findUnique({ where: { id: 'singleton' }, select: { canonicalUrl: true } }))?.canonicalUrl ?? null;
  }
}

export async function loadInfo(
  entityId: string,
  countryId: string,
  type: UrlContentType,
  root: CountryContext,
): Promise<ContentInfo | null> {
  if (type === 'BLOG_ARCHIVE') return blogArchiveInfo(root.id);
  const infos = await loadContentInfo([{ type, entityId, countryId }], root.id);
  return infos.get(entityKey(entityId, countryId)) ?? null;
}

export async function urlDetail(
  user: SessionUser,
  ref: { entityId: string; countryId: string; type: UrlContentType },
): Promise<UrlDetail | null> {
  const { all, root, allowed } = await scope(user);
  if (!allowed.has(ref.countryId)) return null;
  const info = await loadInfo(ref.entityId, ref.countryId, ref.type, root);
  if (!info) return null;
  const market = all.find((country) => country.id === info.countryId);
  if (!market) return null;

  const [route, patterns, redirects, history, canonical, origin] = await Promise.all([
    prisma.urlRoute.findUnique({
      where: { entityId_countryId: { entityId: info.entityId, countryId: info.countryId } },
    }),
    loadPatterns(),
    prisma.redirect.findMany({
      where: { targetEntityId: info.entityId, targetCountryId: info.countryId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, source: true, origin: true, isActive: true, hitCount: true, type: true },
    }),
    prisma.urlHistory.findMany({
      where: { entityId: info.entityId, countryId: info.countryId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    canonicalOverride(info),
    publicOrigin(),
  ]);

  const row = toRow(
    info,
    route ? { path: route.path, mode: route.mode, version: route.version } : undefined,
    market,
    patterns,
    user,
  );
  const inherited = patternOf(patterns, info.type, info.countryId);

  return {
    row,
    origin,
    pattern: { ...inherited, path: row.patternPath },
    customPath: route && route.mode === 'CUSTOM' ? stripMarket(market.slug, route.path) : null,
    slugScope:
      info.type === 'BLOG_ARCHIVE' ? 'none' : info.type === 'PRODUCT' ? 'global' : isPageType(info.type) ? 'market' : 'global',
    redirectsIn: redirects.map((entry) => ({
      id: entry.id,
      source: entry.source,
      origin: entry.origin,
      isActive: entry.isActive,
      hitCount: entry.hitCount,
      type: entry.type,
    })),
    history: history.map((entry) => ({
      id: entry.id,
      oldPath: entry.oldPath,
      newPath: entry.newPath,
      reason: entry.reason,
      actorEmail: entry.actorEmail,
      createdAt: entry.createdAt.toISOString(),
    })),
    canonicalOverride: canonical,
  };
}

// ---------------------------------------------------------------------------
// Checking and saving an address
// ---------------------------------------------------------------------------

export type PathCheckResult =
  | {
      ok: true;
      path: string;
      url: string;
      notes: string[];
      unchanged: boolean;
      /** A historical address of this content, taken back from its redirect. */
      reclaims: boolean;
    }
  | { ok: false; error: string; conflict?: { description: string; path: string; editHref: string | null } };

/**
 * Whether a market-relative path is free for this content: valid, not
 * reserved, and not owned by anything else. Read-only; the save repeats the
 * check under the registry lock.
 */
export async function checkContentPath(
  user: SessionUser,
  ref: { entityId: string; countryId: string; type: UrlContentType },
  input: string,
): Promise<PathCheckResult> {
  const { all, allowed } = await scope(user);
  if (!allowed.has(ref.countryId)) return { ok: false, error: 'You cannot edit addresses in that market.' };
  const market = all.find((country) => country.id === ref.countryId);
  if (!market) return { ok: false, error: 'That market no longer exists.' };

  const checked = checkRelativePath(input, { marketPrefixes: all.map((country) => country.slug).filter(Boolean) });
  if (!checked.ok) return { ok: false, error: checked.error };

  const path = joinMarket(market.slug, checked.relative);
  const key = pathKey(path)!;
  const [availability, current, origin] = await Promise.all([
    checkAvailability(prisma, key, ref),
    prisma.urlRoute.findUnique({ where: { entityId_countryId: { entityId: ref.entityId, countryId: ref.countryId } } }),
    publicOrigin(),
  ]);
  if (!availability.ok) {
    const owner = availability.owner;
    let description = owner.description;
    let editHref: string | null = null;
    if (owner.kind === 'content' && owner.type && owner.entityId) {
      const root = all.find((country) => country.isDefault) ?? all[0]!;
      const info = await loadInfo(owner.entityId, owner.countryId, owner.type, root);
      if (info) {
        description = describeOwner(info);
        editHref = info.editHref;
      }
    } else if (owner.kind === 'city' && owner.cityId) {
      editHref = `/admin/cities/${owner.cityId}`;
    }
    return {
      ok: false,
      error: `${path} is already used by ${description}.`,
      conflict: { description, path: owner.path, editHref },
    };
  }
  return {
    ok: true,
    path,
    url: `${origin}${path === '/' ? '' : path}`,
    notes: checked.notes,
    unchanged: current?.path === path,
    reclaims: Boolean(availability.release?.redirect?.origin === 'AUTOMATIC'),
  };
}

export type SaveAddressInput =
  | {
      kind: 'custom';
      entityId: string;
      countryId: string;
      type: UrlContentType;
      relativePath: string;
      expectedVersion: number | null;
    }
  | {
      kind: 'reset';
      entityId: string;
      countryId: string;
      type: UrlContentType;
      expectedVersion: number | null;
    }
  | {
      kind: 'slug';
      entityId: string;
      countryId: string;
      type: UrlContentType;
      slug: string;
      expectedVersion: number | null;
    };

export type SaveAddressResult = {
  oldPath: string | null;
  newPath: string;
  redirectId: string | null;
  changed: boolean;
  /** Other markets that moved with a shared slug. */
  alsoMoved: Array<{ oldPath: string | null; newPath: string | null }>;
};

/**
 * Changes one piece of content's address in one market. Every path is
 * validated and every conflict reported; nothing is overwritten.
 */
export async function saveContentAddress(
  input: SaveAddressInput,
  actor: Actor & { id: string },
): Promise<SaveAddressResult> {
  const countries = await listCountries();
  const root = countries.find((country) => country.isDefault) ?? countries[0]!;
  const market = countries.find((country) => country.id === input.countryId);
  if (!market) throw new UrlRegistryError('That market no longer exists.', 'invalid', 'path');
  const info = await loadInfo(input.entityId, input.countryId, input.type, root);
  if (!info) throw new UrlRegistryError('That content no longer exists.', 'invalid', 'path');

  if (input.kind === 'slug') return saveSlug(input, info, actor);

  const patterns = await loadPatterns();
  const patternRel = patternRelativePath(info, { patterns });
  let relative: string;
  let mode: UrlRouteModeValue;
  if (input.kind === 'custom') {
    const checked = checkRelativePath(input.relativePath, {
      marketPrefixes: countries.map((country) => country.slug).filter(Boolean),
    });
    if (!checked.ok) throw new UrlRegistryError(checked.error, 'invalid', 'path');
    relative = checked.relative;
    mode = relative === patternRel ? 'PATTERN' : 'CUSTOM';
  } else {
    relative = patternRel;
    mode = 'PATTERN';
    const first = segmentsOf(relative)[0];
    if (
      first &&
      countries.some((country) => country.slug === first)
    ) {
      throw new UrlRegistryError(`The pattern gives ${relative}, which starts with a market prefix.`, 'reserved', 'path');
    }
  }

  const result = await withRegistry((tx) =>
    placeContent(tx, {
      type: info.type,
      entityId: info.entityId,
      countryId: info.countryId,
      marketSlug: market.slug,
      relativePath: relative,
      mode,
      label: info.label,
      wasPublished: info.wasPublished,
      reason: input.kind === 'reset' ? 'PATTERN' : 'EDIT',
      actor,
      expectedVersion: input.expectedVersion,
    }),
  );
  if (!result.ok) throw new UrlRegistryError(result.message, result.code, 'path');
  return {
    oldPath: result.oldPath,
    newPath: result.newPath,
    redirectId: result.redirectId,
    changed: result.changed,
    alsoMoved: [],
  };
}

/**
 * Changes the content's own slug. For a product that slug is shared by every
 * market, so each market whose address follows the pattern moves with it —
 * all in one transaction, or none.
 */
async function saveSlug(
  input: Extract<SaveAddressInput, { kind: 'slug' }>,
  info: ContentInfo,
  actor: Actor & { id: string },
): Promise<SaveAddressResult> {
  const raw = input.slug.trim();
  const slug = isPageType(info.type) ? pageSlug(raw) : slugify(raw);
  if (!slug) throw new UrlRegistryError('Enter a slug: letters, numbers and hyphens.', 'invalid', 'slug');

  return prisma.$transaction(
    async (tx) => {
      const current = await tx.urlRoute.findUnique({
        where: { entityId_countryId: { entityId: info.entityId, countryId: info.countryId } },
      });
      if (input.expectedVersion !== null && current && current.version !== input.expectedVersion) {
        throw new UrlRegistryError(
          'This address was changed by someone else since you opened it. Reload to see the current one.',
          'stale',
          'slug',
        );
      }

      let refs = [{ type: info.type, entityId: info.entityId, countryId: info.countryId }];
      switch (info.type) {
        case 'PRODUCT': {
          const clash = await tx.product.findFirst({ where: { slug, id: { not: info.entityId } }, select: { id: true } });
          if (clash) throw new UrlRegistryError('Another product already uses that slug.', 'conflict', 'slug');
          refs = await productRefs(tx, info.entityId);
          await tx.product.update({ where: { id: info.entityId }, data: { slug, updatedById: actor.id } });
          break;
        }
        case 'PAGE':
        case 'CATEGORY_PAGE':
        case 'BRAND_PAGE': {
          const clash = await tx.page.findFirst({
            where: { countryId: info.countryId, slug, id: { not: info.entityId } },
            select: { id: true },
          });
          if (clash) throw new UrlRegistryError('Another page in this market already uses that path.', 'conflict', 'slug');
          await tx.page.update({ where: { id: info.entityId }, data: { slug, updatedById: actor.id } });
          break;
        }
        case 'BLOG_POST': {
          const clash = await tx.blogPost.findFirst({
            where: { countryId: info.countryId, slug, id: { not: info.entityId } },
            select: { id: true },
          });
          if (clash) throw new UrlRegistryError('Another article already uses that slug.', 'conflict', 'slug');
          await tx.blogPost.update({ where: { id: info.entityId }, data: { slug } });
          break;
        }
        case 'BLOG_CATEGORY': {
          const clash = await tx.blogCategory.findFirst({ where: { slug, id: { not: info.entityId } }, select: { id: true } });
          if (clash) throw new UrlRegistryError('Another category already uses that slug.', 'conflict', 'slug');
          await tx.blogCategory.update({ where: { id: info.entityId }, data: { slug } });
          break;
        }
        case 'BLOG_TAG': {
          const clash = await tx.blogTag.findFirst({ where: { slug, id: { not: info.entityId } }, select: { id: true } });
          if (clash) throw new UrlRegistryError('Another tag already uses that slug.', 'conflict', 'slug');
          await tx.blogTag.update({ where: { id: info.entityId }, data: { slug } });
          break;
        }
        case 'BLOG_ARCHIVE':
          throw new UrlRegistryError('The blog archive has no slug; give it a custom path instead.', 'invalid', 'slug');
      }

      const before = new Map([[entityKey(info.entityId, info.countryId), info]]);
      const outcomes = await syncRoutes(tx, refs, { actor, reason: 'SLUG', before });
      const own = outcomes.find(
        (outcome) => outcome.ref.entityId === info.entityId && outcome.ref.countryId === info.countryId,
      );
      return {
        oldPath: own?.oldPath ?? current?.path ?? null,
        newPath: own?.newPath ?? current?.path ?? '',
        redirectId: own?.redirectId ?? null,
        changed: own?.status === 'moved' || own?.status === 'placed',
        alsoMoved: outcomes
          .filter((outcome) => outcome !== own && outcome.status === 'moved')
          .map((outcome) => ({ oldPath: outcome.oldPath, newPath: outcome.newPath })),
      };
    },
    { timeout: 30_000, maxWait: 10_000 },
  );
}

/** What resetting to the inherited pattern would do, before it is done. */
export async function previewReset(
  user: SessionUser,
  ref: { entityId: string; countryId: string; type: UrlContentType },
): Promise<
  | { ok: true; from: string | null; to: string; redirect: boolean; unchanged: boolean }
  | { ok: false; error: string }
> {
  const detail = await urlDetail(user, ref);
  if (!detail) return { ok: false, error: 'That content is not available.' };
  const to = detail.pattern.path;
  const key = pathKey(to)!;
  const availability = await checkAvailability(prisma, key, ref);
  if (!availability.ok) {
    return { ok: false, error: `The pattern gives ${to}, which is already used by ${availability.owner.description}.` };
  }
  const info = await loadInfo(ref.entityId, ref.countryId, ref.type, (await listCountries()).find((c) => c.isDefault)!);
  return {
    ok: true,
    from: detail.row.path,
    to,
    unchanged: detail.row.path === to,
    redirect: Boolean(detail.row.path && detail.row.path !== to && info?.wasPublished),
  };
}

// ---------------------------------------------------------------------------
// The manager's header
// ---------------------------------------------------------------------------

export type ManagerOverview = {
  resolverEnabled: boolean;
  activatedAt: string | null;
  lastScanAt: string | null;
  lastScan: {
    registered: number;
    collisions: number;
    redirectIssues: number;
    released: number;
  } | null;
  counts: {
    addresses: number;
    unregistered: number;
    redirects: number;
    automaticRedirects: number;
    notFound: number;
    history: number;
  };
  markets: Array<{ id: string; name: string; code: string; slug: string; isDefault: boolean }>;
  origin: string;
  everyMarket: boolean;
};

export async function loadManagerOverview(user: SessionUser): Promise<ManagerOverview> {
  const { all, accessible, root } = await scope(user);
  const ids = accessible.map((country) => country.id);
  const [settings, addresses, redirects, automaticRedirects, notFound, history, content] = await Promise.all([
    prisma.urlSettings.findUnique({ where: { id: 'singleton' } }),
    prisma.urlRoute.count({ where: { kind: 'CONTENT', countryId: { in: ids } } }),
    prisma.redirect.count({ where: { OR: [{ countryId: { in: ids } }, { countryId: null }] } }),
    prisma.redirect.count({ where: { origin: 'AUTOMATIC', countryId: { in: ids } } }),
    prisma.urlNotFound.count({ where: { status: 'OPEN' } }),
    prisma.urlHistory.count({ where: { countryId: { in: ids } } }),
    listRegistrableContent({ rootCountryId: root.id }),
  ]);
  const registered = new Set(
    (
      await prisma.urlRoute.findMany({
        where: { kind: 'CONTENT', countryId: { in: ids } },
        select: { entityId: true, countryId: true },
      })
    ).map((route) => entityKey(route.entityId ?? '', route.countryId)),
  );
  const unregistered = content.filter(
    (info) => ids.includes(info.countryId) && !registered.has(entityKey(info.entityId, info.countryId)),
  ).length;
  const report = settings?.lastScan as
    | { registered: number; collisions: unknown[]; redirectIssues: unknown[]; released: number }
    | null
    | undefined;

  return {
    resolverEnabled: Boolean(settings?.resolverEnabled),
    activatedAt: settings?.activatedAt?.toISOString() ?? null,
    lastScanAt: settings?.lastScanAt?.toISOString() ?? null,
    lastScan: report
      ? {
          registered: report.registered,
          collisions: report.collisions.length,
          redirectIssues: report.redirectIssues.length,
          released: report.released,
        }
      : null,
    counts: { addresses, unregistered, redirects, automaticRedirects, notFound, history },
    markets: accessible.map((country) => ({
      id: country.id,
      name: country.name,
      code: country.code,
      slug: country.slug,
      isDefault: country.isDefault,
    })),
    origin: await publicOrigin(),
    everyMarket: accessible.length >= all.length,
  };
}

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

export type PatternCell = {
  /** The saved pattern for this scope, or null when it inherits. */
  own: string | null;
  /** What applies: own, else the global one, else the built-in default. */
  effective: string;
  source: PatternSource;
  version: number | null;
  following: number;
  custom: number;
};

export type PatternOverview = {
  types: Array<{
    type: UrlContentType;
    label: string;
    needsSlug: boolean;
    rootOnly: boolean;
    global: PatternCell;
    markets: Array<{ countryId: string; cell: PatternCell }>;
  }>;
  markets: Array<{ id: string; name: string; slug: string }>;
  canGlobal: boolean;
};

export async function patternOverview(user: SessionUser): Promise<PatternOverview> {
  const { all, accessible, root } = await scope(user);
  const [rows, counts] = await Promise.all([
    prisma.urlPattern.findMany(),
    prisma.urlRoute.groupBy({
      by: ['type', 'countryId', 'mode'],
      where: { kind: 'CONTENT' },
      _count: { _all: true },
    }),
  ]);
  const saved = new Map(rows.map((row) => [row.scopeKey, row]));
  const count = (type: UrlContentType, countryId: string | null, mode: 'PATTERN' | 'CUSTOM') =>
    counts
      .filter((row) => row.type === type && row.mode === mode && (countryId === null || row.countryId === countryId))
      .reduce((sum, row) => sum + row._count._all, 0);

  return {
    canGlobal: accessible.length >= all.length,
    markets: accessible.map((country) => ({ id: country.id, name: country.name, slug: country.slug })),
    types: PATTERN_TYPES.map((type) => {
      const globalRow = saved.get(patternScopeKey(type, null));
      const globalEffective = globalRow?.pattern ?? DEFAULT_PATTERNS[type];
      const rootOnly = ROOT_ONLY_TYPES.has(type);
      const markets = (rootOnly ? accessible.filter((country) => country.id === root.id) : accessible).map((country) => {
        const own = saved.get(patternScopeKey(type, country.id));
        return {
          countryId: country.id,
          cell: {
            own: own?.pattern ?? null,
            effective: own?.pattern ?? globalEffective,
            source: (own ? 'market' : globalRow ? 'global' : 'default') as PatternSource,
            version: own?.version ?? null,
            following: count(type, country.id, 'PATTERN'),
            custom: count(type, country.id, 'CUSTOM'),
          },
        };
      });
      return {
        type,
        label: URL_TYPE_LABELS[type],
        needsSlug: !SLUGLESS_TYPES.has(type),
        rootOnly,
        global: {
          own: globalRow?.pattern ?? null,
          effective: globalEffective,
          source: (globalRow ? 'global' : 'default') as PatternSource,
          version: globalRow?.version ?? null,
          following: count(type, null, 'PATTERN'),
          custom: count(type, null, 'CUSTOM'),
        },
        markets,
      };
    }),
  };
}

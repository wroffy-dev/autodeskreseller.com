import { pathKey } from './path';
import { DEFAULT_PATTERNS, ROOT_ONLY_TYPES, type UrlContentType } from './types';

/**
 * The registry, in memory.
 *
 * Link generation happens everywhere — product cards, menus, breadcrumbs,
 * JSON-LD, sitemaps — and much of it in synchronous code. Querying the
 * registry per link would be one query per card in a listing, so instead the
 * whole map is held in memory and read synchronously.
 *
 * It is loaded by `load.ts` (server only) and kept for as long as the
 * registry's version number is unchanged; every write to the registry bumps
 * that number, so an edit reaches every server instance on its next request
 * without a rebuild or a restart.
 *
 * This module has no database access and no server-only imports, so the
 * helpers that read it work anywhere — they simply fall back to the default
 * patterns wherever no snapshot has been loaded, such as in the browser.
 */

export type SnapshotCountry = { id: string; slug: string; isDefault: boolean };

export type SnapshotRoute = {
  type: UrlContentType;
  entityId: string;
  countryId: string;
  path: string;
};

export type UrlSnapshot = {
  version: number;
  /** Whether public requests are resolved through the registry. */
  enabled: boolean;
  rootCountryId: string | null;
  countries: readonly SnapshotCountry[];
  /** Saved patterns by scope key: `${type}:${countryId}` or `${type}:*`. */
  patterns: ReadonlyMap<string, string>;
  /** Content routes by `${entityId}|${countryId}`. */
  routes: ReadonlyMap<string, SnapshotRoute>;
  /** Content routes by path key. */
  byKey: ReadonlyMap<string, SnapshotRoute>;
  /**
   * Old addresses that automatically redirect to content, by path key, so a
   * link typed before a URL changed can be rendered at the new address.
   */
  aliases: ReadonlyMap<string, { entityId: string; countryId: string }>;
  /** Page id → the group of pages that are the same page in other markets. */
  pageGroup: ReadonlyMap<string, string>;
  /** `${groupKey}|${countryId}` → that market's page in the group. */
  groupMember: ReadonlyMap<string, string>;
};

export const entityKey = (entityId: string, countryId: string) => `${entityId}|${countryId}`;
export const patternScopeKey = (type: UrlContentType, countryId: string | null) =>
  `${type}:${countryId ?? '*'}`;

/*
 * The last snapshot loaded in this server process. A module-level value on
 * purpose: link helpers are synchronous and are called from deep inside
 * rendering, where threading a request object through would touch every
 * component. Holding the newest snapshot process-wide is safe because it is
 * immutable once built and only ever replaced by a newer one.
 */
let current: UrlSnapshot | null = null;

export function setUrlSnapshot(snapshot: UrlSnapshot): void {
  if (!current || snapshot.version >= current.version || snapshot.enabled !== current.enabled) {
    current = snapshot;
  }
}

export function currentUrlSnapshot(): UrlSnapshot | null {
  return current;
}

/** Whether a loaded snapshot says public addresses come from the registry. */
export function urlRegistryActive(): boolean {
  return Boolean(current?.enabled);
}

/** Test and script hook: forget the snapshot so the defaults apply again. */
export function clearUrlSnapshot(): void {
  current = null;
}

/**
 * The pattern that applies to a type in a market: the market's own override,
 * else the global pattern, else the built-in default.
 */
export function resolvePattern(
  snapshot: Pick<UrlSnapshot, 'patterns'> | null,
  type: UrlContentType,
  countryId: string | null,
): string {
  if (type === 'PAGE') return DEFAULT_PATTERNS.PAGE;
  if (snapshot) {
    if (countryId) {
      const local = snapshot.patterns.get(patternScopeKey(type, countryId));
      if (local) return local;
    }
    const global = snapshot.patterns.get(patternScopeKey(type, null));
    if (global) return global;
  }
  return DEFAULT_PATTERNS[type];
}

/** The registered path of one piece of content in one market, if any. */
export function registeredPath(
  snapshot: UrlSnapshot | null,
  entityId: string,
  countryId: string,
): string | undefined {
  if (!snapshot?.enabled) return undefined;
  return snapshot.routes.get(entityKey(entityId, countryId))?.path;
}

/** The market root-only content is registered in. */
export function rootCountryId(snapshot: UrlSnapshot | null): string | null {
  return snapshot?.rootCountryId ?? null;
}

/** Whether a type only exists in the root market. */
export function isRootOnly(type: UrlContentType): boolean {
  return ROOT_ONLY_TYPES.has(type);
}

// ---------------------------------------------------------------------------
// Links an editor typed
// ---------------------------------------------------------------------------

type MarketRef = { id: string; slug: string };

/**
 * What an internal link typed into content should point at, in `country`.
 *
 * Editors write plain paths into CTAs, menus and rich text. Two things can
 * make such a path stale, and both are answered here from the registry,
 * without a query:
 *
 *  - the address moved: `/products/autocad` is now an automatic redirect to
 *    `/autocad`, so the link is rendered straight to `/autocad` rather than
 *    through a redirect;
 *  - it is another market's address: `/autocad` typed in India's content and
 *    rendered in the UAE becomes the UAE's own address for the same product —
 *    found by identity, so it works even when the UAE's URL is different.
 *
 * Returns null when the registry is off or does not recognise the path, in
 * which case the caller keeps its ordinary handling.
 */
export function currentRegisteredLink(country: MarketRef, path: string): string | null {
  const snap = current?.enabled ? current : null;
  if (!snap) return null;
  const key = pathKey(path);
  if (!key) return null;

  let route = snap.byKey.get(key);
  if (!route) {
    const alias = snap.aliases.get(key);
    if (alias) route = snap.routes.get(entityKey(alias.entityId, alias.countryId));
  }
  if (!route) return null;

  if (route.countryId === country.id || ROOT_ONLY_TYPES.has(route.type)) return route.path;

  if (route.type === 'PRODUCT') {
    return snap.routes.get(entityKey(route.entityId, country.id))?.path ?? null;
  }

  // Pages: the same page in the other market, by group rather than by slug.
  const group = snap.pageGroup.get(route.entityId);
  const member = group ? snap.groupMember.get(`${group}|${country.id}`) : undefined;
  return member ? (snap.routes.get(entityKey(member, country.id))?.path ?? null) : null;
}

/** Whether a path belongs to root-only (blog) content — by registry, or by the default `/blog`. */
export function isRootOnlyPath(path: string): boolean {
  const snap = current?.enabled ? current : null;
  const key = pathKey(path);
  if (snap && key) {
    const route = snap.byKey.get(key);
    if (route) return ROOT_ONLY_TYPES.has(route.type);
    const alias = snap.aliases.get(key);
    if (alias) {
      const target = snap.routes.get(entityKey(alias.entityId, alias.countryId));
      if (target) return ROOT_ONLY_TYPES.has(target.type);
    }
  }
  return (key ?? '').split('/')[1] === 'blog';
}

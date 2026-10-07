import 'server-only';
import { cache } from 'react';
import { prisma } from '@/lib/db/prisma';
import { listCountries } from '@/lib/country/registry';
import {
  currentUrlSnapshot,
  entityKey,
  setUrlSnapshot,
  type SnapshotRoute,
  type UrlSnapshot,
} from './snapshot';
import type { UrlContentType } from './types';

/**
 * Loading the registry into memory.
 *
 * Each request makes one primary-key read of the registry's version. When it
 * matches the snapshot already held, nothing else is read; when it does not,
 * the snapshot is rebuilt in a handful of queries — never one per route — and
 * shared by every request that follows until the next change.
 *
 * With the registry switched off the snapshot is empty and link generation
 * falls back to the patterns, which is exactly how the site built its links
 * before the registry existed.
 */

let inflight: Promise<UrlSnapshot> | null = null;
let inflightVersion = -1;

type State = { version: number; resolverEnabled: boolean };

async function readState(): Promise<State | null> {
  try {
    return await prisma.urlSettings.findUnique({
      where: { id: 'singleton' },
      select: { version: true, resolverEnabled: true },
    });
  } catch (error) {
    // Before the migration runs, or on a transient database error, keep
    // serving from whatever is already held.
    if (!currentUrlSnapshot()) console.error('[urls] registry state unavailable', error);
    return null;
  }
}

async function build(state: State): Promise<UrlSnapshot> {
  const countries = await listCountries();
  const root = countries.find((country) => country.isDefault) ?? countries[0] ?? null;

  const base = {
    version: state.version,
    enabled: state.resolverEnabled,
    rootCountryId: root?.id ?? null,
    countries: countries.map((country) => ({
      id: country.id,
      slug: country.slug,
      isDefault: country.isDefault,
    })),
  };

  const [patterns, routes, aliases, pages] = await Promise.all([
    prisma.urlPattern.findMany({ select: { scopeKey: true, pattern: true } }),
    state.resolverEnabled
      ? prisma.urlRoute.findMany({
          where: { kind: 'CONTENT' },
          select: { type: true, entityId: true, countryId: true, path: true, pathKey: true },
        })
      : Promise.resolve([]),
    state.resolverEnabled
      ? prisma.urlRoute.findMany({
          where: {
            kind: 'REDIRECT',
            redirect: { isActive: true, origin: 'AUTOMATIC', targetEntityId: { not: null } },
          },
          select: {
            pathKey: true,
            redirect: { select: { targetEntityId: true, targetCountryId: true } },
          },
        })
      : Promise.resolve([]),
    state.resolverEnabled
      ? prisma.page.findMany({
          where: { deletedAt: null, groupKey: { not: null } },
          select: { id: true, countryId: true, groupKey: true },
        })
      : Promise.resolve([]),
  ]);

  const byEntity = new Map<string, SnapshotRoute>();
  const byKey = new Map<string, SnapshotRoute>();
  for (const row of routes) {
    if (!row.type || !row.entityId) continue;
    const route: SnapshotRoute = {
      type: row.type as UrlContentType,
      entityId: row.entityId,
      countryId: row.countryId,
      path: row.path,
    };
    byEntity.set(entityKey(route.entityId, route.countryId), route);
    byKey.set(row.pathKey, route);
  }

  const aliasMap = new Map<string, { entityId: string; countryId: string }>();
  for (const row of aliases) {
    const target = row.redirect;
    if (target?.targetEntityId && target.targetCountryId) {
      aliasMap.set(row.pathKey, { entityId: target.targetEntityId, countryId: target.targetCountryId });
    }
  }

  const pageGroup = new Map<string, string>();
  const groupMember = new Map<string, string>();
  for (const page of pages) {
    if (!page.groupKey) continue;
    pageGroup.set(page.id, page.groupKey);
    groupMember.set(`${page.groupKey}|${page.countryId}`, page.id);
  }

  return {
    ...base,
    patterns: new Map(patterns.map((row) => [row.scopeKey, row.pattern])),
    routes: byEntity,
    byKey,
    aliases: aliasMap,
    pageGroup,
    groupMember,
  };
}

/**
 * The current snapshot, reloaded only when the registry has changed.
 *
 * Deduplicated per request by `cache()`, and across concurrent requests by the
 * in-flight promise, so a burst of traffic after an edit rebuilds it once.
 */
export const getUrlSnapshot = cache(async (): Promise<UrlSnapshot> => {
  const state = await readState();
  const held = currentUrlSnapshot();

  if (!state) {
    return held ?? emptySnapshot({ version: 0, resolverEnabled: false });
  }
  if (held && held.version === state.version && held.enabled === state.resolverEnabled) {
    return held;
  }
  if (!inflight || inflightVersion !== state.version) {
    inflightVersion = state.version;
    inflight = build(state)
      .then((snapshot) => {
        setUrlSnapshot(snapshot);
        return snapshot;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
});

function emptySnapshot(state: State): UrlSnapshot {
  return {
    version: state.version,
    enabled: false,
    rootCountryId: null,
    countries: [],
    patterns: new Map(),
    routes: new Map(),
    byKey: new Map(),
    aliases: new Map(),
    pageGroup: new Map(),
    groupMember: new Map(),
  };
}

/**
 * Whether public requests resolve through the registry. Read fresh (one
 * primary-key lookup, deduplicated per request) so switching it on or off
 * takes effect on the next request everywhere.
 */
export const isResolverEnabled = cache(async (): Promise<boolean> => {
  const state = await readState();
  return Boolean(state?.resolverEnabled);
});

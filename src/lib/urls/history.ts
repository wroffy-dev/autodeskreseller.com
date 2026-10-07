import 'server-only';
import type { Prisma, UrlChangeReason } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { listCountries } from '@/lib/country/registry';
import { listAccessibleCountries } from '@/lib/country/access';
import type { SessionUser } from '@/lib/auth/guards';
import { entityKey } from './snapshot';
import { pathKey, stripMarket } from './path';
import { loadContentInfo, patternRelativePath } from './content';
import { checkAvailability, placeContent, withRegistry } from './registry';
import { loadPatterns, userCanEditType } from './manager';
import { UrlRegistryError } from './errors';
import { URL_TYPE_LABELS, type UrlContentType } from './types';

/**
 * The URL history: every address every piece of content has had.
 *
 * Restoring puts content back at an earlier address — only after checking,
 * under the registry lock, that the address is still free or is held by this
 * same content's own redirect. The address it leaves redirects to it in turn,
 * so every address it has ever had still arrives at it, directly.
 *
 * Deleted content keeps its history. Its old addresses answer 404 until
 * somebody gives one a deliberate new home; nothing is ever sent to the home
 * page by default.
 */

export type HistoryRow = {
  id: string;
  type: UrlContentType;
  typeLabel: string;
  entityId: string;
  countryId: string;
  countryName: string;
  label: string;
  oldPath: string | null;
  newPath: string | null;
  reason: UrlChangeReason;
  actorEmail: string | null;
  createdAt: string;
  /** Whether the content still exists, so restoring is possible. */
  exists: boolean;
  currentPath: string | null;
};

export type HistoryQuery = {
  q?: string;
  countryId?: string;
  type?: UrlContentType | '';
  reason?: UrlChangeReason | '';
  page?: number;
};

export async function listHistory(
  user: SessionUser,
  query: HistoryQuery,
): Promise<{ rows: HistoryRow[]; total: number; page: number; pages: number }> {
  const [countries, mine] = await Promise.all([
    listCountries(),
    listAccessibleCountries(user, { includeInactive: true }),
  ]);
  const allowed = mine.map((country) => country.id);
  const where: Prisma.UrlHistoryWhereInput = {
    countryId: query.countryId && allowed.includes(query.countryId) ? query.countryId : { in: allowed },
    ...(query.type ? { type: query.type } : {}),
    ...(query.reason ? { reason: query.reason } : {}),
    ...(query.q?.trim()
      ? {
          OR: [
            { label: { contains: query.q.trim(), mode: 'insensitive' } },
            { oldPath: { contains: query.q.trim(), mode: 'insensitive' } },
            { newPath: { contains: query.q.trim(), mode: 'insensitive' } },
          ],
        }
      : {}),
  };
  const pageSize = 25;
  const total = await prisma.urlHistory.count({ where });
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(query.page ?? 1, 1), pages);
  const rows = await prisma.urlHistory.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    skip: (page - 1) * pageSize,
    take: pageSize,
  });
  const root = countries.find((country) => country.isDefault) ?? countries[0]!;
  const [infos, routes] = await Promise.all([
    loadContentInfo(
      rows.map((row) => ({ type: row.type as UrlContentType, entityId: row.entityId, countryId: row.countryId })),
      root.id,
    ),
    prisma.urlRoute.findMany({
      where: { kind: 'CONTENT', entityId: { in: rows.map((row) => row.entityId) } },
      select: { entityId: true, countryId: true, path: true },
    }),
  ]);
  const routeOf = new Map(routes.map((route) => [entityKey(route.entityId ?? '', route.countryId), route.path]));

  return {
    total,
    page,
    pages,
    rows: rows.map((row) => {
      const key = entityKey(row.entityId, row.countryId);
      return {
        id: row.id,
        type: row.type as UrlContentType,
        typeLabel: URL_TYPE_LABELS[row.type as UrlContentType],
        entityId: row.entityId,
        countryId: row.countryId,
        countryName: countries.find((country) => country.id === row.countryId)?.name ?? row.countryId,
        label: infos.get(key)?.label ?? row.label,
        oldPath: row.oldPath,
        newPath: row.newPath,
        reason: row.reason,
        actorEmail: row.actorEmail,
        createdAt: row.createdAt.toISOString(),
        exists: row.type === 'BLOG_ARCHIVE' || infos.has(key),
        currentPath: routeOf.get(key) ?? null,
      };
    }),
  };
}

export type RestorePreview =
  | { ok: true; from: string | null; to: string; redirect: boolean; unchanged: boolean; label: string }
  | { ok: false; error: string };

async function loadEntry(user: SessionUser, historyId: string) {
  const entry = await prisma.urlHistory.findUnique({ where: { id: historyId } });
  if (!entry) return { error: 'That history entry no longer exists.' } as const;
  const [countries, mine] = await Promise.all([
    listCountries(),
    listAccessibleCountries(user, { includeInactive: true }),
  ]);
  if (!mine.some((country) => country.id === entry.countryId)) {
    return { error: 'You cannot change addresses in that market.' } as const;
  }
  if (!userCanEditType(user, entry.type as UrlContentType)) {
    return { error: 'You cannot change addresses of this content.' } as const;
  }
  const root = countries.find((country) => country.isDefault) ?? countries[0]!;
  const market = countries.find((country) => country.id === entry.countryId);
  const info = (
    await loadContentInfo([{ type: entry.type as UrlContentType, entityId: entry.entityId, countryId: entry.countryId }], root.id)
  ).get(entityKey(entry.entityId, entry.countryId));
  return { entry, market, info, countries } as const;
}

/** What restoring an entry's earlier address would do. */
export async function previewRestore(user: SessionUser, historyId: string): Promise<RestorePreview> {
  const loaded = await loadEntry(user, historyId);
  if ('error' in loaded) return { ok: false, error: loaded.error ?? 'Not available.' };
  const { entry, info } = loaded;
  if (!entry.oldPath) return { ok: false, error: 'This entry records a first address; there is nothing earlier to restore.' };
  if (!info) {
    return {
      ok: false,
      error: 'The content no longer exists, so it cannot be restored. Give its old address a new home instead.',
    };
  }
  const route = await prisma.urlRoute.findUnique({
    where: { entityId_countryId: { entityId: entry.entityId, countryId: entry.countryId } },
  });
  const key = pathKey(entry.oldPath)!;
  const availability = await checkAvailability(prisma, key, {
    entityId: entry.entityId,
    countryId: entry.countryId,
    type: entry.type as UrlContentType,
  });
  if (!availability.ok) {
    return { ok: false, error: `${entry.oldPath} now belongs to ${availability.owner.description}, so it cannot be restored.` };
  }
  return {
    ok: true,
    from: route?.path ?? null,
    to: entry.oldPath,
    unchanged: route?.path === entry.oldPath,
    redirect: Boolean(route && route.path !== entry.oldPath && info.wasPublished),
    label: info.label,
  };
}

/** Puts content back at an earlier address, re-validating it first. */
export async function restoreFromHistory(
  user: SessionUser,
  historyId: string,
): Promise<{ oldPath: string | null; newPath: string; redirectId: string | null }> {
  const loaded = await loadEntry(user, historyId);
  if ('error' in loaded) throw new UrlRegistryError(loaded.error ?? 'Not available.', 'invalid', 'path');
  const { entry, info, market } = loaded;
  if (!entry.oldPath || !info || !market) {
    throw new UrlRegistryError('This address cannot be restored.', 'invalid', 'path');
  }
  const patterns = await loadPatterns();
  const relative = stripMarket(market.slug, entry.oldPath);
  const mode = relative === patternRelativePath(info, { patterns }) ? 'PATTERN' : 'CUSTOM';
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
      reason: 'RESTORE',
      actor: user,
    }),
  );
  if (!result.ok) throw new UrlRegistryError(result.message, result.code, 'path');
  return { oldPath: result.oldPath, newPath: result.newPath, redirectId: result.redirectId };
}

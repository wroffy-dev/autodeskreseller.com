import 'server-only';
import type { Prisma, RedirectOrigin, RedirectType } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { listCountries } from '@/lib/country/registry';
import type { CountryContext } from '@/lib/country/types';
import { siteUrl } from '@/lib/env';
import {
  checkDestination,
  isExternalUrl,
  isReservedFirstSegment,
  joinMarket,
  pathKey,
  segmentsOf,
  splitDestinationSuffix,
  stripMarket,
  withSuffix,
} from './path';
import { bumpRegistryVersion, cityOfPath, withRegistry, type Actor, type Tx } from './registry';
import { loadContentInfo, type ContentInfo } from './content';
import type { UrlContentType } from './types';

/**
 * Writing redirect rules.
 *
 * A rule answers for one address — or, for a market-relative rule, the same
 * address under every market prefix — and claims it in the URL registry, so
 * no page, product or other rule can hold it at the same time. Its
 * destination is stored as content by id whenever the destination is some
 * content's address, so a rule follows that content through any later rename:
 * a rule is never the first link of a chain, and a chain is never saved.
 */

export type RedirectRuleInput = {
  id?: string | null;
  source: string;
  destination: string;
  target?: { entityId: string; countryId: string } | null;
  type: RedirectType;
  isActive: boolean;
  note: string | null;
  /** Apply a market-relative source under every market prefix. */
  allMarkets?: boolean;
  /** Refuse when the rule was changed since this moment. */
  expectedUpdatedAt?: string | null;
  /** Relabel an existing rule — an automatic one a person has now re-pointed is manual. */
  origin?: RedirectOrigin;
};

export type RedirectRuleResult =
  | { ok: true; id: string; claims: number; dormant: string[]; flattened: boolean }
  | { ok: false; error: string; field?: 'source' | 'destination' };

function hosts(): Set<string> {
  try {
    const host = new URL(siteUrl()).hostname.toLowerCase();
    const bare = host.replace(/^www\./, '');
    return new Set([host, bare, `www.${bare}`]);
  } catch {
    return new Set();
  }
}

/** The source as a path on this site, or why it cannot be one. */
export function normaliseSource(input: string): { ok: true; path: string } | { ok: false; error: string } {
  let value = input.trim();
  if (!value) return { ok: false, error: 'Enter the old address.' };
  if (isExternalUrl(value)) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return { ok: false, error: 'That is not a valid address.' };
    }
    if (!hosts().has(url.hostname.toLowerCase())) {
      return { ok: false, error: 'Redirects match addresses on this site. Enter a path such as /old-pricing.' };
    }
    if (url.pathname === '/' || url.pathname === '') {
      return {
        ok: false,
        error:
          'A redirect matches a path, not a whole domain. The bare domain and www are handled by the site address: requests on the other spelling are sent to it automatically.',
      };
    }
    value = url.pathname;
  }
  value = value.split(/[?#]/)[0] ?? '';
  if (!value.startsWith('/')) value = `/${value}`;
  const key = pathKey(value);
  if (!key) return { ok: false, error: 'That address is not a valid path.' };
  if (key === '/') return { ok: false, error: 'The home page cannot be redirected.' };
  return { ok: true, path: `/${segmentsOf(value).join('/')}` };
}

type Destination = {
  /** Where it goes now, suffix included: shown to editors and used when there is no target. */
  destination: string;
  target: { type: UrlContentType; entityId: string; countryId: string } | null;
  /** With a target: the query string and fragment appended to its current address. */
  suffix: string | null;
  flattened: boolean;
};

/**
 * Where the rule really ends: content by id, a path nothing owns, or an
 * external URL — following any rules in between, and refusing a loop.
 *
 * The destination's own query string and fragment (`/autocad?edition=lt#buy`)
 * are kept wherever it ends: appended to a path, or stored beside a content
 * target. A rule followed on the way contributes its suffix only when the
 * destination as written had none.
 */
export async function resolveDestination(
  tx: Tx,
  input: Pick<RedirectRuleInput, 'target' | 'destination'>,
  sourceKeys: ReadonlySet<string>,
  ruleId: string | null,
): Promise<Destination | { error: string }> {
  if (input.target) {
    const route = await tx.urlRoute.findUnique({
      where: { entityId_countryId: { entityId: input.target.entityId, countryId: input.target.countryId } },
    });
    if (!route || route.kind !== 'CONTENT' || !route.type) {
      return { error: 'That content has no address to redirect to.' };
    }
    if (sourceKeys.has(route.pathKey)) return { error: 'A redirect cannot point at itself.' };
    return {
      destination: route.path,
      target: { type: route.type as UrlContentType, entityId: input.target.entityId, countryId: input.target.countryId },
      suffix: null,
      flattened: false,
    };
  }

  const checked = checkDestination(input.destination);
  if (!checked.ok) return { error: checked.error };
  if (checked.external) return { destination: checked.destination, target: null, suffix: null, flattened: false };

  const written = splitDestinationSuffix(checked.destination);
  let current = written.path;
  let suffix = written.suffix;
  let flattened = false;
  const chain = [...sourceKeys].slice(0, 1).concat(current);
  const seen = new Set<string>();
  for (let hop = 0; hop < 12; hop += 1) {
    const key = pathKey(current);
    if (!key) return { error: 'That destination is not a valid path.' };
    if (sourceKeys.has(key)) {
      return {
        error: hop === 0 ? 'A redirect cannot point at itself.' : `That would create a redirect loop: ${chain.join(' → ')}`,
      };
    }
    if (seen.has(key)) return { error: `That would create a redirect loop: ${chain.join(' → ')}` };
    seen.add(key);

    const claim = await tx.urlRoute.findUnique({ where: { pathKey: key }, include: { redirect: true } });
    if (!claim) return { destination: withSuffix(current, suffix), target: null, suffix: null, flattened };
    if (claim.kind === 'CONTENT' && claim.type && claim.entityId) {
      return {
        destination: withSuffix(claim.path, suffix),
        target: { type: claim.type as UrlContentType, entityId: claim.entityId, countryId: claim.countryId },
        suffix,
        flattened,
      };
    }
    const next = claim.redirect;
    if (!next || next.id === ruleId) return { destination: withSuffix(current, suffix), target: null, suffix: null, flattened };
    flattened = true;
    if (next.targetEntityId && next.targetCountryId && next.targetType) {
      const route = await tx.urlRoute.findUnique({
        where: { entityId_countryId: { entityId: next.targetEntityId, countryId: next.targetCountryId } },
      });
      if (route && sourceKeys.has(route.pathKey)) {
        return { error: `That would create a redirect loop: ${chain.concat(route.path).join(' → ')}` };
      }
      const kept = suffix ?? next.destinationSuffix ?? null;
      return {
        destination: withSuffix(route?.path ?? splitDestinationSuffix(next.destination).path, kept),
        target: { type: next.targetType as UrlContentType, entityId: next.targetEntityId, countryId: next.targetCountryId },
        suffix: kept,
        flattened,
      };
    }
    if (isExternalUrl(next.destination)) return { destination: next.destination, target: null, suffix: null, flattened };
    const followed = splitDestinationSuffix(next.destination);
    current = followed.path;
    suffix = suffix ?? followed.suffix;
    chain.push(current);
  }
  return { error: `That destination redirects too many times: ${chain.join(' → ')}` };
}

/**
 * Creates or updates a rule. Market access is checked by the caller, which
 * passes the markets the user may write to.
 */
export async function saveRedirectRule(
  input: RedirectRuleInput,
  actor: Actor,
  access: { countryIds: ReadonlySet<string>; everyMarket: boolean },
): Promise<RedirectRuleResult> {
  const source = normaliseSource(input.source);
  if (!source.ok) return { ok: false, error: source.error, field: 'source' };

  const countries = await listCountries();
  const prefixes = countries.map((country) => country.slug).filter(Boolean);
  const first = segmentsOf(source.path)[0] ?? '';
  const market = countries.find((country) => country.slug && country.slug === first);
  const root = countries.find((country) => country.isDefault) ?? countries[0];
  if (!root) return { ok: false, error: 'No market is configured.' };

  const rest = market ? segmentsOf(source.path).slice(1) : segmentsOf(source.path);
  if (rest[0] && isReservedFirstSegment(rest[0], { marketPrefixes: prefixes }) && !market) {
    return { ok: false, error: `“/${rest[0]}” is a system route; it cannot be redirected.`, field: 'source' };
  }

  const allMarkets = Boolean(input.allMarkets) && !market;
  const owner: CountryContext = market ?? root;
  if (allMarkets ? !access.everyMarket : !access.countryIds.has(owner.id)) {
    return { ok: false, error: 'You cannot write redirects for that market.', field: 'source' };
  }

  const markets = allMarkets
    ? countries.filter((country) => country.isActive || country.isDefault)
    : [owner];
  const wanted = markets.map((country) => ({
    country,
    key: pathKey(allMarkets ? joinMarket(country.slug, source.path) : source.path)!,
  }));
  const sourceKeys = new Set(wanted.map((entry) => entry.key));

  return withRegistry(async (tx) => {
    const existing = input.id ? await tx.redirect.findUnique({ where: { id: input.id } }) : null;
    if (input.id && !existing) return { ok: false, error: 'That redirect no longer exists.' };
    if (
      existing &&
      input.expectedUpdatedAt &&
      existing.updatedAt.toISOString() !== input.expectedUpdatedAt
    ) {
      return { ok: false, error: 'This redirect was changed by someone else since you opened it. Reload to see it.' };
    }

    const destination = await resolveDestination(tx, input, sourceKeys, existing?.id ?? null);
    if ('error' in destination) return { ok: false, error: destination.error, field: 'destination' };

    // Claims: free addresses are taken; this rule's own are kept; content wins
    // over an every-market rule; anything else is a conflict.
    const dormant: string[] = [];
    const keep = new Set<string>();
    for (const entry of wanted) {
      // A city's own address belongs to its landing page, even before it has one.
      const relative = stripMarket(entry.country.slug, entry.key);
      const city = segmentsOf(relative).length === 1 ? await cityOfPath(tx, entry.country.id, relative) : null;
      if (city) {
        if (allMarkets) {
          dormant.push(entry.key);
          continue;
        }
        return {
          ok: false,
          error: `${entry.key} is the address of the city ${city.name}; a redirect cannot take it. Redirect a page beneath it, or change the city's slug first.`,
          field: 'source',
        };
      }
      const claim = await tx.urlRoute.findUnique({ where: { pathKey: entry.key }, include: { redirect: true } });
      if (!claim || (existing && claim.redirectId === existing.id)) {
        keep.add(entry.key);
        continue;
      }
      if (claim.kind === 'CONTENT') {
        if (allMarkets) {
          dormant.push(entry.key);
          continue;
        }
        return {
          ok: false,
          error: `${claim.path} is the address of live content; a redirect cannot take it. Change that content's URL first.`,
          field: 'source',
        };
      }
      return {
        ok: false,
        error: `Another redirect already answers for ${claim.path}.`,
        field: 'source',
      };
    }

    const data = {
      source: allMarkets ? source.path : source.path,
      destination: destination.destination,
      type: input.type,
      isActive: input.isActive,
      note: input.note,
      countryId: owner.id,
      allMarkets,
      targetType: destination.target?.type ?? null,
      targetEntityId: destination.target?.entityId ?? null,
      targetCountryId: destination.target?.countryId ?? null,
      destinationSuffix: destination.target ? destination.suffix : null,
      updatedById: actor?.id ?? null,
      ...(existing && input.origin ? { origin: input.origin } : {}),
    } satisfies Prisma.RedirectUncheckedUpdateInput;

    const rule = existing
      ? await tx.redirect.update({ where: { id: existing.id }, data })
      : await tx.redirect.create({ data: { ...data, origin: 'MANUAL', createdById: actor?.id ?? null } });

    if (existing) {
      await tx.urlRoute.deleteMany({ where: { redirectId: rule.id, pathKey: { notIn: [...keep] } } });
    }
    let claims = 0;
    for (const entry of wanted) {
      if (!keep.has(entry.key)) continue;
      const held = await tx.urlRoute.findUnique({ where: { pathKey: entry.key } });
      if (!held) {
        await tx.urlRoute.create({
          data: { kind: 'REDIRECT', path: entry.key, pathKey: entry.key, countryId: entry.country.id, redirectId: rule.id },
        });
      }
      claims += 1;
    }
    await bumpRegistryVersion(tx);
    return { ok: true, id: rule.id, claims, dormant, flattened: destination.flattened };
  });
}

/** Switches a rule on or off. Its claims stay, so switching it back on always works. */
export async function toggleRedirectRule(id: string, actor: Actor): Promise<{ ok: boolean; isActive?: boolean }> {
  return withRegistry(async (tx) => {
    const rule = await tx.redirect.findUnique({ where: { id } });
    if (!rule) return { ok: false };
    const updated = await tx.redirect.update({
      where: { id },
      data: { isActive: !rule.isActive, updatedById: actor?.id ?? null },
    });
    await bumpRegistryVersion(tx);
    return { ok: true, isActive: updated.isActive };
  });
}

/** Deletes a rule and frees every address it held. */
export async function deleteRedirectRule(id: string): Promise<{ ok: boolean; source?: string; destination?: string }> {
  return withRegistry(async (tx) => {
    const rule = await tx.redirect.findUnique({ where: { id } });
    if (!rule) return { ok: false };
    await tx.urlRoute.deleteMany({ where: { redirectId: id } });
    await tx.redirect.delete({ where: { id } });
    await bumpRegistryVersion(tx);
    return { ok: true, source: rule.source, destination: rule.destination };
  });
}

/** The market a rule's address lives in, for permission checks on existing rules. */
export async function ruleMarket(id: string): Promise<{ countryId: string | null; allMarkets: boolean } | null> {
  const rule = await prisma.redirect.findUnique({ where: { id }, select: { countryId: true, allMarkets: true } });
  return rule;
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

export type RedirectRow = {
  id: string;
  source: string;
  /** Where it sends visitors now — the target's current address when it has one. */
  destination: string;
  target: { entityId: string; countryId: string; type: UrlContentType; label: string | null } | null;
  type: RedirectType;
  isActive: boolean;
  origin: 'MANUAL' | 'AUTOMATIC';
  allMarkets: boolean;
  hitCount: number;
  lastHitAt: string | null;
  note: string | null;
  countryName: string | null;
  claims: number;
  createdAt: string;
  updatedAt: string;
};

export type RedirectQuery = {
  q?: string;
  origin?: 'MANUAL' | 'AUTOMATIC' | '';
  status?: 'active' | 'disabled' | 'dormant' | '';
  countryId?: string;
  page?: number;
};

export async function listRedirectRows(
  allowedCountryIds: readonly string[],
  query: RedirectQuery,
): Promise<{ rows: RedirectRow[]; total: number; page: number; pages: number }> {
  const countries = await listCountries();
  const root = countries.find((country) => country.isDefault) ?? countries[0];
  const where: Prisma.RedirectWhereInput = {
    AND: [
      query.countryId && allowedCountryIds.includes(query.countryId)
        ? { countryId: query.countryId }
        : { OR: [{ countryId: { in: [...allowedCountryIds] } }, { countryId: null }] },
      query.origin ? { origin: query.origin } : {},
      query.status === 'active' ? { isActive: true, claims: { some: {} } } : {},
      query.status === 'disabled' ? { isActive: false } : {},
      query.status === 'dormant' ? { claims: { none: {} } } : {},
      query.q?.trim()
        ? {
            OR: [
              { source: { contains: query.q.trim(), mode: 'insensitive' } },
              { destination: { contains: query.q.trim(), mode: 'insensitive' } },
              { note: { contains: query.q.trim(), mode: 'insensitive' } },
            ],
          }
        : {},
    ],
  };
  const pageSize = 25;
  const total = await prisma.redirect.count({ where });
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(query.page ?? 1, 1), pages);
  const rows = await prisma.redirect.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }],
    skip: (page - 1) * pageSize,
    take: pageSize,
    include: { _count: { select: { claims: true } } },
  });

  // Target names and current addresses, in two queries for the whole page.
  const targets = rows.filter((row) => row.targetEntityId && row.targetCountryId && row.targetType);
  const [routes, infos] = await Promise.all([
    prisma.urlRoute.findMany({
      where: { kind: 'CONTENT', entityId: { in: targets.map((row) => row.targetEntityId!) } },
      select: { entityId: true, countryId: true, path: true },
    }),
    root
      ? loadContentInfo(
          targets.map((row) => ({
            type: row.targetType as UrlContentType,
            entityId: row.targetEntityId!,
            countryId: row.targetCountryId!,
          })),
          root.id,
        )
      : Promise.resolve(new Map<string, ContentInfo>()),
  ]);

  return {
    total,
    page,
    pages,
    rows: rows.map((row) => {
      const key = `${row.targetEntityId}|${row.targetCountryId}`;
      const route = routes.find((entry) => `${entry.entityId}|${entry.countryId}` === key);
      return {
        id: row.id,
        source: row.source,
        destination: route ? withSuffix(route.path, row.destinationSuffix) : row.destination,
        target:
          row.targetEntityId && row.targetCountryId && row.targetType
            ? {
                entityId: row.targetEntityId,
                countryId: row.targetCountryId,
                type: row.targetType as UrlContentType,
                label: infos.get(key)?.label ?? null,
              }
            : null,
        type: row.type,
        isActive: row.isActive,
        origin: row.origin,
        allMarkets: row.allMarkets,
        hitCount: row.hitCount,
        lastHitAt: row.lastHitAt?.toISOString() ?? null,
        note: row.note,
        countryName: countries.find((country) => country.id === row.countryId)?.name ?? null,
        claims: row._count.claims,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      };
    }),
  };
}

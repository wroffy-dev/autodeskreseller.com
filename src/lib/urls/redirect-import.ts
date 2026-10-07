import 'server-only';
import { createHash } from 'node:crypto';
import type { Prisma, RedirectType } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { listCountries } from '@/lib/country/registry';
import { listAccessibleCountries } from '@/lib/country/access';
import type { CountryContext } from '@/lib/country/types';
import type { SessionUser } from '@/lib/auth/guards';
import { recordAudit } from '@/lib/services/audit';
import { siteUrl } from '@/lib/env';
import { describeOwner, loadContentInfo } from './content';
import {
  checkDestination,
  isExternalUrl,
  isReservedFirstSegment,
  pathKey,
  segmentsOf,
  splitDestinationSuffix,
  stripMarket,
  withSuffix,
} from './path';
import { normaliseSource, resolveDestination } from './redirect-rules';
import { readRedirectCsv } from './redirect-csv';
import { bumpRegistryVersion, withRegistry, type Tx } from './registry';
import { entityKey } from './snapshot';
import type { UrlContentType } from './types';

/**
 * Bulk redirects from a CSV (`URL,Destination URL`).
 *
 * The whole file is validated as one proposed change to the redirect graph —
 * every uploaded row together with every redirect that already exists — before
 * anything is written:
 *
 *  - a row whose address belongs to content (a page, a product, an article),
 *    or is a city's own address, is refused: a redirect never replaces live
 *    content, and nothing is ever overwritten silently;
 *  - a row identical to the rule already at its address is **unchanged**, so
 *    importing the same file twice changes nothing;
 *  - a row that disagrees with the rule already at its address is a
 *    **conflict** the editor settles explicitly — keep the existing rule or
 *    replace it — and the import cannot start until every one is settled;
 *  - the same address twice with different destinations is a conflict to fix
 *    in the file; twice with the same destination, a harmless duplicate;
 *  - loops are refused, whether they run through other rows of the file,
 *    existing rules, or both; chains are flattened, so every rule points
 *    straight at where visitors end up, and an existing rule that pointed at
 *    an address this file now redirects is re-pointed to the new end;
 *  - a destination that is content is stored by the content's id (with the
 *    destination's own query string and fragment), so it follows that content
 *    through every later move.
 *
 * Applying works the plan out again from current data and compares it with
 * the preview's fingerprint: if anything changed in between, nothing is
 * applied and the new preview is shown. The writes run in batches, each in one
 * transaction holding the registry lock and recorded on a `UrlOperation`, so a
 * large import shows its progress, an interrupted one can be resumed, and a
 * retried batch never applies anything twice: a rule already in place is
 * reported as such.
 */

export const REDIRECT_IMPORT_KIND = 'redirect-import';

/** Imports at or under this size run in one request; bigger ones in batches. */
export const IMPORT_BATCH = 50;

export type ImportStatus = 'create' | 'update' | 'unchanged' | 'duplicate' | 'kept' | 'conflict' | 'invalid';
export type ImportResolution = 'keep' | 'replace';

export type ImportExisting = {
  id: string;
  source: string;
  destination: string;
  type: RedirectType;
  isActive: boolean;
  origin: 'MANUAL' | 'AUTOMATIC';
  allMarkets: boolean;
  updatedAt: string;
};

export type ImportRow = {
  line: number;
  /** As written in the file. */
  url: string;
  destination: string;
  /** The address that will redirect, normalised; null when the row is invalid. */
  source: string | null;
  sourceKey: string | null;
  countryId: string | null;
  countryName: string | null;
  /** Where visitors will end up, after flattening, suffix included. */
  finalDestination: string | null;
  target: { type: UrlContentType; entityId: string; countryId: string; label: string | null } | null;
  suffix: string | null;
  external: boolean;
  status: ImportStatus;
  reason: string | null;
  /** Things worth knowing that do not stop the row: a flattened chain, a draft destination. */
  notes: string[];
  /** The rule answering for the address today. */
  existing: ImportExisting | null;
  /** A conflict the editor settles in the preview by keeping or replacing the existing rule. */
  resolvable: boolean;
  resolution: ImportResolution | null;
};

export type ImportRepoint = {
  redirectId: string;
  source: string;
  from: string;
  to: string;
  /** The file line whose redirect this rule now goes past. */
  viaLine: number;
};

export type RedirectImportPlan = {
  type: RedirectType;
  rows: ImportRow[];
  counts: Record<ImportStatus, number>;
  repoints: ImportRepoint[];
  /** Rules that will be written: creates, replacements and re-points. */
  writes: number;
  /** Resolvable conflicts nobody has decided yet; the import waits for them. */
  undecided: number;
  fingerprint: string;
};

export type RedirectImportInput = {
  text: string;
  type: RedirectType;
  /** Keyed by file line. */
  resolutions: Record<string, ImportResolution>;
};

function emptyCounts(): Record<ImportStatus, number> {
  return { create: 0, update: 0, unchanged: 0, duplicate: 0, kept: 0, conflict: 0, invalid: 0 };
}

function siteHosts(): Set<string> {
  try {
    const host = new URL(siteUrl()).hostname.toLowerCase();
    const bare = host.replace(/^www\./, '');
    return new Set([host, bare, `www.${bare}`]);
  } catch {
    return new Set();
  }
}

/** A destination as written: a same-site absolute URL becomes its path, query and fragment. */
function destinationValue(raw: string, hosts: ReadonlySet<string>): string {
  if (!isExternalUrl(raw)) return raw;
  try {
    const url = new URL(raw);
    if (hosts.has(url.hostname.toLowerCase())) return `${url.pathname || '/'}${url.search}${url.hash}`;
  } catch {
    // checkDestination explains it.
  }
  return raw;
}

function hasQueryOrFragment(raw: string): boolean {
  if (isExternalUrl(raw)) {
    try {
      const url = new URL(raw);
      return Boolean(url.search || url.hash);
    } catch {
      return false;
    }
  }
  return /[?#]/.test(raw);
}

type Claim = Prisma.UrlRouteGetPayload<{ include: { redirect: true } }>;

/** Where a row ends, worked out over the file and the registry together. */
type Final =
  | {
      ok: true;
      destination: string;
      external: boolean;
      target: { type: UrlContentType; entityId: string; countryId: string } | null;
      suffix: string | null;
      flattenedVia: number[];
      viaRules: string[];
      unknown: boolean;
      disabledHop: string | null;
    }
  | { ok: false; error: string };

/**
 * Validates a redirect CSV against the registry and against itself.
 * Read-only: nothing is written.
 */
export async function planRedirectImport(
  user: SessionUser,
  input: RedirectImportInput,
): Promise<RedirectImportPlan | { error: string }> {
  const parsed = readRedirectCsv(input.text);
  if (!parsed.ok) return { error: parsed.error };

  const [countries, mine] = await Promise.all([
    listCountries(),
    listAccessibleCountries(user, { includeInactive: true }),
  ]);
  const root = countries.find((country) => country.isDefault) ?? countries[0];
  if (!root) return { error: 'No market is configured.' };
  const allowed = new Set(mine.map((country) => country.id));
  const prefixes = countries.map((country) => country.slug).filter(Boolean);
  const hosts = siteHosts();

  // ---------------------------------------------------------------------
  // 1. Each row on its own.
  // ---------------------------------------------------------------------
  const rows: ImportRow[] = parsed.rows.map((row) => {
    const out: ImportRow = {
      line: row.line,
      url: row.url,
      destination: row.destination,
      source: null,
      sourceKey: null,
      countryId: null,
      countryName: null,
      finalDestination: null,
      target: null,
      suffix: null,
      external: false,
      status: 'invalid',
      reason: null,
      notes: [],
      existing: null,
      resolvable: false,
      resolution: input.resolutions[String(row.line)] ?? null,
    };
    const invalid = (reason: string) => ({ ...out, status: 'invalid' as const, reason });

    if (!row.url) return invalid('The URL column is empty.');
    if (!row.destination) return invalid('The Destination URL column is empty.');
    if (hasQueryOrFragment(row.url)) {
      return invalid('A redirect matches an address’s path. Remove the query string or fragment from the URL.');
    }
    const source = normaliseSource(row.url);
    if (!source.ok) return invalid(source.error);
    const key = pathKey(source.path)!;

    const segments = segmentsOf(key);
    const market = countries.find((country) => country.slug && country.slug === segments[0]) ?? null;
    const owner: CountryContext = market ?? root;
    const rest = market ? segments.slice(1) : segments;
    if (rest.length === 0) return invalid(`${source.path} is the home page of ${owner.name}; it cannot be redirected.`);
    if (isReservedFirstSegment(rest[0]!, { marketPrefixes: prefixes })) {
      return invalid(`“/${rest[0]}” is a system route; it cannot be redirected.`);
    }
    if (!allowed.has(owner.id)) return invalid(`You cannot write redirects for ${owner.name}.`);

    const destination = destinationValue(row.destination, hosts);
    const checked = checkDestination(destination);
    if (!checked.ok) return invalid(checked.error);
    if (!checked.external && pathKey(splitDestinationSuffix(checked.destination).path) === key) {
      return invalid('A redirect cannot point at itself.');
    }

    return {
      ...out,
      destination: checked.destination,
      source: source.path,
      sourceKey: key,
      countryId: owner.id,
      countryName: owner.name,
      external: checked.external,
      status: 'create' as const,
    };
  });

  // ---------------------------------------------------------------------
  // 2. Rows against each other: one address, one destination.
  // ---------------------------------------------------------------------
  const bySource = new Map<string, ImportRow[]>();
  for (const row of rows) {
    if (row.status !== 'create' || !row.sourceKey) continue;
    bySource.set(row.sourceKey, [...(bySource.get(row.sourceKey) ?? []), row]);
  }
  for (const group of bySource.values()) {
    if (group.length < 2) continue;
    const destinations = new Set(group.map((row) => row.destination));
    if (destinations.size === 1) {
      for (const row of group.slice(1)) {
        row.status = 'duplicate';
        row.reason = `Same as line ${group[0]!.line}; imported once.`;
      }
    } else {
      for (const row of group) {
        row.status = 'conflict';
        row.reason = `${row.source} appears on lines ${group.map((entry) => entry.line).join(', ')} with different destinations. Keep one in the file.`;
      }
    }
  }

  // ---------------------------------------------------------------------
  // 3. Rows against the registry: who answers for each address today.
  // ---------------------------------------------------------------------
  const candidates = rows.filter((row) => row.status === 'create');
  const keys = candidates.map((row) => row.sourceKey!);
  const claimCache = new Map<string, Claim | null>();
  const claims = keys.length
    ? await prisma.urlRoute.findMany({ where: { pathKey: { in: keys } }, include: { redirect: true } })
    : [];
  for (const key of keys) claimCache.set(key, null);
  for (const claim of claims) claimCache.set(claim.pathKey, claim);

  const contentClaims = claims.filter((claim) => claim.kind === 'CONTENT' && claim.type && claim.entityId);
  const contentInfo = contentClaims.length
    ? await loadContentInfo(
        contentClaims.map((claim) => ({ type: claim.type as UrlContentType, entityId: claim.entityId!, countryId: claim.countryId })),
        root.id,
      )
    : new Map();

  // City roots: a city's own address belongs to its landing page.
  const singleSegment = candidates.filter((row) => segmentsOf(stripMarket(marketSlug(countries, row.countryId!), row.sourceKey!)).length === 1);
  const cities = singleSegment.length
    ? await prisma.city.findMany({
        where: {
          OR: singleSegment.map((row) => ({
            countryId: row.countryId!,
            slug: segmentsOf(stripMarket(marketSlug(countries, row.countryId!), row.sourceKey!))[0]!,
          })),
        },
        select: { name: true, slug: true, countryId: true },
      })
    : [];

  for (const row of candidates) {
    const claim = claimCache.get(row.sourceKey!) ?? null;
    const relative = stripMarket(marketSlug(countries, row.countryId!), row.sourceKey!);
    const city = cities.find(
      (entry) => entry.countryId === row.countryId && segmentsOf(relative).length === 1 && entry.slug === segmentsOf(relative)[0],
    );
    if (city) {
      row.status = 'conflict';
      row.reason = `${row.source} is the address of the city ${city.name}; only its landing page can live there.`;
      continue;
    }
    if (claim?.kind === 'CONTENT') {
      const info = contentInfo.get(entityKey(claim.entityId ?? '', claim.countryId));
      row.status = 'conflict';
      row.reason = `${claim.path} is the address of ${info ? describeOwner(info) : 'content'}. A redirect never replaces content; change that content’s address in All URLs first.`;
      continue;
    }
    if (claim?.kind === 'REDIRECT' && claim.redirect) {
      const rule = claim.redirect;
      row.existing = {
        id: rule.id,
        source: rule.source,
        destination: rule.destination,
        type: rule.type,
        isActive: rule.isActive,
        origin: rule.origin,
        allMarkets: rule.allMarkets,
        updatedAt: rule.updatedAt.toISOString(),
      };
      if (rule.countryId && !allowed.has(rule.countryId)) {
        row.status = 'conflict';
        row.reason = 'A redirect in a market you cannot edit already answers for this address.';
        row.existing = null;
      }
    }
  }

  // ---------------------------------------------------------------------
  // 4. The proposed graph: where every row ends, through the file and the
  //    rules that will remain.
  // ---------------------------------------------------------------------
  const live = candidates.filter((row) => row.status === 'create');
  /** Addresses this import will redirect: new ones, and ones replaced by choice. */
  const fileEdges = new Map<string, ImportRow>();
  for (const row of live) {
    if (!row.existing || row.resolution === 'replace') fileEdges.set(row.sourceKey!, row);
  }

  async function claimAt(key: string): Promise<Claim | null> {
    if (claimCache.has(key)) return claimCache.get(key)!;
    const claim = await prisma.urlRoute.findUnique({ where: { pathKey: key }, include: { redirect: true } });
    claimCache.set(key, claim);
    return claim;
  }

  async function routeOf(entityId: string, countryId: string) {
    return prisma.urlRoute.findUnique({ where: { entityId_countryId: { entityId, countryId } } });
  }

  async function follow(row: ImportRow): Promise<Final> {
    if (row.external) {
      return { ok: true, destination: row.destination, external: true, target: null, suffix: null, flattenedVia: [], viaRules: [], unknown: false, disabledHop: null };
    }
    const written = splitDestinationSuffix(row.destination);
    let path = written.path;
    let suffix = written.suffix;
    const visited = new Set<string>([row.sourceKey!]);
    const chain = [row.source!, path];
    const flattenedVia: number[] = [];
    const viaRules: string[] = [];
    let disabledHop: string | null = null;
    const loop = () => ({ ok: false as const, error: `That would create a redirect loop: ${chain.join(' → ')}` });

    for (let hop = 0; hop < 20; hop += 1) {
      const key = pathKey(path);
      if (!key) return { ok: false, error: 'The destination is not a valid path.' };
      if (visited.has(key)) return loop();
      visited.add(key);

      const edge = fileEdges.get(key);
      if (edge && edge !== row) {
        flattenedVia.push(edge.line);
        if (edge.external) {
          return { ok: true, destination: edge.destination, external: true, target: null, suffix: null, flattenedVia, viaRules, unknown: false, disabledHop };
        }
        const next = splitDestinationSuffix(edge.destination);
        path = next.path;
        suffix = suffix ?? next.suffix;
        chain.push(path);
        continue;
      }

      const claim = await claimAt(key);
      if (!claim) {
        return { ok: true, destination: withSuffix(path, suffix), external: false, target: null, suffix: null, flattenedVia, viaRules, unknown: true, disabledHop };
      }
      if (claim.kind === 'CONTENT' && claim.type && claim.entityId) {
        return {
          ok: true,
          destination: withSuffix(claim.path, suffix),
          external: false,
          target: { type: claim.type as UrlContentType, entityId: claim.entityId, countryId: claim.countryId },
          suffix,
          flattenedVia,
          viaRules,
          unknown: false,
          disabledHop,
        };
      }
      const rule = claim.redirect;
      if (!rule) {
        return { ok: true, destination: withSuffix(path, suffix), external: false, target: null, suffix: null, flattenedVia, viaRules, unknown: true, disabledHop };
      }
      if (!rule.isActive) {
        // A switched-off rule answers 404 at its address; going there is going nowhere.
        disabledHop = claim.path;
        return { ok: true, destination: withSuffix(path, suffix), external: false, target: null, suffix: null, flattenedVia, viaRules, unknown: false, disabledHop };
      }
      viaRules.push(rule.source);
      if (rule.targetEntityId && rule.targetCountryId && rule.targetType) {
        const route = await routeOf(rule.targetEntityId, rule.targetCountryId);
        if (route && visited.has(route.pathKey)) {
          chain.push(route.path);
          return loop();
        }
        const kept = suffix ?? rule.destinationSuffix ?? null;
        return {
          ok: true,
          destination: withSuffix(route?.path ?? splitDestinationSuffix(rule.destination).path, kept),
          external: false,
          target: { type: rule.targetType as UrlContentType, entityId: rule.targetEntityId, countryId: rule.targetCountryId },
          suffix: kept,
          flattenedVia,
          viaRules,
          unknown: false,
          disabledHop,
        };
      }
      if (isExternalUrl(rule.destination)) {
        return { ok: true, destination: rule.destination, external: true, target: null, suffix: null, flattenedVia, viaRules, unknown: false, disabledHop };
      }
      const next = splitDestinationSuffix(rule.destination);
      path = next.path;
      suffix = suffix ?? next.suffix;
      chain.push(path);
    }
    return { ok: false, error: `The destination redirects too many times: ${chain.join(' → ')}` };
  }

  for (const row of live) {
    const final = await follow(row);
    if (!final.ok) {
      row.status = 'conflict';
      row.reason = final.error;
      continue;
    }
    row.finalDestination = final.destination;
    row.target = final.target ? { ...final.target, label: null } : null;
    row.suffix = final.target ? final.suffix : null;
    row.external = final.external;
    if (final.flattenedVia.length > 0) {
      row.notes.push(`Goes straight to the end of line${final.flattenedVia.length > 1 ? 's' : ''} ${final.flattenedVia.join(', ')}, so there is no chain.`);
    }
    if (final.viaRules.length > 0) {
      row.notes.push(`${final.viaRules.join(', ')} already redirect${final.viaRules.length > 1 ? '' : 's'} onward; this goes straight to the end.`);
    }
    if (final.unknown) row.notes.push(`Nothing is registered at ${splitDestinationSuffix(final.destination).path} yet; visitors get a 404 until something is published there.`);
    if (final.disabledHop) row.notes.push(`${final.disabledHop} is a switched-off redirect; visitors get a 404 there.`);
  }

  // Content labels and liveness for the destinations, in one batch.
  const targets = live.filter((row) => row.status === 'create' && row.target).map((row) => row.target!);
  if (targets.length > 0) {
    const infos = await loadContentInfo(targets, root.id);
    for (const row of live) {
      if (!row.target) continue;
      const info = infos.get(entityKey(row.target.entityId, row.target.countryId));
      row.target.label = info?.label ?? null;
      if (info && info.state !== 'live') {
        row.notes.push(`“${info.label}” is not published yet; the redirect answers 404 until it is.`);
      }
    }
  }

  // ---------------------------------------------------------------------
  // 5. Rows that meet an existing rule: identical, or a decision.
  // ---------------------------------------------------------------------
  const existingRules = new Map(
    (
      await prisma.redirect.findMany({
        where: { id: { in: live.map((row) => row.existing?.id).filter((id): id is string => Boolean(id)) } },
      })
    ).map((rule) => [rule.id, rule]),
  );
  for (const row of live) {
    if (row.status !== 'create' || !row.existing) continue;
    const rule = existingRules.get(row.existing.id);
    if (!rule) continue;
    let landing: string = rule.destination;
    if (rule.targetEntityId && rule.targetCountryId) {
      const route = await routeOf(rule.targetEntityId, rule.targetCountryId);
      landing = withSuffix(route?.path ?? splitDestinationSuffix(rule.destination).path, rule.destinationSuffix);
    }
    row.existing.destination = landing;
    const same =
      sameLanding(landing, row.finalDestination ?? '') && rule.type === input.type && rule.isActive;
    if (same) {
      row.status = 'unchanged';
      row.reason = 'This redirect is already in place.';
      continue;
    }
    row.resolvable = true;
    const differences = [
      !sameLanding(landing, row.finalDestination ?? '') ? `goes to ${landing}` : null,
      rule.type !== input.type ? `is ${rule.type === 'PERMANENT' ? 'permanent (308)' : 'temporary (307)'}` : null,
      !rule.isActive ? 'is switched off' : null,
    ].filter(Boolean);
    if (row.resolution === 'replace') {
      row.status = 'update';
      row.reason = `Replaces the ${rule.origin === 'AUTOMATIC' ? 'automatic ' : ''}redirect that ${differences.join(' and ')}.`;
      if (rule.allMarkets) row.notes.push('The existing rule applies under every market prefix; it keeps its other addresses.');
    } else if (row.resolution === 'keep') {
      row.status = 'kept';
      row.reason = `Keeps the existing redirect, which ${differences.join(' and ')}.`;
    } else {
      row.status = 'conflict';
      row.reason = `${rule.origin === 'AUTOMATIC' ? 'An automatic' : 'A'} redirect already answers for ${row.source} and ${differences.join(' and ')}. Choose whether to keep it or replace it.`;
    }
  }

  // ---------------------------------------------------------------------
  // 6. Existing rules that would become the first link of a chain.
  // ---------------------------------------------------------------------
  const writing = new Map(
    live.filter((row) => row.status === 'create' || row.status === 'update').map((row) => [row.sourceKey!, row]),
  );
  const repoints: ImportRepoint[] = [];
  if (writing.size > 0) {
    const pointing = await prisma.redirect.findMany({
      where: { targetEntityId: null, destination: { startsWith: '/' } },
      select: { id: true, source: true, destination: true, countryId: true, claims: { select: { pathKey: true } } },
    });
    const replaced = new Set(live.filter((row) => row.status === 'update').map((row) => row.existing?.id));
    for (const rule of pointing) {
      if (replaced.has(rule.id)) continue;
      const key = pathKey(splitDestinationSuffix(rule.destination).path);
      const via = key ? writing.get(key) : undefined;
      if (!via || !via.finalDestination) continue;
      if (rule.claims.some((claim) => claim.pathKey === pathKey(splitDestinationSuffix(via.finalDestination!).path))) continue;
      if (rule.countryId && !allowed.has(rule.countryId)) {
        via.status = 'conflict';
        via.resolvable = false;
        via.reason = `The redirect ${rule.source} points at ${via.source} and is in a market you cannot edit; importing this row would make it a chain.`;
        continue;
      }
      repoints.push({ redirectId: rule.id, source: rule.source, from: rule.destination, to: via.finalDestination, viaLine: via.line });
    }
  }
  const stillWriting = new Set(rows.filter((row) => row.status === 'create' || row.status === 'update').map((row) => row.line));
  const keptRepoints = repoints.filter((entry) => stillWriting.has(entry.viaLine));

  const counts = emptyCounts();
  for (const row of rows) counts[row.status] += 1;
  const undecided = rows.filter((row) => row.status === 'conflict' && row.resolvable && !row.resolution).length;

  return {
    type: input.type,
    rows,
    counts,
    repoints: keptRepoints,
    writes: counts.create + counts.update + keptRepoints.length,
    undecided,
    fingerprint: fingerprintOf(input.type, rows, keptRepoints),
  };
}

function marketSlug(countries: readonly CountryContext[], countryId: string): string {
  return countries.find((country) => country.id === countryId)?.slug ?? '';
}

/** Two destinations land on the same address: same path key, same suffix, or the same external URL. */
function sameLanding(a: string, b: string): boolean {
  if (isExternalUrl(a) || isExternalUrl(b)) return a === b;
  const left = splitDestinationSuffix(a);
  const right = splitDestinationSuffix(b);
  return pathKey(left.path) === pathKey(right.path) && (left.suffix ?? '') === (right.suffix ?? '');
}

/** What a preview committed to, so an out-of-date one is never applied. */
function fingerprintOf(type: RedirectType, rows: readonly ImportRow[], repoints: readonly ImportRepoint[]): string {
  const lines = rows.map((row) => [
    row.line,
    row.status,
    row.sourceKey,
    row.finalDestination,
    row.target?.entityId ?? null,
    row.target?.countryId ?? null,
    row.suffix,
    row.existing?.id ?? null,
    row.existing?.updatedAt ?? null,
  ]);
  return createHash('sha256')
    .update(JSON.stringify({ type, lines, repoints: repoints.map((entry) => [entry.redirectId, entry.to]) }))
    .digest('hex')
    .slice(0, 24);
}

// ---------------------------------------------------------------------------
// Applying
// ---------------------------------------------------------------------------

type WriteItem = {
  kind: 'write';
  line: number;
  mode: 'create' | 'update';
  source: string;
  sourceKey: string;
  countryId: string;
  destination: string;
  target: { type: UrlContentType; entityId: string; countryId: string } | null;
  suffix: string | null;
  existingId: string | null;
  existingUpdatedAt: string | null;
};

type RepointItem = { kind: 'repoint'; redirectId: string; source: string; viaLine: number };

type ImportItem = WriteItem | RepointItem;

export type ImportItemResult = {
  key: string;
  ok: boolean;
  /** created, replaced, unchanged, repointed, failed */
  outcome: 'created' | 'replaced' | 'unchanged' | 'repointed' | 'failed';
  message: string;
  oldPath: string | null;
  newPath: string | null;
};

export type RedirectImportView = {
  id: string;
  status: string;
  summary: string;
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  results: ImportItemResult[];
  createdAt: string;
  finishedAt: string | null;
};

function importView(row: Prisma.UrlOperationGetPayload<object>): RedirectImportView {
  return {
    id: row.id,
    status: row.status,
    summary: row.summary,
    total: row.total,
    processed: row.processed,
    succeeded: row.succeeded,
    failed: row.failed,
    results: (row.results as unknown as ImportItemResult[] | null) ?? [],
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}

/**
 * Records a previewed plan as an operation and starts it. The caller has just
 * worked the plan out again and checked it against the preview's fingerprint.
 */
export async function startRedirectImport(user: SessionUser, plan: RedirectImportPlan): Promise<RedirectImportView> {
  const writes: WriteItem[] = plan.rows
    .filter((row) => row.status === 'create' || row.status === 'update')
    .map((row) => ({
      kind: 'write',
      line: row.line,
      mode: row.status === 'update' ? 'update' : 'create',
      source: row.source!,
      sourceKey: row.sourceKey!,
      countryId: row.countryId!,
      destination: row.finalDestination!,
      target: row.target ? { type: row.target.type, entityId: row.target.entityId, countryId: row.target.countryId } : null,
      suffix: row.suffix,
      existingId: row.status === 'update' ? (row.existing?.id ?? null) : null,
      existingUpdatedAt: row.status === 'update' ? (row.existing?.updatedAt ?? null) : null,
    }));
  const repoints: RepointItem[] = plan.repoints.map((entry) => ({
    kind: 'repoint',
    redirectId: entry.redirectId,
    source: entry.source,
    viaLine: entry.viaLine,
  }));
  const items: ImportItem[] = [...writes, ...repoints];
  const summary = `Redirect CSV: ${writes.filter((item) => item.mode === 'create').length} new, ${writes.filter((item) => item.mode === 'update').length} replaced, ${repoints.length} re-pointed (${plan.type === 'PERMANENT' ? '308' : '307'})`;

  const operation = await prisma.urlOperation.create({
    data: {
      kind: REDIRECT_IMPORT_KIND,
      status: 'PENDING',
      summary,
      total: items.length,
      plan: { type: plan.type, items } as unknown as Prisma.InputJsonValue,
      results: [],
      actorId: user.id,
      actorEmail: user.email,
    },
  });
  await recordAudit({
    actor: user,
    action: 'redirects.import.started',
    entity: 'UrlOperation',
    entityId: operation.id,
    summary,
  });
  if (items.length <= IMPORT_BATCH) return runRedirectImport(user, operation.id, Math.max(items.length, 1));
  return importView(operation);
}

/**
 * Applies the next batch of an import. Read, applied and recorded in one
 * transaction under the registry lock: two people resuming the same import
 * take turns, and the second continues where the first stopped. A batch that
 * fails rolls back as a whole and is recorded, so it can be retried; a rule a
 * retry finds already in place is reported as unchanged, never written twice.
 */
export async function runRedirectImport(
  user: SessionUser,
  id: string,
  batch = IMPORT_BATCH,
): Promise<RedirectImportView> {
  const [countries, mine] = await Promise.all([
    listCountries(),
    listAccessibleCountries(user, { includeInactive: true }),
  ]);
  const allowed = new Set(mine.map((country) => country.id));
  let outcome: { row: Prisma.UrlOperationGetPayload<object>; finishedNow: boolean };
  try {
    outcome = await withRegistry(
      async (tx) => {
        const operation = await tx.urlOperation.findUnique({ where: { id } });
        if (!operation || operation.kind !== REDIRECT_IMPORT_KIND) throw new Error('That import no longer exists.');
        if (operation.status === 'COMPLETED' || operation.status === 'PARTIAL' || operation.status === 'FAILED') {
          return { row: operation, finishedNow: false };
        }
        const plan = operation.plan as unknown as { type: RedirectType; items: ImportItem[] };
        const next = plan.items.slice(operation.processed, operation.processed + batch);
        const results: ImportItemResult[] = [];
        for (const item of next) {
          results.push(
            item.kind === 'write'
              ? await applyWrite(tx, user, item, plan.type, allowed, countries)
              : await applyRepoint(tx, user, item, allowed),
          );
        }
        if (results.some((result) => result.ok && result.outcome !== 'unchanged')) await bumpRegistryVersion(tx);

        const processed = operation.processed + next.length;
        const succeeded = operation.succeeded + results.filter((result) => result.ok).length;
        const failed = operation.failed + results.filter((result) => !result.ok).length;
        const finished = processed >= plan.items.length;
        const updated = await tx.urlOperation.update({
          where: { id },
          data: {
            processed,
            succeeded,
            failed,
            status: finished ? (failed > 0 ? 'PARTIAL' : 'COMPLETED') : 'RUNNING',
            finishedAt: finished ? new Date() : null,
            results: [
              ...((operation.results as unknown as ImportItemResult[] | null) ?? []),
              ...results,
            ] as unknown as Prisma.InputJsonValue,
          },
        });
        return { row: updated, finishedNow: finished };
      },
      { timeoutMs: 60_000 },
    );
  } catch (error) {
    const operation = await prisma.urlOperation.findUnique({ where: { id } });
    if (!operation) throw error;
    const message = error instanceof Error ? error.message : 'The batch failed.';
    const recorded = await prisma.urlOperation.update({
      where: { id },
      data: {
        status: 'RUNNING',
        results: [
          ...((operation.results as unknown as ImportItemResult[] | null) ?? []),
          { key: 'batch', ok: false, outcome: 'failed', message: `Batch not applied, nothing in it was saved: ${message}`, oldPath: null, newPath: null },
        ] as unknown as Prisma.InputJsonValue,
      },
    });
    return importView(recorded);
  }

  if (outcome.finishedNow) {
    await recordAudit({
      actor: user,
      action: 'redirects.import.finished',
      entity: 'UrlOperation',
      entityId: id,
      summary: `${outcome.row.summary} — ${outcome.row.succeeded} done, ${outcome.row.failed} not applied`,
    });
  }
  return importView(outcome.row);
}

function sameRule(
  rule: { destination: string; targetEntityId: string | null; targetCountryId: string | null; destinationSuffix: string | null; type: RedirectType; isActive: boolean },
  item: WriteItem,
  type: RedirectType,
): boolean {
  if (rule.type !== type || !rule.isActive) return false;
  if (item.target) {
    return (
      rule.targetEntityId === item.target.entityId &&
      rule.targetCountryId === item.target.countryId &&
      (rule.destinationSuffix ?? null) === (item.suffix ?? null)
    );
  }
  return !rule.targetEntityId && sameLanding(rule.destination, item.destination);
}

async function applyWrite(
  tx: Tx,
  user: SessionUser,
  item: WriteItem,
  type: RedirectType,
  allowed: ReadonlySet<string>,
  countries: readonly CountryContext[],
): Promise<ImportItemResult> {
  const key = `line ${item.line}`;
  const fail = (message: string): ImportItemResult => ({ key, ok: false, outcome: 'failed', message, oldPath: item.source, newPath: item.destination });
  if (!allowed.has(item.countryId)) return fail('You cannot write redirects for this market.');

  // The destination, as it is now.
  let destination = item.destination;
  if (item.target) {
    const route = await tx.urlRoute.findUnique({
      where: { entityId_countryId: { entityId: item.target.entityId, countryId: item.target.countryId } },
    });
    if (!route) return fail('The destination no longer has an address. Nothing was written for this line.');
    if (route.pathKey === item.sourceKey) return fail('The destination now lives at this address; a redirect cannot point at itself.');
    destination = withSuffix(route.path, item.suffix);
  }

  const claim = await tx.urlRoute.findUnique({ where: { pathKey: item.sourceKey }, include: { redirect: true } });
  if (claim?.kind === 'CONTENT') return fail('Content took this address after the preview; it was left as it is.');

  const data = {
    destination,
    type,
    isActive: true,
    targetType: item.target?.type ?? null,
    targetEntityId: item.target?.entityId ?? null,
    targetCountryId: item.target?.countryId ?? null,
    destinationSuffix: item.target ? item.suffix : null,
    updatedById: user.id,
  } satisfies Prisma.RedirectUncheckedUpdateInput;

  if (claim?.kind === 'REDIRECT' && claim.redirect) {
    const rule = claim.redirect;
    if (sameRule(rule, { ...item, destination }, type)) {
      return { key, ok: true, outcome: 'unchanged', message: 'Already in place.', oldPath: item.source, newPath: destination };
    }
    if (item.mode === 'create' || rule.id !== item.existingId) {
      return fail('Another redirect took this address after the preview; it was left as it is.');
    }
    if (rule.updatedAt.toISOString() !== item.existingUpdatedAt) {
      return fail('The existing redirect was edited after the preview; it was left as it is.');
    }
    if (rule.countryId && !allowed.has(rule.countryId)) return fail('The existing redirect is in a market you cannot edit.');
    if (rule.allMarkets) {
      // An every-market rule keeps its other addresses; this one gets a rule of its own.
      await tx.urlRoute.delete({ where: { id: claim.id } });
      return createRule(tx, user, item, data, key);
    }
    await tx.redirect.update({
      where: { id: rule.id },
      data: { ...data, origin: 'MANUAL', note: rule.note ?? `Imported from CSV (line ${item.line})` },
    });
    await resolveNotFound(tx, item.sourceKey, rule.id);
    return { key, ok: true, outcome: 'replaced', message: `Replaced the redirect that went to ${rule.destination}.`, oldPath: item.source, newPath: destination };
  }

  // Free: a city's own address is still refused.
  const market = countries.find((country) => country.id === item.countryId);
  const relative = stripMarket(market?.slug ?? '', item.sourceKey);
  if (segmentsOf(relative).length === 1) {
    const city = await tx.city.findUnique({
      where: { countryId_slug: { countryId: item.countryId, slug: segmentsOf(relative)[0]! } },
      select: { name: true },
    });
    if (city) return fail(`This is the address of the city ${city.name}.`);
  }
  return createRule(tx, user, item, data, key);
}

async function createRule(
  tx: Tx,
  user: SessionUser,
  item: WriteItem,
  data: Prisma.RedirectUncheckedUpdateInput & { destination: string },
  key: string,
): Promise<ImportItemResult> {
  const rule = await tx.redirect.create({
    data: {
      ...(data as Prisma.RedirectUncheckedCreateInput),
      source: item.source,
      note: `Imported from CSV (line ${item.line})`,
      countryId: item.countryId,
      allMarkets: false,
      origin: 'MANUAL',
      createdById: user.id,
    },
  });
  await tx.urlRoute.create({
    data: { kind: 'REDIRECT', path: item.sourceKey, pathKey: item.sourceKey, countryId: item.countryId, redirectId: rule.id },
  });
  await resolveNotFound(tx, item.sourceKey, rule.id);
  return { key, ok: true, outcome: item.mode === 'update' ? 'replaced' : 'created', message: 'Created.', oldPath: item.source, newPath: data.destination };
}

/** A 404 URL Health was tracking at this address now redirects. */
async function resolveNotFound(tx: Tx, key: string, redirectId: string): Promise<void> {
  await tx.urlNotFound.updateMany({ where: { pathKey: key, status: 'OPEN' }, data: { status: 'RESOLVED', redirectId } });
}

/** Points an existing rule straight at where a newly imported redirect ends. */
async function applyRepoint(
  tx: Tx,
  user: SessionUser,
  item: RepointItem,
  allowed: ReadonlySet<string>,
): Promise<ImportItemResult> {
  const key = `redirect ${item.source}`;
  const rule = await tx.redirect.findUnique({ where: { id: item.redirectId }, include: { claims: { select: { pathKey: true } } } });
  if (!rule) return { key, ok: true, outcome: 'unchanged', message: 'That redirect was deleted meanwhile.', oldPath: item.source, newPath: null };
  if (rule.countryId && !allowed.has(rule.countryId)) {
    return { key, ok: false, outcome: 'failed', message: 'That redirect is in a market you cannot edit.', oldPath: rule.source, newPath: null };
  }
  if (rule.targetEntityId) {
    return { key, ok: true, outcome: 'unchanged', message: 'Already points at content by id.', oldPath: rule.source, newPath: rule.destination };
  }
  const sourceKeys = new Set(rule.claims.map((claim) => claim.pathKey));
  const resolved = await resolveDestination(tx, { destination: rule.destination, target: null }, sourceKeys, rule.id);
  if ('error' in resolved) {
    return { key, ok: false, outcome: 'failed', message: resolved.error, oldPath: rule.source, newPath: null };
  }
  if (!resolved.flattened) {
    return { key, ok: true, outcome: 'unchanged', message: 'Nothing to straighten.', oldPath: rule.source, newPath: rule.destination };
  }
  await tx.redirect.update({
    where: { id: rule.id },
    data: {
      destination: resolved.destination,
      targetType: resolved.target?.type ?? null,
      targetEntityId: resolved.target?.entityId ?? null,
      targetCountryId: resolved.target?.countryId ?? null,
      destinationSuffix: resolved.target ? resolved.suffix : null,
      updatedById: user.id,
    },
  });
  return {
    key,
    ok: true,
    outcome: 'repointed',
    message: `Now goes straight to ${resolved.destination} instead of through line ${item.viaLine}.`,
    oldPath: rule.source,
    newPath: resolved.destination,
  };
}

/** Recent imports, newest first, for resuming one that did not finish. */
export async function listRedirectImports(): Promise<RedirectImportView[]> {
  const rows = await prisma.urlOperation.findMany({
    where: { kind: REDIRECT_IMPORT_KIND },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });
  return rows.map((row) => ({ ...importView(row), results: [] }));
}

export async function getRedirectImport(id: string): Promise<RedirectImportView | null> {
  const row = await prisma.urlOperation.findUnique({ where: { id } });
  return row && row.kind === REDIRECT_IMPORT_KIND ? importView(row) : null;
}

/** The row-level results as a CSV the editor can keep. */
export function importResultsCsv(view: RedirectImportView): string[][] {
  return [
    ['Item', 'Outcome', 'URL', 'Destination URL', 'Message'],
    ...view.results.map((result) => [result.key, result.outcome, result.oldPath ?? '', result.newPath ?? '', result.message]),
  ];
}

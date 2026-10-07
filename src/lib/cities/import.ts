import 'server-only';
import { createHash } from 'node:crypto';
import { prisma } from '@/lib/db/prisma';
import type { SessionUser } from '@/lib/auth/guards';
import { userCan } from '@/lib/auth/guards';
import { listAccessibleCountries } from '@/lib/country/access';
import type { CountryContext } from '@/lib/country/types';
import { parseCsvLines } from '@/lib/urls/csv';
import { citySpaceProblems, describeCitySpaceProblems } from '@/lib/urls/cities';
import { UrlRegistryError } from '@/lib/urls/errors';
import { joinMarket } from '@/lib/urls/path';
import { withRegistry } from '@/lib/urls/registry';
import { cityInputSchema, MAX_CITY_IMPORT_ROWS, suggestCitySlug } from '@/lib/validation/city';
import { createLandingPage } from './manage';
import { CITY_STATUS_LABELS, cityStatusColumns, isCityStatus, type CityStatus } from './status';

/**
 * Bulk city import from a CSV.
 *
 * ```
 * Name,Slug,Country,Region,Status
 * Delhi,delhi,IN,,DRAFT
 * Gurugram,gurugram,IN,Haryana,DRAFT
 * Dubai,dubai,AE,,DRAFT
 * ```
 *
 * `Name` and `Country` (ISO code, name or URL prefix) are required; `Slug`
 * follows the name when blank; `Region` is optional; `Status` is DRAFT unless
 * the file says PUBLISHED or ARCHIVED (publishing needs the publish
 * permission). Every row is checked like the city form checks one city —
 * including whether the slug's address space is free in the URL registry —
 * before anything is written.
 *
 * An import only ever **creates** cities. A row naming a city that already
 * exists in its market is reported and left alone, so running a file twice,
 * or retrying a part that failed, never changes or duplicates anything.
 */

export type CityImportStatus = 'create' | 'exists' | 'duplicate' | 'conflict' | 'invalid';

export type CityImportRow = {
  line: number;
  name: string;
  slug: string;
  region: string | null;
  status: CityStatus;
  countryId: string | null;
  countryName: string | null;
  path: string | null;
  outcome: CityImportStatus;
  reason: string | null;
};

export type CityImportPlan = {
  rows: CityImportRow[];
  counts: Record<CityImportStatus, number>;
  fingerprint: string;
};

export type CityImportResult = {
  line: number;
  name: string;
  path: string | null;
  outcome: 'created' | 'skipped' | 'failed';
  cityId: string | null;
  landingPageId: string | null;
  reason: string | null;
};

const HEADERS: Record<string, keyof Pick<CityImportRow, 'name' | 'slug' | 'region' | 'status'> | 'country'> = {
  name: 'name',
  city: 'name',
  slug: 'slug',
  country: 'country',
  market: 'country',
  region: 'region',
  state: 'region',
  status: 'status',
};

type Parsed = { line: number; name: string; slug: string; country: string; region: string; status: string };

export function readCityCsv(text: string): { ok: true; rows: Parsed[] } | { ok: false; error: string } {
  const table = parseCsvLines(text);
  if (table.length === 0) return { ok: false, error: 'The file is empty.' };
  const header = table[0]!.cells.map((cell) => cell.replace(/^﻿/, '').trim().toLowerCase());
  const at = (field: string) => header.findIndex((cell) => HEADERS[cell] === field);
  const unknown = header.filter((cell) => cell && !(cell in HEADERS));
  if (unknown.length > 0) {
    return { ok: false, error: `Unknown column${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}. Use Name, Slug, Country, Region and Status.` };
  }
  if (at('name') < 0 || at('country') < 0) {
    return { ok: false, error: 'The file needs at least Name and Country columns. Download the sample to start from.' };
  }
  const body = table.slice(1);
  if (body.length === 0) return { ok: false, error: 'The file has a header but no cities.' };
  if (body.length > MAX_CITY_IMPORT_ROWS) return { ok: false, error: `Import at most ${MAX_CITY_IMPORT_ROWS} cities at a time.` };
  const cell = (cells: string[], field: string) => {
    const index = at(field);
    return index >= 0 ? (cells[index] ?? '').trim() : '';
  };
  return {
    ok: true,
    rows: body.map((row) => ({
      line: row.line,
      name: cell(row.cells, 'name'),
      slug: cell(row.cells, 'slug').toLowerCase(),
      country: cell(row.cells, 'country'),
      region: cell(row.cells, 'region'),
      status: cell(row.cells, 'status').toUpperCase(),
    })),
  };
}

function findMarket(markets: readonly CountryContext[], value: string): CountryContext | null {
  const wanted = value.trim().toLowerCase();
  if (!wanted) return null;
  return (
    markets.find((market) => market.code.toLowerCase() === wanted) ??
    markets.find((market) => market.name.toLowerCase() === wanted) ??
    markets.find((market) => market.slug && market.slug.toLowerCase() === wanted.replace(/^\/+/, '')) ??
    null
  );
}

/** Validates every row of a city CSV. Read-only. */
export async function planCityImport(user: SessionUser, text: string): Promise<CityImportPlan | { error: string }> {
  const parsed = readCityCsv(text);
  if (!parsed.ok) return { error: parsed.error };
  const markets = await listAccessibleCountries(user, { includeInactive: true });
  const canPublish = userCan(user, 'pages.publish');

  const rows: CityImportRow[] = [];
  for (const raw of parsed.rows) {
    const market = findMarket(markets, raw.country);
    const status = raw.status ? raw.status : 'DRAFT';
    const base: CityImportRow = {
      line: raw.line,
      name: raw.name,
      slug: raw.slug || suggestCitySlug(raw.name),
      region: raw.region || null,
      status: isCityStatus(status) ? status : 'DRAFT',
      countryId: market?.id ?? null,
      countryName: market?.name ?? null,
      path: null,
      outcome: 'invalid',
      reason: null,
    };
    if (!market) {
      rows.push({ ...base, reason: raw.country ? `“${raw.country}” is not a market you can work in.` : 'The Country column is empty.' });
      continue;
    }
    if (!isCityStatus(status)) {
      rows.push({ ...base, reason: `Status must be DRAFT, PUBLISHED or ARCHIVED, not “${raw.status}”.` });
      continue;
    }
    if (status === 'PUBLISHED' && !canPublish) {
      rows.push({ ...base, reason: 'Publishing a city needs the publish permission. Import it as a draft.' });
      continue;
    }
    const checked = cityInputSchema.safeParse({ name: raw.name, slug: base.slug, region: raw.region, status });
    if (!checked.success) {
      const issue = checked.error.issues[0];
      rows.push({ ...base, reason: `${issue?.path.join('.') || 'Row'}: ${issue?.message ?? 'not valid'}` });
      continue;
    }
    rows.push({
      ...base,
      name: checked.data.name,
      slug: checked.data.slug,
      region: checked.data.region,
      path: joinMarket(market.slug, checked.data.slug),
      outcome: 'create',
    });
  }

  // Against each other: one slug per market.
  const seen = new Map<string, CityImportRow>();
  for (const row of rows) {
    if (row.outcome !== 'create') continue;
    const key = `${row.countryId}|${row.slug}`;
    const first = seen.get(key);
    if (!first) {
      seen.set(key, row);
      continue;
    }
    if (first.name.toLowerCase() === row.name.toLowerCase()) {
      row.outcome = 'duplicate';
      row.reason = `Same city as line ${first.line}; imported once.`;
    } else {
      row.outcome = 'conflict';
      row.reason = `Line ${first.line} already uses ${row.path} for “${first.name}”.`;
    }
  }

  // Against the database: existing cities are left alone; a taken address is a conflict.
  const candidates = rows.filter((row) => row.outcome === 'create');
  const existing = candidates.length
    ? await prisma.city.findMany({
        where: { OR: candidates.map((row) => ({ countryId: row.countryId!, slug: row.slug })) },
        select: { countryId: true, slug: true, name: true },
      })
    : [];
  for (const row of candidates) {
    const city = existing.find((entry) => entry.countryId === row.countryId && entry.slug === row.slug);
    if (city) {
      row.outcome = 'exists';
      row.reason = `${city.name} already exists at ${row.path}; it is left exactly as it is.`;
      continue;
    }
    const market = markets.find((entry) => entry.id === row.countryId)!;
    const problems = await citySpaceProblems(prisma, { countryId: market.id, marketSlug: market.slug, slug: row.slug, limit: 1 });
    if (problems.length > 0) {
      row.outcome = 'conflict';
      row.reason = describeCitySpaceProblems(row.slug, problems);
    }
  }

  const counts: Record<CityImportStatus, number> = { create: 0, exists: 0, duplicate: 0, conflict: 0, invalid: 0 };
  for (const row of rows) counts[row.outcome] += 1;
  return { rows, counts, fingerprint: cityImportFingerprint(text) };
}

/** Ties a run to the file that was previewed. */
export function cityImportFingerprint(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 24);
}

/**
 * Creates the cities on the given lines, each in its own transaction under the
 * registry lock, re-checking everything the preview checked. One city failing
 * never stops the others.
 */
export async function runCityImport(
  user: SessionUser & { id: string },
  plan: CityImportPlan,
  lines: readonly number[],
  landing: { create: boolean; title: string | null },
): Promise<CityImportResult[]> {
  const markets = await listAccessibleCountries(user, { includeInactive: true });
  const wanted = new Set(lines);
  const results: CityImportResult[] = [];
  for (const row of plan.rows.filter((entry) => wanted.has(entry.line))) {
    const base = { line: row.line, name: row.name, path: row.path, cityId: null, landingPageId: null };
    if (row.outcome !== 'create') {
      results.push({ ...base, outcome: row.outcome === 'exists' || row.outcome === 'duplicate' ? 'skipped' : 'failed', reason: row.reason });
      continue;
    }
    const market = markets.find((entry) => entry.id === row.countryId);
    if (!market) {
      results.push({ ...base, outcome: 'failed', reason: 'You can no longer work in this market.' });
      continue;
    }
    try {
      const created = await withRegistry(
        async (tx) => {
          const already = await tx.city.findUnique({
            where: { countryId_slug: { countryId: market.id, slug: row.slug } },
            select: { id: true },
          });
          if (already) return { skipped: true as const, cityId: already.id };
          const problems = await citySpaceProblems(tx, { countryId: market.id, marketSlug: market.slug, slug: row.slug });
          if (problems.length > 0) throw new UrlRegistryError(describeCitySpaceProblems(row.slug, problems), 'conflict', 'slug');
          const city = await tx.city.create({
            data: { countryId: market.id, name: row.name, slug: row.slug, region: row.region, ...cityStatusColumns(row.status) },
          });
          const page = landing.create
            ? await createLandingPage(tx, { city, country: market, title: landing.title, actor: user })
            : null;
          return { skipped: false as const, cityId: city.id, landingPageId: page?.id ?? null };
        },
        { timeoutMs: 30_000 },
      );
      results.push(
        created.skipped
          ? { ...base, outcome: 'skipped', cityId: created.cityId, reason: 'Already exists; left as it is.' }
          : {
              ...base,
              outcome: 'created',
              cityId: created.cityId,
              landingPageId: created.landingPageId,
              reason: `${CITY_STATUS_LABELS[row.status]}${created.landingPageId ? ', with a draft landing page' : ''}.`,
            },
      );
    } catch (error) {
      results.push({
        ...base,
        outcome: 'failed',
        reason: error instanceof UrlRegistryError ? error.message : 'The city could not be created. Nothing was saved for it.',
      });
      if (!(error instanceof UrlRegistryError)) console.error('[city-import]', error);
    }
  }
  return results;
}

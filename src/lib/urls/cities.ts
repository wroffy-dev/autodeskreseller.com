import 'server-only';
import { listCountries } from '@/lib/country/registry';
import { describeOwner, loadContentInfo, type Db } from './content';
import { isReservedFirstSegment, joinMarket, pathKey, segmentsOf } from './path';
import { checkAvailability } from './registry';
import { entityKey, patternScopeKey } from './snapshot';
import { DEFAULT_PATTERNS, PATTERN_TYPES, URL_TYPE_LABELS, type UrlContentType } from './types';

/**
 * Whether a city may have a slug — the registry's side of a city.
 *
 * A city owns the first segment of addresses in its market: the city's own
 * address (`/delhi`, `/ae/dubai`) and everything beneath it. Giving a city a
 * slug therefore claims a whole address space at once, and it is refused
 * while anything else is there. This is the same registry that decides every
 * other address, asked one more question — not a second conflict system:
 *
 *  - the segment is a system route or a market prefix;
 *  - the segment is where a content type lives (`/products`, `/blog`);
 *  - another city in the market already has it;
 *  - the city's own address is claimed — by a page, a product, an article, a
 *    redirect, anything in the URL registry — other than by this city;
 *  - content that is not this city's is registered beneath it;
 *  - a page that is not this city's has a slug beneath it (pages created
 *    before the registry's first scan are not registered yet).
 *
 * Redirects *beneath* the city's address are left alone: they are explicit
 * rules for single addresses, and the city's pages simply cannot take those
 * addresses while the rules exist.
 *
 * Read-only. Callers run it inside the transaction that holds the registry
 * lock and then write the city, so nothing can slip into the space between
 * the check and the write.
 */

export type CitySpaceProblem = {
  /** The address in the way. */
  path: string;
  /** What holds it, in words: `page “Delhi offers”`, `a system route`. */
  description: string;
  /** `taken`: something holds the address. `reserved`: the address can never be a city's. */
  kind: 'taken' | 'reserved';
  editHref: string | null;
};

type Input = {
  countryId: string;
  /** The market's URL prefix, "" for the root market. */
  marketSlug: string;
  slug: string;
  /** The city being renamed, whose own pages are never in its way. */
  cityId?: string | null;
  limit?: number;
};

const SENTINEL = '__new_city__';

/** First segments that belong to a content type's URL pattern, saved or built in. */
async function patternSegments(db: Db, countryId: string): Promise<Map<string, { type: UrlContentType; pattern: string }>> {
  const saved = await db.urlPattern.findMany({ select: { scopeKey: true, pattern: true } });
  const byScope = new Map(saved.map((row) => [row.scopeKey, row.pattern]));
  const segments = new Map<string, { type: UrlContentType; pattern: string }>();
  for (const type of PATTERN_TYPES) {
    const patterns = [
      byScope.get(patternScopeKey(type, countryId)),
      byScope.get(patternScopeKey(type, null)),
      // The built-in pattern too: while the registry is switched off, the
      // previous router still serves `/products/...` and `/blog/...` there.
      DEFAULT_PATTERNS[type],
    ];
    for (const pattern of patterns) {
      const first = pattern ? segmentsOf(pattern)[0] : undefined;
      if (first && !first.includes('{') && !segments.has(first)) segments.set(first, { type, pattern: pattern! });
    }
  }
  return segments;
}

export async function citySpaceProblems(db: Db, input: Input): Promise<CitySpaceProblem[]> {
  const limit = input.limit ?? 5;
  const slug = input.slug.trim().toLowerCase();
  const address = joinMarket(input.marketSlug, `/${slug}`);
  const key = pathKey(address);
  if (!key || !slug) return [{ path: address, description: 'not a valid address', kind: 'reserved', editHref: null }];

  const countries = await listCountries();
  const prefixes = countries.map((country) => country.slug).filter(Boolean);
  if (isReservedFirstSegment(slug, { marketPrefixes: prefixes })) {
    const market = countries.find((country) => country.slug === slug);
    return [
      {
        path: address,
        description: market ? `the URL prefix of the market ${market.name}` : 'a system route',
        kind: 'reserved',
        editHref: null,
      },
    ];
  }

  const owned = (await patternSegments(db, input.countryId)).get(slug);
  if (owned) {
    const label = URL_TYPE_LABELS[owned.type].toLowerCase();
    return [
      {
        path: address,
        description: `where every ${label} lives (their URL pattern is ${owned.pattern})`,
        kind: 'reserved',
        editHref: null,
      },
    ];
  }

  const problems: CitySpaceProblem[] = [];

  const other = await db.city.findFirst({
    where: { countryId: input.countryId, slug, ...(input.cityId ? { id: { not: input.cityId } } : {}) },
    select: { id: true, name: true },
  });
  if (other) {
    problems.push({
      path: address,
      description: `the city ${other.name}`,
      kind: 'taken',
      editHref: `/admin/cities/${other.id}`,
    });
  }

  const ownPages = input.cityId
    ? await db.page.findMany({
        where: { cityId: input.cityId },
        select: { id: true, isCityHomepage: true, deletedAt: true },
      })
    : [];
  const own = new Set(ownPages.map((page) => page.id));
  const landing = ownPages.find((page) => page.isCityHomepage && !page.deletedAt);

  const blockers: Array<{ path: string; owner: Awaited<ReturnType<typeof checkAvailability>> }> = [];

  // The city's own address: its landing page will want it.
  const atAddress = await checkAvailability(db, key, {
    entityId: landing?.id ?? SENTINEL,
    countryId: input.countryId,
    type: 'PAGE',
  });
  if (!atAddress.ok) blockers.push({ path: address, owner: atAddress });

  // Content registered beneath it.
  const beneath = await db.urlRoute.findMany({
    where: { kind: 'CONTENT', pathKey: { startsWith: `${key}/` } },
    orderBy: { pathKey: 'asc' },
    take: 50,
  });
  for (const claim of beneath) {
    if (blockers.length >= limit) break;
    if (claim.entityId && own.has(claim.entityId)) continue;
    const availability = await checkAvailability(db, claim.pathKey, {
      entityId: SENTINEL,
      countryId: input.countryId,
      type: 'PAGE',
    });
    // A stale route — its content is gone — is not in the way.
    if (!availability.ok) blockers.push({ path: claim.path, owner: availability });
  }

  // Describe content owners by name, in one batch.
  const refs = blockers.flatMap((blocker) =>
    !blocker.owner.ok && blocker.owner.owner.kind === 'content' && blocker.owner.owner.type && blocker.owner.owner.entityId
      ? [{ type: blocker.owner.owner.type, entityId: blocker.owner.owner.entityId, countryId: blocker.owner.owner.countryId }]
      : [],
  );
  const root = countries.find((country) => country.isDefault) ?? countries[0];
  const infos = refs.length > 0 && root ? await loadContentInfo(refs, root.id, db) : new Map();
  const reported = new Set<string>();
  for (const blocker of blockers) {
    if (blocker.owner.ok) continue;
    const owner = blocker.owner.owner;
    const info =
      owner.kind === 'content' && owner.entityId ? infos.get(entityKey(owner.entityId, owner.countryId)) : undefined;
    if (owner.entityId) reported.add(owner.entityId);
    problems.push({
      path: blocker.path,
      description: info ? describeOwner(info) : owner.description,
      kind: 'taken',
      editHref: info?.editHref ?? (owner.kind === 'city' && owner.cityId ? `/admin/cities/${owner.cityId}` : null),
    });
  }

  // Pages the registry does not know about yet.
  if (problems.length < limit) {
    const pages = await db.page.findMany({
      where: {
        countryId: input.countryId,
        deletedAt: null,
        OR: [{ slug }, { slug: { startsWith: `${slug}/` } }],
        ...(own.size > 0 ? { id: { notIn: [...own] } } : {}),
      },
      select: { id: true, title: true, slug: true },
      orderBy: { slug: 'asc' },
      take: limit,
    });
    for (const page of pages) {
      if (reported.has(page.id)) continue;
      problems.push({
        path: joinMarket(input.marketSlug, page.slug),
        description: `page “${page.title}”`,
        kind: 'taken',
        editHref: `/admin/pages/${page.id}`,
      });
    }
  }

  return problems.slice(0, limit);
}

/** The problems as one sentence for a form error. */
export function describeCitySpaceProblems(slug: string, problems: readonly CitySpaceProblem[]): string {
  const first = problems[0];
  if (!first) return '';
  if (first.kind === 'reserved') {
    return `“${slug}” cannot be a city’s slug: ${first.path} is ${first.description}.`;
  }
  const rest = problems.length - 1;
  const more = rest > 0 ? `, and ${rest} more address${rest === 1 ? '' : 'es'} beneath it ${rest === 1 ? 'is' : 'are'} taken too` : '';
  return `“${slug}” cannot be this city’s slug: ${first.path} is already used by ${first.description}${more}. Choose another slug, or move what is there first.`;
}

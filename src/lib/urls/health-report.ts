import 'server-only';
import type { Prisma, UrlHealthStatus } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { listCountries } from '@/lib/country/registry';
import { listAccessibleCountries } from '@/lib/country/access';
import { isReservedSegment } from '@/lib/country/reserved';
import type { SessionUser } from '@/lib/auth/guards';
import { siteUrl } from '@/lib/env';
import { isLive } from './live';
import { isExternalUrl, joinMarket, pathKey, segmentsOf } from './path';
import { URL_TYPE_LABELS, type UrlContentType } from './types';

/**
 * URL Health: what is broken, from real data.
 *
 *  - **404s** — addresses visitors actually asked for that answered 404, as
 *    recorded by the public routes, with how often and from where. Each can
 *    be given a home: a redirect to a published page, product or article.
 *  - **Redirect problems** — rules whose destination is gone, unpublished,
 *    itself a redirect, or nowhere at all; rules that never fire.
 *  - **Broken internal links** — links stored in menus, calls to action and
 *    page content that lead nowhere.
 *
 * Everything is worked out from the registry and the database. Nothing here
 * fetches a URL — not this site's and certainly not anyone else's — and every
 * listing is bounded.
 */

export type NotFoundRow = {
  id: string;
  path: string;
  countryName: string | null;
  hits: number;
  firstSeenAt: string;
  lastSeenAt: string;
  lastReferrer: string | null;
  status: UrlHealthStatus;
  redirectId: string | null;
};

export async function listNotFound(
  user: SessionUser,
  query: { status?: UrlHealthStatus | ''; q?: string; page?: number },
): Promise<{ rows: NotFoundRow[]; total: number; page: number; pages: number }> {
  const [countries, mine] = await Promise.all([
    listCountries(),
    listAccessibleCountries(user, { includeInactive: true }),
  ]);
  const allowed = mine.map((country) => country.id);
  const everyMarket = mine.length >= countries.length;
  const where: Prisma.UrlNotFoundWhereInput = {
    status: query.status || 'OPEN',
    ...(everyMarket ? {} : { countryId: { in: allowed } }),
    ...(query.q?.trim() ? { path: { contains: query.q.trim().toLowerCase() } } : {}),
  };
  const pageSize = 25;
  const total = await prisma.urlNotFound.count({ where });
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(query.page ?? 1, 1), pages);
  const rows = await prisma.urlNotFound.findMany({
    where,
    orderBy: [{ hits: 'desc' }, { lastSeenAt: 'desc' }],
    skip: (page - 1) * pageSize,
    take: pageSize,
  });
  return {
    total,
    page,
    pages,
    rows: rows.map((row) => ({
      id: row.id,
      path: row.path,
      countryName: countries.find((country) => country.id === row.countryId)?.name ?? null,
      hits: row.hits,
      firstSeenAt: row.firstSeenAt.toISOString(),
      lastSeenAt: row.lastSeenAt.toISOString(),
      lastReferrer: row.lastReferrer,
      status: row.status,
      redirectId: row.redirectId,
    })),
  };
}

// ---------------------------------------------------------------------------
// Redirect problems
// ---------------------------------------------------------------------------

export type RedirectProblem = {
  redirectId: string;
  source: string;
  destination: string;
  problem: 'target-gone' | 'target-unpublished' | 'chain' | 'nowhere' | 'dormant' | 'disabled';
  message: string;
};

const PROBLEM_LIMIT = 500;

export async function redirectProblems(): Promise<RedirectProblem[]> {
  const rules = await prisma.redirect.findMany({
    orderBy: { createdAt: 'desc' },
    take: 2_000,
    include: { claims: { select: { id: true } } },
  });
  const problems: RedirectProblem[] = [];
  for (const rule of rules) {
    if (problems.length >= PROBLEM_LIMIT) break;
    const push = (problem: RedirectProblem['problem'], message: string) =>
      problems.push({ redirectId: rule.id, source: rule.source, destination: rule.destination, problem, message });

    if (rule.claims.length === 0) {
      push('dormant', 'Never fires: the address it answers for belongs to content, or it was not imported.');
      continue;
    }
    if (!rule.isActive) {
      push('disabled', 'Switched off: its address answers 404 while it is.');
      continue;
    }
    if (rule.targetEntityId && rule.targetCountryId && rule.targetType) {
      const route = await prisma.urlRoute.findUnique({
        where: { entityId_countryId: { entityId: rule.targetEntityId, countryId: rule.targetCountryId } },
        select: { id: true },
      });
      if (!route) {
        push('target-gone', `Its ${URL_TYPE_LABELS[rule.targetType as UrlContentType].toLowerCase()} was deleted, so it answers 404. Choose a replacement.`);
      } else if (!(await isLive(rule.targetType as UrlContentType, rule.targetEntityId, rule.targetCountryId))) {
        push('target-unpublished', 'Its destination is not published, so it answers 404 until it is.');
      }
      continue;
    }
    if (isExternalUrl(rule.destination)) continue;
    const key = pathKey(rule.destination);
    if (!key) {
      push('nowhere', 'Its destination is not a valid path.');
      continue;
    }
    const claim = await prisma.urlRoute.findUnique({ where: { pathKey: key }, select: { kind: true } });
    if (claim?.kind === 'REDIRECT') {
      push('chain', 'Its destination is itself redirected. Save it again to send it straight to the end.');
    } else if (!claim && !isSystemPath(key)) {
      push('nowhere', 'Nothing lives at its destination, so visitors land on a 404.');
    }
  }
  return problems;
}

/** Addresses served by the application itself rather than by the registry. */
function isSystemPath(key: string): boolean {
  const first = segmentsOf(key)[0] ?? '';
  return first !== '' && isReservedSegment(first);
}

// ---------------------------------------------------------------------------
// Broken internal links
// ---------------------------------------------------------------------------

export type BrokenLink = {
  href: string;
  where: string;
  editHref: string | null;
};

const SCAN_LIMIT = 3_000;
const BROKEN_LIMIT = 300;

/**
 * Stored internal links that lead nowhere: to no content, no redirect and no
 * system route. Links are read the way they are rendered — a root-relative
 * link in a market's content means that market's address.
 */
export async function brokenInternalLinks(): Promise<{ links: BrokenLink[]; scanned: number; truncated: boolean }> {
  const countries = await listCountries();
  const prefixes = new Set(countries.map((country) => country.slug).filter(Boolean));
  const origin = (() => {
    try {
      return new URL(siteUrl()).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  })();

  type Found = { href: string; countryId: string | null; where: string; editHref: string | null };
  const found: Found[] = [];
  const collect = (value: unknown, meta: Omit<Found, 'href'>) => {
    const visit = (node: unknown) => {
      if (found.length >= SCAN_LIMIT) return;
      if (typeof node === 'string') {
        if (node.includes('<')) {
          for (const match of node.matchAll(/\bhref=("|')([^"']*)\1/gi)) found.push({ ...meta, href: match[2]! });
        } else if (node.startsWith('/') && !node.startsWith('//')) {
          found.push({ ...meta, href: node });
        }
        return;
      }
      if (Array.isArray(node)) node.forEach(visit);
      else if (node && typeof node === 'object') Object.values(node).forEach(visit);
    };
    visit(value);
  };

  const [items, sections] = await Promise.all([
    prisma.navigationItem.findMany({
      where: { url: { startsWith: '/' } },
      select: { url: true, label: true, navigation: { select: { name: true, countryId: true } } },
      take: SCAN_LIMIT,
    }),
    prisma.pageSection.findMany({
      where: { page: { deletedAt: null } },
      select: { content: true, page: { select: { id: true, title: true, countryId: true } } },
      take: SCAN_LIMIT,
    }),
  ]);
  for (const item of items) {
    collect(item.url, {
      countryId: item.navigation.countryId,
      where: `Menu “${item.navigation.name}” → “${item.label}”`,
      editHref: '/admin/navigation',
    });
  }
  for (const section of sections) {
    collect(section.content, {
      countryId: section.page.countryId,
      where: `Page “${section.page.title}”`,
      editHref: `/admin/pages/${section.page.id}`,
    });
  }

  // Resolve each distinct address once.
  const truncated = found.length >= SCAN_LIMIT;
  const checked = new Map<string, boolean>();
  const broken: BrokenLink[] = [];
  for (const link of found) {
    if (broken.length >= BROKEN_LIMIT) break;
    let href = link.href.trim();
    if (/^https?:\/\//i.test(href)) {
      try {
        const url = new URL(href);
        if (url.hostname.replace(/^www\./, '') !== origin) continue;
        href = url.pathname;
      } catch {
        continue;
      }
    }
    const path = href.split(/[?#]/)[0] ?? '';
    if (!path.startsWith('/')) continue;
    const first = segmentsOf(path)[0] ?? '';
    const market = link.countryId ? countries.find((country) => country.id === link.countryId) : undefined;
    const full = !first || prefixes.has(first) || !market || market.isDefault ? path : joinMarket(market.slug, path);
    const key = pathKey(full);
    if (!key || isSystemPath(key)) continue;
    // A root-relative link to the root-only blog is not localised, so it may
    // also be the root address itself.
    const candidates = [key, pathKey(path)].filter((value): value is string => Boolean(value));
    let ok = false;
    for (const candidate of candidates) {
      if (!checked.has(candidate)) {
        const claim = await prisma.urlRoute.findUnique({ where: { pathKey: candidate }, select: { id: true } });
        checked.set(candidate, Boolean(claim));
      }
      if (checked.get(candidate)) {
        ok = true;
        break;
      }
    }
    if (!ok) broken.push({ href: link.href, where: link.where, editHref: link.editHref });
  }
  return { links: broken, scanned: found.length, truncated };
}

import 'server-only';
import { cache } from 'react';
import { prisma } from '@/lib/db/prisma';
import { publishedPageWhere } from '@/lib/services/pages';
import { publishedPostWhere } from '@/lib/services/blog';
import { listActiveCountries } from './registry';
import { countryPath, contentSlug } from './routing';
import type { CountryContext } from './types';
import { getUrlSnapshot } from '@/lib/urls/load';
import { pathKey } from '@/lib/urls/path';
import { ROOT_ONLY_TYPES } from '@/lib/urls/types';
import { pageAlternates, productAlternates } from '@/lib/urls/alternates';

/**
 * Where the market switcher should send a visitor.
 *
 * The rule is "the same thing, in the other market, when it exists there".
 * Every target is resolved on the server against real, published content, so
 * the switcher can only ever produce a URL that resolves — and when it cannot,
 * it falls back to that market's home page rather than to a 404 or to a
 * redirect that could bounce back.
 *
 * Nothing about this is automatic: geolocation never moves a visitor between
 * markets. Switching is something a person does deliberately.
 */

export type MarketOption = {
  code: string;
  name: string;
  slug: string;
  locale: string;
  href: string;
  isCurrent: boolean;
  /** False when the visitor will land on the market's home instead of here. */
  isEquivalent: boolean;
};

/** The public surface a path points at, as far as switching is concerned. */
type Surface =
  | { kind: 'home' }
  | { kind: 'page'; slug: string }
  | { kind: 'post'; slug: string }
  | { kind: 'shared'; path: string };

function classify(path: string): Surface {
  const slug = contentSlug(path);
  if (!slug) return { kind: 'home' };
  const segments = slug.split('/');

  if (segments[0] === 'blog') {
    // The archive and the (globally shared) category and tag archives exist in
    // every market, so they map across directly.
    if (segments.length === 1) return { kind: 'shared', path: slug };
    if (segments[1] === 'category' || segments[1] === 'tag') return { kind: 'shared', path: slug };
    return { kind: 'post', slug: segments[1] ?? '' };
  }

  if (segments[0] === 'products' && segments[1]) {
    // A product page exists in a market only when that market sells it, which
    // is exactly the ProductCountry check below.
    return { kind: 'page', slug };
  }

  return { kind: 'page', slug };
}

/**
 * Markets where the current content also exists and is published.
 *
 * One query per content kind, not one per market, so adding markets does not
 * add queries.
 */
async function countriesWithEquivalent(surface: Surface): Promise<Set<string>> {
  if (surface.kind === 'home' || surface.kind === 'shared') return new Set();

  if (surface.kind === 'post') {
    const rows = await prisma.blogPost.findMany({
      where: { ...publishedPostWhere(), slug: surface.slug },
      select: { countryId: true },
    });
    return new Set(rows.map((row) => row.countryId));
  }

  const productSlug = surface.slug.startsWith('products/')
    ? surface.slug.slice('products/'.length)
    : null;

  if (productSlug) {
    const rows = await prisma.productCountry.findMany({
      where: {
        deletedAt: null,
        status: 'PUBLISHED',
        OR: [{ publishedAt: null }, { publishedAt: { lte: new Date() } }],
        product: { deletedAt: null, slug: productSlug },
      },
      select: { countryId: true },
    });
    return new Set(rows.map((row) => row.countryId));
  }

  const rows = await prisma.page.findMany({
    where: { ...publishedPageWhere(), slug: surface.slug },
    select: { countryId: true },
  });
  return new Set(rows.map((row) => row.countryId));
}

/**
 * Markets whose own home page is published.
 *
 * Every fallback the switcher offers is a market's root, so a market without a
 * published home page has no reachable fallback — offering it would send the
 * visitor to a 404. That is not hypothetical: a market created ahead of its
 * content is active and empty, which is exactly the state a new market starts
 * in. One query, not one per market.
 */
async function countriesWithHome(): Promise<Set<string>> {
  const rows = await prisma.page.findMany({
    where: { ...publishedPageWhere(), isHomepage: true },
    select: { countryId: true },
  });
  return new Set(rows.map((row) => row.countryId));
}

/**
 * The same content in every market, through the URL registry.
 *
 * Found by identity — the same product, the same page group — so a market
 * whose address for it differs is still offered, at its own address. Blog
 * content is root-only, so every market's option is the one root address.
 * Returns null when the registry is off or does not know the address, and the
 * rules below apply instead.
 */
async function registryEquivalents(
  current: CountryContext,
  path: string,
): Promise<{ shared: string | null; byCountry: Map<string, string> } | null> {
  const snapshot = await getUrlSnapshot();
  if (!snapshot.enabled) return null;
  const key = pathKey(countryPath(current, path));
  const route = key ? snapshot.byKey.get(key) : undefined;
  if (!route) return null;

  if (ROOT_ONLY_TYPES.has(route.type)) return { shared: route.path, byCountry: new Map() };

  const alternates =
    route.type === 'PRODUCT'
      ? await (async () => {
          const product = await prisma.product.findUnique({
            where: { id: route.entityId },
            select: { id: true, slug: true },
          });
          return product ? productAlternates(product) : [];
        })()
      : await (async () => {
          const page = await prisma.page.findUnique({
            where: { id: route.entityId },
            select: { id: true, slug: true, groupKey: true },
          });
          return page ? pageAlternates(page, { indexableOnly: false }) : [];
        })();
  return { shared: null, byCountry: new Map(alternates.map((entry) => [entry.countryId, entry.path])) };
}

export const resolveMarketOptions = cache(
  async (current: CountryContext, path: string): Promise<MarketOption[]> => {
    const [countries, surface] = await Promise.all([
      listActiveCountries(),
      Promise.resolve(classify(path)),
    ]);

    if (countries.length < 2) return [];
    const [registry, withHome] = await Promise.all([
      registryEquivalents(current, path),
      countriesWithHome(),
    ]);

    if (registry) {
      const reachable = countries.filter(
        (country) =>
          country.id === current.id ||
          withHome.has(country.id) ||
          registry.byCountry.has(country.id) ||
          registry.shared !== null,
      );
      if (reachable.length < 2) return [];
      return reachable.map((country) => {
        const equivalent = registry.shared ?? registry.byCountry.get(country.id) ?? null;
        return {
          code: country.code,
          name: country.name,
          slug: country.slug,
          locale: country.locale,
          href: equivalent ?? countryPath(country),
          isCurrent: country.id === current.id,
          isEquivalent: equivalent !== null,
        };
      });
    }

    const equivalents = await countriesWithEquivalent(surface);

    /*
     * A market is offered only when the visitor has somewhere to land: this
     * content in that market, or that market's home page. The market being
     * viewed always stays, so the switcher can show what is current.
     */
    const reachable = countries.filter(
      (country) =>
        country.id === current.id || withHome.has(country.id) || equivalents.has(country.id),
    );

    // One option is the market already being viewed; that is not a switcher.
    if (reachable.length < 2) return [];

    return reachable.map((country) => {
      const isCurrent = country.id === current.id;

      let href = countryPath(country);
      let isEquivalent = false;

      if (surface.kind === 'home') {
        isEquivalent = true;
      } else if (surface.kind === 'shared') {
        href = countryPath(country, surface.path);
        isEquivalent = true;
      } else if (isCurrent || equivalents.has(country.id)) {
        href = countryPath(country, surface.kind === 'post' ? `blog/${surface.slug}` : surface.slug);
        isEquivalent = true;
      }

      return {
        code: country.code,
        name: country.name,
        slug: country.slug,
        locale: country.locale,
        href,
        isCurrent,
        isEquivalent,
      };
    });
  },
);

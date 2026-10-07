import 'server-only';
import { prisma } from '@/lib/db/prisma';
import { listedPageWhere } from '@/lib/services/pages';
import { publishedPostWhere } from '@/lib/services/blog';
import { getDefaultCountry, listIndexableCountries } from '@/lib/country/registry';
import { getSeoSettings } from '@/lib/services/settings';
import { siteUrl } from '@/lib/env';
import { getUrlSnapshot } from '@/lib/urls/load';
import {
  blogArchiveHref,
  blogCategoryHref,
  blogTagHref,
  pageHref,
  postHref,
  productHref,
} from '@/lib/urls/links';
import type { CountryContext } from '@/lib/country/types';

/**
 * The sitemaps.
 *
 * A root index pointing at one sitemap per market, plus a root-only blog
 * sitemap — because articles are not per-market and listing them under a
 * market prefix would advertise a URL that redirects.
 *
 * Everything listed is a URL a visitor can actually reach and a crawler is
 * actually invited to index: published, not soft-deleted, not noindex, in a
 * market that is both active and published. A draft imported by the content
 * sync therefore stays out until someone publishes it, which is the point of
 * importing as a draft.
 */

/**
 * The markets a sitemap may list.
 *
 * Active and published, and neither left out of the sitemaps nor asked not to
 * be indexed in their settings. A market that sends noindex on every page and
 * lists those pages in a sitemap is telling search engines two opposite
 * things. The whole site's noindex switch withholds every market.
 */
export async function listSitemapCountries(): Promise<CountryContext[]> {
  const [countries, withheld, seo] = await Promise.all([
    listIndexableCountries(),
    prisma.countrySettings.findMany({
      where: { OR: [{ excludeFromSitemap: true }, { noIndexCountry: true }] },
      select: { countryId: true },
    }),
    getSeoSettings(),
  ]);
  if (seo.noIndexSite) return [];
  const skip = new Set(withheld.map((row) => row.countryId));
  return countries.filter((country) => !skip.has(country.id));
}

/** The protocol's ceiling. Split beyond this rather than emit an invalid file. */
export const MAX_URLS_PER_SITEMAP = 45_000;

export type SitemapUrl = {
  loc: string;
  lastmod: Date;
  changefreq?: string;
  priority?: number;
  /** Reciprocal alternates, only where a real equivalent is published. */
  alternates?: Array<{ hreflang: string; href: string }>;
};

export type SitemapChild = {
  /** The path segment in /sitemaps/<name>.xml. */
  name: string;
  label: string;
  lastmod: Date;
  count: number;
};

function base(): string {
  return siteUrl().replace(/\/$/, '');
}

/** XML text escaping. A slug can legitimately contain an ampersand. */
export function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** What a sitemap URL is, so alternates can be found by identity. */
type SitemapEntity = { kind: 'page'; id: string; slug: string; groupKey: string | null } | { kind: 'product'; id: string };

type EntityUrl = SitemapUrl & { entity?: SitemapEntity };

/**
 * One market's pages and products, at the addresses the URL registry gives
 * them — which need not be the root market's address with a prefix.
 */
export async function countryUrls(country: CountryContext): Promise<EntityUrl[]> {
  await getUrlSnapshot();
  const origin = base();
  const [pages, products] = await Promise.all([
    prisma.page.findMany({
      where: { ...listedPageWhere(), countryId: country.id },
      select: { id: true, slug: true, groupKey: true, updatedAt: true, isHomepage: true },
    }),
    prisma.productCountry.findMany({
      where: {
        countryId: country.id,
        deletedAt: null,
        noIndex: false,
        status: 'PUBLISHED',
        OR: [{ publishedAt: null }, { publishedAt: { lte: new Date() } }],
        product: { deletedAt: null, noIndex: false },
      },
      select: { updatedAt: true, product: { select: { id: true, slug: true } } },
    }),
  ]);

  const url = (path: string) => `${origin}${path}`.replace(/\/$/, '') || origin;

  return [
    ...pages.map((page) => ({
      loc: url(pageHref(country, page)),
      lastmod: page.updatedAt,
      changefreq: 'weekly',
      priority: page.isHomepage || page.slug === '' ? 1 : 0.8,
      entity: { kind: 'page' as const, id: page.id, slug: page.slug, groupKey: page.groupKey },
    })),
    ...products.map((row) => ({
      loc: url(productHref(country, row.product)),
      lastmod: row.updatedAt,
      changefreq: 'weekly',
      priority: 0.9,
      entity: { kind: 'product' as const, id: row.product.id },
    })),
  ];
}

/**
 * The blog, once, at the root.
 *
 * Only the root market's articles: the blog is root-only, and an article
 * stored against another market has no public address to list.
 */
export async function blogUrls(): Promise<SitemapUrl[]> {
  await getUrlSnapshot();
  const origin = base();
  // The blog is served from the root market, so it is listed only when that
  // market is: its noindex and its sitemap switch cover the blog too.
  const [root, listed] = await Promise.all([getDefaultCountry(), listSitemapCountries()]);
  if (!listed.some((country) => country.id === root.id)) return [];

  const [settings, posts, categories, tags] = await Promise.all([
    prisma.blogSettings.findUnique({ where: { id: 'singleton' }, select: { noIndex: true } }),
    prisma.blogPost.findMany({
      where: { ...publishedPostWhere(root.id), noIndex: false },
      select: { id: true, slug: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.blogCategory.findMany({
      where: { isActive: true, noIndex: false, posts: { some: publishedPostWhere(root.id) } },
      select: { id: true, slug: true, updatedAt: true },
    }),
    prisma.blogTag.findMany({
      where: { isActive: true, noIndex: false, posts: { some: { post: publishedPostWhere(root.id) } } },
      select: { id: true, slug: true, updatedAt: true, createdAt: true },
    }),
  ]);

  if (settings?.noIndex) return [];

  const urls: SitemapUrl[] = [
    {
      loc: `${origin}${blogArchiveHref()}`,
      lastmod: posts[0]?.updatedAt ?? new Date(),
      changefreq: 'daily',
      priority: 0.7,
    },
  ];

  for (const post of posts) {
    urls.push({ loc: `${origin}${postHref(post)}`, lastmod: post.updatedAt, changefreq: 'monthly', priority: 0.6 });
  }
  for (const category of categories) {
    urls.push({
      loc: `${origin}${blogCategoryHref(category)}`,
      lastmod: category.updatedAt,
      changefreq: 'weekly',
      priority: 0.5,
    });
  }
  for (const tag of tags) {
    urls.push({
      loc: `${origin}${blogTagHref(tag)}`,
      lastmod: tag.updatedAt ?? tag.createdAt,
      changefreq: 'weekly',
      priority: 0.4,
    });
  }
  return urls;
}

/**
 * Adds reciprocal hreflang to a market's page and product URLs.
 *
 * Only where a real equivalent is published in the other market, found by
 * identity — the same product, the same page group — so a market whose
 * address for it differs is still paired correctly. An alternate pointing at
 * a page that does not exist is worse than none, and a market that has not
 * been given a page yet must not have one claimed on its behalf.
 *
 * Nothing is canonicalised to India. Each market's page is its own canonical —
 * canonicalising every market to the root would tell search engines the other
 * markets are duplicates that need not be shown.
 */
export async function withAlternates(
  country: CountryContext,
  urls: EntityUrl[],
): Promise<SitemapUrl[]> {
  // A market withheld from the sitemaps is not announced as an alternate
  // either: it is asking not to be indexed, or not to be listed.
  const countries = await listSitemapCountries();
  if (countries.length < 2) return urls.map(({ entity: _entity, ...url }) => url);

  const origin = base();
  const listed = new Set(countries.map((candidate) => candidate.id));
  const [pages, products] = await Promise.all([
    prisma.page.findMany({
      where: { ...listedPageWhere(), countryId: { in: [...listed] } },
      select: { id: true, slug: true, countryId: true, groupKey: true },
    }),
    prisma.productCountry.findMany({
      where: {
        countryId: { in: [...listed] },
        deletedAt: null,
        noIndex: false,
        status: 'PUBLISHED',
        OR: [{ publishedAt: null }, { publishedAt: { lte: new Date() } }],
        product: { deletedAt: null, noIndex: false },
      },
      select: { countryId: true, product: { select: { id: true, slug: true } } },
    }),
  ]);

  const url = (path: string) => `${origin}${path}`.replace(/\/$/, '') || origin;

  // group (or, for pages not grouped yet, slug) → the markets' pages in it.
  const pageGroups = new Map<string, Array<{ countryId: string; path: string }>>();
  for (const page of pages) {
    const key = page.groupKey ? `g:${page.groupKey}` : `s:${page.slug}`;
    const market = countries.find((candidate) => candidate.id === page.countryId);
    if (!market) continue;
    pageGroups.set(key, [...(pageGroups.get(key) ?? []), { countryId: page.countryId, path: pageHref(market, page) }]);
  }
  const productGroups = new Map<string, Array<{ countryId: string; path: string }>>();
  for (const row of products) {
    const market = countries.find((candidate) => candidate.id === row.countryId);
    if (!market) continue;
    productGroups.set(row.product.id, [
      ...(productGroups.get(row.product.id) ?? []),
      { countryId: row.countryId, path: productHref(market, row.product) },
    ]);
  }

  return urls.map(({ entity, ...entry }) => {
    if (!entity) return entry;
    const group =
      entity.kind === 'product'
        ? productGroups.get(entity.id)
        : pageGroups.get(entity.groupKey ? `g:${entity.groupKey}` : `s:${entity.slug}`);
    if (!group || group.length < 2) return entry;

    const alternates = countries.flatMap((candidate) => {
      const match = group.find((member) => member.countryId === candidate.id);
      return match ? [{ hreflang: candidate.locale, href: url(match.path) }] : [];
    });
    return alternates.length > 1 ? { ...entry, alternates } : entry;
  });
}

/** Serialises a urlset, escaping every value the database supplies. */
export function renderUrlset(urls: readonly SitemapUrl[]): string {
  const rows = urls
    .map((url) => {
      const parts = [`    <loc>${xmlEscape(url.loc)}</loc>`];
      parts.push(`    <lastmod>${url.lastmod.toISOString()}</lastmod>`);
      if (url.changefreq) parts.push(`    <changefreq>${url.changefreq}</changefreq>`);
      if (url.priority !== undefined) parts.push(`    <priority>${url.priority}</priority>`);
      for (const alternate of url.alternates ?? []) {
        parts.push(
          `    <xhtml:link rel="alternate" hreflang="${xmlEscape(alternate.hreflang)}" href="${xmlEscape(alternate.href)}" />`,
        );
      }
      return `  <url>\n${parts.join('\n')}\n  </url>`;
    })
    .join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    rows,
    '</urlset>',
    '',
  ].join('\n');
}

/** Serialises the index. */
export function renderIndex(children: readonly SitemapChild[]): string {
  const origin = base();
  const rows = children
    .map(
      (child) =>
        `  <sitemap>\n    <loc>${xmlEscape(`${origin}/sitemaps/${child.name}.xml`)}</loc>\n    <lastmod>${child.lastmod.toISOString()}</lastmod>\n  </sitemap>`,
    )
    .join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    rows,
    '</sitemapindex>',
    '',
  ].join('\n');
}

/**
 * Every child sitemap the index should list.
 *
 * A market with nothing published contributes no sitemap rather than an empty
 * one, and a market withheld in its settings contributes none at all.
 */
export async function sitemapChildren(): Promise<SitemapChild[]> {
  const countries = await listSitemapCountries();

  const children: SitemapChild[] = [];

  for (const country of countries) {
    const urls = await countryUrls(country);
    if (urls.length === 0) continue;

    const newest = urls.reduce(
      (latest, url) => (url.lastmod > latest ? url.lastmod : latest),
      urls[0].lastmod,
    );
    // The root market's file is named "root" rather than "" so the URL is
    // readable; every other market uses its own prefix.
    const pages = Math.ceil(urls.length / MAX_URLS_PER_SITEMAP);
    for (let page = 0; page < pages; page += 1) {
      children.push({
        name: `${country.slug || 'root'}${page > 0 ? `-${page + 1}` : ''}`,
        label: country.name,
        lastmod: newest,
        count: Math.min(MAX_URLS_PER_SITEMAP, urls.length - page * MAX_URLS_PER_SITEMAP),
      });
    }
  }

  const blog = await blogUrls();
  if (blog.length > 0) {
    const newest = blog.reduce(
      (latest, url) => (url.lastmod > latest ? url.lastmod : latest),
      blog[0].lastmod,
    );
    children.push({ name: 'blog', label: 'Blog', lastmod: newest, count: blog.length });
  }

  return children;
}

/** Resolves a child sitemap name to its URLs, or null when there is no such file. */
export async function childUrls(name: string): Promise<SitemapUrl[] | null> {
  if (name === 'blog') return blogUrls();

  const match = /^(.*?)(?:-(\d+))?$/.exec(name);
  const slugPart = match?.[1] ?? name;
  const page = match?.[2] ? Number(match[2]) - 1 : 0;
  const slug = slugPart === 'root' ? '' : slugPart;

  const countries = await listSitemapCountries();
  const country = countries.find((candidate) => candidate.slug === slug);
  if (!country) return null;

  const all = await withAlternates(country, await countryUrls(country));
  const slice = all.slice(page * MAX_URLS_PER_SITEMAP, (page + 1) * MAX_URLS_PER_SITEMAP);
  return slice.length > 0 ? slice : null;
}

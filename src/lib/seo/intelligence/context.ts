import 'server-only';
import type { SeoSettings, WebsiteSettings } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { getSeoSettings, getWebsiteSettings } from '@/lib/services/settings';
import { getBlogSettings, getBlogSections } from '@/lib/services/blog-cms';
import { getCountrySettings } from '@/lib/country/settings';
import { listCountries } from '@/lib/country/registry';
import type { CountryContext, CountrySettingsView } from '@/lib/country/types';
import { compileRobots } from '@/lib/seo/robots';
import { parseRobots, type RobotsRules } from '@/lib/seo/robots-match';
import { fingerprint } from '@/lib/seo/content/text';
import type { SectionForExtraction } from '@/lib/seo/content/sections';
import { SEO_ENGINE_VERSION } from '@/lib/seo/types';
import { siteUrl } from '@/lib/env';
import { getUrlSnapshot } from '@/lib/urls/load';

/**
 * Everything outside a page that shapes its score.
 *
 * Title templates, the default description and share image, market settings,
 * robots rules, whether sitemaps are on, the blog's layouts — read once and
 * shared by every document built in the same pass. The fingerprint changes
 * whenever any of it does, which is what marks every cached score stale after
 * somebody edits a template or switches a market to noindex.
 */

type BlogSettingsView = Awaited<ReturnType<typeof getBlogSettings>>;

export type SeoContext = {
  origin: string;
  seo: SeoSettings;
  site: WebsiteSettings;
  blog: BlogSettingsView;
  countries: CountryContext[];
  byId: Map<string, CountryContext>;
  root: CountryContext;
  /** Markets that are active and published: the ones search engines are invited into. */
  indexableMarkets: number;
  local: Map<string, CountrySettingsView>;
  marketRules: Map<string, { excludeFromSitemap: boolean; noIndexCountry: boolean }>;
  robots: RobotsRules;
  articleSections: SectionForExtraction[];
  listingSections: SectionForExtraction[];
  fingerprint: string;
};

const TTL_MS = 15_000;
let cached: { at: number; value: Promise<SeoContext> } | null = null;

/**
 * The context, reused for a few seconds.
 *
 * An editor's live score asks for it on every pause in typing; a batch
 * recalculation asks once per chunk. Settings change rarely, and the
 * fingerprint of a fresh read is what staleness is judged against, so a
 * short-lived copy is safe.
 */
export function loadSeoContext(options: { fresh?: boolean } = {}): Promise<SeoContext> {
  const now = Date.now();
  if (!options.fresh && cached && now - cached.at < TTL_MS) return cached.value;
  const value = readContext();
  cached = { at: now, value };
  value.catch(() => {
    if (cached?.value === value) cached = null;
  });
  return value;
}

async function readContext(): Promise<SeoContext> {
  // Documents are built with the registry's addresses; the snapshot is
  // loaded first so every link helper they call reads the current one.
  const urls = await getUrlSnapshot();
  const [seo, site, blog, countries, settingsRows, articleRows, listingRows] = await Promise.all([
    getSeoSettings(),
    getWebsiteSettings(),
    getBlogSettings(),
    listCountries(),
    prisma.countrySettings.findMany({
      select: {
        countryId: true,
        robotsDisallow: true,
        robotsAllow: true,
        noIndexCountry: true,
        excludeFromSitemap: true,
        updatedAt: true,
      },
    }),
    getBlogSections('ARTICLE'),
    getBlogSections('LISTING'),
  ]);

  const byId = new Map(countries.map((country) => [country.id, country]));
  const root = countries.find((country) => country.isDefault) ?? countries[0]!;
  const local = new Map<string, CountrySettingsView>(
    await Promise.all(
      countries.map(async (country) => [country.id, await getCountrySettings(country)] as const),
    ),
  );
  const rowsById = new Map(settingsRows.map((row) => [row.countryId, row]));

  const robots = compileRobots({
    baseUrl: siteUrl().replace(/\/$/, ''),
    noIndexSite: seo.noIndexSite,
    sitemapEnabled: seo.sitemapEnabled,
    extra: seo.robotsTxtExtra,
    countries: countries.map((country) => {
      const row = rowsById.get(country.id);
      return {
        slug: country.slug,
        name: country.name,
        isActive: country.isActive,
        isPublished: country.isPublished,
        disallow: row?.robotsDisallow ?? null,
        allow: row?.robotsAllow ?? null,
        noIndexCountry: row?.noIndexCountry ?? false,
        excludeFromSitemap: row?.excludeFromSitemap ?? false,
      };
    }),
  });

  const toSection = (row: {
    id: string;
    blockType: string;
    content: unknown;
    isVisible: boolean;
    sortOrder: number;
  }): SectionForExtraction => ({
    id: row.id,
    blockType: row.blockType,
    content: row.content,
    isVisible: row.isVisible,
    sortOrder: row.sortOrder,
  });

  const articleSections = articleRows.map(toSection);
  const listingSections = listingRows.map(toSection);

  const contextFingerprint = fingerprint(
    JSON.stringify({
      engine: SEO_ENGINE_VERSION,
      seo: [
        seo.defaultTitle,
        seo.titleTemplate,
        seo.defaultDescription,
        seo.defaultOgImageUrl,
        seo.twitterHandle,
        seo.organizationName,
        seo.organizationLogoUrl,
        seo.organizationType,
        seo.noIndexSite,
        seo.sitemapEnabled,
        seo.robotsTxtExtra,
      ],
      site: [
        site.siteName,
        site.logoUrl,
        site.ogImageUrl,
        site.siteDescription,
        site.linkedinUrl,
        site.twitterUrl,
        site.facebookUrl,
        site.instagramUrl,
        site.youtubeUrl,
      ],
      blog: [blog.seoTitle, blog.seoDescription, blog.canonicalUrl, blog.ogImageUrl, blog.noIndex, blog.noFollow, blog.postsPerPage],
      countries: countries.map((country) => [
        country.id,
        country.slug,
        country.locale,
        country.isActive,
        country.isPublished,
        country.isDefault,
      ]),
      markets: settingsRows.map((row) => [row.countryId, row.updatedAt.getTime()]),
      // A pattern change or switching the registry on moves many addresses at
      // once; single-address edits refresh their own score instead.
      urls: [urls.enabled, [...urls.patterns.entries()].sort()],
      article: articleSections.map((section) => [section.blockType, section.isVisible, section.sortOrder, section.content]),
      listing: listingSections.map((section) => [section.blockType, section.isVisible, section.sortOrder, section.content]),
    }),
  );

  return {
    origin: siteUrl().replace(/\/$/, ''),
    seo,
    site,
    blog,
    countries,
    byId,
    root,
    indexableMarkets: countries.filter((country) => country.isActive && country.isPublished).length,
    local,
    marketRules: new Map(
      settingsRows.map((row) => [
        row.countryId,
        { excludeFromSitemap: row.excludeFromSitemap, noIndexCountry: row.noIndexCountry },
      ]),
    ),
    robots: parseRobots(robots.body),
    articleSections,
    listingSections,
    fingerprint: contextFingerprint,
  };
}

/** Clears the short-lived copy, after a settings change or a full recalculation. */
export function forgetSeoContext(): void {
  cached = null;
}

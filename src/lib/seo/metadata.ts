import 'server-only';
import type { Metadata } from 'next';
import { getSeoSettings, getWebsiteSettings } from '@/lib/services/settings';
import { getCountrySettings } from '@/lib/country/settings';
import { getRequestCountry } from '@/lib/country/request';
import { listActiveCountries } from '@/lib/country/registry';
import { countryPath } from '@/lib/country/routing';
import type { CountryContext } from '@/lib/country/types';
import { siteUrl } from '@/lib/env';

export type SeoInput = {
  title?: string | null;
  description?: string | null;
  /**
   * The path *within* the market, without its prefix — `/dropbox-business`,
   * never `/ae/dropbox-business`. The market prefix is added here so no caller
   * has to remember it and no canonical can be built for the wrong market.
   */
  path?: string;
  /** The market this page belongs to. Resolved from the request when omitted. */
  country?: CountryContext;
  /**
   * Markets where an equivalent, indexable page is live.
   *
   * hreflang is emitted only for these, so an alternate can never point at a
   * draft, a missing page or a URL that would 404.
   */
  alternateCountryIds?: readonly string[];
  /**
   * The page's public address, market prefix included, as the URL registry
   * resolved it. Takes precedence over `path`, because a market's address
   * need not be the root market's address with a prefix.
   */
  publicPath?: string;
  /**
   * Each market's own address for the same content, found by identity rather
   * than by assuming every market uses the same path. Takes precedence over
   * `alternateCountryIds`.
   */
  alternates?: ReadonlyArray<{ countryId: string; path: string }>;
  canonicalUrl?: string | null;
  noIndex?: boolean;
  noFollow?: boolean;
  ogTitle?: string | null;
  ogDescription?: string | null;
  ogImageUrl?: string | null;
  twitterTitle?: string | null;
  twitterDescription?: string | null;
  twitterImageUrl?: string | null;
  type?: 'website' | 'article' | 'product';
  publishedTime?: Date | null;
  modifiedTime?: Date | null;
  authorName?: string | null;
  /**
   * The entity's primary keywords. Accepted so every surface can pass what it
   * has, and deliberately **not** emitted: primary keywords are inputs to SEO
   * Intelligence's analysis, not page markup. A `<meta name="keywords">` tag
   * does nothing for rankings and would only publish what each page targets.
   */
  keywords?: readonly string[] | null;
};

export function absoluteUrl(path = '/'): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${siteUrl()}${path.startsWith('/') ? path : `/${path}`}`;
}

/** The absolute URL of a market-relative path, in that market. */
export function absoluteCountryUrl(country: CountryContext, path = '/'): string {
  return absoluteUrl(countryPath(country, path));
}

/**
 * Merges entity SEO values over the market's defaults, then the global ones.
 *
 * Two rules matter here and are not negotiable:
 *
 *  - a market's canonical always points at its own URL. A UAE page canonicals
 *    to `/ae/…`, never to India's page, because they are different pages for
 *    different customers;
 *  - hreflang is emitted only for markets that actually have that content live
 *    and indexable, so the annotations never point at a draft or a 404.
 */
export async function buildMetadata(input: SeoInput): Promise<Metadata> {
  const country = input.country ?? (await getRequestCountry());
  const [seo, site, local, activeCountries] = await Promise.all([
    getSeoSettings(),
    getWebsiteSettings(),
    getCountrySettings(country),
    listActiveCountries(),
  ]);

  const rawTitle = input.title?.trim() || local.defaultTitle;
  const template = local.titleTemplate || seo.titleTemplate;
  const title =
    input.title && template.includes('%s') ? template.replace('%s', rawTitle) : rawTitle;

  const description = input.description?.trim() || local.defaultDescription;
  const path = input.path ?? '/';
  const canonical =
    input.canonicalUrl?.trim() ||
    (input.publicPath ? absoluteUrl(input.publicPath) : absoluteCountryUrl(country, path));
  const ogImage = input.ogImageUrl || local.defaultOgImageUrl || site.ogImageUrl || null;

  /*
   * Three independent switches, any one of which is enough: the whole site, the
   * market, or this page. The market switch is read from this page's own
   * market — never another's — and a market with no settings row is indexable.
   * It is a meta tag rather than a robots.txt rule on purpose: a page a crawler
   * is blocked from fetching never has its noindex read, so blocking would
   * achieve the opposite of what it looks like. No X-Robots-Tag header is sent
   * for public pages; only /admin and the sign-in screen get one, from
   * next.config.mjs.
   */
  const noIndex =
    seo.noIndexSite || Boolean(local.noIndexCountry) || Boolean(input.noIndex);

  /*
   * Alternates are built from the same market-relative path, so the annotation
   * set stays correct without any caller assembling URLs itself. A market is
   * listed only when the caller confirmed the content exists there; a page that
   * exists in one market alone simply gets no hreflang, which is exactly right.
   */
  const languages: Record<string, string> = {};
  if (!noIndex && input.alternates && input.alternates.length > 1) {
    const byCountry = new Map(input.alternates.map((alternate) => [alternate.countryId, alternate.path]));
    for (const candidate of activeCountries) {
      const alternatePath = byCountry.get(candidate.id);
      if (alternatePath) languages[candidate.locale] = absoluteUrl(alternatePath);
    }
    const root = activeCountries.find((candidate) => candidate.isDefault);
    const rootPath = root ? byCountry.get(root.id) : undefined;
    if (rootPath) languages['x-default'] = absoluteUrl(rootPath);
  } else if (!noIndex && input.alternateCountryIds && input.alternateCountryIds.length > 1) {
    const allowed = new Set(input.alternateCountryIds);
    for (const candidate of activeCountries) {
      if (!allowed.has(candidate.id)) continue;
      languages[candidate.locale] = absoluteCountryUrl(candidate, path);
    }
    const root = activeCountries.find((candidate) => candidate.isDefault);
    if (root && allowed.has(root.id)) {
      languages['x-default'] = absoluteCountryUrl(root, path);
    }
  }

  return {
    metadataBase: new URL(siteUrl()),
    /*
     * `absolute` stops Next from applying the root layout's title template on
     * top of the one already applied above, which would repeat the suffix
     * ("Page | Site | Site").
     */
    title: { absolute: title },
    description,
    alternates: {
      canonical,
      ...(Object.keys(languages).length > 0 ? { languages } : {}),
    },
    robots: {
      index: !noIndex,
      follow: !input.noFollow,
      googleBot: { index: !noIndex, follow: !input.noFollow },
    },
    openGraph: {
      type: input.type === 'product' ? 'website' : input.type ?? 'website',
      title: input.ogTitle?.trim() || title,
      description: input.ogDescription?.trim() || description,
      url: canonical,
      siteName: site.siteName,
      locale: country.locale.replace('-', '_'),
      images: ogImage ? [{ url: absoluteUrl(ogImage) }] : undefined,
      ...(input.type === 'article'
        ? {
            publishedTime: input.publishedTime?.toISOString(),
            modifiedTime: input.modifiedTime?.toISOString(),
            authors: input.authorName ? [input.authorName] : undefined,
          }
        : {}),
    },
    twitter: {
      card: ogImage ? 'summary_large_image' : 'summary',
      title: input.twitterTitle?.trim() || input.ogTitle?.trim() || title,
      description: input.twitterDescription?.trim() || input.ogDescription?.trim() || description,
      site: seo.twitterHandle || undefined,
      images: input.twitterImageUrl
        ? [absoluteUrl(input.twitterImageUrl)]
        : ogImage
          ? [absoluteUrl(ogImage)]
          : undefined,
    },
    verification: {
      google: seo.googleSiteVerification || undefined,
      other: seo.bingSiteVerification ? { 'msvalidate.01': seo.bingSiteVerification } : undefined,
    },
  };
}

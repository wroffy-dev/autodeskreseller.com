import 'server-only';
import { countryPath } from '@/lib/country/routing';
import { isRootOnlyLink } from '@/lib/urls/links';
import type { CountryContext, CountrySettingsView } from '@/lib/country/types';
import { blockingRule } from '@/lib/seo/robots-match';
import type { SeoCountryRef, SeoDocument } from '@/lib/seo/types';
import type { SeoContext } from './context';

/**
 * A page's metadata, resolved the way `buildMetadata` resolves it.
 *
 * Every fallback here is the one the public page applies: an SEO title falls
 * back to the page's name and then to the market's default; the template is
 * applied only to a title the page supplied; the share image falls back to the
 * market's and then the site's. Documents built from these describe what the
 * page actually serves, not what an editor might assume it does.
 */

export function countryRef(country: CountryContext): SeoCountryRef {
  return {
    id: country.id,
    code: country.code,
    name: country.name,
    slug: country.slug,
    locale: country.locale,
    currency: country.currency,
    isDefault: country.isDefault,
    isActive: country.isActive,
    isPublished: country.isPublished,
  };
}

export function localOf(ctx: SeoContext, country: CountryContext): CountrySettingsView {
  const local = ctx.local.get(country.id);
  if (!local) throw new Error(`No settings resolved for market ${country.code}`);
  return local;
}

export function absolute(ctx: SeoContext, path: string): string {
  return path === '/' ? `${ctx.origin}/` : `${ctx.origin}${path}`;
}

export function marketPath(country: Pick<CountryContext, 'slug'>, path: string): string {
  return countryPath(country, path);
}

export function renderTitle(
  ctx: SeoContext,
  local: CountrySettingsView,
  candidates: { seo: Array<string | null | undefined>; fallback: Array<string | null | undefined> },
): Pick<SeoDocument['meta'], 'title' | 'ownTitle' | 'titleSource'> {
  const seo = candidates.seo.map((value) => value?.trim()).find(Boolean);
  const fallback = candidates.fallback.map((value) => value?.trim()).find(Boolean);
  const own = seo ?? fallback ?? '';
  const template = local.titleTemplate || ctx.seo.titleTemplate;
  if (!own) {
    return { title: local.defaultTitle, ownTitle: local.defaultTitle, titleSource: 'default' };
  }
  return {
    title: template.includes('%s') ? template.replace('%s', own) : own,
    ownTitle: own,
    titleSource: seo ? 'seo' : 'fallback',
  };
}

export function renderDescription(
  local: CountrySettingsView,
  candidates: { seo: Array<string | null | undefined>; fallback: Array<string | null | undefined> },
): Pick<SeoDocument['meta'], 'description' | 'descriptionSource'> {
  const seo = candidates.seo.map((value) => value?.trim()).find(Boolean);
  if (seo) return { description: seo, descriptionSource: 'seo' };
  const fallback = candidates.fallback.map((value) => value?.trim()).find(Boolean);
  if (fallback) return { description: fallback, descriptionSource: 'fallback' };
  return { description: local.defaultDescription, descriptionSource: 'default' };
}

/** The canonical a page serves, and which other market an explicit one points into. */
export function renderCanonical(
  ctx: SeoContext,
  country: CountryContext,
  explicit: string | null | undefined,
  selfPath: string,
): SeoDocument['meta']['canonical'] {
  const self = absolute(ctx, selfPath);
  const value = explicit?.trim() || null;
  let otherMarket: string | null = null;
  if (value) {
    try {
      const url = new URL(value);
      const origin = new URL(ctx.origin);
      if (url.host.replace(/^www\./, '') === origin.host.replace(/^www\./, '')) {
        const first = url.pathname.split('/').filter(Boolean)[0] ?? '';
        const prefixed = ctx.countries.find((candidate) => candidate.slug && candidate.slug === first);
        // Blog URLs are root-only, so a canonical to the blog is never another market's.
        const owner = prefixed ?? (isRootOnlyLink(url.pathname) ? country : ctx.root);
        if (owner && owner.id !== country.id) otherMarket = owner.name;
      }
    } catch {
      otherMarket = null;
    }
  }
  return { explicit: value, effective: value ?? self, self, otherMarket };
}

/** Whether the page is noindex, and every reason it is. */
export function noIndexReasons(
  ctx: SeoContext,
  local: CountrySettingsView,
  flags: { entity?: boolean; shared?: boolean; blog?: boolean; city?: boolean },
): SeoDocument['robots']['noIndexReasons'] {
  const reasons: SeoDocument['robots']['noIndexReasons'] = [];
  if (flags.entity) reasons.push('entity');
  if (flags.shared) reasons.push('shared');
  if (flags.city) reasons.push('city');
  if (flags.blog) reasons.push('blog');
  if (local.noIndexCountry) reasons.push('market');
  if (ctx.seo.noIndexSite) reasons.push('site');
  return reasons;
}

export function robotsOf(
  ctx: SeoContext,
  path: string,
  input: {
    reasons: SeoDocument['robots']['noIndexReasons'];
    noFollow: boolean;
    inSitemap: boolean;
    sitemapExclusion: string | null;
  },
): SeoDocument['robots'] {
  const rule = blockingRule(ctx.robots, path);
  return {
    noIndex: input.reasons.length > 0,
    noFollow: input.noFollow,
    noIndexReasons: input.reasons,
    inSitemap: input.inSitemap,
    sitemapExclusion: input.sitemapExclusion,
    blockedByRobots: Boolean(rule),
    blockingRule: rule,
  };
}

/**
 * Why a market's live page is not in its sitemap, mirroring `countryUrls`:
 * sitemaps switched off, the market inactive or unpublished, or excluded.
 */
/** Why a city keeps its pages out of the sitemap, when it does. The market's reasons come first. */
export function citySitemapExclusion(
  city: { name: string; isActive: boolean; isPublished: boolean; excludeFromSitemap: boolean } | null,
): string | null {
  if (!city) return null;
  if (!city.isActive) return `the city ${city.name} is switched off`;
  if (!city.isPublished) return `the city ${city.name} is not published yet`;
  if (city.excludeFromSitemap) return `the city ${city.name} is excluded from the sitemap in Locations → Cities`;
  return null;
}

export function marketSitemapExclusion(ctx: SeoContext, country: CountryContext): string | null {
  if (!ctx.seo.sitemapEnabled) return 'sitemaps are switched off in Admin → SEO';
  if (!country.isActive) return `the ${country.name} market is switched off`;
  if (!country.isPublished) return `the ${country.name} market is not published yet`;
  if (ctx.marketRules.get(country.id)?.excludeFromSitemap) {
    return `${country.name} is excluded from the sitemap in Countries settings`;
  }
  return null;
}

export function socialOf(
  ctx: SeoContext,
  local: CountrySettingsView,
  input: {
    title: string;
    description: string;
    ogTitle?: string | null;
    ogDescription?: string | null;
    twitterTitle?: string | null;
    ogImage?: string | null;
    fallbackImage?: string | null;
  },
): SeoDocument['social'] {
  const defaultImage = local.defaultOgImageUrl || ctx.site.ogImageUrl || null;
  const ogImage = input.ogImage
    ? { url: input.ogImage, source: 'entity' as const }
    : input.fallbackImage
      ? { url: input.fallbackImage, source: 'fallback' as const }
      : defaultImage
        ? { url: defaultImage, source: 'default' as const }
        : null;
  return {
    ogTitle: input.ogTitle?.trim() || input.title,
    ogTitleExplicit: Boolean(input.ogTitle?.trim()),
    ogDescription: input.ogDescription?.trim() || input.description,
    ogDescriptionExplicit: Boolean(input.ogDescription?.trim()),
    ogImage,
    twitterCard: ogImage ? 'summary_large_image' : 'summary',
    twitterSite: ctx.seo.twitterHandle || null,
    twitterTitleExplicit: Boolean(input.twitterTitle?.trim()),
  };
}

export function entityOf(ctx: SeoContext, local: CountrySettingsView): SeoDocument['entity'] {
  const site = ctx.site;
  return {
    siteName: site.siteName,
    organizationName: local.organizationName,
    hasLogo: Boolean(local.organizationLogoUrl || site.logoUrl),
    sameAsCount: [site.linkedinUrl, site.twitterUrl, site.facebookUrl, site.instagramUrl, site.youtubeUrl].filter(Boolean)
      .length,
    hasAddress: Boolean(local.addressLine1 || local.city || local.region || local.postalCode || local.address),
    hasPhone: Boolean(local.salesPhone || local.supportPhone),
    hasEmail: Boolean(local.salesEmail || local.supportEmail),
    localBusinessType: local.localBusinessType,
  };
}

/**
 * The hreflang locales a page announces, as `buildMetadata` builds them: none
 * for a noindex page, and only when the content is live in two markets or more.
 */
export function alternatesOf(
  ctx: SeoContext,
  liveIn: readonly string[],
  noIndex: boolean,
): SeoDocument['alternates'] {
  const locales: string[] = [];
  if (!noIndex && liveIn.length > 1) {
    const allowed = new Set(liveIn);
    for (const candidate of ctx.countries) {
      if (candidate.isActive && allowed.has(candidate.id)) locales.push(candidate.locale);
    }
  }
  return { locales, indexableMarkets: ctx.indexableMarkets };
}

/** A publish state as the public site judges it. */
export function isPublished(status: string, publishedAt: Date | null, now = new Date()): boolean {
  return status === 'PUBLISHED' && (!publishedAt || publishedAt <= now);
}

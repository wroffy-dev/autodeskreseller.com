import 'server-only';
import type { WebsiteSettings } from '@prisma/client';
import { countryPath } from '@/lib/country/routing';
import type { CountryContext, CountrySettingsView } from '@/lib/country/types';
import { absoluteUrl, absoluteCountryUrl } from './metadata';
import { blogArchiveHref } from '@/lib/urls/links';

type Json = Record<string, unknown>;

/**
 * The organisation behind one market.
 *
 * Name, contact details, address and organisation type all come from that
 * market's settings — which fall back to the global ones, so the root market
 * emits exactly what it emitted before markets existed. `url` is the market's
 * own home page, never the site root, so the UAE storefront never claims
 * India's URL as its organisation page.
 */
export function organizationSchema(
  country: CountryContext,
  local: CountrySettingsView,
  site: WebsiteSettings,
): Json {
  const sameAs = [site.linkedinUrl, site.twitterUrl, site.facebookUrl, site.instagramUrl, site.youtubeUrl].filter(
    Boolean,
  );

  const postalAddress =
    local.addressLine1 || local.city || local.region || local.postalCode || local.address
      ? {
          address: {
            '@type': 'PostalAddress',
            ...(local.addressLine1 || local.address
              ? { streetAddress: local.addressLine1 ?? local.address }
              : {}),
            ...(local.addressLine2 ? { addressLocality: local.addressLine2 } : {}),
            ...(local.city ? { addressLocality: local.city } : {}),
            ...(local.region ? { addressRegion: local.region } : {}),
            ...(local.postalCode ? { postalCode: local.postalCode } : {}),
            addressCountry: country.code,
          },
        }
      : {};

  return {
    '@context': 'https://schema.org',
    '@type': local.localBusinessType || local.organizationType || 'Organization',
    name: local.organizationName,
    ...(local.legalName ? { legalName: local.legalName } : {}),
    url: absoluteCountryUrl(country, '/'),
    ...(local.organizationLogoUrl || site.logoUrl
      ? { logo: absoluteUrl(local.organizationLogoUrl ?? site.logoUrl ?? '') }
      : {}),
    ...(site.siteDescription ? { description: site.siteDescription } : {}),
    ...(sameAs.length ? { sameAs } : {}),
    ...(local.salesEmail || local.salesPhone || local.supportPhone
      ? {
          contactPoint: [
            ...(local.salesEmail || local.salesPhone
              ? [
                  {
                    '@type': 'ContactPoint',
                    contactType: 'sales',
                    ...(local.salesEmail ? { email: local.salesEmail } : {}),
                    ...(local.salesPhone ? { telephone: local.salesPhone } : {}),
                    areaServed: country.code,
                  },
                ]
              : []),
            ...(local.supportPhone || local.supportEmail
              ? [
                  {
                    '@type': 'ContactPoint',
                    contactType: 'customer support',
                    ...(local.supportEmail ? { email: local.supportEmail } : {}),
                    ...(local.supportPhone ? { telephone: local.supportPhone } : {}),
                    areaServed: country.code,
                  },
                ]
              : []),
          ],
        }
      : {}),
    ...postalAddress,
    ...(local.businessHours ? { openingHours: local.businessHours } : {}),
    ...(local.taxNumber ? { taxID: local.taxNumber } : {}),
    ...(local.latitude && local.longitude
      ? { geo: { '@type': 'GeoCoordinates', latitude: local.latitude, longitude: local.longitude } }
      : {}),
  };
}

export function websiteSchema(country: CountryContext, site: WebsiteSettings): Json {
  // The blog is root-only: its search lives at the one archive address.
  const blog = absoluteUrl(blogArchiveHref());
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: site.siteName,
    url: absoluteCountryUrl(country, '/'),
    inLanguage: country.locale,
    potentialAction: {
      '@type': 'SearchAction',
      target: { '@type': 'EntryPoint', urlTemplate: `${blog}?q={search_term_string}` },
      'query-input': 'required name=search_term_string',
    },
  };
}

export function breadcrumbSchema(items: Array<{ name: string; path: string }>): Json {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  };
}

export function productSchema(input: {
  name: string;
  description: string | null;
  /** The product's absolute URL in the market being rendered. */
  url: string;
  imageUrl: string | null;
  price: string | null;
  currency: string;
  sku: string | null;
  brand: string;
}): Json {
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: input.name,
    ...(input.description ? { description: input.description } : {}),
    ...(input.imageUrl ? { image: absoluteUrl(input.imageUrl) } : {}),
    ...(input.sku ? { sku: input.sku } : {}),
    brand: { '@type': 'Brand', name: input.brand },
    url: input.url,
    ...(input.price
      ? {
          offers: {
            '@type': 'Offer',
            price: input.price,
            priceCurrency: input.currency,
            availability: 'https://schema.org/InStock',
            url: input.url,
          },
        }
      : {}),
  };
}

export function articleSchema(input: {
  title: string;
  description: string | null;
  url: string;
  imageUrl: string | null;
  publishedAt: Date | null;
  updatedAt: Date;
  authorName: string | null;
  organizationName: string;
  logoUrl: string | null;
}): Json {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: input.title,
    ...(input.description ? { description: input.description } : {}),
    ...(input.imageUrl ? { image: [absoluteUrl(input.imageUrl)] } : {}),
    datePublished: (input.publishedAt ?? input.updatedAt).toISOString(),
    dateModified: input.updatedAt.toISOString(),
    ...(input.authorName ? { author: { '@type': 'Person', name: input.authorName } } : {}),
    publisher: {
      '@type': 'Organization',
      name: input.organizationName,
      ...(input.logoUrl ? { logo: { '@type': 'ImageObject', url: absoluteUrl(input.logoUrl) } } : {}),
    },
    mainEntityOfPage: { '@type': 'WebPage', '@id': input.url },
  };
}

export function faqSchema(items: Array<{ question: string; answer: string }>): Json | null {
  const valid = items.filter((i) => i.question.trim() && i.answer.trim());
  if (valid.length === 0) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: valid.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.answer.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
      },
    })),
  };
}

/**
 * BlogPosting for an article.
 *
 * Richer than the generic `articleSchema` above, which is kept for anything
 * else that needs it. Every optional property is emitted only when the post
 * actually carries the data — an article with no author, no category and no
 * tags produces no author, articleSection or keywords, rather than placeholders
 * that would be fabricated structured data.
 */
export function blogPostingSchema(input: {
  title: string;
  description: string | null;
  /** The article's absolute URL in the market being rendered. */
  url: string;
  /** BCP-47 tag of the market, e.g. en-AE. */
  locale?: string;
  imageUrl: string | null;
  publishedAt: Date | null;
  updatedAt: Date;
  wordCount?: number;
  keywords?: string[];
  section?: string | null;
  author: { name: string; jobTitle: string | null; url: string | null } | null;
  organizationName: string;
  logoUrl: string | null;
}): Json {
  const url = input.url;
  const keywords = (input.keywords ?? []).filter(Boolean);

  return {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: input.title.slice(0, 110),
    ...(input.description ? { description: input.description } : {}),
    ...(input.imageUrl ? { image: [absoluteUrl(input.imageUrl)] } : {}),
    datePublished: (input.publishedAt ?? input.updatedAt).toISOString(),
    dateModified: input.updatedAt.toISOString(),
    ...(input.author
      ? {
          author: {
            '@type': 'Person',
            name: input.author.name,
            ...(input.author.jobTitle ? { jobTitle: input.author.jobTitle } : {}),
            ...(input.author.url ? { url: input.author.url } : {}),
          },
        }
      : {}),
    publisher: {
      '@type': 'Organization',
      name: input.organizationName,
      ...(input.logoUrl
        ? { logo: { '@type': 'ImageObject', url: absoluteUrl(input.logoUrl) } }
        : {}),
    },
    ...(input.section ? { articleSection: input.section } : {}),
    ...(keywords.length > 0 ? { keywords: keywords.join(', ') } : {}),
    ...(input.wordCount && input.wordCount > 0 ? { wordCount: input.wordCount } : {}),
    inLanguage: input.locale ?? 'en',
    url,
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
  };
}

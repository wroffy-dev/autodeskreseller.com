import 'server-only';
import type { SeoSettings, WebsiteSettings } from '@prisma/client';
import { parseBlockContent, type FaqContent } from '@/lib/cms/blocks';
import type { CountryContext, CountrySettingsView } from '@/lib/country/types';
import { countryPath } from '@/lib/country/routing';
import { blogPath, categoryPath, postPath, tagPath } from '@/lib/cms/blog-render';
import { registeredLink } from '@/lib/urls/links';
import { absoluteUrl } from './metadata';
import {
  blogPostingSchema,
  breadcrumbSchema,
  faqSchema,
  organizationSchema,
  productSchema,
  websiteSchema,
} from './structured-data';

/**
 * The JSON-LD each kind of public page emits.
 *
 * The public surfaces render exactly these arrays, and SEO Intelligence
 * analyses exactly these arrays, so the structured data a page is scored on is
 * the structured data it serves — there is no second description of it to
 * drift out of step.
 */

type Json = Record<string, unknown>;

type SectionLike = { blockType: string; content: unknown; isVisible: boolean };

/** The organisation and website objects the public layout adds to every page. */
export function siteJsonLd(
  country: CountryContext,
  local: CountrySettingsView,
  site: WebsiteSettings,
): Json[] {
  return [organizationSchema(country, local, site), websiteSchema(country, site)];
}

/** Questions and answers from a page's visible FAQ sections. */
export function faqItemsOf(sections: readonly SectionLike[]): Array<{ question: string; answer: string }> {
  return sections
    .filter((section) => section.blockType === 'faq' && section.isVisible)
    .flatMap((section) => parseBlockContent<FaqContent>('faq', section.content).items);
}

export function cmsPageJsonLd(
  country: CountryContext,
  page: { title: string; slug: string; path?: string; sections: readonly SectionLike[] },
  siteName: string,
): Json[] {
  const faq = faqSchema(faqItemsOf(page.sections));
  const crumbs =
    page.slug === ''
      ? null
      : breadcrumbSchema([
          { name: siteName, path: countryPath(country) },
          { name: page.title, path: page.path ?? countryPath(country, page.slug) },
        ]);
  return [faq, crumbs].filter((item): item is Json => item !== null);
}

/** Where the "Plans" crumb goes: the market's pricing page, wherever it now lives. */
function plansPath(country: CountryContext): string {
  return registeredLink(country, '/pricing') ?? countryPath(country, 'pricing');
}

export function productPageJsonLd(
  country: CountryContext,
  product: {
    name: string;
    slug: string;
    /** The product's address in this market, from the URL registry. */
    href: string;
    shortDescription: string | null;
    imageUrl: string | null;
    monthlyPrice: string | null;
    currency: string;
    sku: string | null;
    brandName: string | null;
  },
  siteName: string,
  sections: readonly SectionLike[] = [],
): Json[] {
  // An FAQ the product page shows is described like any other page's.
  const faq = faqSchema(faqItemsOf(sections));
  return [
    productSchema({
      name: product.name,
      description: product.shortDescription,
      url: absoluteUrl(product.href),
      imageUrl: product.imageUrl,
      price: product.monthlyPrice,
      currency: product.currency,
      sku: product.sku,
      // The brand the page shows beside the product name. The site name is the
      // fallback for a product with no brand, which is what every product
      // declared before brands were read here.
      brand: product.brandName || siteName,
    }),
    breadcrumbSchema([
      { name: 'Home', path: countryPath(country) },
      { name: 'Plans', path: plansPath(country) },
      { name: product.name, path: product.href },
    ]),
    ...(faq ? [faq] : []),
  ];
}

export type BlogPostForSchema = {
  id: string;
  title: string;
  slug: string;
  seoDescription: string | null;
  excerpt: string | null;
  content: string;
  publishedAt: Date | null;
  updatedAt: Date;
  featuredImage: { url: string } | null;
  ogImage: { url: string } | null;
  tags: Array<{ tag: { name: string } }>;
  category: { id: string; name: string; slug: string } | null;
  author: {
    name: string;
    jobTitle: string | null;
    linkedinUrl: string | null;
    websiteUrl: string | null;
  } | null;
};

/*
 * The blog is root-only, so its trail starts at the root home page whichever
 * market's layout wraps it, and every blog address comes from the registry.
 */

export function blogPostJsonLd(
  country: CountryContext,
  post: BlogPostForSchema,
  site: Pick<WebsiteSettings, 'siteName' | 'logoUrl'>,
  seo: Pick<SeoSettings, 'organizationName' | 'organizationLogoUrl'>,
): Json[] {
  const url = postPath(post);
  return [
    blogPostingSchema({
      title: post.title,
      description: post.seoDescription || post.excerpt,
      url: absoluteUrl(url),
      locale: country.locale,
      imageUrl: post.featuredImage?.url ?? post.ogImage?.url ?? null,
      publishedAt: post.publishedAt,
      updatedAt: post.updatedAt,
      wordCount: post.content.replace(/<[^>]*>/g, ' ').split(/\s+/).filter(Boolean).length,
      keywords: post.tags.map(({ tag }) => tag.name),
      section: post.category?.name ?? null,
      author: post.author
        ? {
            name: post.author.name,
            jobTitle: post.author.jobTitle,
            url: post.author.linkedinUrl || post.author.websiteUrl,
          }
        : null,
      organizationName: seo.organizationName || site.siteName,
      logoUrl: seo.organizationLogoUrl ?? site.logoUrl,
    }),
    breadcrumbSchema([
      { name: 'Home', path: countryPath(country) },
      { name: 'Blog', path: blogPath() },
      ...(post.category ? [{ name: post.category.name, path: categoryPath(post.category) }] : []),
      { name: post.title, path: url },
    ]),
  ];
}

export function blogArchiveJsonLd(country: CountryContext): Json {
  return breadcrumbSchema([
    { name: 'Home', path: countryPath(country) },
    { name: 'Blog', path: blogPath() },
  ]);
}

export function blogCategoryJsonLd(
  country: CountryContext,
  category: {
    id: string;
    name: string;
    slug: string;
    parent: { id: string; name: string; slug: string } | null;
  },
): Json {
  return breadcrumbSchema([
    { name: 'Home', path: countryPath(country) },
    { name: 'Blog', path: blogPath() },
    ...(category.parent ? [{ name: category.parent.name, path: categoryPath(category.parent) }] : []),
    { name: category.name, path: categoryPath(category) },
  ]);
}

export function blogTagJsonLd(
  country: CountryContext,
  tag: { id: string; name: string; slug: string },
): Json {
  return breadcrumbSchema([
    { name: 'Home', path: countryPath(country) },
    { name: 'Blog', path: blogPath() },
    { name: tag.name, path: tagPath(tag) },
  ]);
}

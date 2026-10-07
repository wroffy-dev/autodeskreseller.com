import { z } from 'zod';
import { isReservedCountryPrefix } from '@/lib/country/routing';
import { primaryKeywordShape, rejectDuplicateKeywords } from '@/lib/seo/keywords';

/**
 * Country validation.
 *
 * The slug rules are the load-bearing part: a market prefix that collided with
 * a system route would shadow /admin or /api, and one that is not URL-safe
 * would produce links nobody can visit. The empty slug is legal and means "this
 * market is served from the site root" — exactly one market may hold it, which
 * the action enforces alongside the single-default rule.
 */

const optional = (max: number) =>
  z
    .string()
    .max(max, `Use ${max} characters or fewer.`)
    .optional()
    .nullable()
    .transform((value) => (value?.trim() ? value.trim() : null));

/**
 * A switch as a form submits it.
 *
 * These schemas read `Object.fromEntries(formData)`, so a switch arrives as
 * the string "true" or "false". `z.coerce.boolean()` turns any non-empty
 * string into true — "false" included — which switched a market to noindex
 * every time its settings were saved. Only an explicit yes counts as yes;
 * a missing value keeps the default.
 */
const formBoolean = (fallback: boolean) =>
  z.preprocess((value) => {
    if (value === undefined || value === null) return fallback;
    if (typeof value === 'boolean') return value;
    return ['true', 'on', '1'].includes(String(value).trim().toLowerCase());
  }, z.boolean());

export const countrySlugSchema = z
  .string()
  .max(12)
  .transform((value) => value.trim().toLowerCase().replace(/^\/+|\/+$/g, ''))
  .refine((value) => value === '' || /^[a-z0-9-]+$/.test(value), {
    message: 'Use lower-case letters, numbers and hyphens only',
  })
  .refine((value) => !isReservedCountryPrefix(value), {
    message: 'That prefix is reserved by the application',
  });

export const countrySchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, 'Use the two-letter ISO country code, e.g. QA'),
  slug: countrySlugSchema,
  locale: z
    .string()
    .trim()
    .min(2)
    .max(12)
    .regex(/^[A-Za-z-]+$/, 'Use a language tag such as en-AE'),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, 'Use the three-letter currency code, e.g. QAR'),
  currencySymbol: z.string().trim().min(1).max(8),
  phoneCode: optional(8),
  timezone: z.string().trim().min(1).max(64),
  isDefault: z.coerce.boolean().default(false),
  /**
   * Ready for search engines.
   *
   * Separate from isActive so a market can be built in the open — reachable by
   * anyone with the link, absent from every sitemap — before it is announced.
   * Defaults true so no existing market changes.
   */
  isPublished: z.coerce.boolean().default(true),
  isActive: z.coerce.boolean().default(true),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
});

export type CountryInput = z.infer<typeof countrySchema>;

/*
 * Every limit here is at least the limit of the global setting the same value
 * can come from. The multi-country migration and the seed copy the site's
 * email, default title and the rest into the root market's row, and a market
 * row holding a value this schema refuses can never be saved again — not even
 * to switch its crawler settings off, which is how "Ask search engines not to
 * index this market" came to spring back on after every save.
 */
export const countrySettingsSchema = z.object({
  // --- crawler rules --------------------------------------------------------
  // Free text, one path per line. The compiler in lib/seo/robots.ts is what
  // cleans, prefixes and refuses them — validating shape here as well would be
  // two places to keep in agreement.
  robotsDisallow: optional(2000),
  robotsAllow: optional(2000),
  noIndexCountry: formBoolean(false),
  excludeFromSitemap: formBoolean(false),
  companyName: optional(160),
  legalName: optional(160),
  salesPhone: optional(40),
  supportPhone: optional(40),
  whatsappNumber: optional(40),
  // WebsiteSettings.contactEmail allows 200.
  salesEmail: optional(200),
  supportEmail: optional(200),
  addressLine1: optional(200),
  addressLine2: optional(200),
  city: optional(120),
  region: optional(120),
  postalCode: optional(24),
  address: optional(600),
  businessHours: optional(160),
  taxLabel: optional(60),
  taxNumber: optional(60),
  headerCtaLabel: optional(60),
  headerCtaUrl: optional(300),
  salesCtaText: optional(200),
  // SeoSettings.defaultTitle allows 240.
  defaultTitle: optional(240),
  titleTemplate: optional(120),
  defaultDescription: optional(400),
  defaultOgImageUrl: optional(500),
  organizationName: optional(160),
  organizationType: optional(60),
  organizationLogoUrl: optional(500),
  localBusinessType: optional(60),
  latitude: optional(24),
  longitude: optional(24),
});

export type CountrySettingsInput = z.infer<typeof countrySettingsSchema>;

const money = z
  .string()
  .optional()
  .nullable()
  .transform((value) => (value?.trim() ? value.trim() : null))
  .refine((value) => value === null || /^\d{1,10}(\.\d{1,2})?$/.test(value), 'Enter a valid amount');

/**
 * A product's configuration in one market.
 *
 * Prices are validated as decimal strings and stored as Decimal — never Float,
 * and never converted from another market's currency.
 */
export const productCountrySchema = z.object({
  productId: z.string().min(1),
  countryId: z.string().min(1),
  status: z.enum(['DRAFT', 'PUBLISHED', 'SCHEDULED', 'ARCHIVED']).default('DRAFT'),
  publishedAt: z
    .string()
    .optional()
    .nullable()
    .transform((value) => (value ? new Date(value) : null))
    .refine((date) => date === null || !Number.isNaN(date.getTime()), 'Enter a valid date'),
  isFeatured: formBoolean(false),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
  featuredOrder: z.coerce.number().int().min(0).max(9999).default(0),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, 'Use a three-letter currency code'),
  monthlyPrice: money,
  annualPrice: money,
  compareAtPrice: money,
  discountPercent: z
    .string()
    .optional()
    .nullable()
    .transform((value) => (value?.trim() ? Number(value) : null))
    .refine((value) => value === null || (Number.isInteger(value) && value >= 0 && value <= 100), {
      message: 'Enter a whole percentage between 0 and 100',
    }),
  priceSuffix: optional(80),
  priceNote: optional(200),
  shortDescription: optional(600),
  description: optional(20000),
  ctaLabel: optional(60),
  ctaUrl: optional(300),
  ctaFormId: optional(40),
  seoTitle: optional(200),
  seoDescription: optional(400),
  canonicalUrl: optional(500),
  noIndex: formBoolean(false),
  ogImageId: optional(40),
  /** This market's own keywords; all blank uses the product's. */
  ...primaryKeywordShape,
}).superRefine(rejectDuplicateKeywords);

export type ProductCountryInput = z.infer<typeof productCountrySchema>;

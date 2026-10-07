/**
 * Shared vocabulary for the multi-market architecture.
 *
 * Nothing here knows that India and the UAE exist. A market is a row in the
 * `Country` table, and every helper in this folder works from that row alone —
 * which is what makes adding Qatar a content task rather than a code change.
 */

/** ISO 3166-1 alpha-2, upper case. Narrow enough to be useful, open enough to grow. */
export type CountryCode = string;

/**
 * One market, resolved for the current request.
 *
 * A plain, serialisable object: it crosses the server/client boundary into the
 * header's market switcher and the admin selector without a Prisma type or a
 * `Decimal` coming with it.
 */
export type CountryContext = {
  id: string;
  name: string;
  code: CountryCode;
  /** URL prefix. `""` for the root market, `"ae"` for the UAE. */
  slug: string;
  /** BCP-47 tag used for hreflang and `<html lang>`. */
  locale: string;
  currency: string;
  currencySymbol: string;
  phoneCode: string | null;
  timezone: string;
  isDefault: boolean;
  isActive: boolean;
  /**
   * Ready for search engines.
   *
   * An active but unpublished market still serves its pages to anyone with the
   * link; it is simply absent from the sitemaps and carries noindex. Separate
   * from isActive because "not ready to be found" and "not serving at all" are
   * different states.
   */
  isPublished: boolean;
  sortOrder: number;
  /**
   * Every market prefix currently configured, the root market's empty slug
   * excluded.
   *
   * It travels with the context so a single-argument `countryHref(country, url)`
   * can tell "/ae/contact written by an editor" from "/contact that needs a
   * prefix" without every call site having to fetch the market list first.
   */
  prefixes: readonly string[];
};

/**
 * Per-market company identity, contact details and SEO defaults, already
 * merged over the global settings.
 *
 * Readers never have to decide whether a value is local or global: an empty
 * country field falls back to the site-wide one during resolution, so the root
 * market keeps rendering exactly what it rendered before markets existed.
 */
export type CountrySettingsView = {
  countryId: string;
  /**
   * Market-wide noindex.
   *
   * Emitted as a robots meta tag on every page in the market, never as a
   * robots.txt rule: a blocked page is never fetched, so its noindex is never
   * read and it can still be listed from other signals.
   */
  noIndexCountry: boolean;
  companyName: string;
  legalName: string | null;
  salesPhone: string | null;
  supportPhone: string | null;
  whatsappNumber: string | null;
  salesEmail: string | null;
  supportEmail: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  address: string | null;
  businessHours: string | null;
  taxLabel: string | null;
  taxNumber: string | null;
  headerCtaLabel: string | null;
  headerCtaUrl: string | null;
  salesCtaText: string | null;
  defaultTitle: string;
  titleTemplate: string;
  defaultDescription: string;
  defaultOgImageUrl: string | null;
  organizationName: string;
  organizationType: string;
  organizationLogoUrl: string | null;
  localBusinessType: string | null;
  latitude: string | null;
  longitude: string | null;
};

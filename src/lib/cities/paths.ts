import { joinMarket, segmentsOf } from '@/lib/urls/path';

/**
 * Where city pages live.
 *
 * A city owns the first segment of addresses in its market: Delhi (slug
 * `delhi`) in the root market owns `/delhi` and everything beneath it, Dubai
 * in the market with prefix `ae` owns `/ae/dubai/...`. A page's slug never
 * carries the market prefix — the page at `/ae/dubai/revit` has the
 * slug `dubai/revit` — so these helpers work on market-relative slugs
 * and add the prefix only when they build a public path.
 *
 * Pure, so the admin screens, the generator and the registry agree.
 */

/** The city segment a page slug starts with, or null for the market homepage. */
export function citySegmentOf(pageSlug: string): string | null {
  return segmentsOf(pageSlug)[0]?.toLowerCase() ?? null;
}

/** Whether a page slug is the city's own address — its landing page. */
export function isCityLandingSlug(pageSlug: string, citySlug: string): boolean {
  const segments = segmentsOf(pageSlug);
  return segments.length === 1 && segments[0]!.toLowerCase() === citySlug.toLowerCase();
}

/** Whether a page slug is in the city's address space: its landing page or beneath it. */
export function isInCity(pageSlug: string, citySlug: string): boolean {
  return citySegmentOf(pageSlug) === citySlug.toLowerCase();
}

/**
 * The slug a page gets when it is copied into a city.
 *
 * ```
 * cityPageSlug('delhi', 'revit')           === 'delhi/revit'
 * cityPageSlug('delhi', 'solutions/revit') === 'delhi/solutions/revit'
 * cityPageSlug('delhi', '')                       === 'delhi'   // the market homepage → the landing page
 * ```
 */
export function cityPageSlug(citySlug: string, sourceSlug: string): string {
  return [citySlug, ...segmentsOf(sourceSlug)].join('/');
}

/**
 * The same page's slug in another city: `delhi/revit` in Mumbai is
 * `mumbai/revit`. Used when a city is renamed and its pages move with it.
 */
export function moveToCity(pageSlug: string, fromCitySlug: string, toCitySlug: string): string {
  const segments = segmentsOf(pageSlug);
  if (segments[0]?.toLowerCase() !== fromCitySlug.toLowerCase()) return pageSlug;
  return [toCitySlug, ...segments.slice(1)].join('/');
}

/** A city page's public path, market prefix included: `/ae/dubai/revit`. */
export function cityPublicPath(marketSlug: string, pageSlug: string): string {
  return joinMarket(marketSlug, pageSlug);
}

import { headers } from "next/headers";
import { prisma } from "@/lib/db/prisma";
import { getPublishedPage, getPublishedPageById } from "@/lib/services/pages";
import { getUrlSnapshot } from "@/lib/urls/load";
import { currentUrlSnapshot } from "@/lib/urls/snapshot";
import { pathKey } from "@/lib/urls/path";
import { isPageType } from "@/lib/urls/types";
import { getWebsiteSettings } from "@/lib/services/settings";
import {
  getNavigations,
  getPrimaryNavigation,
} from "@/lib/services/navigation";
import { MaintenanceNotice } from "@/components/public/maintenance-notice";
import { SiteHeader } from "@/components/public/site-header";
import { SiteFooter } from "@/components/public/site-footer";
import { PopupHost } from "@/components/public/popup-host";
import { JsonLd } from "@/components/seo/json-ld";
import { siteJsonLd } from "@/lib/seo/page-schema";
import { getCurrentUser } from "@/lib/auth/guards";
import { resolveCountryPath } from "@/lib/country/registry";
import { getCountrySettings } from "@/lib/country/settings";
import { getActiveCityAt } from "@/lib/services/cities";
import { withCityDetails } from "@/lib/cities/local";
import { resolveMarketOptions } from "@/lib/country/switch";
import { countryPath, contentSlug, countryHref } from "@/lib/country/routing";
import type { CountryContext } from "@/lib/country/types";
import type { ButtonVariant } from "@/components/ui/button";

export default async function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const headerList = await headers();
  const pathname = headerList.get("x-pathname") ?? "/";

  /*
   * The market owns the request from here down: navigation, contact details,
   * popups and structured data are all resolved for it. Resolution is one
   * request-cached lookup shared with the page below, so a market-aware layout
   * costs no extra query.
   */
  const { country, path } = await resolveCountryPath(pathname);

  // Every link this layout renders — menus, calls to action, the market
  // switcher — resolves through the URL registry; load its current snapshot
  // before any of them is built.
  const urls = await getUrlSnapshot();

  // A CMS page can opt out of the site header or footer. Other public routes
  // (blog, products) always show both.
  const chrome = await resolveChrome(country, path, urls.enabled);

  const [site, marketLocal, city, nav, markets, popups] = await Promise.all([
    getWebsiteSettings(),
    getCountrySettings(country),
    // Inside a city, its own contact details come first: city → market → site.
    getActiveCityAt(country.id, contentSlug(path)),
    getPrimaryNavigation(country),
    resolveMarketOptions(country, path),
    prisma.popup.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        // A popup with no market is shown everywhere; one bound to a market is
        // shown only in that storefront.
        OR: [{ countryId: null }, { countryId: country.id }],
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: new Date() } }] },
          { OR: [{ endsAt: null }, { endsAt: { gte: new Date() } }] },
        ],
      },
      include: {
        image: { select: { url: true, altText: true } },
        form: { select: { slug: true } },
        leadMagnet: { select: { slug: true, title: true } },
        pageTargets: { select: { page: { select: { slug: true, countryId: true } } } },
      },
    }),
  ]);

  const local = withCityDetails(marketLocal, city);

  // Maintenance mode hides the public site from visitors — a restore turns it
  // on for the duration so nobody browses a half-restored database. Signed-in
  // staff are exempt, so the person running the restore can still check it.
  if (site.maintenanceMode) {
    const staff = await getCurrentUser();
    if (!staff) {
      return <MaintenanceNotice siteName={site.siteName} logoUrl={site.logoUrl} />;
    }
  }

  /*
   * A popup pinned to specific pages is pinned to pages in one market. Dropping
   * it here rather than in the client matters: an empty target list means
   * "everywhere", so a popup whose only targets are India's pages would
   * otherwise start firing on every UAE page instead of none.
   */
  const visiblePopups = popups.filter(
    (popup) =>
      popup.pageTargets.length === 0 ||
      popup.pageTargets.some((target) => target.page.countryId === country.id),
  );

  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      {chrome.showHeader ? (
        <SiteHeader
          nav={nav}
          markets={markets}
          brand={{
            siteName: site.siteName,
            logoUrl: site.logoUrl,
            homeUrl: countryPath(country),
            ctaLabel: local.headerCtaLabel,
            ctaUrl: countryHref(country, local.headerCtaUrl),
            secondaryCtaLabel: site.headerSecondaryCtaLabel,
            secondaryCtaUrl: countryHref(country, site.headerSecondaryCtaUrl),
            menuAlign: (site.headerMenuAlign as 'left' | 'center' | 'right') ?? 'left',
            sticky: site.headerSticky,
            border: site.headerBorder,
            glassEdge: site.headerGlassEdge,
            showLogo: site.headerShowLogo,
            showSiteName: site.headerShowSiteName,
            showMenu: site.headerShowMenu,
            showMarkets: site.headerShowMarkets,
            ctaIcon: site.headerCtaIcon,
            ctaIconSide: site.headerCtaIconSide === 'right' ? 'right' : 'left',
            ctaVariant: (site.headerCtaVariant || 'primary') as ButtonVariant,
            secondaryCtaIcon: site.headerSecondaryCtaIcon,
            secondaryCtaIconSide: site.headerSecondaryCtaIconSide === 'right' ? 'right' : 'left',
            secondaryCtaVariant: (site.headerSecondaryCtaVariant || 'ghost') as ButtonVariant,
            announcement:
              site.announcementEnabled && site.announcementText
                ? {
                    text: site.announcementText,
                    url: countryHref(country, site.announcementUrl),
                  }
                : null,
          }}
        />
      ) : null}
      <main id="main" className="min-h-[60vh]">
        {children}
      </main>
      {chrome.showFooter ? <SiteFooter settings={site} local={local} country={country} /> : null}
      <PopupHost
        basePath={countryPath(country)}
        popups={visiblePopups.map((p) => ({
          id: p.id,
          type: p.type,
          heading: p.heading,
          body: p.body,
          imageUrl: p.image?.url ?? null,
          imageAlt: p.image?.altText ?? null,
          formSlug: p.form?.slug ?? null,
          leadMagnetSlug: p.leadMagnet?.slug ?? null,
          ctaLabel: p.ctaLabel,
          ctaUrl: countryHref(country, p.ctaUrl),
          trigger: p.trigger,
          delaySeconds: p.delaySeconds,
          scrollPercent: p.scrollPercent,
          device: p.device,
          frequencyDays: p.frequencyDays,
          urlPatterns: Array.isArray(p.urlPatterns)
            ? (p.urlPatterns as string[])
            : [],
          // Page targets only count when the page belongs to this market, so a
          // popup pinned to India's pricing page never fires on the UAE one.
          pageSlugs: p.pageTargets
            .filter((t) => t.page.countryId === country.id)
            .map((t) => t.page.slug),
        }))}
      />
      <JsonLd data={siteJsonLd(country, local, site)} />
    </>
  );
}

/** CMS pages may hide the header or footer; every other route keeps both. */
async function resolveChrome(
  country: CountryContext,
  path: string,
  registry: boolean,
): Promise<{ showHeader: boolean; showFooter: boolean }> {
  const slug = contentSlug(path);
  const both = { showHeader: true, showFooter: true };
  try {
    if (registry) {
      // The registry says what the address is; only a page has chrome flags.
      const key = pathKey(countryPath(country, slug));
      const route = key ? currentUrlSnapshot()?.byKey.get(key) : undefined;
      if (!route || !isPageType(route.type)) return both;
      const page = await getPublishedPageById(country.id, route.entityId);
      return page ? { showHeader: page.showHeader, showFooter: page.showFooter } : both;
    }
    if (slug === "blog" || slug.startsWith("blog/") || slug.startsWith("products/")) return both;
    const page = await getPublishedPage(country.id, slug);
    if (!page) return { showHeader: true, showFooter: true };
    return { showHeader: page.showHeader, showFooter: page.showFooter };
  } catch {
    return { showHeader: true, showFooter: true };
  }
}

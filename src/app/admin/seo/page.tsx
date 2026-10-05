import type { Metadata } from 'next';
import Link from 'next/link';
import { Shuffle } from 'lucide-react';
import { requirePermission, userCan } from '@/lib/auth/guards';
import { getSeoSettings } from '@/lib/services/settings';
import { prisma } from '@/lib/db/prisma';
import { listCountries } from '@/lib/country/registry';
import { compileRobots, type CountryRobots } from '@/lib/seo/robots';
import { RobotsPreview } from '@/components/admin/seo/robots-preview';
import { siteUrl } from '@/lib/env';
import { AdminPageHeader } from '@/components/admin/page-header';
import { SeoSettingsForm, type SeoSettingsValues } from '@/components/admin/seo/seo-settings-form';
import { buttonClasses } from '@/components/ui/button';

export const metadata: Metadata = { title: 'SEO' };
export const dynamic = 'force-dynamic';

export default async function SeoAdmin() {
  const user = await requirePermission('seo.manage');
  const seo = await getSeoSettings();

  /*
   * The preview is compiled from the same function the route handler uses, so
   * the block below is byte-for-byte what /robots.txt serves.
   */
  const [countries, countrySettings] = await Promise.all([
    listCountries(),
    prisma.countrySettings.findMany({
      select: {
        countryId: true,
        robotsDisallow: true,
        robotsAllow: true,
        noIndexCountry: true,
        excludeFromSitemap: true,
      },
    }),
  ]);
  const settingsByCountry = new Map(countrySettings.map((row) => [row.countryId, row]));
  const robotsRows: CountryRobots[] = countries.map((country) => {
    const row = settingsByCountry.get(country.id);
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
  });
  const robots = compileRobots({
    baseUrl: siteUrl().replace(/\/$/, ''),
    noIndexSite: seo.noIndexSite,
    sitemapEnabled: seo.sitemapEnabled,
    extra: seo.robotsTxtExtra,
    countries: robotsRows,
  });

  const initial: SeoSettingsValues = {
    defaultTitle: seo.defaultTitle,
    titleTemplate: seo.titleTemplate,
    defaultDescription: seo.defaultDescription,
    defaultOgImageUrl: seo.defaultOgImageUrl ?? '',
    twitterHandle: seo.twitterHandle ?? '',
    organizationName: seo.organizationName,
    organizationLogoUrl: seo.organizationLogoUrl ?? '',
    organizationType: seo.organizationType,
    googleSiteVerification: seo.googleSiteVerification ?? '',
    bingSiteVerification: seo.bingSiteVerification ?? '',
    robotsTxtExtra: seo.robotsTxtExtra ?? '',
    sitemapEnabled: seo.sitemapEnabled,
    noIndexSite: seo.noIndexSite,
  };

  return (
    <div className="max-w-3xl">
      <AdminPageHeader
        title="SEO"
        description="Global defaults. Individual pages, products and posts override these."
        crumbs={[{ label: 'SEO' }]}
        actions={
          <>
            <Link href="/sitemap.xml" target="_blank" className={buttonClasses('ghost', 'sm')}>
              View sitemap
            </Link>
            <Link href="/admin/redirects" className={buttonClasses('outline', 'sm')}>
              <Shuffle className="h-4 w-4" aria-hidden="true" />
              Redirects
            </Link>
          </>
        }
      />
      <SeoSettingsForm initial={initial} canEdit={userCan(user, 'seo.manage')} />

      <RobotsPreview
        body={robots.body}
        warnings={robots.warnings}
        countryRules={robotsRows
          .filter((row) => row.isActive)
          .map((row) => ({
            name: row.name,
            slug: row.slug,
            lines:
              countRules(row.disallow) + countRules(row.allow),
            noIndex: row.noIndexCountry,
          }))}
      />
    </div>
  );
}

/** How many rule lines a market contributes, for the summary table. */
function countRules(raw: string | null): number {
  return (raw ?? '').split('\n').filter((line) => line.trim()).length;
}

import type { Metadata } from 'next';
import { prisma } from '@/lib/db/prisma';
import { requirePermission } from '@/lib/auth/guards';
import { getWebsiteSettings } from '@/lib/services/settings';
import { AdminPageHeader } from '@/components/admin/page-header';
import { listActiveCountries } from '@/lib/country/registry';
import { getUrlSnapshot } from '@/lib/urls/load';
import { pageHref, productHref } from '@/lib/urls/links';
import {
  CampaignBuilder,
  type DestinationOption,
} from '@/components/admin/marketing/campaign-builder';

export const metadata: Metadata = { title: 'UTM campaigns' };
export const dynamic = 'force-dynamic';

export default async function CampaignsPage() {
  await requirePermission('marketing.manage');

  const [settings, pages, products, countries] = await Promise.all([
    getWebsiteSettings(),
    prisma.page.findMany({
      where: { deletedAt: null, status: 'PUBLISHED' },
      orderBy: { title: 'asc' },
      select: { id: true, title: true, slug: true, countryId: true },
    }),
    prisma.productCountry.findMany({
      where: { deletedAt: null, status: 'PUBLISHED', product: { deletedAt: null } },
      orderBy: { product: { name: 'asc' } },
      select: { countryId: true, product: { select: { id: true, name: true, slug: true } } },
    }),
    listActiveCountries(),
    // Destinations are built from the URL registry's addresses.
    getUrlSnapshot(),
  ]);
  const marketOf = (id: string) => countries.find((country) => country.id === id);
  const label = (name: string, countryId: string) => {
    const market = marketOf(countryId);
    return market && !market.isDefault ? `${name} (${market.name})` : name;
  };

  // The site URL the rest of the app already uses for canonicals and emails,
  // so a built link points at the real deployment rather than a guess.
  const origin = (settings.siteUrl || process.env.NEXTAUTH_URL || 'https://example.com').replace(
    /\/+$/,
    '',
  );

  const destinations: DestinationOption[] = [
    { group: 'Site', label: 'Home page', url: `${origin}/` },
    ...pages.flatMap((page) => {
      const market = marketOf(page.countryId);
      if (!market) return [];
      return [
        {
          group: 'Pages',
          label: label(page.title, page.countryId),
          url: `${origin}${pageHref(market, page)}`.replace(/\/+$/, '') || origin,
        },
      ];
    }),
    ...products.flatMap((row) => {
      const market = marketOf(row.countryId);
      if (!market) return [];
      return [
        {
          group: 'Products',
          label: label(row.product.name, row.countryId),
          url: `${origin}${productHref(market, row.product)}`,
        },
      ];
    }),
  ];

  return (
    <div className="max-w-4xl">
      <AdminPageHeader
        title="UTM campaigns"
        description="Build a tagged link so you can see exactly which campaign brought each lead."
      />
      <CampaignBuilder destinations={destinations} origin={origin} />
    </div>
  );
}

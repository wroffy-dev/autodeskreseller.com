import type { Metadata } from 'next';
import { prisma } from '@/lib/db/prisma';
import { requirePermission } from '@/lib/auth/guards';
import { getWebsiteSettings } from '@/lib/services/settings';
import { AdminPageHeader } from '@/components/admin/page-header';
import {
  CampaignBuilder,
  type DestinationOption,
} from '@/components/admin/marketing/campaign-builder';

export const metadata: Metadata = { title: 'UTM campaigns' };
export const dynamic = 'force-dynamic';

export default async function CampaignsPage() {
  await requirePermission('marketing.manage');

  const [settings, pages, products] = await Promise.all([
    getWebsiteSettings(),
    prisma.page.findMany({
      where: { deletedAt: null, status: 'PUBLISHED' },
      orderBy: { title: 'asc' },
      select: { title: true, slug: true },
    }),
    prisma.product.findMany({
      where: { deletedAt: null, status: 'PUBLISHED' },
      orderBy: { name: 'asc' },
      select: { name: true, slug: true },
    }),
  ]);

  // The site URL the rest of the app already uses for canonicals and emails,
  // so a built link points at the real deployment rather than a guess.
  const origin = (settings.siteUrl || process.env.NEXTAUTH_URL || 'https://example.com').replace(
    /\/+$/,
    '',
  );

  const destinations: DestinationOption[] = [
    { group: 'Site', label: 'Home page', url: `${origin}/` },
    ...pages.map((page) => ({
      group: 'Pages',
      label: page.title,
      url: `${origin}/${page.slug}`.replace(/\/+$/, '') || origin,
    })),
    ...products.map((product) => ({
      group: 'Products',
      label: product.name,
      url: `${origin}/products/${product.slug}`,
    })),
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

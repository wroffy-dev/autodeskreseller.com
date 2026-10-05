import type { Metadata } from 'next';
import { prisma } from '@/lib/db/prisma';
import { requirePermission, userCan } from '@/lib/auth/guards';
import { getTrackingSettings } from '@/lib/services/settings';
import { AdminPageHeader } from '@/components/admin/page-header';
import {
  TrackingForm,
  type TrackingValues,
  type ScriptRow,
} from '@/components/admin/marketing/tracking-form';

export const metadata: Metadata = { title: 'Marketing & tracking' };
export const dynamic = 'force-dynamic';

export default async function MarketingAdmin() {
  const user = await requirePermission('marketing.manage');

  const [tracking, scripts] = await Promise.all([
    getTrackingSettings(),
    prisma.trackingScript.findMany({ orderBy: { createdAt: 'desc' } }),
  ]);

  const initial: TrackingValues = {
    ga4Id: tracking.ga4Id ?? '',
    ga4Enabled: tracking.ga4Enabled,
    gtmId: tracking.gtmId ?? '',
    gtmEnabled: tracking.gtmEnabled,
    googleAdsId: tracking.googleAdsId ?? '',
    googleAdsEnabled: tracking.googleAdsEnabled,
    googleAdsConversionLabel: tracking.googleAdsConversionLabel ?? '',
    metaPixelId: tracking.metaPixelId ?? '',
    metaPixelEnabled: tracking.metaPixelEnabled,
    microsoftUetId: tracking.microsoftUetId ?? '',
    microsoftUetEnabled: tracking.microsoftUetEnabled,
    hotjarId: tracking.hotjarId ?? '',
    hotjarEnabled: tracking.hotjarEnabled,
    linkedinPartnerId: tracking.linkedinPartnerId ?? '',
    linkedinEnabled: tracking.linkedinEnabled,
    tiktokPixelId: tracking.tiktokPixelId ?? '',
    tiktokEnabled: tracking.tiktokEnabled,
    consentRequired: tracking.consentRequired,
    consentMessage: tracking.consentMessage ?? '',
  };

  const rows: ScriptRow[] = scripts.map((script) => ({
    id: script.id,
    name: script.name,
    placement: script.placement,
    environment: script.environment,
    isActive: script.isActive,
    requiresConsent: script.requiresConsent,
    code: script.code,
  }));

  return (
    <div className="max-w-5xl">
      <AdminPageHeader
        title="Marketing & tracking"
        description="Analytics, advertising tags and consent. UTM parameters are captured automatically on every visit."
        crumbs={[{ label: 'Marketing' }]}
      />
      <TrackingForm initial={initial} scripts={rows} canEdit={userCan(user, 'marketing.manage')} />
    </div>
  );
}

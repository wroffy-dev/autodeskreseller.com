import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth/guards';
import { getCrmSyncSummary } from '@/lib/crm/deskzo.service';
import { AdminPageHeader } from '@/components/admin/page-header';
import { CrmSyncPanel } from '@/components/admin/settings/crm-sync-panel';

export const metadata: Metadata = { title: 'CRM integration' };
export const dynamic = 'force-dynamic';

export default async function CrmIntegrationPage() {
  await requirePermission('settings.manage');
  const summary = await getCrmSyncSummary();

  return (
    <div className="max-w-4xl">
      <AdminPageHeader
        title="CRM integration"
        description="Every lead captured on this site is also sent to the Deskzo CRM, where it is scored and assigned. Leads are always saved here first."
      />
      <CrmSyncPanel
        data={{
          ...summary,
          recentFailures: summary.recentFailures.map((lead) => ({
            ...lead,
            createdAt: lead.createdAt.toISOString(),
          })),
        }}
      />
    </div>
  );
}

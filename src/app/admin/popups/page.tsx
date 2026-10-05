import type { Metadata } from 'next';
import { prisma } from '@/lib/db/prisma';
import { requirePermission, userCan } from '@/lib/auth/guards';
import { AdminPageHeader } from '@/components/admin/page-header';
import { PopupManager, type PopupRow } from '@/components/admin/marketing/popup-manager';
import { Card } from '@/components/ui/card';
import { getAdminCountryScope } from '@/lib/country/admin';

export const metadata: Metadata = { title: 'Popups' };
export const dynamic = 'force-dynamic';

export default async function PopupsAdmin() {
  const user = await requirePermission('marketing.manage');

  const [popups, forms, leadMagnets, scope] = await Promise.all([
    prisma.popup.findMany({ where: { deletedAt: null }, orderBy: { createdAt: 'desc' } }),
    prisma.form.findMany({
      where: { deletedAt: null, isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.leadMagnet.findMany({
      where: { deletedAt: null },
      orderBy: { title: 'asc' },
      select: { id: true, title: true },
    }),
    getAdminCountryScope(),
  ]);

  const rows: PopupRow[] = popups.map((popup) => ({
    id: popup.id,
    name: popup.name,
    type: popup.type,
    isActive: popup.isActive,
    trigger: popup.trigger,
    delaySeconds: popup.delaySeconds,
    scrollPercent: popup.scrollPercent,
    device: popup.device,
    frequencyDays: popup.frequencyDays,
    heading: popup.heading,
    body: popup.body,
    imageId: popup.imageId,
    formId: popup.formId,
    leadMagnetId: popup.leadMagnetId,
    ctaLabel: popup.ctaLabel,
    ctaUrl: popup.ctaUrl,
    startsAt: popup.startsAt?.toISOString() ?? null,
    endsAt: popup.endsAt?.toISOString() ?? null,
    urlPatterns: Array.isArray(popup.urlPatterns) ? (popup.urlPatterns as string[]) : [],
    countryId: popup.countryId,
  }));

  return (
    <div className="max-w-5xl">
      <AdminPageHeader
        title="Popups"
        description="Timed, scroll and exit-intent popups. Each one is capped per visitor by its frequency setting."
        crumbs={[{ label: 'Popups' }]}
      />
      <Card className="p-4 sm:p-5">
        <PopupManager
          rows={rows}
          forms={forms}
          countries={
            scope.canSwitch
              ? scope.countries.map((country) => ({ id: country.id, name: country.name }))
              : []
          }
          leadMagnets={leadMagnets}
          canEdit={userCan(user, 'marketing.manage')}
        />
      </Card>
    </div>
  );
}

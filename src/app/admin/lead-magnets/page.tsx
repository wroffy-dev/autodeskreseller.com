import type { Metadata } from 'next';
import { prisma } from '@/lib/db/prisma';
import { requirePermission, userCan } from '@/lib/auth/guards';
import { AdminPageHeader } from '@/components/admin/page-header';
import {
  LeadMagnetManager,
  type LeadMagnetRow,
} from '@/components/admin/marketing/lead-magnet-manager';
import { Card } from '@/components/ui/card';

export const metadata: Metadata = { title: 'Lead magnets' };
export const dynamic = 'force-dynamic';

export default async function LeadMagnetsAdmin() {
  const user = await requirePermission('marketing.manage');

  const [magnets, forms] = await Promise.all([
    prisma.leadMagnet.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { leads: true } } },
    }),
    prisma.form.findMany({
      where: { deletedAt: null, isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
  ]);

  const rows: LeadMagnetRow[] = magnets.map((magnet) => ({
    id: magnet.id,
    title: magnet.title,
    slug: magnet.slug,
    kind: magnet.kind,
    description: magnet.description,
    isActive: magnet.isActive,
    imageId: magnet.imageId,
    fileId: magnet.fileId,
    externalUrl: magnet.externalUrl,
    formId: magnet.formId,
    ctaLabel: magnet.ctaLabel,
    thankYouTitle: magnet.thankYouTitle,
    thankYouMessage: magnet.thankYouMessage,
    thankYouUrl: magnet.thankYouUrl,
    leadCount: magnet._count.leads,
  }));

  return (
    <div className="max-w-5xl">
      <AdminPageHeader
        title="Lead magnets"
        description="Downloads and offers exchanged for contact details. Place one with the Lead magnet block."
        crumbs={[{ label: 'Lead magnets' }]}
      />
      <Card className="p-4 sm:p-5">
        <LeadMagnetManager rows={rows} forms={forms} canEdit={userCan(user, 'marketing.manage')} />
      </Card>
    </div>
  );
}

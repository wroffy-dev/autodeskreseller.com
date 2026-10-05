import type { Metadata } from 'next';
import { prisma } from '@/lib/db/prisma';
import { requirePermission, userCan } from '@/lib/auth/guards';
import { AdminPageHeader } from '@/components/admin/page-header';
import { NewLeadForm } from '@/components/admin/leads/new-lead-form';

export const metadata: Metadata = { title: 'Add lead' };
export const dynamic = 'force-dynamic';

export default async function NewLead() {
  const user = await requirePermission('leads.create');

  const [staff, products] = await Promise.all([
    prisma.user.findMany({
      where: { deletedAt: null, status: 'ACTIVE' },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.product.findMany({
      where: { deletedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
  ]);

  return (
    <div className="max-w-3xl">
      <AdminPageHeader
        title="Add a lead"
        description="For enquiries that arrive by phone, email or at an event."
        crumbs={[{ label: 'Leads', href: '/admin/leads' }, { label: 'New' }]}
      />
      <NewLeadForm staff={staff} products={products} canAssign={userCan(user, 'leads.assign')} />
    </div>
  );
}

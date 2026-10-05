import type { Metadata } from 'next';
import { prisma } from '@/lib/db/prisma';
import { requirePermission } from '@/lib/auth/guards';
import { AdminPageHeader } from '@/components/admin/page-header';
import { CustomerForm, EMPTY_CUSTOMER } from '@/components/admin/customers/customer-form';

export const metadata: Metadata = { title: 'New customer' };
export const dynamic = 'force-dynamic';

export default async function NewCustomer() {
  await requirePermission('customers.create');

  const staff = await prisma.user.findMany({
    where: { deletedAt: null, status: 'ACTIVE' },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  });

  return (
    <div className="max-w-3xl">
      <AdminPageHeader
        title="New customer"
        description="For accounts that did not come through the website pipeline."
        crumbs={[{ label: 'Customers', href: '/admin/customers' }, { label: 'New' }]}
      />
      <CustomerForm initial={EMPTY_CUSTOMER} staff={staff} canEdit mode="create" />
    </div>
  );
}

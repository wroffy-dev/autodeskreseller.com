import type { Metadata } from 'next';
import { prisma } from '@/lib/db/prisma';
import { requirePermission } from '@/lib/auth/guards';
import { AdminPageHeader } from '@/components/admin/page-header';
import { StaffForm, EMPTY_STAFF } from '@/components/admin/staff/staff-form';

export const metadata: Metadata = { title: 'Add staff' };
export const dynamic = 'force-dynamic';

export default async function NewStaff() {
  const user = await requirePermission('staff.manage');

  // A staff member may only assign roles below their own privilege level.
  const actorRole = user.role
    ? await prisma.userRole.findUnique({ where: { slug: user.role }, select: { rank: true } })
    : null;

  const roles = await prisma.userRole.findMany({
    where:
      user.role === 'super-admin' || !actorRole ? {} : { rank: { gt: actorRole.rank } },
    orderBy: { rank: 'asc' },
    select: { id: true, name: true },
  });

  return (
    <div className="max-w-3xl">
      <AdminPageHeader
        title="Add a staff account"
        description="They can sign in immediately with the password you set."
        crumbs={[{ label: 'Staff', href: '/admin/staff' }, { label: 'New' }]}
      />
      <StaffForm initial={EMPTY_STAFF} roles={roles} mode="create" isSelf={false} />
    </div>
  );
}

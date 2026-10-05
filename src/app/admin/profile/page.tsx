import type { Metadata } from 'next';
import { Suspense } from 'react';
import { requireUser } from '@/lib/auth/guards';
import { AdminPageHeader } from '@/components/admin/page-header';
import { ProfileWorkspace } from '@/components/admin/profile/profile-workspace';
import { getMyProfile } from '@/lib/services/profile';
import { maxUploadLabel } from '@/lib/services/upload';
import { FormPageSkeleton } from '@/components/admin/loading-skeletons';

export const metadata: Metadata = { title: 'My profile' };
export const dynamic = 'force-dynamic';

/**
 * My Profile.
 *
 * Available to every authenticated user with no permission check: an account
 * owner managing their own details is not an administrative action. The
 * identity comes from `requireUser()` and is passed to the loader, so no part
 * of this screen can be pointed at another account.
 */
export default async function ProfilePage() {
  const user = await requireUser();
  const data = await getMyProfile(user);

  return (
    <div className="max-w-4xl">
      <AdminPageHeader
        title="My profile"
        description="Your details, password, two-step verification and signed-in devices."
        crumbs={[{ label: 'My profile' }]}
      />
      <Suspense fallback={<FormPageSkeleton />}>
        <ProfileWorkspace data={data} maxUploadLabel={maxUploadLabel()} />
      </Suspense>
    </div>
  );
}

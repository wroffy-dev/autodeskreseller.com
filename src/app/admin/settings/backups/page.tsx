import type { Metadata } from 'next';
import { requirePermission, userCan } from '@/lib/auth/guards';
import { AdminPageHeader } from '@/components/admin/page-header';
import { getBackupDashboard } from '@/lib/backup/dashboard.service';
import { BackupOverview } from '@/components/admin/backups/backup-overview';
import { BackupManager } from '@/components/admin/backups/backup-manager';
import { BackupScheduleForm } from '@/components/admin/backups/backup-schedule-form';
import { DEFAULT_SCHEDULE } from '@/lib/backup/schedule.service';

export const metadata: Metadata = { title: 'Backup & restore' };
export const dynamic = 'force-dynamic';

export default async function BackupsAdmin() {
  const user = await requirePermission('backup.view');
  const data = await getBackupDashboard();

  return (
    <div className="max-w-6xl space-y-4">
      <AdminPageHeader
        title="Backup & restore"
        description="Take a copy of the database and media library, keep it somewhere safe, and put it back when something goes wrong."
        crumbs={[{ label: 'Settings', href: '/admin/settings' }, { label: 'Backup & restore' }]}
      />

      <BackupOverview data={data} />

      <BackupManager
        data={data}
        can={{
          create: userCan(user, 'backup.create'),
          download: userCan(user, 'backup.download'),
          restore: userCan(user, 'backup.restore'),
          remove: userCan(user, 'backup.delete'),
        }}
      />

      <BackupScheduleForm
        schedule={data.schedule}
        timezone={DEFAULT_SCHEDULE.timezone}
        canEdit={userCan(user, 'backup.settings')}
      />
    </div>
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';
import { DatabaseBackup, Mail, Palette, Globe } from 'lucide-react';
import { requirePermission, userCan } from '@/lib/auth/guards';
import { getWebsiteSettings } from '@/lib/services/settings';
import { AdminPageHeader } from '@/components/admin/page-header';
import { WebsiteSettingsForm } from '@/components/admin/settings/settings-form';
import { ApplicationInfo } from '@/components/admin/settings/application-info';
import { buttonClasses } from '@/components/ui/button';

export const metadata: Metadata = { title: 'Website settings' };
export const dynamic = 'force-dynamic';

export default async function SettingsAdmin() {
  const user = await requirePermission('settings.manage');
  const settings = await getWebsiteSettings();

  // Send everything except the timestamps; the form owns the whole record.
  const { id, updatedAt, ...rest } = settings;
  void id;
  void updatedAt;

  const initial = Object.fromEntries(
    Object.entries(rest).map(([key, value]) => [key, value === null ? '' : value]),
  ) as Record<string, string | boolean>;

  return (
    <div className="max-w-3xl">
      <AdminPageHeader
        title="Website settings"
        description="Name, contact details, logos and the site header. The footer is on Website design."
        crumbs={[{ label: 'Settings' }]}
        actions={
          <>
            <Link href="/admin/settings/countries" className={buttonClasses('outline', 'md')}>
              <Globe className="h-4 w-4" aria-hidden="true" />
              Countries
            </Link>
            <Link href="/admin/settings/design" className={buttonClasses('outline', 'md')}>
              <Palette className="h-4 w-4" aria-hidden="true" />
              Website design
            </Link>
            <Link href="/admin/settings/email" className={buttonClasses('outline', 'md')}>
              <Mail className="h-4 w-4" aria-hidden="true" />
              Email settings
            </Link>
            {userCan(user, 'backup.view') ? (
              <Link href="/admin/settings/backups" className={buttonClasses('outline', 'md')}>
                <DatabaseBackup className="h-4 w-4" aria-hidden="true" />
                Backup &amp; restore
              </Link>
            ) : null}
          </>
        }
      />
      <WebsiteSettingsForm
        initial={initial}
        canEdit={userCan(user, 'settings.manage')}
        only={['general', 'branding', 'header']}
      />
      <ApplicationInfo siteName={settings.siteName} />
    </div>
  );
}

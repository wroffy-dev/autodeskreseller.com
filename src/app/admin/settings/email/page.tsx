import type { Metadata } from 'next';
import { prisma } from '@/lib/db/prisma';
import { requirePermission, userCan } from '@/lib/auth/guards';
import { getEmailSettingsSafe } from '@/lib/services/settings';
import { AdminPageHeader } from '@/components/admin/page-header';
import {
  EmailSettingsForm,
  type EmailSettingsValues,
  type TemplateRow,
} from '@/components/admin/settings/email-settings-form';

export const metadata: Metadata = { title: 'Email settings' };
export const dynamic = 'force-dynamic';

export default async function EmailSettingsPage() {
  const user = await requirePermission('settings.manage');

  // getEmailSettingsSafe omits the stored password entirely.
  const [settings, templates] = await Promise.all([
    getEmailSettingsSafe(),
    prisma.emailTemplate.findMany({ orderBy: { key: 'asc' } }),
  ]);

  const initial: EmailSettingsValues = {
    host: settings.host ?? '',
    port: String(settings.port),
    username: settings.username ?? '',
    encryption: settings.encryption,
    fromName: settings.fromName,
    fromEmail: settings.fromEmail ?? '',
    replyTo: settings.replyTo ?? '',
    notifyOnNewLead: settings.notifyOnNewLead,
    notifyOnAssignment: settings.notifyOnAssignment,
    notifyOnSubmission: settings.notifyOnSubmission,
    salesNotificationEmails: settings.salesNotificationEmails ?? '',
    isEnabled: settings.isEnabled,
    hasPassword: settings.hasPassword,
  };

  const rows: TemplateRow[] = templates.map((template) => ({
    key: template.key,
    name: template.name,
    subject: template.subject,
    body: template.body,
    isActive: template.isActive,
  }));

  return (
    <div className="max-w-3xl">
      <AdminPageHeader
        title="Email"
        description="SMTP delivery, notification recipients and the transactional templates."
        crumbs={[{ label: 'Settings', href: '/admin/settings' }, { label: 'Email' }]}
      />
      <EmailSettingsForm
        initial={initial}
        templates={rows}
        canEdit={userCan(user, 'settings.manage')}
      />
    </div>
  );
}

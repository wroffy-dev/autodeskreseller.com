import type { Metadata } from 'next';
import Link from 'next/link';
import { Eye } from 'lucide-react';
import { requirePermission, userCan } from '@/lib/auth/guards';
import { getWebsiteSettings } from '@/lib/services/settings';
import { AdminPageHeader } from '@/components/admin/page-header';
import { WebsiteSettingsForm } from '@/components/admin/settings/settings-form';
import { FooterForm } from '@/components/admin/settings/footer-form';
import { getFooter } from '@/lib/services/footer';
import { buttonClasses } from '@/components/ui/button';

export const metadata: Metadata = { title: 'Website design' };
export const dynamic = 'force-dynamic';

/**
 * Website design.
 *
 * The colours, typography and layout half of website settings, on its own
 * screen so an admin changing the brand palette is not scrolling past SMTP and
 * contact details. It renders the same form component and calls the same
 * `saveWebsiteSettings` action as /admin/settings — there is no second theme
 * store.
 *
 * The footer is here too, as its own form under the tabs. One screen for it,
 * and no second one: the footer this replaced was managed from three at once,
 * and the usual result was changing the one that did nothing.
 */
export default async function WebsiteDesignAdmin() {
  const user = await requirePermission('settings.manage');
  const [settings, footer] = await Promise.all([getWebsiteSettings(), getFooter()]);

  const { id, updatedAt, ...rest } = settings;
  void id;
  void updatedAt;

  const initial = Object.fromEntries(
    Object.entries(rest).map(([key, value]) => [key, value === null ? '' : value]),
  ) as Record<string, string | boolean>;

  return (
    <div className="max-w-4xl">
      <AdminPageHeader
        title="Website design"
        description="Colours, fonts, buttons, layout, the header and the footer. Every CMS section can override these individually."
        actions={
          <Link
            href="/"
            target="_blank"
            rel="noopener noreferrer"
            className={buttonClasses('outline', 'md')}
          >
            <Eye className="h-4 w-4" aria-hidden="true" />
            View website
          </Link>
        }
      />
      <WebsiteSettingsForm
        initial={initial}
        canEdit={userCan(user, 'settings.manage')}
        only={['theme', 'typography', 'design', 'header']}
      />

      <div className="mt-5">
        <FooterForm
          initialContent={footer.content}
          initialDesign={footer.design}
          canEdit={userCan(user, 'settings.manage')}
        />
      </div>
    </div>
  );
}

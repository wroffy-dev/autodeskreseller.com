import type { Metadata } from 'next';
import { requirePermission, userCan } from '@/lib/auth/guards';
import { AdminPageHeader } from '@/components/admin/page-header';
import { Alert } from '@/components/ui/states';
import { NoticeEditor, type NoticeVersion } from '@/components/admin/consent/notice-editor';
import { getCurrentNotice, listNoticeVersions } from '@/lib/services/consent';
import { CONSENT_NOTICE_KEY_DEFAULT } from '@/lib/privacy/consent';
import { listCountries } from '@/lib/country/registry';

export const metadata: Metadata = { title: 'Consent notice' };
export const dynamic = 'force-dynamic';

/**
 * Consent notice management.
 *
 * One screen for the wording every public form shows. It deliberately does not
 * claim the wording makes anything compliant — the note at the top says what
 * still needs a person to decide.
 */
export default async function ConsentAdmin() {
  const user = await requirePermission('leads.view');

  const [current, versions, countries] = await Promise.all([
    getCurrentNotice(CONSENT_NOTICE_KEY_DEFAULT, null),
    listNoticeVersions(CONSENT_NOTICE_KEY_DEFAULT),
    listCountries(),
  ]);

  const byId = new Map(countries.map((country) => [country.id, country.name]));
  const rows: NoticeVersion[] = versions.map((version) => ({
    id: version.id,
    version: version.version,
    isCurrent: version.isCurrent,
    countryName: version.countryId ? (byId.get(version.countryId) ?? null) : null,
    createdAt: version.createdAt.toISOString(),
  }));

  return (
    <div className="max-w-3xl">
      <AdminPageHeader
        title="Consent notice"
        description="The wording shown beside every public form, and the record kept of what each person agreed to."
        crumbs={[{ label: 'Leads & CRM' }, { label: 'Consent notice' }]}
      />

      <Alert tone="warning" className="mb-5" title="This needs a business decision, not just wording">
        Collecting a tick does not by itself make the site compliant with the DPDP Act or the GDPR.
        Someone has to decide which law applies to each market, what the lawful basis for each form
        is, how long submissions and IP addresses are kept, and whether the purpose below actually
        describes what you do with the details. See docs/CONSENT-AND-PRIVACY.md for the list.
      </Alert>

      {current.source === 'BUILT_IN' ? (
        <Alert tone="info" className="mb-5" title="No notice published yet">
          Forms are currently showing the built-in wording below, recorded against version 0.
          Publishing a version stores it and starts the numbering at 1, so submissions cite a
          version rather than “whatever the code said at the time”.
        </Alert>
      ) : null}

      <NoticeEditor
        noticeKey={CONSENT_NOTICE_KEY_DEFAULT}
        initial={current.content}
        versions={rows}
        countries={countries.map((country) => ({ id: country.id, name: country.name }))}
        canEdit={userCan(user, 'leads.manageConsent')}
      />
    </div>
  );
}

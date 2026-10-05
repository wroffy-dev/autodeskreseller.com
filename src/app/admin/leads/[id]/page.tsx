import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { prisma } from '@/lib/db/prisma';
import { requirePermission, userCan } from '@/lib/auth/guards';
import { AdminPageHeader } from '@/components/admin/page-header';
import { LeadDetail, type LeadDetailData } from '@/components/admin/leads/lead-detail';
import {
  ConsentPanel,
  type ConsentRecordView,
} from '@/components/admin/leads/consent-panel';
import { decimalToString } from '@/lib/utils/money';
import { CrmSyncCard } from '@/components/admin/leads/crm-sync-card';
import { deskzoEnabled } from '@/lib/crm/deskzo.service';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const lead = await prisma.lead.findUnique({ where: { id }, select: { name: true, reference: true } });
  return { title: lead ? `Lead #${lead.reference} — ${lead.name}` : 'Lead' };
}

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission('leads.view');
  const { id } = await params;

  const [lead, staff, products] = await Promise.all([
    prisma.lead.findFirst({
      where: { id, deletedAt: null },
      include: {
        product: { select: { id: true, name: true } },
        form: { select: { name: true } },
        country: { select: { name: true } },
        blogPost: { select: { title: true, slug: true } },
        notes: { orderBy: { createdAt: 'desc' }, include: { author: { select: { name: true } } } },
        activities: {
          orderBy: { createdAt: 'desc' },
          take: 50,
          include: { actor: { select: { name: true } } },
        },
        consents: {
          orderBy: { consentedAt: 'desc' },
          include: {
            events: {
              orderBy: { createdAt: 'asc' },
              include: { actor: { select: { name: true } } },
            },
          },
        },
        // The submission behind this lead, so every configured field is
        // shown — including the custom ones the Lead columns have no home
        // for — with the labels they carried at the time.
        submissions: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            data: true,
            fieldLabels: true,
            formName: true,
            pageUrl: true,
            createdAt: true,
          },
        },
      },
    }),
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
  if (!lead) notFound();

  const data: LeadDetailData = {
    id: lead.id,
    reference: lead.reference,
    name: lead.name,
    email: lead.email,
    phone: lead.phone,
    company: lead.company,
    jobTitle: lead.jobTitle,
    message: lead.message,
    status: lead.status,
    priority: lead.priority,
    source: lead.source,
    campaign: lead.campaign,
    ctaLabel: lead.ctaLabel,
    ctaLocation: lead.ctaLocation,
    value: decimalToString(lead.value),
    followUpAt: lead.followUpAt?.toISOString() ?? null,
    lostReason: lead.lostReason,
    createdAt: lead.createdAt.toISOString(),
    productId: lead.productId,
    productName: lead.product?.name ?? null,
    assignedToId: lead.assignedToId,
    customerId: lead.customerId,
    formName: lead.form?.name ?? null,
    blogPostTitle: lead.blogPost?.title ?? null,
    blogPostUrl: lead.blogPost ? `/blog/${lead.blogPost.slug}` : null,
    landingUrl: lead.landingUrl,
    referrer: lead.referrer,
    utm: {
      source: lead.utmSource,
      medium: lead.utmMedium,
      campaign: lead.utmCampaign,
      term: lead.utmTerm,
      content: lead.utmContent,
    },
    firstTouch: {
      source: lead.firstUtmSource,
      medium: lead.firstUtmMedium,
      campaign: lead.firstUtmCampaign,
      landingUrl: lead.firstLandingUrl,
      at: lead.firstTouchAt?.toISOString() ?? null,
    },
    notes: lead.notes.map((note) => ({
      id: note.id,
      body: note.body,
      authorName: note.author?.name ?? null,
      createdAt: note.createdAt.toISOString(),
    })),
    activities: lead.activities.map((activity) => ({
      id: activity.id,
      type: activity.type,
      summary: activity.summary,
      actorName: activity.actor?.name ?? null,
      createdAt: activity.createdAt.toISOString(),
    })),
  };

  const latest = lead.consents[0] ?? null;
  const snapshot = (latest?.noticeSnapshot ?? null) as Record<string, string> | null;

  /*
   * The address is only sent to the browser when the viewer may see it. A
   * client-side check would still have shipped the value in the page payload,
   * which is not a restriction at all.
   */
  const canSeeIp = userCan(user, 'leads.viewIp');

  const consentRecord: ConsentRecordView | null = latest
    ? {
        id: latest.id,
        lawfulBasis: latest.lawfulBasis,
        enquiryConsent: latest.enquiryConsent,
        marketingConsent: latest.marketingConsent,
        marketingPresented: latest.marketingPresented,
        termsAccepted: latest.termsAccepted,
        termsRequired: latest.termsRequired,
        purposeText: latest.purposeText,
        noticeKey: latest.noticeKey,
        noticeVersion: latest.noticeVersion,
        noticeScope: latest.noticeScope,
        displayedLabel: latest.displayedLabel,
        noticeText: snapshot
          ? {
              enquiryLabel: String(snapshot.enquiryLabel ?? ''),
              marketingLabel: String(snapshot.marketingLabel ?? ''),
              termsLabel: String(snapshot.termsLabel ?? ''),
            }
          : null,
        privacyUrl: latest.privacyUrl,
        privacyVersion: latest.privacyVersion,
        termsUrl: latest.termsUrl,
        termsVersion: latest.termsVersion,
        consentedAt: latest.consentedAt.toISOString(),
        withdrawnAt: latest.withdrawnAt?.toISOString() ?? null,
        withdrawnScope: latest.withdrawnScope,
        events: latest.events.map((event) => ({
          id: event.id,
          type: event.type,
          scope: event.scope,
          value: event.value,
          actorName: event.actor?.name ?? null,
          actorType: event.actorType,
          note: event.note,
          createdAt: event.createdAt.toISOString(),
        })),
      }
    : null;

  const crmConfigured = deskzoEnabled();
  const submission = lead.submissions[0] ?? null;
  const labels = (submission?.fieldLabels ?? {}) as Record<string, string>;
  const submittedFields = submission
    ? Object.entries((submission.data ?? {}) as Record<string, unknown>).map(([name, value]) => ({
        name,
        // The label as it read at submission, falling back to the key when a
        // field predates label snapshots.
        label: labels[name] ?? name,
        value: Array.isArray(value) ? value.join(', ') : String(value ?? ''),
      }))
    : [];

  return (
    <>
      <AdminPageHeader
        title={lead.name}
        description={[lead.company, lead.email].filter(Boolean).join(' · ')}
        crumbs={[{ label: 'Leads', href: '/admin/leads' }, { label: `#${lead.reference}` }]}
      />
      <LeadDetail
        lead={data}
        staff={staff}
        products={products}
        can={{
          edit: userCan(user, 'leads.edit'),
          assign: userCan(user, 'leads.assign'),
          delete: userCan(user, 'leads.delete'),
          createCustomer: userCan(user, 'customers.create'),
        }}
        submission={
          submission
            ? {
                formName: submission.formName ?? lead.form?.name ?? null,
                pageUrl: submission.pageUrl,
                countryName: lead.country.name,
                submittedAt: submission.createdAt.toISOString(),
                fields: submittedFields,
              }
            : null
        }
        consent={
          <ConsentPanel
            record={consentRecord}
            ip={{
              address: canSeeIp ? lead.ipAddress : null,
              status: lead.ipStatus,
              visible: canSeeIp,
            }}
            canManage={userCan(user, 'leads.manageConsent')}
          />
        }
        crm={
          // Nothing to say on a deployment without the integration about a
          // lead that never went near it.
          crmConfigured || lead.crmSyncStatus ? (
            <CrmSyncCard
              leadId={lead.id}
              configured={crmConfigured}
              canSend={userCan(user, 'leads.edit')}
              sync={{
                status: lead.crmSyncStatus,
                reference: lead.crmReference,
                syncedAt: lead.crmSyncedAt?.toISOString() ?? null,
                lastError: lead.crmLastError,
                attempts: lead.crmSyncAttempts,
                nextAttemptAt: lead.crmNextAttemptAt?.toISOString() ?? null,
              }}
            />
          ) : null
        }
      />
    </>
  );
}

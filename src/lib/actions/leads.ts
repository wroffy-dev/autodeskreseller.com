'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { authorize, userCan } from '@/lib/auth/guards';
import { recordAudit } from '@/lib/services/audit';
import { logLeadActivity, notifyLeadAssignment } from '@/lib/services/leads';
import { initialCrmSyncFields, syncNewLead } from '@/lib/crm/deskzo.service';
import {
  leadInputSchema,
  leadNoteSchema,
  leadStatusChangeSchema,
  leadAssignSchema,
  pipelineMoveSchema,
  leadBulkSchema,
} from '@/lib/validation/lead';
import { toCsv } from '@/lib/utils/csv';
import { buildLeadWhere, type LeadFilters } from '@/lib/crm/query';
import { toDecimal } from '@/lib/utils/money';
import { sanitizeText } from '@/lib/utils/sanitize';
import { LEAD_STATUS_LABELS } from '@/lib/crm/constants';
import { success, failure, toActionError, type ActionResult } from '@/lib/utils/result';
import { resolveActionCountry } from '@/lib/country/admin';
import { listAccessibleCountries } from '@/lib/country/access';
import {
  consentDisplayState,
  marketingDisplayState,
  CONSENT_DISPLAY_LABELS,
  MARKETING_DISPLAY_LABELS,
} from '@/lib/privacy/consent';
import { withdrawConsent } from '@/lib/services/consent';
import { requestContext } from '@/lib/utils/request';
import type { Prisma } from '@prisma/client';

function revalidateCrm(leadId?: string) {
  revalidatePath('/admin/leads');
  revalidatePath('/admin/pipeline');
  revalidatePath('/admin');
  if (leadId) revalidatePath(`/admin/leads/${leadId}`);
}

export async function createLead(formData: FormData): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await authorize('leads.create');
    const input = leadInputSchema.parse(Object.fromEntries(formData.entries()));

    // A manually added lead belongs to the market the admin is working in
    // unless the form names another they have access to.
    const country = await resolveActionCountry(user, formData.get('countryId')?.toString() || null);

    const lead = await prisma.lead.create({
      data: {
        countryId: country.id,
        name: sanitizeText(input.name),
        email: input.email.toLowerCase(),
        phone: input.phone,
        company: input.company ? sanitizeText(input.company) : null,
        jobTitle: input.jobTitle ? sanitizeText(input.jobTitle) : null,
        message: input.message ? sanitizeText(input.message) : null,
        status: input.status,
        priority: input.priority,
        source: input.source ?? 'Added manually',
        campaign: input.campaign,
        productId: input.productId,
        assignedToId: input.assignedToId,
        customerId: input.customerId,
        followUpAt: input.followUpAt,
        lostReason: input.lostReason,
        value: toDecimal(input.value),
        ...initialCrmSyncFields(),
      },
    });

    await logLeadActivity({
      leadId: lead.id,
      type: 'CREATED',
      summary: `Lead added manually by ${user.name}`,
      actorId: user.id,
    });
    await recordAudit({
      actor: user,
      action: 'created',
      entity: 'Lead',
      entityId: lead.id,
      summary: `Created lead “${lead.name}”`,
    });

    syncNewLead(lead.id);

    revalidateCrm();
    return success({ id: lead.id }, 'Lead created.');
  } catch (error) {
    return toActionError(error);
  }
}

export async function updateLead(leadId: string, formData: FormData): Promise<ActionResult> {
  try {
    const user = await authorize('leads.edit');
    const before = await prisma.lead.findUnique({ where: { id: leadId } });
    if (!before || before.deletedAt) return failure('That lead no longer exists.');

    const input = leadInputSchema.parse(Object.fromEntries(formData.entries()));

    // Assignment changes require the dedicated permission.
    if (input.assignedToId !== before.assignedToId) await authorize('leads.assign');

    const updated = await prisma.lead.update({
      where: { id: leadId },
      data: {
        name: sanitizeText(input.name),
        email: input.email.toLowerCase(),
        phone: input.phone,
        company: input.company ? sanitizeText(input.company) : null,
        jobTitle: input.jobTitle ? sanitizeText(input.jobTitle) : null,
        message: input.message ? sanitizeText(input.message) : null,
        status: input.status,
        priority: input.priority,
        source: input.source,
        campaign: input.campaign,
        productId: input.productId,
        assignedToId: input.assignedToId,
        customerId: input.customerId,
        followUpAt: input.followUpAt,
        lostReason: input.lostReason,
        value: toDecimal(input.value),
      },
    });

    if (before.status !== updated.status) {
      await logLeadActivity({
        leadId,
        type: 'STATUS_CHANGED',
        summary: `Status changed from ${LEAD_STATUS_LABELS[before.status]} to ${LEAD_STATUS_LABELS[updated.status]}`,
        actorId: user.id,
        meta: { from: before.status, to: updated.status },
      });
    }
    if (before.assignedToId !== updated.assignedToId && updated.assignedToId) {
      await logLeadActivity({
        leadId,
        type: 'ASSIGNED',
        summary: 'Lead reassigned',
        actorId: user.id,
      });
      void notifyLeadAssignment({ leadId, assigneeId: updated.assignedToId, actorName: user.name });
    }
    if (before.followUpAt?.getTime() !== updated.followUpAt?.getTime() && updated.followUpAt) {
      await logLeadActivity({
        leadId,
        type: 'FOLLOW_UP_SET',
        summary: `Follow-up set for ${updated.followUpAt.toDateString()}`,
        actorId: user.id,
      });
    }

    await recordAudit({
      actor: user,
      action: 'updated',
      entity: 'Lead',
      entityId: leadId,
      summary: `Updated lead “${updated.name}”`,
      before: { status: before.status, assignedToId: before.assignedToId },
      after: { status: updated.status, assignedToId: updated.assignedToId },
    });

    revalidateCrm(leadId);
    return success(undefined, 'Lead saved.');
  } catch (error) {
    return toActionError(error);
  }
}

export async function changeLeadStatus(input: unknown): Promise<ActionResult> {
  try {
    const user = await authorize('leads.edit');
    const { leadId, status, lostReason } = leadStatusChangeSchema.parse(input);

    const before = await prisma.lead.findUnique({ where: { id: leadId } });
    if (!before || before.deletedAt) return failure('That lead no longer exists.');
    if (before.status === status) return success(undefined, 'No change.');

    await prisma.lead.update({
      where: { id: leadId },
      data: { status, lostReason: status === 'LOST' ? lostReason : before.lostReason },
    });

    await logLeadActivity({
      leadId,
      type: 'STATUS_CHANGED',
      summary: `Status changed from ${LEAD_STATUS_LABELS[before.status]} to ${LEAD_STATUS_LABELS[status]}`,
      actorId: user.id,
      meta: { from: before.status, to: status, reason: lostReason ?? null },
    });
    await recordAudit({
      actor: user,
      action: 'status.changed',
      entity: 'Lead',
      entityId: leadId,
      summary: `${before.name}: ${LEAD_STATUS_LABELS[before.status]} → ${LEAD_STATUS_LABELS[status]}`,
      before: { status: before.status },
      after: { status },
    });

    revalidateCrm(leadId);
    return success(undefined, `Moved to ${LEAD_STATUS_LABELS[status]}.`);
  } catch (error) {
    return toActionError(error);
  }
}

export async function assignLead(input: unknown): Promise<ActionResult> {
  try {
    const user = await authorize('leads.assign');
    const { leadId, assignedToId } = leadAssignSchema.parse(input);

    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead || lead.deletedAt) return failure('That lead no longer exists.');

    if (assignedToId) {
      const assignee = await prisma.user.findFirst({
        where: { id: assignedToId, deletedAt: null, status: 'ACTIVE' },
        select: { id: true, name: true },
      });
      if (!assignee) return failure('That staff member is not available.');
    }

    await prisma.lead.update({ where: { id: leadId }, data: { assignedToId } });

    await logLeadActivity({
      leadId,
      type: 'ASSIGNED',
      summary: assignedToId ? 'Lead assigned' : 'Lead unassigned',
      actorId: user.id,
    });
    if (assignedToId) {
      void notifyLeadAssignment({ leadId, assigneeId: assignedToId, actorName: user.name });
    }

    revalidateCrm(leadId);
    return success(undefined, assignedToId ? 'Lead assigned.' : 'Lead unassigned.');
  } catch (error) {
    return toActionError(error);
  }
}

/** Kanban drag: sets the stage and persists the manual order of the column. */
export async function moveLeadInPipeline(input: unknown): Promise<ActionResult> {
  try {
    const user = await authorize('leads.edit');
    const { leadId, status, order } = pipelineMoveSchema.parse(input);

    const before = await prisma.lead.findUnique({ where: { id: leadId } });
    if (!before || before.deletedAt) return failure('That lead no longer exists.');

    const ids = order.length > 0 ? order : [leadId];
    const owned = await prisma.lead.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: { id: true },
    });
    const ownedIds = new Set(owned.map((l) => l.id));

    await prisma.$transaction([
      prisma.lead.update({ where: { id: leadId }, data: { status } }),
      ...ids
        .filter((id) => ownedIds.has(id))
        .map((id, index) =>
          prisma.lead.update({ where: { id }, data: { pipelineOrder: (index + 1) * 10 } }),
        ),
    ]);

    if (before.status !== status) {
      await logLeadActivity({
        leadId,
        type: 'STATUS_CHANGED',
        summary: `Moved from ${LEAD_STATUS_LABELS[before.status]} to ${LEAD_STATUS_LABELS[status]}`,
        actorId: user.id,
        meta: { from: before.status, to: status, via: 'pipeline' },
      });
      await recordAudit({
        actor: user,
        action: 'status.changed',
        entity: 'Lead',
        entityId: leadId,
        summary: `${before.name}: ${LEAD_STATUS_LABELS[before.status]} → ${LEAD_STATUS_LABELS[status]}`,
      });
    }

    revalidatePath('/admin/pipeline');
    return success(undefined, `Moved to ${LEAD_STATUS_LABELS[status]}.`);
  } catch (error) {
    return toActionError(error);
  }
}

export async function addLeadNote(input: unknown): Promise<ActionResult> {
  try {
    const user = await authorize('leads.edit');
    const { leadId, body } = leadNoteSchema.parse(input);

    const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true } });
    if (!lead) return failure('That lead no longer exists.');

    await prisma.leadNote.create({
      data: { leadId, authorId: user.id, body: sanitizeText(body) },
    });
    await logLeadActivity({
      leadId,
      type: 'NOTE_ADDED',
      summary: 'Note added',
      actorId: user.id,
    });

    revalidatePath(`/admin/leads/${leadId}`);
    return success(undefined, 'Note added.');
  } catch (error) {
    return toActionError(error);
  }
}

export async function deleteLead(leadId: string): Promise<ActionResult> {
  try {
    const user = await authorize('leads.delete');
    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) return failure('That lead no longer exists.');

    await prisma.lead.update({ where: { id: leadId }, data: { deletedAt: new Date() } });

    await recordAudit({
      actor: user,
      action: 'deleted',
      entity: 'Lead',
      entityId: leadId,
      summary: `Deleted lead “${lead.name}”`,
      before: { name: lead.name, email: lead.email, status: lead.status },
    });

    revalidateCrm();
    return success(undefined, 'Lead deleted.');
  } catch (error) {
    return toActionError(error);
  }
}

export async function bulkLeadAction(input: unknown): Promise<ActionResult> {
  try {
    const parsed = leadBulkSchema.parse(input);
    const user =
      parsed.action === 'delete'
        ? await authorize('leads.delete')
        : parsed.action === 'assign'
          ? await authorize('leads.assign')
          : await authorize('leads.edit');

    const leads = await prisma.lead.findMany({
      where: { id: { in: parsed.ids }, deletedAt: null },
      select: { id: true, status: true },
    });
    const ids = leads.map((l) => l.id);
    if (ids.length === 0) return failure('No matching leads.');

    if (parsed.action === 'delete') {
      await prisma.lead.updateMany({ where: { id: { in: ids } }, data: { deletedAt: new Date() } });
    } else if (parsed.action === 'assign') {
      if (parsed.assignedToId) {
        const assignee = await prisma.user.findFirst({
          where: { id: parsed.assignedToId, deletedAt: null, status: 'ACTIVE' },
          select: { id: true },
        });
        if (!assignee) return failure('That staff member is not available.');
      }
      await prisma.lead.updateMany({
        where: { id: { in: ids } },
        data: { assignedToId: parsed.assignedToId ?? null },
      });
      await prisma.leadActivity.createMany({
        data: ids.map((id) => ({
          leadId: id,
          type: 'ASSIGNED' as const,
          summary: parsed.assignedToId ? 'Lead assigned (bulk)' : 'Lead unassigned (bulk)',
          actorId: user.id,
        })),
      });
    } else {
      if (!parsed.status) return failure('Choose a status first.');
      await prisma.lead.updateMany({ where: { id: { in: ids } }, data: { status: parsed.status } });
      await prisma.leadActivity.createMany({
        data: leads
          .filter((lead) => lead.status !== parsed.status)
          .map((lead) => ({
            leadId: lead.id,
            type: 'STATUS_CHANGED' as const,
            summary: `Status changed to ${LEAD_STATUS_LABELS[parsed.status!]} (bulk)`,
            actorId: user.id,
          })),
      });
    }

    await recordAudit({
      actor: user,
      action: `bulk.${parsed.action}`,
      entity: 'Lead',
      summary: `${parsed.action} applied to ${ids.length} lead(s)`,
    });

    revalidateCrm();
    return success(undefined, `${ids.length} lead(s) updated.`);
  } catch (error) {
    return toActionError(error);
  }
}

export async function exportLeads(filters: LeadFilters): Promise<ActionResult<{ csv: string; filename: string }>> {
  try {
    const user = await authorize('leads.export');

    /*
     * The export mirrors whatever the screen was showing, market included, and
     * is then narrowed to the markets this user may see — so an export can
     * never hand someone rows from a storefront they cannot open.
     */
    const allowed = await listAccessibleCountries(user);
    const allowedIds = allowed.map((country) => country.id);
    const requested = filters.countryId && allowedIds.includes(filters.countryId)
      ? filters.countryId
      : null;

    const where: Prisma.LeadWhereInput = {
      ...buildLeadWhere({ ...filters, countryId: requested ?? undefined }),
      ...(requested ? {} : { countryId: { in: allowedIds } }),
    };

    const leads = await prisma.lead.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 10_000,
      include: {
        product: { select: { name: true } },
        assignedTo: { select: { name: true } },
        form: { select: { name: true } },
        country: { select: { code: true } },
        consents: {
          orderBy: { consentedAt: 'desc' },
          take: 1,
          select: {
            lawfulBasis: true,
            enquiryConsent: true,
            marketingConsent: true,
            marketingPresented: true,
            termsAccepted: true,
            termsRequired: true,
            noticeKey: true,
            noticeVersion: true,
            noticeScope: true,
            displayedLabel: true,
            privacyUrl: true,
            privacyVersion: true,
            termsUrl: true,
            termsVersion: true,
            consentedAt: true,
            withdrawnAt: true,
            withdrawnScope: true,
          },
        },
      },
    });

    /*
     * The IP is a separate permission from exporting.
     *
     * Someone who may pull a lead list does not automatically need every
     * visitor's address in a spreadsheet that will be mailed around, so the
     * column is only present for a user who holds leads.viewIp — absent
     * entirely rather than blanked, so nobody reads an empty cell as "no
     * address was recorded".
     */
    const withIp = userCan(user, 'leads.viewIp');

    const header = [
      'reference', 'created_at', 'country', 'name', 'email', 'phone', 'company', 'job_title',
      'status', 'priority', 'value', 'source', 'campaign', 'product', 'form',
      'assigned_to', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term',
      'utm_content', 'first_utm_source', 'first_utm_campaign', 'landing_url',
      'referrer', 'cta_label', 'follow_up_at', 'message',
      'consent_state', 'consent_enquiry', 'consent_marketing', 'marketing_state',
      'terms_accepted', 'lawful_basis', 'consent_notice', 'consent_notice_scope',
      'consent_label_shown', 'consent_at', 'consent_withdrawn_at',
      'privacy_url', 'privacy_version', 'terms_url', 'terms_version',
      ...(withIp ? ['ip_address', 'ip_status'] : []),
    ];

    const rows = leads.map((lead) => [
      String(lead.reference),
      lead.createdAt.toISOString(),
      lead.country.code,
      lead.name,
      lead.email,
      lead.phone ?? '',
      lead.company ?? '',
      lead.jobTitle ?? '',
      lead.status,
      lead.priority,
      lead.value?.toString() ?? '',
      lead.source ?? '',
      lead.campaign ?? '',
      lead.product?.name ?? '',
      lead.form?.name ?? '',
      lead.assignedTo?.name ?? '',
      lead.utmSource ?? '',
      lead.utmMedium ?? '',
      lead.utmCampaign ?? '',
      lead.utmTerm ?? '',
      lead.utmContent ?? '',
      lead.firstUtmSource ?? '',
      lead.firstUtmCampaign ?? '',
      lead.landingUrl ?? '',
      lead.referrer ?? '',
      lead.ctaLabel ?? '',
      lead.followUpAt?.toISOString() ?? '',
      (lead.message ?? '').replace(/\s+/g, ' '),
      CONSENT_DISPLAY_LABELS[consentDisplayState(lead.consents[0])],
      // "yes"/"no"/"" rather than TRUE/FALSE: an empty cell means there is no
      // record to answer from, which is not the same as a recorded "no".
      boolCell(lead.consents[0]?.enquiryConsent),
      boolCell(lead.consents[0]?.marketingConsent),
      // The marketing column above answers "did they agree"; this one answers
      // "were they asked", which an empty or false cell alone cannot.
      lead.consents[0] ? MARKETING_DISPLAY_LABELS[marketingDisplayState(lead.consents[0])] : '',
      lead.consents[0]?.termsRequired ? boolCell(lead.consents[0]?.termsAccepted) : '',
      lead.consents[0]?.lawfulBasis ?? '',
      lead.consents[0] ? `${lead.consents[0].noticeKey} v${lead.consents[0].noticeVersion}` : '',
      lead.consents[0]?.noticeScope ?? (lead.consents[0] ? 'every market' : ''),
      (lead.consents[0]?.displayedLabel ?? '').replace(/\s+/g, ' '),
      lead.consents[0]?.consentedAt.toISOString() ?? '',
      lead.consents[0]?.withdrawnAt?.toISOString() ?? '',
      lead.consents[0]?.privacyUrl ?? '',
      lead.consents[0]?.privacyVersion ?? '',
      lead.consents[0]?.termsUrl ?? '',
      lead.consents[0]?.termsVersion ?? '',
      ...(withIp ? [lead.ipAddress ?? '', lead.ipStatus] : []),
    ]);

    await recordAudit({
      actor: user,
      action: 'exported',
      entity: 'Lead',
      summary: `Exported ${leads.length} lead(s)${withIp ? ' including IP addresses' : ''}`,
    });

    return success({
      csv: toCsv([header, ...rows]),
      filename: `leads-${new Date().toISOString().slice(0, 10)}.csv`,
    });
  } catch (error) {
    return toActionError(error);
  }
}

/** Promotes a won lead into a customer record, preserving the lead history. */
export async function convertLeadToCustomer(leadId: string): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await authorize('customers.create');
    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead || lead.deletedAt) return failure('That lead no longer exists.');
    if (lead.customerId) return failure('This lead is already linked to a customer.');

    const existing = await prisma.customer.findFirst({
      where: { email: lead.email.toLowerCase(), deletedAt: null },
    });

    const customer =
      existing ??
      (await prisma.customer.create({
        data: {
          name: lead.name,
          company: lead.company,
          email: lead.email.toLowerCase(),
          phone: lead.phone,
          status: 'ACTIVE',
          assignedToId: lead.assignedToId,
        },
      }));

    await prisma.lead.update({ where: { id: leadId }, data: { customerId: customer.id } });

    if (lead.productId) {
      await prisma.customerProduct.upsert({
        where: { customerId_productId: { customerId: customer.id, productId: lead.productId } },
        update: {},
        create: { customerId: customer.id, productId: lead.productId, quantity: 1 },
      });
    }

    await logLeadActivity({
      leadId,
      type: 'CONVERTED',
      summary: existing ? 'Linked to an existing customer' : 'Converted to a customer',
      actorId: user.id,
    });
    await recordAudit({
      actor: user,
      action: 'converted',
      entity: 'Lead',
      entityId: leadId,
      summary: `Converted “${lead.name}” to customer`,
    });

    revalidateCrm(leadId);
    revalidatePath('/admin/customers');
    return success({ id: customer.id }, existing ? 'Linked to an existing customer.' : 'Customer created.');
  } catch (error) {
    return toActionError(error);
  }
}

/** "yes" / "no", or blank when there is no record to answer from. */
function boolCell(value: boolean | undefined): string {
  if (value === undefined) return '';
  return value ? 'yes' : 'no';
}

const withdrawSchema = z.object({
  recordId: z.string().min(1),
  scope: z.enum(['MARKETING', 'ALL']),
  note: z.string().trim().max(500).optional(),
});

/**
 * Records that someone withdrew consent.
 *
 * Its own permission, not leads.edit: a withdrawal is a statement about what
 * the business may now do with a person's data, and it suppresses marketing
 * for that lead — which is a different kind of decision from editing a phone
 * number.
 */
export async function recordConsentWithdrawal(input: unknown): Promise<ActionResult> {
  try {
    const user = await authorize('leads.manageConsent');
    const { recordId, scope, note } = withdrawSchema.parse(input);

    const { ip } = await requestContext();
    const result = await withdrawConsent({
      recordId,
      scope,
      actorId: user.id,
      note: note ? sanitizeText(note) : null,
      ipAddress: ip,
    });
    if (!result.ok) return failure(result.error);

    await recordAudit({
      actor: user,
      action: 'updated',
      entity: 'ConsentRecord',
      entityId: recordId,
      summary: `Recorded consent withdrawal (${scope.toLowerCase()})`,
    });

    revalidatePath('/admin/leads');
    return success(undefined, 'Withdrawal recorded.');
  } catch (error) {
    return toActionError(error);
  }
}

'use server';

import { prisma } from '@/lib/db/prisma';
import { getPublicForm } from '@/lib/services/forms';
import { resolveConsentRequirement } from '@/lib/services/consent';
import { validateConsent, buildConsentEvidence } from '@/lib/privacy/consent';
import {
  submissionEnvelopeSchema,
  buildFieldSchema,
  extractLeadCore,
  activeFields,
} from '@/lib/validation/form-submission';
import { notifyNewLead, logLeadActivity } from '@/lib/services/leads';
import { initialCrmSyncFields, syncNewLead } from '@/lib/crm/deskzo.service';
import { getEmailSettings, getWebsiteSettings } from '@/lib/services/settings';
import { sendTemplate } from '@/lib/email/mailer';
import { rateLimit } from '@/lib/utils/rate-limit';
import { verifyCaptcha, CAPTCHA_MESSAGES } from '@/lib/forms/captcha';
import { requestContext } from '@/lib/utils/request';
import { hashIp } from '@/lib/utils/crypto';
import { sanitizeText } from '@/lib/utils/sanitize';
import { productContext, isSystemFieldKey } from '@/lib/forms/system-context';
import { getRequestCountry } from '@/lib/country/request';
import { success, failure, type ActionResult } from '@/lib/utils/result';
import type { Prisma } from '@prisma/client';

export type SubmitFormResult = ActionResult<{ message: string; redirectUrl: string | null }>;

/** The lead shape the notification helpers expect, kept in one place. */
type CreatedLead = Prisma.LeadGetPayload<{
  include: { product: { select: { name: true } }; form: { select: { name: true } } };
}>;

/**
 * Public form submission — the single entry point for every lead on the site.
 *
 * Validation is rebuilt from the stored field definitions, so a tampered client
 * payload cannot bypass required fields or option lists.
 */
export async function submitForm(payload: unknown): Promise<SubmitFormResult> {
  const parsed = submissionEnvelopeSchema.safeParse(payload);
  if (!parsed.success) {
    /*
     * Paths and codes only, never values: this payload is a lead — name, email,
     * phone — and copying it into the container log would put personal data
     * somewhere with none of the retention or access control the lead itself
     * gets. The path is what identifies the fault anyway.
     *
     * Logged at all because the visitor's message cannot say what was wrong
     * without describing the shape of the request to whoever crafted it, which
     * leaves this the only place the fault is visible.
     */
    console.error(
      '[form] envelope rejected',
      parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.code}`),
    );
    return failure('That submission could not be read. Please try again.');
  }
  const envelope = parsed.data;

  // Spam gates: honeypot + minimum fill time.
  if (envelope.website) return success({ message: 'Thank you.', redirectUrl: null });
  if (
    typeof envelope.elapsedMs === 'number' &&
    envelope.elapsedMs > 0 &&
    envelope.elapsedMs < 1200
  ) {
    return failure('That was submitted too quickly. Please try again.');
  }

  const { ip, ipStatus, userAgent } = await requestContext();
  /*
   * Spam bucketing, not evidence.
   *
   * With no trusted proxy configured there is no address we would record, but
   * putting every visitor in one bucket would let five submissions lock the
   * form for everyone. The user agent and the raw forwarded chain are not
   * trustworthy — that is exactly why they are not stored as the IP — but they
   * still separate one visitor from another well enough to rate limit, and a
   * bot that varies them is varying its fingerprint either way.
   */
  const ipKey = hashIp(ip) ?? hashIp(`${ipStatus}:${userAgent ?? ''}`) ?? 'anonymous';
  const limit = rateLimit(`form:${envelope.formSlug}:${ipKey}`, 5, 600);
  if (!limit.ok) {
    return failure(`Too many submissions. Please try again in ${limit.retryAfterSeconds} seconds.`);
  }

  /*
   * The market comes from the request the visitor actually made, never from the
   * payload. That is what makes country attribution trustworthy: a crafted
   * submission cannot claim to be a UAE lead, and a form restricted to one
   * market cannot be submitted from another.
   */
  const country = await getRequestCountry();

  const form = await getPublicForm(envelope.formSlug, country.id);
  if (!form) return failure('This form is no longer available.');

  // Math CAPTCHA, when the admin switched it on for this form. Verified here
  // and nowhere else: the browser only ever held a question and a signed
  // token, so this is the first and only place the answer is judged. Forms
  // without the flag skip it entirely and submit exactly as they always did.
  if (form.requireCaptcha) {
    const verdict = verifyCaptcha(envelope.captchaToken, envelope.captchaAnswer);
    if (!verdict.ok) {
      return failure(CAPTCHA_MESSAGES[verdict.reason], {
        _captcha: [CAPTCHA_MESSAGES[verdict.reason]],
      });
    }
  }

  /*
   * Consent is judged from the stored form and the live notice, never from the
   * payload's own account of what was required. A request that simply omits
   * the consent object therefore fails the requirement instead of skipping it,
   * which is what stops the tick box being bypassed by calling the action
   * directly.
   */
  const formConsentSettings = await prisma.form.findUnique({
    where: { id: form.id },
    select: {
      consentNoticeKey: true,
      lawfulBasis: true,
      offerMarketingConsent: true,
      requireTermsAcceptance: true,
      collectsPersonalData: true,
      consentCombinedLabel: true,
    },
  });
  if (!formConsentSettings) return failure('This form is no longer available.');

  const requirement = await resolveConsentRequirement(formConsentSettings, country.id);
  const consentVerdict = validateConsent(requirement, envelope.consent);

  /*
   * One control, so one error key. `_consent` is the tick box itself and
   * `_consentNotice` is the notice having moved on underneath it — two
   * different things to tell someone, and the renderer shows either against
   * the box.
   */
  const consentErrors: Record<string, string[]> = consentVerdict.ok
    ? {}
    : { [consentVerdict.field === 'notice' ? '_consentNotice' : '_consent']: [consentVerdict.message] };

  // Only the fields the visitor could actually have answered are judged: a
  // question hidden by conditional logic must not be required of them, and a
  // read-only field's value is never taken from the payload. Both decisions are
  // made here from the stored definitions, so the client cannot influence them.
  const judged = activeFields(form.fields, envelope.values);
  const fieldSchema = buildFieldSchema(judged, form.design);
  const valuesResult = fieldSchema.safeParse(envelope.values);
  if (!valuesResult.success) {
    const fieldErrors: Record<string, string[]> = { ...consentErrors };
    for (const issue of valuesResult.error.issues) {
      const key = issue.path.join('.') || '_form';
      (fieldErrors[key] ??= []).push(issue.message);
    }
    // Both sets at once: a visitor who missed a field and the tick box should
    // see both, not discover the second only after fixing the first.
    return failure('Please correct the highlighted fields.', fieldErrors);
  }

  if (!consentVerdict.ok) {
    return failure(consentVerdict.message, consentErrors);
  }

  const values = valuesResult.data as Record<string, string>;

  // Read-only and conditionally hidden fields fall back to the default the
  // admin configured, never to whatever the browser sent. This is what stops a
  // crafted payload rewriting a trusted value — a product id or plan injected
  // as a system field, say — while still recording the value the form intended.
  const judgedNames = new Set(judged.map((field) => field.name));
  for (const field of form.fields) {
    if (judgedNames.has(field.name) || field.type === 'HIDDEN') continue;
    // A field the visitor could not answer keeps the admin's default, or
    // nothing when it was conditionally hidden — never the submitted value.
    const serverSourced = field.isReadOnly || field.isHidden || field.settings.system;
    values[field.name] = serverSourced ? (field.defaultValue ?? '') : '';
  }

  const formRecord = await prisma.form.findUnique({
    where: { id: form.id },
    select: {
      createsLead: true,
      leadSource: true,
      defaultProductId: true,
      notifyEmails: true,
      name: true,
    },
  });

  const attribution = envelope.attribution ?? {};
  const productId = envelope.productId || formRecord?.defaultProductId || null;

  // System fields are filled from the product row, resolved here from the
  // trusted product id. An admin can put a `product_name` or `plan` field on
  // any form without that becoming a way for a crafted payload to claim the
  // enquiry was about something else.
  const systemFields = form.fields.filter((field) => field.settings.system);
  if (systemFields.length > 0 && productId) {
    const product = await prisma.product.findFirst({
      where: { id: productId, deletedAt: null },
      select: {
        id: true,
        name: true,
        slug: true,
        sku: true,
        billingPeriod: true,
        priceSuffix: true,
        monthlyPrice: true,
        annualPrice: true,
      },
    });

    if (product) {
      const context = productContext(product);
      for (const field of systemFields) {
        if (!isSystemFieldKey(field.name)) continue;
        const resolved = context[field.name];
        // A key with nothing behind it keeps the admin's default rather than
        // blanking the field.
        if (resolved) values[field.name] = resolved;
      }
    }
  }

  // Computed after the system fill so a mapped field that is also injected
  // (a company name carried from context, say) reaches the lead.
  const core = extractLeadCore(values, form.fields);

  const landingPath = attribution.pagePath ?? attribution.landingUrl ?? null;
  // The landing page is resolved inside the submitting market, so a UAE lead is
  // never attributed to India's page of the same name.
  const landingSlug = landingPath
    ? stripCountryPrefix(landingPath, country.slug).replace(/^\/+|\/+$/g, '')
    : null;
  const landingPage = landingSlug !== null
    ? await prisma.page.findFirst({
        where: { slug: landingSlug, countryId: country.id, deletedAt: null },
        select: { id: true },
      })
    : null;

  /**
   * The article a blog lead came from.
   *
   * Resolved from the path the same way the landing page is, so a form in the
   * sidebar, mid-article or in a blog CTA all record which article converted
   * the visitor — without the form itself having to know where it was placed.
   */
  const blogSlug = /^\/blog\/([^/?#]+)/.exec(
    landingSlug === null ? '' : `/${landingSlug}`,
  )?.[1];
  const blogPost =
    blogSlug && !['category', 'tag'].includes(blogSlug)
      ? await prisma.blogPost.findFirst({
          where: { slug: blogSlug, countryId: country.id, deletedAt: null },
          select: { id: true, title: true },
        })
      : null;

  /*
   * The lead, its submission and its consent evidence go in together.
   *
   * Written one at a time, a failure after the lead insert would leave a lead
   * whose consent record does not exist — and a lead with no evidence is
   * indistinguishable from one captured before consent was collected. A
   * transaction is what stops "accepted" and "we can prove they agreed" from
   * ever disagreeing.
   */
  const evidence = buildConsentEvidence(requirement, envelope.consent);
  // The labels as they read today, so renaming a field later cannot change
  // what this submission says it asked for.
  const fieldLabels = Object.fromEntries(form.fields.map((field) => [field.name, field.label]));

  let leadId: string | null = null;

  const persisted = await prisma.$transaction(async (tx) => {
    let createdLead: CreatedLead | null = null;

    if (formRecord?.createsLead !== false && core.email) {
      const firstTouchAt = attribution.firstTouchAt ? new Date(attribution.firstTouchAt) : null;

      createdLead = await tx.lead.create({
      data: {
        countryId: country.id,
        name: sanitizeText(core.name) || core.email.split('@')[0] || 'Unknown',
        email: core.email.toLowerCase(),
        phone: sanitizeText(core.phone) || null,
        company: sanitizeText(core.company) || null,
        jobTitle: sanitizeText(core.jobTitle) || null,
        message: sanitizeText(core.message) || null,
        // A form's configured lead source always wins; "Blog" is only the
        // fallback for a form that has not set one and was submitted from an
        // article, which is what makes blog leads findable in the CRM.
        source: formRecord?.leadSource || (blogPost ? 'Blog' : form.name),
        campaign: attribution.utmCampaign ?? null,
        ctaLabel: attribution.ctaLabel ?? null,
        ctaLocation: attribution.ctaLocation ?? null,
        utmSource: attribution.utmSource ?? null,
        utmMedium: attribution.utmMedium ?? null,
        utmCampaign: attribution.utmCampaign ?? null,
        utmTerm: attribution.utmTerm ?? null,
        utmContent: attribution.utmContent ?? null,
        firstUtmSource: attribution.firstUtmSource ?? attribution.utmSource ?? null,
        firstUtmMedium: attribution.firstUtmMedium ?? attribution.utmMedium ?? null,
        firstUtmCampaign: attribution.firstUtmCampaign ?? attribution.utmCampaign ?? null,
        firstUtmTerm: attribution.firstUtmTerm ?? attribution.utmTerm ?? null,
        firstUtmContent: attribution.firstUtmContent ?? attribution.utmContent ?? null,
        firstLandingUrl: attribution.firstLandingUrl ?? attribution.landingUrl ?? null,
        firstTouchAt:
          firstTouchAt && !Number.isNaN(firstTouchAt.getTime()) ? firstTouchAt : new Date(),
        referrer: attribution.referrer ?? null,
        landingUrl: attribution.landingUrl ?? attribution.pagePath ?? null,
        userAgent,
        ipHash: hashIp(ip),
        ipAddress: ip,
        ipStatus,
        productId,
        landingPageId: landingPage?.id ?? null,
        blogPostId: blogPost?.id ?? null,
        formId: form.id,
        leadMagnetId: envelope.leadMagnetId || null,
        // Queued for the CRM in the same insert, so a lead can never exist
        // here without the queue knowing it still has to be sent.
        ...initialCrmSyncFields(),
      },
      include: { product: { select: { name: true } }, form: { select: { name: true } } },
      });
    }

    const submission = await tx.formSubmission.create({
      data: {
        formId: form.id,
        countryId: country.id,
        data: values as Prisma.InputJsonValue,
        formName: form.name,
        fieldLabels: fieldLabels as Prisma.InputJsonValue,
        ipHash: hashIp(ip),
        ipAddress: ip,
        ipStatus,
        userAgent,
        referrer: attribution.referrer ?? null,
        pageUrl: attribution.landingUrl ?? attribution.pagePath ?? null,
        leadId: createdLead?.id ?? null,
      },
      select: { id: true },
    });

    if (requirement.applies) {
      const record = await tx.consentRecord.create({
        data: {
          leadId: createdLead?.id ?? null,
          submissionId: submission.id,
          countryId: country.id,
          // The stored notice this cites, when it came from one. The snapshot
          // beside it is what keeps the record readable if the row is later
          // removed; this is what lets the admin link back to it while it is
          // still there.
          noticeId: requirement.noticeId,
          ...evidence,
          noticeSnapshot: evidence.noticeSnapshot as Prisma.InputJsonValue,
        },
        select: { id: true },
      });

      // The grant, as an event, so the history reads from the beginning
      // rather than starting at the first withdrawal.
      const granted: Array<{ scope: 'ENQUIRY' | 'MARKETING' | 'TERMS'; value: boolean }> = [
        { scope: 'ENQUIRY', value: evidence.enquiryConsent },
        { scope: 'MARKETING', value: evidence.marketingConsent },
        { scope: 'TERMS', value: evidence.termsAccepted },
      ];
      await tx.consentEvent.createMany({
        data: granted.map((entry) => ({
          recordId: record.id,
          type: 'GRANTED' as const,
          scope: entry.scope,
          value: entry.value,
          actorType: 'VISITOR',
          ipAddress: ip,
        })),
      });
    }

    return createdLead;
  });

  if (persisted) {
    leadId = persisted.id;

    await logLeadActivity({
      leadId: persisted.id,
      type: 'CREATED',
      summary: `Lead captured from “${form.name}”${persisted.product?.name ? ` for ${persisted.product.name}` : ''}`,
      meta: { formSlug: form.slug, utmSource: persisted.utmSource },
    });

    // Notifications must never block the visitor's response, and must not run
    // inside the transaction that decides whether the lead exists at all.
    void notifyNewLead({ lead: persisted, extraRecipients: splitEmails(formRecord?.notifyEmails) });
    void sendLeadConfirmation(persisted.email, persisted.name, persisted.product?.name ?? null);
    // After the transaction, never inside it: the CRM being slow or down must
    // not hold up — or undo — the lead itself. A miss is retried by the queue.
    syncNewLead(persisted.id);
  }
  void leadId;

  void notifySubmission(
    form.id,
    form.name,
    values,
    attribution.landingUrl ?? null,
    formRecord?.notifyEmails,
  );

  return success({ message: form.successMessage, redirectUrl: form.redirectUrl });
}

/**
 * Removes a market prefix from a submitted path.
 *
 * The browser sends the URL it was on ("/ae/contact"); attribution is stored
 * against market-relative slugs ("contact"), so both markets' contact pages
 * record their own leads rather than one shadowing the other.
 */
function stripCountryPrefix(path: string, slug: string): string {
  if (!slug) return path;
  const prefix = `/${slug}`;
  if (path === prefix) return '/';
  return path.startsWith(`${prefix}/`) ? path.slice(prefix.length) : path;
}

function splitEmails(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[,;\n]/)
    .map((e) => e.trim())
    .filter((e) => e.includes('@'));
}

async function sendLeadConfirmation(to: string, name: string, productName: string | null) {
  try {
    const site = await getWebsiteSettings();
    await sendTemplate({
      key: 'lead_confirmation',
      to,
      tokens: {
        site_name: site.siteName,
        lead_name: name,
        product_suffix: productName ? ` about ${productName}` : '',
      },
    });
  } catch (error) {
    console.error('[form] confirmation email failed', error);
  }
}

async function notifySubmission(
  formId: string,
  formName: string,
  values: Record<string, string>,
  landingUrl: string | null,
  notifyEmails: string | null | undefined,
) {
  try {
    const [email, site] = await Promise.all([getEmailSettings(), getWebsiteSettings()]);
    if (!email.notifyOnSubmission) return;
    const recipients = Array.from(
      new Set([...splitEmails(notifyEmails), ...splitEmails(email.salesNotificationEmails)]),
    );
    if (recipients.length === 0) return;

    const rows = Object.entries(values)
      .map(
        ([key, value]) =>
          `<tr><td style="padding:6px;border:1px solid #e3e8f0"><strong>${escapeHtml(key)}</strong></td><td style="padding:6px;border:1px solid #e3e8f0">${escapeHtml(String(value))}</td></tr>`,
      )
      .join('');

    await sendTemplate({
      key: 'form_submission',
      to: recipients,
      tokens: {
        site_name: site.siteName,
        form_name: formName,
        landing_url: landingUrl ?? '—',
        submission_table: `<table style="border-collapse:collapse">${rows}</table>`,
      },
    });
  } catch (error) {
    console.error('[form] submission notification failed', error);
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

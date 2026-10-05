/**
 * Deskzo CRM — what is sent, and what each answer means.
 *
 * Pure functions only: no database, no network, no environment. The service in
 * `deskzo.service.ts` does the I/O around them, which keeps the two decisions
 * that matter — how a lead is described to the CRM, and whether a response
 * means "done", "try again" or "a person must look" — testable on their own.
 *
 * The API is documented by Deskzo as "Lead capture API" (POST /api/v1/leads,
 * HTTP Basic with a key ID and secret per website).
 */

export const DEFAULT_DESKZO_API_URL = 'https://bisleriwater.deskzo.com/api/v1/leads';

/** Deskzo's own source vocabulary. Anything else is refused with a 400. */
export const DESKZO_SOURCES = [
  'website',
  'referral',
  'linkedin',
  'calling',
  'email',
  'event',
  'partner',
  'advertisement',
  'existing_customer',
  'walk_in',
  'other',
] as const;
export type DeskzoSource = (typeof DESKZO_SOURCES)[number];

/**
 * Form fields forwarded to the CRM when a form has a field with exactly this
 * name. These are the fields the Deskzo workspace has added to its leads and
 * companies; any other form field stays in this site's submission record.
 */
export const DESKZO_LEAD_FIELDS = [
  'licence_type',
  'seats_needed',
  'current_licence_expiry',
  'competing_partner',
] as const;
export const DESKZO_COMPANY_FIELDS = ['tenant_domain'] as const;

/** Form field names read into Deskzo's address and quantity fields. */
const ADDRESS_FIELDS = ['city', 'state', 'pincode'] as const;
const QUANTITY_FIELDS = ['quantity', 'seats_needed', 'seats', 'users', 'licences', 'licenses'];

export type DeskzoLeadInput = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  jobTitle: string | null;
  message: string | null;
  source: string | null;
  value: { toString(): string } | number | string | null;
  landingUrl: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  firstUtmSource: string | null;
  firstUtmMedium: string | null;
  firstUtmCampaign: string | null;
  /** True for a lead captured by a website form, false for one added by staff. */
  fromWebsite: boolean;
  countryName: string | null;
  productName: string | null;
  productSku: string | null;
  formName: string | null;
  /** The form as submitted, by field name, when the lead came from one. */
  formValues: Record<string, unknown> | null;
};

export type DeskzoPayload = {
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  designation?: string;
  city?: string;
  state?: string;
  pincode?: string;
  country?: string;
  message?: string;
  product_interest?: string;
  products?: string[];
  quantity?: number;
  budget?: number;
  source: DeskzoSource;
  page_url?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  external_id: string;
  custom_fields?: Record<string, string>;
  company_fields?: Record<string, string>;
};

/** Trims, and cuts to the CRM's limit rather than letting it refuse the lead. */
function text(value: unknown, max: number): string | undefined {
  if (value === null || value === undefined) return undefined;
  const trimmed = String(value).trim();
  if (!trimmed) return undefined;
  return trimmed.length > max ? trimmed.slice(0, max).trimEnd() : trimmed;
}

/**
 * Up to 20 characters, any format. A number written with a lot of spacing or
 * an extension can run past that, so an over-long one keeps only its leading
 * plus and digits — which is what the CRM needs to call it.
 */
export function normalisePhone(raw: string | null | undefined): string | undefined {
  const value = text(raw, 64);
  if (!value) return undefined;
  if (value.length <= 20) return value;
  const compact = value.replace(/(?!^\+)[^\d]/g, '');
  return compact.slice(0, 20) || undefined;
}

/** The CRM's page_url must be an absolute URL; this site stores paths too. */
export function absoluteUrl(raw: string | null | undefined, base: string): string | undefined {
  const value = text(raw, 2000);
  if (!value) return undefined;
  try {
    const url = new URL(value, `${base.replace(/\/+$/, '')}/`);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    const href = url.toString();
    return href.length <= 500 ? href : undefined;
  } catch {
    return undefined;
  }
}

/**
 * This site's free-text source ("Google Ads", "Referral", a form's name) read
 * into Deskzo's fixed list. A website lead is always `website` — the campaign
 * that brought it travels separately as UTM fields — so only leads staff
 * added by hand need their source guessed.
 */
export function mapSource(source: string | null, fromWebsite: boolean): DeskzoSource {
  if (fromWebsite) return 'website';
  const value = (source ?? '').toLowerCase();
  if (!value) return 'other';
  const rules: Array<[RegExp, DeskzoSource]> = [
    [/referr?al|referred/, 'referral'],
    [/linked\s*in/, 'linkedin'],
    [/walk[\s-]?in/, 'walk_in'],
    [/existing|renewal|upsell/, 'existing_customer'],
    [/partner|reseller|distributor/, 'partner'],
    [/event|webinar|expo|conference|seminar/, 'event'],
    [/\b(ads?|adwords|ppc|cpc|paid|advert\w*)\b/, 'advertisement'],
    [/call|phone|telephon|cold/, 'calling'],
    [/e-?mail|newsletter/, 'email'],
    [/web|site|form|blog|organic|seo|chat/, 'website'],
  ];
  return rules.find(([pattern]) => pattern.test(value))?.[1] ?? 'other';
}

function positiveNumber(value: DeskzoLeadInput['value']): number | undefined {
  if (value === null || value === undefined) return undefined;
  const parsed = Number(value.toString());
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) / 100 : undefined;
}

function formValue(values: Record<string, unknown> | null, name: string): string | undefined {
  if (!values) return undefined;
  const raw = values[name];
  if (Array.isArray(raw)) return text(raw.join('; '), 500);
  return text(raw, 500);
}

/** The enquiry, described the way the lead capture API expects it. */
export function buildDeskzoPayload(lead: DeskzoLeadInput, siteBase: string): DeskzoPayload {
  const values = lead.formValues;

  const payload: DeskzoPayload = {
    name: text(lead.name, 120) ?? text(lead.email?.split('@')[0], 120) ?? 'Unknown',
    email: text(lead.email, 254),
    phone: normalisePhone(lead.phone),
    company: text(lead.company, 160),
    designation: text(lead.jobTitle, 80),
    country: text(lead.countryName, 80),
    message: text(lead.message, 5000),
    // Becomes the lead's title in the CRM, so a lead with no product still
    // says what it was: the form it came through.
    product_interest:
      text(lead.productName, 200) ??
      (lead.formName ? text(`Enquiry via ${lead.formName}`, 200) : undefined),
    products: lead.productSku ? [lead.productSku] : undefined,
    budget: positiveNumber(lead.value),
    source: mapSource(lead.source, lead.fromWebsite),
    page_url: absoluteUrl(lead.landingUrl, siteBase),
    utm_source: text(lead.utmSource ?? lead.firstUtmSource, 200),
    utm_medium: text(lead.utmMedium ?? lead.firstUtmMedium, 200),
    utm_campaign: text(lead.utmCampaign ?? lead.firstUtmCampaign, 200),
    // This site's id, so a retry after a timeout returns the same CRM lead
    // instead of creating a second.
    external_id: lead.id,
  };

  for (const field of ADDRESS_FIELDS) {
    const value = formValue(values, field);
    if (value) payload[field] = text(value, 120);
  }

  if (payload.products) {
    for (const field of QUANTITY_FIELDS) {
      const quantity = Number.parseInt(formValue(values, field) ?? '', 10);
      if (Number.isInteger(quantity) && quantity > 0) {
        payload.quantity = quantity;
        break;
      }
    }
  }

  const custom: Record<string, string> = {};
  for (const key of DESKZO_LEAD_FIELDS) {
    const value = formValue(values, key);
    if (value) custom[key] = value;
  }
  if (Object.keys(custom).length > 0) payload.custom_fields = custom;

  const company: Record<string, string> = {};
  for (const key of DESKZO_COMPANY_FIELDS) {
    const value = formValue(values, key);
    if (value) company[key] = value;
  }
  if (Object.keys(company).length > 0) payload.company_fields = company;

  // Undefined keys are dropped by JSON.stringify, but stripping them here
  // keeps the payload honest when it is logged or compared in a test.
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined),
  ) as DeskzoPayload;
}

/** The CRM needs an email or a phone number; without either it refuses. */
export function canSendToDeskzo(payload: DeskzoPayload): boolean {
  return Boolean(payload.email || payload.phone);
}

export type DeskzoOutcome =
  | {
      kind: 'synced';
      crmLeadId: string | null;
      reference: string | null;
      duplicate: boolean;
      assigned: boolean | null;
      notSaved: Array<{ field: string; reason: string }>;
    }
  /** 202: accepted for a company a reseller manages; no lead was created. */
  | { kind: 'routed' }
  /**
   * Worth sending again later: the CRM was down, busy, or the key is wrong.
   * `haltQueue` marks an answer every other lead would get too (a rate limit,
   * a rejected key), so a batch stops rather than repeating it.
   */
  | { kind: 'retry'; error: string; retryAfterSeconds?: number; haltQueue?: boolean }
  /** Sending the same thing again cannot work; a person must look. */
  | { kind: 'rejected'; error: string };

type ResponseBody = {
  ok?: boolean;
  error?: string;
  fields?: unknown;
  duplicate?: boolean;
  assigned?: boolean;
  lead?: { id?: string; reference?: string };
  not_saved?: Array<{ field?: string; reason?: string }>;
} | null;

function describeFields(fields: unknown): string {
  if (!fields) return '';
  if (Array.isArray(fields)) return fields.map(String).join(', ');
  if (typeof fields === 'object') return Object.keys(fields as object).join(', ');
  return String(fields);
}

/** What a response from POST /api/v1/leads means for this lead. */
export function interpretDeskzoResponse(
  status: number,
  body: ResponseBody,
  retryAfterHeader?: string | null,
): DeskzoOutcome {
  if (status === 201 || status === 200) {
    return {
      kind: 'synced',
      crmLeadId: body?.lead?.id ?? null,
      reference: body?.lead?.reference ?? null,
      // 200 is Deskzo saying it already had this external_id.
      duplicate: status === 200 || body?.duplicate === true,
      assigned: typeof body?.assigned === 'boolean' ? body.assigned : null,
      notSaved: (body?.not_saved ?? []).map((item) => ({
        field: String(item.field ?? ''),
        reason: String(item.reason ?? ''),
      })),
    };
  }

  if (status === 202) return { kind: 'routed' };

  if (status === 429) {
    const seconds = Number.parseInt(retryAfterHeader ?? '', 10);
    return {
      kind: 'retry',
      error: 'Deskzo is limiting requests (more than 60 leads a minute). Will retry.',
      retryAfterSeconds: Number.isFinite(seconds) && seconds > 0 ? seconds : 60,
      haltQueue: true,
    };
  }

  if (status === 401) {
    // Retried, not abandoned: the usual cause is a key not yet set or one that
    // was rotated, and once it is fixed every waiting lead should go through.
    return {
      kind: 'retry',
      error:
        'Deskzo did not accept the API key. Check DESKZO_KEY_ID and DESKZO_SECRET, or whether the key was revoked.',
      haltQueue: true,
    };
  }

  if (status === 400) {
    const fields = describeFields(body?.fields);
    return {
      kind: 'rejected',
      error: `Deskzo refused the lead: ${body?.error ?? 'bad request'}${fields ? ` (${fields})` : ''}.`,
    };
  }

  if (status === 413)
    return { kind: 'rejected', error: 'Deskzo refused the lead: it is over 64 KB.' };
  if (status === 415)
    return { kind: 'rejected', error: 'Deskzo refused the request format (415).' };

  if (status >= 500 || status === 408) {
    return { kind: 'retry', error: `Deskzo is unavailable (HTTP ${status}). Will retry.` };
  }

  return {
    kind: 'rejected',
    error: `Deskzo answered HTTP ${status}${body?.error ? `: ${body.error}` : ''}.`,
  };
}

/** Temporary failures are retried this many times before needing a person. */
export const MAX_SYNC_ATTEMPTS = 12;

/**
 * When to try again after the nth failed attempt: 1, 2, 4, 8 … minutes,
 * capped at six hours, so a CRM outage of a day costs a dozen requests per
 * lead rather than thousands.
 */
export function nextAttemptDelayMs(attempt: number, retryAfterSeconds?: number): number {
  if (retryAfterSeconds && retryAfterSeconds > 0) return retryAfterSeconds * 1000;
  const minutes = Math.min(2 ** Math.max(0, attempt - 1), 360);
  return minutes * 60_000;
}

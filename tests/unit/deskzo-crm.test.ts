import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  absoluteUrl,
  buildDeskzoPayload,
  canSendToDeskzo,
  interpretDeskzoResponse,
  mapSource,
  nextAttemptDelayMs,
  normalisePhone,
  type DeskzoLeadInput,
} from '@/lib/crm/deskzo';
import { collectEnvProblems } from '@/lib/env-validation';

const SITE = 'https://www.example.com';

function lead(overrides: Partial<DeskzoLeadInput> = {}): DeskzoLeadInput {
  return {
    id: 'cmlead123',
    name: 'Priya Sharma',
    email: 'priya@acme.in',
    phone: '+91 98765 43210',
    company: 'Acme Chemicals India Pvt Ltd',
    jobTitle: 'IT Manager',
    message: 'Need 25 licences.',
    source: 'Contact Sales',
    value: null,
    landingUrl: '/microsoft-365?utm_source=google',
    utmSource: 'google',
    utmMedium: 'cpc',
    utmCampaign: 'm365',
    firstUtmSource: null,
    firstUtmMedium: null,
    firstUtmCampaign: null,
    fromWebsite: true,
    countryName: 'India',
    productName: 'Dropbox Business Standard',
    productSku: 'DBX-STD',
    formName: 'Contact Sales',
    formValues: null,
    ...overrides,
  };
}

describe('Deskzo payload', () => {
  it('describes a website lead the way the lead capture API expects', () => {
    expect(buildDeskzoPayload(lead(), SITE)).toEqual({
      name: 'Priya Sharma',
      email: 'priya@acme.in',
      phone: '+91 98765 43210',
      company: 'Acme Chemicals India Pvt Ltd',
      designation: 'IT Manager',
      country: 'India',
      message: 'Need 25 licences.',
      product_interest: 'Dropbox Business Standard',
      products: ['DBX-STD'],
      source: 'website',
      page_url: 'https://www.example.com/microsoft-365?utm_source=google',
      utm_source: 'google',
      utm_medium: 'cpc',
      utm_campaign: 'm365',
      external_id: 'cmlead123',
    });
  });

  it("sends this site's lead id as external_id, so a retry cannot duplicate", () => {
    expect(buildDeskzoPayload(lead({ id: 'abc' }), SITE).external_id).toBe('abc');
  });

  it('cuts every field to the length the CRM accepts instead of being refused', () => {
    const payload = buildDeskzoPayload(
      lead({
        name: 'n'.repeat(300),
        company: 'c'.repeat(300),
        jobTitle: 'j'.repeat(300),
        message: 'm'.repeat(6000),
        productName: 'p'.repeat(300),
      }),
      SITE,
    );
    expect(payload.name).toHaveLength(120);
    expect(payload.company).toHaveLength(160);
    expect(payload.designation).toHaveLength(80);
    expect(payload.message).toHaveLength(5000);
    expect(payload.product_interest).toHaveLength(200);
  });

  it('names the form as the interest when there is no product, and omits empty fields', () => {
    const payload = buildDeskzoPayload(
      lead({ productName: null, productSku: null, company: '  ', phone: null }),
      SITE,
    );
    expect(payload.product_interest).toBe('Enquiry via Contact Sales');
    expect(payload).not.toHaveProperty('products');
    expect(payload).not.toHaveProperty('company');
    expect(payload).not.toHaveProperty('phone');
  });

  it('sends a positive lead value as the budget', () => {
    expect(buildDeskzoPayload(lead({ value: '150000.00' }), SITE).budget).toBe(150000);
    expect(buildDeskzoPayload(lead({ value: '0' }), SITE)).not.toHaveProperty('budget');
  });

  it('falls back to first-touch UTMs when the last touch had none', () => {
    const payload = buildDeskzoPayload(
      lead({ utmSource: null, utmMedium: null, utmCampaign: null, firstUtmSource: 'linkedin' }),
      SITE,
    );
    expect(payload.utm_source).toBe('linkedin');
    expect(payload).not.toHaveProperty('utm_medium');
  });

  it('forwards the form fields Deskzo has, and the address and quantity', () => {
    const payload = buildDeskzoPayload(
      lead({
        formValues: {
          licence_type: 'renewal',
          seats_needed: '25',
          competing_partner: '',
          tenant_domain: 'acme.onmicrosoft.com',
          state: 'Maharashtra',
          city: 'Pune',
          pincode: '411001',
          favourite_colour: 'blue',
        },
      }),
      SITE,
    );
    expect(payload.custom_fields).toEqual({ licence_type: 'renewal', seats_needed: '25' });
    expect(payload.company_fields).toEqual({ tenant_domain: 'acme.onmicrosoft.com' });
    expect(payload).toMatchObject({ state: 'Maharashtra', city: 'Pune', pincode: '411001' });
    expect(payload.quantity).toBe(25);
    expect(JSON.stringify(payload)).not.toContain('favourite_colour');
  });

  it('sends a quantity only alongside a product, which is what it applies to', () => {
    const payload = buildDeskzoPayload(
      lead({ productSku: null, formValues: { seats_needed: '25' } }),
      SITE,
    );
    expect(payload).not.toHaveProperty('quantity');
  });

  it('needs an email or a phone', () => {
    expect(canSendToDeskzo(buildDeskzoPayload(lead(), SITE))).toBe(true);
    expect(canSendToDeskzo(buildDeskzoPayload(lead({ email: null, phone: null }), SITE))).toBe(
      false,
    );
  });
});

describe('field helpers', () => {
  it('keeps a phone as typed, compacting only one over 20 characters', () => {
    expect(normalisePhone('+91 98765 43210')).toBe('+91 98765 43210');
    expect(normalisePhone('+91 (0) 98765 - 43210 ext. 12')).toBe('+910987654321012');
    expect(normalisePhone('   ')).toBeUndefined();
  });

  it('makes a stored path absolute and drops what is not a web URL', () => {
    expect(absoluteUrl('/pricing', SITE)).toBe('https://www.example.com/pricing');
    expect(absoluteUrl('https://other.test/x', SITE)).toBe('https://other.test/x');
    expect(absoluteUrl('javascript:alert(1)', SITE)).toBeUndefined();
    expect(absoluteUrl(`/${'a'.repeat(600)}`, SITE)).toBeUndefined();
  });

  it('reads every website lead as website, and guesses only for manual ones', () => {
    expect(mapSource('Google Ads', true)).toBe('website');
    expect(mapSource('Google Ads', false)).toBe('advertisement');
    expect(mapSource('Added manually', false)).toBe('other');
    expect(mapSource('Referral from Ravi', false)).toBe('referral');
    expect(mapSource('LinkedIn', false)).toBe('linkedin');
    expect(mapSource('Cold call', false)).toBe('calling');
    expect(mapSource('Walk-in', false)).toBe('walk_in');
    expect(mapSource(null, false)).toBe('other');
  });
});

describe('Deskzo responses', () => {
  it('201 is a new CRM lead, with anything it could not save', () => {
    expect(
      interpretDeskzoResponse(201, {
        ok: true,
        lead: { id: 'cm1', reference: 'LEAD-000481' },
        duplicate: false,
        assigned: true,
        not_saved: [{ field: 'custom_fields.floor', reason: 'Floor should be a number.' }],
      }),
    ).toEqual({
      kind: 'synced',
      crmLeadId: 'cm1',
      reference: 'LEAD-000481',
      duplicate: false,
      assigned: true,
      notSaved: [{ field: 'custom_fields.floor', reason: 'Floor should be a number.' }],
    });
  });

  it('200 means Deskzo already had it — done, not a failure', () => {
    const outcome = interpretDeskzoResponse(200, { lead: { id: 'cm1', reference: 'LEAD-1' } });
    expect(outcome).toMatchObject({ kind: 'synced', duplicate: true, reference: 'LEAD-1' });
  });

  it('202 is accepted and routed to a reseller', () => {
    expect(interpretDeskzoResponse(202, { ok: true })).toEqual({ kind: 'routed' });
  });

  it('400 is refused for good, naming the fields', () => {
    const outcome = interpretDeskzoResponse(400, { error: 'Invalid email', fields: ['email'] });
    expect(outcome.kind).toBe('rejected');
    expect(outcome.kind === 'rejected' && outcome.error).toContain('(email)');
  });

  it('a wrong key and a rate limit are retried, and stop the batch', () => {
    expect(interpretDeskzoResponse(401, null)).toMatchObject({ kind: 'retry', haltQueue: true });
    expect(interpretDeskzoResponse(429, null, '30')).toMatchObject({
      kind: 'retry',
      retryAfterSeconds: 30,
      haltQueue: true,
    });
  });

  it('a server error is retried without stopping the batch', () => {
    const outcome = interpretDeskzoResponse(503, null);
    expect(outcome.kind).toBe('retry');
    expect(outcome.kind === 'retry' && outcome.haltQueue).toBeFalsy();
  });

  it('413 and 415 are refused for good', () => {
    expect(interpretDeskzoResponse(413, null).kind).toBe('rejected');
    expect(interpretDeskzoResponse(415, null).kind).toBe('rejected');
  });

  it('backs off 1, 2, 4… minutes up to six hours, or as Deskzo asks', () => {
    expect(nextAttemptDelayMs(1)).toBe(60_000);
    expect(nextAttemptDelayMs(3)).toBe(4 * 60_000);
    expect(nextAttemptDelayMs(20)).toBe(360 * 60_000);
    expect(nextAttemptDelayMs(5, 30)).toBe(30_000);
  });
});

describe('configuration', () => {
  const base = {
    DATABASE_URL: 'postgresql://x',
    AUTH_SECRET: 'a'.repeat(32),
    NEXTAUTH_URL: 'https://example.com',
    NEXT_PUBLIC_SITE_URL: 'https://example.com',
    ENCRYPTION_KEY: 'k'.repeat(32),
    MFA_ENCRYPTION_KEY: 'm'.repeat(32),
  };
  const deskzoProblems = (extra: Record<string, string>) =>
    collectEnvProblems({ ...base, ...extra }).filter((p) => p.variable.startsWith('DESKZO'));

  it('is optional, but refuses half a key pair or a plain-http endpoint', () => {
    expect(deskzoProblems({})).toEqual([]);
    expect(deskzoProblems({ DESKZO_KEY_ID: 'k', DESKZO_SECRET: 's' })).toEqual([]);
    expect(deskzoProblems({ DESKZO_KEY_ID: 'k' }).map((p) => p.variable)).toEqual([
      'DESKZO_SECRET',
    ]);
    expect(
      deskzoProblems({ DESKZO_KEY_ID: 'k', DESKZO_SECRET: 's', DESKZO_API_URL: 'http://x.test' }),
    ).toHaveLength(1);
  });

  it('never sends a lead from the browser, and queues it in the same insert', () => {
    const service = readFileSync('src/lib/crm/deskzo.service.ts', 'utf8');
    expect(service.startsWith("import 'server-only';")).toBe(true);

    const submit = readFileSync('src/lib/actions/submit-form.ts', 'utf8');
    expect(submit).toContain('...initialCrmSyncFields()');
    // The push happens after the transaction, not inside it.
    expect(submit.indexOf('syncNewLead(persisted.id)')).toBeGreaterThan(
      submit.indexOf('prisma.$transaction'),
    );
  });
});

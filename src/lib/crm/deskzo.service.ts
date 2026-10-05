import 'server-only';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { siteUrl } from '@/lib/env';
import { logLeadActivity } from '@/lib/services/leads';
import {
  DEFAULT_DESKZO_API_URL,
  MAX_SYNC_ATTEMPTS,
  buildDeskzoPayload,
  canSendToDeskzo,
  interpretDeskzoResponse,
  nextAttemptDelayMs,
  type DeskzoOutcome,
} from './deskzo';

/**
 * Pushes leads to the Deskzo CRM.
 *
 * A lead is saved here first, always; the CRM is a copy. Every lead captured
 * while the integration is configured is marked PENDING in the same insert, an
 * attempt is made straight away in the background, and anything the CRM could
 * not take is retried with backoff — by the cron endpoint, by the next lead
 * that arrives, or by hand from the lead. Deskzo de-duplicates on external_id
 * (this lead's id), so a retry can never create a second CRM lead.
 */

export type DeskzoConfig = { url: string; keyId: string; secret: string };

/** Null when the integration is off: no key pair in the environment. */
export function deskzoConfig(): DeskzoConfig | null {
  const keyId = process.env.DESKZO_KEY_ID?.trim();
  const secret = process.env.DESKZO_SECRET?.trim();
  if (!keyId || !secret) return null;
  const url = process.env.DESKZO_API_URL?.trim() || DEFAULT_DESKZO_API_URL;
  // The key is sent with every request; refuse to send it in the clear —
  // except to a local stand-in while developing.
  const local =
    process.env.NODE_ENV !== 'production' &&
    /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(url);
  if (!/^https:\/\//i.test(url) && !local) return null;
  return { url, keyId, secret };
}

export function deskzoEnabled(): boolean {
  return deskzoConfig() !== null;
}

/** How long a just-captured lead is left to its inline push before the queue may take it. */
const INLINE_GRACE_MS = 2 * 60_000;
/** How long a queue run holds a lead, so two runs never send it at once. */
const LEASE_MS = 5 * 60_000;
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Columns for a new lead: PENDING when the integration is on, nothing when it
 * is off (so switching it on later does not flood the CRM with old leads).
 */
export function initialCrmSyncFields(): Pick<
  Prisma.LeadUncheckedCreateInput,
  'crmSyncStatus' | 'crmNextAttemptAt'
> {
  if (!deskzoEnabled()) return {};
  return { crmSyncStatus: 'PENDING', crmNextAttemptAt: new Date(Date.now() + INLINE_GRACE_MS) };
}

function authorization(config: DeskzoConfig): string {
  return `Basic ${Buffer.from(`${config.keyId}:${config.secret}`).toString('base64')}`;
}

async function readJson(response: Response) {
  try {
    return (await response.json()) as Parameters<typeof interpretDeskzoResponse>[1];
  } catch {
    return null;
  }
}

export type PushResult =
  | { ok: true; outcome: Extract<DeskzoOutcome, { kind: 'synced' | 'routed' }> }
  | { ok: false; error: string; outcome?: Extract<DeskzoOutcome, { kind: 'retry' | 'rejected' }> };

/**
 * Sends one lead now, whatever its queue state, and records the result.
 *
 * Used for the attempt made as a lead arrives, by the retry queue, and by the
 * "Send to CRM" button. Never throws: a CRM problem must not surface as a
 * failed form submission or a crashed admin action.
 */
export async function pushLeadToDeskzo(
  leadId: string,
  options: { actorId?: string | null } = {},
): Promise<PushResult> {
  const config = deskzoConfig();
  if (!config) {
    return { ok: false, error: 'The Deskzo CRM integration is not configured.' };
  }

  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: {
      country: { select: { name: true } },
      product: { select: { name: true, sku: true } },
      form: { select: { name: true } },
      submissions: { orderBy: { createdAt: 'desc' }, take: 1, select: { data: true } },
    },
  });
  if (!lead || lead.deletedAt) return { ok: false, error: 'That lead no longer exists.' };
  if (lead.status === 'SPAM') {
    return { ok: false, error: 'Leads marked as spam are not sent to the CRM.' };
  }

  const payload = buildDeskzoPayload(
    {
      ...lead,
      fromWebsite: Boolean(lead.formId),
      countryName: lead.country?.name ?? null,
      productName: lead.product?.name ?? null,
      productSku: lead.product?.sku ?? null,
      formName: lead.form?.name ?? null,
      formValues: (lead.submissions[0]?.data ?? null) as Record<string, unknown> | null,
    },
    siteUrl(),
  );

  let outcome: DeskzoOutcome;
  if (!canSendToDeskzo(payload)) {
    outcome = { kind: 'rejected', error: 'The CRM needs an email address or a phone number.' };
  } else {
    try {
      const response = await fetch(config.url, {
        method: 'POST',
        headers: {
          Authorization: authorization(config),
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        cache: 'no-store',
      });
      outcome = interpretDeskzoResponse(
        response.status,
        await readJson(response),
        response.headers.get('retry-after'),
      );
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'TimeoutError';
      outcome = {
        kind: 'retry',
        error: timedOut
          ? 'Deskzo did not answer within 15 seconds. Will retry.'
          : 'Could not reach Deskzo. Will retry.',
      };
      // The error's message only, never the request: it carries the lead.
      console.error('[crm] deskzo request failed', error instanceof Error ? error.message : error);
    }
  }

  await recordOutcome(
    { id: lead.id, updatedAt: lead.updatedAt },
    lead.crmSyncAttempts + 1,
    outcome,
    options.actorId ?? null,
  );
  if (outcome.kind === 'synced' || outcome.kind === 'routed') return { ok: true, outcome };
  return { ok: false, error: outcome.error, outcome };
}

/**
 * Every write below hands `updatedAt` back unchanged: "Last activity" in the
 * leads list reads it, and a background copy to another system is not
 * activity on the lead.
 */
async function recordOutcome(
  lead: { id: string; updatedAt: Date },
  attempts: number,
  outcome: DeskzoOutcome,
  actorId: string | null,
): Promise<void> {
  const now = new Date();
  const leadId = lead.id;
  const updatedAt = lead.updatedAt;

  if (outcome.kind === 'synced') {
    await prisma.lead.update({
      where: { id: leadId },
      data: {
        crmSyncStatus: 'SYNCED',
        crmLeadId: outcome.crmLeadId,
        crmReference: outcome.reference,
        crmSyncAttempts: attempts,
        crmSyncedAt: now,
        crmNextAttemptAt: null,
        crmLastError: null,
        updatedAt,
      },
    });
    const notSaved = outcome.notSaved.map((item) => item.field).filter(Boolean);
    await logLeadActivity({
      leadId,
      type: 'UPDATED',
      actorId,
      summary: [
        outcome.duplicate
          ? `Already in the Deskzo CRM${outcome.reference ? ` as ${outcome.reference}` : ''}`
          : `Sent to the Deskzo CRM${outcome.reference ? ` as ${outcome.reference}` : ''}`,
        outcome.assigned === false ? ' (not yet assigned there)' : '',
        notSaved.length > 0 ? `. Not saved there: ${notSaved.join(', ')}` : '',
      ].join(''),
      meta: { crm: 'deskzo', crmLeadId: outcome.crmLeadId, notSaved: outcome.notSaved },
    });
    return;
  }

  if (outcome.kind === 'routed') {
    await prisma.lead.update({
      where: { id: leadId },
      data: {
        crmSyncStatus: 'ROUTED',
        crmSyncAttempts: attempts,
        crmSyncedAt: now,
        crmNextAttemptAt: null,
        crmLastError: null,
        updatedAt,
      },
    });
    await logLeadActivity({
      leadId,
      type: 'UPDATED',
      actorId,
      summary:
        'Deskzo received this enquiry but routed it to a reseller who manages the company, so no CRM lead was created.',
      meta: { crm: 'deskzo' },
    });
    return;
  }

  const exhausted = outcome.kind === 'retry' && attempts >= MAX_SYNC_ATTEMPTS;
  const giveUp = outcome.kind === 'rejected' || exhausted;
  const error = exhausted
    ? `${outcome.error.replace(/ Will retry\.$/, '')} Gave up after ${attempts} attempts.`
    : outcome.error;

  await prisma.lead.update({
    where: { id: leadId },
    data: {
      crmSyncStatus: giveUp ? 'FAILED' : 'PENDING',
      crmSyncAttempts: attempts,
      crmLastError: error,
      crmNextAttemptAt: giveUp
        ? null
        : new Date(
            now.getTime() +
              nextAttemptDelayMs(
                attempts,
                outcome.kind === 'retry' ? outcome.retryAfterSeconds : undefined,
              ),
          ),
      updatedAt,
    },
  });

  // Only the end of the road goes in the lead's history; every retry would
  // bury the activity a salesperson actually needs.
  if (giveUp) {
    await logLeadActivity({
      leadId,
      type: 'UPDATED',
      actorId,
      summary: `Not sent to the Deskzo CRM: ${error}`,
      meta: { crm: 'deskzo' },
    });
  }
}

export type QueueRun = {
  attempted: number;
  synced: number;
  retrying: number;
  failed: number;
  /** Set when the run stopped early because every further send would fail too. */
  stoppedBecause?: string;
};

/**
 * Sends the leads that are due: PENDING, past their next attempt time.
 *
 * Each lead is leased before it is sent, so overlapping runs (the cron and a
 * new lead's drain, say) never send the same one twice at the same moment.
 * A rate limit or a rejected key stops the run: everything behind it would
 * meet the same answer.
 */
export async function processCrmQueue(limit = 25): Promise<QueueRun> {
  const run: QueueRun = { attempted: 0, synced: 0, retrying: 0, failed: 0 };
  if (!deskzoEnabled()) return { ...run, stoppedBecause: 'The integration is not configured.' };

  const now = new Date();
  const due = await prisma.lead.findMany({
    where: {
      crmSyncStatus: 'PENDING',
      deletedAt: null,
      OR: [{ crmNextAttemptAt: null }, { crmNextAttemptAt: { lte: now } }],
    },
    orderBy: [{ crmNextAttemptAt: 'asc' }, { createdAt: 'asc' }],
    take: limit,
    select: { id: true, updatedAt: true },
  });

  for (const { id, updatedAt } of due) {
    const leased = await prisma.lead.updateMany({
      where: {
        id,
        crmSyncStatus: 'PENDING',
        OR: [{ crmNextAttemptAt: null }, { crmNextAttemptAt: { lte: new Date() } }],
      },
      data: { crmNextAttemptAt: new Date(Date.now() + LEASE_MS), updatedAt },
    });
    if (leased.count === 0) continue;

    run.attempted += 1;
    const result = await pushLeadToDeskzo(id);
    if (result.ok) {
      run.synced += 1;
      continue;
    }

    const outcome = result.outcome;
    if (outcome?.kind === 'retry') run.retrying += 1;
    else run.failed += 1;

    if (outcome?.kind === 'retry' && outcome.haltQueue) {
      run.stoppedBecause = outcome.error;
      break;
    }
  }

  return run;
}

/**
 * The attempt made as a lead arrives: send it, then use the moment to send a
 * few others that are due, so retries happen even where no cron is set up.
 * Fire-and-forget; the caller never waits on the CRM.
 */
export function syncNewLead(leadId: string): void {
  if (!deskzoEnabled()) return;
  void (async () => {
    await pushLeadToDeskzo(leadId);
    await processCrmQueue(5);
  })().catch((error) => {
    console.error('[crm] background sync failed', error instanceof Error ? error.message : error);
  });
}

/** GET on the endpoint: confirms the key without creating anything. */
export async function testDeskzoConnection(): Promise<
  { ok: true; keyName: string | null } | { ok: false; error: string }
> {
  const config = deskzoConfig();
  if (!config) return { ok: false, error: 'Set DESKZO_KEY_ID and DESKZO_SECRET first.' };
  try {
    const response = await fetch(config.url, {
      method: 'GET',
      headers: { Authorization: authorization(config), Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: 'no-store',
    });
    if (response.status === 401) {
      return {
        ok: false,
        error: 'Deskzo did not accept the key ID and secret, or the key was revoked.',
      };
    }
    if (!response.ok) return { ok: false, error: `Deskzo answered HTTP ${response.status}.` };
    const body = (await response.json().catch(() => null)) as { ok?: boolean; key?: string } | null;
    return { ok: true, keyName: body?.key ?? null };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    return {
      ok: false,
      error: timedOut ? 'Deskzo did not answer within 15 seconds.' : 'Could not reach Deskzo.',
    };
  }
}

/** Leads that could be sent but never were: before the integration, or while it was off. */
const UNSENT: Prisma.LeadWhereInput = {
  crmSyncStatus: null,
  deletedAt: null,
  status: { not: 'SPAM' },
};

/*
 * The two bulk queue operations are raw SQL because `updateMany` would stamp
 * every row's updatedAt — and with it the "Last activity" of every lead on
 * the site — for what is only a change of delivery state.
 */

/** Queues every unsent lead; the queue then sends them in batches. */
export async function queueUnsentLeads(): Promise<number> {
  return prisma.$executeRaw`
    UPDATE "Lead"
       SET "crmSyncStatus" = 'PENDING', "crmNextAttemptAt" = NOW(), "crmLastError" = NULL
     WHERE "crmSyncStatus" IS NULL AND "deletedAt" IS NULL AND "status" <> 'SPAM'`;
}

/** Gives every FAILED lead a fresh set of attempts. */
export async function requeueFailedLeads(): Promise<number> {
  return prisma.$executeRaw`
    UPDATE "Lead"
       SET "crmSyncStatus" = 'PENDING', "crmSyncAttempts" = 0, "crmNextAttemptAt" = NOW()
     WHERE "crmSyncStatus" = 'FAILED' AND "deletedAt" IS NULL`;
}

export type CrmSyncSummary = {
  configured: boolean;
  endpointHost: string | null;
  keyId: string | null;
  counts: { synced: number; routed: number; pending: number; failed: number; unsent: number };
  recentFailures: Array<{
    id: string;
    reference: number;
    name: string;
    error: string | null;
    createdAt: Date;
  }>;
};

export async function getCrmSyncSummary(): Promise<CrmSyncSummary> {
  const config = deskzoConfig();
  const [grouped, unsent, recentFailures] = await Promise.all([
    prisma.lead.groupBy({
      by: ['crmSyncStatus'],
      where: { deletedAt: null, crmSyncStatus: { not: null } },
      _count: { _all: true },
    }),
    prisma.lead.count({ where: UNSENT }),
    prisma.lead.findMany({
      where: { deletedAt: null, crmSyncStatus: 'FAILED' },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { id: true, reference: true, name: true, crmLastError: true, createdAt: true },
    }),
  ]);
  const count = (status: string) =>
    grouped.find((row) => row.crmSyncStatus === status)?._count._all ?? 0;

  let endpointHost: string | null = null;
  try {
    endpointHost = new URL(process.env.DESKZO_API_URL?.trim() || DEFAULT_DESKZO_API_URL).host;
  } catch {
    endpointHost = null;
  }

  return {
    configured: Boolean(config),
    endpointHost,
    keyId: config?.keyId ?? null,
    counts: {
      synced: count('SYNCED'),
      routed: count('ROUTED'),
      pending: count('PENDING'),
      failed: count('FAILED'),
      unsent,
    },
    recentFailures: recentFailures.map((lead) => ({
      id: lead.id,
      reference: lead.reference,
      name: lead.name,
      error: lead.crmLastError,
      createdAt: lead.createdAt,
    })),
  };
}

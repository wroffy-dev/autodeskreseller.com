'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { authorize } from '@/lib/auth/guards';
import { recordAudit } from '@/lib/services/audit';
import {
  processCrmQueue,
  pushLeadToDeskzo,
  queueUnsentLeads,
  requeueFailedLeads,
  testDeskzoConnection,
} from '@/lib/crm/deskzo.service';
import { success, failure, toActionError, type ActionResult } from '@/lib/utils/result';

const SETTINGS_PATH = '/admin/settings/crm';

/** "Send to CRM" / "Retry" on one lead. */
export async function sendLeadToCrm(leadId: unknown): Promise<ActionResult> {
  try {
    const user = await authorize('leads.edit');
    const id = z.string().min(1).parse(leadId);

    const result = await pushLeadToDeskzo(id, { actorId: user.id });
    revalidatePath(`/admin/leads/${id}`);
    if (!result.ok) return failure(result.error);

    return success(
      undefined,
      result.outcome.kind === 'routed'
        ? 'Deskzo routed this enquiry to a reseller.'
        : result.outcome.reference
          ? `In the Deskzo CRM as ${result.outcome.reference}.`
          : 'Sent to the Deskzo CRM.',
    );
  } catch (error) {
    return toActionError(error);
  }
}

/** Checks the key against Deskzo without creating anything. */
export async function testCrmConnection(): Promise<ActionResult<{ keyName: string | null }>> {
  try {
    await authorize('settings.manage');
    const result = await testDeskzoConnection();
    if (!result.ok) return failure(result.error);
    return success(
      { keyName: result.keyName },
      result.keyName ? `Connected — Deskzo knows this key as “${result.keyName}”.` : 'Connected.',
    );
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * Sends the next batch of due leads now — for a site with no cron, or to
 * drain a backlog without waiting for it.
 */
export async function sendCrmBatch(): Promise<ActionResult> {
  try {
    await authorize('settings.manage');
    const run = await processCrmQueue(25);
    revalidatePath(SETTINGS_PATH);
    if (run.attempted === 0 && run.stoppedBecause) return failure(run.stoppedBecause);
    if (run.attempted === 0) return success(undefined, 'Nothing is due to be sent.');
    const parts = [`${run.synced} sent`];
    if (run.retrying) parts.push(`${run.retrying} will be retried`);
    if (run.failed) parts.push(`${run.failed} refused`);
    const message = `${parts.join(', ')}.${run.stoppedBecause ? ` Stopped: ${run.stoppedBecause}` : ''}`;
    return run.synced === 0 && (run.failed > 0 || run.stoppedBecause)
      ? failure(message)
      : success(undefined, message);
  } catch (error) {
    return toActionError(error);
  }
}

/** Queues every lead never sent — those from before the integration was on. */
export async function queueExistingLeads(): Promise<ActionResult> {
  try {
    const user = await authorize('settings.manage');
    const count = await queueUnsentLeads();
    await recordAudit({
      actor: user,
      action: 'updated',
      entity: 'CrmSync',
      summary: `Queued ${count} existing ${count === 1 ? 'lead' : 'leads'} for the Deskzo CRM`,
    });
    revalidatePath(SETTINGS_PATH);
    return success(
      undefined,
      count === 0
        ? 'Every lead has already been queued.'
        : `${count} ${count === 1 ? 'lead' : 'leads'} queued. They are sent in batches.`,
    );
  } catch (error) {
    return toActionError(error);
  }
}

/** Gives every lead the CRM refused, or that ran out of retries, another go. */
export async function retryFailedCrmLeads(): Promise<ActionResult> {
  try {
    const user = await authorize('settings.manage');
    const count = await requeueFailedLeads();
    await recordAudit({
      actor: user,
      action: 'updated',
      entity: 'CrmSync',
      summary: `Requeued ${count} failed ${count === 1 ? 'lead' : 'leads'} for the Deskzo CRM`,
    });
    revalidatePath(SETTINGS_PATH);
    return success(
      undefined,
      count === 0 ? 'No failed leads to retry.' : `${count} queued to be sent again.`,
    );
  } catch (error) {
    return toActionError(error);
  }
}

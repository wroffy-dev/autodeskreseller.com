import { json } from '@/lib/api/guard';
import { cronSecret, matchesBearer } from '@/lib/api/cron-auth';
import { deskzoEnabled, processCrmQueue } from '@/lib/crm/deskzo.service';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Deskzo CRM retry tick.
 *
 * Sends the leads that are due — ones the CRM could not take when they
 * arrived, and ones queued from Settings → CRM integration. Called by an
 * external scheduler every few minutes with `Authorization: Bearer
 * $CRON_SECRET`, the same secret as scheduled backups. Safe to call as often
 * as you like: only due leads are sent, each is leased while it is in flight,
 * and Deskzo de-duplicates on the lead's id anyway.
 *
 * A batch is capped at 50 so a backlog drains under Deskzo's limit of 60
 * leads a minute per key.
 */
export async function POST(request: Request) {
  const secret = cronSecret();
  if (!secret) return json({ error: 'Scheduled jobs are not configured.' }, 503);
  if (!matchesBearer(request.headers.get('authorization'), secret)) {
    return json({ error: 'Not authorised.' }, 401);
  }
  if (!deskzoEnabled()) return json({ ran: false, reason: 'not-configured' });

  const run = await processCrmQueue(50);
  return json({ ran: true, ...run });
}

import { cronSecret, matchesBearer } from '@/lib/api/cron-auth';
import { json } from '@/lib/api/guard';
import { createBackup } from '@/lib/backup/backup.service';
import { sanitiseError } from '@/lib/backup/config';
import { BackupBusyError } from '@/lib/backup/lock.service';
import { applyRetention } from '@/lib/backup/retention.service';
import { getSchedule, isDue, refreshNextRun } from '@/lib/backup/schedule.service';
import { toBackupDto } from '@/lib/backup/serialize';

export const dynamic = 'force-dynamic';
export const maxDuration = 600;

/**
 * Scheduled backup tick.
 *
 * Called by an external scheduler (Coolify cron, a system crontab or any
 * uptime pinger) with `Authorization: Bearer $CRON_SECRET`. It is safe to call
 * more often than the schedule: the endpoint runs a backup only when one is
 * actually due, and the global lock refuses a second concurrent run.
 */
export async function POST(request: Request) {
  const secret = cronSecret();

  // Without a configured secret the endpoint is not open — it is off.
  if (!secret) {
    return json({ error: 'Scheduled backups are not configured.' }, 503);
  }

  if (!matchesBearer(request.headers.get('authorization'), secret)) {
    return json({ error: 'Not authorised.' }, 401);
  }

  const schedule = await getSchedule();
  const force = new URL(request.url).searchParams.get('force') === '1';

  if (!force && !isDue(schedule)) {
    return json({ ran: false, reason: 'not-due', nextRunAt: schedule.nextRunAt });
  }

  try {
    const backup = await createBackup({
      type: schedule.backupType,
      origin: 'SCHEDULED',
      actor: null,
    });

    // Retention runs after the new backup exists, never before: pruning first
    // could leave the site with no usable backup if this run then failed.
    const retention = await applyRetention({ excludeIds: [backup.id] });
    const refreshed = await refreshNextRun(new Date());

    return json({
      ran: true,
      backup: toBackupDto(backup),
      pruned: retention.deleted,
      nextRunAt: refreshed.nextRunAt,
    });
  } catch (error) {
    if (error instanceof BackupBusyError) {
      return json({ ran: false, reason: 'busy' }, 409);
    }
    // Recompute regardless, so one failure does not wedge the schedule.
    await refreshNextRun(new Date()).catch(() => undefined);
    return json({ ran: false, error: sanitiseError(error) }, 500);
  }
}

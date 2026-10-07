import 'server-only';
import { after } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { sanitiseLoggedPath, sanitiseReferrer, segmentsOf } from './path';

/**
 * Recording the addresses that answered 404.
 *
 * One row per address, counted rather than logged per request, so a crawler
 * hammering one dead link is one row with a large number. Bounded: the table
 * never grows past `MAX_ROWS`, and the rows it sheds are the oldest ones seen
 * once — the noise, never the addresses people keep asking for.
 *
 * Nothing about the visitor is stored. The query string is dropped before
 * anything is written (it can carry tokens and personal data), and the
 * referrer is reduced to the referring site and path.
 */

export const MAX_ROWS = 5_000;

/**
 * Probes for files this site has never served — `/wp-login.php`, `/.env` —
 * are answered 404 but not recorded. No registered address can contain a dot,
 * so nothing a visitor could legitimately be missing is dropped.
 */
function isProbe(key: string): boolean {
  const last = segmentsOf(key).at(-1) ?? '';
  return last.includes('.') || key.startsWith('/.') || key.includes('/.');
}

export async function recordNotFound(
  rawPath: string,
  options: { countryId?: string | null; referrer?: string | null } = {},
): Promise<void> {
  const clean = sanitiseLoggedPath(rawPath);
  if (!clean || isProbe(clean.key)) return;
  const referrer = sanitiseReferrer(options.referrer);
  try {
    await prisma.urlNotFound.upsert({
      where: { pathKey: clean.key },
      update: {
        hits: { increment: 1 },
        lastSeenAt: new Date(),
        ...(referrer ? { lastReferrer: referrer } : {}),
      },
      create: {
        pathKey: clean.key,
        path: clean.path,
        countryId: options.countryId ?? null,
        lastReferrer: referrer,
      },
    });
    // Trim now and then rather than counting on every miss.
    if (Math.random() < 0.02) await trimNotFound();
  } catch (error) {
    // Recording must never affect the response.
    console.error('[urls] could not record a 404', error instanceof Error ? error.message : error);
  }
}

export async function trimNotFound(): Promise<number> {
  const total = await prisma.urlNotFound.count();
  if (total <= MAX_ROWS) return 0;
  const excess = await prisma.urlNotFound.findMany({
    where: { status: { not: 'RESOLVED' } },
    orderBy: [{ hits: 'asc' }, { lastSeenAt: 'asc' }],
    take: total - MAX_ROWS,
    select: { id: true },
  });
  const result = await prisma.urlNotFound.deleteMany({ where: { id: { in: excess.map((row) => row.id) } } });
  return result.count;
}

/** Counts a redirect being followed, after the response, never blocking it. */
export async function countRedirectHit(redirectId: string): Promise<void> {
  try {
    await prisma.redirect.update({
      where: { id: redirectId },
      data: { hitCount: { increment: 1 }, lastHitAt: new Date() },
    });
  } catch {
    // A deleted redirect, or a transient error: nothing to count.
  }
}

/**
 * Runs bookkeeping after the response has been sent. Outside a request — a
 * script, a test — it simply runs in the background, never throwing.
 */
export function afterResponse(task: () => Promise<unknown>): void {
  try {
    after(task);
  } catch {
    void task().catch(() => undefined);
  }
}

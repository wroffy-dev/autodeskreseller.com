import 'server-only';
import { timingSafeEqual } from 'node:crypto';

/**
 * The shared secret the internal cron endpoints require, or null when it is
 * unset or too short — in which case those endpoints are off, not open.
 */
export function cronSecret(): string | null {
  const secret = process.env.CRON_SECRET;
  return secret && secret.length >= 16 ? secret : null;
}

/** Constant-time comparison of `Authorization: Bearer <secret>`. */
export function matchesBearer(header: string | null, secret: string): boolean {
  if (!header?.startsWith('Bearer ')) return false;
  const provided = Buffer.from(header.slice(7));
  const expected = Buffer.from(secret);
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

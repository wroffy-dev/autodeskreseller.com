import { LOGIN_PATH_SEGMENT } from '@/lib/auth/routes';
import { SEED_FILES_SEGMENT } from '@/lib/seed-files/routes';

/*
 * Kept in a module of its own, importing nothing but the two route constants,
 * so the URL registry's path rules can read it without importing the whole
 * routing engine (which itself reads the registry for links).
 */

/**
 * First path segments that can never be a market prefix.
 *
 * Anything the framework, the admin, authentication, uploads or a crawler owns
 * belongs here. A market whose slug collided with one of these would shadow a
 * system route, so `isReservedSegment` is also what the country form validates
 * a new slug against.
 */
export const RESERVED_SEGMENTS: ReadonlySet<string> = new Set([
  'admin',
  'api',
  '_next',
  '_vercel',
  'auth',
  // The sign-in screen lives under its own segment; read from the one module
  // that defines it so moving the screen cannot leave a stale entry here.
  LOGIN_PATH_SEGMENT,
  // The seed-file screen is a system route of its own, outside /admin.
  SEED_FILES_SEGMENT,
  'login',
  'logout',
  'preview',
  'uploads',
  'media',
  'static',
  'assets',
  'favicon.ico',
  'robots.txt',
  'sitemap.xml',
  // The per-market sitemap files live under /sitemaps/<prefix>.xml.
  'sitemaps',
  'manifest.json',
  'health',
  'ready',
  'opensearch.xml',
  'sw.js',
]);

export function isReservedSegment(segment: string): boolean {
  const value = segment.trim().toLowerCase();
  if (!value) return false;
  // Any dotted first segment is a file, never a market.
  return RESERVED_SEGMENTS.has(value) || value.includes('.');
}


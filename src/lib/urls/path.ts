import { RESERVED_SEGMENTS } from '@/lib/country/reserved';

/**
 * The rules every public address follows.
 *
 * Pure functions with no database and no framework, shared by the registry,
 * the public resolver and the admin screens, so the path an editor is told is
 * valid in the browser is exactly the path the server accepts — and exactly
 * the key the database enforces uniqueness on.
 *
 * Two forms of a path appear throughout:
 *
 *  - a **path** is what visitors see and what is stored for display:
 *    `/ae/software/autocad-lt`;
 *  - a **key** is the same address normalised for comparison: lower case, no
 *    trailing slash, no empty segments, percent-encoding decoded. Two paths
 *    with the same key are the same address, so uniqueness is enforced on the
 *    key and "/AutoCAD/" can never be registered beside "/autocad".
 */

export const MAX_PATH_LENGTH = 300;
export const MAX_SEGMENT_LENGTH = 120;
export const MAX_SEGMENTS = 8;

/** Lower-case letters, digits and single inner hyphens: `autocad-lt`. */
const SEGMENT = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/** The placeholder a pattern's slug goes in. */
export const SLUG_TOKEN = '{slug}';

/** Whether one path segment follows the rules: lower-case letters, digits and single inner hyphens. */
export function isValidSegment(segment: string): boolean {
  return segment.length <= MAX_SEGMENT_LENGTH && SEGMENT.test(segment);
}

/** Characters a visitor can type that a URL path may not contain. */
const FORBIDDEN = /[\s?#%\\<>"'`^{}|[\]\u0000-\u001f\u007f]/;

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

/**
 * The comparison key for a request path or stored path, or null when the path
 * is not a valid address at all.
 *
 * Invalid means: a segment that is not valid percent-encoding, an encoded
 * separator (`%2F`, `%5C`), a control character, or a `.`/`..` segment. Those
 * are answered with a 404 rather than normalised into something else, so a
 * crafted URL can never be interpreted as a different, valid one.
 */
export function pathKey(input: string): string | null {
  const raw = input.split(/[?#]/)[0] ?? '';
  const segments: string[] = [];
  for (const part of raw.split('/')) {
    if (part === '') continue;
    let decoded: string;
    try {
      decoded = decodeURIComponent(part);
    } catch {
      return null;
    }
    if (decoded === '.' || decoded === '..') return null;
    if (/[/\\\u0000-\u001f\u007f]/.test(decoded)) return null;
    segments.push(decoded.toLowerCase());
  }
  const key = `/${segments.join('/')}`;
  return key.length > 2048 ? null : key;
}

/** The key of already-decoded segments, as the router hands them over. */
export function keyFromSegments(segments: readonly string[]): string | null {
  const parts: string[] = [];
  for (const segment of segments) {
    if (segment === '') continue;
    if (segment === '.' || segment === '..') return null;
    if (/[/\\\u0000-\u001f\u007f]/.test(segment)) return null;
    parts.push(segment.toLowerCase());
  }
  return `/${parts.join('/')}`;
}

/** Splits a path or key into its non-empty segments. */
export function segmentsOf(path: string): string[] {
  return (path.split(/[?#]/)[0] ?? '').split('/').filter(Boolean);
}

/**
 * A market prefix and a market-relative path, joined into a public path.
 *
 * ```
 * joinMarket('',   '/autocad')   === '/autocad'
 * joinMarket('ae', '/autocad')   === '/ae/autocad'
 * joinMarket('ae', '/')          === '/ae'
 * joinMarket('',   '')           === '/'
 * ```
 */
export function joinMarket(prefix: string, relative: string): string {
  const all = [...segmentsOf(prefix), ...segmentsOf(relative)];
  return all.length > 0 ? `/${all.join('/')}` : '/';
}

/** A public path with its market prefix removed. */
export function stripMarket(prefix: string, path: string): string {
  const segments = segmentsOf(path);
  if (prefix && segments[0]?.toLowerCase() === prefix.toLowerCase()) segments.shift();
  return segments.length > 0 ? `/${segments.join('/')}` : '/';
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type PathRules = {
  /** Every market prefix configured, root excluded. No path may start with one. */
  marketPrefixes: readonly string[];
};

export type PathCheck =
  | { ok: true; relative: string; notes: string[] }
  | { ok: false; error: string };

/**
 * First segments no content path may start with: the framework, the admin,
 * authentication, media, the sitemaps and every other system route.
 */
export function isReservedFirstSegment(segment: string, rules: PathRules): boolean {
  const value = segment.toLowerCase();
  return (
    RESERVED_SEGMENTS.has(value) ||
    value.includes('.') ||
    rules.marketPrefixes.some((prefix) => prefix.toLowerCase() === value)
  );
}

/**
 * Validates a market-relative path an editor typed, and returns it cleaned.
 *
 * Forgiving where the intent is unambiguous — surrounding slashes, doubled
 * slashes, capitals and spaces are tidied, and the notes say what changed —
 * and strict everywhere else: anything that is not letters, digits, hyphens
 * and slashes is refused with a message naming the problem, never silently
 * dropped, because a URL the editor did not write is not the URL they asked
 * for.
 */
export function checkRelativePath(input: string, rules: PathRules): PathCheck {
  const notes: string[] = [];
  let value = input.trim();

  if (!value || value === '/') {
    return { ok: false, error: 'Enter a path. The home page’s address cannot be changed.' };
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('//')) {
    return { ok: false, error: 'Enter a path on this site, not a full URL.' };
  }
  if (value.includes('\\')) {
    return { ok: false, error: 'Use forward slashes (/) between segments.' };
  }

  if (/\s/.test(value)) {
    value = value.replace(/\s+/g, '-');
    notes.push('Spaces were replaced with hyphens.');
  }
  if (value !== value.toLowerCase()) {
    value = value.toLowerCase();
    notes.push('Converted to lower case.');
  }

  const forbidden = value.match(FORBIDDEN);
  if (forbidden) {
    const shown = forbidden[0] === '%' ? '% (encoded characters)' : `“${forbidden[0]}”`;
    return { ok: false, error: `A path cannot contain ${shown}. Use letters, numbers and hyphens.` };
  }

  const segments = value.split('/').filter(Boolean);
  if (segments.length === 0) {
    return { ok: false, error: 'Enter a path. The home page’s address cannot be changed.' };
  }
  if (segments.length > MAX_SEGMENTS) {
    return { ok: false, error: `Use at most ${MAX_SEGMENTS} segments.` };
  }
  for (const segment of segments) {
    if (segment === '.' || segment === '..') {
      return { ok: false, error: 'A path cannot contain “.” or “..” segments.' };
    }
    if (segment.length > MAX_SEGMENT_LENGTH) {
      return { ok: false, error: `Each segment can be at most ${MAX_SEGMENT_LENGTH} characters.` };
    }
    if (!SEGMENT.test(segment)) {
      return {
        ok: false,
        error: `“${segment}” is not a valid segment. Use lower-case letters, numbers and hyphens, starting and ending with a letter or number.`,
      };
    }
  }

  const first = segments[0]!;
  if (isReservedFirstSegment(first, rules)) {
    return {
      ok: false,
      error: rules.marketPrefixes.includes(first)
        ? `“/${first}” is a market prefix and cannot start a path.`
        : `“/${first}” is reserved for the system and cannot start a path.`,
    };
  }

  const relative = `/${segments.join('/')}`;
  if (relative.length > MAX_PATH_LENGTH) {
    return { ok: false, error: `Keep the path under ${MAX_PATH_LENGTH} characters.` };
  }
  return { ok: true, relative, notes };
}

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

export type PatternCheck =
  | { ok: true; pattern: string }
  | { ok: false; error: string };

/**
 * Validates a URL pattern such as `/{slug}` or `/software/{slug}`.
 *
 * `{slug}` must be a whole segment and appear exactly once — except in a
 * pattern for something that has no slug (the blog archive), where it must not
 * appear at all. Every other segment follows the ordinary path rules, and the
 * first may not be reserved.
 */
export function checkPattern(
  input: string,
  rules: PathRules,
  { needsSlug }: { needsSlug: boolean },
): PatternCheck {
  let value = input.trim().toLowerCase().replace(/\s+/g, '');
  if (!value.startsWith('/')) value = `/${value}`;
  const segments = value.split('/').filter(Boolean);

  if (segments.length > 5) return { ok: false, error: 'Use at most five segments in a pattern.' };

  const slugCount = segments.filter((segment) => segment === SLUG_TOKEN).length;
  if (needsSlug && slugCount !== 1) {
    return {
      ok: false,
      error:
        value.includes('{') && slugCount === 0
          ? 'Write the placeholder exactly as {slug}, as a whole segment: /software/{slug}.'
          : 'Include {slug} exactly once, as a whole segment: /software/{slug}.',
    };
  }
  if (!needsSlug && value.includes('{')) {
    return { ok: false, error: 'This address has no slug, so the pattern is a plain path: /blog.' };
  }
  if (!needsSlug && segments.length === 0) {
    return { ok: false, error: 'The blog archive needs a path of its own, such as /blog.' };
  }

  for (const segment of segments) {
    if (segment === SLUG_TOKEN) continue;
    if (!SEGMENT.test(segment) || segment.length > MAX_SEGMENT_LENGTH) {
      return { ok: false, error: `“${segment}” is not a valid segment. Use lower-case letters, numbers and hyphens.` };
    }
  }
  const first = segments[0];
  if (first && first !== SLUG_TOKEN && isReservedFirstSegment(first, rules)) {
    return { ok: false, error: `“/${first}” is reserved and cannot start a pattern.` };
  }

  return { ok: true, pattern: segments.length > 0 ? `/${segments.join('/')}` : '/' };
}

/** A pattern with the slug filled in: `/software/{slug}` + `autocad` → `/software/autocad`. */
export function fillPattern(pattern: string, slug: string): string {
  const segments = segmentsOf(pattern).flatMap((segment) =>
    segment === SLUG_TOKEN ? segmentsOf(slug) : [segment],
  );
  return segments.length > 0 ? `/${segments.join('/')}` : '/';
}

// ---------------------------------------------------------------------------
// Redirect destinations and query strings
// ---------------------------------------------------------------------------

export function isExternalUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

export type DestinationCheck =
  | { ok: true; destination: string; external: boolean }
  | { ok: false; error: string };

/**
 * A manual redirect's destination: a path on this site, or an http(s) URL.
 *
 * Anything else — `javascript:`, `data:`, protocol-relative `//host`, bare
 * words — is refused. A path keeps its own query string and fragment.
 */
export function checkDestination(input: string): DestinationCheck {
  const value = input.trim();
  if (!value) return { ok: false, error: 'Enter where the redirect should go.' };
  if (/[\s\u0000-\u001f\u007f<>"`]/.test(value)) {
    return { ok: false, error: 'A destination cannot contain spaces or control characters.' };
  }
  if (isExternalUrl(value)) {
    try {
      const url = new URL(value);
      if (!url.hostname) return { ok: false, error: 'That URL has no host.' };
      return { ok: true, destination: url.toString(), external: true };
    } catch {
      return { ok: false, error: 'That is not a valid URL.' };
    }
  }
  if (value.startsWith('//')) {
    return { ok: false, error: 'Start an external URL with https://.' };
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
    return { ok: false, error: 'Only paths on this site and http(s) URLs are allowed.' };
  }
  const path = value.startsWith('/') ? value : `/${value}`;
  if (pathKey(path) === null) return { ok: false, error: 'That path is not valid.' };
  return { ok: true, destination: path, external: false };
}

/**
 * A destination split into its path and its own query string and fragment:
 * `/autocad?edition=lt#pricing` → `/autocad` + `?edition=lt#pricing`.
 *
 * A redirect to content is stored by the content's id, and its address is
 * looked up on every request; the suffix is what the editor wrote after the
 * path, kept apart so the content can move without losing it.
 */
export function splitDestinationSuffix(destination: string): { path: string; suffix: string | null } {
  const index = destination.search(/[?#]/);
  if (index < 0) return { path: destination, suffix: null };
  const suffix = destination.slice(index);
  return { path: destination.slice(0, index) || '/', suffix: suffix === '?' || suffix === '#' ? null : suffix };
}

/** A path with a stored suffix put back: `withSuffix('/autocad', '#pricing') === '/autocad#pricing'`. */
export function withSuffix(path: string, suffix: string | null | undefined): string {
  return suffix ? `${path}${suffix}` : path;
}

/** Query parameters that carry campaign attribution, forwarded even off-site. */
const ATTRIBUTION_PARAMS = /^(utm_[a-z_]+|gclid|gbraid|wbraid|fbclid|msclkid|dclid|ttclid|li_fat_id)$/i;

/**
 * The destination with the visitor's query string carried over.
 *
 * On this site every parameter is kept — a campaign link to an old address
 * must still arrive with its UTMs and whatever else the page reads. Off-site,
 * only attribution parameters are forwarded: anything else in the query string
 * was meant for this site and is not a third party's business.
 *
 * Parameters the destination already sets win, so a redirect written to add a
 * parameter is not overridden by a visitor's copy of it.
 */
export function withForwardedQuery(
  destination: string,
  incoming: URLSearchParams | Record<string, string | string[] | undefined>,
): string {
  const params =
    incoming instanceof URLSearchParams
      ? incoming
      : (() => {
          const built = new URLSearchParams();
          for (const [key, value] of Object.entries(incoming)) {
            if (value === undefined) continue;
            for (const item of Array.isArray(value) ? value : [value]) built.append(key, item);
          }
          return built;
        })();

  const external = isExternalUrl(destination);
  const hashIndex = destination.indexOf('#');
  const hash = hashIndex >= 0 ? destination.slice(hashIndex) : '';
  const withoutHash = hashIndex >= 0 ? destination.slice(0, hashIndex) : destination;
  const queryIndex = withoutHash.indexOf('?');
  const base = queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash;
  const merged = new URLSearchParams(queryIndex >= 0 ? withoutHash.slice(queryIndex + 1) : '');
  // Only the destination's own parameters win; a visitor's repeated ones
  // (`?tag=a&tag=b`) are all carried over.
  const own = new Set(merged.keys());

  for (const [key, value] of params) {
    // The router's own cache-busting parameter never belongs to a destination.
    if (key === '_rsc') continue;
    if (external && !ATTRIBUTION_PARAMS.test(key)) continue;
    if (own.has(key)) continue;
    merged.append(key, value);
  }

  const query = merged.toString();
  return `${base}${query ? `?${query}` : ''}${hash}`;
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

/**
 * A request path made safe to store and show: no query string (it can carry
 * tokens and personal data), no control characters, bounded length, and
 * normalised so repeated requests for one address land on one row.
 */
export function sanitiseLoggedPath(input: string): { path: string; key: string } | null {
  const raw = (input.split(/[?#]/)[0] ?? '').slice(0, 600);
  const key = pathKey(raw);
  if (!key || key.length > 500) return null;
  // Show the decoded path, which is what an editor will recognise.
  return { path: key, key };
}

/** A referrer reduced to origin and path, or null when it is not a URL. */
export function sanitiseReferrer(referrer: string | null | undefined): string | null {
  if (!referrer) return null;
  try {
    const url = new URL(referrer);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return `${url.origin}${url.pathname}`.slice(0, 300);
  } catch {
    return null;
  }
}

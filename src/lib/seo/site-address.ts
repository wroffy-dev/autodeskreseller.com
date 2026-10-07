/**
 * Is the site calling itself by the address it is actually served on?
 *
 * Every absolute URL the site emits — canonical, og:url, hreflang, the
 * sitemaps, robots.txt — is built from NEXT_PUBLIC_SITE_URL. When the domain
 * is moved, say the bare domain now redirects to www, and that setting is not
 * moved with it, every one of those URLs points at a redirect. The admin is
 * served from the real address, so comparing the two there catches it.
 */

/** The host a request was addressed to: the first X-Forwarded-Host a proxy set, or Host. */
export function requestHostFrom(forwardedHost: string | null, host: string | null): string | null {
  const raw = (forwardedHost || host || '').split(',')[0]?.trim().toLowerCase();
  return raw ? raw : null;
}

export type SiteAddressMismatch = {
  /** The configured site address, e.g. https://example.com */
  configured: string;
  /** The host the admin is open on, e.g. www.example.com */
  actual: string;
  /** What the setting should probably say instead. */
  suggested: string;
};

/**
 * The mismatch, or null when the two agree.
 *
 * Local and bare-IP addresses are ignored: a developer's machine or a
 * container's internal address says nothing about where the public site lives.
 */
export function siteAddressMismatch(siteUrl: string, requestHost: string | null): SiteAddressMismatch | null {
  if (!requestHost) return null;
  let configured: URL;
  try {
    configured = new URL(siteUrl);
  } catch {
    return null;
  }
  const hostname = requestHost.replace(/:\d+$/, '');
  if (hostname === 'localhost' || hostname === '[::1]' || /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return null;
  if (configured.host.toLowerCase() === requestHost) return null;
  return {
    configured: configured.origin,
    actual: requestHost,
    suggested: `${configured.protocol}//${requestHost}`,
  };
}

/**
 * Where a request on the site's other spelling belongs.
 *
 * Redirect rules match paths, never hosts, so "send https://example.com to
 * https://www.example.com" cannot be written as one. It does not need to be:
 * the site address in the environment already says which spelling is
 * canonical, and a request that arrives on its twin — the same domain with or
 * without `www.` — is sent there, same path, same query, with a permanent 308.
 *
 * Only that exact twin is redirected. Any other host (a container's internal
 * name, a health probe's IP, a preview domain) is left alone, so this can
 * never lock anybody out of the site.
 */
export function canonicalHostRedirect(
  siteUrl: string,
  requestHost: string | null,
  pathAndQuery: string,
): string | null {
  if (!requestHost) return null;
  let configured: URL;
  try {
    configured = new URL(siteUrl);
  } catch {
    return null;
  }
  const want = configured.hostname.toLowerCase();
  const got = requestHost.replace(/:\d+$/, '').toLowerCase();
  if (!want || got === want) return null;
  // A local or bare-IP site address has no public twin to speak of.
  if (want === 'localhost' || want.endsWith('.localhost') || /^[\d.]+$|^\[/.test(want)) return null;
  const twin = want.startsWith('www.') ? want.slice(4) : `www.${want}`;
  if (got !== twin) return null;
  return `${configured.origin}${pathAndQuery.startsWith('/') ? pathAndQuery : `/${pathAndQuery}`}`;
}

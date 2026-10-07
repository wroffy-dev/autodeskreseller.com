import 'server-only';
import { headers } from 'next/headers';
import { notFound, redirect, permanentRedirect } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import {
  redirectCandidates,
  redirectLookupPaths,
  isSelfRedirect,
} from '@/lib/seo/redirect-paths';
import { liveRoutePath, previousRouterAddressFor, previousRouterPath } from '@/lib/urls/live';
import { afterResponse, countRedirectHit, recordNotFound } from '@/lib/urls/health';
import type { UrlContentType } from '@/lib/urls/types';
import { withSuffix } from '@/lib/urls/path';
import type { CountryContext } from '@/lib/country/types';

/**
 * Redirects for the router that ran before the URL registry.
 *
 * While the registry is switched off, a surface that finds nothing to show
 * asks here, exactly as it always did. With the registry on, redirects are
 * resolved from the registry before anything renders (src/lib/urls/resolve.ts)
 * and this is only reached from that module's legacy path.
 */

/**
 * Resolves an active redirect for a path that produced nothing.
 *
 * The full request path is tried first, so a market can redirect
 * `/ae/old-plan` independently, and the market-relative path second, so a
 * redirect defined once still applies inside whichever market asked for it.
 * A rule that points at content by id goes to that content's current address,
 * and only while it is public. Loop protection: a redirect whose destination
 * equals its own source is ignored.
 */
export async function findRedirect(
  path: string,
  fallbackPath?: string,
): Promise<{ destination: string; permanent: boolean } | null> {
  const rule = await prisma.redirect.findFirst({
    where: { isActive: true, source: { in: redirectCandidates(path, fallbackPath) } },
    orderBy: { createdAt: 'desc' },
  });
  if (!rule) return null;

  let destination: string | null = rule.destination;
  let permanent = rule.type === 'PERMANENT';
  if (rule.targetEntityId && rule.targetCountryId && rule.targetType) {
    const type = rule.targetType as UrlContentType;
    // Where the content is served now — by the previous router, which is the
    // one answering whenever this module is reached.
    destination = await previousRouterPath(type, rule.targetEntityId, rule.targetCountryId);
    // Content the registry has moved lives here only until the registry is
    // switched back on, so the redirect is temporary for now: a permanent one
    // would be cached, and would outlive the rollback.
    const registered = await liveRoutePath(type, rule.targetEntityId, rule.targetCountryId);
    if (destination && registered && registered !== destination) permanent = false;
    if (destination) destination = withSuffix(destination, rule.destinationSuffix);
  }
  if (!destination || isSelfRedirect(rule.source, destination)) return null;

  // Best-effort hit counter; never block the redirect on it.
  const id = rule.id;
  afterResponse(() => countRedirectHit(id));

  return { destination, permanent };
}

/**
 * What a surface does when it has nothing to show: follow a redirect if one
 * was written for this address, and 404 otherwise.
 *
 * `path` is the market-relative address — `products/dropbox-standard`,
 * `blog/some-article`, or the page slug — and the market's own prefix is added
 * here, so one rule can be written for every market or for one of them.
 *
 * Never returns: it either redirects or raises the not-found response, and a
 * 404 is recorded for URL Health.
 */
export async function redirectOrNotFound(
  country: Pick<CountryContext, 'slug' | 'id'>,
  path: string,
): Promise<never> {
  const { full, relative } = redirectLookupPaths(country, path);
  const target = await findRedirect(full, relative);

  if (target) {
    if (target.permanent) permanentRedirect(target.destination);
    redirect(target.destination);
  }

  // An address the registry gave out before it was switched off.
  const previous = await previousRouterAddressFor(full);
  if (previous) redirect(previous);

  let from: string | null = null;
  try {
    from = (await headers()).get('referer');
  } catch {
    from = null;
  }
  afterResponse(() => recordNotFound(full, { countryId: country.id, referrer: from }));
  return notFound();
}

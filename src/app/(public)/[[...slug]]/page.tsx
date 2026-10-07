import type { Metadata } from 'next';
import {
  PublicRoute,
  pathFromSegments,
  publicRouteMetadata,
  type RouteSearchParams,
} from '../_surfaces/public-route';

// The root layout reads the visitor's tracking-consent cookie, so nothing under
// it can be rendered statically. Declaring `revalidate` here made Next try
// anyway and every request failed with DYNAMIC_SERVER_USAGE.
export const dynamic = 'force-dynamic';

type Params = Promise<{ slug?: string[] }>;
type Search = Promise<RouteSearchParams>;

/**
 * The public catch-all, for every market.
 *
 * Every address that is not a system route arrives here or at one of the
 * literal `/products` and `/blog` routes, and all of them ask the URL
 * registry what the address is: a page, a product, an article, a category, a
 * tag, the blog archive — in which market — or a redirect, which is answered
 * with a real 308/307 before anything renders. While the registry is switched
 * off, the routing rules from before it apply unchanged.
 *
 * Adding Qatar needs nothing here: a `Country` row with slug `qa` and content
 * registered under `/qa` is enough.
 */
export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Search;
}): Promise<Metadata> {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  return publicRouteMetadata(pathFromSegments(slug), query);
}

export default async function PublicCatchAll({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Search;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  return <PublicRoute path={pathFromSegments(slug)} query={query} />;
}

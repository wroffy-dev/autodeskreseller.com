import type { Metadata } from 'next';
import {
  PublicRoute,
  pathFromSegments,
  publicRouteMetadata,
  type RouteSearchParams,
} from '../../_surfaces/public-route';

// The root layout reads the visitor's tracking-consent cookie, so nothing under
// it can be rendered statically. Declaring `revalidate` here made Next try
// anyway and every request failed with DYNAMIC_SERVER_USAGE.
export const dynamic = 'force-dynamic';

type Params = Promise<{ slug: string }>;
type Search = Promise<RouteSearchParams>;

/**
 * `/products/<slug>` — a literal route Next.js matches before the catch-all.
 *
 * It declares the URL shape and nothing else: the address is resolved through
 * the URL registry like any other, so it serves the product only while the
 * product lives here, and redirects (308) once the product has moved — to
 * `/autocad`, say, after the pattern changes.
 */
export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Search;
}): Promise<Metadata> {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  return publicRouteMetadata(pathFromSegments(['products', slug]), query);
}

export default async function ProductPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  return <PublicRoute path={pathFromSegments(['products', slug])} query={query} />;
}

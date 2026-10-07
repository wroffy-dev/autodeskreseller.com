import type { Metadata } from 'next';
import {
  PublicRoute,
  pathFromSegments,
  publicRouteMetadata,
  type RouteSearchParams,
} from '../../../_surfaces/public-route';

// The root layout reads the visitor's tracking-consent cookie, so nothing under
// it can be rendered statically. Declaring `revalidate` here made Next try
// anyway and every request failed with DYNAMIC_SERVER_USAGE.
export const dynamic = 'force-dynamic';

type Params = Promise<{ slug: string }>;
type Search = Promise<RouteSearchParams>;

/** `/blog/tag/<slug>`, resolved through the URL registry. */
export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Search;
}): Promise<Metadata> {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  return publicRouteMetadata(pathFromSegments(['blog', 'tag', slug]), query);
}

export default async function BlogTagPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  return <PublicRoute path={pathFromSegments(['blog', 'tag', slug])} query={query} />;
}

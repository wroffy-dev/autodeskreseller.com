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

type Search = Promise<RouteSearchParams>;

/**
 * `/blog` — the archive's address by default. Resolved through the URL
 * registry, so a blog moved to `/insights` is redirected from here.
 */
export async function generateMetadata({ searchParams }: { searchParams: Search }): Promise<Metadata> {
  return publicRouteMetadata('/blog', await searchParams);
}

export default async function BlogIndex({ searchParams }: { searchParams: Search }) {
  return <PublicRoute path="/blog" query={await searchParams} />;
}

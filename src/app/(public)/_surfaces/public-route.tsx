import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { resolvePublic, searchString, type PublicTarget } from '@/lib/urls/resolve';
import { cmsPageMetadata, CmsPageSurface } from './cms-page';
import { productMetadata, ProductSurface } from './product';
import {
  blogArchiveMetadata,
  BlogArchiveSurface,
  blogPostMetadata,
  BlogPostSurface,
  blogCategoryMetadata,
  BlogCategorySurface,
  blogTagMetadata,
  BlogTagSurface,
  type BlogSearchParams,
} from './blog';

/**
 * The one way a public address is rendered.
 *
 * The catch-all and the concrete `/products` and `/blog` routes all end up
 * here with the path they received, so which route file Next.js happened to
 * match never changes what an address means: `/products/autocad` is resolved
 * through the registry exactly like `/autocad` — and, once the product has
 * moved, redirected from here before anything renders.
 */

export type RouteSearchParams = Record<string, string | string[] | undefined>;

/**
 * The request path from the router's decoded segments, or a 404 when a
 * segment smuggles a separator (`%2F`) or a control character — a crafted URL
 * is never read as a different, valid one.
 */
export function pathFromSegments(segments: readonly string[] | undefined): string {
  const parts = segments ?? [];
  if (parts.some((part) => /[/\\\u0000-\u001f\u007f]/.test(part) || part === '.' || part === '..')) {
    notFound();
  }
  return `/${parts.join('/')}`;
}

function blogParams(query: RouteSearchParams): BlogSearchParams {
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  return { page: first(query.page), q: first(query.q), tag: first(query.tag) };
}

async function target(path: string, query: RouteSearchParams): Promise<PublicTarget> {
  return resolvePublic(path, searchString(query));
}

export async function publicRouteMetadata(path: string, query: RouteSearchParams): Promise<Metadata> {
  const resolved = await target(path, query);
  switch (resolved.kind) {
    case 'blog':
      return blogArchiveMetadata(resolved, blogParams(query));
    case 'post':
      return blogPostMetadata(resolved);
    case 'category':
      return blogCategoryMetadata(resolved, blogParams(query));
    case 'tag':
      return blogTagMetadata(resolved, blogParams(query));
    case 'product':
      return productMetadata(resolved);
    case 'page':
      return cmsPageMetadata(resolved);
  }
}

export async function PublicRoute({ path, query }: { path: string; query: RouteSearchParams }) {
  const resolved = await target(path, query);
  switch (resolved.kind) {
    case 'blog':
      return <BlogArchiveSurface target={resolved} searchParams={blogParams(query)} />;
    case 'post':
      return <BlogPostSurface target={resolved} />;
    case 'category':
      return <BlogCategorySurface target={resolved} searchParams={blogParams(query)} />;
    case 'tag':
      return <BlogTagSurface target={resolved} searchParams={blogParams(query)} />;
    case 'product':
      return <ProductSurface target={resolved} />;
    case 'page':
      return <CmsPageSurface target={resolved} />;
  }
}

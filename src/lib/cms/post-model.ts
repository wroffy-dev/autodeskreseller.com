import { DEFAULT_POST_OPTIONS, type BlogPostOptions } from './blog-settings';

/**
 * Blog post shape shared by the editor and the routes that render it.
 *
 * This lives outside the `'use client'` component on purpose. Exporting a value
 * from a client module and then spreading it on the server hands back a client
 * *reference*, not the object — so `{ ...EMPTY_POST }` produced a value with no
 * `tags` or `relatedIds`, and the editor threw on `.includes` before the page
 * could render. Same failure the "New form" route had; same fix.
 */

export type PostFormValues = {
  id?: string;
  title: string;
  slug: string;
  subtitle: string;
  status: string;
  publishedAt: string;
  excerpt: string;
  content: string;
  isFeatured: boolean;
  featuredPriority: number;
  featuredImageId: string | null;
  thumbnailId: string | null;
  categoryId: string;
  authorId: string;
  tags: string[];
  relatedIds: string[];
  /** Per-post display overrides, sidebar choice and form selections. */
  options: BlogPostOptions;
  sidebarMode: 'GLOBAL' | 'CUSTOM' | 'NONE';
  seoTitle: string;
  seoDescription: string;
  /** The first replaces the old single focus keyword. */
  primaryKeyword1: string;
  primaryKeyword2: string;
  primaryKeyword3: string;
  canonicalUrl: string;
  noIndex: boolean;
  noFollow: boolean;
  ogTitle: string;
  ogDescription: string;
  ogImageId: string | null;
  twitterImageId: string | null;
};

export const EMPTY_POST: PostFormValues = {
  title: '',
  slug: '',
  subtitle: '',
  status: 'DRAFT',
  publishedAt: '',
  excerpt: '',
  content: '',
  isFeatured: false,
  featuredPriority: 0,
  featuredImageId: null,
  thumbnailId: null,
  categoryId: '',
  authorId: '',
  tags: [],
  relatedIds: [],
  options: DEFAULT_POST_OPTIONS,
  sidebarMode: 'GLOBAL',
  seoTitle: '',
  seoDescription: '',
  primaryKeyword1: '',
  primaryKeyword2: '',
  primaryKeyword3: '',
  canonicalUrl: '',
  noIndex: false,
  noFollow: false,
  ogTitle: '',
  ogDescription: '',
  ogImageId: null,
  twitterImageId: null,
};

import type { BlogListItem, BlogPostDetail, BlogCategoryItem, BlogTagItem } from '@/lib/services/blog';
import { blogArchiveHref, blogCategoryHref, blogTagHref, postHref } from '@/lib/urls/links';
import type { CountryContext } from '@/lib/country/types';
import type { ResolvedBlogSettings, BlogCardSettings } from './blog-settings';
import type { TocItem } from './blog-toc';
import type { CardOverrides } from './blog-blocks';

/**
 * Everything a blog block needs that is not its own content.
 *
 * The route resolves this once — settings, the archive query, the article being
 * read, the table of contents — and every block reads from it. Blocks never
 * query for the page they are on, which is what lets the same `blogGrid` block
 * work on the archive, a category archive and an article page.
 */

export type BlogArchiveContext = {
  /** `/blog`, `/blog/category/x` or `/blog/tag/y`. Pagination links hang off it. */
  basePath: string;
  query: string;
  categorySlug: string | null;
  tagSlug: string | null;
  page: number;
  pages: number;
  total: number;
  /** The already-executed result for the page's main grid. */
  posts: BlogListItem[];
  /** Query values to preserve across pagination links. */
  searchParams: Record<string, string | undefined>;
  categories: BlogCategoryItem[];
  tags: BlogTagItem[];
};

export type BlogArticleContext = {
  post: BlogPostDetail;
  /** Body HTML with heading anchors stamped in. */
  html: string;
  toc: TocItem[];
  shareUrl: string;
  /** Resolved per-post display decisions, already merged with the defaults. */
  visible: Record<string, boolean>;
  forms: { cta: string; sidebar: string; bottom: string };
};

export type SiteSocials = {
  siteName: string;
  linkedinUrl: string | null;
  twitterUrl: string | null;
  facebookUrl: string | null;
  instagramUrl: string | null;
  youtubeUrl: string | null;
};

export type BlogRenderContext = {
  /** The market this blog surface is being rendered for. */
  country: CountryContext;
  settings: ResolvedBlogSettings;
  archive: BlogArchiveContext | null;
  article: BlogArticleContext | null;
  socials: SiteSocials;
};

/**
 * Applies a section's card overrides on top of the blog-wide card settings.
 *
 * `inherit` is the default everywhere, so a section only differs from the rest
 * of the blog where an administrator deliberately made it differ.
 */
export function resolveCard(
  card: BlogCardSettings,
  overrides?: Partial<CardOverrides>,
): BlogCardSettings {
  if (!overrides) return card;

  const apply = (value: string | undefined, fallback: boolean): boolean =>
    value === 'show' ? true : value === 'hide' ? false : fallback;

  return {
    ...card,
    showImage: apply(overrides.cardImage, card.showImage),
    showCategory: apply(overrides.cardCategory, card.showCategory),
    showExcerpt: apply(overrides.cardExcerpt, card.showExcerpt),
    showAuthor: apply(overrides.cardAuthor, card.showAuthor),
    showDate: apply(overrides.cardDate, card.showDate),
    showReadTime: apply(overrides.cardReadTime, card.showReadTime),
    showTags: apply(overrides.cardTags, card.showTags),
    showCta: apply(overrides.cardCta, card.showCta),
  };
}

/**
 * Where the blog's URLs live.
 *
 * The blog is root-only, so every market links to the one root address of an
 * article, category or tag — never to a prefixed copy that would only
 * redirect. The address comes from the URL registry by the content's id, so a
 * blog moved to `/insights` or an article given a custom URL is linked
 * correctly everywhere at once.
 */
type BlogRef = { id: string; slug: string };

export const blogPath = () => blogArchiveHref();
export const categoryPath = (category: BlogRef) => blogCategoryHref(category);
export const tagPath = (tag: BlogRef) => blogTagHref(tag);
export const postPath = (post: BlogRef) => postHref(post);

import { getBlogSections, getBlogSettings, getSidebarForPost } from '@/lib/services/blog-cms';
import { getWebsiteSettings } from '@/lib/services/settings';
import type { BlogPostDetail } from '@/lib/services/blog';
import { buildTableOfContents } from '@/lib/cms/blog-toc';
import { parsePostOptions, resolveToggle, POST_TOGGLES } from '@/lib/cms/blog-settings';
import { postPath, type BlogRenderContext } from '@/lib/cms/blog-render';
import { sanitizeHtml } from '@/lib/utils/sanitize';
import { absoluteUrl } from '@/lib/seo/metadata';
import { localiseHtml } from '@/lib/country/routing';
import type { CountryContext } from '@/lib/country/types';
import { SectionList, type RenderableSection } from '@/components/cms/section-renderer';
import { BlogSidebar } from '@/components/cms/blog-sidebar';
import { BlogRoot } from './blog-root';
import { cn } from '@/lib/utils/cn';

/**
 * The single article page.
 *
 * The article's parts are CMS sections in a stored order, and the sidebar is a
 * stored widget list, so both the anatomy and the arrangement are the admin's
 * to change. What stays in code is the two-column relationship between them —
 * including the rule that the sidebar keeps its own scroll behaviour on desktop
 * and moves to a configurable position on mobile.
 */

/** Sections from here on sit below the sidebar on desktop's second row. */
const TAIL_BLOCKS = new Set(['articleRelated', 'articlePrevNext']);

export async function BlogArticle({
  post,
  country,
}: {
  post: BlogPostDetail;
  /** The market the article belongs to; every link it renders stays inside it. */
  country: CountryContext;
}) {
  const [sections, settings, site] = await Promise.all([
    getBlogSections('ARTICLE'),
    getBlogSettings(),
    getWebsiteSettings(),
  ]);

  const widgets = settings.layout.sidebarEnabled
    ? await getSidebarForPost({ id: post.id, sidebarMode: post.sidebarMode })
    : [];

  const options = parsePostOptions(post.options);

  // Blog-wide defaults, then the post's own three-state overrides on top.
  const defaults: Record<(typeof POST_TOGGLES)[number], boolean> = {
    showBreadcrumb: true,
    showCategory: true,
    showAuthor: true,
    showAuthorBox: settings.layout.authorBoxEnabled,
    showDate: true,
    showUpdatedDate: true,
    showReadTime: true,
    showTags: true,
    showShare: settings.share.enabled,
    showToc: settings.layout.tocEnabled,
    showRelated: settings.layout.relatedEnabled,
    showPrevNext: settings.layout.prevNextEnabled,
  };

  const visible = Object.fromEntries(
    POST_TOGGLES.map((key) => [key, resolveToggle(options[key], defaults[key])]),
  ) as Record<string, boolean>;

  // Internal links an author typed into the body resolve inside this market.
  const body = localiseHtml(sanitizeHtml(post.content), country);
  const { html, items } = buildTableOfContents(body, { includeH3: true });

  const blog: BlogRenderContext = {
    country,
    settings,
    archive: null,
    article: {
      post,
      html,
      toc: items,
      // The article's one address, from the URL registry — root-only.
      shareUrl: absoluteUrl(postPath(post)),
      visible,
      forms: {
        cta: options.ctaFormSlug,
        sidebar: options.sidebarFormSlug,
        bottom: options.bottomFormSlug,
      },
    },
    socials: {
      siteName: site.siteName,
      linkedinUrl: site.linkedinUrl,
      twitterUrl: site.twitterUrl,
      facebookUrl: site.facebookUrl,
      instagramUrl: site.instagramUrl,
      youtubeUrl: site.youtubeUrl,
    },
  };

  const ordered = sections
    .filter((section) => section.isVisible)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const splitAt = ordered.findIndex((section) => TAIL_BLOCKS.has(section.blockType));
  const top: RenderableSection[] = splitAt === -1 ? ordered : ordered.slice(0, splitAt);
  const bottom: RenderableSection[] = splitAt === -1 ? [] : ordered.slice(splitAt);

  const hasSidebar = widgets.some((widget) => widget.isVisible);
  const mobile = settings.layout.mobileSidebar;

  return (
    <BlogRoot settings={settings}>
      <div className="mx-auto w-full max-w-[var(--layout-container)] px-4 py-10 sm:px-6 sm:py-14">
        <div
          className={cn(
            'blog-layout',
            !hasSidebar && 'blog-layout--no-sidebar',
            hasSidebar && settings.layout.sidebarPosition === 'left' && 'blog-layout--left',
            hasSidebar && mobile === 'aboveRelated' && 'blog-layout--aside-above-bottom',
            hasSidebar && mobile === 'hidden' && 'blog-layout--aside-hidden',
          )}
          style={
            settings.layout.articleWidth
              ? ({ '--blog-article-width': settings.layout.articleWidth } as React.CSSProperties)
              : undefined
          }
        >
          <div className="blog-layout__top cms-article-column">
            <SectionList sections={top} blog={blog} container={false} allowFirst={false} />
          </div>

          {bottom.length > 0 ? (
            <div className="blog-layout__bottom cms-article-column">
              <SectionList sections={bottom} blog={blog} container={false} allowFirst={false} />
            </div>
          ) : null}

          {hasSidebar ? (
            <BlogSidebar
              widgets={widgets}
              blog={blog}
              className={cn(
                'blog-layout__aside',
                settings.layout.sidebarSticky && 'blog-layout__aside--sticky',
              )}
            />
          ) : null}
        </div>
      </div>
    </BlogRoot>
  );
}

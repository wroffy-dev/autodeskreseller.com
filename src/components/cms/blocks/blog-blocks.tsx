import Link from 'next/link';
import Image from 'next/image';
import { ChevronRight, ArrowLeft, ArrowRight } from 'lucide-react';
import type {
  BlogHeroContent,
  BlogBreadcrumbContent,
  BlogCategoryFilterContent,
  BlogSearchContent,
  BlogFeaturedContent,
  BlogGridContent,
  BlogPaginationContent,
  BlogNewsletterContent,
  DividerContent,
  SpacerContent,
  ArticleHeaderContent,
  ArticleImageContent,
  ArticleTocContent,
  ArticleContentContent,
  ArticleShareContent,
  ArticleTagsContent,
  ArticleAuthorContent,
  ArticleRelatedContent,
  ArticlePrevNextContent,
  PostSource,
} from '@/lib/cms/blog-blocks';
import {
  resolveCard,
  blogPath,
  categoryPath,
  tagPath,
  postPath,
  type BlogRenderContext,
} from '@/lib/cms/blog-render';
import { countryPath } from '@/lib/country/routing';
import type { CountryContext } from '@/lib/country/types';
import { cardVars, enabledNetworks, RATIO_CSS } from '@/lib/cms/blog-settings';
import { buildPanelStyles } from '@/lib/cms/design';
import {
  resolvePostSource,
  getAdjacentPosts,
  getBlogCategories,
  type BlogListItem,
} from '@/lib/services/blog';
import { getMedia } from '@/lib/services/media';
import { getPublicForm, getDefaultForm } from '@/lib/services/forms';
import { PublicFormRenderer } from '@/components/forms/public-form';
import { PostCard } from '@/components/blog/post-card';
import { CategoryChips } from '@/components/blog/category-chips';
import { BlogSearch } from '@/components/blog/blog-search';
import { TableOfContents } from '@/components/blog/table-of-contents';
import { ShareButtons } from '@/components/blog/share-buttons';
import { AuthorBox } from '@/components/blog/author-box';
import { Pagination } from '@/components/blog/pagination';
import { EmptyState } from '@/components/ui/states';
import { formatDate, initials } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';
import { SectionHeading, CtaLink, type BlockContext } from './shared';

/**
 * Blog block renderers.
 *
 * Each one reads its own validated content plus the blog context the route
 * resolved, and nothing else. They are ordinary server components: the only
 * client code on a blog page is the search field, the table of contents and the
 * copy-link button, which is what keeps an article page close to zero
 * JavaScript.
 */

type Ctx = BlockContext & { blog?: BlogRenderContext };

/** Every blog block needs the context; without it the surface is misconfigured. */
function blogOf(ctx: Ctx): BlogRenderContext | null {
  return ctx.blog ?? null;
}

function Heading({
  content,
  ctx,
  as,
}: {
  content: { showHeading: boolean; eyebrow: string; heading: string; description: string; align: 'left' | 'center' | 'right' };
  ctx: Ctx;
  as?: 'h1' | 'h2' | 'h3';
}) {
  if (!content.showHeading) return null;
  return (
    <SectionHeading
      eyebrow={content.eyebrow}
      heading={content.heading}
      description={content.description}
      align={content.align}
      inverted={ctx.inverted}
      as={as ?? (ctx.isFirst ? 'h1' : 'h2')}
      className={content.align === 'left' ? 'max-w-3xl' : undefined}
    />
  );
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

export async function BlogHeroBlock({ content, ctx }: { content: BlogHeroContent; ctx: Ctx }) {
  const blog = blogOf(ctx);
  const image = content.imagePlacement !== 'none' ? await getMedia(content.imageId) : null;
  const total = blog?.archive?.total ?? 0;

  const copy = (
    <div className={cn('min-w-0', content.contentAlign === 'center' && 'text-center')}>
      {content.showBreadcrumb ? (
        <Breadcrumb
          items={[{ label: 'Home', href: countryPath(ctx.country) }, { label: 'Blog' }]}
          inverted={ctx.inverted}
          className="mb-5"
        />
      ) : null}

      {content.showSubtitle && content.subtitle ? (
        <p
          className={cn(
            'mb-3 text-xs font-semibold uppercase tracking-[0.14em]',
            ctx.inverted ? 'text-white/70' : 'cms-accent',
          )}
        >
          {content.subtitle}
        </p>
      ) : null}

      {content.showHeading && content.heading ? (
        <h1
          className={cn(
            'blog-hero__heading font-heading tracking-tight',
            ctx.inverted ? 'text-white' : 'text-content',
          )}
        >
          {content.heading}
        </h1>
      ) : null}

      {content.showDescription && content.description ? (
        <p
          className={cn(
            'mt-4 max-w-2xl text-base leading-relaxed sm:text-lg',
            content.contentAlign === 'center' && 'mx-auto',
            ctx.inverted ? 'text-white/80' : 'text-muted',
          )}
        >
          {content.description}
        </p>
      ) : null}

      {content.showPostCount && total > 0 ? (
        <p className={cn('mt-4 text-sm', ctx.inverted ? 'text-white/70' : 'text-muted')}>
          {total} {content.postCountLabel || 'articles'}
        </p>
      ) : null}

      {content.showCta ? (
        <div
          className={cn(
            'mt-7 flex flex-wrap gap-3',
            content.contentAlign === 'center' && 'justify-center',
          )}
        >
          <CtaLink
            label={content.ctaLabel}
            url={content.ctaUrl}
            variant={ctx.inverted ? 'outline' : 'primary'}
          />
          <CtaLink
            label={content.secondaryCtaLabel}
            url={content.secondaryCtaUrl}
            variant={ctx.inverted ? 'ghost' : 'outline'}
          />
        </div>
      ) : null}
    </div>
  );

  const picture = image ? (
    <Image
      src={image.url}
      alt={content.imageAlt || image.altText || ''}
      width={image.width ?? 720}
      height={image.height ?? 520}
      priority
      sizes="(max-width: 1024px) 100vw, 45vw"
      className="h-auto w-full object-cover"
      style={{ borderRadius: content.imageRadius || '1rem' }}
    />
  ) : null;

  const side = content.imagePlacement === 'left' || content.imagePlacement === 'right';

  return (
    <div
      className={cn('flex flex-col justify-center gap-10', side && 'lg:flex-row lg:items-center')}
      style={content.minHeight ? { minHeight: content.minHeight } : undefined}
    >
      {side && content.imagePlacement === 'left' && picture ? (
        <div className="min-w-0 lg:w-[45%]">{picture}</div>
      ) : null}
      <div className={cn('min-w-0', side && 'lg:flex-1')}>{copy}</div>
      {side && content.imagePlacement === 'right' && picture ? (
        <div className="min-w-0 lg:w-[45%]">{picture}</div>
      ) : null}
      {content.imagePlacement === 'below' && picture ? <div>{picture}</div> : null}
    </div>
  );
}

function Breadcrumb({
  items,
  inverted,
  className,
}: {
  items: Array<{ label: string; href?: string }>;
  inverted?: boolean;
  className?: string;
}) {
  return (
    <nav aria-label="Breadcrumb" className={className}>
      <ol
        className={cn(
          'flex flex-wrap items-center gap-1.5 text-xs',
          inverted ? 'text-white/70' : 'text-muted',
        )}
      >
        {items.map((item, index) => (
          <li key={`${item.label}-${index}`} className="flex items-center gap-1.5">
            {index > 0 ? <ChevronRight className="h-3 w-3" aria-hidden="true" /> : null}
            {item.href ? (
              <Link href={item.href} className="hover:text-brand">
                {item.label}
              </Link>
            ) : (
              <span aria-current="page">{item.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function BlogBreadcrumbBlock({
  content,
  ctx,
}: {
  content: BlogBreadcrumbContent;
  ctx: Ctx;
}) {
  const blog = blogOf(ctx);
  const items: Array<{ label: string; href?: string }> = [];
  const home = countryPath(ctx.country);
  const archiveHref = blogPath();
  if (content.showHome) items.push({ label: content.homeLabel || 'Home', href: home });

  const archive = blog?.archive;
  const onSubArchive = Boolean(archive && archive.basePath !== archiveHref);
  items.push({ label: content.blogLabel || 'Blog', ...(onSubArchive ? { href: archiveHref } : {}) });

  if (archive?.categorySlug) {
    const category = archive.categories.find((c) => c.slug === archive.categorySlug);
    if (category) items.push({ label: category.name });
  } else if (archive?.tagSlug) {
    const tag = archive.tags.find((t) => t.slug === archive.tagSlug);
    items.push({ label: tag ? `#${tag.name}` : `#${archive.tagSlug}` });
  }

  return <Breadcrumb items={items} inverted={ctx.inverted} />;
}

export async function BlogCategoryFilterBlock({
  content,
  ctx,
}: {
  content: BlogCategoryFilterContent;
  ctx: Ctx;
}) {
  const blog = blogOf(ctx);
  const all = blog?.archive?.categories ?? (await getBlogCategories(ctx.country.id));

  let categories = content.includeChildren ? all : all.filter((c) => !c.parentId);
  if (content.source === 'selected' && content.categoryIds.length > 0) {
    const wanted = new Set(content.categoryIds);
    categories = content.categoryIds
      .map((id) => all.find((c) => c.id === id))
      .filter((c): c is NonNullable<typeof c> => Boolean(c) && wanted.has(c!.id));
  }
  if (!content.showEmpty) categories = categories.filter((category) => category.count > 0);

  const chips = (
    <CategoryChips
      categories={categories}
      country={ctx.country}
      activeSlug={blog?.archive?.categorySlug ?? null}
      showAll={content.showAll}
      allLabel={content.allLabel}
      showCounts={content.showCounts}
      style={content.style}
    />
  );

  return (
    <div className="space-y-5">
      <Heading content={content} ctx={ctx} />
      {categories.length === 0 && !content.showAll ? null : content.showSearch ? (
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 lg:flex-1">{chips}</div>
          <div className="w-full lg:w-72">
            <BlogSearch
              action={blogPath()}
              placeholder={content.searchPlaceholder}
              showButton={false}
              compact
            />
          </div>
        </div>
      ) : (
        chips
      )}
    </div>
  );
}

export function BlogSearchBlock({ content, ctx }: { content: BlogSearchContent; ctx: Ctx }) {
  return (
    <div
      className={cn(
        'space-y-5',
        content.align === 'center' && 'text-center',
        content.align === 'right' && 'text-right',
      )}
    >
      <Heading content={content} ctx={ctx} />
      <div
        className={cn(
          content.layout === 'wide' ? 'w-full' : 'max-w-xl',
          content.align === 'center' && 'mx-auto',
          content.align === 'right' && 'ml-auto',
        )}
      >
        <BlogSearch
          action={blogPath()}
          placeholder={content.placeholder}
          buttonLabel={content.buttonLabel}
          showButton={content.showButton}
          layout={content.layout}
          maxWidth={content.maxWidth || undefined}
        />
      </div>
    </div>
  );
}

export async function BlogFeaturedBlock({
  content,
  ctx,
}: {
  content: BlogFeaturedContent;
  ctx: Ctx;
}) {
  const blog = blogOf(ctx);
  if (!blog) return null;

  // A hand-picked article always wins; the automatic pick is the fallback.
  const manual =
    content.selection === 'manual' && content.postId
      ? await resolvePostSource(
          ctx.country.id,
          { ...emptySource(), source: 'manual', postIds: [content.postId], limit: 1 },
          {},
        )
      : [];

  const auto =
    manual.length > 0
      ? []
      : await resolvePostSource(ctx.country.id, { ...emptySource(), source: 'featured', limit: 1 }, {});

  const post = manual[0] ?? auto[0] ?? null;

  if (!post) {
    return content.emptyText ? (
      <EmptyState title={content.emptyText} />
    ) : null;
  }

  const panelImage =
    content.panel.background.type === 'image' && content.panel.background.imageId
      ? await getMedia(content.panel.background.imageId)
      : null;
  const panel = buildPanelStyles(content.panel, panelImage?.url ?? null);

  const image = post.featuredImage ?? post.thumbnail;
  const href = postPath(post);
  const ratio = RATIO_CSS[content.imageRatio];

  const media = (
    <Link href={href} className="blog-featured__media block overflow-hidden" tabIndex={-1} aria-hidden="true">
      {image ? (
        <Image
          src={image.url}
          alt=""
          width={image.width ?? 1200}
          height={image.height ?? 800}
          priority
          sizes="(max-width: 1024px) 100vw, 55vw"
          className="h-full w-full object-cover"
          style={{ aspectRatio: ratio }}
        />
      ) : (
        <span
          className="block h-full w-full bg-gradient-to-br from-brand/20 via-brand/5 to-transparent"
          style={{ aspectRatio: ratio ?? '4 / 3' }}
        />
      )}
    </Link>
  );

  const body = (
    <div className="flex min-w-0 flex-col justify-center">
      <div className="flex flex-wrap items-center gap-2">
        {content.showBadge && content.badgeLabel ? (
          <span className="blog-featured__badge">{content.badgeLabel}</span>
        ) : null}
        {content.showCategory && post.category ? (
          <Link href={categoryPath(post.category)} className="blog-card__category">
            {post.category.name}
          </Link>
        ) : null}
      </div>

      <h3 className="blog-featured__title mt-4">
        <Link href={href}>{post.title}</Link>
      </h3>

      {content.showExcerpt && post.excerpt ? (
        <p className="blog-featured__excerpt mt-3">{post.excerpt}</p>
      ) : null}

      {content.showTags && post.tags.length > 0 ? (
        <ul className="mt-4 flex flex-wrap gap-1.5">
          {post.tags.slice(0, 5).map(({ tag }) => (
            <li key={tag.slug}>
              <Link href={tagPath(tag)} className="blog-card__tag">
                {tag.name}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      <PostByline
        post={post}
        showAuthor={content.showAuthor}
        showAuthorImage={content.showAuthorImage}
        showDate={content.showDate}
        showReadTime={content.showReadTime}
        className="mt-6"
      />

      {content.showCta ? (
        <div className="mt-6">
          <CtaLink label={content.ctaLabel} url={href} variant="primary" size="md" />
        </div>
      ) : null}
    </div>
  );

  const overlay = content.layout === 'overlay';

  return (
    <div className="space-y-6">
      <Heading content={content} ctx={ctx} />

      <div
        className={cn(
          'blog-featured relative overflow-hidden',
          !panel.style.borderRadius && 'rounded-2xl',
          overlay
            ? 'grid'
            : content.layout === 'stacked'
              ? 'grid gap-6'
              : 'grid gap-8 lg:grid-cols-2 lg:gap-10',
          content.layout === 'imageRight' && 'lg:[&>*:first-child]:order-2',
        )}
        style={panel.style}
      >
        {overlay ? (
          <div className="relative">
            {media}
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent"
            />
            <div className="blog-featured--overlay absolute inset-x-0 bottom-0 p-6 sm:p-10">{body}</div>
          </div>
        ) : (
          <>
            {media}
            <div className="p-0 lg:py-2">{body}</div>
          </>
        )}
      </div>
    </div>
  );
}

/** Shared author / date / read-time row. */
function PostByline({
  post,
  showAuthor,
  showAuthorImage,
  showDate,
  showReadTime,
  showUpdated,
  updatedLabel,
  className,
}: {
  post: BlogListItem;
  showAuthor?: boolean;
  showAuthorImage?: boolean;
  showDate?: boolean;
  showReadTime?: boolean;
  showUpdated?: boolean;
  updatedLabel?: string;
  className?: string;
}) {
  const bits: React.ReactNode[] = [];
  if (showDate && post.publishedAt) {
    bits.push(
      <time key="published" dateTime={post.publishedAt.toISOString()}>
        {formatDate(post.publishedAt)}
      </time>,
    );
  }
  if (showUpdated) {
    bits.push(
      <time key="updated" dateTime={post.updatedAt.toISOString()}>
        {updatedLabel || 'Updated'} {formatDate(post.updatedAt)}
      </time>,
    );
  }
  if (showReadTime) bits.push(<span key="read">{post.readingTime} min read</span>);

  const author = showAuthor ? post.author : null;
  if (!author && bits.length === 0) return null;

  return (
    <div className={cn('blog-byline flex flex-wrap items-center gap-x-3 gap-y-2', className)}>
      {author ? (
        <span className="flex items-center gap-2.5">
          {showAuthorImage ? (
            author.image ? (
              <Image
                src={author.image}
                alt=""
                width={32}
                height={32}
                className="h-8 w-8 rounded-full object-cover"
              />
            ) : (
              <span
                className="flex h-8 w-8 items-center justify-center rounded-full bg-brand/10 text-xs font-semibold text-brand"
                aria-hidden="true"
              >
                {initials(author.name)}
              </span>
            )
          ) : null}
          <span className="blog-byline__name">{author.name}</span>
        </span>
      ) : null}
      {bits.map((bit, index) => (
        <span key={index} className="flex items-center gap-3">
          {index > 0 || author ? <span aria-hidden="true">·</span> : null}
          {bit}
        </span>
      ))}
    </div>
  );
}

function emptySource(): PostSource {
  return {
    source: 'latest',
    categoryId: null,
    includeChildCategories: true,
    tagId: null,
    postIds: [],
    limit: 6,
    orderBy: 'publishedAt',
    orderDir: 'desc',
    excludeCurrent: false,
    excludeIds: [],
  };
}

/** Grid wrapper carrying the CMS column counts and gaps. */
function PostGrid({
  posts,
  country,
  card,
  columns,
  tabletColumns,
  mobileColumns,
  priorityCount = 0,
}: {
  posts: BlogListItem[];
  country: CountryContext;
  card: ReturnType<typeof resolveCard>;
  columns: number;
  tabletColumns: number;
  mobileColumns: number;
  priorityCount?: number;
}) {
  return (
    <div
      className="blog-grid"
      style={
        {
          ...cardVars(card),
          '--blog-cols': String(columns),
          '--blog-cols-tablet': String(tabletColumns),
          '--blog-cols-mobile': String(mobileColumns),
        } as React.CSSProperties
      }
    >
      {posts.map((post, index) => (
        <PostCard
          key={post.id}
          post={post}
          country={country}
          card={card}
          priority={index < priorityCount}
        />
      ))}
    </div>
  );
}

export async function BlogGridBlock({ content, ctx }: { content: BlogGridContent; ctx: Ctx }) {
  const blog = blogOf(ctx);
  if (!blog) return null;

  const archive = blog.archive;
  const isPrimary = content.paginate && Boolean(archive);

  const posts = isPrimary
    ? archive!.posts
    : await resolvePostSource(ctx.country.id, content, {
        currentPostId: blog.article?.post.id ?? null,
        currentCategoryId: blog.article?.post.categoryId ?? null,
      });

  const card = resolveCard(blog.settings.card, content);

  return (
    <div className="space-y-8">
      <Heading content={content} ctx={ctx} />

      {posts.length === 0 ? (
        <EmptyState
          title={
            content.emptyHeading ||
            (archive?.query ? `No articles match “${archive.query}”` : 'No articles yet')
          }
          description={
            content.emptyText ||
            (archive?.query
              ? 'Try a different search term, or browse every article.'
              : 'New articles are published regularly — check back soon.')
          }
          action={
            archive?.query ? (
              <Link href={blogPath()} className="text-sm font-medium text-brand hover:underline">
                Clear search
              </Link>
            ) : undefined
          }
        />
      ) : (
        <PostGrid
          posts={posts}
          country={ctx.country}
          card={card}
          columns={content.columns}
          tabletColumns={content.tabletColumns || Math.min(content.columns, 2)}
          mobileColumns={content.mobileColumns || 1}
          priorityCount={ctx.isFirst ? content.columns : 0}
        />
      )}

      {isPrimary && content.showPagination && archive ? (
        <Pagination
          page={archive.page}
          pages={archive.pages}
          basePath={archive.basePath}
          searchParams={archive.searchParams}
        />
      ) : null}

      {content.ctaLabel ? (
        <div className="flex justify-center">
          <CtaLink label={content.ctaLabel} url={content.ctaUrl} variant="outline" size="md" />
        </div>
      ) : null}
    </div>
  );
}

export function BlogPaginationBlock({
  content,
  ctx,
}: {
  content: BlogPaginationContent;
  ctx: Ctx;
}) {
  const archive = blogOf(ctx)?.archive;
  if (!archive) return null;
  return (
    <Pagination
      page={archive.page}
      pages={archive.pages}
      basePath={archive.basePath}
      searchParams={archive.searchParams}
      previousLabel={content.previousLabel}
      nextLabel={content.nextLabel}
      showNumbers={content.showNumbers}
      showSummary={content.showSummary}
      align={content.align}
    />
  );
}

export async function BlogNewsletterBlock({
  content,
  ctx,
}: {
  content: BlogNewsletterContent;
  ctx: Ctx;
}) {
  const form = content.formSlug ? await getPublicForm(content.formSlug, ctx.country.id) : await getDefaultForm(ctx.country.id);
  const panelImage =
    content.panel.background.type === 'image' && content.panel.background.imageId
      ? await getMedia(content.panel.background.imageId)
      : null;
  const panel = buildPanelStyles(content.panel, panelImage?.url ?? null);
  const image = content.layout === 'split' ? await getMedia(content.imageId) : null;

  if (!form) {
    return (
      <SectionHeading
        heading={content.heading}
        description="Choose a form for this section under its Content tab."
        inverted={ctx.inverted}
      />
    );
  }

  const copy = <Heading content={content} ctx={ctx} />;
  const formPanel = (
    <div className="min-w-0">
      <PublicFormRenderer
        form={form}
        ctaLocation={content.ctaLocation || 'blog_newsletter'}
        compact={content.layout === 'inline'}
      />
      {content.footnote ? (
        <p className={cn('mt-3 text-xs', ctx.inverted ? 'text-white/60' : 'text-muted')}>
          {content.footnote}
        </p>
      ) : null}
    </div>
  );

  return (
    <div
      className={cn(
        'relative overflow-hidden',
        (panel.hasBackground || content.panel.borderEnabled) && !panel.style.borderRadius && 'rounded-2xl',
        (panel.hasBackground || content.panel.borderEnabled) && !panel.style.paddingTop && 'p-6 sm:p-10',
      )}
      style={panel.style}
    >
      {panel.overlay ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{ backgroundColor: panel.overlay }}
        />
      ) : null}

      <div className="relative">
        {content.layout === 'centered' ? (
          <div className="mx-auto max-w-2xl text-center">
            {copy}
            <div className="mt-7 text-left">{formPanel}</div>
          </div>
        ) : content.layout === 'split' ? (
          <div className="grid items-center gap-8 lg:grid-cols-2 lg:gap-12">
            <div className="min-w-0">
              {image ? (
                <Image
                  src={image.url}
                  alt={image.altText || ''}
                  width={image.width ?? 560}
                  height={image.height ?? 360}
                  className="mb-6 h-auto w-full rounded-xl object-cover"
                />
              ) : null}
              {copy}
            </div>
            {formPanel}
          </div>
        ) : (
          <div className="grid items-center gap-6 lg:grid-cols-[1fr_1.1fr] lg:gap-10">
            {copy}
            {formPanel}
          </div>
        )}
      </div>
    </div>
  );
}

export function DividerBlock({ content }: { content: DividerContent; ctx: Ctx }) {
  return (
    <hr
      className={cn(
        'border-0 border-t',
        content.width === 'content' && 'mx-auto max-w-3xl',
        content.width === 'short' && 'mx-auto w-24',
      )}
      style={{
        borderTopStyle: content.style,
        borderTopWidth: content.thickness || '1px',
        borderTopColor: content.color || 'rgb(var(--brand-border))',
      }}
    />
  );
}

export function SpacerBlock({ content }: { content: SpacerContent; ctx: Ctx }) {
  return (
    <div
      aria-hidden="true"
      className="cms-spacer"
      style={
        {
          '--spacer-h': content.height || '2rem',
          '--spacer-h-tablet': content.tabletHeight || content.height || '2rem',
          '--spacer-h-mobile': content.mobileHeight || content.tabletHeight || content.height || '1.5rem',
        } as React.CSSProperties
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Article
// ---------------------------------------------------------------------------

export function ArticleBreadcrumbBlock({
  content,
  ctx,
}: {
  content: BlogBreadcrumbContent;
  ctx: Ctx;
}) {
  const article = blogOf(ctx)?.article;
  if (!article) return null;
  if (!article.visible.showBreadcrumb) return null;

  const items: Array<{ label: string; href?: string }> = [];
  if (content.showHome) {
    items.push({ label: content.homeLabel || 'Home', href: countryPath(ctx.country) });
  }
  items.push({ label: content.blogLabel || 'Blog', href: blogPath() });
  if (article.post.category) {
    items.push({
      label: article.post.category.name,
      href: categoryPath(article.post.category),
    });
  }
  items.push({ label: article.post.title });

  return <Breadcrumb items={items} inverted={ctx.inverted} />;
}

export function ArticleHeaderBlock({ content, ctx }: { content: ArticleHeaderContent; ctx: Ctx }) {
  const article = blogOf(ctx)?.article;
  if (!article) return null;
  const { post, visible } = article;

  return (
    <header className={cn(content.align === 'center' && 'text-center')}>
      {content.showCategory && visible.showCategory && post.category ? (
        <Link href={categoryPath(post.category)} className="blog-article__category">
          {post.category.name}
        </Link>
      ) : null}

      <h1 className="blog-article__title mt-4 font-heading tracking-tight">{post.title}</h1>

      {content.showSubtitle && post.subtitle ? (
        <p className="blog-article__subtitle mt-3">{post.subtitle}</p>
      ) : null}

      {content.showExcerpt && post.excerpt ? (
        <p className="blog-article__excerpt mt-4">{post.excerpt}</p>
      ) : null}

      <PostBylineFromPost
        post={post}
        content={content}
        visible={visible}
        className={cn(
          'mt-7 border-y border-hairline py-4',
          content.align === 'center' && 'justify-center',
        )}
      />

      {content.showTags && visible.showTags && post.tags.length > 0 ? (
        <ul
          className={cn(
            'mt-4 flex flex-wrap gap-1.5',
            content.align === 'center' && 'justify-center',
          )}
        >
          {post.tags.map(({ tag }) => (
            <li key={tag.id}>
              <Link href={tagPath(tag)} className="blog-card__tag">
                {tag.name}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </header>
  );
}

function PostBylineFromPost({
  post,
  content,
  visible,
  className,
}: {
  post: { author: { name: string; image: string | null } | null; publishedAt: Date | null; updatedAt: Date; readingTime: number };
  content: ArticleHeaderContent;
  visible: Record<string, boolean>;
  className?: string;
}) {
  const showAuthor = content.showAuthor && visible.showAuthor && Boolean(post.author);
  const showDate = content.showDate && visible.showDate && Boolean(post.publishedAt);
  const showUpdated = content.showUpdatedDate && visible.showUpdatedDate;
  const showReadTime = content.showReadTime && visible.showReadTime;

  if (!showAuthor && !showDate && !showUpdated && !showReadTime) return null;

  const bits: React.ReactNode[] = [];
  if (showDate && post.publishedAt) {
    bits.push(
      <time key="published" dateTime={post.publishedAt.toISOString()}>
        {formatDate(post.publishedAt)}
      </time>,
    );
  }
  if (showUpdated) {
    bits.push(
      <time key="updated" dateTime={post.updatedAt.toISOString()}>
        {content.updatedLabel || 'Updated'} {formatDate(post.updatedAt)}
      </time>,
    );
  }
  if (showReadTime) bits.push(<span key="read">{post.readingTime} min read</span>);

  return (
    <div className={cn('blog-byline flex flex-wrap items-center gap-x-3 gap-y-2', className)}>
      {showAuthor && post.author ? (
        <span className="flex items-center gap-2.5">
          {content.showAuthorImage ? (
            post.author.image ? (
              <Image
                src={post.author.image}
                alt=""
                width={36}
                height={36}
                className="h-9 w-9 rounded-full object-cover"
              />
            ) : (
              <span
                className="flex h-9 w-9 items-center justify-center rounded-full bg-brand/10 text-xs font-semibold text-brand"
                aria-hidden="true"
              >
                {initials(post.author.name)}
              </span>
            )
          ) : null}
          <span className="blog-byline__name">{post.author.name}</span>
        </span>
      ) : null}
      {bits.map((bit, index) => (
        <span key={index} className="flex items-center gap-3">
          {index > 0 || showAuthor ? <span aria-hidden="true">·</span> : null}
          {bit}
        </span>
      ))}
    </div>
  );
}

export function ArticleImageBlock({ content, ctx }: { content: ArticleImageContent; ctx: Ctx }) {
  const article = blogOf(ctx)?.article;
  if (!article) return null;

  const image = content.useThumbnail
    ? (article.post.thumbnail ?? article.post.featuredImage)
    : (article.post.featuredImage ?? article.post.thumbnail);
  if (!image) return null;

  return (
    <figure>
      <Image
        src={image.url}
        alt={image.altText ?? ''}
        width={image.width ?? 1200}
        height={image.height ?? 675}
        priority
        sizes="(max-width: 1024px) 100vw, 800px"
        className="h-auto w-full border border-hairline object-cover"
        style={{
          aspectRatio: RATIO_CSS[content.ratio],
          borderRadius: content.radius || '1rem',
        }}
      />
      {content.showCaption && image.caption ? (
        <figcaption className="blog-article__caption mt-3">{image.caption}</figcaption>
      ) : null}
    </figure>
  );
}

export async function ArticleTocBlock({ content, ctx }: { content: ArticleTocContent; ctx: Ctx }) {
  const blog = blogOf(ctx);
  const article = blog?.article;
  if (!article || !blog) return null;
  if (!article.visible.showToc) return null;
  // The sidebar owns the TOC in that configuration; rendering both would be a
  // duplicate outline on the same page.
  if (blog.settings.layout.tocPosition !== 'article') return null;

  const items = content.includeH3 ? article.toc : article.toc.filter((item) => item.level === 2);
  if (items.length === 0) return null;

  const panelImage =
    content.panel.background.type === 'image' && content.panel.background.imageId
      ? await getMedia(content.panel.background.imageId)
      : null;
  const panel = buildPanelStyles(content.panel, panelImage?.url ?? null);

  return (
    <div
      className={cn(
        'blog-toc-panel',
        !panel.style.borderRadius && 'rounded-xl',
        !panel.style.paddingTop && 'p-5',
      )}
      style={panel.style}
    >
      <TableOfContents
        items={items}
        heading={content.heading || blog.settings.layout.tocHeading}
        collapsible={content.collapsible}
        openByDefault={content.openByDefault}
      />
    </div>
  );
}

export function ArticleContentBlock({ content, ctx }: { content: ArticleContentContent; ctx: Ctx }) {
  const article = blogOf(ctx)?.article;
  if (!article) return null;

  return (
    <div style={content.maxWidth ? { maxWidth: content.maxWidth } : undefined}>
      {content.showLead && article.post.excerpt ? (
        <p className="blog-article__lead">{article.post.excerpt}</p>
      ) : null}
      {/*
        `article.html` is the sanitised body with heading anchors added — the
        sanitiser runs on save and again on render, so nothing unsafe reaches
        this point.
      */}
      <div
        className="prose-cms blog-article__body"
        dangerouslySetInnerHTML={{ __html: article.html }}
      />
    </div>
  );
}

export function ArticleShareBlock({ content, ctx }: { content: ArticleShareContent; ctx: Ctx }) {
  const blog = blogOf(ctx);
  const article = blog?.article;
  if (!article || !blog) return null;
  if (!article.visible.showShare) return null;

  const networks = enabledNetworks(blog.settings.share);
  if (networks.length === 0) return null;

  const heading = content.heading || blog.settings.share.heading;

  /*
   * "Floating" is the one placement the section order cannot express: a rail
   * pinned beside the article. It needs a viewport wide enough to have a
   * margin to sit in, so below that width it falls back to the same inline row
   * as every other placement rather than overlapping the text.
   */
  if (blog.settings.share.position === 'floating') {
    return (
      <>
        <div className="hidden xl:block">
          <div className="blog-share-rail">
            <ShareButtons
              url={article.shareUrl}
              title={article.post.title}
              networks={networks}
              heading={heading}
              style="icon"
              orientation="vertical"
            />
          </div>
        </div>
        <div className="xl:hidden">
          <ShareButtons
            url={article.shareUrl}
            title={article.post.title}
            networks={networks}
            heading={heading}
            style={content.style}
            align={content.align}
          />
        </div>
      </>
    );
  }

  return (
    <ShareButtons
      url={article.shareUrl}
      title={article.post.title}
      networks={networks}
      heading={heading}
      style={content.style}
      align={content.align}
    />
  );
}

export function ArticleTagsBlock({ content, ctx }: { content: ArticleTagsContent; ctx: Ctx }) {
  const article = blogOf(ctx)?.article;
  if (!article) return null;
  if (!article.visible.showTags) return null;
  if (article.post.tags.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {content.showLabel ? (
        <span className="text-sm text-muted">{content.label || 'Tags'}:</span>
      ) : null}
      {article.post.tags.map(({ tag }) => (
        <Link key={tag.id} href={tagPath(tag)} className="blog-card__tag">
          {tag.name}
        </Link>
      ))}
    </div>
  );
}

export async function ArticleAuthorBlock({
  content,
  ctx,
}: {
  content: ArticleAuthorContent;
  ctx: Ctx;
}) {
  const article = blogOf(ctx)?.article;
  if (!article) return null;
  if (!article.visible.showAuthorBox) return null;

  const author = article.post.author;
  if (!author) return null;

  const panelImage =
    content.panel.background.type === 'image' && content.panel.background.imageId
      ? await getMedia(content.panel.background.imageId)
      : null;
  const panel = buildPanelStyles(content.panel, panelImage?.url ?? null);

  return (
    <div>
      {content.showHeading && content.heading ? (
        <h2 className="blog-section__heading mb-4">{content.heading}</h2>
      ) : null}
      <AuthorBox
        author={author}
        showImage={content.showImage}
        showJobTitle={content.showJobTitle}
        showBio={content.showBio}
        showSocial={content.showSocial}
        className={cn(
          !panel.style.borderRadius && 'rounded-xl',
          !panel.style.paddingTop && 'p-5',
          !panel.hasBackground && !content.panel.borderEnabled && 'border border-hairline',
        )}
        style={panel.style as React.CSSProperties}
      />
    </div>
  );
}

export async function ArticleRelatedBlock({
  content,
  ctx,
}: {
  content: ArticleRelatedContent;
  ctx: Ctx;
}) {
  const blog = blogOf(ctx);
  const article = blog?.article;
  if (!blog) return null;
  if (article && !article.visible.showRelated) return null;

  const posts = await resolvePostSource(ctx.country.id, content, {
    currentPostId: article?.post.id ?? null,
    currentCategoryId: article?.post.categoryId ?? null,
  });

  if (posts.length === 0) {
    return content.emptyText ? <EmptyState title={content.emptyText} /> : null;
  }

  const card = resolveCard(blog.settings.card, content);

  return (
    <div className="space-y-8">
      <Heading content={content} ctx={ctx} />
      <PostGrid
        posts={posts}
        country={ctx.country}
        card={card}
        columns={content.columns}
        tabletColumns={content.tabletColumns || Math.min(content.columns, 2)}
        mobileColumns={content.mobileColumns || 1}
      />
    </div>
  );
}

export async function ArticlePrevNextBlock({
  content,
  ctx,
}: {
  content: ArticlePrevNextContent;
  ctx: Ctx;
}) {
  const article = blogOf(ctx)?.article;
  if (!article) return null;
  if (!article.visible.showPrevNext) return null;

  const { previous, next } = await getAdjacentPosts({
    countryId: ctx.country.id,
    postId: article.post.id,
    publishedAt: article.post.publishedAt,
    categoryId: article.post.categoryId,
    sameCategory: content.sameCategory,
  });

  if (!previous && !next) return null;

  const tile = (post: BlogListItem | null, direction: 'prev' | 'next', label: string) => {
    if (!post) return <span />;
    const image = post.featuredImage ?? post.thumbnail;
    return (
      <Link
        href={postPath(post)}
        rel={direction === 'prev' ? 'prev' : 'next'}
        className={cn(
          'blog-prevnext group flex items-center gap-3 rounded-xl border border-hairline p-4 transition-colors hover:border-brand',
          direction === 'next' && 'text-right',
        )}
      >
        {direction === 'next' ? null : (
          <ArrowLeft className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
        )}
        {content.showImage && image ? (
          <Image
            src={image.url}
            alt=""
            width={56}
            height={56}
            className="h-14 w-14 shrink-0 rounded-lg object-cover"
          />
        ) : null}
        <span className="min-w-0 flex-1">
          <span className="blog-prevnext__label block">{label}</span>
          <span className="blog-prevnext__title mt-0.5 block">{post.title}</span>
        </span>
        {direction === 'next' ? (
          <ArrowRight className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
        ) : null}
      </Link>
    );
  };

  return (
    <nav aria-label="More articles" className="grid gap-3 sm:grid-cols-2">
      {tile(previous, 'prev', content.previousLabel || 'Previous article')}
      {tile(next, 'next', content.nextLabel || 'Next article')}
    </nav>
  );
}

import Link from 'next/link';
import Image from 'next/image';
import {
  LinkedInIcon,
  XIcon,
  FacebookIcon,
  InstagramIcon,
  YouTubeIcon,
  type IconComponent,
} from '@/components/ui/icons';
import type {
  WidgetPostListContent,
  WidgetSearchContent,
  WidgetTocContent,
  WidgetCategoriesContent,
  WidgetTagsContent,
  WidgetFormContent,
  WidgetCtaContent,
  WidgetAuthorContent,
  WidgetProductsContent,
  WidgetImageContent,
  WidgetTextContent,
  WidgetHeadingContent,
  WidgetButtonContent,
  WidgetSocialContent,
} from '@/lib/cms/blog-blocks';
import type { BlogRenderContext } from '@/lib/cms/blog-render';
import { blogPath, categoryPath, tagPath, postPath } from '@/lib/cms/blog-render';
import type { CountryContext } from '@/lib/country/types';
import { buildPanelStyles, type PanelDesign } from '@/lib/cms/design';
import {
  resolvePostSource,
  getBlogCategories,
  getBlogTags,
  type BlogListItem,
} from '@/lib/services/blog';
import { prisma } from '@/lib/db/prisma';
import { selectProducts } from '@/lib/services/products';
import { getMedia } from '@/lib/services/media';
import { getPublicForm, getDefaultForm } from '@/lib/services/forms';
import { PublicFormRenderer } from '@/components/forms/public-form';
import { TableOfContents } from '@/components/blog/table-of-contents';
import { BlogSearch } from '@/components/blog/blog-search';
import { AuthorBox } from '@/components/blog/author-box';
import { buttonClasses } from '@/components/ui/button';
import { formatDate } from '@/lib/utils/format';
import { safeUrl, sanitizeHtml } from '@/lib/utils/sanitize';
import { formatMoney } from '@/lib/utils/money';
import { cn } from '@/lib/utils/cn';

/**
 * Sidebar widgets.
 *
 * Each widget is a normal CMS block, so it gets the same drag/drop ordering,
 * visibility switch, duplication and design panel as a page section. What is
 * specific to a widget is only its chrome — the card, the title and the sticky
 * behaviour — which is why that lives in one shared shell below.
 */

export type WidgetChrome = {
  title: string;
  showTitle: boolean;
  description: string;
  sticky: boolean;
  panel: PanelDesign;
  headingColor: string;
  linkColor: string;
};

/**
 * The card every widget sits in.
 *
 * It paints a background only when the administrator asked for one, so a
 * "Heading" or "Button" widget can sit bare in the column while a CTA widget is
 * a solid card — without either needing its own component.
 */
export async function WidgetShell({
  chrome,
  headingId,
  children,
  className,
}: {
  chrome: WidgetChrome;
  headingId?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const panelImage =
    chrome.panel.background.type === 'image' && chrome.panel.background.imageId
      ? await getMedia(chrome.panel.background.imageId)
      : null;
  const panel = buildPanelStyles(chrome.panel, panelImage?.url ?? null);

  const decorated = panel.hasBackground || chrome.panel.borderEnabled;
  const style: Record<string, string> = { ...panel.style };
  if (chrome.headingColor) style['--widget-heading'] = chrome.headingColor;
  if (chrome.linkColor) style['--widget-link'] = chrome.linkColor;

  const title = chrome.showTitle && chrome.title ? chrome.title : null;

  return (
    <section
      aria-labelledby={title ? headingId : undefined}
      className={cn(
        'blog-widget relative',
        chrome.sticky && 'blog-widget--sticky',
        decorated && !panel.style.borderRadius && 'rounded-xl',
        decorated && !panel.style.paddingTop && 'p-5',
        className,
      )}
      style={style as React.CSSProperties}
    >
      {panel.overlay ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-[inherit]"
          style={{ backgroundColor: panel.overlay }}
        />
      ) : null}

      <div className="relative">
        {title ? (
          <h2 id={headingId} className="blog-widget__title">
            {title}
          </h2>
        ) : null}
        {chrome.description ? <p className="blog-widget__text mt-1.5">{chrome.description}</p> : null}
        <div className={title || chrome.description ? 'mt-4' : undefined}>{children}</div>
      </div>
    </section>
  );
}

type WidgetProps<T> = {
  content: T;
  /** The slice of the block context a widget can act on. */
  ctx: { country: CountryContext; blog?: BlogRenderContext };
  id: string;
};

const chromeOf = (content: WidgetChrome): WidgetChrome => content;

// ---------------------------------------------------------------------------

export async function WidgetSearch({ content, ctx, id }: WidgetProps<WidgetSearchContent>) {
  return (
    <WidgetShell chrome={chromeOf(content)} headingId={id}>
      <BlogSearch
        action={blogPath()}
        placeholder={content.placeholder}
        buttonLabel={content.buttonLabel}
        showButton={content.showButton}
        layout={content.showButton ? 'inline' : 'wide'}
        compact
      />
    </WidgetShell>
  );
}

export async function WidgetToc({ content, ctx, id }: WidgetProps<WidgetTocContent>) {
  const blog = ctx.blog;
  const article = blog?.article;
  if (!article || !blog) return null;
  if (!article.visible.showToc) return null;
  // Mirrors the article-side rule: only one of the two positions renders.
  if (blog.settings.layout.tocPosition !== 'sidebar') return null;

  const items = content.includeH3 ? article.toc : article.toc.filter((item) => item.level === 2);
  if (items.length === 0) return null;

  return (
    <WidgetShell chrome={chromeOf(content)} headingId={id}>
      <TableOfContents
        items={items}
        heading={content.showTitle ? undefined : content.title}
        collapsible={content.collapsible}
        openByDefault={content.openByDefault}
      />
    </WidgetShell>
  );
}

export async function WidgetPosts({ content, ctx, id }: WidgetProps<WidgetPostListContent>) {
  const article = ctx.blog?.article;
  const posts = await resolvePostSource(ctx.country.id, content, {
    currentPostId: article?.post.id ?? null,
    currentCategoryId: article?.post.categoryId ?? null,
  });

  if (posts.length === 0) {
    return content.emptyText ? (
      <WidgetShell chrome={chromeOf(content)} headingId={id}>
        <p className="blog-widget__text">{content.emptyText}</p>
      </WidgetShell>
    ) : null;
  }

  return (
    <WidgetShell chrome={chromeOf(content)} headingId={id}>
      <ol className={cn('space-y-4', content.layout === 'list' && 'space-y-2.5')}>
        {posts.map((post, index) => (
          <li key={post.id}>
            <WidgetPostRow post={post} content={content} index={index} country={ctx.country} />
          </li>
        ))}
      </ol>
    </WidgetShell>
  );
}

function WidgetPostRow({
  post,
  content,
  index,
  country,
}: {
  post: BlogListItem;
  content: WidgetPostListContent;
  index: number;
  country: CountryContext;
}) {
  const image = post.thumbnail ?? post.featuredImage;
  const href = postPath(post);
  const withImage = content.showImage && content.layout !== 'list' && Boolean(image);

  const meta: string[] = [];
  if (content.showCategory && post.category) meta.push(post.category.name);
  if (content.showDate && post.publishedAt) meta.push(formatDate(post.publishedAt));
  if (content.showReadTime) meta.push(`${post.readingTime} min`);

  if (content.layout === 'cards') {
    return (
      <Link href={href} className="group block">
        {withImage && image ? (
          <Image
            src={image.url}
            alt=""
            width={image.width ?? 400}
            height={image.height ?? 225}
            sizes="320px"
            className="mb-2 h-auto w-full rounded-lg object-cover"
            style={{ aspectRatio: '16 / 9' }}
          />
        ) : null}
        <span className="blog-widget__post-title block">{post.title}</span>
        {meta.length > 0 ? <span className="blog-widget__meta mt-1 block">{meta.join(' · ')}</span> : null}
        {content.showExcerpt && post.excerpt ? (
          <span className="blog-widget__text mt-1 block line-clamp-2">{post.excerpt}</span>
        ) : null}
      </Link>
    );
  }

  return (
    <Link href={href} className="group flex items-start gap-3">
      {content.showNumbers ? (
        <span className="blog-widget__number shrink-0" aria-hidden="true">
          {index + 1}
        </span>
      ) : null}
      {withImage && image ? (
        <Image
          src={image.url}
          alt=""
          width={64}
          height={64}
          sizes="64px"
          className="h-14 w-14 shrink-0 rounded-lg object-cover"
        />
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="blog-widget__post-title block">{post.title}</span>
        {meta.length > 0 ? <span className="blog-widget__meta mt-0.5 block">{meta.join(' · ')}</span> : null}
        {content.showExcerpt && post.excerpt ? (
          <span className="blog-widget__text mt-1 block line-clamp-2">{post.excerpt}</span>
        ) : null}
      </span>
    </Link>
  );
}

export async function WidgetCategories({ content, ctx, id }: WidgetProps<WidgetCategoriesContent>) {
  const all = ctx.blog?.archive?.categories ?? (await getBlogCategories(ctx.country.id));

  let categories = content.showChildren ? all : all.filter((category) => !category.parentId);
  if (content.source === 'selected' && content.categoryIds.length > 0) {
    categories = content.categoryIds
      .map((categoryId) => all.find((category) => category.id === categoryId))
      .filter((category): category is NonNullable<typeof category> => Boolean(category));
  }
  if (!content.showEmpty) categories = categories.filter((category) => category.count > 0);
  categories = categories.slice(0, content.limit);

  if (categories.length === 0) return null;

  const activeSlug =
    ctx.blog?.archive?.categorySlug ?? ctx.blog?.article?.post.category?.slug ?? null;

  return (
    <WidgetShell chrome={chromeOf(content)} headingId={id}>
      {content.style === 'pill' ? (
        <ul className="flex flex-wrap gap-1.5">
          {categories.map((category) => (
            <li key={category.id}>
              <Link
                href={categoryPath(category)}
                className={cn('blog-chip blog-chip--pill', activeSlug === category.slug && 'blog-chip--active')}
              >
                {category.name}
                {content.showCounts ? <span className="blog-chip__count">{category.count}</span> : null}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="blog-widget__list">
          {categories.map((category) => (
            <li key={category.id} className={category.parentId ? 'pl-4' : undefined}>
              <Link
                href={categoryPath(category)}
                aria-current={activeSlug === category.slug ? 'page' : undefined}
                className="blog-widget__link flex items-center justify-between gap-2"
              >
                <span className="min-w-0 truncate">{category.name}</span>
                {content.showCounts ? (
                  <span className="blog-widget__meta shrink-0">{category.count}</span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </WidgetShell>
  );
}

export async function WidgetTags({ content, ctx, id }: WidgetProps<WidgetTagsContent>) {
  const tags = ctx.blog?.archive?.tags ?? (await getBlogTags(ctx.country.id, content.limit));
  const shown = tags.filter((tag) => tag.count > 0).slice(0, content.limit);
  if (shown.length === 0) return null;

  return (
    <WidgetShell chrome={chromeOf(content)} headingId={id}>
      <ul className="flex flex-wrap gap-1.5">
        {shown.map((tag) => (
          <li key={tag.id}>
            <Link href={tagPath(tag)} className="blog-card__tag">
              {tag.name}
              {content.showCounts ? <span className="ml-1 opacity-60">{tag.count}</span> : null}
            </Link>
          </li>
        ))}
      </ul>
    </WidgetShell>
  );
}

export async function WidgetForm({ content, ctx, id }: WidgetProps<WidgetFormContent>) {
  // A post that names its own sidebar form wins, which is what makes a
  // campaign-specific article possible without a bespoke sidebar.
  const postForm = content.preferPostForm ? ctx.blog?.article?.forms.sidebar : '';
  const slug = postForm || content.formSlug;
  const form = slug ? await getPublicForm(slug, ctx.country.id) : await getDefaultForm(ctx.country.id);
  if (!form) return null;

  return (
    <WidgetShell chrome={chromeOf(content)} headingId={id}>
      <PublicFormRenderer
        form={form}
        compact
        ctaLocation={content.ctaLocation || 'blog_sidebar'}
      />
    </WidgetShell>
  );
}

export async function WidgetCta({ content, id }: WidgetProps<WidgetCtaContent>) {
  const image = await getMedia(content.imageId);
  const href = safeUrl(content.ctaUrl);

  return (
    <WidgetShell chrome={chromeOf(content)} headingId={id}>
      <div className={cn(content.align === 'center' && 'text-center')}>
        {image ? (
          <Image
            src={image.url}
            alt={image.altText || ''}
            width={image.width ?? 400}
            height={image.height ?? 260}
            sizes="360px"
            className="mb-4 h-auto w-full rounded-lg object-cover"
          />
        ) : null}
        {content.body ? <p className="blog-widget__text">{content.body}</p> : null}
        {content.ctaLabel && href ? (
          <Link
            href={href}
            className={buttonClasses('primary', 'md', 'btn-tokens mt-4 w-full justify-center')}
            {...(/^https?:\/\//i.test(href) ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
          >
            {content.ctaLabel}
          </Link>
        ) : null}
      </div>
    </WidgetShell>
  );
}

export async function WidgetAuthor({ content, ctx, id }: WidgetProps<WidgetAuthorContent>) {
  let author = ctx.blog?.article?.post.author ?? null;

  if (!author && content.fallbackAuthorId) {
    author = await prisma.user.findFirst({
      where: { id: content.fallbackAuthorId, deletedAt: null, status: 'ACTIVE' },
      select: {
        id: true,
        name: true,
        image: true,
        jobTitle: true,
        bio: true,
        linkedinUrl: true,
        twitterUrl: true,
        websiteUrl: true,
      },
    });
  }

  if (!author) return null;

  return (
    <WidgetShell chrome={chromeOf(content)} headingId={id}>
      <AuthorBox
        author={author}
        compact
        showImage={content.showImage}
        showJobTitle={content.showJobTitle}
        showBio={content.showBio}
        showSocial={content.showSocial}
      />
    </WidgetShell>
  );
}

export async function WidgetProducts({ content, ctx, id }: WidgetProps<WidgetProductsContent>) {
  // Routed through the shared product selector so the widget shows this
  // market's catalogue, in this market's order, at this market's prices.
  const ordered = await selectProducts(ctx.country, {
    source: content.source,
    productIds: content.productIds,
    categoryId: content.categoryId,
    limit: content.limit,
  });

  if (ordered.length === 0) return null;

  return (
    <WidgetShell chrome={chromeOf(content)} headingId={id}>
      <ul className="space-y-3">
        {ordered.map((product) => (
          <li key={product.id}>
            <Link href={product.href} className="group flex items-start gap-3">
              {content.showImage && product.imageUrl ? (
                <Image
                  src={product.imageUrl}
                  alt=""
                  width={48}
                  height={48}
                  sizes="48px"
                  className="h-12 w-12 shrink-0 rounded-lg border border-hairline object-contain p-1"
                />
              ) : null}
              <span className="min-w-0 flex-1">
                <span className="blog-widget__post-title block">{product.name}</span>
                {content.showPrice && product.monthlyPrice ? (
                  <span className="blog-widget__meta mt-0.5 block">
                    {formatMoney(product.monthlyPrice, product.currency)}
                    {product.priceSuffix ? ` ${product.priceSuffix}` : ''}
                  </span>
                ) : null}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </WidgetShell>
  );
}

export async function WidgetImage({ content, id }: WidgetProps<WidgetImageContent>) {
  const image = await getMedia(content.imageId);
  if (!image) return null;
  const href = safeUrl(content.linkUrl);

  const picture = (
    <Image
      src={image.url}
      alt={content.alt || image.altText || ''}
      width={image.width ?? 480}
      height={image.height ?? 320}
      sizes="360px"
      className="h-auto w-full object-cover"
      style={{ borderRadius: content.radius || '0.75rem' }}
    />
  );

  return (
    <WidgetShell chrome={chromeOf(content)} headingId={id}>
      <figure>
        {href ? <Link href={href}>{picture}</Link> : picture}
        {content.caption ? (
          <figcaption className="blog-widget__meta mt-2">{content.caption}</figcaption>
        ) : null}
      </figure>
    </WidgetShell>
  );
}

export async function WidgetText({ content, id }: WidgetProps<WidgetTextContent>) {
  const html = sanitizeHtml(content.body);
  if (!html) return null;
  return (
    <WidgetShell chrome={chromeOf(content)} headingId={id}>
      {/* Sanitised on save and again here before it reaches the page. */}
      <div className="prose-cms blog-widget__prose" dangerouslySetInnerHTML={{ __html: html }} />
    </WidgetShell>
  );
}

export async function WidgetHeading({ content, id }: WidgetProps<WidgetHeadingContent>) {
  if (!content.text) return null;
  const Tag = content.level === 'p' ? 'p' : content.level;
  return (
    <WidgetShell chrome={chromeOf(content)} headingId={id}>
      <Tag
        className={cn(
          'blog-widget__standalone-heading',
          content.align === 'center' && 'text-center',
          content.align === 'right' && 'text-right',
        )}
      >
        {content.text}
      </Tag>
    </WidgetShell>
  );
}

export async function WidgetButton({ content, id }: WidgetProps<WidgetButtonContent>) {
  const href = safeUrl(content.ctaUrl);
  if (!content.ctaLabel || !href) return null;

  return (
    <WidgetShell chrome={chromeOf(content)} headingId={id}>
      <Link
        href={href}
        className={buttonClasses(
          content.variant,
          'md',
          cn('btn-tokens', content.fullWidth && 'w-full justify-center'),
        )}
        {...(/^https?:\/\//i.test(href) ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      >
        {content.ctaLabel}
      </Link>
    </WidgetShell>
  );
}

export async function WidgetSocial({ content, ctx, id }: WidgetProps<WidgetSocialContent>) {
  const site = ctx.blog?.socials;

  const candidates: Array<{ label: string; href: string | null; Icon: IconComponent }> = [
    { label: 'LinkedIn', href: safeUrl(content.linkedinUrl || site?.linkedinUrl), Icon: LinkedInIcon },
    { label: 'X', href: safeUrl(content.twitterUrl || site?.twitterUrl), Icon: XIcon },
    { label: 'Facebook', href: safeUrl(content.facebookUrl || site?.facebookUrl), Icon: FacebookIcon },
    {
      label: 'Instagram',
      href: safeUrl(content.instagramUrl || site?.instagramUrl),
      Icon: InstagramIcon,
    },
    { label: 'YouTube', href: safeUrl(content.youtubeUrl || site?.youtubeUrl), Icon: YouTubeIcon },
  ];

  const links = candidates.filter(
    (item): item is { label: string; href: string; Icon: IconComponent } => Boolean(item.href),
  );

  if (links.length === 0) return null;

  return (
    <WidgetShell chrome={chromeOf(content)} headingId={id}>
      <ul className={cn(content.style === 'icon' ? 'flex flex-wrap gap-2' : 'blog-widget__list')}>
        {links.map(({ label, href, Icon }) => (
          <li key={label}>
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={label}
              className={
                content.style === 'icon'
                  ? 'blog-author__social inline-flex h-9 w-9 items-center justify-center rounded-full'
                  : 'blog-widget__link flex items-center gap-2'
              }
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              {content.style === 'list' ? <span>{label}</span> : null}
            </a>
          </li>
        ))}
      </ul>
    </WidgetShell>
  );
}

import Link from 'next/link';
import Image from 'next/image';
import { ArrowRight } from 'lucide-react';
import type { BlogListItem } from '@/lib/services/blog';
import type { BlogCardSettings } from '@/lib/cms/blog-settings';
import { DEFAULT_BLOG_CARD, RATIO_CSS, SHADOW_CSS } from '@/lib/cms/blog-settings';
import { categoryPath, postPath, tagPath } from '@/lib/cms/blog-render';
import type { CountryContext } from '@/lib/country/types';
import { formatDate, initials } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';

/**
 * The one blog card.
 *
 * Every grid, the sidebar lists and the related section render through this,
 * and every part of it — which pieces appear, the border, the radius, the
 * image ratio, the type sizes, the hover effect — comes from the card settings
 * an administrator configured. Nothing here is a fixed design decision beyond
 * the markup order.
 */
export function PostCard({
  post,
  country,
  card = DEFAULT_BLOG_CARD,
  priority,
  className,
}: {
  post: BlogListItem;
  /** The market the card links into, so one card works in every storefront. */
  country: CountryContext;
  card?: BlogCardSettings;
  priority?: boolean;
  className?: string;
}) {
  const ratio = RATIO_CSS[card.imageRatio];
  const image = post.featuredImage ?? post.thumbnail;
  const href = postPath(post);

  return (
    <article
      className={cn(
        'blog-card group flex flex-col overflow-hidden',
        card.hoverEffect === 'lift' && 'blog-card--lift',
        card.hoverEffect === 'shadow' && 'blog-card--shadow',
        card.hoverEffect === 'zoom' && 'blog-card--zoom',
        className,
      )}
      style={{ boxShadow: SHADOW_CSS[card.shadow] }}
    >
      {card.showImage ? (
        <Link href={href} className="blog-card__media block overflow-hidden" tabIndex={-1} aria-hidden="true">
          {image ? (
            <Image
              src={image.url}
              alt=""
              width={image.width ?? 800}
              height={image.height ?? 450}
              priority={priority}
              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
              className="h-full w-full object-cover transition-transform duration-300"
              style={{ aspectRatio: ratio }}
            />
          ) : (
            // A missing image must not collapse the card or shift the grid.
            <span
              className="block h-full w-full bg-gradient-to-br from-brand/15 via-brand/5 to-transparent"
              style={{ aspectRatio: ratio ?? '16 / 9' }}
            />
          )}
        </Link>
      ) : null}

      <div className="blog-card__body flex flex-1 flex-col">
        <CardMeta post={post} card={card} country={country} />

        <h3 className="blog-card__title">
          <Link href={href}>{post.title}</Link>
        </h3>

        {card.showExcerpt && post.excerpt ? (
          <p
            className="blog-card__excerpt mt-2 flex-1"
            style={{ WebkitLineClamp: card.excerptLines }}
          >
            {post.excerpt}
          </p>
        ) : null}

        {card.showTags && post.tags.length > 0 ? (
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {post.tags.slice(0, 4).map(({ tag }) => (
              <li key={tag.slug}>
                <Link href={tagPath(tag)} className="blog-card__tag">
                  {tag.name}
                </Link>
              </li>
            ))}
          </ul>
        ) : null}

        <CardFooter post={post} card={card} href={href} />
      </div>
    </article>
  );
}

function CardMeta({
  post,
  card,
  country,
}: {
  post: BlogListItem;
  card: BlogCardSettings;
  country: CountryContext;
}) {
  const bits: React.ReactNode[] = [];
  if (card.showDate && post.publishedAt) {
    bits.push(
      <time key="date" dateTime={post.publishedAt.toISOString()}>
        {formatDate(post.publishedAt)}
      </time>,
    );
  }
  if (card.showUpdatedDate) {
    bits.push(
      <time key="updated" dateTime={post.updatedAt.toISOString()}>
        Updated {formatDate(post.updatedAt)}
      </time>,
    );
  }
  if (card.showReadTime) bits.push(<span key="read">{post.readingTime} min read</span>);

  if (!card.showCategory && bits.length === 0) return null;

  return (
    <div className="blog-card__meta flex flex-wrap items-center gap-x-2 gap-y-1">
      {card.showCategory && post.category ? (
        <Link href={categoryPath(post.category)} className="blog-card__category">
          {post.category.name}
        </Link>
      ) : null}
      {bits.map((bit, index) => (
        <span key={index} className="flex items-center gap-2">
          {index > 0 || (card.showCategory && post.category) ? (
            <span aria-hidden="true">·</span>
          ) : null}
          {bit}
        </span>
      ))}
    </div>
  );
}

function CardFooter({
  post,
  card,
  href,
}: {
  post: BlogListItem;
  card: BlogCardSettings;
  href: string;
}) {
  const showAuthor = card.showAuthor && Boolean(post.author);
  if (!showAuthor && !card.showCta) return null;

  return (
    <div className="blog-card__footer mt-5 flex flex-wrap items-center justify-between gap-3">
      {showAuthor && post.author ? (
        <span className="flex min-w-0 items-center gap-2">
          {card.showAuthorImage ? (
            post.author.image ? (
              <Image
                src={post.author.image}
                alt=""
                width={28}
                height={28}
                className="h-7 w-7 shrink-0 rounded-full object-cover"
              />
            ) : (
              <span
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand/10 text-[0.625rem] font-semibold text-brand"
                aria-hidden="true"
              >
                {initials(post.author.name)}
              </span>
            )
          ) : null}
          <span className="blog-card__meta min-w-0 truncate">{post.author.name}</span>
        </span>
      ) : (
        <span />
      )}

      {card.showCta ? (
        <Link href={href} className="blog-card__cta inline-flex items-center gap-1.5">
          {card.ctaLabel || 'Read article'}
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      ) : null}
    </div>
  );
}

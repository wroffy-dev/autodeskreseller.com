import Link from 'next/link';
import type { BlogCategoryItem } from '@/lib/services/blog';
import { categoryPath, blogPath } from '@/lib/cms/blog-render';
import type { CountryContext } from '@/lib/country/types';
import { cn } from '@/lib/utils/cn';

/**
 * Category navigation.
 *
 * Horizontally scrollable on small screens rather than wrapping into four rows
 * that push the articles off the fold. The chips themselves come from Blog →
 * Categories, in the order set there.
 */
export function CategoryChips({
  categories,
  country,
  activeSlug,
  basePath,
  showAll = true,
  allLabel = 'All',
  showCounts = false,
  style = 'pill',
  className,
}: {
  categories: BlogCategoryItem[];
  country: CountryContext;
  activeSlug: string | null;
  basePath?: string;
  showAll?: boolean;
  allLabel?: string;
  showCounts?: boolean;
  style?: 'pill' | 'underline' | 'button';
  className?: string;
}) {
  if (categories.length === 0 && !showAll) return null;

  // "All" returns to the market's own archive, never the root market's.
  const allHref = basePath ?? blogPath();

  const chipClass = (active: boolean) =>
    cn(
      'blog-chip',
      style === 'pill' && 'blog-chip--pill',
      style === 'underline' && 'blog-chip--underline',
      style === 'button' && 'blog-chip--button',
      active && 'blog-chip--active',
    );

  return (
    <nav aria-label="Article categories" className={cn('scroll-x -mx-1 px-1', className)}>
      <ul className="flex min-w-max items-center gap-2">
        {showAll ? (
          <li>
            <Link href={allHref} className={chipClass(!activeSlug)} aria-current={!activeSlug ? 'page' : undefined}>
              {allLabel}
            </Link>
          </li>
        ) : null}
        {categories.map((category) => {
          const active = activeSlug === category.slug;
          return (
            <li key={category.id}>
              <Link
                href={categoryPath(category)}
                className={chipClass(active)}
                aria-current={active ? 'page' : undefined}
              >
                {category.name}
                {showCounts ? <span className="blog-chip__count">{category.count}</span> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

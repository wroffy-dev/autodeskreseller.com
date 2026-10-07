import { countryHref } from '@/lib/country/routing';
import { blogCategoryHref, pageHref, postHref, productHref } from '@/lib/urls/links';
import type { CountryContext } from '@/lib/country/types';
import type { NavLinkType } from '@prisma/client';

/**
 * Where a menu item points, and whether it still points anywhere.
 *
 * Kept apart from the query so the rules can be read and tested on their own.
 * There are two, and the second is the one that was missing:
 *
 * - A menu belongs to a market, so what it points at resolves inside that
 *   market and carries its prefix.
 * - **A target in the recycle bin is not a target.** Deleting a page does not
 *   delete the menu item pointing at it — the page is parked under
 *   `about-deleted-…` and waits to be restored — so resolving the row anyway
 *   produced a menu link straight to a 404.
 */

/** The shape of a stored item, as far as linking is concerned. */
export type LinkableItem = {
  linkType: NavLinkType;
  url: string | null;
  page: { id: string; slug: string; deletedAt: Date | null } | null;
  product: { id: string; slug: string; deletedAt: Date | null } | null;
  blogPost: { id: string; slug: string; deletedAt: Date | null } | null;
  blogCategory: { id: string; slug: string } | null;
};

/**
 * Null when there is nothing live to link to.
 *
 * Linked items resolve through the URL registry by the target's id, so a menu
 * keeps pointing at a page, product or article whatever its address becomes.
 * The blog is root-only, so its links are the root address in every market.
 */
export function navHref(item: LinkableItem, country: CountryContext): string | null {
  const live = <T extends { deletedAt: Date | null }>(row: T | null): T | null =>
    row && row.deletedAt === null ? row : null;

  switch (item.linkType) {
    case 'PAGE': {
      const page = live(item.page);
      return page ? pageHref(country, page) : null;
    }
    case 'PRODUCT': {
      const product = live(item.product);
      return product ? productHref(country, product) : null;
    }
    case 'BLOG_POST': {
      const post = live(item.blogPost);
      return post ? postHref(post) : null;
    }
    case 'BLOG_CATEGORY':
      return item.blogCategory ? blogCategoryHref(item.blogCategory) : null;
    default:
      return item.url ? countryHref(country, item.url) : null;
  }
}

/**
 * What an item with no target becomes.
 *
 * `null` — drop it — unless it heads a group, where it is still the label the
 * dropdown opens from and only stops being clickable itself. `#` is how the
 * renderer is told that: a heading, not a link.
 */
export function resolvedHref(href: string | null, hasChildren: boolean): string | null {
  if (href) return href;
  return hasChildren ? '#' : null;
}

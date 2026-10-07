import 'server-only';
import { cache } from 'react';
import { prisma } from '@/lib/db/prisma';
import { navHref, resolvedHref } from '@/lib/cms/nav-links';
import { getUrlSnapshot } from '@/lib/urls/load';
import type { CountryContext } from '@/lib/country/types';
import type { NavigationLocation } from '@prisma/client';

export type ResolvedNavItem = {
  id: string;
  label: string;
  href: string;
  description: string | null;
  /** A name from the shipped icon set, shown in dropdowns and mega menus. */
  icon: string | null;
  /**
   * An uploaded image shown in place of the icon. A vendor logo has no
   * equivalent in the shipped set, and a mega menu of products is mostly
   * logos.
   */
  imageUrl: string | null;
  imageAlt: string | null;
  /** How big that image renders. Blank means the icon's own size. */
  imageSize: string;
  openInNewTab: boolean;
  isHighlighted: boolean;
  /**
   * Render this item's children as a panel of columns rather than a list. Each
   * child then becomes a column heading and its own children the links under
   * it — the same tree, read one level deeper.
   */
  megaMenu: boolean;
  megaColumns: number;
  /** How wide the panel is. Blank keeps the built-in width. */
  megaWidth: string;
  megaAlign: 'center' | 'left' | 'screen';
  children: ResolvedNavItem[];
};

export type ResolvedNavigation = {
  id: string;
  name: string;
  slug: string;
  items: ResolvedNavItem[];
};

const navInclude = {
  image: { select: { url: true, altText: true } },
  page: { select: { id: true, slug: true, deletedAt: true } },
  product: { select: { id: true, slug: true, deletedAt: true } },
  blogPost: { select: { id: true, slug: true, deletedAt: true } },
  blogCategory: { select: { id: true, slug: true } },
};

/** Loads every menu in a location for one market, with items resolved to real hrefs. */
export const getNavigations = cache(
  async (country: CountryContext, location: NavigationLocation): Promise<ResolvedNavigation[]> => {
    // Menu links resolve through the URL registry; make sure this request
    // reads the current snapshot before any href is built.
    await getUrlSnapshot();
    const menus = await prisma.navigation.findMany({
      where: { location, countryId: country.id },
      orderBy: { createdAt: 'asc' },
      include: {
        items: {
          where: { isVisible: true },
          orderBy: { sortOrder: 'asc' },
          include: navInclude,
        },
      },
    });

    return menus.map((menu) => {
      const byParent = new Map<string | null, typeof menu.items>();
      for (const item of menu.items) {
        const key = item.parentId ?? null;
        const list = byParent.get(key) ?? [];
        list.push(item);
        byParent.set(key, list);
      }

      /*
       * An item whose target is gone is dropped rather than rendered as a dead
       * link — unless it has children, where it is still the heading its
       * dropdown opens from and only stops being clickable itself.
       */
      const build = (parentId: string | null): ResolvedNavItem[] =>
        (byParent.get(parentId) ?? []).flatMap((item) => {
          const children = build(item.id);
          const href = resolvedHref(navHref(item, country), children.length > 0);
          if (!href) return [];

          return [
            {
              id: item.id,
              label: item.label,
              href,
              description: item.description,
              icon: item.icon,
              imageUrl: item.image?.url ?? null,
              imageAlt: item.image?.altText ?? null,
              imageSize: item.imageSize,
              openInNewTab: item.openInNewTab,
              isHighlighted: item.isHighlighted,
              megaMenu: item.megaMenu,
              megaColumns: Math.min(Math.max(item.megaColumns, 1), 6),
              megaWidth: item.megaWidth,
              megaAlign:
                item.megaAlign === 'left' || item.megaAlign === 'screen'
                  ? item.megaAlign
                  : 'center',
              children,
            },
          ];
        });

      return { id: menu.id, name: menu.name, slug: menu.slug, items: build(null) };
    });
  },
);

export const getPrimaryNavigation = cache(
  async (country: CountryContext): Promise<ResolvedNavItem[]> => {
    const menus = await getNavigations(country, 'HEADER');
    return menus[0]?.items ?? [];
  },
);

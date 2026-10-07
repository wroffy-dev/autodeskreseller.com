import { describe, it, expect } from 'vitest';
import { navHref, resolvedHref, type LinkableItem } from '@/lib/cms/nav-links';
import type { CountryContext } from '@/lib/country/types';

/**
 * Where a menu item points.
 *
 * The bug this pins: deleting a page does not delete the menu item pointing at
 * it. The page is parked under `about-deleted-…` and waits in the recycle bin,
 * and the menu went on resolving the row — so the header offered a link
 * straight to a 404, which from the other side of the screen is a submenu link
 * that does not work.
 */

const root = { id: 'c1', slug: '', code: 'IN', prefixes: [] } as unknown as CountryContext;
const uae = { id: 'c2', slug: 'ae', code: 'AE', prefixes: ['ae'] } as unknown as CountryContext;

const item = (over: Partial<LinkableItem>): LinkableItem => ({
  linkType: 'INTERNAL',
  url: null,
  page: null,
  product: null,
  blogPost: null,
  blogCategory: null,
  ...over,
});

const live = (slug: string) => ({ id: `id-${slug}`, slug, deletedAt: null });
const binned = (slug: string) => ({ id: `id-${slug}`, slug, deletedAt: new Date('2026-09-22') });

describe('a live target', () => {
  it('resolves inside the market being viewed', () => {
    expect(navHref(item({ linkType: 'PAGE', page: live('about') }), root)).toBe('/about');
    expect(navHref(item({ linkType: 'PAGE', page: live('about') }), uae)).toBe('/ae/about');
  });

  it('knows where each kind of thing lives', () => {
    expect(navHref(item({ linkType: 'PRODUCT', product: live('dropbox-plus') }), root)).toBe(
      '/products/dropbox-plus',
    );
    expect(navHref(item({ linkType: 'BLOG_POST', blogPost: live('a-post') }), root)).toBe(
      '/blog/a-post',
    );
    expect(
      navHref(item({ linkType: 'BLOG_CATEGORY', blogCategory: { id: 'id-news', slug: 'news' } }), root),
    ).toBe('/blog/category/news');
  });

  it('carries a typed path into the market, and leaves an external URL alone', () => {
    expect(navHref(item({ linkType: 'INTERNAL', url: '/pricing' }), uae)).toBe('/ae/pricing');
    expect(navHref(item({ linkType: 'EXTERNAL', url: 'https://example.com' }), uae)).toBe(
      'https://example.com',
    );
  });
});

describe('a target in the recycle bin', () => {
  it('is treated as no target at all', () => {
    // Not `/about-deleted-1758…`, which is where the row is parked and where
    // the menu used to send people.
    expect(navHref(item({ linkType: 'PAGE', page: binned('about-deleted-1758') }), root)).toBeNull();
    expect(
      navHref(item({ linkType: 'PRODUCT', product: binned('plus-deleted-1758') }), root),
    ).toBeNull();
    expect(
      navHref(item({ linkType: 'BLOG_POST', blogPost: binned('post-deleted-1758') }), root),
    ).toBeNull();
  });

  it('is no target when the row is gone entirely, either', () => {
    expect(navHref(item({ linkType: 'PAGE', page: null }), root)).toBeNull();
    expect(navHref(item({ linkType: 'INTERNAL', url: null }), root)).toBeNull();
    expect(navHref(item({ linkType: 'INTERNAL', url: '' }), root)).toBeNull();
  });
});

describe('what an item with no target becomes', () => {
  it('is dropped when it is a leaf', () => {
    // A link that goes nowhere is worse than one link fewer.
    expect(resolvedHref(null, false)).toBeNull();
  });

  it('stays as a heading when it opens a dropdown', () => {
    // Its own page may be gone, but it is still the label the menu opens from,
    // and dropping it would take its working children with it.
    expect(resolvedHref(null, true)).toBe('#');
  });

  it('is left alone when it has a target', () => {
    expect(resolvedHref('/about', false)).toBe('/about');
    expect(resolvedHref('/about', true)).toBe('/about');
  });
});

/**
 * How wide the mega panel is, and which mark sits beside an item.
 *
 * Both are stored values that reach a `style` attribute, so both go through a
 * validator first — and both fall back to what the panel already looked like
 * rather than to nothing.
 */
describe('mega menu sizing', () => {
  it('takes a width a person would type', async () => {
    const { cssLength } = await import('@/lib/cms/chrome');
    for (const value of ['48rem', '900px', '90%', '80vw']) {
      expect(cssLength(value), value).toBe(value);
    }
  });

  it('refuses a width that is not one, so the panel keeps its own', async () => {
    const { cssLength } = await import('@/lib/cms/chrome');
    for (const value of ['', 'wide', '64', 'calc(100% - 2rem)', '64rem;position:fixed']) {
      expect(cssLength(value), value).toBeNull();
    }
  });
});

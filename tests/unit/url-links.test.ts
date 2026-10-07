import { afterEach, describe, expect, it } from 'vitest';
import {
  blogArchiveHref,
  contentHref,
  pageHref,
  postHref,
  productHref,
  registeredLink,
} from '@/lib/urls/links';
import {
  clearUrlSnapshot,
  entityKey,
  patternScopeKey,
  resolvePattern,
  setUrlSnapshot,
  type UrlSnapshot,
} from '@/lib/urls/snapshot';

const IN = { id: 'in', slug: '', isDefault: true };
const AE = { id: 'ae', slug: 'ae' };

type Route = { type: UrlSnapshot['routes'] extends ReadonlyMap<string, infer R> ? R : never };

function snapshot(options: {
  enabled?: boolean;
  version?: number;
  patterns?: Record<string, string>;
  routes?: Array<Route['type']>;
  aliases?: Record<string, { entityId: string; countryId: string }>;
  groups?: Array<{ pageId: string; group: string; countryId: string }>;
}): UrlSnapshot {
  const routes = options.routes ?? [];
  return {
    version: options.version ?? 1,
    enabled: options.enabled ?? true,
    rootCountryId: 'in',
    countries: [
      { id: 'in', slug: '', isDefault: true },
      { id: 'ae', slug: 'ae', isDefault: false },
    ],
    patterns: new Map(Object.entries(options.patterns ?? {})),
    routes: new Map(routes.map((route) => [entityKey(route.entityId, route.countryId), route])),
    byKey: new Map(routes.map((route) => [route.path.toLowerCase(), route])),
    aliases: new Map(Object.entries(options.aliases ?? {})),
    pageGroup: new Map((options.groups ?? []).map((entry) => [entry.pageId, entry.group])),
    groupMember: new Map((options.groups ?? []).map((entry) => [`${entry.group}|${entry.countryId}`, entry.pageId])),
  };
}

afterEach(() => clearUrlSnapshot());

describe('pattern precedence', () => {
  const snap = snapshot({
    patterns: {
      [patternScopeKey('PRODUCT', null)]: '/{slug}',
      [patternScopeKey('PRODUCT', 'ae')]: '/software/{slug}',
    },
  });

  it('uses a market’s own pattern, then the global one, then the built-in default', () => {
    expect(resolvePattern(snap, 'PRODUCT', 'ae')).toBe('/software/{slug}');
    expect(resolvePattern(snap, 'PRODUCT', 'in')).toBe('/{slug}');
    expect(resolvePattern(snap, 'BLOG_POST', 'in')).toBe('/blog/{slug}');
    expect(resolvePattern(null, 'PRODUCT', 'ae')).toBe('/products/{slug}');
  });

  it('never gives pages a pattern: a page’s slug is its path', () => {
    expect(resolvePattern(snap, 'PAGE', 'in')).toBe('/{slug}');
  });
});

describe('links while the registry is off', () => {
  it('are the addresses the site has always used', () => {
    expect(productHref(IN, { id: 'p1', slug: 'autocad' })).toBe('/products/autocad');
    expect(productHref(AE, { id: 'p1', slug: 'autocad' })).toBe('/ae/products/autocad');
    expect(pageHref(AE, { id: 'g1', slug: 'pricing' })).toBe('/ae/pricing');
    expect(postHref({ id: 'b1', slug: 'article' })).toBe('/blog/article');
    expect(blogArchiveHref()).toBe('/blog');
  });

  it('ignore saved patterns and routes, so switching off is a clean rollback', () => {
    setUrlSnapshot(
      snapshot({
        enabled: false,
        patterns: { [patternScopeKey('PRODUCT', null)]: '/{slug}' },
        routes: [{ type: 'PRODUCT', entityId: 'p1', countryId: 'in', path: '/software/autocad-lt' }],
      }),
    );
    expect(productHref(IN, { id: 'p1', slug: 'autocad' })).toBe('/products/autocad');
    expect(registeredLink(IN, '/products/autocad')).toBeNull();
  });
});

describe('links from the registry', () => {
  it('use the registered address, whatever the slug says', () => {
    setUrlSnapshot(
      snapshot({
        routes: [
          { type: 'PRODUCT', entityId: 'p1', countryId: 'in', path: '/software/autocad-lt' },
          { type: 'PRODUCT', entityId: 'p1', countryId: 'ae', path: '/ae/autocad' },
        ],
      }),
    );
    expect(productHref(IN, { id: 'p1', slug: 'autocad' })).toBe('/software/autocad-lt');
    expect(productHref(AE, { id: 'p1', slug: 'autocad' })).toBe('/ae/autocad');
  });

  it('fall back to the market’s pattern for content without a route', () => {
    setUrlSnapshot(snapshot({ patterns: { [patternScopeKey('PRODUCT', 'ae')]: '/{slug}' } }));
    expect(productHref(AE, { id: 'p2', slug: 'box' })).toBe('/ae/box');
    expect(productHref(IN, { id: 'p2', slug: 'box' })).toBe('/products/box');
  });

  it('keep the blog root-only, under its own pattern', () => {
    setUrlSnapshot(
      snapshot({
        patterns: { [patternScopeKey('BLOG_POST', null)]: '/insights/{slug}' },
        routes: [{ type: 'BLOG_POST', entityId: 'b1', countryId: 'in', path: '/insights/article' }],
      }),
    );
    expect(postHref({ id: 'b1', slug: 'article' })).toBe('/insights/article');
    expect(postHref({ id: 'b2', slug: 'other' })).toBe('/insights/other');
    expect(contentHref('BLOG_POST', AE, { id: 'b1', slug: 'article' })).toBe('/insights/article');
  });
});

describe('links an editor typed', () => {
  const routes = [
    { type: 'PRODUCT' as const, entityId: 'p1', countryId: 'in', path: '/autocad' },
    { type: 'PRODUCT' as const, entityId: 'p1', countryId: 'ae', path: '/ae/software/autocad' },
    { type: 'PAGE' as const, entityId: 'page-in', countryId: 'in', path: '/pricing' },
    { type: 'PAGE' as const, entityId: 'page-ae', countryId: 'ae', path: '/ae/plans' },
    { type: 'BLOG_POST' as const, entityId: 'b1', countryId: 'in', path: '/blog/article' },
  ];

  it('follow a moved address straight to where it lives now', () => {
    setUrlSnapshot(snapshot({ routes, aliases: { '/products/autocad': { entityId: 'p1', countryId: 'in' } } }));
    expect(registeredLink(IN, '/products/autocad')).toBe('/autocad');
    expect(registeredLink(IN, '/Products/AutoCAD/')).toBe('/autocad');
  });

  it('find another market’s address by identity, not by slug', () => {
    setUrlSnapshot(
      snapshot({
        routes,
        groups: [
          { pageId: 'page-in', group: 'g1', countryId: 'in' },
          { pageId: 'page-ae', group: 'g1', countryId: 'ae' },
        ],
      }),
    );
    expect(registeredLink(AE, '/autocad')).toBe('/ae/software/autocad');
    expect(registeredLink(AE, '/pricing')).toBe('/ae/plans');
    expect(registeredLink(AE, '/blog/article')).toBe('/blog/article');
  });

  it('leave unknown and invalid paths to the caller', () => {
    setUrlSnapshot(snapshot({ routes }));
    expect(registeredLink(IN, '/nowhere')).toBeNull();
    expect(registeredLink(IN, '/a/../b')).toBeNull();
    expect(registeredLink(AE, '/pricing')).toBeNull();
  });
});

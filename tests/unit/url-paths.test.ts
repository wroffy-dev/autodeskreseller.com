import { describe, expect, it } from 'vitest';
import {
  checkDestination,
  checkPattern,
  checkRelativePath,
  fillPattern,
  joinMarket,
  keyFromSegments,
  pathKey,
  sanitiseLoggedPath,
  sanitiseReferrer,
  stripMarket,
  withForwardedQuery,
} from '@/lib/urls/path';
import { parseCsv, readImport, toCsv, CSV_COLUMNS } from '@/lib/urls/csv';
import { canonicalHostRedirect } from '@/lib/seo/site-address';

const rules = { marketPrefixes: ['ae', 'uk'] };

describe('path keys', () => {
  it('normalises case, trailing and doubled slashes to one key', () => {
    expect(pathKey('/AutoCAD/')).toBe('/autocad');
    expect(pathKey('//software///AutoCAD-LT')).toBe('/software/autocad-lt');
    expect(pathKey('/')).toBe('/');
    expect(pathKey('/autocad?utm_source=x#top')).toBe('/autocad');
  });

  it('decodes percent-encoding before comparing', () => {
    expect(pathKey('/auto%63ad')).toBe('/autocad');
  });

  it('refuses traversal, encoded separators, control characters and bad encoding', () => {
    expect(pathKey('/a/../admin')).toBeNull();
    expect(pathKey('/a/%2e%2e/admin')).toBeNull();
    expect(pathKey('/./a')).toBeNull();
    expect(pathKey('/a%2Fb')).toBeNull();
    expect(pathKey('/a%5Cb')).toBeNull();
    expect(pathKey('/a%00b')).toBeNull();
    expect(pathKey('/%E0%A4%A')).toBeNull();
  });

  it('keys decoded router segments the same way', () => {
    expect(keyFromSegments(['Products', 'AutoCAD'])).toBe('/products/autocad');
    expect(keyFromSegments(['..', 'x'])).toBeNull();
    expect(keyFromSegments(['a/b'])).toBeNull();
  });
});

describe('market prefixes', () => {
  it('joins and strips a market prefix', () => {
    expect(joinMarket('', '/autocad')).toBe('/autocad');
    expect(joinMarket('ae', '/autocad')).toBe('/ae/autocad');
    expect(joinMarket('ae', '/')).toBe('/ae');
    expect(joinMarket('', '')).toBe('/');
    expect(stripMarket('ae', '/ae/products/autocad')).toBe('/products/autocad');
    expect(stripMarket('ae', '/ae')).toBe('/');
    expect(stripMarket('', '/autocad')).toBe('/autocad');
    // Only a whole first segment is a prefix.
    expect(stripMarket('ae', '/aero/x')).toBe('/aero/x');
  });
});

describe('editor paths', () => {
  it('accepts nested lower-case paths', () => {
    expect(checkRelativePath('/software/autocad-lt', rules)).toEqual({
      ok: true,
      relative: '/software/autocad-lt',
      notes: [],
    });
  });

  it('tidies what is unambiguous and says so', () => {
    const result = checkRelativePath(' Software//AutoCAD LT/ ', rules);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.relative).toBe('/software/autocad-lt');
      expect(result.notes.join(' ')).toMatch(/hyphens/);
      expect(result.notes.join(' ')).toMatch(/lower case/);
    }
  });

  it('refuses the home page, full URLs and backslashes', () => {
    expect(checkRelativePath('/', rules).ok).toBe(false);
    expect(checkRelativePath('https://example.com/x', rules).ok).toBe(false);
    expect(checkRelativePath('//evil.example/x', rules).ok).toBe(false);
    expect(checkRelativePath('a\\b', rules).ok).toBe(false);
  });

  it('refuses characters and segments a URL should not have', () => {
    for (const input of ['/a?b', '/a#b', '/a%2fb', '/über', '/-dash', '/dash-', '/a/../b', '/a<b']) {
      expect(checkRelativePath(input, rules).ok, input).toBe(false);
    }
  });

  it('refuses system routes, file-like segments and market prefixes as a first segment', () => {
    for (const input of ['/admin/x', '/api/x', '/login', '/_next/x', '/uploads/x', '/sitemap.xml', '/ae/autocad', '/UK']) {
      expect(checkRelativePath(input, rules).ok, input).toBe(false);
    }
    // …but the same words deeper in a path are ordinary segments.
    expect(checkRelativePath('/software/api', rules).ok).toBe(true);
  });

  it('bounds depth and length', () => {
    expect(checkRelativePath(`/${Array.from({ length: 9 }, () => 'a').join('/')}`, rules).ok).toBe(false);
    expect(checkRelativePath(`/${'a'.repeat(121)}`, rules).ok).toBe(false);
  });
});

describe('patterns', () => {
  const needsSlug = { needsSlug: true };

  it('accepts prefix removal, custom prefixes and nesting', () => {
    expect(checkPattern('/{slug}', rules, needsSlug)).toEqual({ ok: true, pattern: '/{slug}' });
    expect(checkPattern('software/{slug}', rules, needsSlug)).toEqual({ ok: true, pattern: '/software/{slug}' });
    expect(checkPattern('/Insights/{slug}/', rules, needsSlug)).toEqual({ ok: true, pattern: '/insights/{slug}' });
  });

  it('needs {slug} exactly once, as a whole segment', () => {
    expect(checkPattern('/software', rules, needsSlug).ok).toBe(false);
    expect(checkPattern('/{slug}/{slug}', rules, needsSlug).ok).toBe(false);
    expect(checkPattern('/soft-{slug}', rules, needsSlug).ok).toBe(false);
    expect(checkPattern('/{Slug}', rules, needsSlug)).toEqual({ ok: true, pattern: '/{slug}' });
  });

  it('keeps slugless patterns plain', () => {
    expect(checkPattern('/insights', rules, { needsSlug: false })).toEqual({ ok: true, pattern: '/insights' });
    expect(checkPattern('/{slug}', rules, { needsSlug: false }).ok).toBe(false);
    expect(checkPattern('/', rules, { needsSlug: false }).ok).toBe(false);
  });

  it('refuses reserved and market-prefixed patterns', () => {
    expect(checkPattern('/admin/{slug}', rules, needsSlug).ok).toBe(false);
    expect(checkPattern('/ae/{slug}', rules, needsSlug).ok).toBe(false);
  });

  it('fills the slug in, including a nested page slug', () => {
    expect(fillPattern('/software/{slug}', 'autocad-lt')).toBe('/software/autocad-lt');
    expect(fillPattern('/{slug}', 'autocad')).toBe('/autocad');
    expect(fillPattern('/{slug}', 'about/team')).toBe('/about/team');
    expect(fillPattern('/blog', 'ignored')).toBe('/blog');
  });
});

describe('redirect destinations', () => {
  it('accepts site paths and http(s) URLs', () => {
    expect(checkDestination('/pricing')).toEqual({ ok: true, destination: '/pricing', external: false });
    expect(checkDestination('pricing')).toEqual({ ok: true, destination: '/pricing', external: false });
    expect(checkDestination('https://example.com/a?b=1')).toEqual({
      ok: true,
      destination: 'https://example.com/a?b=1',
      external: true,
    });
  });

  it('refuses script, data, protocol-relative and malformed destinations', () => {
    for (const input of ['javascript:alert(1)', 'data:text/html,x', '//evil.example', 'mailto:a@b.c', '/a b', '', '/a/../b']) {
      expect(checkDestination(input).ok, input).toBe(false);
    }
  });
});

describe('query strings through redirects', () => {
  it('keeps every parameter on this site, UTMs included', () => {
    const incoming = new URLSearchParams('utm_source=news&utm_campaign=spring&ref=abc');
    expect(withForwardedQuery('/autocad', incoming)).toBe('/autocad?utm_source=news&utm_campaign=spring&ref=abc');
  });

  it('forwards only attribution parameters off-site', () => {
    const incoming = new URLSearchParams('utm_source=news&gclid=G1&token=secret');
    expect(withForwardedQuery('https://partner.example/x', incoming)).toBe(
      'https://partner.example/x?utm_source=news&gclid=G1',
    );
  });

  it('lets the destination’s own parameters win and keeps its fragment', () => {
    expect(withForwardedQuery('/pricing?plan=team#faq', { plan: 'solo', utm_medium: 'email' })).toBe(
      '/pricing?plan=team&utm_medium=email#faq',
    );
  });

  it('drops the router’s cache-busting parameter and handles repeated values', () => {
    expect(withForwardedQuery('/a', { _rsc: '1x', tag: ['x', 'y'] })).toBe('/a?tag=x&tag=y');
    expect(withForwardedQuery('/a', {})).toBe('/a');
  });
});

describe('what URL Health stores', () => {
  it('drops query strings and normalises paths', () => {
    expect(sanitiseLoggedPath('/Old-Page/?email=a@b.c')).toEqual({ path: '/old-page', key: '/old-page' });
    expect(sanitiseLoggedPath('/a/../b')).toBeNull();
  });

  it('keeps only origin and path of a referrer', () => {
    expect(sanitiseReferrer('https://news.example/story?id=7&session=x')).toBe('https://news.example/story');
    expect(sanitiseReferrer('javascript:alert(1)')).toBeNull();
    expect(sanitiseReferrer('not a url')).toBeNull();
    expect(sanitiseReferrer(null)).toBeNull();
  });
});

describe('CSV', () => {
  it('parses quotes, embedded commas, newlines and CRLF', () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi"""\n"multi\nline",z\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
      ['multi\nline', 'z'],
    ]);
  });

  it('never exports a cell a spreadsheet would run as a formula', () => {
    const csv = toCsv([['name'], ['=HYPERLINK("http://evil")'], ['+1'], ['@x'], ['/plain']]);
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(csv).toContain(`'+1`);
    expect(csv).toContain(`'@x`);
    expect(csv).toContain('/plain');
  });

  it('round-trips an export into an import keyed by id, market and target', () => {
    const exported = toCsv([
      [...CSV_COLUMNS],
      ['p1', 'IN', 'PRODUCT', 'AutoCAD', 'live', 'PATTERN', '/products/autocad', '/products/autocad', '/autocad'],
      ['p1', 'ae', 'PRODUCT', 'AutoCAD', 'live', 'PATTERN', '/ae/products/autocad', '/ae/products/autocad', ''],
      ['p2', 'IN', 'PAGE', 'About', 'live', 'CUSTOM', '/about-us', '/about', '@pattern'],
    ]);
    const parsed = readImport(exported);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rows).toEqual([
      { line: 2, entityId: 'p1', country: 'IN', type: 'PRODUCT', target: '/autocad' },
      { line: 3, entityId: 'p1', country: 'AE', type: 'PRODUCT', target: '' },
      { line: 4, entityId: 'p2', country: 'IN', type: 'PAGE', target: '@pattern' },
    ]);
  });

  it('needs the key columns and bounds the size of one import', () => {
    expect(readImport('name,path\nx,/y').ok).toBe(false);
    expect(readImport('').ok).toBe(false);
    const big = ['entity_id,country,target_path', ...Array.from({ length: 5001 }, (_, i) => `e${i},IN,/x${i}`)].join('\n');
    expect(readImport(big).ok).toBe(false);
  });
});

describe('the canonical host', () => {
  it('sends the bare domain to www when www is the site address, keeping path and query', () => {
    expect(canonicalHostRedirect('https://www.autodeskreseller.com', 'autodeskreseller.com', '/pricing?utm_source=x')).toBe(
      'https://www.autodeskreseller.com/pricing?utm_source=x',
    );
  });

  it('sends www to the bare domain when the bare domain is the site address', () => {
    expect(canonicalHostRedirect('https://example.com', 'www.example.com:443', '/')).toBe('https://example.com/');
  });

  it('leaves the canonical host, other hosts and local addresses alone', () => {
    expect(canonicalHostRedirect('https://www.example.com', 'www.example.com', '/')).toBeNull();
    expect(canonicalHostRedirect('https://www.example.com', 'internal-service', '/')).toBeNull();
    expect(canonicalHostRedirect('https://www.example.com', '10.0.0.4:3000', '/')).toBeNull();
    expect(canonicalHostRedirect('http://localhost:3000', 'www.localhost', '/')).toBeNull();
    expect(canonicalHostRedirect('not a url', 'example.com', '/')).toBeNull();
    expect(canonicalHostRedirect('https://www.example.com', null, '/')).toBeNull();
  });
});

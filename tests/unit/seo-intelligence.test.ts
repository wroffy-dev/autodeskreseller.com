import { describe, it, expect } from 'vitest';
import { auditDocument, overallScore, OVERALL_WEIGHTS, siteScores, siteScoresFromTotals } from '@/lib/seo/score-overall';
import { checkBucket, scoreState, SCORE_STATE_LABELS, auditHref, entityTypeFromSlug, editPathFor } from '@/lib/seo/score-state';
import { allChecks, groupChecks, storedIssues, topIssues } from '@/lib/seo/recommendations';
import { evaluateCheck, scoreChecks, type SeoCheck } from '@/lib/seo/checks';
import { analyzeDocument } from '@/lib/seo/analysis';
import { schemaGapFix, schemaGaps } from '@/lib/seo/schema-analysis';
import { SEO_CHECKS } from '@/lib/seo/score-seo';
import { AEO_CHECKS } from '@/lib/seo/score-aeo';
import { GEO_CHECKS } from '@/lib/seo/score-geo';
import {
  cleanKeyword,
  duplicateKeywordFields,
  effectiveKeywords,
  keywordColumns,
  keywordKey,
  primaryKeywords,
} from '@/lib/seo/keywords';
import { parseRobots, blockingRule } from '@/lib/seo/robots-match';
import { htmlToNodes, htmlToText } from '@/lib/seo/content/html';
import { indexEntry, withCollisions } from '@/lib/seo/intelligence/collisions';
import { pageDraftSchema, overlay } from '@/lib/seo/drafts';
import { pageInputSchema } from '@/lib/validation/page';
import { blogPostSchema, blogCategorySchema } from '@/lib/validation/blog';
import { countrySettingsSchema, productCountrySchema } from '@/lib/validation/country';
import type { CheckResult, SeoAuditResult, SeoDocument } from '@/lib/seo/types';
import { perfectPage, ROOT_MARKET, SECOND_MARKET } from './seo-fixtures';

const check = (result: SeoAuditResult, id: string): CheckResult => {
  const found = allChecks(result).find((entry) => entry.id === id);
  if (!found) throw new Error(`No check ${id}`);
  return found;
};

const inRange = (result: SeoAuditResult) => {
  for (const score of [result.overall, result.seo.score, result.aeo.score, result.geo.score]) {
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
    expect(Number.isInteger(score)).toBe(true);
  }
};

describe('a page that does everything right', () => {
  const result = auditDocument(perfectPage());

  it('scores at the top of every scale, with nothing to fix', () => {
    inRange(result);
    expect(result.seo.score).toBeGreaterThanOrEqual(95);
    expect(result.aeo.score).toBeGreaterThanOrEqual(95);
    expect(result.geo.score).toBeGreaterThanOrEqual(95);
    expect(result.overall).toBeGreaterThanOrEqual(95);
    expect(result.counts.critical).toBe(0);
    expect(result.counts.warnings).toBe(0);
    expect(result.flags).toMatchObject({
      live: true,
      indexable: true,
      missingMetadata: false,
      missingSchema: false,
      missingKeywords: false,
      indexingConflict: false,
    });
  });

  it('is deterministic: the same document always gets the same result', () => {
    expect(auditDocument(perfectPage())).toEqual(result);
  });

  it('shows its working: every check says how many points it earned of how many', () => {
    for (const entry of allChecks(result)) {
      expect(entry.pointsEarned).toBeGreaterThanOrEqual(0);
      expect(entry.pointsEarned).toBeLessThanOrEqual(entry.pointsAvailable);
      expect(entry.message.length).toBeGreaterThan(0);
      if (entry.status === 'INFO' || entry.status === 'NOT_APPLICABLE') expect(entry.pointsAvailable).toBe(0);
    }
    const earned = result.seo.checks.reduce((sum, entry) => sum + entry.pointsEarned, 0);
    const available = result.seo.checks.reduce((sum, entry) => sum + entry.pointsAvailable, 0);
    expect(result.seo.score).toBe(Math.round((earned / available) * 100));
  });

  it('finds each primary keyword where it was placed', () => {
    const [first] = result.keywords;
    expect(first?.keyword).toBe('AutoCAD LT');
    expect(first?.placements).toMatchObject({ title: true, description: true, url: true, h1: true, firstParagraph: true });
    expect(first?.occurrences).toBeGreaterThan(0);
  });
});

describe('missing metadata', () => {
  const doc = perfectPage();
  const bare = auditDocument({
    ...doc,
    meta: {
      ...doc.meta,
      title: 'Example',
      ownTitle: 'Example',
      titleSource: 'default',
      description: '',
      descriptionSource: 'default',
    },
  });

  it('fails the title and description as critical issues and flags the URL', () => {
    inRange(bare);
    expect(check(bare, 'seo.description.present')).toMatchObject({ status: 'FAIL', severity: 'critical' });
    expect(bare.counts.critical).toBeGreaterThan(0);
    expect(bare.flags.missingMetadata).toBe(true);
    expect(bare.seo.score).toBeLessThan(auditDocument(doc).seo.score);
  });

  it('does not charge twice for one missing field', () => {
    // A default title is a missing title, not also a badly sized one.
    expect(check(bare, 'seo.title.length').status).toBe('NOT_APPLICABLE');
    expect(check(bare, 'seo.description.length').status).toBe('NOT_APPLICABLE');
  });

  it('says how to fix each failure', () => {
    for (const entry of [...groupChecks(allChecks(bare)).critical, ...groupChecks(allChecks(bare)).warnings]) {
      expect(entry.recommendation, entry.id).toBeTruthy();
    }
  });
});

describe('noindex', () => {
  const indexable = perfectPage();
  const hidden = auditDocument(
    perfectPage({
      robots: { ...indexable.robots, noIndex: true, noIndexReasons: ['entity'], inSitemap: false, sitemapExclusion: null },
    }),
  );

  it('is reported as a deliberate exclusion, never as a failure', () => {
    expect(check(hidden, 'seo.tech.indexable').status).toBe('INFO');
    expect(hidden.flags).toMatchObject({ indexable: false, intentionallyExcluded: true });
    expect(hidden.seo.score).toBe(auditDocument(indexable).seo.score);
    expect(hidden.overall).toBe(auditDocument(indexable).overall);
  });

  it('is left out of the site score', () => {
    const rows = [
      { kind: 'page' as const, indexable: true, seoScore: 90, aeoScore: 90, geoScore: 90, overallScore: 90 },
      { kind: 'page' as const, indexable: false, seoScore: 10, aeoScore: 10, geoScore: 10, overallScore: 10 },
    ];
    expect(siteScores(rows)?.overall).toBe(90);
    expect(siteScores(rows)?.counted).toBe(1);
  });
});

describe('primary keywords', () => {
  it('without any, only the check that asks for them loses points', () => {
    const result = auditDocument(perfectPage({ meta: { ...perfectPage().meta, keywords: [], keywordsSource: 'none' } }));
    inRange(result);
    expect(result.flags.missingKeywords).toBe(true);
    expect(check(result, 'seo.keywords.defined').status).not.toBe('PASS');
    for (const id of ['seo.title.keyword', 'seo.h1.keyword', 'seo.keyword.body', 'seo.keyword.density']) {
      expect(check(result, id).status, id).toBe('NOT_APPLICABLE');
    }
    expect(result.keywords).toEqual([]);
  });

  it('a keyword that never appears is reported missing, and stuffing is caught', () => {
    const absent = auditDocument(
      perfectPage({ meta: { ...perfectPage().meta, keywords: ['sharepoint consulting'] } }),
    );
    expect(absent.keywords[0]?.status).toBe('missing');
    expect(check(absent, 'seo.keyword.body').status).toBe('FAIL');

    const stuffed = perfectPage();
    stuffed.content = [
      { type: 'heading', level: 1, text: 'AutoCAD LT' },
      { type: 'paragraph', text: Array.from({ length: 30 }, () => 'AutoCAD LT is AutoCAD LT.').join(' ') },
    ];
    const overused = auditDocument(stuffed);
    expect(check(overused, 'seo.keyword.density').status).toBe('FAIL');
  });

  it('are cleaned and compared without regard to case or spacing', () => {
    expect(cleanKeyword('  AutoCAD   LT  ')).toBe('AutoCAD LT');
    expect(keywordKey('AUTOCAD  LT')).toBe(keywordKey('autocad lt'));
    expect(primaryKeywords({ primaryKeyword1: ' a ', primaryKeyword2: '', primaryKeyword3: 'B' })).toEqual(['a', 'B']);
    expect(keywordColumns({ primaryKeyword1: '  x ', primaryKeyword2: '   ' })).toEqual({
      primaryKeyword1: 'x',
      primaryKeyword2: null,
      primaryKeyword3: null,
    });
  });

  it('refuses the same keyword twice, in any case', () => {
    expect(
      duplicateKeywordFields({ primaryKeyword1: 'AutoCAD', primaryKeyword2: ' autocad ', primaryKeyword3: 'Box' }),
    ).toEqual([{ field: 'primaryKeyword2', repeats: 1 }]);

    const page = pageInputSchema.safeParse({
      title: 'Pricing',
      slug: 'pricing',
      primaryKeyword1: 'AutoCAD pricing',
      primaryKeyword2: 'AUTOCAD PRICING',
    });
    expect(page.success).toBe(false);
    expect(page.error?.issues[0]?.path).toEqual(['primaryKeyword2']);

    const blank = pageInputSchema.parse({ title: 'Pricing', slug: 'pricing', primaryKeyword1: '', primaryKeyword2: '  ' });
    expect(blank.primaryKeyword1).toBeNull();

    expect(
      blogPostSchema.safeParse({ title: 'Post', slug: 'post', primaryKeyword1: 'a', primaryKeyword3: 'A' }).success,
    ).toBe(false);
    expect(blogCategorySchema.safeParse({ name: 'Guides', slug: 'guides', primaryKeyword1: 'x', primaryKeyword2: 'X' }).success).toBe(false);
  });

  it('a product market uses its own keywords, or the product’s when it sets none', () => {
    const shared = { primaryKeyword1: 'AutoCAD LT', primaryKeyword2: 'team storage' };
    expect(effectiveKeywords({ primaryKeyword1: 'AutoCAD UAE' }, shared)).toEqual({
      keywords: ['AutoCAD UAE'],
      source: 'market',
    });
    expect(effectiveKeywords({ primaryKeyword1: '  ', primaryKeyword2: null }, shared)).toEqual({
      keywords: ['AutoCAD LT', 'team storage'],
      source: 'shared',
    });
    expect(effectiveKeywords(null, null)).toEqual({ keywords: [], source: 'none' });

    const market = productCountrySchema.safeParse({
      productId: 'p1',
      countryId: 'c1',
      currency: 'aed',
      primaryKeyword1: 'AutoCAD UAE',
      primaryKeyword2: 'autocad uae',
    });
    expect(market.success).toBe(false);
  });
});

describe('empty content', () => {
  const empty = auditDocument(perfectPage({ content: [], schema: [] }));

  it('scores low, stays inside 0–100 and still explains every failure', () => {
    inRange(empty);
    expect(check(empty, 'seo.h1')).toMatchObject({ status: 'FAIL', severity: 'critical' });
    expect(check(empty, 'seo.content.length').status).toBe('FAIL');
    expect(empty.overall).toBeLessThan(70);
    for (const entry of allChecks(empty)) {
      if (entry.status === 'FAIL') expect(entry.recommendation, entry.id).toBeTruthy();
    }
  });

  it('flags the structured data a page should carry', () => {
    expect(empty.flags.missingSchema).toBe(true);
    expect(check(empty, 'seo.tech.structuredData').status).not.toBe('PASS');
  });

  it('does not ask a short page for FAQs it has no reason to have', () => {
    expect(check(empty, 'aeo.faq').status).toBe('NOT_APPLICABLE');
  });
});

describe('products', () => {
  const doc = perfectPage({
    entityType: 'PRODUCT_MARKET',
    entityId: 'prod_standard',
    kind: 'product',
    name: 'AutoCAD LT Standard',
    path: '/products/autocad-lt-standard',
    slug: 'products/autocad-lt-standard',
    product: {
      name: 'AutoCAD LT Standard',
      brand: 'AutoCAD',
      category: 'Cloud storage',
      sku: 'DBX-STD',
      shortDescription: '5 TB of shared storage for small teams.',
      descriptionWords: 180,
      currency: 'INR',
      price: '1250.00',
      annualPrice: '12500.00',
      priceNote: null,
      storage: '5 TB',
      users: '3+',
      specs: [{ label: 'Storage', value: '5 TB' }],
      features: ['180-day file recovery'],
      benefits: ['Replace file servers'],
      hasImage: true,
      imageAlt: 'AutoCAD LT Standard',
      galleryCount: 0,
      specsVisible: true,
    },
    schema: [
      ...perfectPage().schema,
      {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: 'AutoCAD LT Standard',
        brand: { '@type': 'Brand', name: 'AutoCAD' },
        offers: { '@type': 'Offer', price: '1250.00', priceCurrency: 'INR' },
      },
    ],
  });

  it('runs the product checks and names the schema a product needs', () => {
    const result = auditDocument(doc);
    inRange(result);
    expect(check(result, 'aeo.productFacts').status).not.toBe('NOT_APPLICABLE');
    const product = result.structuredData.items.find((item) => item.type === 'Product');
    expect(product).toMatchObject({ present: true, expected: true });
    expect(product?.missing).toContain('image');
    const gaps = schemaGaps(analyzeDocument(doc).schema);
    expect(schemaGapFix(gaps)).toContain('Product needs image');
  });

  it('skips the checks that only make sense for articles', () => {
    const result = auditDocument(doc);
    expect(check(result, 'aeo.author').status).toBe('NOT_APPLICABLE');
    expect(check(result, 'seo.links.external').status).toBe('NOT_APPLICABLE');
  });
});

describe('articles', () => {
  const article = perfectPage({
    entityType: 'BLOG_POST',
    entityId: 'post_migration',
    kind: 'article',
    path: '/blog/autocad-migration-checklist',
    slug: 'blog/autocad-migration-checklist',
    article: {
      author: null,
      authorVisible: false,
      publishedAt: '2026-01-10T09:00:00.000Z',
      updatedAt: '2026-09-01T09:00:00.000Z',
      datesVisible: true,
      category: 'Guides',
      tags: ['Migration'],
      excerpt: 'How to move a team to AutoCAD LT without losing a file.',
      hasFeaturedImage: true,
    },
  });

  it('asks for an author and more depth than a page', () => {
    const result = auditDocument(article);
    inRange(result);
    expect(check(result, 'aeo.author').status).not.toBe('PASS');
    expect(check(result, 'aeo.author').recommendation).toBeTruthy();
    // 800 words is what an article needs; the fixture has about 400.
    expect(check(result, 'seo.content.length').status).not.toBe('PASS');
  });

  it('credits a visible, described author', () => {
    const withAuthor = auditDocument({
      ...article,
      article: {
        ...article.article!,
        author: { name: 'Asha Rao', jobTitle: 'Head of migrations', url: 'https://www.example.com/team/asha', bio: true },
        authorVisible: true,
      },
    });
    expect(check(withAuthor, 'aeo.author').status).toBe('PASS');
  });
});

describe('structured data', () => {
  it('asks for FAQPage markup only where the page shows questions', () => {
    const noFaqMarkup = auditDocument(perfectPage({ schema: perfectPage().schema.filter((item) => item['@type'] !== 'FAQPage') }));
    expect(check(noFaqMarkup, 'aeo.faqMarkup').status).not.toBe('PASS');

    const noFaqs = perfectPage();
    noFaqs.content = noFaqs.content.filter((node) => node.type !== 'faq');
    noFaqs.schema = noFaqs.schema.filter((item) => item['@type'] !== 'FAQPage');
    const plain = auditDocument(noFaqs);
    expect(check(plain, 'aeo.faqMarkup').status).toBe('NOT_APPLICABLE');
    expect(plain.structuredData.items.find((item) => item.type === 'FAQPage')?.expected ?? false).toBe(false);
  });
});

describe('the score engine', () => {
  const doc = perfectPage();
  const analysis = analyzeDocument(doc);
  const base: Omit<SeoCheck, 'evaluate'> = {
    id: 'test.check',
    dimension: 'seo',
    category: 'content',
    label: 'Test',
    weight: 10,
    severity: 'improvement',
    applicableTo: 'all',
  };

  it('never lets a broken check fail an audit or award itself points', () => {
    const result = evaluateCheck({ ...base, evaluate: () => { throw new Error('boom'); } }, doc, analysis);
    expect(result).toMatchObject({ status: 'INFO', pointsAvailable: 0, pointsEarned: 0 });
  });

  it('clamps a warning’s share of points to 0–1', () => {
    const over = evaluateCheck({ ...base, evaluate: () => ({ status: 'WARNING', ratio: 5, message: 'x' }) }, doc, analysis);
    const under = evaluateCheck({ ...base, evaluate: () => ({ status: 'WARNING', ratio: -2, message: 'x' }) }, doc, analysis);
    expect(over.pointsEarned).toBe(10);
    expect(under.pointsEarned).toBe(0);
  });

  it('marks a check that does not fit the page as not applicable', () => {
    const result = evaluateCheck({ ...base, applicableTo: ['article'], evaluate: () => ({ status: 'FAIL', message: 'x' }) }, doc, analysis);
    expect(result.status).toBe('NOT_APPLICABLE');
    expect(result.pointsAvailable).toBe(0);
  });

  it('scores 0 when nothing applies and never leaves 0–100', () => {
    expect(scoreChecks([]).score).toBe(0);
    const rigged = scoreChecks([
      { ...base, status: 'PASS', pointsEarned: 50, pointsAvailable: 10, message: '', recommendation: null },
    ]);
    expect(rigged.score).toBe(100);
  });

  it('gives every check a unique id and a positive weight', () => {
    const all = [...SEO_CHECKS, ...AEO_CHECKS, ...GEO_CHECKS];
    expect(new Set(all.map((entry) => entry.id)).size).toBe(all.length);
    for (const entry of all) expect(entry.weight, entry.id).toBeGreaterThan(0);
  });

  it('keeps every score in range whatever a document lacks', () => {
    const variants: SeoDocument[] = [
      perfectPage({ kind: 'homepage', path: '/', slug: '' }),
      perfectPage({ kind: 'category', content: [] }),
      perfectPage({ kind: 'tag', content: [{ type: 'heading', level: 3, text: '' }] }),
      perfectPage({ kind: 'archive', archive: { itemCount: 0 } }),
      perfectPage({ status: { value: 'DRAFT', live: false, publishedAt: null, notServedReason: null } }),
      perfectPage({ social: { ...perfectPage().social, ogImage: null, twitterCard: 'summary' } }),
    ];
    for (const variant of variants) inRange(auditDocument(variant));
  });
});

describe('score states and the overall score', () => {
  it('draws the state boundaries where the spec puts them', () => {
    expect([0, 39, 40, 59, 60, 79, 80, 100].map(scoreState)).toEqual([
      'poor',
      'poor',
      'needs-improvement',
      'needs-improvement',
      'good',
      'good',
      'excellent',
      'excellent',
    ]);
    expect(SCORE_STATE_LABELS['needs-improvement']).toBe('Needs improvement');
  });

  it('blends SEO 50%, AEO 25% and GEO 25% by default', () => {
    expect(OVERALL_WEIGHTS).toEqual({ seo: 0.5, aeo: 0.25, geo: 0.25 });
    expect(overallScore({ seo: 80, aeo: 60, geo: 40 })).toBe(65);
    expect(overallScore({ seo: 100, aeo: 100, geo: 100 })).toBe(100);
    expect(overallScore({ seo: 0, aeo: 0, geo: 0 })).toBe(0);
  });

  it('takes other weights, and never leaves 0–100', () => {
    expect(overallScore({ seo: 80, aeo: 60, geo: 40 }, { seo: 1, aeo: 1, geo: 1 })).toBe(60);
    expect(overallScore({ seo: 80, aeo: 60, geo: 40 }, { seo: 0, aeo: 0, geo: 0 })).toBe(0);
    expect(overallScore({ seo: 500, aeo: 500, geo: 500 })).toBe(100);
    expect(overallScore({ seo: -50, aeo: -50, geo: -50 })).toBe(0);
  });

  it('weights the site score by kind of URL rather than averaging blindly', () => {
    const rows = [
      { kind: 'homepage' as const, indexable: true, seoScore: 90, aeoScore: 90, geoScore: 90, overallScore: 90 },
      { kind: 'tag' as const, indexable: true, seoScore: 30, aeoScore: 30, geoScore: 30, overallScore: 30 },
    ];
    // (90 × 3 + 30 × 0.5) / 3.5 = 81, where a plain average would say 60.
    expect(siteScores(rows)?.overall).toBe(81);
    expect(
      siteScoresFromTotals([
        { kind: 'homepage', count: 1, seo: 90, aeo: 90, geo: 90, overall: 90 },
        { kind: 'tag', count: 1, seo: 30, aeo: 30, geo: 30, overall: 30 },
      ]),
    ).toEqual(siteScores(rows));
    expect(siteScores([])).toBeNull();
  });

  it('files each check under Issues, Warnings, Suggestions or Passed', () => {
    expect(checkBucket({ status: 'FAIL', severity: 'critical' })).toBe('critical');
    expect(checkBucket({ status: 'FAIL', severity: 'improvement' })).toBe('warning');
    expect(checkBucket({ status: 'WARNING', severity: 'suggestion' })).toBe('suggestion');
    expect(checkBucket({ status: 'PASS', severity: 'critical' })).toBe('passed');
    expect(checkBucket({ status: 'INFO', severity: 'critical' })).toBe('info');
  });

  it('puts the costliest fixes first and stores only what did not pass', () => {
    const result = auditDocument(perfectPage({ content: [] }));
    const top = topIssues(allChecks(result), 3);
    expect(top[0]?.severity === 'critical' || top[0]?.status === 'FAIL').toBe(true);
    const stored = storedIssues(result);
    expect(stored.every((entry) => entry.status !== 'PASS' && entry.status !== 'NOT_APPLICABLE')).toBe(true);
  });
});

describe('markets stay separate', () => {
  it('compares a page only with the other live pages of its own market', () => {
    const india = perfectPage();
    const uaeCopy = perfectPage({
      entityId: 'page_uae',
      country: SECOND_MARKET,
      path: '/ae/autocad-lt',
      absoluteUrl: 'https://www.example.com/ae/autocad-lt',
    });
    const indiaTwin = perfectPage({ entityId: 'page_twin', path: '/autocad-lt-2' });

    const acrossMarkets = withCollisions(india, [indexEntry(uaeCopy)]);
    expect(acrossMarkets.collisions.title).toEqual([]);
    expect(acrossMarkets.collisions.content).toEqual([]);

    const sameMarket = withCollisions(india, [indexEntry(indiaTwin), indexEntry(india)]);
    expect(sameMarket.collisions.title.map((entry) => entry.path)).toEqual(['/autocad-lt-2']);
    expect(sameMarket.collisions.keyword.length).toBe(1);
    expect(auditDocument(sameMarket).seo.score).toBeLessThan(auditDocument(acrossMarkets).seo.score);
  });

  it('never compares with a draft', () => {
    const draft = perfectPage({
      entityId: 'page_draft',
      path: '/draft',
      status: { value: 'DRAFT', live: false, publishedAt: null, notServedReason: null },
    });
    expect(withCollisions(perfectPage(), [indexEntry(draft)]).collisions.title).toEqual([]);
  });

  it('keeps each market’s own URL, country and audit link', () => {
    expect(auditHref({ type: 'PRODUCT_MARKET', id: 'p1', countryId: ROOT_MARKET.id })).toBe(
      '/admin/seo-intelligence/product/p1?market=country_in',
    );
    expect(auditHref({ type: 'PAGE', id: 'x' })).toBe('/admin/seo-intelligence/page/x');
    expect(entityTypeFromSlug('product')).toBe('PRODUCT_MARKET');
    expect(entityTypeFromSlug('nope')).toBeNull();
    expect(editPathFor('BLOG_POST', 'b1')).toBe('/admin/blog/b1');
  });
});

describe('robots.txt matching', () => {
  const rules = parseRobots(
    ['User-agent: Googlebot', 'Disallow: /', '', 'User-agent: *', 'Disallow: /admin', 'Disallow: /*.pdf$', 'Allow: /admin/public', 'Disallow: /ae/private'].join('\n'),
  );

  it('reads the rules every crawler follows', () => {
    expect(blockingRule(rules, '/pricing')).toBeNull();
    expect(blockingRule(rules, '/admin/pages')).toBe('/admin');
    expect(blockingRule(rules, '/admin/public/page')).toBeNull();
    expect(blockingRule(rules, '/files/guide.pdf')).toBe('/*.pdf$');
    expect(blockingRule(rules, '/files/guide.pdf?x=1')).toBeNull();
    expect(blockingRule(rules, '/ae/private/offer')).toBe('/ae/private');
  });
});

describe('reading rich text', () => {
  it('turns HTML into headings, lists, links and images, as a reader sees them', () => {
    const nodes = htmlToNodes(
      '<h2>Plans &amp; pricing</h2><p>From <strong>₹1,250</strong> a month.</p><ul><li>5 TB</li><li>180 days</li></ul>' +
        '<p><a href="/pricing">See pricing</a></p><img src="/a.png" alt="Admin console"><img src="/b.png" alt="">' +
        '<script>ignored()</script>',
    );
    expect(nodes).toContainEqual(expect.objectContaining({ type: 'heading', level: 2, text: 'Plans & pricing' }));
    expect(nodes).toContainEqual(expect.objectContaining({ type: 'list', items: ['5 TB', '180 days'] }));
    expect(nodes).toContainEqual(expect.objectContaining({ type: 'link', href: '/pricing', text: 'See pricing' }));
    expect(nodes).toContainEqual(expect.objectContaining({ type: 'image', alt: 'Admin console', decorative: false }));
    expect(nodes).toContainEqual(expect.objectContaining({ type: 'image', src: '/b.png', decorative: true }));
    expect(htmlToText('<p>A</p><script>x()</script><p>B</p>')).not.toContain('x()');
  });
});

describe('live drafts', () => {
  it('drops malformed draft fields instead of rejecting the draft', () => {
    const draft = pageDraftSchema.parse({ seoTitle: 42, seoDescription: 'Fine', noIndex: 'yes' });
    expect(draft).toEqual({ seoDescription: 'Fine' });
    expect(overlay('saved', undefined)).toBe('saved');
    expect(overlay('saved', '')).toBe('');
  });
});

describe('form booleans', () => {
  it('reads "false" from a form as false, not as a non-empty string', () => {
    const settings = countrySettingsSchema.parse({ noIndexCountry: 'false', excludeFromSitemap: 'true' });
    expect(settings.noIndexCountry).toBe(false);
    expect(settings.excludeFromSitemap).toBe(true);
    const market = productCountrySchema.parse({
      productId: 'p1',
      countryId: 'c1',
      currency: 'INR',
      noIndex: 'false',
      isFeatured: 'on',
    });
    expect(market.noIndex).toBe(false);
    expect(market.isFeatured).toBe(true);
  });
});

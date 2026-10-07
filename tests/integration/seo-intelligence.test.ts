import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mockAuth, formData, uniqueSuffix, TEST_ACTOR, ensureTestCountry, ensureSecondCountry } from '../helpers';

mockAuth();

const { prisma } = await import('@/lib/db/prisma');
const { createPage, updatePage } = await import('@/lib/actions/pages');
const { createBlogPost, updateBlogPost } = await import('@/lib/actions/blog');
const { createProduct } = await import('@/lib/actions/products');
const { scoreSeoDraft, recalculateSeoScore } = await import('@/lib/actions/seo-intelligence');
const { forgetSeoContext, loadSeoContext } = await import('@/lib/seo/intelligence/context');
const { auditEntities, forgetMarketIndexes } = await import('@/lib/seo/intelligence/audit');
const { recalculateBatch, recalculateEntities, staleness } = await import('@/lib/seo/intelligence/cache');
const { targetKey } = await import('@/lib/seo/intelligence/targets');
const { auditSummary, listAudits } = await import('@/lib/seo/intelligence/dashboard');

const suffix = uniqueSuffix();
const pages: string[] = [];
const posts: string[] = [];
const products: string[] = [];
let india = '';
let uae = '';

const fresh = () => {
  // Every test reads what the one before it saved.
  forgetSeoContext();
  forgetMarketIndexes();
};

beforeAll(async () => {
  india = await ensureTestCountry();
  uae = await ensureSecondCountry();
  const role = await prisma.userRole.upsert({
    where: { slug: 'test-role-seo-intel' },
    update: {},
    create: { slug: 'test-role-seo-intel', name: 'Test Role SEO', rank: 5 },
  });
  await prisma.user.upsert({
    where: { id: TEST_ACTOR.id },
    update: {},
    create: { id: TEST_ACTOR.id, email: TEST_ACTOR.email, name: TEST_ACTOR.name, roleId: role.id },
  });
});

afterAll(async () => {
  const ids = [...pages, ...posts, ...products];
  await prisma.seoAudit.deleteMany({ where: { entityId: { in: ids } } });
  await prisma.page.deleteMany({ where: { id: { in: pages } } });
  await prisma.blogPost.deleteMany({ where: { id: { in: posts } } });
  await prisma.productCountry.deleteMany({ where: { productId: { in: products } } });
  await prisma.product.deleteMany({ where: { id: { in: products } } });
  await prisma.auditLog.deleteMany({ where: { actorId: TEST_ACTOR.id } });
  await prisma.user.deleteMany({ where: { id: TEST_ACTOR.id } });
  await prisma.userRole.deleteMany({ where: { slug: 'test-role-seo-intel' } });
  await prisma.$disconnect();
});

async function newPage(values: Record<string, unknown>, countryId = india): Promise<string> {
  const result = await createPage(formData({ status: 'PUBLISHED', countryId, ...values }));
  expect(result.ok, result.ok ? '' : result.error).toBe(true);
  const id = (result as { data: { id: string } }).data.id;
  pages.push(id);
  // Pages are created in the admin's market; place it in the one this test wants.
  await prisma.page.update({ where: { id }, data: { countryId } });
  return id;
}

describe('primary keywords on save', () => {
  it('stores three cleaned keywords, blanks as null', async () => {
    const id = await newPage({
      title: `Keyword page ${suffix}`,
      slug: `keyword-page-${suffix}`,
      primaryKeyword1: '  AutoCAD   LT ',
      primaryKeyword2: '',
      primaryKeyword3: 'team storage',
    });
    const page = await prisma.page.findUniqueOrThrow({ where: { id } });
    expect([page.primaryKeyword1, page.primaryKeyword2, page.primaryKeyword3]).toEqual([
      'AutoCAD LT',
      null,
      'team storage',
    ]);
  });

  it('refuses a keyword repeated in another case, naming the field', async () => {
    const id = pages[0]!;
    const result = await updatePage(
      id,
      formData({
        title: `Keyword page ${suffix}`,
        slug: `keyword-page-${suffix}`,
        status: 'PUBLISHED',
        primaryKeyword1: 'AutoCAD LT',
        primaryKeyword2: 'autocad lt',
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.ok ? {} : result.fieldErrors).toHaveProperty('primaryKeyword2');
  });

  it('keeps a blog post’s focus keyword and first primary keyword in step', async () => {
    const legacy = await createBlogPost(
      formData({ title: `Focus post ${suffix}`, content: '<p>Body</p>', status: 'DRAFT', focusKeyword: 'autocad migration' }),
    );
    expect(legacy.ok).toBe(true);
    const legacyId = (legacy as { data: { id: string } }).data.id;
    posts.push(legacyId);
    let post = await prisma.blogPost.findUniqueOrThrow({ where: { id: legacyId } });
    // An older form that only sends the focus keyword still lands in keyword 1.
    expect(post.primaryKeyword1).toBe('autocad migration');
    expect(post.focusKeyword).toBe('autocad migration');

    const updated = await updateBlogPost(
      legacyId,
      formData({
        title: `Focus post ${suffix}`,
        content: '<p>Body</p>',
        status: 'DRAFT',
        primaryKeyword1: 'Google Drive to AutoCAD',
        primaryKeyword2: 'migration checklist',
      }),
    );
    expect(updated.ok).toBe(true);
    post = await prisma.blogPost.findUniqueOrThrow({ where: { id: legacyId } });
    expect(post.primaryKeyword1).toBe('Google Drive to AutoCAD');
    expect(post.focusKeyword).toBe('Google Drive to AutoCAD');
    expect(post.primaryKeyword2).toBe('migration checklist');
  });
});

describe('cached scores', () => {
  let pageId = '';

  it('stores a URL’s scores, with its keywords and issues', async () => {
    fresh();
    pageId = await newPage({
      title: `Cached page ${suffix}`,
      slug: `cached-page-${suffix}`,
      seoTitle: `Cached page ${suffix} for testing`,
      primaryKeyword1: 'cached page',
    });
    const [audited] = await recalculateEntities([{ type: 'PAGE', id: pageId, countryId: india }]);
    expect(audited?.result.entityId).toBe(pageId);

    const row = await prisma.seoAudit.findUniqueOrThrow({
      where: { entityType_entityId_countryId: { entityType: 'PAGE', entityId: pageId, countryId: india } },
    });
    for (const score of [row.seoScore, row.aeoScore, row.geoScore, row.overallScore]) {
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
    expect(row.overallScore).toBe(audited!.result.overall);
    expect(row.status).toBe('live');
    expect(row.missingKeywords).toBe(false);
    expect(Array.isArray(row.issues)).toBe(true);
    expect((row.keywords as Array<{ keyword: string }>)[0]?.keyword).toBe('cached page');
  });

  it('knows a score is stale once the content changes, and a batch brings it up to date', async () => {
    fresh();
    const ctx = await loadSeoContext();
    const key = targetKey({ entityType: 'PAGE', entityId: pageId, countryId: india });
    expect((await staleness(ctx)).outdated.has(key)).toBe(false);

    // Timestamps are compared to the millisecond; make sure this one moves.
    await new Promise((resolve) => setTimeout(resolve, 5));
    const result = await updatePage(
      pageId,
      formData({
        title: `Cached page ${suffix}`,
        slug: `cached-page-${suffix}`,
        status: 'PUBLISHED',
        seoDescription: 'A description written for this page, so the description check now passes for it.',
        primaryKeyword1: 'cached page',
      }),
    );
    expect(result.ok).toBe(true);
    expect((await staleness(ctx)).outdated.has(key)).toBe(true);

    let cursor: string | null = null;
    let rounds = 0;
    do {
      const progress = await recalculateBatch({ cursor, onlyOutdated: true, countryIds: [india] });
      cursor = progress.nextCursor;
      rounds += 1;
    } while (cursor && rounds < 50);
    expect((await staleness(ctx)).outdated.has(key)).toBe(false);
  });

  it('lists, filters and sums the cached rows for the dashboard', async () => {
    const summary = await auditSummary([india]);
    expect(summary.total).toBeGreaterThan(0);
    const { rows } = await listAudits(
      { countryIds: [india], q: `cached-page-${suffix}` },
      { page: 1, perPage: 25 },
    );
    expect(rows.map((row) => row.entityId)).toEqual([pageId]);
    const other = await listAudits({ countryIds: [uae], q: `cached-page-${suffix}` }, { page: 1, perPage: 25 });
    expect(other.rows).toEqual([]);
  });

  it('recalculates one URL on request', async () => {
    const result = await recalculateSeoScore({ type: 'PAGE', id: pageId });
    expect(result.ok, result.ok ? '' : result.error).toBe(true);
  });

  it('marks an audit outdated when only the address changes, and lists it under Outdated', async () => {
    fresh();
    const ctx = await loadSeoContext();
    const key = targetKey({ entityType: 'PAGE', entityId: pageId, countryId: india });
    const route = await prisma.urlRoute.findUnique({ where: { entityId_countryId: { entityId: pageId, countryId: india } } });
    expect(route, 'saving a page registers its address').not.toBeNull();
    expect((await staleness(ctx)).outdated.has(key)).toBe(false);

    // What every address change does to the route: the version moves.
    await prisma.urlRoute.update({ where: { id: route!.id }, data: { version: { increment: 1 } } });
    const state = await staleness(ctx);
    expect(state.outdated.has(key)).toBe(true);

    const outdated = await listAudits(
      { countryIds: [india], q: `cached-page-${suffix}`, audit: 'outdated', outdatedIds: [...state.outdatedIds] },
      { page: 1, perPage: 25 },
    );
    expect(outdated.rows.map((row) => row.entityId)).toEqual([pageId]);
    const current = await listAudits(
      { countryIds: [india], q: `cached-page-${suffix}`, audit: 'current', outdatedIds: [...state.outdatedIds] },
      { page: 1, perPage: 25 },
    );
    expect(current.rows).toEqual([]);

    await recalculateEntities([{ type: 'PAGE', id: pageId, countryId: india }]);
    expect((await staleness(ctx)).outdated.has(key)).toBe(false);
  });

  it('filters by the most severe issue a URL has', async () => {
    const row = await prisma.seoAudit.findUniqueOrThrow({
      where: { entityType_entityId_countryId: { entityType: 'PAGE', entityId: pageId, countryId: india } },
    });
    const severity = row.criticalCount > 0 ? 'critical' : row.warningCount > 0 ? 'warning' : row.suggestionCount > 0 ? 'suggestion' : 'clean';
    for (const filter of ['critical', 'warning', 'suggestion', 'clean'] as const) {
      const { rows } = await listAudits({ countryIds: [india], q: `cached-page-${suffix}`, severity: filter }, { page: 1, perPage: 25 });
      expect(rows.length, filter).toBe(filter === severity ? 1 : 0);
    }
  });
});

describe('live scoring of unsaved edits', () => {
  it('scores the draft laid over the saved page, without saving it', async () => {
    fresh();
    const id = await newPage({ title: `Draft score ${suffix}`, slug: `draft-score-${suffix}` });
    const saved = await scoreSeoDraft({ ref: { type: 'PAGE', id } });
    const edited = await scoreSeoDraft({
      ref: { type: 'PAGE', id },
      draft: {
        seoDescription:
          'Buy AutoCAD LT in India with GST invoices, 5 TB of shared storage and migration help from certified specialists.',
      },
    });
    expect(saved.ok && edited.ok).toBe(true);
    const status = (result: typeof saved) =>
      result.ok ? result.data!.seo.checks.find((entry) => entry.id === 'seo.description.present')?.status : null;
    expect(status(saved)).toBe('FAIL');
    expect(status(edited)).toBe('PASS');
    const page = await prisma.page.findUniqueOrThrow({ where: { id } });
    expect(page.seoDescription).toBeNull();
  });

  it('refuses a URL that does not exist', async () => {
    const result = await scoreSeoDraft({ ref: { type: 'PAGE', id: 'does-not-exist' } });
    expect(result.ok).toBe(false);
  });
});

describe('product markets', () => {
  it('uses a market’s own keywords, or the product’s when the market sets none', async () => {
    fresh();
    const created = await createProduct(
      formData({
        name: `SEO Plan ${suffix}`,
        status: 'PUBLISHED',
        currency: 'INR',
        monthlyPrice: '1250',
        primaryKeyword1: 'AutoCAD LT Standard',
      }),
    );
    expect(created.ok, created.ok ? '' : created.error).toBe(true);
    const productId = (created as { data: { id: string } }).data.id;
    products.push(productId);

    await prisma.productCountry.upsert({
      where: { productId_countryId: { productId, countryId: uae } },
      update: { primaryKeyword1: 'AutoCAD UAE reseller', status: 'PUBLISHED', publishedAt: new Date() },
      create: {
        productId,
        countryId: uae,
        currency: 'AED',
        status: 'PUBLISHED',
        publishedAt: new Date(),
        primaryKeyword1: 'AutoCAD UAE reseller',
      },
    });

    const ctx = await loadSeoContext();
    const docs = await auditEntities(ctx, [
      { type: 'PRODUCT_MARKET', id: productId, countryId: india },
      { type: 'PRODUCT_MARKET', id: productId, countryId: uae },
    ]);
    const byMarket = new Map(docs.map((entry) => [entry.doc.country.id, entry.doc]));
    expect(byMarket.get(india)?.meta.keywords).toEqual(['AutoCAD LT Standard']);
    expect(byMarket.get(india)?.meta.keywordsSource).toBe('shared');
    expect(byMarket.get(uae)?.meta.keywords).toEqual(['AutoCAD UAE reseller']);
    expect(byMarket.get(uae)?.meta.keywordsSource).toBe('own');
    // Each market is its own URL, canonical to itself.
    expect(byMarket.get(uae)?.meta.canonical.effective).toContain('/ae/');
    expect(byMarket.get(india)?.meta.canonical.effective).not.toContain('/ae/');
  });
});

describe('markets never collide with each other', () => {
  it('flags a duplicate title in the same market, never across markets', async () => {
    fresh();
    const title = `Same title ${suffix}`;
    const first = await newPage({ title, slug: `same-a-${suffix}`, seoTitle: title });
    const abroad = await newPage({ title, slug: `same-b-${suffix}`, seoTitle: title }, uae);

    const ctx = await loadSeoContext();
    let [audited] = await auditEntities(ctx, [{ type: 'PAGE', id: first, countryId: india }]);
    expect(audited?.doc.collisions.title.map((entry) => entry.path)).not.toContain(`/ae/same-b-${suffix}`);
    expect(audited?.doc.collisions.title).toEqual([]);

    await newPage({ title, slug: `same-c-${suffix}`, seoTitle: title });
    fresh();
    [audited] = await auditEntities(await loadSeoContext(), [{ type: 'PAGE', id: first, countryId: india }]);
    expect(audited?.doc.collisions.title.map((entry) => entry.path)).toEqual([`/same-c-${suffix}`]);
    expect(abroad).toBeTruthy();
  });
});

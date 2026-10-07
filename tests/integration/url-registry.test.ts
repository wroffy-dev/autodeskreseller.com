import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  mockAuth,
  formData,
  uniqueSuffix,
  TEST_ACTOR,
  ensureTestCountry,
  ensureSecondCountry,
} from '../helpers';

mockAuth();

const { prisma } = await import('@/lib/db/prisma');
const { invalidateCountryCache } = await import('@/lib/country/registry');
const { runUrlScan } = await import('@/lib/urls/backfill');
const { resolvePublic } = await import('@/lib/urls/resolve');
const { isLive } = await import('@/lib/urls/live');
const urls = await import('@/lib/actions/urls');
const { createPage, updatePage, deletePage } = await import('@/lib/actions/pages');
const { saveRedirect, deleteRedirect } = await import('@/lib/actions/seo');
const { findRedirect, redirectOrNotFound } = await import('@/lib/services/redirects');

/*
 * The URL registry end to end: scan, resolve, rename, patterns, restore,
 * conflicts, drafts, bulk changes and markets — through the same Server
 * Actions the Slug & URL Manager calls, against a real database.
 */

const suffix = uniqueSuffix();
const started = new Date();
const past = new Date(Date.now() - 86_400_000);
const slug = `autocad-${suffix}`;

let IN = '';
let AE = '';
let productId = '';
let pageId = '';
let draftId = '';
let postId = '';
let previousResolver = false;
const pageIds: string[] = [];

type Answer = { status: number; location?: string; kind?: string; id?: string | null; country?: string };

/** What the public site answers for an address: a status, and a Location for redirects. */
async function answer(path: string, search = ''): Promise<Answer> {
  try {
    const target = await resolvePublic(path, search);
    return { status: 200, kind: target.kind, id: target.id, country: target.country.id };
  } catch (error) {
    const digest = String((error as { digest?: string }).digest ?? '');
    if (digest.startsWith('NEXT_REDIRECT')) {
      const [, , location, status] = digest.split(';');
      return { status: Number(status), location };
    }
    if (digest.includes('404')) return { status: 404 };
    throw error;
  }
}

async function routeOf(entityId: string, countryId: string) {
  return prisma.urlRoute.findUnique({ where: { entityId_countryId: { entityId, countryId } } });
}

async function saveCustom(entityId: string, countryId: string, type: string, relativePath: string, expectedVersion?: number | null) {
  const route = await routeOf(entityId, countryId);
  return urls.saveUrlAddressAction({
    kind: 'custom',
    entityId,
    countryId,
    type,
    relativePath,
    expectedVersion: expectedVersion === undefined ? (route?.version ?? null) : expectedVersion,
  });
}

/** Previews a bulk change, applies it, and runs it to the end. */
async function applyPlan(plan: Record<string, unknown>) {
  const preview = await urls.previewPlanAction(plan);
  if (!preview.ok || !preview.data) throw new Error(preview.ok ? 'no preview' : preview.error);
  const applied = await urls.applyPlanAction({ plan, fingerprint: preview.data.fingerprint });
  if (!applied.ok || !applied.data || !('operation' in applied.data)) {
    throw new Error(applied.ok ? 'stale preview' : applied.error);
  }
  let operation = applied.data.operation;
  while (operation.status === 'RUNNING' || operation.status === 'PENDING') {
    const next = await urls.runOperationAction(operation.id);
    if (!next.ok || !next.data) throw new Error(next.ok ? 'no progress' : next.error);
    operation = next.data;
  }
  return { preview: preview.data.plan, operation };
}

beforeAll(async () => {
  const role = await prisma.userRole.upsert({
    where: { slug: 'test-role-urls' },
    update: {},
    create: { slug: 'test-role-urls', name: 'Test Role URLs', rank: 5 },
  });
  await prisma.user.upsert({
    where: { id: TEST_ACTOR.id },
    update: {},
    create: { id: TEST_ACTOR.id, email: TEST_ACTOR.email, name: TEST_ACTOR.name, roleId: role.id },
  });

  IN = await ensureTestCountry();
  AE = await ensureSecondCountry();
  invalidateCountryCache();

  const settings = await prisma.urlSettings.upsert({ where: { id: 'singleton' }, update: {}, create: { id: 'singleton' } });
  previousResolver = settings.resolverEnabled;
  await prisma.urlSettings.update({ where: { id: 'singleton' }, data: { resolverEnabled: false, version: { increment: 1 } } });

  const product = await prisma.product.create({
    data: {
      name: `AutoCAD ${suffix}`,
      slug,
      status: 'PUBLISHED',
      publishedAt: past,
      countries: {
        create: [
          { countryId: IN, status: 'PUBLISHED', publishedAt: past },
          { countryId: AE, status: 'PUBLISHED', publishedAt: past, currency: 'AED' },
        ],
      },
    },
  });
  productId = product.id;
  pageId = (
    await prisma.page.create({
      data: { countryId: IN, title: `About ${suffix}`, slug: `about-${suffix}`, status: 'PUBLISHED', publishedAt: past },
    })
  ).id;
  draftId = (
    await prisma.page.create({ data: { countryId: IN, title: `Draft ${suffix}`, slug: `draft-${suffix}`, status: 'DRAFT' } })
  ).id;
  pageIds.push(pageId, draftId);
  postId = (
    await prisma.blogPost.create({
      data: { countryId: IN, title: `Article ${suffix}`, slug: `article-${suffix}`, status: 'PUBLISHED', publishedAt: past },
    })
  ).id;
});

afterAll(async () => {
  // Put every pattern the tests touched back, moving content back with it.
  await prisma.urlSettings.update({ where: { id: 'singleton' }, data: { resolverEnabled: true } });
  for (const [type, countryId] of [
    ['PRODUCT', AE],
    ['PRODUCT', null],
    ['BLOG_POST', null],
  ] as const) {
    const scopeKey = `${type}:${countryId ?? '*'}`;
    if (await prisma.urlPattern.findUnique({ where: { scopeKey } })) {
      await applyPlan({ kind: 'pattern', type, countryId, pattern: null }).catch(() => undefined);
    }
  }
  const ids = [productId, postId, ...pageIds].filter(Boolean);
  await prisma.urlRoute.deleteMany({ where: { entityId: { in: ids } } });
  await prisma.redirect.deleteMany({ where: { OR: [{ createdAt: { gte: started } }, { targetEntityId: { in: ids } }] } });
  await prisma.urlHistory.deleteMany({ where: { createdAt: { gte: started } } });
  await prisma.urlOperation.deleteMany({ where: { createdAt: { gte: started } } });
  await prisma.urlNotFound.deleteMany({ where: { firstSeenAt: { gte: started } } });
  await prisma.blogPost.deleteMany({ where: { id: postId } });
  await prisma.page.deleteMany({ where: { id: { in: pageIds } } });
  await prisma.product.deleteMany({ where: { id: productId } });
  await prisma.urlSettings.update({
    where: { id: 'singleton' },
    data: { resolverEnabled: previousResolver, version: { increment: 1 } },
  });
  await prisma.auditLog.deleteMany({ where: { actorId: TEST_ACTOR.id } });
  await prisma.user.deleteMany({ where: { id: TEST_ACTOR.id } });
  await prisma.userRole.deleteMany({ where: { slug: 'test-role-urls' } });
  await prisma.$disconnect();
});

describe('the first scan', () => {
  it('registers every address exactly where the site already serves it', async () => {
    await runUrlScan(TEST_ACTOR);
    expect((await routeOf(productId, IN))?.path).toBe(`/products/${slug}`);
    expect((await routeOf(productId, AE))?.path).toBe(`/ae/products/${slug}`);
    expect((await routeOf(pageId, IN))?.path).toBe(`/about-${suffix}`);
    expect((await routeOf(postId, IN))?.path).toBe(`/blog/article-${suffix}`);
    // A draft's address is reserved for it, not published.
    expect((await routeOf(draftId, IN))?.path).toBe(`/draft-${suffix}`);
  });

  it('is idempotent: a second scan registers nothing and moves nothing', async () => {
    const before = await prisma.urlRoute.findMany({
      where: { entityId: { in: [productId, pageId, postId, draftId] } },
      orderBy: { pathKey: 'asc' },
    });
    const report = await runUrlScan(TEST_ACTOR);
    expect(report.registered).toBe(0);
    const after = await prisma.urlRoute.findMany({
      where: { entityId: { in: [productId, pageId, postId, draftId] } },
      orderBy: { pathKey: 'asc' },
    });
    expect(after.map((route) => [route.path, route.version])).toEqual(before.map((route) => [route.path, route.version]));
  });

  it('can be rehearsed without writing anything', async () => {
    const version = (await prisma.urlSettings.findUniqueOrThrow({ where: { id: 'singleton' } })).version;
    const report = await runUrlScan(TEST_ACTOR, { dryRun: true });
    expect(report.registered).toBe(0);
    expect((await prisma.urlSettings.findUniqueOrThrow({ where: { id: 'singleton' } })).version).toBe(version);
  });
});

describe('while the registry is switched off', () => {
  it('refuses address edits, because the previous router would not follow them', async () => {
    const result = await saveCustom(pageId, IN, 'PAGE', '/company');
    expect(result.ok).toBe(false);
    expect((await routeOf(pageId, IN))?.path).toBe(`/about-${suffix}`);
  });

  it('only switches on after a scan, and switching on changes no address', async () => {
    const result = await urls.setResolverAction({ enabled: true, acknowledged: true });
    expect(result.ok).toBe(true);
    expect(await answer(`/products/${slug}`)).toMatchObject({ status: 200, kind: 'product', id: productId, country: IN });
    expect(await answer(`/ae/products/${slug}`)).toMatchObject({ status: 200, kind: 'product', country: AE });
    expect(await answer(`/about-${suffix}`)).toMatchObject({ status: 200, kind: 'page', id: pageId });
    expect(await answer(`/blog/article-${suffix}`)).toMatchObject({ status: 200, kind: 'post', id: postId });
  });
});

describe('resolving addresses', () => {
  it('sends another spelling of an address to the one canonical address', async () => {
    expect(await answer(`/Products/${slug.toUpperCase()}`)).toEqual({ status: 308, location: `/products/${slug}` });
  });

  it('answers 404 for unknown and crafted addresses', async () => {
    expect(await answer(`/nothing-here-${suffix}`)).toEqual({ status: 404 });
    expect(await answer(`/products/${slug}/extra`)).toEqual({ status: 404 });
  });

  it('keeps the blog root-only: a market-prefixed blog address goes to the root one', async () => {
    expect(await answer(`/ae/blog/article-${suffix}`)).toEqual({ status: 308, location: `/blog/article-${suffix}` });
  });
});

describe('URL patterns and markets', () => {
  it('moves a market to its own pattern without touching another market: /ae/products/x → /ae/x', async () => {
    const { preview, operation } = await applyPlan({ kind: 'pattern', type: 'PRODUCT', countryId: AE, pattern: '/{slug}' });
    const mine = preview.items.find((item) => item.entityId === productId);
    expect(mine).toMatchObject({ from: `/ae/products/${slug}`, to: `/ae/${slug}`, status: 'change', redirects: true });
    expect(preview.items.every((item) => item.countryId === AE)).toBe(true);
    expect(operation.status).toBe('COMPLETED');

    expect((await routeOf(productId, AE))?.path).toBe(`/ae/${slug}`);
    expect((await routeOf(productId, IN))?.path).toBe(`/products/${slug}`);
    expect(await answer(`/ae/products/${slug}`)).toEqual({ status: 308, location: `/ae/${slug}` });
    expect(await answer(`/ae/${slug}`)).toMatchObject({ status: 200, kind: 'product', country: AE });
  });

  it('removes the prefix everywhere with a global pattern: /products/x → /x, keeping UTMs', async () => {
    const { preview } = await applyPlan({ kind: 'pattern', type: 'PRODUCT', countryId: null, pattern: '/{slug}' });
    // The UAE has its own pattern, so a global change is not its business.
    expect(preview.items.some((item) => item.entityId === productId && item.countryId === AE)).toBe(false);
    expect((await routeOf(productId, IN))?.path).toBe(`/${slug}`);
    expect(await answer(`/products/${slug}`, 'utm_source=news&utm_campaign=launch')).toEqual({
      status: 308,
      location: `/${slug}?utm_source=news&utm_campaign=launch`,
    });
    expect(await answer(`/${slug}`)).toMatchObject({ status: 200, kind: 'product', id: productId, country: IN });
  });

  it('moves the blog with its own pattern: /blog/article → /insights/article', async () => {
    await applyPlan({ kind: 'pattern', type: 'BLOG_POST', countryId: null, pattern: '/insights/{slug}' });
    expect((await routeOf(postId, IN))?.path).toBe(`/insights/article-${suffix}`);
    expect(await answer(`/blog/article-${suffix}`)).toEqual({ status: 308, location: `/insights/article-${suffix}` });
    // A market-prefixed copy of either address goes straight to the one article.
    expect(await answer(`/ae/blog/article-${suffix}`)).toEqual({ status: 308, location: `/insights/article-${suffix}` });
    expect(await answer(`/ae/insights/article-${suffix}`)).toEqual({ status: 308, location: `/insights/article-${suffix}` });
  });

  it('refuses a pattern that starts at a system route or a market prefix', async () => {
    for (const pattern of ['/admin/{slug}', '/ae/{slug}', '/api/{slug}', '/{slug}/{slug}']) {
      const result = await urls.previewPlanAction({ kind: 'pattern', type: 'PRODUCT', countryId: null, pattern });
      expect(result.ok, pattern).toBe(false);
    }
  });
});

describe('renaming one address', () => {
  it('gives content a custom address, and the old one redirects permanently: /x → /software/x-business', async () => {
    const result = await saveCustom(productId, IN, 'PRODUCT', `/software/${slug}-business`);
    expect(result.ok).toBe(true);
    const data = (result as { data: { oldPath: string; newPath: string; redirectId: string | null } }).data;
    expect(data).toMatchObject({ oldPath: `/${slug}`, newPath: `/software/${slug}-business` });
    expect(data.redirectId).toBeTruthy();
    expect((await routeOf(productId, IN))?.mode).toBe('CUSTOM');
  });

  it('never chains: every earlier address goes straight to the current one', async () => {
    const final = `/software/${slug}-business`;
    expect(await answer(`/${slug}`)).toEqual({ status: 308, location: final });
    expect(await answer(`/products/${slug}`)).toEqual({ status: 308, location: final });

    const redirects = await prisma.redirect.findMany({ where: { targetEntityId: productId, targetCountryId: IN } });
    expect(redirects.length).toBeGreaterThanOrEqual(2);
    for (const rule of redirects) expect(rule.destination).toBe(final);
  });

  it('keeps a custom address through pattern changes', async () => {
    const preview = await urls.previewPlanAction({ kind: 'pattern', type: 'PRODUCT', countryId: null, pattern: '/buy/{slug}' });
    expect(preview.ok).toBe(true);
    const item = preview.ok ? preview.data?.plan.items.find((entry) => entry.entityId === productId && entry.countryId === IN) : null;
    expect(item?.status).toBe('excluded');
  });

  it('never changes a published address when only the title changes', async () => {
    const before = await routeOf(pageId, IN);
    const result = await updatePage(pageId, formData({ title: `About us ${suffix}`, slug: `about-${suffix}`, status: 'PUBLISHED' }));
    expect(result.ok).toBe(true);
    expect((await routeOf(pageId, IN))?.path).toBe(before?.path);
  });

  it('refuses a save made against an address that changed since it was opened', async () => {
    const route = await routeOf(pageId, IN);
    const first = await saveCustom(pageId, IN, 'PAGE', `/company-${suffix}`, route!.version);
    expect(first.ok).toBe(true);
    const second = await saveCustom(pageId, IN, 'PAGE', `/team-${suffix}`, route!.version);
    expect(second.ok).toBe(false);
    expect((await routeOf(pageId, IN))?.path).toBe(`/company-${suffix}`);
  });

  it('gives an address to exactly one of two simultaneous claims', async () => {
    const other = (
      await prisma.page.create({
        data: { countryId: IN, title: `Other ${suffix}`, slug: `other-${suffix}`, status: 'PUBLISHED', publishedAt: past },
      })
    ).id;
    pageIds.push(other);
    await runUrlScan(TEST_ACTOR);
    const wanted = `/race-${suffix}`;
    const [a, b] = await Promise.all([saveCustom(pageId, IN, 'PAGE', wanted), saveCustom(other, IN, 'PAGE', wanted)]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    const owners = await prisma.urlRoute.findMany({ where: { pathKey: wanted } });
    expect(owners).toHaveLength(1);
  });
});

describe('conflicts and reserved addresses', () => {
  it('reports who owns a taken address, and offers free alternatives', async () => {
    const taken = `/software/${slug}-business`;
    const check = await urls.checkUrlPathAction({ entityId: pageId, countryId: IN, type: 'PAGE', path: taken });
    expect(check.ok && check.data?.ok).toBe(false);
    if (check.ok && check.data && !check.data.ok) {
      expect(check.data.conflict?.description).toContain(`AutoCAD ${suffix}`);
      expect(check.data.conflict?.editHref).toBe(`/admin/products/${productId}`);
    }
    const suggestions = await urls.suggestPathsAction({ entityId: pageId, countryId: IN, type: 'PAGE', path: taken });
    expect(suggestions.ok && suggestions.data?.length).toBeGreaterThan(0);
    for (const path of suggestions.ok ? (suggestions.data ?? []) : []) {
      const free = await urls.checkUrlPathAction({ entityId: pageId, countryId: IN, type: 'PAGE', path });
      expect(free.ok && free.data?.ok, path).toBe(true);
    }
  });

  it('treats capitals and slashes as the same address', async () => {
    const result = await saveCustom(pageId, IN, 'PAGE', `/Software/${slug.toUpperCase()}-Business/`);
    expect(result.ok).toBe(false);
  });

  it('protects system routes, market prefixes and traversal', async () => {
    for (const path of ['/admin/pages', '/api/x', '/login', '/_next/static', '/sitemap.xml', '/ae/about', '/a/../b', '/']) {
      const result = await saveCustom(pageId, IN, 'PAGE', path);
      expect(result.ok, path).toBe(false);
    }
  });

  it('applies the same rules to the ordinary content forms', async () => {
    const result = await createPage(
      formData({ title: `Clash ${suffix}`, slug: `software/${slug}-business`, status: 'DRAFT' }),
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.fieldErrors?.slug).toBeTruthy();
  });

  it('refuses a redirect that would take a content address, point at itself or loop', async () => {
    const takesContent = await saveRedirect(null, formData({ source: `/software/${slug}-business`, destination: '/pricing' }));
    expect(takesContent.ok).toBe(false);

    const a = await saveRedirect(null, formData({ source: `/loop-a-${suffix}`, destination: `/loop-b-${suffix}` }));
    expect(a.ok).toBe(true);
    const loop = await saveRedirect(null, formData({ source: `/loop-b-${suffix}`, destination: `/loop-a-${suffix}` }));
    expect(loop.ok).toBe(false);
    const self = await saveRedirect(null, formData({ source: `/self-${suffix}`, destination: `/self-${suffix}` }));
    expect(self.ok).toBe(false);
    if (a.ok && a.data) await deleteRedirect(a.data.id);
  });

  it('stores a redirect to content by identity, so it follows the content', async () => {
    const saved = await saveRedirect(
      null,
      formData({ source: `/old-plan-${suffix}`, destination: `/software/${slug}-business` }),
    );
    expect(saved.ok).toBe(true);
    const rule = await prisma.redirect.findUniqueOrThrow({ where: { id: (saved as { data: { id: string } }).data.id } });
    expect(rule).toMatchObject({ targetEntityId: productId, targetCountryId: IN, targetType: 'PRODUCT' });
    expect(await answer(`/old-plan-${suffix}`, 'utm_medium=email')).toEqual({
      status: 308,
      location: `/software/${slug}-business?utm_medium=email`,
    });
  });
});

describe('drafts stay private', () => {
  it('has a reserved address but is not live', async () => {
    expect(await isLive('PAGE', draftId, IN)).toBe(false);
  });

  it('moves without leaving a redirect, because it was never public', async () => {
    const result = await saveCustom(draftId, IN, 'PAGE', `/draft-moved-${suffix}`);
    expect(result.ok).toBe(true);
    expect((result as { data: { redirectId: string | null } }).data.redirectId).toBeNull();
    expect(await answer(`/draft-${suffix}`)).toEqual({ status: 404 });
  });

  it('is never offered as a destination, and a redirect to it answers 404', async () => {
    const found = await urls.searchDestinationsAction({ q: `Draft ${suffix}` });
    expect(found.ok && found.data?.some((row) => row.entityId === draftId)).toBe(false);

    const home = await urls.giveAddressHomeAction({
      source: `/to-draft-${suffix}`,
      target: { entityId: draftId, countryId: IN, type: 'PAGE' },
    });
    expect(home.ok).toBe(false);

    const rule = await saveRedirect(
      null,
      formData({ source: `/to-draft-${suffix}`, targetEntityId: draftId, targetCountryId: IN, destination: '' }),
    );
    expect(rule.ok).toBe(true);
    expect(await answer(`/to-draft-${suffix}`)).toEqual({ status: 404 });
  });
});

describe('history and restore', () => {
  it('lists every change with who made it', async () => {
    const history = await urls.historyAction({ q: `AutoCAD ${suffix}` });
    expect(history.ok).toBe(true);
    const rows = history.ok ? (history.data?.rows ?? []) : [];
    expect(rows.some((row) => row.oldPath === `/${slug}` && row.newPath === `/software/${slug}-business`)).toBe(true);
    expect(rows.every((row) => row.entityId === productId)).toBe(true);
  });

  it('restores an earlier address after checking it, and the address it leaves redirects', async () => {
    const entry = await prisma.urlHistory.findFirstOrThrow({
      where: { entityId: productId, countryId: IN, oldPath: `/${slug}`, newPath: `/software/${slug}-business` },
    });
    const preview = await urls.previewRestoreAction(entry.id);
    expect(preview.ok && preview.data).toMatchObject({ ok: true, to: `/${slug}`, redirect: true });

    const restored = await urls.restoreHistoryAction(entry.id);
    expect(restored.ok).toBe(true);
    expect((await routeOf(productId, IN))?.path).toBe(`/${slug}`);
    expect(await answer(`/software/${slug}-business`)).toEqual({ status: 308, location: `/${slug}` });
    expect(await answer(`/products/${slug}`)).toEqual({ status: 308, location: `/${slug}` });
    expect(await answer(`/old-plan-${suffix}`)).toEqual({ status: 308, location: `/${slug}` });
  });

  it('refuses to restore an address that now belongs to something else', async () => {
    // Move the page on from /company-…, free that address, and give it to another page.
    if ((await routeOf(pageId, IN))?.path === `/company-${suffix}`) {
      expect((await saveCustom(pageId, IN, 'PAGE', `/company-new-${suffix}`)).ok).toBe(true);
    }
    const entry = await prisma.urlHistory.findFirstOrThrow({
      where: { entityId: pageId, countryId: IN, oldPath: `/company-${suffix}` },
      orderBy: { createdAt: 'desc' },
    });
    const holder = await prisma.urlRoute.findUnique({ where: { pathKey: `/company-${suffix}` } });
    if (holder?.redirectId) await prisma.redirect.delete({ where: { id: holder.redirectId } });
    const intruder = await createPage(formData({ title: `Intruder ${suffix}`, slug: `company-${suffix}`, status: 'DRAFT' }));
    expect(intruder.ok).toBe(true);
    pageIds.push((intruder as { data: { id: string } }).data.id);

    const preview = await urls.previewRestoreAction(entry.id);
    expect(preview.ok && preview.data?.ok).toBe(false);
    const restored = await urls.restoreHistoryAction(entry.id);
    expect(restored.ok).toBe(false);
    expect((await routeOf(pageId, IN))?.path).not.toBe(`/company-${suffix}`);
  });
});

describe('deleted content', () => {
  it('keeps its history, answers 404, and gets a new home only when someone chooses one', async () => {
    const doomed = (
      await prisma.page.create({
        data: { countryId: IN, title: `Doomed ${suffix}`, slug: `doomed-${suffix}`, status: 'PUBLISHED', publishedAt: past },
      })
    ).id;
    pageIds.push(doomed);
    await runUrlScan(TEST_ACTOR);
    expect((await saveCustom(doomed, IN, 'PAGE', `/doomed-now-${suffix}`)).ok).toBe(true);

    expect((await deletePage(doomed)).ok).toBe(true);
    expect(await routeOf(doomed, IN)).toBeNull();
    expect(await answer(`/doomed-now-${suffix}`)).toEqual({ status: 404 });
    // Its earlier address still has its automatic redirect, which now has nowhere to go.
    expect(await answer(`/doomed-${suffix}`)).toEqual({ status: 404 });

    const history = await prisma.urlHistory.findMany({ where: { entityId: doomed } });
    expect(history.some((row) => row.reason === 'DELETE' && row.oldPath === `/doomed-now-${suffix}`)).toBe(true);

    const target = { entityId: productId, countryId: IN, type: 'PRODUCT' as const };
    const released = await urls.giveAddressHomeAction({ source: `/doomed-now-${suffix}`, target });
    expect(released.ok).toBe(true);
    // The old automatic redirect is taken over rather than refused.
    const adopted = await urls.giveAddressHomeAction({ source: `/doomed-${suffix}`, target });
    expect(adopted.ok).toBe(true);
    expect(await answer(`/doomed-now-${suffix}`)).toEqual({ status: 308, location: `/${slug}` });
    expect(await answer(`/doomed-${suffix}`)).toEqual({ status: 308, location: `/${slug}` });
  });
});

describe('bulk changes and CSV', () => {
  it('validates every row of an import before anything is applied', async () => {
    const csv = [
      'entity_id,country,type,target_path',
      `${pageId},IN,PAGE,/csv-page-${suffix}`,
      `${productId},AE,PRODUCT,/ae/csv-product-${suffix}`,
      `${draftId},IN,PAGE,/admin/nope`,
      `${postId},IN,BLOG_POST,/csv-page-${suffix}`,
      `missing-${suffix},IN,PAGE,/whatever-${suffix}`,
      `${productId},ZZ,PRODUCT,/x`,
    ].join('\n');
    const preview = await urls.previewPlanAction({ kind: 'csv', text: csv });
    expect(preview.ok).toBe(true);
    const items = preview.ok ? (preview.data?.plan.items ?? []) : [];
    const status = (entityId: string, countryId?: string) =>
      items.find((item) => item.entityId === entityId && (!countryId || item.countryId === countryId))?.status;
    expect(status(productId, AE)).toBe('change');
    expect(status(draftId, IN)).toBe('invalid');
    // Two rows wanting one address: neither is applied, rather than a guess at which was meant.
    expect(status(pageId, IN)).toBe('conflict');
    expect(status(postId, IN)).toBe('conflict');
    expect(items.filter((item) => item.status === 'invalid').length).toBeGreaterThanOrEqual(3);
  });

  it('refuses a preview that went out of date, and shows the new one instead', async () => {
    const plan = { kind: 'csv', text: `entity_id,country,target_path\n${pageId},IN,/csv-page-${suffix}` };
    const preview = await urls.previewPlanAction(plan);
    expect(preview.ok).toBe(true);
    // Someone else moves the page in between.
    expect((await saveCustom(pageId, IN, 'PAGE', `/moved-meanwhile-${suffix}`)).ok).toBe(true);

    const applied = await urls.applyPlanAction({ plan, fingerprint: preview.ok ? preview.data!.fingerprint : '' });
    expect(applied.ok).toBe(true);
    expect(applied.ok && applied.data && 'stale' in applied.data).toBe(true);
    expect((await routeOf(pageId, IN))?.path).toBe(`/moved-meanwhile-${suffix}`);

    const { operation } = await applyPlan(plan);
    expect(operation.status).toBe('COMPLETED');
    expect((await routeOf(pageId, IN))?.path).toBe(`/csv-page-${suffix}`);
  });

  it('replaces a prefix across selected addresses', async () => {
    expect((await saveCustom(pageId, IN, 'PAGE', `/company/about-${suffix}`)).ok).toBe(true);
    const { preview } = await applyPlan({
      kind: 'prefix',
      refs: [{ entityId: pageId, countryId: IN, type: 'PAGE' }],
      from: '/company',
      to: '/about-us',
    });
    expect(preview.items[0]).toMatchObject({ from: `/company/about-${suffix}`, to: `/about-us/about-${suffix}` });
    expect((await routeOf(pageId, IN))?.path).toBe(`/about-us/about-${suffix}`);
  });

  it('exports what it imports', async () => {
    const exported = await urls.exportUrlsCsvAction({ q: `AutoCAD ${suffix}` });
    expect(exported.ok).toBe(true);
    const csv = exported.ok ? (exported.data?.csv ?? '') : '';
    expect(csv.split('\r\n')[0]).toBe('entity_id,country,type,name,status,mode,current_path,pattern_path,target_path');
    expect(csv).toContain(productId);
  });
});

describe('URL Health', () => {
  it('records addresses that answered 404, without their query strings', async () => {
    await answer(`/missing-${suffix}`, 'email=someone@example.com');
    // The record is written after the response; give it a moment.
    await new Promise((resolve) => setTimeout(resolve, 300));
    const row = await prisma.urlNotFound.findUnique({ where: { pathKey: `/missing-${suffix}` } });
    expect(row?.path).toBe(`/missing-${suffix}`);
    expect(row?.status).toBe('OPEN');

    const home = await urls.giveAddressHomeAction({
      source: row!.path,
      target: { entityId: productId, countryId: IN, type: 'PRODUCT' },
      notFoundId: row!.id,
    });
    expect(home.ok).toBe(true);
    expect((await prisma.urlNotFound.findUniqueOrThrow({ where: { id: row!.id } })).status).toBe('RESOLVED');
    expect(await answer(`/missing-${suffix}`)).toEqual({ status: 308, location: `/${slug}` });
  });

  it('reports redirects whose destination is gone or unpublished', async () => {
    const health = await urls.healthAction();
    expect(health.ok).toBe(true);
    const problems = health.ok ? (health.data?.redirects ?? []) : [];
    expect(problems.some((problem) => problem.source === `/to-draft-${suffix}` && problem.problem === 'target-unpublished')).toBe(true);
  });
});

describe('switching the registry off', () => {
  async function fallback(path: string): Promise<Answer> {
    try {
      await redirectOrNotFound({ slug: '', id: IN }, path);
      return { status: 200 };
    } catch (error) {
      const digest = String((error as { digest?: string }).digest ?? '');
      if (digest.startsWith('NEXT_REDIRECT')) {
        const [, , location, status] = digest.split(';');
        return { status: Number(status), location };
      }
      if (digest.includes('404')) return { status: 404 };
      throw error;
    }
  }

  it('hands every address back to the previous router, and nothing it gave out answers 404', async () => {
    expect((await urls.setResolverAction({ enabled: false })).ok).toBe(true);
    // The previous router serves the product at its old address again…
    expect(await answer(`/products/${slug}`)).toMatchObject({ status: 200, kind: 'product', id: productId });
    // …and the address the registry gave it leads there, temporarily.
    expect(await fallback(slug)).toEqual({ status: 307, location: `/products/${slug}` });
    expect(await fallback(`software/${slug}-business`)).toEqual({ status: 307, location: `/products/${slug}` });
    // So is a redirect someone wrote to that content by choosing it.
    expect(await findRedirect(`/doomed-now-${suffix}`)).toEqual({ destination: `/products/${slug}`, permanent: false });
    // A redirect to the product follows it to where it is served now —
    // temporarily, since that is only its address until the registry is back.
    expect(await findRedirect(`/old-plan-${suffix}`)).toEqual({ destination: `/products/${slug}`, permanent: false });
    // Unknown addresses still answer 404.
    expect(await fallback(`never-registered-${suffix}`)).toEqual({ status: 404 });
  });

  it('switching back on restores every registry address', async () => {
    expect((await urls.setResolverAction({ enabled: true, acknowledged: true })).ok).toBe(true);
    expect(await answer(`/products/${slug}`)).toEqual({ status: 308, location: `/${slug}` });
    expect(await answer(`/${slug}`)).toMatchObject({ status: 200, kind: 'product', id: productId });
  });
});

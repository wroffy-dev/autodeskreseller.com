import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  mockAuth,
  formData,
  uniqueSuffix,
  TEST_ACTOR,
  ensureTestCountry,
  ensureSecondCountry,
} from '../helpers';

// An SEO editor who may edit pages — not products — and only in India.
mockAuth(['seo.manage', 'pages.edit', 'pages.view'], 'editor');

const { prisma } = await import('@/lib/db/prisma');
const { invalidateCountryCache } = await import('@/lib/country/registry');
const { runUrlScan } = await import('@/lib/urls/backfill');
const urls = await import('@/lib/actions/urls');
const { saveRedirect } = await import('@/lib/actions/seo');

const suffix = uniqueSuffix();
const started = new Date();
const past = new Date(Date.now() - 86_400_000);

let IN = '';
let AE = '';
let productId = '';
let inPage = '';
let aePage = '';
let previousResolver = false;

async function version(entityId: string, countryId: string) {
  return (await prisma.urlRoute.findUnique({ where: { entityId_countryId: { entityId, countryId } } }))?.version ?? null;
}

beforeAll(async () => {
  const role = await prisma.userRole.upsert({
    where: { slug: 'test-role-url-perms' },
    update: {},
    create: { slug: 'test-role-url-perms', name: 'Test Role URL permissions', rank: 5 },
  });
  await prisma.user.upsert({
    where: { id: TEST_ACTOR.id },
    update: {},
    create: { id: TEST_ACTOR.id, email: TEST_ACTOR.email, name: TEST_ACTOR.name, roleId: role.id },
  });
  IN = await ensureTestCountry();
  AE = await ensureSecondCountry();
  invalidateCountryCache();
  await prisma.userCountry.create({ data: { userId: TEST_ACTOR.id, countryId: IN } });

  productId = (
    await prisma.product.create({
      data: {
        name: `Perm product ${suffix}`,
        slug: `perm-product-${suffix}`,
        status: 'PUBLISHED',
        publishedAt: past,
        countries: { create: [{ countryId: IN, status: 'PUBLISHED', publishedAt: past }] },
      },
    })
  ).id;
  inPage = (
    await prisma.page.create({
      data: { countryId: IN, title: `IN page ${suffix}`, slug: `in-page-${suffix}`, status: 'PUBLISHED', publishedAt: past },
    })
  ).id;
  aePage = (
    await prisma.page.create({
      data: { countryId: AE, title: `AE page ${suffix}`, slug: `ae-page-${suffix}`, status: 'PUBLISHED', publishedAt: past },
    })
  ).id;

  const settings = await prisma.urlSettings.upsert({ where: { id: 'singleton' }, update: {}, create: { id: 'singleton' } });
  previousResolver = settings.resolverEnabled;
  await runUrlScan(null);
  await prisma.urlSettings.update({ where: { id: 'singleton' }, data: { resolverEnabled: true, version: { increment: 1 } } });
});

afterAll(async () => {
  const ids = [productId, inPage, aePage];
  await prisma.urlRoute.deleteMany({ where: { entityId: { in: ids } } });
  await prisma.redirect.deleteMany({ where: { createdAt: { gte: started } } });
  await prisma.urlHistory.deleteMany({ where: { createdAt: { gte: started } } });
  await prisma.urlOperation.deleteMany({ where: { createdAt: { gte: started } } });
  await prisma.page.deleteMany({ where: { id: { in: [inPage, aePage] } } });
  await prisma.product.deleteMany({ where: { id: productId } });
  await prisma.userCountry.deleteMany({ where: { userId: TEST_ACTOR.id } });
  await prisma.urlSettings.update({
    where: { id: 'singleton' },
    data: { resolverEnabled: previousResolver, version: { increment: 1 } },
  });
  await prisma.auditLog.deleteMany({ where: { actorId: TEST_ACTOR.id } });
  await prisma.user.deleteMany({ where: { id: TEST_ACTOR.id } });
  await prisma.userRole.deleteMany({ where: { slug: 'test-role-url-perms' } });
  await prisma.$disconnect();
});

describe('who may change which address', () => {
  it('lets an editor change a page address in their own market', async () => {
    const result = await urls.saveUrlAddressAction({
      kind: 'custom',
      entityId: inPage,
      countryId: IN,
      type: 'PAGE',
      relativePath: `/in-page-moved-${suffix}`,
      expectedVersion: await version(inPage, IN),
    });
    expect(result.ok).toBe(true);
  });

  it('refuses another market’s content, even with a crafted request', async () => {
    const result = await urls.saveUrlAddressAction({
      kind: 'custom',
      entityId: aePage,
      countryId: AE,
      type: 'PAGE',
      relativePath: `/ae-page-moved-${suffix}`,
      expectedVersion: await version(aePage, AE),
    });
    expect(result.ok).toBe(false);
    expect((await prisma.urlRoute.findUnique({ where: { entityId_countryId: { entityId: aePage, countryId: AE } } }))?.path).toBe(
      `/ae/ae-page-${suffix}`,
    );
  });

  it('refuses content the editor may not edit', async () => {
    const result = await urls.saveUrlAddressAction({
      kind: 'custom',
      entityId: productId,
      countryId: IN,
      type: 'PRODUCT',
      relativePath: `/perm-${suffix}`,
      expectedVersion: await version(productId, IN),
    });
    expect(result.ok).toBe(false);
  });

  it('only lists addresses in the editor’s markets', async () => {
    const result = await urls.listUrlsAction({ q: suffix, pageSize: 100 });
    expect(result.ok).toBe(true);
    const rows = result.ok ? (result.data?.rows ?? []) : [];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.countryId === IN)).toBe(true);
    expect(rows.find((row) => row.entityId === productId)?.canEdit).toBe(false);
  });

  it('checks every row of a bulk change on its own', async () => {
    const csv = [
      'entity_id,country,type,target_path',
      `${inPage},IN,PAGE,/in-bulk-${suffix}`,
      `${aePage},AE,PAGE,/ae/ae-bulk-${suffix}`,
      `${productId},IN,PRODUCT,/product-bulk-${suffix}`,
    ].join('\n');
    const preview = await urls.previewPlanAction({ kind: 'csv', text: csv });
    expect(preview.ok).toBe(true);
    const items = preview.ok ? (preview.data?.plan.items ?? []) : [];
    const status = (entityId: string) => items.find((item) => item.entityId === entityId)?.status;
    expect(status(inPage)).toBe('change');
    expect(['excluded', 'invalid']).toContain(status(aePage));
    expect(status(productId)).toBe('excluded');
  });

  it('keeps site-wide operations for people who can reach every market', async () => {
    expect((await urls.runScanAction()).ok).toBe(false);
    expect((await urls.setResolverAction({ enabled: false })).ok).toBe(false);
  });

  it('lets only people who may edit a kind of content change where it lives', async () => {
    // Global: needs every market. Another market: not theirs. Their own market,
    // but products: not theirs to edit either. Nothing is saved in any case.
    const before = await prisma.urlPattern.findMany({ where: { type: 'PRODUCT' }, orderBy: { scopeKey: 'asc' } });
    for (const countryId of [null, AE, IN]) {
      const result = await urls.previewPlanAction({ kind: 'pattern', type: 'PRODUCT', countryId, pattern: '/{slug}' });
      expect(result.ok, String(countryId)).toBe(false);
    }
    const applied = await urls.applyPlanAction({
      plan: { kind: 'pattern', type: 'PRODUCT', countryId: IN, pattern: '/{slug}' },
      fingerprint: 'forged',
    });
    expect(applied.ok).toBe(false);
    expect(await prisma.urlPattern.findMany({ where: { type: 'PRODUCT' }, orderBy: { scopeKey: 'asc' } })).toEqual(before);
  });

  it('refuses redirects in a market the editor cannot reach', async () => {
    const result = await saveRedirect(null, formData({ source: `/ae/old-${suffix}`, destination: '/ae' }));
    expect(result.ok).toBe(false);
    const own = await saveRedirect(null, formData({ source: `/old-${suffix}`, destination: `/in-page-moved-${suffix}` }));
    expect(own.ok).toBe(true);
  });

  it('checks every row of a redirect CSV import against the editor’s markets', async () => {
    const text = [
      'URL,Destination URL',
      `/csv-in-${suffix},/in-page-moved-${suffix}`,
      `/ae/csv-ae-${suffix},/ae/ae-page-${suffix}`,
    ].join('\n');
    const preview = await urls.previewRedirectImportAction({ text, type: 'PERMANENT', resolutions: {} });
    expect(preview.ok).toBe(true);
    const rows = preview.ok ? (preview.data?.rows ?? []) : [];
    expect(rows.find((row) => row.line === 2)?.status).toBe('create');
    expect(rows.find((row) => row.line === 3)).toMatchObject({ status: 'invalid' });
    expect(rows.find((row) => row.line === 3)?.reason).toMatch(/cannot write redirects/);

    // A forged apply still re-plans with the editor's permissions: only India is written.
    const applied = await urls.applyRedirectImportAction({
      text,
      type: 'PERMANENT',
      resolutions: {},
      fingerprint: preview.ok ? preview.data!.fingerprint : '',
    });
    expect(applied.ok).toBe(true);
    expect(await prisma.redirect.count({ where: { source: `/csv-in-${suffix}` } })).toBe(1);
    expect(await prisma.redirect.count({ where: { source: `/ae/csv-ae-${suffix}` } })).toBe(0);
  });
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  mockAuth,
  uniqueSuffix,
  TEST_ACTOR,
  ensureTestCountry,
  ensureSecondCountry,
} from '../helpers';

// A content editor: pages (and so cities), no leads, only in India.
mockAuth(['pages.view'], 'editor');

const { prisma } = await import('@/lib/db/prisma');
const { invalidateCountryCache } = await import('@/lib/country/registry');
const { adminSearch } = await import('@/lib/actions/admin-search');

const suffix = uniqueSuffix();
const term = `Quokka${suffix}`;
let IN = '';
let AE = '';
const cityIds: string[] = [];
const pageIds: string[] = [];
let leadId = '';

beforeAll(async () => {
  const role = await prisma.userRole.upsert({
    where: { slug: 'test-role-search-pages' },
    update: {},
    create: { slug: 'test-role-search-pages', name: 'Test Role Search Pages', rank: 5 },
  });
  await prisma.user.upsert({
    where: { id: TEST_ACTOR.id },
    update: {},
    create: { id: TEST_ACTOR.id, email: TEST_ACTOR.email, name: TEST_ACTOR.name, roleId: role.id },
  });
  IN = await ensureTestCountry();
  AE = await ensureSecondCountry();
  invalidateCountryCache();
  await prisma.userCountry.deleteMany({ where: { userId: TEST_ACTOR.id } });
  await prisma.userCountry.create({ data: { userId: TEST_ACTOR.id, countryId: IN } });

  for (const countryId of [IN, AE]) {
    cityIds.push(
      (
        await prisma.city.create({
          data: { countryId, name: `${term} city`, slug: `qk-${countryId}-${suffix}` },
        })
      ).id,
    );
    pageIds.push(
      (
        await prisma.page.create({
          data: { countryId, title: `${term} page`, slug: `qk-page-${suffix}` },
        })
      ).id,
    );
  }
  leadId = (
    await prisma.lead.create({
      data: { countryId: IN, name: `${term} lead`, email: `qk-${suffix}@example.test` },
    })
  ).id;
});

afterAll(async () => {
  await prisma.page.deleteMany({ where: { id: { in: pageIds } } });
  await prisma.city.deleteMany({ where: { id: { in: cityIds } } });
  await prisma.lead.deleteMany({ where: { id: leadId } });
  await prisma.userCountry.deleteMany({ where: { userId: TEST_ACTOR.id } });
  await prisma.user.deleteMany({ where: { id: TEST_ACTOR.id } });
  await prisma.userRole.deleteMany({ where: { slug: 'test-role-search-pages' } });
  await prisma.$disconnect();
});

describe('admin search for a content editor', () => {
  it('finds pages and cities in their market only, and no leads', async () => {
    const hits = await adminSearch(term);
    const ids = hits.map((hit) => hit.id);
    expect(ids).toContain(pageIds[0]);
    expect(ids).toContain(cityIds[0]);
    expect(ids).not.toContain(pageIds[1]);
    expect(ids).not.toContain(cityIds[1]);
    expect(ids).not.toContain(leadId);
  });

  it('lists results grouped in a fixed module order with real destinations', async () => {
    const hits = await adminSearch(term);
    expect(hits.map((hit) => hit.type)).toEqual(['Page', 'City']);
    expect(hits.find((hit) => hit.type === 'City')!.href).toBe(`/admin/cities/${cityIds[0]}`);
    expect(hits.find((hit) => hit.type === 'Page')!.href).toBe(`/admin/pages/${pageIds[0]}`);
  });
});

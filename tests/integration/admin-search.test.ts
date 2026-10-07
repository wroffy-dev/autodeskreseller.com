import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  mockAuth,
  uniqueSuffix,
  TEST_ACTOR,
  ensureTestCountry,
  ensureSecondCountry,
} from '../helpers';

// A sales user: may see leads, nothing else, and only in India.
mockAuth(['leads.view'], 'sales');

const { prisma } = await import('@/lib/db/prisma');
const { invalidateCountryCache } = await import('@/lib/country/registry');
const { adminSearch } = await import('@/lib/actions/admin-search');

/*
 * The topbar search enforces the same boundaries as the screens it links to,
 * on the server: a module the user cannot open contributes nothing, and a
 * record in a market they cannot work in is never returned.
 */

const suffix = uniqueSuffix();
const term = `Zebrafinch${suffix}`;
let IN = '';
let AE = '';
const leadIds: string[] = [];
let pageId = '';
let cityId = '';

beforeAll(async () => {
  const role = await prisma.userRole.upsert({
    where: { slug: 'test-role-search' },
    update: {},
    create: { slug: 'test-role-search', name: 'Test Role Search', rank: 5 },
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

  for (const [countryId, label] of [
    [IN, 'India'],
    [AE, 'Emirates'],
  ] as const) {
    const lead = await prisma.lead.create({
      data: {
        countryId,
        name: `${term} ${label}`,
        email: `${label.toLowerCase()}-${suffix}@example.test`,
      },
    });
    leadIds.push(lead.id);
  }
  pageId = (
    await prisma.page.create({
      data: { countryId: IN, title: `${term} page`, slug: `zf-${suffix}` },
    })
  ).id;
  cityId = (
    await prisma.city.create({
      data: { countryId: IN, name: `${term} city`, slug: `zf-city-${suffix}` },
    })
  ).id;
});

afterAll(async () => {
  await prisma.lead.deleteMany({ where: { id: { in: leadIds } } });
  await prisma.page.deleteMany({ where: { id: pageId } });
  await prisma.city.deleteMany({ where: { id: cityId } });
  await prisma.userCountry.deleteMany({ where: { userId: TEST_ACTOR.id } });
  await prisma.user.deleteMany({ where: { id: TEST_ACTOR.id } });
  await prisma.userRole.deleteMany({ where: { slug: 'test-role-search' } });
  await prisma.$disconnect();
});

describe('admin search', () => {
  it('returns only the modules the user may open', async () => {
    const hits = await adminSearch(term);
    expect(hits.length).toBeGreaterThan(0);
    // The page and the city match too, but pages.view was never granted.
    expect(new Set(hits.map((hit) => hit.type))).toEqual(new Set(['Lead']));
  });

  it('never returns a lead from a market the user cannot work in', async () => {
    const hits = await adminSearch(term);
    expect(hits.map((hit) => hit.id)).toEqual([leadIds[0]]);
    expect(hits[0]!.href).toBe(`/admin/leads/${leadIds[0]}`);
  });

  it('ignores queries too short to mean anything and caps long ones', async () => {
    expect(await adminSearch('z')).toEqual([]);
    expect(await adminSearch('   ')).toEqual([]);
    // Cut to the maximum length rather than refused or sent to the database whole.
    expect(await adminSearch(`${term}${'x'.repeat(500)}`)).toEqual([]);
  });
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mockAuth, formData, uniqueSuffix, TEST_ACTOR, ensureTestCountry, ensureSecondCountry } from '../helpers';

// A page editor who may view and edit pages — not create, publish or delete
// them — and only in India.
mockAuth(['pages.view', 'pages.edit'], 'editor');

const { prisma } = await import('@/lib/db/prisma');
const { invalidateCountryCache } = await import('@/lib/country/registry');
const cities = await import('@/lib/actions/cities');
const urls = await import('@/lib/actions/urls');

/*
 * Cities are guarded by the page permissions and by market access, on the
 * server, whatever the request says.
 */

const suffix = uniqueSuffix();
let IN = '';
let AE = '';
let inCity = '';
let aeCity = '';
let sourceId = '';

beforeAll(async () => {
  const role = await prisma.userRole.upsert({
    where: { slug: 'test-role-city-perms' },
    update: {},
    create: { slug: 'test-role-city-perms', name: 'Test Role City permissions', rank: 5 },
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

  inCity = (
    await prisma.city.create({ data: { countryId: IN, name: 'Perm IN', slug: `perm-in-${suffix}` } })
  ).id;
  aeCity = (
    await prisma.city.create({
      data: { countryId: AE, name: 'Perm AE', slug: `perm-ae-${suffix}`, status: 'PUBLISHED', isActive: true, isPublished: true },
    })
  ).id;
  sourceId = (
    await prisma.page.create({ data: { countryId: IN, title: 'Perm source', slug: `perm-source-${suffix}` } })
  ).id;
});

afterAll(async () => {
  await prisma.page.deleteMany({ where: { OR: [{ id: sourceId }, { cityId: { in: [inCity, aeCity] } }] } });
  await prisma.cityPageBatch.deleteMany({ where: { sourcePageId: sourceId } });
  await prisma.city.deleteMany({ where: { id: { in: [inCity, aeCity] } } });
  await prisma.userCountry.deleteMany({ where: { userId: TEST_ACTOR.id } });
  await prisma.auditLog.deleteMany({ where: { actorId: TEST_ACTOR.id } });
  await prisma.user.deleteMany({ where: { id: TEST_ACTOR.id } });
  await prisma.userRole.deleteMany({ where: { slug: 'test-role-city-perms' } });
  await prisma.$disconnect();
});

describe('city permissions', () => {
  it('needs pages.create to add a city', async () => {
    const result = await cities.saveCity(null, formData({ countryId: IN, name: 'New', slug: `new-${suffix}` }));
    expect(result.ok).toBe(false);
    expect(await prisma.city.count({ where: { slug: `new-${suffix}` } })).toBe(0);
  });

  it('lets an editor edit a city in their market', async () => {
    const result = await cities.saveCity(
      inCity,
      formData({ countryId: IN, name: 'Perm IN', slug: `perm-in-${suffix}`, region: 'Somewhere', status: 'DRAFT' }),
    );
    expect(result.ok).toBe(true);
    expect((await prisma.city.findUniqueOrThrow({ where: { id: inCity } })).region).toBe('Somewhere');
  });

  it('never reaches a city in a market the user cannot work in', async () => {
    const edit = await cities.saveCity(aeCity, formData({ countryId: AE, name: 'Hacked', slug: `perm-ae-${suffix}` }));
    expect(edit.ok).toBe(false);
    const status = await cities.setCityStatus({ cityId: aeCity, status: 'ARCHIVED' });
    expect(status.ok).toBe(false);
    const check = await cities.checkCitySlug({ countryId: AE, slug: 'anything' });
    expect(check.ok).toBe(false);
    expect(await prisma.city.findUniqueOrThrow({ where: { id: aeCity } })).toMatchObject({ name: 'Perm AE', status: 'PUBLISHED', isActive: true });
  });

  it('needs pages.publish to publish a city, but may archive and restore it as a draft', async () => {
    const result = await cities.setCityStatus({ cityId: inCity, status: 'PUBLISHED' });
    expect(result.ok).toBe(false);
    expect((await prisma.city.findUniqueOrThrow({ where: { id: inCity } })).status).toBe('DRAFT');
    const viaForm = await cities.saveCity(
      inCity,
      formData({ countryId: IN, name: 'Perm IN', slug: `perm-in-${suffix}`, status: 'PUBLISHED' }),
    );
    expect(viaForm.ok).toBe(false);
    expect((await cities.setCityStatus({ cityId: inCity, status: 'ARCHIVED' })).ok).toBe(true);
    expect((await cities.setCityStatus({ cityId: inCity, status: 'DRAFT' })).ok).toBe(true);
  });

  it('needs pages.create to import cities, and pages.publish to import published ones', async () => {
    const text = `Name,Country,Status\nImported ${suffix},IN,DRAFT`;
    expect((await cities.previewCityImport({ text })).ok).toBe(false);
  });

  it('cannot import redirects without the SEO permission', async () => {
    const result = await urls.previewRedirectImportAction({ text: 'URL,Destination URL\n/a,/b', type: 'PERMANENT', resolutions: {} });
    expect(result.ok).toBe(false);
  });

  it('needs pages.delete to delete a city', async () => {
    const result = await cities.deleteCity({ cityId: inCity });
    expect(result.ok).toBe(false);
    expect(await prisma.city.findUnique({ where: { id: inCity } })).not.toBeNull();
  });

  it('needs pages.create for landing pages and the generator', async () => {
    expect((await cities.createCityLandingPage({ cityId: inCity, title: null })).ok).toBe(false);
    expect(
      (await cities.previewCityPages({ sourcePageId: sourceId, countryId: IN, cityIds: [inCity], titleTemplate: null })).ok,
    ).toBe(false);
    expect(
      (await cities.generateCityPages({ sourcePageId: sourceId, countryId: IN, cityIds: [inCity], titleTemplate: null }))
        .ok,
    ).toBe(false);
    expect(await prisma.page.count({ where: { cityId: inCity } })).toBe(0);
  });
});

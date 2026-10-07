import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mockAuth, formData, TEST_ACTOR, ensureTestCountry, ensureSecondCountry } from '../helpers';

mockAuth();

const { prisma } = await import('@/lib/db/prisma');
const { saveCountrySettings } = await import('@/lib/actions/countries');
const { buildMetadata } = await import('@/lib/seo/metadata');
const { getCountryById } = await import('@/lib/country/registry');
const { blogUrls, listSitemapCountries, sitemapChildren } = await import('@/lib/seo/sitemap');

/**
 * "Ask search engines not to index this market" and "Leave this market out of
 * the sitemaps", end to end: what the settings form posts, what is stored,
 * what the settings screen reads back, and what the public pages and the
 * sitemaps do with it — per market, never across markets.
 */

let india = '';
let uae = '';
type Snapshot = Awaited<ReturnType<typeof prisma.countrySettings.findUnique>>;
const saved = new Map<string, Snapshot>();

async function flags(countryId: string) {
  return prisma.countrySettings.findUniqueOrThrow({
    where: { countryId },
    select: { noIndexCountry: true, excludeFromSitemap: true },
  });
}

/** Exactly what the settings form sends: every value as a string. */
async function save(countryId: string, values: Record<string, string>) {
  return saveCountrySettings(countryId, formData({ noIndexCountry: 'false', excludeFromSitemap: 'false', ...values }));
}

async function robotsFor(countryId: string) {
  const country = await getCountryById(countryId);
  const metadata = await buildMetadata({ title: 'Test', path: '/test', country: country! });
  return metadata.robots as { index: boolean };
}

beforeAll(async () => {
  india = await ensureTestCountry();
  uae = await ensureSecondCountry();
  await prisma.userRole.upsert({
    where: { slug: 'test-role-indexing' },
    update: {},
    create: { slug: 'test-role-indexing', name: 'Test Role Indexing', rank: 5 },
  });
  const role = await prisma.userRole.findUniqueOrThrow({ where: { slug: 'test-role-indexing' } });
  await prisma.user.upsert({
    where: { id: TEST_ACTOR.id },
    update: {},
    create: { id: TEST_ACTOR.id, email: TEST_ACTOR.email, name: TEST_ACTOR.name, roleId: role.id },
  });
  for (const id of [india, uae]) saved.set(id, await prisma.countrySettings.findUnique({ where: { countryId: id } }));
});

afterAll(async () => {
  // Put both markets back exactly as they were.
  for (const [countryId, row] of saved) {
    if (row) {
      const { id: _id, countryId: _country, createdAt: _created, updatedAt: _updated, ...data } = row;
      await prisma.countrySettings.update({ where: { countryId }, data });
    } else {
      await prisma.countrySettings.deleteMany({ where: { countryId } });
    }
  }
  await prisma.auditLog.deleteMany({ where: { actorId: TEST_ACTOR.id } });
  await prisma.user.deleteMany({ where: { id: TEST_ACTOR.id } });
  await prisma.userRole.deleteMany({ where: { slug: 'test-role-indexing' } });
  await prisma.$disconnect();
});

describe('saving the switches', () => {
  it('stores "false" as false and "true" as true, for both switches', async () => {
    expect((await save(india, { noIndexCountry: 'true', excludeFromSitemap: 'true' })).ok).toBe(true);
    expect(await flags(india)).toEqual({ noIndexCountry: true, excludeFromSitemap: true });

    // The bug: a form posting "false" was stored as true, so the switch came
    // back on after every save.
    expect((await save(india, { noIndexCountry: 'false', excludeFromSitemap: 'false' })).ok).toBe(true);
    expect(await flags(india)).toEqual({ noIndexCountry: false, excludeFromSitemap: false });
  });

  it('treats a missing switch as off, never on', async () => {
    const result = await saveCountrySettings(uae, formData({ companyName: 'Example FZ-LLC' }));
    expect(result.ok).toBe(true);
    expect(await flags(uae)).toEqual({ noIndexCountry: false, excludeFromSitemap: false });
  });

  it('saves a market whose stored values came from the global settings', async () => {
    // The multi-country migration copies the global default title (up to 240
    // characters) into the root market. A lower limit here made the whole
    // form unsavable — switches included — so they sprang back on.
    const title = 'Authorised AutoCAD reseller in India '.repeat(6).trim();
    expect(title.length).toBeGreaterThan(200);
    await prisma.countrySettings.update({
      where: { countryId: india },
      data: { defaultTitle: title, noIndexCountry: true },
    });
    const result = await save(india, { defaultTitle: title, noIndexCountry: 'false' });
    expect(result.ok, result.ok ? '' : result.error).toBe(true);
    expect((await flags(india)).noIndexCountry).toBe(false);
  });

  it('names the field that stops a save, and leaves the stored switches alone', async () => {
    const result = await save(india, { defaultTitle: 'x'.repeat(241), noIndexCountry: 'true' });
    expect(result.ok).toBe(false);
    expect(result.ok ? {} : result.fieldErrors).toHaveProperty('defaultTitle');
    expect(result.ok ? [] : result.fieldErrors?.defaultTitle).toEqual(['Use 240 characters or fewer.']);
    expect((await flags(india)).noIndexCountry).toBe(false);
  });
});

describe('robots meta, per market', () => {
  it('is indexable when the switch is off', async () => {
    await save(india, { noIndexCountry: 'false' });
    await save(uae, { noIndexCountry: 'false' });
    expect((await robotsFor(india)).index).toBe(true);
    expect((await robotsFor(uae)).index).toBe(true);
  });

  it('is noindex only in the market that asks for it', async () => {
    await save(uae, { noIndexCountry: 'true' });
    expect((await robotsFor(uae)).index).toBe(false);
    expect((await robotsFor(india)).index).toBe(true);
    await save(uae, { noIndexCountry: 'false' });
    expect((await robotsFor(uae)).index).toBe(true);
  });

  it('is indexable for a market that has never been configured', async () => {
    const snapshot = await prisma.countrySettings.findUnique({ where: { countryId: uae } });
    await prisma.countrySettings.deleteMany({ where: { countryId: uae } });
    expect((await robotsFor(uae)).index).toBe(true);
    if (snapshot) {
      const { id: _id, createdAt: _created, updatedAt: _updated, ...data } = snapshot;
      await prisma.countrySettings.create({ data });
    }
  });
});

describe('target keywords', () => {
  it('are analysis inputs only: no keywords meta tag is emitted', async () => {
    const country = await getCountryById(india);
    const metadata = await buildMetadata({ title: 'Test', path: '/test', country: country!, keywords: ['autocad reseller delhi'] });
    expect(metadata.keywords).toBeUndefined();
  });
});

describe('sitemaps', () => {
  it('withhold a market that is excluded, or asked not to be indexed', async () => {
    await save(india, { noIndexCountry: 'false', excludeFromSitemap: 'false' });
    await save(uae, { noIndexCountry: 'false', excludeFromSitemap: 'false' });
    const all = (await listSitemapCountries()).map((country) => country.id);
    expect(all).toEqual(expect.arrayContaining([india, uae]));

    await save(uae, { excludeFromSitemap: 'true' });
    expect((await listSitemapCountries()).map((country) => country.id)).not.toContain(uae);

    await save(uae, { excludeFromSitemap: 'false', noIndexCountry: 'true' });
    expect((await listSitemapCountries()).map((country) => country.id)).not.toContain(uae);
    expect((await sitemapChildren()).map((child) => child.name)).not.toContain('ae');

    await save(uae, { noIndexCountry: 'false' });
    expect((await listSitemapCountries()).map((country) => country.id)).toContain(uae);
  });

  it('list the blog only while its market, the root, is listed', async () => {
    await save(india, { noIndexCountry: 'true' });
    expect(await blogUrls()).toEqual([]);
    await save(india, { noIndexCountry: 'false' });
    expect((await blogUrls()).length).toBeGreaterThan(0);
  });
});

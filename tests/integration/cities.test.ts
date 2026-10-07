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
const { invalidateCountryCache, getCountryById } = await import('@/lib/country/registry');
const { resolvePublic } = await import('@/lib/urls/resolve');
const { isLive } = await import('@/lib/urls/live');
const { withRegistry, placeContent } = await import('@/lib/urls/registry');
const { getPublishedPageById } = await import('@/lib/services/pages');
const { countryUrls } = await import('@/lib/seo/sitemap');
const cities = await import('@/lib/actions/cities');
const { createPage, updatePage, setPageStatus, deletePage } = await import('@/lib/actions/pages');
const { restoreFromTrash } = await import('@/lib/actions/trash');

/*
 * The City Module end to end, through the Server Actions the admin screens
 * call, against a real database: cities and their address spaces, landing
 * pages, the generator, public resolution, the sitemap and deletion.
 */

const suffix = uniqueSuffix();
const started = new Date();
const delhi = `delhi-${suffix}`;
const mumbai = `mumbai-${suffix}`;
const dubai = `dubai-${suffix}`;
const plans = `plans-${suffix}`;

let IN = '';
let AE = '';
let previousResolver = false;
const cityIds: Record<string, string> = {};
const createdPageIds: string[] = [];
const createdProductIds: string[] = [];

type Answer = { status: number; location?: string; kind?: string; id?: string | null; country?: string };

async function answer(path: string): Promise<Answer> {
  try {
    const target = await resolvePublic(path, '');
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

async function addCity(countryId: string, name: string, slug: string, extra: Record<string, unknown> = {}) {
  return cities.saveCity(
    null,
    formData({ countryId, name, slug, status: 'PUBLISHED', createLanding: 'false', ...extra }),
  );
}

async function page(countryId: string, slug: string) {
  return prisma.page.findUnique({ where: { countryId_slug: { countryId, slug } } });
}

async function newPage(countryId: string, slug: string, status: 'DRAFT' | 'PUBLISHED' = 'PUBLISHED') {
  const result = await createPage(formData({ title: `Page ${slug}`, slug, status, countryId }));
  if (!result.ok || !result.data) throw new Error(result.ok ? 'no page' : result.error);
  createdPageIds.push(result.data.id);
  return result.data.id;
}

beforeAll(async () => {
  const role = await prisma.userRole.upsert({
    where: { slug: 'test-role-cities' },
    update: {},
    create: { slug: 'test-role-cities', name: 'Test Role Cities', rank: 5 },
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
  await prisma.urlSettings.update({ where: { id: 'singleton' }, data: { resolverEnabled: true, version: { increment: 1 } } });
});

afterAll(async () => {
  const ids = Object.values(cityIds);
  const pages = await prisma.page.findMany({
    where: { OR: [{ cityId: { in: ids } }, { id: { in: createdPageIds } }, { slug: { contains: suffix } }] },
    select: { id: true },
  });
  const pageIds = pages.map((row) => row.id);
  await prisma.urlRoute.deleteMany({ where: { OR: [{ entityId: { in: pageIds } }, { pathKey: { contains: suffix } }] } });
  await prisma.redirect.deleteMany({ where: { OR: [{ createdAt: { gte: started } }, { targetEntityId: { in: pageIds } }] } });
  await prisma.urlHistory.deleteMany({ where: { createdAt: { gte: started } } });
  await prisma.urlNotFound.deleteMany({ where: { firstSeenAt: { gte: started } } });
  await prisma.page.updateMany({ where: { id: { in: pageIds } }, data: { generatedFromPageId: null } });
  await prisma.page.deleteMany({ where: { id: { in: pageIds } } });
  await prisma.cityPageBatch.deleteMany({ where: { createdAt: { gte: started } } });
  await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
  await prisma.city.deleteMany({ where: { OR: [{ id: { in: ids } }, { slug: { contains: suffix } }] } });
  await prisma.urlSettings.update({
    where: { id: 'singleton' },
    data: { resolverEnabled: previousResolver, version: { increment: 1 } },
  });
  await prisma.auditLog.deleteMany({ where: { actorId: TEST_ACTOR.id } });
  await prisma.user.deleteMany({ where: { id: TEST_ACTOR.id } });
  await prisma.userRole.deleteMany({ where: { slug: 'test-role-cities' } });
  await prisma.$disconnect();
});

describe('cities', () => {
  it('creates a city with a name and a slug — the region is optional', async () => {
    const result = await addCity(IN, `Delhi ${suffix}`, delhi);
    expect(result.ok).toBe(true);
    cityIds.delhi = result.ok ? result.data!.id : '';
    const city = await prisma.city.findUniqueOrThrow({ where: { id: cityIds.delhi } });
    expect(city).toMatchObject({ countryId: IN, slug: delhi, region: null, status: 'PUBLISHED', isActive: true, isPublished: true });
  });

  it('starts a city as a draft unless it is published, and the database keeps the flags in step', async () => {
    const result = await cities.saveCity(null, formData({ countryId: IN, name: `Gurugram ${suffix}`, slug: `gurugram-${suffix}`, region: 'Haryana' }));
    expect(result.ok).toBe(true);
    const city = await prisma.city.findUniqueOrThrow({ where: { id: result.ok ? result.data!.id : '' } });
    expect(city).toMatchObject({ status: 'DRAFT', isActive: false, isPublished: false, region: 'Haryana', archivedAt: null });
    cityIds.gurugram = city.id;
    await expect(prisma.city.update({ where: { id: city.id }, data: { isActive: true } })).rejects.toThrow();
  });

  it('allows the same slug in another market, as its own city', async () => {
    const result = await addCity(AE, `Delhi ${suffix}`, delhi);
    expect(result.ok).toBe(true);
    cityIds.aeDelhi = result.ok ? result.data!.id : '';
    expect(cityIds.aeDelhi).not.toBe(cityIds.delhi);
  });

  it('refuses a second city with the same slug in the same market', async () => {
    const result = await addCity(IN, 'Another Delhi', delhi);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(`/${delhi}`);
    expect(await prisma.city.count({ where: { countryId: IN, slug: delhi } })).toBe(1);
  });

  it('refuses system routes, market prefixes and content types’ own address spaces', async () => {
    for (const slug of ['admin', 'api', 'ae', 'products', 'blog', 'categories']) {
      const result = await addCity(IN, `Reserved ${slug}`, slug);
      expect(result.ok, slug).toBe(false);
    }
  });

  it('refuses a slug whose address is already used, with a clear message', async () => {
    const taken = `taken-${suffix}`;
    await newPage(IN, taken);
    const result = await addCity(IN, 'Taken', taken);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain(`/${taken} is already used by`);
      expect(result.fieldErrors?.slug?.[0]).toBeTruthy();
    }
  });

  it('refuses a slug with content beneath it that is not the city’s', async () => {
    const parent = `beneath-${suffix}`;
    await newPage(IN, `${parent}/child`);
    const result = await addCity(IN, 'Beneath', parent);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(`/${parent}/child`);
  });

  it('says whether a slug is free before saving', async () => {
    const free = await cities.checkCitySlug({ countryId: IN, slug: `free-${suffix}` });
    expect(free.ok && free.data?.message).toBeNull();
    const taken = await cities.checkCitySlug({ countryId: IN, slug: delhi });
    expect(taken.ok && taken.data?.message).toContain('the city');
  });
});

describe('landing pages', () => {
  it('creates the landing page with the city: an ordinary draft at the city’s address', async () => {
    const result = await addCity(IN, `Mumbai ${suffix}`, mumbai, {
      createLanding: 'true',
      landingTitle: 'AutoCAD in {{city.name}}',
    });
    expect(result.ok).toBe(true);
    cityIds.mumbai = result.ok ? result.data!.id : '';
    const landing = await page(IN, mumbai);
    expect(landing).toMatchObject({
      title: `AutoCAD in Mumbai ${suffix}`,
      status: 'DRAFT',
      cityId: cityIds.mumbai,
      isCityHomepage: true,
    });
    expect(result.ok && result.data!.landingPageId).toBe(landing!.id);
    const route = await prisma.urlRoute.findUnique({ where: { entityId_countryId: { entityId: landing!.id, countryId: IN } } });
    expect(route?.path).toBe(`/${mumbai}`);
  });

  it('creates a landing page later, and only one per city', async () => {
    const first = await cities.createCityLandingPage({ cityId: cityIds.delhi, title: '{{city.name}}' });
    expect(first.ok).toBe(true);
    const second = await cities.createCityLandingPage({ cityId: cityIds.delhi, title: 'Again' });
    expect(second.ok).toBe(false);
    expect(await prisma.page.count({ where: { cityId: cityIds.delhi, isCityHomepage: true, deletedAt: null } })).toBe(1);
  });

  it('is guaranteed by the database as well: one live landing page per city', async () => {
    await expect(
      prisma.page.create({
        data: { countryId: IN, title: 'Second landing', slug: `second-landing-${suffix}`, cityId: cityIds.delhi, isCityHomepage: true },
      }),
    ).rejects.toThrow();
  });

  it('restores a deleted landing page as the landing page — or as an ordinary page once there is a new one', async () => {
    const slug = `lp-${suffix}`;
    const added = await addCity(IN, `Landing ${suffix}`, slug, { createLanding: 'true' });
    expect(added.ok).toBe(true);
    cityIds.lp = added.ok ? added.data!.id : '';
    const first = added.ok ? added.data!.landingPageId! : '';

    // Deleted and restored with nothing in its place: the landing page again.
    expect((await deletePage(first)).ok).toBe(true);
    expect((await restoreFromTrash('page', first)).ok).toBe(true);
    expect(await prisma.page.findUnique({ where: { id: first } })).toMatchObject({
      slug,
      cityId: cityIds.lp,
      isCityHomepage: true,
      deletedAt: null,
    });

    // Deleted, replaced, then restored: it comes back beside the new one.
    expect((await deletePage(first)).ok).toBe(true);
    const second = await cities.createCityLandingPage({ cityId: cityIds.lp, title: null });
    expect(second.ok).toBe(true);
    expect((await restoreFromTrash('page', first)).ok).toBe(true);
    const restored = await prisma.page.findUniqueOrThrow({ where: { id: first } });
    expect(restored.slug).toBe(`${slug}-2`);
    expect(restored).toMatchObject({ cityId: null, isCityHomepage: false });
    expect(await page(IN, slug)).toMatchObject({ id: second.ok ? second.data!.id : '', isCityHomepage: true });
  });

  it('never lets a city page belong to another market’s city', async () => {
    const landing = await page(IN, delhi);
    await expect(prisma.page.update({ where: { id: landing!.id }, data: { cityId: cityIds.aeDelhi } })).rejects.toThrow(
      /another country/,
    );
  });
});

describe('the city’s address space', () => {
  it('files a page created beneath the city as one of its pages', async () => {
    const id = await newPage(IN, `${delhi}/contact`);
    expect(await prisma.page.findUnique({ where: { id } })).toMatchObject({ cityId: cityIds.delhi, isCityHomepage: false });
  });

  it('takes a page out of the city when it moves out', async () => {
    const id = (await page(IN, `${delhi}/contact`))!.id;
    const saved = await updatePage(id, formData({ title: 'Contact', slug: `contact-${suffix}`, status: 'PUBLISHED' }));
    expect(saved.ok).toBe(true);
    expect(await prisma.page.findUnique({ where: { id } })).toMatchObject({ cityId: null, isCityHomepage: false });
  });

  it('refuses anything but the city’s own pages there', async () => {
    const result = await withRegistry((tx) =>
      placeContent(tx, {
        type: 'PRODUCT',
        entityId: `product-${suffix}`,
        countryId: IN,
        marketSlug: '',
        relativePath: `/${delhi}/some-product`,
        mode: 'CUSTOM',
        label: 'A product',
        wasPublished: false,
        reason: 'EDIT',
        actor: TEST_ACTOR,
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('the city');
  });

  it('keeps each market’s cities to itself: /ae/<slug> is the UAE city’s', async () => {
    const id = await newPage(AE, `${delhi}/about`);
    expect(await prisma.page.findUnique({ where: { id } })).toMatchObject({ cityId: cityIds.aeDelhi });
  });
});

describe('the City Page Generator', () => {
  let sourceId = '';
  let sectionId = '';
  let batchId = '';

  beforeAll(async () => {
    const added = await addCity(AE, `Dubai ${suffix}`, dubai);
    cityIds.dubai = added.ok ? added.data!.id : '';

    sourceId = await newPage(IN, plans);
    await prisma.page.update({
      where: { id: sourceId },
      data: {
        title: 'Plans',
        seoTitle: '{{page.title}} in {{city.name}} | {{country.name}}',
        seoDescription: 'AutoCAD plans for {{city.name}}{{city.region}}.',
        primaryKeyword1: 'autocad {{city.slug}}',
      },
    });
    sectionId = (
      await prisma.pageSection.create({
        data: {
          pageId: sourceId,
          blockType: 'hero',
          name: 'Hero for {{city.name}}',
          sortOrder: 10,
          content: {
            heading: 'AutoCAD in {{city.name}}',
            items: [{ text: 'Call {{city.name}} today', link: '/{{city.slug}}/{{page.slug}}' }],
            count: 3,
          },
          settings: { spacing: 'md' },
        },
      })
    ).id;
    await prisma.pageSection.create({
      data: { pageId: sourceId, blockType: 'richText', sortOrder: 20, content: { html: '<p>{{country.code}}</p>' } },
    });
  });

  it('previews every city’s address before anything is written', async () => {
    const preview = await cities.previewCityPages({
      sourcePageId: sourceId,
      countryId: IN,
      cityIds: [cityIds.delhi, cityIds.mumbai],
      titleTemplate: '{{page.title}} in {{city.name}}',
    });
    expect(preview.ok).toBe(true);
    const rows = preview.ok ? preview.data!.rows : [];
    expect(rows.map((row) => [row.path, row.outcome])).toEqual([
      [`/${delhi}/${plans}`, 'create'],
      [`/${mumbai}/${plans}`, 'create'],
    ]);
    expect(rows[0]!.title).toBe(`Plans in Delhi ${suffix}`);
    expect(preview.ok && preview.data!.source.placeholders).toEqual(
      expect.arrayContaining(['city.name', 'city.slug', 'country.code', 'page.slug']),
    );
    expect(await page(IN, `${delhi}/${plans}`)).toBeNull();
  });

  it('generates independent draft pages with every section, placeholders filled once', async () => {
    const run = await cities.generateCityPages({
      sourcePageId: sourceId,
      countryId: IN,
      cityIds: [cityIds.delhi, cityIds.mumbai],
      titleTemplate: '{{page.title}} in {{city.name}}',
    });
    expect(run.ok).toBe(true);
    expect(run.ok && run.data!.counts).toEqual({ created: 2, replaced: 0, skipped: 0, failed: 0 });
    batchId = run.ok ? run.data!.batchId : '';

    const generated = await prisma.page.findFirstOrThrow({
      where: { countryId: IN, slug: `${delhi}/${plans}` },
      include: { sections: { orderBy: { sortOrder: 'asc' } } },
    });
    expect(generated).toMatchObject({
      title: `Plans in Delhi ${suffix}`,
      status: 'DRAFT',
      cityId: cityIds.delhi,
      isCityHomepage: false,
      generatedFromPageId: sourceId,
      generationBatchId: batchId,
      seoTitle: `Plans in Delhi ${suffix} | India`,
      seoDescription: `AutoCAD plans for Delhi ${suffix}.`,
      primaryKeyword1: `autocad ${delhi}`,
      canonicalUrl: null,
      groupKey: generated.id,
    });
    expect(generated.generatedAt).toBeInstanceOf(Date);
    expect(generated.sections).toHaveLength(2);
    expect(generated.sections[0]).toMatchObject({
      blockType: 'hero',
      name: `Hero for Delhi ${suffix}`,
      content: {
        heading: `AutoCAD in Delhi ${suffix}`,
        items: [{ text: `Call Delhi ${suffix} today`, link: `/${delhi}/${plans}` }],
        count: 3,
      },
      settings: { spacing: 'md' },
    });
    expect(generated.sections[1]!.content).toEqual({ html: '<p>IN</p>' });
    // New rows, not shared ones.
    expect(generated.sections.map((section) => section.id)).not.toContain(sectionId);

    const route = await prisma.urlRoute.findUnique({ where: { entityId_countryId: { entityId: generated.id, countryId: IN } } });
    expect(route?.path).toBe(`/${delhi}/${plans}`);
    const batch = await prisma.cityPageBatch.findUniqueOrThrow({ where: { id: batchId } });
    expect(batch).toMatchObject({ sourcePageId: sourceId, created: 2, skipped: 0, failed: 0 });
  });

  it('keeps every generated page independent of the source and of each other', async () => {
    const delhiPage = (await page(IN, `${delhi}/${plans}`))!;
    const mumbaiPage = (await page(IN, `${mumbai}/${plans}`))!;

    // Edit the source: nothing reaches the copies.
    await prisma.pageSection.update({ where: { id: sectionId }, data: { content: { heading: 'Changed at the source' } } });
    const saved = await updatePage(sourceId, formData({ title: 'Plans v2', slug: plans, status: 'PUBLISHED' }));
    expect(saved.ok).toBe(true);
    const delhiHero = await prisma.pageSection.findFirstOrThrow({ where: { pageId: delhiPage.id, blockType: 'hero' } });
    expect(delhiHero.content).toMatchObject({ heading: `AutoCAD in Delhi ${suffix}` });
    expect((await prisma.page.findUniqueOrThrow({ where: { id: delhiPage.id } })).title).toBe(`Plans in Delhi ${suffix}`);

    // Edit one copy: neither the source nor the other copy changes.
    const edited = await updatePage(delhiPage.id, formData({ title: 'Delhi plans, edited', slug: delhiPage.slug, status: 'DRAFT' }));
    expect(edited.ok).toBe(true);
    await prisma.pageSection.update({ where: { id: delhiHero.id }, data: { content: { heading: 'Delhi only' } } });
    expect((await prisma.page.findUniqueOrThrow({ where: { id: mumbaiPage.id } })).title).toBe(`Plans in Mumbai ${suffix}`);
    const mumbaiHero = await prisma.pageSection.findFirstOrThrow({ where: { pageId: mumbaiPage.id, blockType: 'hero' } });
    expect(mumbaiHero.content).toMatchObject({ heading: `AutoCAD in Mumbai ${suffix}` });
    expect((await prisma.pageSection.findUniqueOrThrow({ where: { id: sectionId } })).content).toEqual({
      heading: 'Changed at the source',
    });
  });

  it('skips cities that already have the page and never overwrites it', async () => {
    const run = await cities.generateCityPages({
      sourcePageId: sourceId,
      countryId: IN,
      cityIds: [cityIds.delhi, cityIds.mumbai],
      titleTemplate: null,
    });
    expect(run.ok && run.data!.counts).toEqual({ created: 0, replaced: 0, skipped: 2, failed: 0 });
    expect((await page(IN, `${delhi}/${plans}`))!.title).toBe('Delhi plans, edited');
    const preview = await cities.previewCityPages({
      sourcePageId: sourceId,
      countryId: IN,
      cityIds: [cityIds.delhi],
      titleTemplate: null,
    });
    expect(preview.ok && preview.data!.rows[0]!.outcome).toBe('exists');
    expect(preview.ok && preview.data!.rows[0]!.existing).toMatchObject({ fromThisSource: true, editedSince: true });
  });

  it('regenerates only the pages chosen after the impact preview, once confirmed, and keeps what they held', async () => {
    const delhiPage = (await page(IN, `${delhi}/${plans}`))!;
    const mumbaiBefore = (await page(IN, `${mumbai}/${plans}`))!;
    const preview = await cities.previewCityPages({
      sourcePageId: sourceId,
      countryId: IN,
      cityIds: [cityIds.delhi, cityIds.mumbai],
      titleTemplate: null,
      replaceCityIds: [cityIds.delhi],
    });
    expect(preview.ok && preview.data!.rows.map((row) => row.outcome)).toEqual(['replace', 'exists']);
    expect(preview.ok && preview.data!.rows[0]!.reason).toMatch(/edited after it was generated/);

    // Not without an explicit confirmation.
    const unconfirmed = await cities.generateCityPages({
      sourcePageId: sourceId,
      countryId: IN,
      cityIds: [cityIds.delhi, cityIds.mumbai],
      titleTemplate: null,
      replaceCityIds: [cityIds.delhi],
    });
    expect(unconfirmed.ok).toBe(false);
    expect((await page(IN, `${delhi}/${plans}`))!.title).toBe('Delhi plans, edited');

    const run = await cities.generateCityPages({
      sourcePageId: sourceId,
      countryId: IN,
      cityIds: [cityIds.delhi, cityIds.mumbai],
      titleTemplate: null,
      replaceCityIds: [cityIds.delhi],
      confirmReplace: true,
    });
    expect(run.ok && run.data!.counts).toEqual({ created: 0, replaced: 1, skipped: 1, failed: 0 });
    const replaced = run.ok ? run.data!.rows.find((row) => row.outcome === 'replaced') : null;
    expect(replaced?.previous?.title).toBe('Delhi plans, edited');
    expect(replaced?.previous?.sections.some((section) => (section.content as { heading?: string }).heading === 'Delhi only')).toBe(true);

    const after = (await page(IN, `${delhi}/${plans}`))!;
    expect(after.id).toBe(delhiPage.id);
    expect(after.status).toBe(delhiPage.status);
    expect(after.title).not.toBe('Delhi plans, edited');
    const hero = await prisma.pageSection.findFirstOrThrow({ where: { pageId: after.id, blockType: 'hero' } });
    expect(hero.content).toMatchObject({ heading: 'Changed at the source' });
    // The other city was never touched.
    expect((await page(IN, `${mumbai}/${plans}`))!.updatedAt).toEqual(mumbaiBefore.updatedAt);
    const batch = await prisma.cityPageBatch.findUniqueOrThrow({ where: { id: run.ok ? run.data!.batchId : '' } });
    expect(JSON.stringify(batch.results)).toContain('Delhi plans, edited');
  });

  it('records explicit city/product pages, and never two pages for one product in one city', async () => {
    const product = await prisma.product.create({
      data: {
        name: `AutoCAD ${suffix}`,
        slug: `autocad-${suffix}`,
        status: 'PUBLISHED',
        publishedAt: new Date(Date.now() - 86_400_000),
        countries: { create: [{ countryId: IN, status: 'PUBLISHED', publishedAt: new Date(Date.now() - 86_400_000) }] },
      },
    });
    createdProductIds.push(product.id);
    const source = await newPage(IN, `autocad-${suffix}`);
    await prisma.page.update({ where: { id: source }, data: { title: '{{product}} reseller in {{city}}, {{region}}' } });

    const run = await cities.generateCityPages({
      sourcePageId: source,
      countryId: IN,
      cityIds: [cityIds.mumbai, cityIds.gurugram],
      titleTemplate: null,
      productId: product.id,
    });
    expect(run.ok && run.data!.counts).toMatchObject({ created: 2, failed: 0 });
    const mumbaiPage = (await page(IN, `${mumbai}/autocad-${suffix}`))!;
    const gurugramPage = (await page(IN, `gurugram-${suffix}/autocad-${suffix}`))!;
    // An optional region that is empty leaves no stray separator behind.
    expect(mumbaiPage.title).toBe(`AutoCAD ${suffix} reseller in Mumbai ${suffix}`);
    expect(gurugramPage.title).toBe(`AutoCAD ${suffix} reseller in Gurugram ${suffix}, Haryana`);
    expect(mumbaiPage.status).toBe('DRAFT');
    expect(await prisma.cityProduct.findUnique({ where: { cityId_productId: { cityId: cityIds.mumbai, productId: product.id } } })).toMatchObject({
      pageId: mumbaiPage.id,
    });

    // A second page for the same product in the same city is refused, not silently re-pointed.
    const other = await newPage(IN, `autocad-alt-${suffix}`);
    const second = await cities.previewCityPages({
      sourcePageId: other,
      countryId: IN,
      cityIds: [cityIds.mumbai],
      titleTemplate: null,
      productId: product.id,
    });
    expect(second.ok && second.data!.rows[0]!.outcome).toBe('conflict');

    // The database refuses an association with another city's page.
    await expect(
      prisma.cityProduct.update({
        where: { cityId_productId: { cityId: cityIds.gurugram, productId: product.id } },
        data: { pageId: mumbaiPage.id },
      }),
    ).rejects.toThrow();
  });

  it('reports an address held by something else as a failure, and creates the rest', async () => {
    const offer = `offer-${suffix}`;
    const offerSource = await newPage(IN, offer);
    const redirect = await prisma.redirect.create({
      data: { source: `/${mumbai}/${offer}`, destination: '/', type: 'PERMANENT', isActive: true },
    });
    await prisma.urlRoute.create({
      data: { kind: 'REDIRECT', path: `/${mumbai}/${offer}`, pathKey: `/${mumbai}/${offer}`, countryId: IN, redirectId: redirect.id },
    });

    const preview = await cities.previewCityPages({
      sourcePageId: offerSource,
      countryId: IN,
      cityIds: [cityIds.delhi, cityIds.mumbai],
      titleTemplate: null,
    });
    expect(preview.ok && preview.data!.rows.map((row) => row.outcome)).toEqual(['create', 'conflict']);

    const run = await cities.generateCityPages({
      sourcePageId: offerSource,
      countryId: IN,
      cityIds: [cityIds.delhi, cityIds.mumbai],
      titleTemplate: null,
    });
    expect(run.ok && run.data!.counts).toEqual({ created: 1, replaced: 0, skipped: 0, failed: 1 });
    const failed = run.ok ? run.data!.rows.find((row) => row.outcome === 'failed') : null;
    expect(failed?.reason).toContain('redirect');
    // All or nothing per city: no page and no sections were left behind.
    expect(await page(IN, `${mumbai}/${offer}`)).toBeNull();
  });

  it('generates in a prefixed market at /ae/<city>/<page>', async () => {
    const source = await newPage(AE, plans);
    const run = await cities.generateCityPages({
      sourcePageId: source,
      countryId: AE,
      cityIds: [cityIds.dubai],
      titleTemplate: null,
    });
    expect(run.ok && run.data!.rows[0]).toMatchObject({ outcome: 'created', path: `/ae/${dubai}/${plans}` });
    expect(await page(AE, `${dubai}/${plans}`)).toMatchObject({ cityId: cityIds.dubai });
  });

  it('never trusts the ids it is sent', async () => {
    const wrongMarket = await cities.generateCityPages({
      sourcePageId: sourceId,
      countryId: IN,
      cityIds: [cityIds.dubai],
      titleTemplate: null,
    });
    expect(wrongMarket.ok).toBe(false);

    const crossMarketSource = await cities.previewCityPages({
      sourcePageId: sourceId,
      countryId: AE,
      cityIds: [cityIds.dubai],
      titleTemplate: null,
    });
    expect(crossMarketSource.ok).toBe(false);

    const citySource = await cities.previewCityPages({
      sourcePageId: (await page(IN, `${delhi}/${plans}`))!.id,
      countryId: IN,
      cityIds: [cityIds.mumbai],
      titleTemplate: null,
    });
    expect(citySource.ok).toBe(false);

    const foreignBatch = await cities.generateCityPages({
      sourcePageId: (await page(AE, plans))!.id,
      countryId: AE,
      cityIds: [cityIds.dubai],
      titleTemplate: null,
      batchId,
    });
    expect(foreignBatch.ok).toBe(false);
  });
});

describe('bulk city import', () => {
  it('validates every row before anything is written, and creates only what is new', async () => {
    const text = [
      'Name,Slug,Country,Region,Status',
      `Pune ${suffix},pune-${suffix},IN,Maharashtra,`,
      `Kochi ${suffix},,India,,DRAFT`,
      `Delhi again,${delhi},IN,,`,
      `Pune ${suffix},pune-${suffix},IN,Maharashtra,`,
      `Admin,admin,IN,,`,
      `Nowhere ${suffix},nowhere-${suffix},ZZ,,`,
      `Bad status ${suffix},bad-${suffix},IN,,LIVE`,
      `Sharjah ${suffix},sharjah-${suffix},AE,,PUBLISHED`,
    ].join('\n');
    const preview = await cities.previewCityImport({ text, createLanding: true, landingTitle: 'Autodesk reseller in {{city}}, {{region}}' });
    expect(preview.ok).toBe(true);
    const plan = preview.ok ? preview.data! : null;
    expect(plan!.rows.map((row) => row.outcome)).toEqual(['create', 'create', 'exists', 'duplicate', 'conflict', 'invalid', 'invalid', 'create']);
    expect(plan!.rows[1]).toMatchObject({ slug: `kochi-${suffix}`, region: null, status: 'DRAFT' });
    expect(await prisma.city.count({ where: { slug: `pune-${suffix}` } })).toBe(0);

    const creatable = plan!.rows.filter((row) => row.outcome === 'create').map((row) => row.line);
    const run = await cities.runCityImportAction({
      text,
      createLanding: true,
      landingTitle: 'Autodesk reseller in {{city}}, {{region}}',
      fingerprint: plan!.fingerprint,
      lines: creatable,
    });
    expect(run.ok && run.data!.map((row) => row.outcome)).toEqual(['created', 'created', 'created']);
    const pune = await prisma.city.findFirstOrThrow({ where: { slug: `pune-${suffix}` } });
    expect(pune).toMatchObject({ status: 'DRAFT', isActive: false, region: 'Maharashtra' });
    const kochiLanding = await prisma.page.findFirstOrThrow({ where: { countryId: IN, slug: `kochi-${suffix}` } });
    expect(kochiLanding).toMatchObject({ title: `Autodesk reseller in Kochi ${suffix}`, status: 'DRAFT', isCityHomepage: true });
    expect(await prisma.city.findFirstOrThrow({ where: { slug: `sharjah-${suffix}` } })).toMatchObject({ countryId: AE, status: 'PUBLISHED' });

    // The same part again creates nothing twice.
    const again = await cities.runCityImportAction({
      text,
      createLanding: true,
      landingTitle: 'Autodesk reseller in {{city}}, {{region}}',
      fingerprint: plan!.fingerprint,
      lines: creatable,
    });
    expect(again.ok && again.data!.every((row) => row.outcome === 'skipped')).toBe(true);
    expect(await prisma.city.count({ where: { slug: `pune-${suffix}` } })).toBe(1);

    // A changed file needs a new preview.
    const stale = await cities.runCityImportAction({ text: `${text}\nX,x-${suffix},IN,,`, fingerprint: plan!.fingerprint, lines: [2] });
    expect(stale.ok).toBe(false);
  });
});

describe('public addresses', () => {
  it('resolves /<city>, /<city>/<page> and /ae/<city>/<page> to the right pages', async () => {
    const delhiLanding = (await page(IN, delhi))!;
    const delhiPlans = (await page(IN, `${delhi}/${plans}`))!;
    const dubaiPlans = (await page(AE, `${dubai}/${plans}`))!;
    expect(await answer(`/${delhi}`)).toMatchObject({ status: 200, kind: 'page', id: delhiLanding.id, country: IN });
    expect(await answer(`/${delhi}/${plans}`)).toMatchObject({ status: 200, kind: 'page', id: delhiPlans.id, country: IN });
    expect(await answer(`/ae/${dubai}/${plans}`)).toMatchObject({ status: 200, kind: 'page', id: dubaiPlans.id, country: AE });
    // Never another market's content.
    expect(await answer(`/ae/${mumbai}/${plans}`)).toEqual({ status: 404 });
  });

  it('serves a city page only while its city is published; nothing is deleted meanwhile', async () => {
    const delhiPlans = (await page(IN, `${delhi}/${plans}`))!;
    expect((await setPageStatus(delhiPlans.id, 'PUBLISHED')).ok).toBe(true);
    expect(await getPublishedPageById(IN, delhiPlans.id)).not.toBeNull();
    expect(await isLive('PAGE', delhiPlans.id, IN)).toBe(true);

    for (const status of ['DRAFT', 'ARCHIVED'] as const) {
      const off = await cities.setCityStatus({ cityId: cityIds.delhi, status });
      expect(off.ok, status).toBe(true);
      expect(await getPublishedPageById(IN, delhiPlans.id)).toBeNull();
      expect(await isLive('PAGE', delhiPlans.id, IN)).toBe(false);
      expect(await prisma.page.findUnique({ where: { id: delhiPlans.id } })).not.toBeNull();
    }
    const archived = await prisma.city.findUniqueOrThrow({ where: { id: cityIds.delhi } });
    expect(archived.archivedAt).not.toBeNull();

    expect((await cities.setCityStatus({ cityId: cityIds.delhi, status: 'PUBLISHED' })).ok).toBe(true);
    expect(await getPublishedPageById(IN, delhiPlans.id)).not.toBeNull();
    expect(await prisma.city.findUniqueOrThrow({ where: { id: cityIds.delhi } })).toMatchObject({ archivedAt: null });
  });
});

describe('the sitemap', () => {
  async function listed(id: string) {
    const country = (await getCountryById(IN))!;
    return (await countryUrls(country)).some((entry) => entry.entity?.kind === 'page' && entry.entity.id === id);
  }

  it('lists a published page of an active, published city', async () => {
    const delhiPlans = (await page(IN, `${delhi}/${plans}`))!;
    expect(await listed(delhiPlans.id)).toBe(true);
  });

  it('leaves out the pages of a city that is noindexed or excluded — and still serves them', async () => {
    const delhiPlans = (await page(IN, `${delhi}/${plans}`))!;
    for (const change of [{ noIndex: true }, { excludeFromSitemap: true }]) {
      await prisma.city.update({ where: { id: cityIds.delhi }, data: change });
      expect(await listed(delhiPlans.id), JSON.stringify(change)).toBe(false);
      if (!('noIndex' in change)) expect(await getPublishedPageById(IN, delhiPlans.id)).not.toBeNull();
      await prisma.city.update({
        where: { id: cityIds.delhi },
        data: { noIndex: false, excludeFromSitemap: false },
      });
    }
    expect(await listed(delhiPlans.id)).toBe(true);
  });

  it('leaves out every page of a draft or archived city', async () => {
    const delhiPlans = (await page(IN, `${delhi}/${plans}`))!;
    for (const status of ['DRAFT', 'ARCHIVED'] as const) {
      expect((await cities.setCityStatus({ cityId: cityIds.delhi, status })).ok).toBe(true);
      expect(await listed(delhiPlans.id), status).toBe(false);
    }
    expect((await cities.setCityStatus({ cityId: cityIds.delhi, status: 'PUBLISHED' })).ok).toBe(true);
    expect(await listed(delhiPlans.id)).toBe(true);
  });
});

describe('renaming and deleting', () => {
  it('moves every page with a renamed city, redirecting the published ones', async () => {
    const renamed = `${delhi}-new`;
    const delhiPlans = (await page(IN, `${delhi}/${plans}`))!;
    const city = await prisma.city.findUniqueOrThrow({ where: { id: cityIds.delhi } });
    const saved = await cities.saveCity(city.id, formData({ countryId: IN, name: city.name, slug: renamed, status: 'PUBLISHED' }));
    expect(saved.ok).toBe(true);
    expect((await prisma.page.findUniqueOrThrow({ where: { id: delhiPlans.id } })).slug).toBe(`${renamed}/${plans}`);
    expect(await page(IN, renamed)).toMatchObject({ isCityHomepage: true, cityId: city.id });
    expect(await answer(`/${renamed}/${plans}`)).toMatchObject({ status: 200, id: delhiPlans.id });
    expect(await answer(`/${delhi}/${plans}`)).toEqual({ status: 308, location: `/${renamed}/${plans}` });
  });

  it('refuses to move a city to another market', async () => {
    const city = await prisma.city.findUniqueOrThrow({ where: { id: cityIds.mumbai } });
    const result = await cities.saveCity(city.id, formData({ countryId: AE, name: city.name, slug: city.slug }));
    expect(result.ok).toBe(false);
    expect((await prisma.city.findUniqueOrThrow({ where: { id: city.id } })).countryId).toBe(IN);
  });

  it('refuses to delete a city with pages, and says how many', async () => {
    const result = await cities.deleteCity({ cityId: cityIds.mumbai });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/still has \d+ page/);
    expect(await prisma.city.findUnique({ where: { id: cityIds.mumbai } })).not.toBeNull();
    expect(await prisma.page.count({ where: { cityId: cityIds.mumbai, deletedAt: null } })).toBeGreaterThan(0);
  });

  it('deletes a city once its pages are gone, leaving recycle-bin pages as ordinary pages', async () => {
    const pages = await prisma.page.findMany({ where: { cityId: cityIds.mumbai, deletedAt: null } });
    for (const row of pages) {
      // The landing page is a normal page, deleted like any other.
      expect((await deletePage(row.id)).ok).toBe(true);
    }
    const result = await cities.deleteCity({ cityId: cityIds.mumbai });
    expect(result.ok).toBe(true);
    expect(await prisma.city.findUnique({ where: { id: cityIds.mumbai } })).toBeNull();
    for (const row of pages) {
      expect(await prisma.page.findUnique({ where: { id: row.id } })).toMatchObject({ cityId: null, isCityHomepage: false });
    }
    // The freed address can be used again.
    const again = await cities.checkCitySlug({ countryId: IN, slug: mumbai });
    expect(again.ok && again.data?.message).toBeNull();
  });
});

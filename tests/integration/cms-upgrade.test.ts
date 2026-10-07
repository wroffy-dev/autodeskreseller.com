import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mockAuth, formData, uniqueSuffix, TEST_ACTOR, ensureTestCountry, testCountryContext } from '../helpers';

mockAuth();

const { prisma } = await import('@/lib/db/prisma');
const { createPage, addSection, updateSection, duplicateSection } = await import('@/lib/actions/pages');
const { saveForm } = await import('@/lib/actions/forms');
const { createProduct, reorderProducts, toggleProductFeatured, saveBrand, deleteBrand } = await import(
  '@/lib/actions/products'
);
const { parseSectionDesign } = await import('@/lib/cms/design');
const { selectProducts } = await import('@/lib/services/products');
const { purgeFromTrash } = await import('@/lib/actions/trash');
const { getPublicForm } = await import('@/lib/services/forms');
const { EMPTY_FORM, starterFields } = await import('@/lib/cms/form-model');

const suffix = uniqueSuffix();
const pageIds: string[] = [];
const productIds: string[] = [];
const formIds: string[] = [];
const brandIds: string[] = [];

beforeAll(async () => {
  const role = await prisma.userRole.upsert({
    where: { slug: 'test-role-cms' },
    update: {},
    create: { slug: 'test-role-cms', name: 'Test Role CMS', rank: 5 },
  });
  await prisma.user.upsert({
    where: { id: TEST_ACTOR.id },
    update: {},
    create: { id: TEST_ACTOR.id, email: TEST_ACTOR.email, name: TEST_ACTOR.name, roleId: role.id },
  });
});

afterAll(async () => {
  await prisma.pageSection.deleteMany({ where: { pageId: { in: pageIds } } });
  await prisma.page.deleteMany({ where: { id: { in: pageIds } } });
  await prisma.formField.deleteMany({ where: { formId: { in: formIds } } });
  await prisma.form.deleteMany({ where: { id: { in: formIds } } });
  await prisma.product.deleteMany({ where: { id: { in: productIds } } });
  await prisma.brand.deleteMany({ where: { id: { in: brandIds } } });
  await prisma.auditLog.deleteMany({ where: { actorId: TEST_ACTOR.id } });
  await prisma.user.deleteMany({ where: { id: TEST_ACTOR.id } });
  await prisma.userRole.deleteMany({ where: { slug: 'test-role-cms' } });
  await prisma.$disconnect();
});

/**
 * The end-to-end path the Form Management bug broke:
 * Forms → New Form → build → save → activate → select inside a section.
 */
describe('form management flow', () => {
  let formId = '';
  let formSlug = '';

  it('creates a form from the same defaults the New Form route uses', async () => {
    const result = await saveForm(null, {
      ...EMPTY_FORM,
      name: `Hero form ${suffix}`,
      slug: '',
      fields: starterFields().map((field) => ({
        id: null,
        type: field.type,
        label: field.label,
        name: field.name,
        placeholder: null,
        helpText: null,
        defaultValue: null,
        isRequired: field.isRequired,
        width: field.width,
        options: [],
        minLength: null,
        maxLength: null,
        pattern: null,
      })),
    });

    expect(result.ok).toBe(true);
    formId = (result as { data: { id: string } }).data.id;
    formIds.push(formId);

    const stored = await prisma.form.findUniqueOrThrow({
      where: { id: formId },
      include: { fields: true },
    });
    formSlug = stored.slug;
    expect(stored.slug).toBeTruthy();
    expect(stored.isActive).toBe(true);
    expect(stored.fields).toHaveLength(4);
  });

  it('accepts the newer field types', async () => {
    const result = await saveForm(formId, {
      ...EMPTY_FORM,
      id: formId,
      name: `Hero form ${suffix}`,
      slug: formSlug,
      fields: [
        {
          id: null,
          type: 'EMAIL',
          label: 'Work email',
          name: 'email',
          placeholder: null,
          helpText: null,
          defaultValue: null,
          isRequired: true,
          width: 'full',
          options: [],
          minLength: null,
          maxLength: null,
          pattern: null,
        },
        {
          id: null,
          type: 'URL',
          label: 'Website',
          name: 'website_url',
          placeholder: null,
          helpText: null,
          defaultValue: null,
          isRequired: false,
          width: 'half',
          options: [],
          minLength: null,
          maxLength: null,
          pattern: null,
        },
        {
          id: null,
          type: 'DATE',
          label: 'Preferred date',
          name: 'preferred_date',
          placeholder: null,
          helpText: null,
          defaultValue: null,
          isRequired: false,
          width: 'half',
          options: [],
          minLength: null,
          maxLength: null,
          pattern: null,
        },
        {
          id: null,
          type: 'CONSENT',
          label: 'I agree to be contacted',
          name: 'consent',
          placeholder: null,
          helpText: null,
          defaultValue: null,
          isRequired: true,
          width: 'full',
          options: [],
          minLength: null,
          maxLength: null,
          pattern: null,
        },
      ],
    });

    expect(result.ok).toBe(true);
    const stored = await prisma.form.findUniqueOrThrow({ where: { id: formId }, include: { fields: true } });
    expect(stored.fields.map((f) => f.type).sort()).toEqual(['CONSENT', 'DATE', 'EMAIL', 'URL']);
  });

  it('rejects duplicate machine names instead of silently overwriting a field', async () => {
    const field = (name: string) => ({
      id: null,
      type: 'TEXT' as const,
      label: 'A field',
      name,
      placeholder: null,
      helpText: null,
      defaultValue: null,
      isRequired: false,
      width: 'full' as const,
      options: [],
      minLength: null,
      maxLength: null,
      pattern: null,
    });

    const result = await saveForm(formId, {
      ...EMPTY_FORM,
      id: formId,
      name: `Hero form ${suffix}`,
      slug: formSlug,
      fields: [field('duplicate'), field('duplicate')],
    });
    expect(result.ok).toBe(false);
  });

  it('exposes the active form to the public renderer, so a hero can use it', async () => {
    const publicForm = await getPublicForm(formSlug);
    expect(publicForm).not.toBeNull();
    expect(publicForm!.slug).toBe(formSlug);
  });

  it('stores a hero section that renders that form', async () => {
    const page = await createPage(formData({ title: `Hero page ${suffix}`, slug: '', status: 'DRAFT' }));
    expect(page.ok).toBe(true);
    const pageId = (page as { data: { id: string } }).data.id;
    pageIds.push(pageId);

    const added = await addSection(pageId, 'hero');
    expect(added.ok).toBe(true);
    const sectionId = (added as { data: { id: string } }).data.id;

    const saved = await updateSection(sectionId, {
      content: {
        layout: 'contentForm',
        heading: 'Talk to sales',
        showForm: true,
        formSlug,
      },
    });
    expect(saved.ok).toBe(true);

    const stored = await prisma.pageSection.findUniqueOrThrow({ where: { id: sectionId } });
    const content = stored.content as Record<string, unknown>;
    expect(content.showForm).toBe(true);
    expect(content.formSlug).toBe(formSlug);
    expect(content.layout).toBe('contentForm');
  });
});

describe('section anchors', () => {
  let pageId = '';
  let firstId = '';

  beforeAll(async () => {
    const page = await createPage(formData({ title: `Anchor page ${suffix}`, slug: '', status: 'DRAFT' }));
    pageId = (page as { data: { id: string } }).data.id;
    pageIds.push(pageId);

    const first = await addSection(pageId, 'headingText');
    firstId = (first as { data: { id: string } }).data.id;
    await updateSection(firstId, { settings: { anchorId: 'pricing' } });
  });

  it('normalises what the admin typed', async () => {
    const stored = await prisma.pageSection.findUniqueOrThrow({ where: { id: firstId } });
    expect(parseSectionDesign(stored.settings).anchorId).toBe('pricing');
  });

  it('refuses a duplicate anchor on the same page', async () => {
    const second = await addSection(pageId, 'headingText');
    const secondId = (second as { data: { id: string } }).data.id;

    const result = await updateSection(secondId, { settings: { anchorId: 'Pricing' } });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.fieldErrors?.anchorId).toBeTruthy();
  });

  it('clears the anchor on a duplicated section so two elements never share an id', async () => {
    const copy = await duplicateSection(firstId);
    expect(copy.ok).toBe(true);
    const copyId = (copy as { data: { id: string } }).data.id;

    const stored = await prisma.pageSection.findUniqueOrThrow({ where: { id: copyId } });
    expect(parseSectionDesign(stored.settings).anchorId).toBe('');
  });
});

describe('product ordering and featured products', () => {
  let brandId = '';

  beforeAll(async () => {
    const brand = await saveBrand(null, formData({ name: `Acme ${suffix}`, slug: '', sortOrder: '0' }));
    expect(brand.ok).toBe(true);
    brandId = (brand as { data: { id: string } }).data.id;
    brandIds.push(brandId);

    for (const [index, name] of ['Alpha', 'Bravo', 'Charlie'].entries()) {
      const result = await createProduct(
        formData({
          name: `${name} ${suffix}`,
          slug: '',
          status: 'PUBLISHED',
          isFeatured: 'true',
          sortOrder: String((index + 1) * 10),
          currency: 'INR',
          billingPeriod: 'BOTH',
          brandId,
          features: [],
          benefits: [],
          specs: [],
          galleryIds: [],
        }),
      );
      expect(result.ok).toBe(true);
      productIds.push((result as { data: { id: string } }).data.id);
    }
  });

  it('supports more than one featured product', async () => {
    const featured = await prisma.product.findMany({
      where: { id: { in: productIds }, isFeatured: true },
    });
    expect(featured).toHaveLength(3);
  });

  it('persists a manual featured order that the frontend then respects', async () => {
    const reversed = [...productIds].reverse();
    const result = await reorderProducts({ order: reversed, scope: 'featured' });
    expect(result.ok).toBe(true);

    const rows = await prisma.product.findMany({
      where: { id: { in: productIds } },
      orderBy: { featuredOrder: 'asc' },
      select: { id: true, featuredOrder: true },
    });
    expect(rows.map((r) => r.id)).toEqual(reversed);
    // Stored in the database, so the order survives a restart.
    expect(rows.every((r) => r.featuredOrder > 0)).toBe(true);

    const selected = await selectProducts(testCountryContext(), { source: 'featured', limit: 10 });
    const ours = selected.filter((p) => productIds.includes(p.id)).map((p) => p.id);
    expect(ours).toEqual(reversed);
  });

  it('keeps the catalogue order independent of the featured order', async () => {
    const result = await reorderProducts({ order: productIds, scope: 'catalogue' });
    expect(result.ok).toBe(true);

    const rows = await prisma.product.findMany({
      where: { id: { in: productIds } },
      orderBy: { sortOrder: 'asc' },
      select: { id: true },
    });
    expect(rows.map((r) => r.id)).toEqual(productIds);

    // The featured order set by the previous test is untouched.
    const featured = await prisma.product.findMany({
      where: { id: { in: productIds } },
      orderBy: { featuredOrder: 'asc' },
      select: { id: true },
    });
    expect(featured.map((r) => r.id)).toEqual([...productIds].reverse());
  });

  it('rejects an order containing a product that does not exist', async () => {
    const result = await reorderProducts({ order: [...productIds, 'not-a-real-id'], scope: 'catalogue' });
    expect(result.ok).toBe(false);
  });

  it('appends a newly featured product rather than disturbing the arrangement', async () => {
    const first = productIds[0]!;
    await toggleProductFeatured(first); // unfeature
    const off = await prisma.product.findUniqueOrThrow({ where: { id: first } });
    expect(off.isFeatured).toBe(false);

    await toggleProductFeatured(first); // feature again
    const on = await prisma.product.findUniqueOrThrow({ where: { id: first } });
    expect(on.isFeatured).toBe(true);

    const others = await prisma.product.findMany({
      where: { id: { in: productIds.slice(1) } },
      select: { featuredOrder: true },
    });
    // It joins the end of the list.
    expect(on.featuredOrder).toBeGreaterThan(Math.max(...others.map((o) => o.featuredOrder)));
  });

  it('selects products by brand', async () => {
    const byBrand = await selectProducts(testCountryContext(), { source: 'brand', brandId, limit: 10 });
    expect(byBrand.map((p) => p.id).sort()).toEqual([...productIds].sort());
    expect(byBrand[0]!.brandName).toContain('Acme');
  });

  it('keeps hand-picked order exactly as the admin arranged it', async () => {
    const picked = [productIds[2]!, productIds[0]!];
    const result = await selectProducts(testCountryContext(), { source: 'selected', productIds: picked, limit: 10 });
    expect(result.map((p) => p.id)).toEqual(picked);
  });

  it('keeps products when their brand is deleted, and stops showing the brand', async () => {
    const throwaway = await saveBrand(null, formData({ name: `Temp ${suffix}`, slug: '', sortOrder: '0' }));
    const tempId = (throwaway as { data: { id: string } }).data.id;
    brandIds.push(tempId);
    const productId = productIds[0]!;

    await prisma.product.update({ where: { id: productId }, data: { brandId: tempId } });
    const result = await deleteBrand(tempId);
    expect(result.ok).toBe(true);

    // The brand goes to the recycle bin, and the product stays — still
    // pointing at it, so restoring the brand reconnects the product.
    const product = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
    expect(product.deletedAt).toBeNull();
    expect(product.brandId).toBe(tempId);
    expect((await prisma.brand.findUniqueOrThrow({ where: { id: tempId } })).deletedAt).not.toBeNull();

    // Visitors no longer see a brand that has been deleted.
    const [shown] = await selectProducts(testCountryContext(), { source: 'selected', productIds: [productId], limit: 1 });
    expect(shown?.id).toBe(productId);
    expect(shown?.brandName).toBeNull();
    expect(shown?.brandId).toBeNull();

    // Deleted for good, the product simply loses it.
    expect((await purgeFromTrash('brand', tempId)).ok).toBe(true);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: productId } })).brandId).toBeNull();

    await prisma.product.update({ where: { id: productId }, data: { brandId } });
  });
});

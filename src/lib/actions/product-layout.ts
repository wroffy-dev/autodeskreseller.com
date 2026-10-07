'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { addressesOf, revalidateAddresses } from '@/lib/urls/revalidate';
import { ProductSurface } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { refreshSeoScores } from '@/lib/seo/intelligence/refresh';
import { authorize } from '@/lib/auth/guards';
import { recordAudit } from '@/lib/services/audit';
import { blockDefaults, getBlock, blockAllowedOnSurface } from '@/lib/cms/blocks';
import { parseSectionDesign, DEFAULT_SECTION_DESIGN } from '@/lib/cms/design';
import {
  productCardSchema,
  productImageSchema,
  productLayoutSchema,
  productTypographySchema,
} from '@/lib/cms/product-settings';
import { materialiseProductSurface } from '@/lib/services/product-cms';
import { sanitizeText } from '@/lib/utils/sanitize';
import { success, failure, toActionError, type ActionResult } from '@/lib/utils/result';

/**
 * Product structure and design actions.
 *
 * Deliberately a mirror of the page- and blog-section actions: same validation
 * through the block registry, same design parsing, same audit trail. A product
 * section is a `ProductSection` row rather than a `PageSection` one only
 * because it hangs off a product and a surface — everything else is shared.
 *
 * Every section belongs to a product. There is no global product layout, so
 * each of these resolves the product first and refuses anything that does not
 * name one that still exists.
 */

const surfaceSchema = z.nativeEnum(ProductSurface);

/** The surface's key in the block registry, which decides what may be added. */
function surfaceKey(surface: ProductSurface) {
  return surface === 'SIDEBAR' ? ('productSidebar' as const) : ('productDetail' as const);
}

async function revalidateProduct(productId: string, slug?: string) {
  revalidatePath(`/admin/products/${productId}/layout`);
  revalidatePath('/admin/products/design');
  if (slug) {
    // Every market's copy of this product page, at whatever address the URL
    // registry has it — not just the root market's `/products/<slug>`.
    revalidatePath(`/products/${slug}`);
    revalidateAddresses(await addressesOf(productId));
  }
  // The layout is part of what every market's product page shows and is scored on.
  refreshSeoScores(async () =>
    (
      await prisma.productCountry.findMany({ where: { productId, deletedAt: null }, select: { countryId: true } })
    ).map((row) => ({ type: 'PRODUCT_MARKET' as const, id: productId, countryId: row.countryId })),
  );
}

async function loadSection(sectionId: string) {
  return prisma.productSection.findUnique({
    where: { id: sectionId },
    include: { product: { select: { id: true, slug: true, deletedAt: true } } },
  });
}

async function requireProduct(productId: string) {
  return prisma.product.findFirst({
    where: { id: productId, deletedAt: null },
    select: { id: true, slug: true, name: true },
  });
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

/**
 * Copies the built-in arrangement into real rows the first time a product's
 * layout is opened, so the builder starts from the page that is already live
 * rather than from nothing.
 */
export async function ensureProductSurface(
  productId: string,
  rawSurface: unknown,
): Promise<ActionResult> {
  try {
    await authorize('products.edit');
    const surface = surfaceSchema.parse(rawSurface);
    const product = await requireProduct(productId);
    if (!product) return failure('That product no longer exists.');

    await materialiseProductSurface(product.id, surface);
    await revalidateProduct(product.id, product.slug);
    return success(undefined, 'Ready.');
  } catch (error) {
    return toActionError(error);
  }
}

export async function addProductSection(input: {
  productId: string;
  surface: ProductSurface;
  blockType: string;
}): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await authorize('products.edit');
    const surface = surfaceSchema.parse(input.surface);
    const product = await requireProduct(input.productId);
    if (!product) return failure('That product no longer exists.');

    const definition = getBlock(input.blockType);
    if (!definition) return failure('Unknown block type.');
    if (!blockAllowedOnSurface(input.blockType, surfaceKey(surface))) {
      return failure('That block cannot be added here.');
    }

    // Adding to a surface that has never been opened materialises it first, so
    // the new section joins the arrangement rather than replacing it.
    await materialiseProductSurface(product.id, surface);

    /*
     * A singleton block is part of the page's anatomy — one header, one price
     * box — so adding a second is rejected rather than silently producing two
     * titles for one product.
     *
     * Counted after the arrangement exists, never before: the built-in one
     * already carries the header and the price box, so a count taken while the
     * surface was still empty would wave through a second of either.
     */
    if (definition.singleton) {
      const existing = await prisma.productSection.count({
        where: { productId: product.id, surface, blockType: input.blockType },
      });
      if (existing > 0) return failure(`“${definition.label}” is already on this layout.`);
    }

    const last = await prisma.productSection.findFirst({
      where: { productId: product.id, surface },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });

    const section = await prisma.productSection.create({
      data: {
        productId: product.id,
        surface,
        blockType: input.blockType,
        name: definition.label,
        sortOrder: (last?.sortOrder ?? 0) + 10,
        content: blockDefaults(input.blockType) as object,
        settings: DEFAULT_SECTION_DESIGN as unknown as object,
      },
    });

    await recordAudit({
      actor: user,
      action: 'product.section.added',
      entity: 'ProductSection',
      entityId: section.id,
      summary: `Added a ${definition.label} to ${product.name}'s ${surface.toLowerCase()}`,
    });

    await revalidateProduct(product.id, product.slug);
    return success({ id: section.id }, `${definition.label} added.`);
  } catch (error) {
    return toActionError(error);
  }
}

export async function updateProductSection(
  sectionId: string,
  payload: { content?: unknown; settings?: unknown; name?: string | null; isVisible?: boolean },
): Promise<ActionResult> {
  try {
    await authorize('products.edit');
    const section = await loadSection(sectionId);
    if (!section || section.product.deletedAt) return failure('That section no longer exists.');

    const definition = getBlock(section.blockType);
    const data: Record<string, unknown> = {};

    if (payload.content !== undefined && definition) {
      data.content = definition.schema.parse(payload.content);
    }
    if (payload.settings !== undefined) {
      const design = parseSectionDesign(payload.settings);

      if (design.anchorId) {
        const siblings = await prisma.productSection.findMany({
          where: {
            productId: section.productId,
            surface: section.surface,
            id: { not: sectionId },
          },
          select: { settings: true },
        });
        const taken = siblings.some(
          (row) => parseSectionDesign(row.settings).anchorId === design.anchorId,
        );
        if (taken) {
          return failure(`Another section already uses the anchor “${design.anchorId}”.`, {
            anchorId: ['This anchor is already used on this layout'],
          });
        }
      }

      data.settings = design as unknown as object;
    }
    if (payload.name !== undefined) data.name = payload.name ? sanitizeText(payload.name) : null;
    if (payload.isVisible !== undefined) data.isVisible = payload.isVisible;

    await prisma.productSection.update({ where: { id: sectionId }, data });
    await revalidateProduct(section.productId, section.product.slug);
    return success(undefined, 'Section saved.');
  } catch (error) {
    return toActionError(error);
  }
}

export async function duplicateProductSection(
  sectionId: string,
): Promise<ActionResult<{ id: string }>> {
  try {
    await authorize('products.edit');
    const source = await loadSection(sectionId);
    if (!source || source.product.deletedAt) return failure('That section no longer exists.');

    const definition = getBlock(source.blockType);
    if (definition?.singleton) {
      return failure(`“${definition.label}” can only appear once, so it cannot be duplicated.`);
    }

    // The copy keeps every design value except the anchor: two elements cannot
    // share one DOM id.
    const design = parseSectionDesign(source.settings);

    const copy = await prisma.productSection.create({
      data: {
        productId: source.productId,
        surface: source.surface,
        blockType: source.blockType,
        name: source.name ? `${source.name} (copy)` : null,
        sortOrder: source.sortOrder + 5,
        isVisible: source.isVisible,
        content: source.content as object,
        settings: { ...design, anchorId: '' } as unknown as object,
      },
    });

    await normaliseOrder(source.productId, source.surface);
    await revalidateProduct(source.productId, source.product.slug);
    return success({ id: copy.id }, 'Section duplicated.');
  } catch (error) {
    return toActionError(error);
  }
}

export async function deleteProductSection(sectionId: string): Promise<ActionResult> {
  try {
    await authorize('products.edit');
    const section = await loadSection(sectionId);
    if (!section) return failure('That section no longer exists.');

    await prisma.productSection.delete({ where: { id: sectionId } });
    await revalidateProduct(section.productId, section.product.slug);
    return success(undefined, 'Section removed.');
  } catch (error) {
    return toActionError(error);
  }
}

const reorderSchema = z.object({
  productId: z.string().min(1).max(40),
  surface: surfaceSchema,
  order: z.array(z.string().min(1)).max(200),
});

export async function reorderProductSections(input: unknown): Promise<ActionResult> {
  try {
    await authorize('products.edit');
    const { productId, surface, order } = reorderSchema.parse(input);

    // Reject ids that do not belong to this product's surface.
    const owned = await prisma.productSection.findMany({
      where: { productId, surface },
      select: { id: true },
    });
    const ownedIds = new Set(owned.map((row) => row.id));
    if (order.some((id) => !ownedIds.has(id))) return failure('Invalid section order.');

    await prisma.$transaction(
      order.map((id, index) =>
        prisma.productSection.update({ where: { id }, data: { sortOrder: (index + 1) * 10 } }),
      ),
    );

    const product = await requireProduct(productId);
    await revalidateProduct(productId, product?.slug);
    return success(undefined, 'Order saved.');
  } catch (error) {
    return toActionError(error);
  }
}

export async function toggleProductSectionVisibility(sectionId: string): Promise<ActionResult> {
  try {
    await authorize('products.edit');
    const section = await loadSection(sectionId);
    if (!section) return failure('That section no longer exists.');

    await prisma.productSection.update({
      where: { id: sectionId },
      data: { isVisible: !section.isVisible },
    });

    await revalidateProduct(section.productId, section.product.slug);
    return success(undefined, section.isVisible ? 'Section hidden.' : 'Section shown.');
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * Throws a product's layout away, so it follows the built-in arrangement again.
 *
 * The honest way back: with no rows, the page renders the default anatomy,
 * which is exactly what a product that was never touched renders.
 */
export async function resetProductSurface(
  productId: string,
  rawSurface: unknown,
): Promise<ActionResult> {
  try {
    const user = await authorize('products.edit');
    const surface = surfaceSchema.parse(rawSurface);
    const product = await requireProduct(productId);
    if (!product) return failure('That product no longer exists.');

    await prisma.productSection.deleteMany({ where: { productId: product.id, surface } });

    await recordAudit({
      actor: user,
      action: 'product.layout.reset',
      entity: 'Product',
      entityId: product.id,
      summary: `Reset ${product.name}'s ${surface.toLowerCase()} layout to the default`,
    });

    await revalidateProduct(product.id, product.slug);
    return success(undefined, 'Layout reset to the default.');
  } catch (error) {
    return toActionError(error);
  }
}

async function normaliseOrder(productId: string, surface: ProductSurface) {
  const rows = await prisma.productSection.findMany({
    where: { productId, surface },
    orderBy: { sortOrder: 'asc' },
    select: { id: true },
  });
  await prisma.$transaction(
    rows.map((row, index) =>
      prisma.productSection.update({ where: { id: row.id }, data: { sortOrder: (index + 1) * 10 } }),
    ),
  );
}

// ---------------------------------------------------------------------------
// Design
// ---------------------------------------------------------------------------

const designSchema = z.object({
  cardSettings: productCardSchema,
  imageSettings: productImageSchema,
  layoutSettings: productLayoutSchema,
  typography: productTypographySchema,
});

/**
 * Saves the catalogue-wide product design.
 *
 * One singleton row, four validated groups. Everything in it is an override:
 * a blank value means "inherit", so saving an untouched form leaves every
 * product page exactly as it was.
 */
export async function saveProductDesign(input: unknown): Promise<ActionResult> {
  try {
    const user = await authorize('products.edit');
    const data = designSchema.parse(input);

    await prisma.productSettings.upsert({
      where: { id: 'singleton' },
      update: {
        cardSettings: data.cardSettings,
        imageSettings: data.imageSettings,
        layoutSettings: data.layoutSettings,
        typography: data.typography,
      },
      create: {
        id: 'singleton',
        cardSettings: data.cardSettings,
        imageSettings: data.imageSettings,
        layoutSettings: data.layoutSettings,
        typography: data.typography,
      },
    });

    await recordAudit({
      actor: user,
      action: 'product.design.updated',
      entity: 'ProductSettings',
      entityId: 'singleton',
      summary: 'Updated the product design settings',
      after: data,
    });

    revalidatePath('/admin/products/design');
    // Product cards and product pages both read these, so the whole site.
    revalidatePath('/', 'layout');
    return success(undefined, 'Design saved.');
  } catch (error) {
    return toActionError(error);
  }
}

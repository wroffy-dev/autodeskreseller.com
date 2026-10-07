'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { authorize } from '@/lib/auth/guards';
import { recordAudit } from '@/lib/services/audit';
import { slugify, uniqueSlug } from '@/lib/utils/slug';
import { sanitizeText, safeUrl } from '@/lib/utils/sanitize';
import { success, failure, toActionError, type ActionResult } from '@/lib/utils/result';
import { resolveActionCountry } from '@/lib/country/admin';
import { assertCountryAccess } from '@/lib/country/access';
import { isCmsIconName } from '@/components/ui/icon-names';
import { cssLength } from '@/lib/cms/chrome';

const menuSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  location: z.enum(['HEADER', 'FOOTER', 'FOOTER_SECONDARY', 'LEGAL', 'MOBILE', 'SIDEBAR']),
});

export async function saveNavigation(
  navigationId: string | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await authorize('navigation.manage');
    const input = menuSchema.parse({
      name: formData.get('name'),
      location: formData.get('location') || 'HEADER',
    });

    // A menu belongs to one market: the UAE header is not forced to mirror
    // India's. Editing an existing menu never moves it between markets.
    const existingMenu = navigationId
      ? await prisma.navigation.findUnique({
          where: { id: navigationId },
          select: { countryId: true },
        })
      : null;
    if (navigationId && !existingMenu) return failure('That menu no longer exists.');
    if (existingMenu) await assertCountryAccess(user, existingMenu.countryId);

    const country = existingMenu
      ? await resolveActionCountry(user, existingMenu.countryId)
      : await resolveActionCountry(user, formData.get('countryId')?.toString() || null);

    const slug =
      navigationId === null
        ? await uniqueSlug(slugify(input.name), async (candidate) => {
            const existing = await prisma.navigation.findUnique({
              where: { countryId_slug: { countryId: country.id, slug: candidate } },
              select: { id: true },
            });
            return Boolean(existing);
          })
        : undefined;

    const menu = navigationId
      ? await prisma.navigation.update({
          where: { id: navigationId },
          data: { name: sanitizeText(input.name), location: input.location },
        })
      : await prisma.navigation.create({
          data: {
            countryId: country.id,
            name: sanitizeText(input.name),
            slug: slug!,
            location: input.location,
          },
        });

    await recordAudit({
      actor: user,
      action: navigationId ? 'updated' : 'created',
      entity: 'Navigation',
      entityId: menu.id,
      summary: `${navigationId ? 'Updated' : 'Created'} menu “${menu.name}”`,
    });

    revalidatePath('/admin/navigation');
    revalidatePath('/', 'layout');
    return success({ id: menu.id }, 'Menu saved.');
  } catch (error) {
    return toActionError(error);
  }
}

export async function deleteNavigation(navigationId: string): Promise<ActionResult> {
  try {
    const user = await authorize('navigation.manage');
    const menu = await prisma.navigation.findUnique({
      where: { id: navigationId },
      include: { _count: { select: { items: true } } },
    });
    if (!menu) return failure('That menu no longer exists.');

    await prisma.navigation.delete({ where: { id: navigationId } });

    await recordAudit({
      actor: user,
      action: 'deleted',
      entity: 'Navigation',
      entityId: navigationId,
      summary: `Deleted menu “${menu.name}” with ${menu._count.items} item(s)`,
    });

    revalidatePath('/admin/navigation');
    revalidatePath('/', 'layout');
    return success(undefined, 'Menu deleted.');
  } catch (error) {
    return toActionError(error);
  }
}

const itemSchema = z.object({
  id: z.string().optional().nullable(),
  label: z.string().trim().min(1, 'Every item needs a label').max(120),
  linkType: z.enum(['INTERNAL', 'EXTERNAL', 'PAGE', 'PRODUCT', 'BLOG_POST', 'BLOG_CATEGORY']),
  url: z.string().max(500).optional().nullable(),
  pageId: z.string().max(40).optional().nullable(),
  productId: z.string().max(40).optional().nullable(),
  blogPostId: z.string().max(40).optional().nullable(),
  blogCategoryId: z.string().max(40).optional().nullable(),
  description: z.string().max(200).optional().nullable(),
  /** An icon this app ships, shown in dropdowns and mega menus. */
  icon: z.string().max(40).optional().nullable(),
  /** An uploaded image shown in place of that icon. */
  imageId: z.string().max(40).optional().nullable(),
  imageSize: z.string().max(16).optional().nullable(),
  openInNewTab: z.boolean().default(false),
  isHighlighted: z.boolean().default(false),
  /** Render this item's children as a panel of columns rather than a list. */
  megaMenu: z.boolean().default(false),
  megaColumns: z.coerce.number().int().min(1).max(6).catch(3).default(3),
  megaWidth: z.string().max(16).optional().nullable(),
  megaAlign: z.enum(['center', 'left', 'screen']).catch('center').default('center'),
  isVisible: z.boolean().default(true),
  children: z.array(z.lazy((): z.ZodTypeAny => itemSchema)).max(30).default([]),
});

const treeSchema = z.object({
  navigationId: z.string().min(1),
  items: z.array(itemSchema).max(60),
});

type ItemInput = {
  id?: string | null;
  label: string;
  linkType: 'INTERNAL' | 'EXTERNAL' | 'PAGE' | 'PRODUCT' | 'BLOG_POST' | 'BLOG_CATEGORY';
  url?: string | null;
  pageId?: string | null;
  productId?: string | null;
  blogPostId?: string | null;
  blogCategoryId?: string | null;
  description?: string | null;
  icon?: string | null;
  imageId?: string | null;
  imageSize?: string | null;
  openInNewTab: boolean;
  isHighlighted: boolean;
  megaMenu: boolean;
  megaColumns: number;
  megaWidth?: string | null;
  megaAlign: 'center' | 'left' | 'screen';
  isVisible: boolean;
  children: ItemInput[];
};

/**
 * Replaces a menu's whole item tree in one transaction.
 *
 * Rewriting rather than diffing keeps ordering and nesting consistent, and the
 * menus involved are small enough that the cost is irrelevant.
 */
export async function saveNavigationItems(input: unknown): Promise<ActionResult> {
  try {
    const user = await authorize('navigation.manage');
    const parsed = treeSchema.parse(input) as { navigationId: string; items: ItemInput[] };

    const menu = await prisma.navigation.findUnique({ where: { id: parsed.navigationId } });
    if (!menu) return failure('That menu no longer exists.');

    await prisma.$transaction(async (tx) => {
      // Children cascade, so deleting the roots clears the tree.
      await tx.navigationItem.deleteMany({ where: { navigationId: parsed.navigationId } });

      const insert = async (items: ItemInput[], parentId: string | null) => {
        for (const [index, item] of items.entries()) {
          const url = item.linkType === 'INTERNAL' || item.linkType === 'EXTERNAL'
            ? safeUrl(item.url ?? '')
            : null;

          const created = await tx.navigationItem.create({
            data: {
              navigationId: parsed.navigationId,
              parentId,
              label: sanitizeText(item.label),
              linkType: item.linkType,
              url,
              pageId: item.linkType === 'PAGE' ? (item.pageId ?? null) : null,
              productId: item.linkType === 'PRODUCT' ? (item.productId ?? null) : null,
              blogPostId: item.linkType === 'BLOG_POST' ? (item.blogPostId ?? null) : null,
              blogCategoryId: item.linkType === 'BLOG_CATEGORY' ? (item.blogCategoryId ?? null) : null,
              description: item.description ? sanitizeText(item.description) : null,
              // Only a name from the shipped set is stored; anything else is
              // no icon, which is what the renderer would show anyway.
              icon: item.icon && isCmsIconName(item.icon) ? item.icon : null,
              imageId: item.imageId || null,
              // A length or nothing: anything else would reach the renderer as
              // a style value, and it is never worth trusting one of those.
              imageSize: cssLength(item.imageSize) ?? '',
              openInNewTab: item.openInNewTab,
              isHighlighted: item.isHighlighted,
              megaMenu: item.megaMenu,
              megaColumns: item.megaColumns,
              megaWidth: cssLength(item.megaWidth) ?? '',
              megaAlign: item.megaAlign,
              isVisible: item.isVisible,
              sortOrder: (index + 1) * 10,
            },
          });

          // Only one level of nesting is offered in the UI, but the schema and
          // the header renderer both support deeper trees.
          if (item.children.length > 0) await insert(item.children, created.id);
        }
      };

      await insert(parsed.items, null);
    });

    await recordAudit({
      actor: user,
      action: 'updated',
      entity: 'Navigation',
      entityId: parsed.navigationId,
      summary: `Updated the items in “${menu.name}”`,
    });

    revalidatePath('/admin/navigation');
    revalidatePath('/', 'layout');
    return success(undefined, 'Menu saved.');
  } catch (error) {
    return toActionError(error);
  }
}

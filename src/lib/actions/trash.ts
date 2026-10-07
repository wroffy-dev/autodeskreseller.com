'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { authorize, type SessionUser } from '@/lib/auth/guards';
import { recordAudit } from '@/lib/services/audit';
import { uniqueSlug, originalSlug } from '@/lib/utils/slug';
import { isAddressTaken, patternAddress, releaseRoutes, syncRoutes } from '@/lib/urls/content-sync';
import { joinMarket } from '@/lib/urls/path';
import { success, failure, toActionError, type ActionResult } from '@/lib/utils/result';
import { scopeForUser } from '@/lib/country/admin';
import { offerIn } from '@/lib/country/availability';
import { getCountryById, getDefaultCountry } from '@/lib/country/registry';
import { revalidateCountryPage } from '@/lib/country/revalidate';
import type { PermissionKey } from '@/lib/auth/permissions';
import type { TrashKind } from '@/lib/services/trash';

/**
 * Putting back, and throwing away for good.
 *
 * One module rather than a restore and a purge on each of four screens: what
 * the four kinds have in common — the permission to check, the slug to free,
 * the audit line to write — is nearly everything, and the differences are
 * small enough to name in one table. Products keep their own actions because
 * restoring one is a market decision, not a row one.
 *
 * Restoring never publishes. A page comes back as a draft, an article as a
 * draft, a category and a brand as offered in the market doing the restoring.
 * Somebody who deleted something by mistake gets it back to look at, not back
 * in front of visitors before they have checked it.
 */

type Kind = Exclude<TrashKind, never>;

const PERMISSION: Record<Kind, PermissionKey> = {
  page: 'pages.delete',
  post: 'blog.delete',
  productCategory: 'products.delete',
  brand: 'products.delete',
};

const LABEL: Record<Kind, string> = {
  page: 'Page',
  post: 'Article',
  productCategory: 'Category',
  brand: 'Brand',
};

const ENTITY: Record<Kind, string> = {
  page: 'Page',
  post: 'BlogPost',
  productCategory: 'ProductCategory',
  brand: 'Brand',
};

/** The row, whichever table it is in, reduced to what both actions need. */
async function load(kind: Kind, id: string) {
  switch (kind) {
    case 'page': {
      const row = await prisma.page.findUnique({
        where: { id },
        select: { id: true, title: true, slug: true, deletedAt: true, countryId: true },
      });
      return row && { ...row, name: row.title };
    }
    case 'post': {
      const row = await prisma.blogPost.findUnique({
        where: { id },
        select: { id: true, title: true, slug: true, deletedAt: true, countryId: true },
      });
      return row && { ...row, name: row.title };
    }
    case 'productCategory': {
      const row = await prisma.productCategory.findUnique({
        where: { id },
        select: { id: true, name: true, slug: true, deletedAt: true },
      });
      return row && { ...row, countryId: null };
    }
    case 'brand': {
      const row = await prisma.brand.findUnique({
        where: { id },
        select: { id: true, name: true, slug: true, deletedAt: true },
      });
      return row && { ...row, countryId: null };
    }
  }
}

/**
 * The slug it had, or the nearest free one.
 *
 * Everything here is parked under `name-deleted-<time>` when it is removed,
 * which is what frees the original for somebody else. Restoring asks for the
 * original back and settles for `name-2` if it has since been taken — never
 * for the parked spelling, which is not a URL anybody typed.
 */
async function freeSlug(kind: Kind, id: string, parked: string, countryId: string | null) {
  const wanted = originalSlug(parked);

  // The address must be free of every kind of content and redirect, not just
  // of other rows in the same table.
  const market = countryId ? await getCountryById(countryId) : null;
  const root = await getDefaultCountry();

  const taken = async (candidate: string): Promise<boolean> => {
    switch (kind) {
      case 'page':
        return (
          Boolean(
            await prisma.page.findFirst({
              where: { slug: candidate, countryId: countryId ?? undefined, id: { not: id } },
              select: { id: true },
            }),
          ) ||
          (await isAddressTaken(prisma, joinMarket(market?.slug ?? '', candidate), {
            entityId: id,
            countryId: countryId ?? '',
          }))
        );
      case 'post':
        return (
          Boolean(
            await prisma.blogPost.findFirst({
              where: { slug: candidate, countryId: countryId ?? undefined, id: { not: id } },
              select: { id: true },
            }),
          ) ||
          (countryId === root.id &&
            (await isAddressTaken(
              prisma,
              await patternAddress(prisma, {
                type: 'BLOG_POST',
                countryId: root.id,
                marketSlug: root.slug,
                slug: candidate,
              }),
              { entityId: id, countryId: root.id },
            )))
        );
      case 'productCategory':
        return Boolean(
          await prisma.productCategory.findFirst({
            where: { slug: candidate, id: { not: id } },
            select: { id: true },
          }),
        );
      case 'brand':
        return Boolean(
          await prisma.brand.findFirst({
            where: { slug: candidate, id: { not: id } },
            select: { id: true },
          }),
        );
    }
  };

  return uniqueSlug(wanted, taken);
}

async function putBack(
  kind: Kind,
  id: string,
  slug: string,
  user: SessionUser,
  countryId: string | null,
) {
  switch (kind) {
    case 'page':
      // Back as a draft, with its address registered again in the same step.
      await prisma.$transaction(async (tx) => {
        await tx.page.update({
          where: { id },
          // Not a landing page until the registry says so from its address:
          // the city may have a new one by now.
          data: { deletedAt: null, status: 'DRAFT', slug, isCityHomepage: false, updatedById: user.id },
        });
        await syncRoutes(tx, [{ type: 'PAGE', entityId: id, countryId: countryId ?? '' }], {
          actor: user,
          reason: 'RESTORE',
        });
      });
      return;
    case 'post':
      await prisma.$transaction(async (tx) => {
        await tx.blogPost.update({
          where: { id },
          data: { deletedAt: null, status: 'DRAFT', slug },
        });
        await syncRoutes(tx, [{ type: 'BLOG_POST', entityId: id, countryId: countryId ?? '' }], {
          actor: user,
          reason: 'RESTORE',
        });
      });
      return;
    case 'productCategory':
    case 'brand': {
      const scope = await scopeForUser(user);
      if (kind === 'productCategory') {
        await prisma.productCategory.update({ where: { id }, data: { deletedAt: null, slug } });
      } else {
        await prisma.brand.update({ where: { id }, data: { deletedAt: null, slug } });
      }
      /*
       * A retired category or brand is offered by no market — that is what
       * retired it. Restoring it into nothing would leave a row the screen
       * that restored it still cannot see, so the market doing the restoring
       * takes it back on.
       */
      await offerIn(
        kind === 'productCategory' ? 'PRODUCT_CATEGORY' : 'BRAND',
        [id],
        scope.country.id,
      );
    }
  }
}

/** Brings one deleted thing back, as a draft. */
export async function restoreFromTrash(kind: Kind, id: string): Promise<ActionResult> {
  try {
    const user = await authorize(PERMISSION[kind]);
    const row = await load(kind, id);
    if (!row) return failure(`That ${LABEL[kind].toLowerCase()} no longer exists.`);
    if (!row.deletedAt) return failure(`That ${LABEL[kind].toLowerCase()} is not deleted.`);

    const slug = await freeSlug(kind, id, row.slug, row.countryId);
    await putBack(kind, id, slug, user, row.countryId);

    await recordAudit({
      actor: user,
      action: 'restored',
      entity: ENTITY[kind],
      entityId: id,
      summary: `Restored ${LABEL[kind].toLowerCase()} “${row.name}”`,
      after: { slug },
    });

    revalidateFor(kind);
    if (kind === 'page' && row.countryId) {
      const country = await getCountryById(row.countryId);
      if (country) revalidateCountryPage(country, slug);
    }

    return success(
      undefined,
      slug === originalSlug(row.slug)
        ? `“${row.name}” is back, as a draft.`
        : `“${row.name}” is back at /${slug} — its old URL was taken.`,
    );
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * Destroys one deleted thing for good.
 *
 * Refused while anything is attributed to it. A lead names the page or the
 * article that produced it, and deleting that row would leave the lead unable
 * to say where it came from — which is worse than a row sitting in a bin.
 */
export async function purgeFromTrash(kind: Kind, id: string): Promise<ActionResult> {
  try {
    const user = await authorize(PERMISSION[kind]);
    const row = await load(kind, id);
    if (!row) return failure(`That ${LABEL[kind].toLowerCase()} no longer exists.`);
    if (!row.deletedAt) {
      return failure(`Delete “${row.name}” first — only something already deleted can be purged.`);
    }

    if (kind === 'page' || kind === 'post') {
      const leads =
        kind === 'page'
          ? await prisma.lead.count({ where: { landingPageId: id } })
          : await prisma.lead.count({ where: { blogPostId: id } });
      if (leads > 0) {
        return failure(
          `“${row.name}” is credited with ${leads} lead${leads === 1 ? '' : 's'}, so it is kept. It stays here instead.`,
        );
      }
    }

    switch (kind) {
      case 'page':
      case 'post':
        // Whatever address it still held goes with it; its URL history stays.
        await prisma.$transaction(async (tx) => {
          await releaseRoutes(
            tx,
            [
              {
                type: kind === 'page' ? ('PAGE' as const) : ('BLOG_POST' as const),
                entityId: id,
                countryId: row.countryId ?? '',
                label: row.name,
              },
            ],
            { actor: user },
          );
          if (kind === 'page') await tx.page.delete({ where: { id } });
          else await tx.blogPost.delete({ where: { id } });
        });
        break;
      case 'productCategory':
        // Products keep existing; the relation is SET NULL by the schema.
        await prisma.productCategory.delete({ where: { id } });
        break;
      case 'brand':
        await prisma.brand.delete({ where: { id } });
        break;
    }

    await recordAudit({
      actor: user,
      action: 'purged',
      entity: ENTITY[kind],
      entityId: id,
      summary: `Permanently deleted ${LABEL[kind].toLowerCase()} “${row.name}”`,
      before: { name: row.name, slug: originalSlug(row.slug) },
    });

    revalidateFor(kind);
    return success(undefined, 'Deleted for good.');
  } catch (error) {
    return toActionError(error);
  }
}

function revalidateFor(kind: Kind) {
  revalidatePath('/admin/trash');
  switch (kind) {
    case 'page':
      revalidatePath('/admin/pages');
      break;
    case 'post':
      revalidatePath('/admin/blog');
      break;
    case 'productCategory':
      revalidatePath('/admin/products/categories');
      break;
    case 'brand':
      revalidatePath('/admin/products/brands');
      break;
  }
  revalidatePath('/', 'layout');
}

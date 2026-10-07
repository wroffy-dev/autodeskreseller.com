'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { authorize, authorizeSelf } from '@/lib/auth/guards';
import { recordAudit } from '@/lib/services/audit';
import { sanitizeText } from '@/lib/utils/sanitize';
import { toDecimal } from '@/lib/utils/money';
import { uniqueSlug } from '@/lib/utils/slug';
import { releaseRoutes, syncRoutes } from '@/lib/urls/content-sync';
import { addressesOf, revalidateAddresses } from '@/lib/urls/revalidate';
import { claimEveryMarketRules, lockRegistry, prefixConflict, rePrefixMarket } from '@/lib/urls/registry';
import { success, failure, toActionError, type ActionResult } from '@/lib/utils/result';
import {
  countrySchema,
  countrySettingsSchema,
  productCountrySchema,
} from '@/lib/validation/country';
import {
  invalidateCountryCache,
  listCountries,
  getCountryById,
} from '@/lib/country/registry';
import { listAccessibleCountries, assertCountryAccess } from '@/lib/country/access';
import { ADMIN_COUNTRY_COOKIE } from '@/lib/country/admin';
import { revalidateCountryPage } from '@/lib/country/revalidate';
import { refreshSeoScores } from '@/lib/seo/intelligence/refresh';
import {
  describeContents,
  deletionWarning,
  hasContents,
  type CountryContents,
} from '@/lib/country/contents';

/**
 * Market administration.
 *
 * Three rules are enforced here rather than in the database, because they are
 * about intent rather than shape:
 *
 *  - exactly one market is the default, and the default owns the empty slug,
 *    so the site root always resolves to somewhere;
 *  - a market with content cannot be deleted, only deactivated, so nothing is
 *    ever orphaned by a click;
 *  - every write validates the market against the signed-in user's access, so
 *    a country id in a form body cannot reach a market they cannot edit.
 */

/** Revalidates everything a market change can affect. */
function revalidateMarkets() {
  invalidateCountryCache();
  revalidatePath('/admin/settings/countries');
  revalidatePath('/', 'layout');
  revalidatePath('/sitemap.xml');
  revalidatePath('/robots.txt');
}

// ---------------------------------------------------------------------------
// The admin's working market
// ---------------------------------------------------------------------------

const switchSchema = z.object({ code: z.string().trim().toUpperCase().max(2) });

/**
 * Remembers which market the admin is editing.
 *
 * Any signed-in staff member may switch between the markets they can reach; the
 * cookie is a preference, and every screen re-validates it against the user's
 * access before it is used, so it confers nothing on its own.
 */
export async function setAdminCountry(input: unknown): Promise<ActionResult> {
  try {
    const user = await authorizeSelf();
    const { code } = switchSchema.parse(input);

    const allowed = await listAccessibleCountries(user);
    const target = allowed.find((country) => country.code === code);
    if (!target) return failure('That country is not available to your account.');

    const store = await cookies();
    store.set(ADMIN_COUNTRY_COOKIE, target.code, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 60 * 60 * 24 * 365,
    });

    revalidatePath('/admin', 'layout');
    return success(undefined, `Now editing ${target.name}.`);
  } catch (error) {
    return toActionError(error);
  }
}

// ---------------------------------------------------------------------------
// Markets
// ---------------------------------------------------------------------------

export async function saveCountry(
  countryId: string | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await authorize('settings.manage');
    const input = countrySchema.parse({
      name: formData.get('name'),
      code: formData.get('code'),
      slug: formData.get('slug') ?? '',
      locale: formData.get('locale'),
      currency: formData.get('currency'),
      currencySymbol: formData.get('currencySymbol'),
      phoneCode: formData.get('phoneCode'),
      timezone: formData.get('timezone'),
      isDefault: formData.get('isDefault') === 'true',
      isActive: formData.get('isActive') !== 'false',
      isPublished: formData.get('isPublished') !== 'false',
      sortOrder: formData.get('sortOrder') ?? 0,
    });

    const before = countryId ? await prisma.country.findUnique({ where: { id: countryId } }) : null;
    if (countryId && !before) return failure('That country no longer exists.');

    const clash = await prisma.country.findFirst({
      where: {
        OR: [{ code: input.code }, { slug: input.slug }],
        ...(countryId ? { id: { not: countryId } } : {}),
      },
      select: { code: true, slug: true },
    });
    if (clash) {
      return failure(
        clash.code === input.code
          ? 'Another country already uses that code.'
          : 'Another country already uses that URL prefix.',
        clash.code === input.code ? { code: ['Already in use'] } : { slug: ['Already in use'] },
      );
    }

    // The root market owns the empty prefix. A non-default market must have one,
    // or two markets would both answer for `/`.
    if (input.isDefault && input.slug !== '') {
      return failure('The default country is served from the site root and must have no prefix.', {
        slug: ['Leave empty for the default country'],
      });
    }
    if (!input.isDefault && input.slug === '') {
      return failure('Only the default country may be served from the site root.', {
        slug: ['A URL prefix is required'],
      });
    }
    if (before?.isDefault && !input.isDefault) {
      return failure('Make another country the default first.');
    }
    // Deactivating the root market would leave `/` with nowhere to resolve to.
    if (input.isDefault && !input.isActive) {
      return failure('The default country cannot be deactivated.');
    }

    /*
     * A market prefix is the first segment of every address in that market, so
     * it cannot be a word the root market already uses as one: with a root
     * page at `/pricing`, a market called "pricing" would shadow it.
     */
    const prefixChanged = !input.isDefault && input.slug !== (before?.slug ?? null);
    if (prefixChanged) {
      const root = await prisma.country.findFirst({ where: { isDefault: true }, select: { id: true } });
      const shadowed = root ? await prefixConflict(prisma, input.slug, root.id) : null;
      if (shadowed) {
        return failure(`The root market already has an address at ${shadowed}, so “${input.slug}” cannot be a market prefix.`, {
          slug: [`Used by ${shadowed}`],
        });
      }
    }

    const country = await prisma.$transaction(
      async (tx) => {
        if (input.isDefault) {
          await tx.country.updateMany({
            where: { isDefault: true, ...(countryId ? { id: { not: countryId } } : {}) },
            data: { isDefault: false },
          });
        }
        const data = { ...input, name: sanitizeText(input.name) };
        const saved = countryId
          ? await tx.country.update({ where: { id: countryId }, data })
          : await tx.country.create({ data });

        /*
         * Every address in the market moves with its prefix, and each one that
         * had been public keeps working through a redirect from the old prefix
         * — in the same transaction as the rename.
         */
        if (before && prefixChanged && before.slug) {
          await lockRegistry(tx);
          const [pages, products] = await Promise.all([
            tx.page.findMany({
              where: { countryId: saved.id, deletedAt: null, publishedAt: { not: null } },
              select: { id: true },
            }),
            tx.productCountry.findMany({
              where: { countryId: saved.id, deletedAt: null, publishedAt: { not: null } },
              select: { productId: true },
            }),
          ]);
          await rePrefixMarket(tx, {
            countryId: saved.id,
            fromSlug: before.slug,
            toSlug: saved.slug,
            actor: user,
            publicIds: new Set([...pages.map((row) => row.id), ...products.map((row) => row.productId)]),
          });
        }
        // A new market answers the every-market redirect rules, as they always did.
        if (!before) {
          await lockRegistry(tx);
          await claimEveryMarketRules(tx, { id: saved.id, slug: saved.slug });
        }
        return saved;
      },
      { timeout: 60_000, maxWait: 10_000 },
    );

    await recordAudit({
      actor: user,
      action: countryId ? 'updated' : 'created',
      entity: 'Country',
      entityId: country.id,
      summary: `${countryId ? 'Updated' : 'Added'} country “${country.name}” (${country.code})`,
      before: before
        ? {
            slug: before.slug,
            isActive: before.isActive,
            isPublished: before.isPublished,
            isDefault: before.isDefault,
          }
        : undefined,
      after: {
        slug: country.slug,
        isActive: country.isActive,
        isPublished: country.isPublished,
        isDefault: country.isDefault,
      },
    });

    revalidateMarkets();
    return success({ id: country.id }, 'Country saved.');
  } catch (error) {
    return toActionError(error);
  }
}

export async function setCountryActive(
  countryId: string,
  isActive: boolean,
): Promise<ActionResult> {
  try {
    const user = await authorize('settings.manage');
    const country = await prisma.country.findUnique({ where: { id: countryId } });
    if (!country) return failure('That country no longer exists.');
    if (country.isDefault && !isActive) {
      return failure('The default country cannot be deactivated.');
    }

    await prisma.country.update({ where: { id: countryId }, data: { isActive } });

    await recordAudit({
      actor: user,
      action: isActive ? 'activated' : 'deactivated',
      entity: 'Country',
      entityId: countryId,
      summary: `${isActive ? 'Activated' : 'Deactivated'} ${country.name}`,
    });

    revalidateMarkets();
    return success(
      undefined,
      isActive
        ? `${country.name} is live.`
        : `${country.name} is no longer served. Its content is untouched.`,
    );
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * What removing a market would destroy, counted once.
 *
 * The four relations the database restricts — pages, articles, menus and
 * leads — plus the market's own pricing rows, which cascade. The same figures
 * are used for the confirmation and for the audit record, so what somebody is
 * shown is what is actually deleted.
 */
async function countryContents(countryId: string): Promise<CountryContents> {
  const [pages, posts, menus, leads, pricing, popups, forms, cities] = await Promise.all([
    prisma.page.count({ where: { countryId } }),
    prisma.blogPost.count({ where: { countryId } }),
    prisma.navigation.count({ where: { countryId } }),
    prisma.lead.count({ where: { countryId } }),
    prisma.productCountry.count({ where: { countryId } }),
    prisma.popup.count({ where: { countryId } }),
    prisma.form.count({ where: { countryId } }),
    prisma.city.count({ where: { countryId } }),
  ]);
  return { pages, posts, menus, leads, pricing, popups, forms, cities };
}

/**
 * Removes a market, and everything that belongs only to it.
 *
 * A market is not a container that has to be emptied by hand first. Deleting
 * one deletes the pages, articles, menus, leads and market pricing that exist
 * only inside it — nothing else refers to them, so leaving them behind would
 * only be orphaned rows nobody can reach.
 *
 * It is never a single click, though. The first attempt on a market that holds
 * something refuses and reports exactly what would go, and only a caller that
 * comes back having confirmed goes ahead. Deactivating remains the way to take
 * a storefront offline without losing anything, and is still what most people
 * want — but it is now an option rather than the only way out.
 *
 * Products themselves survive: a product is shared across markets and only its
 * pricing row for this one is removed. The database keeps its `Restrict` rules
 * so no other code path can delete a market's content by accident; this action
 * clears it deliberately, in one transaction, and records the counts.
 */
export async function deleteCountry(
  countryId: string,
  options: { confirmed?: boolean } = {},
): Promise<ActionResult> {
  try {
    const user = await authorize('settings.manage');
    const country = await prisma.country.findUnique({ where: { id: countryId } });
    if (!country) return failure('That country no longer exists.');
    if (country.isDefault) return failure('The default country cannot be deleted.');

    const contents = await countryContents(countryId);

    if (hasContents(contents) && !options.confirmed) {
      return failure(deletionWarning(country.name, contents), { _confirm: ['content'] });
    }

    /*
     * Order matters: leads point at pages and articles, so they go first, and
     * the market itself goes last. Everything else that belongs to a market —
     * its settings, navigation items, sections, pricing, cities — already
     * cascades. A city's pages are market pages and go with the rest here,
     * before the cities they belong to.
     */
    await prisma.$transaction(async (tx) => {
      await tx.lead.deleteMany({ where: { countryId } });
      await tx.navigation.deleteMany({ where: { countryId } });
      await tx.blogPost.deleteMany({ where: { countryId } });
      await tx.page.deleteMany({ where: { countryId } });

      /*
       * A popup belonged to the storefront that showed it and nothing else
       * points at one, so it goes with the market. A form is the opposite: a
       * product in another market can name it as its enquiry form, and
       * deleting one would take its submissions with it. Forms are kept and
       * switched off instead of quietly becoming site-wide, and the market's
       * code goes on the slug where a site-wide form already holds it —
       * `(countryId, slug)` is unique, and the clash would otherwise fail the
       * whole delete.
       */
      await tx.popup.deleteMany({ where: { countryId } });

      const forms = await tx.form.findMany({
        where: { countryId },
        select: { id: true, slug: true },
      });
      for (const form of forms) {
        const slug = await uniqueSlug(form.slug, async (candidate) =>
          Boolean(
            await tx.form.findFirst({
              where: { countryId: null, slug: candidate },
              select: { id: true },
            }),
          ),
        );
        await tx.form.update({
          where: { id: form.id },
          data: { countryId: null, isActive: false, slug },
        });
      }

      await tx.country.delete({ where: { id: countryId } });
    });

    await recordAudit({
      actor: user,
      action: 'deleted',
      entity: 'Country',
      entityId: countryId,
      summary:
        hasContents(contents)
          ? `Deleted country “${country.name}” and its ${describeContents(contents)}`
          : `Deleted country “${country.name}”`,
      before: { code: country.code, slug: country.slug, ...contents },
    });

    revalidateMarkets();
    return success(
      undefined,
      hasContents(contents)
        ? `${country.name} and its content were deleted.`
        : `${country.name} was deleted.`,
    );
  } catch (error) {
    return toActionError(error);
  }
}

// ---------------------------------------------------------------------------
// Country settings
// ---------------------------------------------------------------------------

export async function saveCountrySettings(
  countryId: string,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const user = await authorize('settings.manage');
    await assertCountryAccess(user, countryId);

    const country = await getCountryById(countryId);
    if (!country) return failure('That country no longer exists.');

    const input = countrySettingsSchema.parse(Object.fromEntries(formData.entries()));

    await prisma.countrySettings.upsert({
      where: { countryId },
      update: input,
      create: { countryId, ...input },
    });

    await recordAudit({
      actor: user,
      action: 'updated',
      entity: 'CountrySettings',
      entityId: countryId,
      summary: `Updated ${country.name} settings`,
      after: { country: country.code },
    });

    revalidatePath('/admin/settings/countries');
    revalidateCountryPage(country, '', 'layout');
    return success(undefined, `${country.name} settings saved.`);
  } catch (error) {
    return toActionError(error);
  }
}

// ---------------------------------------------------------------------------
// Product pricing per market
// ---------------------------------------------------------------------------

export async function saveProductCountry(formData: FormData): Promise<ActionResult> {
  try {
    const user = await authorize('products.edit');
    const input = productCountrySchema.parse(Object.fromEntries(formData.entries()));
    await assertCountryAccess(user, input.countryId);

    const [country, product] = await Promise.all([
      getCountryById(input.countryId),
      prisma.product.findFirst({
        where: { id: input.productId, deletedAt: null },
        select: { id: true, name: true, slug: true },
      }),
    ]);
    if (!country || !country.isActive) return failure('That country is not available.');
    if (!product) return failure('That product no longer exists.');

    const { productId, countryId, ...rest } = input;
    const data = {
      ...rest,
      monthlyPrice: toDecimal(rest.monthlyPrice),
      annualPrice: toDecimal(rest.annualPrice),
      compareAtPrice: toDecimal(rest.compareAtPrice),
      publishedAt:
        rest.status === 'PUBLISHED' ? (rest.publishedAt ?? new Date()) : rest.publishedAt,
    };

    // Offered here, so it has an address here — registered in the same
    // transaction, or the whole save is refused with the owner of the address.
    await prisma.$transaction(async (tx) => {
      await tx.productCountry.upsert({
        where: { productId_countryId: { productId, countryId } },
        // Entering pricing for a market that had withdrawn the product is an
        // explicit decision to offer it again, so the withdrawal is lifted here
        // rather than leaving a configured row the storefront still ignores.
        update: { ...data, deletedAt: null },
        create: { productId, countryId, ...data },
      });
      await syncRoutes(tx, [{ type: 'PRODUCT', entityId: productId, countryId }], {
        actor: user,
        reason: 'EDIT',
      });
    });

    await recordAudit({
      actor: user,
      action: 'pricing.updated',
      entity: 'Product',
      entityId: productId,
      summary: `Updated ${product.name} for ${country.name}`,
      after: {
        country: country.code,
        currency: rest.currency,
        monthlyPrice: rest.monthlyPrice,
        status: rest.status,
      },
    });

    revalidatePath(`/admin/products/${productId}`);
    revalidateCountryPage(country, `products/${product.slug}`);
    revalidateAddresses(await addressesOf(productId));
    refreshSeoScores([{ type: 'PRODUCT_MARKET', id: productId, countryId }]);
    return success(undefined, `${country.name} pricing saved.`);
  } catch (error) {
    return toActionError(error);
  }
}

const removeSchema = z.object({ productId: z.string().min(1), countryId: z.string().min(1) });

/** Withdraws a product from a market entirely. */
export async function removeProductCountry(input: unknown): Promise<ActionResult> {
  try {
    const user = await authorize('products.edit');
    const { productId, countryId } = removeSchema.parse(input);
    await assertCountryAccess(user, countryId);

    const [country, product] = await Promise.all([
      getCountryById(countryId),
      prisma.product.findUnique({ where: { id: productId }, select: { name: true, slug: true } }),
    ]);
    if (!country || !product) return failure('That product or country no longer exists.');

    /*
     * Archived, not erased. The market's prices, ordering and SEO survive a
     * withdrawal, so re-offering the product later does not mean re-entering
     * everything — and the sync's tombstone still sees a row it can recognise.
     */
    await prisma.$transaction(async (tx) => {
      await tx.productCountry.updateMany({
        where: { productId, countryId, deletedAt: null },
        data: { deletedAt: new Date(), status: 'ARCHIVED', isFeatured: false },
      });
      // Its address here is released, never redirected by default.
      await releaseRoutes(tx, [{ type: 'PRODUCT', entityId: productId, countryId, label: product.name }], {
        actor: user,
      });
    });

    await recordAudit({
      actor: user,
      action: 'pricing.removed',
      entity: 'Product',
      entityId: productId,
      summary: `Withdrew ${product.name} from ${country.name}`,
    });

    revalidatePath(`/admin/products/${productId}`);
    revalidateCountryPage(country, `products/${product.slug}`);
    return success(undefined, `${product.name} is no longer sold in ${country.name}.`);
  } catch (error) {
    return toActionError(error);
  }
}

// ---------------------------------------------------------------------------
// Staff market access
// ---------------------------------------------------------------------------

const accessSchema = z.object({
  userId: z.string().min(1),
  countryIds: z.array(z.string().min(1)).max(50),
});

/**
 * Restricts a staff account to certain markets.
 *
 * An empty list means "every market", which is what every account has by
 * default — this only ever narrows access, never widens it, and it never
 * replaces a role check.
 */
export async function setUserCountries(input: unknown): Promise<ActionResult> {
  try {
    const user = await authorize('staff.manage');
    const { userId, countryIds } = accessSchema.parse(input);

    const target = await prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true, name: true, roles: { select: { slug: true } } },
    });
    if (!target) return failure('That user no longer exists.');

    // Restricting a super admin would lock the only account that can undo it.
    if (target.roles.slug === 'super-admin' && countryIds.length > 0) {
      return failure('A super admin always has access to every country.');
    }

    const known = await listCountries();
    const valid = countryIds.filter((id) => known.some((country) => country.id === id));

    await prisma.$transaction([
      prisma.userCountry.deleteMany({ where: { userId } }),
      prisma.userCountry.createMany({
        data: valid.map((countryId) => ({ userId, countryId })),
        skipDuplicates: true,
      }),
    ]);

    await recordAudit({
      actor: user,
      action: 'countries.updated',
      entity: 'User',
      entityId: userId,
      summary:
        valid.length === 0
          ? `${target.name} can work in every country`
          : `${target.name} restricted to ${valid.length} country/countries`,
      after: { countries: valid },
    });

    revalidatePath(`/admin/staff/${userId}`);
    return success(undefined, 'Country access saved.');
  } catch (error) {
    return toActionError(error);
  }
}

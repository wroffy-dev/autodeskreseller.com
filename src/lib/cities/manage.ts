import 'server-only';
import type { Prisma } from '@prisma/client';
import { captureBefore, syncRoutes, type SyncOutcome } from '@/lib/urls/content-sync';
import { UrlRegistryError } from '@/lib/urls/errors';
import type { Actor } from '@/lib/urls/registry';
import { originalSlug } from '@/lib/utils/slug';
import { sanitizeText } from '@/lib/utils/sanitize';
import { moveToCity } from './paths';
import { fillPlaceholders, placeholderValues } from './template';

type Tx = Prisma.TransactionClient;

/**
 * Changes that touch a city's pages. Each runs inside the caller's
 * transaction, which holds the URL registry lock, so a city and its pages
 * never disagree about where the city is.
 */

/** The title a landing page gets when nobody typed one: the city's name. */
export const DEFAULT_LANDING_TITLE = '{{city.name}}';

/**
 * Moves every page of a renamed city to the new first segment:
 * `delhi/revit` becomes `new-delhi/revit`.
 *
 * Each move goes through the URL registry like any slug change, so a page
 * that had been public keeps its old address working through an automatic
 * redirect, and the history records the move. The city row must already
 * carry the new slug, so the registry files each moved page under it.
 *
 * Pages in the recycle bin keep their parked slug, re-parked under the new
 * segment, so restoring one puts it back inside the city.
 */
export async function moveCityPages(
  tx: Tx,
  input: { cityId: string; countryId: string; fromSlug: string; toSlug: string; actor: Actor },
): Promise<SyncOutcome[]> {
  const pages = await tx.page.findMany({
    where: { cityId: input.cityId },
    select: { id: true, slug: true, deletedAt: true },
  });

  const live = pages.filter((page) => !page.deletedAt);
  const refs = live.map((page) => ({ type: 'PAGE' as const, entityId: page.id, countryId: input.countryId }));
  const before = refs.length > 0 ? await captureBefore(tx, refs) : new Map();

  for (const page of live) {
    const slug = moveToCity(page.slug, input.fromSlug, input.toSlug);
    if (slug !== page.slug) await tx.page.update({ where: { id: page.id }, data: { slug } });
  }

  for (const page of pages.filter((row) => row.deletedAt)) {
    const wanted = originalSlug(page.slug);
    const suffix = page.slug.slice(wanted.length);
    const moved = moveToCity(wanted, input.fromSlug, input.toSlug);
    if (moved !== wanted) await tx.page.update({ where: { id: page.id }, data: { slug: `${moved}${suffix}` } });
  }

  if (refs.length === 0) return [];
  return syncRoutes(tx, refs, { actor: input.actor, reason: 'SLUG', before });
}

/**
 * Creates a city's landing page: an ordinary, empty draft page at the city's
 * own address, to be built in the Page Builder. Refused when the city already
 * has one, and — through the registry — when its address is taken.
 */
export async function createLandingPage(
  tx: Tx,
  input: {
    city: { id: string; name: string; slug: string; region: string | null; countryId: string };
    country: { name: string; code: string };
    title: string | null;
    actor: Actor & { id: string };
  },
): Promise<{ id: string; title: string; slug: string }> {
  const existing = await tx.page.findFirst({
    where: { cityId: input.city.id, isCityHomepage: true, deletedAt: null },
    select: { title: true },
  });
  if (existing) {
    throw new UrlRegistryError(`${input.city.name} already has a landing page (“${existing.title}”).`, 'conflict', 'landingTitle');
  }

  const values = placeholderValues({
    city: input.city,
    country: input.country,
    page: { title: input.city.name, slug: input.city.slug },
  });
  const title = sanitizeText(fillPlaceholders(input.title?.trim() || DEFAULT_LANDING_TITLE, values)).slice(0, 200) || input.city.name;

  const page = await tx.page.create({
    data: {
      countryId: input.city.countryId,
      title,
      slug: input.city.slug,
      status: 'DRAFT',
      cityId: input.city.id,
      isCityHomepage: true,
      createdById: input.actor.id,
      updatedById: input.actor.id,
    },
  });
  await tx.page.update({ where: { id: page.id }, data: { groupKey: page.id } });
  await syncRoutes(tx, [{ type: 'PAGE', entityId: page.id, countryId: input.city.countryId }], {
    actor: input.actor,
    reason: 'CREATE',
  });
  return { id: page.id, title, slug: input.city.slug };
}

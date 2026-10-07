import 'server-only';
import { listCountries } from '@/lib/country/registry';
import { entityKey } from './snapshot';
import { isReservedFirstSegment, joinMarket, pathKey, segmentsOf } from './path';
import {
  describeOwner,
  loadContentInfo,
  patternRelativePath,
  type ContentInfo,
  type Db,
} from './content';
import { UrlRegistryError } from './errors';
import {
  isPageType,
  placeContent,
  releaseContent,
  routeOf,
  withRegistry,
  type Actor,
  type Tx,
} from './registry';
import { BLOG_ARCHIVE_ID, ROOT_ONLY_TYPES, type UrlContentType } from './types';
import type { UrlChangeReason } from '@prisma/client';

/**
 * Keeping the registry in step with content.
 *
 * Content actions call this inside the transaction that saves the content, so
 * a slug change, the address it moves to, the redirect from the address it
 * left and the history row are committed together — or, when the new address
 * is taken, none of it is and the form says which content owns it.
 *
 * The rules, per piece of content in one market:
 *
 *  - no route yet: it is registered at its pattern address;
 *  - a route following the pattern: it follows the pattern (a product whose
 *    slug changed moves; its old address redirects if it had been public);
 *  - a custom route: it is left exactly where it is — an explicit override is
 *    never undone by a slug edit or a pattern change;
 *  - a page: its slug *is* its address, so the address follows the slug the
 *    editor saved;
 *  - content that no longer exists or is withdrawn: its address is released.
 *
 * A title change never moves anything: addresses follow slugs and patterns,
 * and no save action derives a slug from a title for existing content.
 */

export type RouteRef = { type: UrlContentType; entityId: string; countryId: string };

export type SyncOptions = {
  actor: Actor;
  reason: UrlChangeReason;
  /** What each ref looked like before the save, so an address that was public earns its redirect. */
  before?: Map<string, ContentInfo>;
  /**
   * `pattern`: the change came from a pattern or a taxonomy slug, so a page
   * following its pattern moves with it. `content` (default): the change came
   * from the content itself, so a page's own slug is the truth.
   */
  source?: 'content' | 'pattern';
  batchId?: string | null;
};

type Patterns = Map<string, string>;

async function loadPatterns(db: Db): Promise<Patterns> {
  const rows = await db.urlPattern.findMany({ select: { scopeKey: true, pattern: true } });
  return new Map(rows.map((row) => [row.scopeKey, row.pattern]));
}

async function rootCountryId(): Promise<string> {
  const countries = await listCountries();
  return (countries.find((country) => country.isDefault) ?? countries[0])!.id;
}

/** Refs for root-only content take the root market; everything else keeps its own. */
export async function normaliseRefs(refs: readonly RouteRef[]): Promise<RouteRef[]> {
  const root = await rootCountryId();
  return refs.map((ref) => (ROOT_ONLY_TYPES.has(ref.type) ? { ...ref, countryId: root } : ref));
}

/** Snapshot of the content before a save, for `SyncOptions.before`. */
export async function captureBefore(
  db: Db,
  refs: readonly RouteRef[],
): Promise<Map<string, ContentInfo>> {
  const normalised = await normaliseRefs(refs);
  return loadContentInfo(normalised, await rootCountryId(), db);
}

export type SyncOutcome = {
  ref: RouteRef;
  status: 'unchanged' | 'placed' | 'moved' | 'released' | 'kept-custom' | 'skipped';
  oldPath: string | null;
  newPath: string | null;
  redirectId: string | null;
};

/**
 * Brings the given content's routes in line with the content, inside `tx`.
 * Throws `UrlRegistryError` when an address cannot be taken, which rolls the
 * caller's whole transaction back.
 */
export async function syncRoutes(
  tx: Tx,
  refs: readonly RouteRef[],
  options: SyncOptions,
): Promise<SyncOutcome[]> {
  if (refs.length === 0) return [];
  return withRegistry(
    async (inner) => {
      const [countries, root] = await Promise.all([listCountries(), rootCountryId()]);
      const normalised = await normaliseRefs(refs);
      const [after, patterns] = await Promise.all([
        loadContentInfo(normalised, root, inner),
        loadPatterns(inner),
      ]);
      const prefixes = countries.map((country) => country.slug).filter(Boolean);
      const outcomes: SyncOutcome[] = [];

      for (const ref of normalised) {
        const key = entityKey(ref.entityId, ref.countryId);
        const info = after.get(key);
        const route = await routeOf(inner, ref.entityId, ref.countryId);

        if (!info) {
          if (route) {
            const released = await releaseContent(inner, {
              entityId: ref.entityId,
              countryId: ref.countryId,
              label: options.before?.get(key)?.label ?? route.path,
              reason: 'DELETE',
              actor: options.actor,
              batchId: options.batchId,
            });
            outcomes.push({ ref, status: 'released', oldPath: released.path, newPath: null, redirectId: null });
          } else {
            outcomes.push({ ref, status: 'skipped', oldPath: null, newPath: null, redirectId: null });
          }
          continue;
        }

        const market = countries.find((country) => country.id === info.countryId);
        if (!market) {
          outcomes.push({ ref, status: 'skipped', oldPath: null, newPath: null, redirectId: null });
          continue;
        }

        const patternRel = patternRelativePath(info, { patterns });
        let desired: string;
        if (isPageType(info.type)) {
          const own = `/${info.pageSlug ?? ''}`;
          const followPattern =
            options.source === 'pattern' && info.type !== 'PAGE' && (!route || route.mode === 'PATTERN');
          desired = followPattern ? patternRel : own;
        } else if (!route || route.mode === 'PATTERN' || route.type !== info.type) {
          desired = patternRel;
        } else {
          outcomes.push({ ref, status: 'kept-custom', oldPath: route.path, newPath: route.path, redirectId: null });
          continue;
        }

        const first = segmentsOf(desired)[0];
        if (first && isReservedFirstSegment(first, { marketPrefixes: prefixes })) {
          throw new UrlRegistryError(
            `“/${first}” is reserved for the system or a market, so ${info.label} cannot live at ${desired}.`,
            'reserved',
          );
        }

        const mode = isPageType(info.type) && desired !== patternRel ? 'CUSTOM' : 'PATTERN';
        const result = await placeContent(inner, {
          type: info.type,
          entityId: info.entityId,
          countryId: info.countryId,
          marketSlug: market.slug,
          relativePath: desired,
          mode: route?.mode === 'CUSTOM' && !isPageType(info.type) ? 'CUSTOM' : mode,
          label: info.label,
          wasPublished: Boolean(options.before?.get(key)?.wasPublished || info.wasPublished),
          reason: route ? options.reason : 'CREATE',
          actor: options.actor,
          batchId: options.batchId,
        });

        if (!result.ok) {
          throw new UrlRegistryError(
            result.code === 'conflict'
              ? `That URL is taken: ${result.message} Choose another slug.`
              : result.message,
            result.code,
          );
        }
        outcomes.push({
          ref,
          status: !result.changed ? 'unchanged' : result.created ? 'placed' : 'moved',
          oldPath: result.oldPath,
          newPath: result.newPath,
          redirectId: result.redirectId,
        });
      }
      return outcomes;
    },
    { tx },
  );
}

/** Releases the addresses of content that was deleted or withdrawn, inside `tx`. */
export async function releaseRoutes(
  tx: Tx,
  refs: ReadonlyArray<RouteRef & { label: string }>,
  options: { actor: Actor; batchId?: string | null },
): Promise<void> {
  if (refs.length === 0) return;
  await withRegistry(
    async (inner) => {
      const normalised = await normaliseRefs(refs);
      for (const [index, ref] of normalised.entries()) {
        await releaseContent(inner, {
          entityId: ref.entityId,
          countryId: ref.countryId,
          label: refs[index]!.label,
          reason: 'DELETE',
          actor: options.actor,
          batchId: options.batchId,
        });
      }
    },
    { tx },
  );
}

/** Every market a product has a configuration or a route in — for syncing a product everywhere. */
export async function productRefs(db: Db, productId: string): Promise<RouteRef[]> {
  const [configs, routes] = await Promise.all([
    db.productCountry.findMany({ where: { productId }, select: { countryId: true } }),
    db.urlRoute.findMany({ where: { entityId: productId, kind: 'CONTENT' }, select: { countryId: true } }),
  ]);
  const markets = new Set([...configs, ...routes].map((row) => row.countryId));
  return [...markets].map((countryId) => ({ type: 'PRODUCT' as const, entityId: productId, countryId }));
}

/** The landing pages of a category or brand, in every market. */
export async function landingPageRefs(
  db: Db,
  kind: 'category' | 'brand',
  id: string,
): Promise<RouteRef[]> {
  const pages = await db.page.findMany({
    where: kind === 'category' ? { landingCategoryId: id } : { landingBrandId: id },
    select: { id: true, countryId: true },
  });
  return pages.map((page) => ({ type: 'PAGE' as const, entityId: page.id, countryId: page.countryId }));
}

/** The archive ref, for callers that sync the blog's own address. */
export const BLOG_ARCHIVE_REF: Omit<RouteRef, 'countryId'> = { type: 'BLOG_ARCHIVE', entityId: BLOG_ARCHIVE_ID };

/**
 * Whether an address is already claimed — by any content or redirect other
 * than `except`. For the create flows that pick a free slug for new content.
 */
export async function isAddressTaken(
  db: Db,
  fullPath: string,
  except?: { entityId: string; countryId: string },
): Promise<boolean> {
  const key = pathKey(fullPath);
  if (!key) return true;
  const claim = await db.urlRoute.findUnique({ where: { pathKey: key } });
  if (!claim) return false;
  return !(except && claim.entityId === except.entityId && claim.countryId === except.countryId);
}

/** Why an address is taken, in words, for a form's field error. */
export async function describeTakenAddress(db: Db, fullPath: string): Promise<string | null> {
  const key = pathKey(fullPath);
  if (!key) return 'That is not a valid address.';
  const claim = await db.urlRoute.findUnique({ where: { pathKey: key }, include: { redirect: true } });
  if (!claim) return null;
  if (claim.kind === 'REDIRECT') {
    return `${claim.path} is used by a redirect${claim.redirect ? ` to ${claim.redirect.destination}` : ''}.`;
  }
  const root = await rootCountryId();
  const info = claim.type && claim.entityId
    ? (await loadContentInfo([{ type: claim.type as UrlContentType, entityId: claim.entityId, countryId: claim.countryId }], root, db)).get(
        entityKey(claim.entityId, claim.countryId),
      )
    : undefined;
  return info
    ? `${claim.path} is already used by ${describeOwner(info)}.`
    : `${claim.path} is already in use.`;
}

/**
 * The address content of a type would get in a market from its pattern, for
 * a candidate slug — what a create flow checks before choosing a slug.
 */
export async function patternAddress(
  db: Db,
  input: { type: UrlContentType; countryId: string; marketSlug: string; slug: string },
): Promise<string> {
  const patterns = await loadPatterns(db);
  return joinMarket(input.marketSlug, patternRelativePath(input, { patterns }));
}

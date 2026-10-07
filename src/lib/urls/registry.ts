import 'server-only';
import { Prisma, type UrlChangeReason } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { joinMarket, pathKey, segmentsOf, stripMarket } from './path';
import { isPageType, URL_TYPE_LABELS, type UrlContentType, type UrlRouteModeValue } from './types';

/**
 * Writing to the URL registry.
 *
 * Every change to a public address — a slug edit in a content form, a custom
 * URL in the Slug Manager, a pattern change, a bulk import, a redirect — goes
 * through this module, and always inside a transaction that holds the
 * registry lock. Three guarantees follow from that:
 *
 *  1. **One owner per address.** `UrlRoute.pathKey` is unique across content
 *     and redirect sources alike, so the database itself refuses a second
 *     claim; the checks here exist to explain the refusal, not to enforce it.
 *  2. **No lost updates.** The lock serialises concurrent writers, and a
 *     caller that read a route can insist it has not changed since
 *     (`expectedVersion`), so a stale screen cannot overwrite a newer edit.
 *  3. **All or nothing.** The route, the automatic redirect from the old
 *     address, the history row and the content's own slug are written in the
 *     same transaction as the content save that caused them.
 *
 * Redirects written here point at content by stable id, not at a path. When
 * the content moves again, every redirect to it follows automatically, so a
 * visitor on any historical address is sent straight to the current one — no
 * chains, whatever happens later.
 */

export type Tx = Prisma.TransactionClient;
export type Actor = { id: string; email?: string | null } | null;

/** Arbitrary constant: the advisory lock every registry writer takes. */
const REGISTRY_LOCK = 7_263_541;

export { isPageType };

/** Takes the registry lock for the rest of the transaction. */
export async function lockRegistry(tx: Tx): Promise<void> {
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(${REGISTRY_LOCK}::bigint)`;
}

/**
 * Runs `fn` in a transaction holding the registry lock, or joins the caller's
 * transaction and takes the lock there.
 */
export async function withRegistry<T>(
  fn: (tx: Tx) => Promise<T>,
  options: { tx?: Tx; timeoutMs?: number } = {},
): Promise<T> {
  if (options.tx) {
    await lockRegistry(options.tx);
    return fn(options.tx);
  }
  return prisma.$transaction(
    async (tx) => {
      await lockRegistry(tx);
      return fn(tx);
    },
    { timeout: options.timeoutMs ?? 20_000, maxWait: 10_000 },
  );
}

/** Tells every server instance to reload its registry snapshot. */
export async function bumpRegistryVersion(tx: Tx): Promise<void> {
  await tx.urlSettings.upsert({
    where: { id: 'singleton' },
    update: { version: { increment: 1 } },
    create: { id: 'singleton', version: 2 },
  });
}

// ---------------------------------------------------------------------------
// Ownership
// ---------------------------------------------------------------------------

export type OwnerSummary = {
  kind: 'content' | 'redirect' | 'city';
  path: string;
  type?: UrlContentType;
  entityId?: string;
  countryId: string;
  redirectId?: string;
  /** For a city: the city whose address space the path is in. */
  cityId?: string;
  /** Human description, filled in by callers that load labels. */
  description: string;
};

type ClaimRow = Prisma.UrlRouteGetPayload<{ include: { redirect: true } }>;

export async function findClaim(tx: Tx | typeof prisma, key: string): Promise<ClaimRow | null> {
  return tx.urlRoute.findUnique({ where: { pathKey: key }, include: { redirect: true } });
}

function ownerOf(claim: ClaimRow): OwnerSummary {
  if (claim.kind === 'CONTENT' && claim.type) {
    return {
      kind: 'content',
      path: claim.path,
      type: claim.type as UrlContentType,
      entityId: claim.entityId ?? undefined,
      countryId: claim.countryId,
      description: `a ${URL_TYPE_LABELS[claim.type as UrlContentType].toLowerCase()}`,
    };
  }
  const redirect = claim.redirect;
  return {
    kind: 'redirect',
    path: claim.path,
    countryId: claim.countryId,
    redirectId: claim.redirectId ?? undefined,
    description: redirect
      ? `${redirect.origin === 'AUTOMATIC' ? 'an automatic' : 'a'} redirect${redirect.isActive ? '' : ' (disabled)'} to ${redirect.destination}`
      : 'a redirect',
  };
}

export type Availability =
  | { ok: true; release: ClaimRow | null }
  | { ok: false; owner: OwnerSummary };

// ---------------------------------------------------------------------------
// Cities
// ---------------------------------------------------------------------------

export type CityRef = { id: string; name: string; slug: string; countryId: string };

/**
 * The city whose address space a market-relative path is in: the one whose
 * slug is the path's first segment, in the same market. Cities in other
 * markets never matter — Delhi in India owns `/delhi`, not `/ae/delhi`.
 */
export async function cityOfPath(
  db: Tx | typeof prisma,
  countryId: string,
  relativePath: string,
): Promise<CityRef | null> {
  const first = segmentsOf(relativePath)[0]?.toLowerCase();
  if (!first) return null;
  return db.city.findUnique({
    where: { countryId_slug: { countryId, slug: first } },
    select: { id: true, name: true, slug: true, countryId: true },
  });
}

/** The city a full public path (market prefix included) falls in, with its market's prefix. */
async function cityOfKey(
  db: Tx | typeof prisma,
  key: string,
  countryId: string,
): Promise<{ city: CityRef; marketSlug: string } | null> {
  const market = await db.country.findUnique({ where: { id: countryId }, select: { slug: true } });
  if (!market) return null;
  const city = await cityOfPath(db, countryId, stripMarket(market.slug, key));
  return city ? { city, marketSlug: market.slug } : null;
}

function cityOwner(city: CityRef, marketSlug: string): OwnerSummary {
  const root = joinMarket(marketSlug, `/${city.slug}`);
  return {
    kind: 'city',
    path: root,
    countryId: city.countryId,
    cityId: city.id,
    description: `the city ${city.name} (only its own pages can live at ${root} and beneath it)`,
  };
}

/**
 * Whether the content behind a route still exists and can have an address.
 *
 * Content removed without going through its action — a direct database
 * delete, an old code path — leaves its route behind. Such a route owns an
 * address nothing is served at, so it is released rather than allowed to
 * block the address forever.
 */
async function claimIsStale(db: Tx | typeof prisma, claim: ClaimRow): Promise<boolean> {
  if (claim.kind !== 'CONTENT' || !claim.entityId || !claim.type) return false;
  const id = claim.entityId;
  switch (claim.type as UrlContentType) {
    case 'PAGE':
    case 'CATEGORY_PAGE':
    case 'BRAND_PAGE':
      return !(await db.page.findFirst({
        where: { id, countryId: claim.countryId, deletedAt: null },
        select: { id: true },
      }));
    case 'PRODUCT':
      return !(await db.productCountry.findFirst({
        where: { productId: id, countryId: claim.countryId, deletedAt: null, product: { deletedAt: null } },
        select: { id: true },
      }));
    case 'BLOG_POST':
      return !(await db.blogPost.findFirst({
        where: { id, countryId: claim.countryId, deletedAt: null },
        select: { id: true },
      }));
    case 'BLOG_CATEGORY':
      return !(await db.blogCategory.findUnique({ where: { id }, select: { id: true } }));
    case 'BLOG_TAG':
      return !(await db.blogTag.findUnique({ where: { id }, select: { id: true } }));
    case 'BLOG_ARCHIVE':
      return false;
  }
}

/**
 * Whether content may take an address.
 *
 * Free addresses and the content's own address are available. Two kinds of
 * redirect claim give way to content, because giving way is what they have
 * always meant:
 *
 *  - an automatic redirect **to this same content** — its historical address,
 *    which it is now taking back;
 *  - a legacy every-market rule — before the registry, such a rule only ever
 *    applied where there was no content, so content still wins.
 *
 * Anything else is a conflict and is reported with its owner. Nothing is ever
 * overwritten and nothing is ever renamed to make room.
 */
export async function checkAvailability(
  tx: Tx | typeof prisma,
  key: string,
  claimant: { entityId: string; countryId: string; type?: UrlContentType },
): Promise<Availability> {
  const claim = await findClaim(tx, key);
  if (claim?.kind === 'CONTENT' && claim.entityId === claimant.entityId && claim.countryId === claimant.countryId) {
    return { ok: true, release: null };
  }

  let release: ClaimRow | null = null;
  if (claim?.kind === 'CONTENT') {
    if (!(await claimIsStale(tx, claim))) return { ok: false, owner: ownerOf(claim) };
    release = claim;
  } else if (claim) {
    const redirect = claim.redirect;
    const givesWay =
      (redirect &&
        redirect.origin === 'AUTOMATIC' &&
        redirect.targetEntityId === claimant.entityId &&
        redirect.targetCountryId === claimant.countryId) ||
      redirect?.allMarkets;
    if (!givesWay) return { ok: false, owner: ownerOf(claim) };
    release = claim;
  }

  /*
   * A city's address space is its own pages' alone. A page placed there joins
   * the city (see `placeContent`); anything else — a product, an article, a
   * category or brand landing page — is refused, even at a free address.
   * Only checked when the caller says what the claimant is.
   */
  if (claimant.type && claimant.type !== 'PAGE') {
    const inCity = await cityOfKey(tx, key, claimant.countryId);
    if (inCity) return { ok: false, owner: cityOwner(inCity.city, inCity.marketSlug) };
  }

  return { ok: true, release };
}

/**
 * Removes a claim content is taking over: a redirect claim (the rule goes when
 * it has no claim left) or a stale content route (its history records it).
 */
async function releaseClaim(tx: Tx, claim: ClaimRow): Promise<void> {
  await tx.urlRoute.delete({ where: { id: claim.id } });
  if (claim.kind === 'CONTENT' && claim.type && claim.entityId) {
    await tx.urlHistory.create({
      data: {
        type: claim.type,
        entityId: claim.entityId,
        countryId: claim.countryId,
        label: claim.path,
        oldPath: claim.path,
        newPath: null,
        reason: 'DELETE',
      },
    });
    return;
  }
  const redirect = claim.redirect;
  if (!redirect) return;
  if (redirect.origin === 'AUTOMATIC') {
    const remaining = await tx.urlRoute.count({ where: { redirectId: redirect.id } });
    if (remaining === 0) await tx.redirect.delete({ where: { id: redirect.id } });
  }
}

// ---------------------------------------------------------------------------
// Placing content
// ---------------------------------------------------------------------------

export type PlaceInput = {
  type: UrlContentType;
  entityId: string;
  countryId: string;
  /** The market's URL prefix, "" for the root market. */
  marketSlug: string;
  /** Market-relative path: "/autocad", "/software/autocad-lt". */
  relativePath: string;
  mode: UrlRouteModeValue;
  label: string;
  /** Whether the content has been public, so its old address earns a redirect. */
  wasPublished: boolean;
  reason: UrlChangeReason;
  actor: Actor;
  batchId?: string | null;
  /** Refuse unless the route is still at this version. */
  expectedVersion?: number | null;
};

export type PlaceResult =
  | {
      ok: true;
      changed: boolean;
      created: boolean;
      oldPath: string | null;
      newPath: string;
      redirectId: string | null;
      routeId: string;
      version: number;
    }
  | {
      ok: false;
      code: 'conflict' | 'stale' | 'invalid';
      message: string;
      owner?: OwnerSummary;
    };

/**
 * Gives a piece of content its address in one market, moving it if it had
 * another. Must run inside `withRegistry`.
 */
export async function placeContent(tx: Tx, input: PlaceInput): Promise<PlaceResult> {
  const path = joinMarket(input.marketSlug, input.relativePath);
  const key = pathKey(path);
  if (!key) return { ok: false, code: 'invalid', message: 'That is not a valid address.' };

  const existing = await tx.urlRoute.findUnique({
    where: { entityId_countryId: { entityId: input.entityId, countryId: input.countryId } },
  });

  if (
    input.expectedVersion !== undefined &&
    input.expectedVersion !== null &&
    existing &&
    existing.version !== input.expectedVersion
  ) {
    return {
      ok: false,
      code: 'stale',
      message: 'This address was changed by someone else since you opened it. Reload to see the current one.',
    };
  }

  if (
    existing &&
    existing.path === path &&
    existing.mode === input.mode &&
    existing.type === input.type
  ) {
    // The address stands; only the page's city is brought in line with it.
    if (isPageType(input.type)) await linkPageToCity(tx, input, path, { slug: false });
    return {
      ok: true,
      changed: false,
      created: false,
      oldPath: existing.path,
      newPath: path,
      redirectId: null,
      routeId: existing.id,
      version: existing.version,
    };
  }

  if (!existing || existing.pathKey !== key) {
    const availability = await checkAvailability(tx, key, input);
    if (!availability.ok) {
      return {
        ok: false,
        code: 'conflict',
        message: `${path} is already used by ${availability.owner.description}.`,
        owner: availability.owner,
      };
    }
    if (availability.release) await releaseClaim(tx, availability.release);
  }

  const route = existing
    ? await tx.urlRoute.update({
        where: { id: existing.id },
        data: {
          path,
          pathKey: key,
          mode: input.mode,
          type: input.type,
          version: { increment: 1 },
          updatedById: input.actor?.id ?? null,
        },
      })
    : await tx.urlRoute.create({
        data: {
          kind: 'CONTENT',
          path,
          pathKey: key,
          countryId: input.countryId,
          type: input.type,
          entityId: input.entityId,
          mode: input.mode,
          updatedById: input.actor?.id ?? null,
        },
      });

  // A page's slug is its path within its market; keep the two identical, and
  // the page's city with them.
  if (isPageType(input.type)) await linkPageToCity(tx, input, path, { slug: true });

  let redirectId: string | null = null;
  if (existing && existing.pathKey !== key) {
    // Redirects that already point here now resolve to the new address; keep
    // their stored destination in step for display and for the legacy
    // resolver.
    await tx.redirect.updateMany({
      where: { targetEntityId: input.entityId, targetCountryId: input.countryId },
      data: { destination: path },
    });
    if (input.wasPublished) {
      redirectId = await writeAutomaticRedirect(tx, {
        oldPath: existing.path,
        oldKey: existing.pathKey,
        countryId: input.countryId,
        target: { type: input.type, entityId: input.entityId, countryId: input.countryId },
        destination: path,
        label: input.label,
        actor: input.actor,
      });
    }
  }

  if (!existing || existing.path !== path) {
    await tx.urlHistory.create({
      data: {
        type: input.type,
        entityId: input.entityId,
        countryId: input.countryId,
        label: input.label.slice(0, 300),
        oldPath: existing?.path ?? null,
        newPath: path,
        reason: input.reason,
        redirectId,
        batchId: input.batchId ?? null,
        actorId: input.actor?.id ?? null,
        actorEmail: input.actor?.email ?? null,
      },
    });
  }

  await bumpRegistryVersion(tx);

  return {
    ok: true,
    changed: true,
    created: !existing,
    oldPath: existing?.path ?? null,
    newPath: path,
    redirectId,
    routeId: route.id,
    version: route.version,
  };
}

/**
 * Keeps a page's slug, city and landing-page flag in step with its address.
 *
 * A page whose first segment is a city's slug in its market is one of that
 * city's pages, and the one at the city's own address is its landing page;
 * every other page belongs to no city. Deriving this from the address, here
 * where every address change passes, means a page moved into or out of a city
 * by any route — the page form, the Slug Manager, a bulk change, a restore —
 * is always filed correctly. Written only when something differs.
 */
async function linkPageToCity(
  tx: Tx,
  input: Pick<PlaceInput, 'type' | 'entityId' | 'countryId' | 'marketSlug'>,
  path: string,
  options: { slug: boolean },
): Promise<void> {
  const segments = segmentsOf(stripMarket(input.marketSlug, path));
  const slug = segments.join('/');
  // Category and brand landing pages are refused inside a city, so only a
  // plain page can be in one.
  const city = input.type === 'PAGE' ? await cityOfPath(tx, input.countryId, slug) : null;
  const filing = { cityId: city?.id ?? null, isCityHomepage: Boolean(city) && segments.length === 1 };
  const page = await tx.page.findUnique({
    where: { id: input.entityId },
    select: { slug: true, cityId: true, isCityHomepage: true },
  });
  const slugDiffers = options.slug && page?.slug !== slug;
  if (
    !page ||
    slugDiffers ||
    page.cityId !== filing.cityId ||
    page.isCityHomepage !== filing.isCityHomepage
  ) {
    await tx.page.update({
      where: { id: input.entityId },
      data: options.slug ? { slug, ...filing } : filing,
    });
  }
}

async function writeAutomaticRedirect(
  tx: Tx,
  input: {
    oldPath: string;
    oldKey: string;
    countryId: string;
    target: { type: UrlContentType; entityId: string; countryId: string };
    destination: string;
    label: string;
    actor: Actor;
  },
): Promise<string> {
  const redirect = await tx.redirect.create({
    data: {
      source: input.oldPath,
      destination: input.destination,
      type: 'PERMANENT',
      isActive: true,
      origin: 'AUTOMATIC',
      countryId: input.countryId,
      targetType: input.target.type,
      targetEntityId: input.target.entityId,
      targetCountryId: input.target.countryId,
      note: `Previous address of “${input.label.slice(0, 120)}”`,
      createdById: input.actor?.id ?? null,
      updatedById: input.actor?.id ?? null,
    },
  });
  // The old key was vacated by the move in this same transaction.
  await tx.urlRoute.create({
    data: {
      kind: 'REDIRECT',
      path: input.oldPath,
      pathKey: input.oldKey,
      countryId: input.countryId,
      redirectId: redirect.id,
    },
  });
  return redirect.id;
}

/**
 * Takes a piece of content's address away — it was deleted or withdrawn from
 * the market. The address becomes free and answers 404 until somebody gives it
 * a deliberate new home; it is never redirected somewhere by default.
 *
 * Automatic redirects to the content are kept: they start working again if
 * the content is restored, and URL Health lists them meanwhile.
 */
export async function releaseContent(
  tx: Tx,
  input: {
    entityId: string;
    countryId: string;
    label: string;
    reason: UrlChangeReason;
    actor: Actor;
    batchId?: string | null;
  },
): Promise<{ released: boolean; path: string | null }> {
  const existing = await tx.urlRoute.findUnique({
    where: { entityId_countryId: { entityId: input.entityId, countryId: input.countryId } },
  });
  if (!existing || existing.kind !== 'CONTENT' || !existing.type) {
    return { released: false, path: null };
  }
  await tx.urlRoute.delete({ where: { id: existing.id } });
  await tx.urlHistory.create({
    data: {
      type: existing.type,
      entityId: input.entityId,
      countryId: input.countryId,
      label: input.label.slice(0, 300),
      oldPath: existing.path,
      newPath: null,
      reason: input.reason,
      batchId: input.batchId ?? null,
      actorId: input.actor?.id ?? null,
      actorEmail: input.actor?.email ?? null,
    },
  });
  await bumpRegistryVersion(tx);
  return { released: true, path: existing.path };
}

/** The current route of one piece of content in one market. */
export async function routeOf(
  tx: Tx | typeof prisma,
  entityId: string,
  countryId: string,
) {
  return tx.urlRoute.findUnique({
    where: { entityId_countryId: { entityId, countryId } },
  });
}

/** Whether a Prisma error is the database refusing a second claim on an address. */
export function isClaimCollision(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002' &&
    JSON.stringify(error.meta ?? {}).includes('pathKey')
  );
}

// ---------------------------------------------------------------------------
// Markets
// ---------------------------------------------------------------------------

/**
 * Whether a prefix can be given to a market without shadowing the root
 * market's own addresses: `/pricing` cannot become a market while the root
 * market has a page at `/pricing` or anything beneath it.
 */
export async function prefixConflict(
  db: Tx | typeof prisma,
  prefix: string,
  rootCountryId: string,
): Promise<string | null> {
  const key = `/${prefix.toLowerCase()}`;
  const clash = await db.urlRoute.findFirst({
    where: {
      countryId: rootCountryId,
      OR: [{ pathKey: key }, { pathKey: { startsWith: `${key}/` } }],
    },
    select: { path: true },
  });
  if (clash) return clash.path;
  // A root-market city owns its segment even before it has a page.
  const city = await db.city.findUnique({
    where: { countryId_slug: { countryId: rootCountryId, slug: prefix.toLowerCase() } },
    select: { name: true },
  });
  return city ? `${key} (the city ${city.name})` : null;
}

/**
 * Moves every address of a market to its new prefix: `/ae/x` becomes
 * `/uae/x`. Each content address that had been public keeps working through
 * an automatic redirect from the old prefix, and redirect claims move with
 * the market. Must run inside `withRegistry`.
 */
export async function rePrefixMarket(
  tx: Tx,
  input: {
    countryId: string;
    fromSlug: string;
    toSlug: string;
    actor: Actor;
    /** Content ids whose old address should keep working (they had been public). */
    publicIds: ReadonlySet<string>;
  },
): Promise<number> {
  const routes = await tx.urlRoute.findMany({ where: { countryId: input.countryId } });
  let moved = 0;

  // Old and new keys differ in their first segment, and the new prefix was
  // checked against the root market's addresses, so no move can collide.
  for (const route of routes) {
    const path = joinMarket(input.toSlug, stripMarket(input.fromSlug, route.path));
    const key = pathKey(path);
    if (!key) continue;

    await tx.urlRoute.update({
      where: { id: route.id },
      data: { path, pathKey: key, version: { increment: 1 }, updatedById: input.actor?.id ?? null },
    });

    if (route.kind === 'CONTENT' && route.type && route.entityId) {
      moved += 1;
      await tx.redirect.updateMany({
        where: { targetEntityId: route.entityId, targetCountryId: input.countryId },
        data: { destination: path },
      });
      let redirectId: string | null = null;
      if (input.publicIds.has(route.entityId)) {
        redirectId = await writeAutomaticRedirect(tx, {
          oldPath: route.path,
          oldKey: route.pathKey,
          countryId: input.countryId,
          target: { type: route.type as UrlContentType, entityId: route.entityId, countryId: input.countryId },
          destination: path,
          label: path,
          actor: input.actor,
        });
      }
      await tx.urlHistory.create({
        data: {
          type: route.type,
          entityId: route.entityId,
          countryId: input.countryId,
          label: path,
          oldPath: route.path,
          newPath: path,
          reason: 'MARKET',
          redirectId,
          actorId: input.actor?.id ?? null,
          actorEmail: input.actor?.email ?? null,
        },
      });
    }
  }

  await bumpRegistryVersion(tx);
  return moved;
}

/**
 * Gives a newly added market the every-market redirect rules imported from
 * before the registry, wherever the address is still free — which is how
 * those rules always behaved.
 */
export async function claimEveryMarketRules(
  tx: Tx,
  market: { id: string; slug: string },
): Promise<number> {
  const rules = await tx.redirect.findMany({ where: { allMarkets: true } });
  let claimed = 0;
  for (const rule of rules) {
    const key = pathKey(joinMarket(market.slug, rule.source));
    if (!key) continue;
    const taken = await tx.urlRoute.findUnique({ where: { pathKey: key }, select: { id: true } });
    if (taken) continue;
    await tx.urlRoute.create({
      data: { kind: 'REDIRECT', path: key, pathKey: key, countryId: market.id, redirectId: rule.id },
    });
    claimed += 1;
  }
  if (claimed > 0) await bumpRegistryVersion(tx);
  return claimed;
}

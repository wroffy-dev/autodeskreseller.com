import 'server-only';
import { auditDocument } from '@/lib/seo/score-overall';
import type { PageDraft, PostDraft } from '@/lib/seo/drafts';
import type { SeoAuditResult, SeoDocument, SeoEntityType } from '@/lib/seo/types';
import { prisma } from '@/lib/db/prisma';
import type { SeoContext } from './context';
import { indexEntry, withCollisions, type IndexEntry } from './collisions';
import {
  buildArchiveDocument,
  buildCategoryDocuments,
  buildPageDocuments,
  buildPostDocuments,
  buildProductMarketDocuments,
  buildTagDocuments,
  type ProductMarketDrafts,
  type ProductMarketRef,
} from './documents';

/**
 * Auditing: documents in, scores out.
 *
 * Works for one URL — an editor's live score, a detail page — and for a batch
 * of them, with the same code: build the documents, compare each with the
 * other live URLs of its market, run the engine. The market comparison is
 * built once per market and kept for a minute, so an editor typing does not
 * rebuild it on every pause.
 */

export type EntityRef = { type: SeoEntityType; id: string; countryId: string };

export type DraftBundle = {
  pages?: ReadonlyMap<string, PageDraft>;
  products?: ProductMarketDrafts;
  posts?: ReadonlyMap<string, PostDraft>;
};

export async function buildDocuments(
  ctx: SeoContext,
  refs: readonly EntityRef[],
  drafts: DraftBundle = {},
): Promise<SeoDocument[]> {
  const ids = (type: SeoEntityType) => refs.filter((ref) => ref.type === type).map((ref) => ref.id);
  const productRefs: ProductMarketRef[] = refs
    .filter((ref) => ref.type === 'PRODUCT_MARKET')
    .map((ref) => ({ productId: ref.id, countryId: ref.countryId }));

  const [pages, products, posts, categories, tags, archive] = await Promise.all([
    ids('PAGE').length > 0 ? buildPageDocuments(ctx, { id: { in: ids('PAGE') } }, drafts.pages) : [],
    productRefs.length > 0 ? buildProductMarketDocuments(ctx, productRefs, drafts.products) : [],
    ids('BLOG_POST').length > 0 ? buildPostDocuments(ctx, { id: { in: ids('BLOG_POST') } }, drafts.posts) : [],
    ids('BLOG_CATEGORY').length > 0 ? buildCategoryDocuments(ctx, { id: { in: ids('BLOG_CATEGORY') } }) : [],
    ids('BLOG_TAG').length > 0 ? buildTagDocuments(ctx, { id: { in: ids('BLOG_TAG') } }) : [],
    refs.some((ref) => ref.type === 'BLOG_ARCHIVE') ? [await buildArchiveDocument(ctx)] : [],
  ]);
  return [...pages, ...products, ...posts, ...categories, ...tags, ...archive];
}

// ---------------------------------------------------------------------------
// The market comparison
// ---------------------------------------------------------------------------

const INDEX_TTL_MS = 60_000;
const indexes = new Map<string, { at: number; value: Promise<IndexEntry[]> }>();

/** Every URL of a market, reduced to what collisions compare. */
export function marketIndex(ctx: SeoContext, countryId: string): Promise<IndexEntry[]> {
  const key = `${countryId}:${ctx.fingerprint}`;
  const now = Date.now();
  const hit = indexes.get(key);
  if (hit && now - hit.at < INDEX_TTL_MS) return hit.value;
  const value = buildMarketIndex(ctx, countryId);
  indexes.set(key, { at: now, value });
  value.catch(() => indexes.delete(key));
  // Old entries go when a new one is made, so the map never grows unbounded.
  for (const [stale, entry] of indexes) {
    if (now - entry.at >= INDEX_TTL_MS) indexes.delete(stale);
  }
  return value;
}

async function buildMarketIndex(ctx: SeoContext, countryId: string): Promise<IndexEntry[]> {
  const isRoot = countryId === ctx.root.id;
  const [pages, markets, posts, categories, tags] = await Promise.all([
    prisma.page.findMany({ where: { countryId, deletedAt: null }, select: { id: true } }),
    prisma.productCountry.findMany({
      where: { countryId, deletedAt: null, product: { deletedAt: null } },
      select: { productId: true },
    }),
    prisma.blogPost.findMany({ where: { countryId, deletedAt: null }, select: { id: true } }),
    // The blog's archives live at the root, so they are compared there.
    isRoot ? prisma.blogCategory.findMany({ select: { id: true } }) : [],
    isRoot ? prisma.blogTag.findMany({ select: { id: true } }) : [],
  ]);
  const refs: EntityRef[] = [
    ...pages.map((page) => ({ type: 'PAGE' as const, id: page.id, countryId })),
    ...markets.map((market) => ({ type: 'PRODUCT_MARKET' as const, id: market.productId, countryId })),
    ...posts.map((post) => ({ type: 'BLOG_POST' as const, id: post.id, countryId })),
    ...categories.map((category) => ({ type: 'BLOG_CATEGORY' as const, id: category.id, countryId })),
    ...tags.map((tag) => ({ type: 'BLOG_TAG' as const, id: tag.id, countryId })),
    ...(isRoot ? [{ type: 'BLOG_ARCHIVE' as const, id: 'blog', countryId }] : []),
  ];
  const docs = await buildDocuments(ctx, refs);
  return docs.map(indexEntry);
}

export function forgetMarketIndexes(): void {
  indexes.clear();
}

/** Scores documents, each compared with the live URLs of its own market. */
export async function auditDocuments(
  ctx: SeoContext,
  docs: readonly SeoDocument[],
): Promise<Array<{ doc: SeoDocument; result: SeoAuditResult }>> {
  const markets = [...new Set(docs.map((doc) => doc.country.id))];
  const entries = new Map(
    await Promise.all(markets.map(async (id) => [id, await marketIndex(ctx, id)] as const)),
  );
  return docs.map((doc) => {
    const compared = withCollisions(doc, entries.get(doc.country.id) ?? []);
    return { doc: compared, result: auditDocument(compared) };
  });
}

export async function auditEntities(
  ctx: SeoContext,
  refs: readonly EntityRef[],
  drafts: DraftBundle = {},
): Promise<Array<{ doc: SeoDocument; result: SeoAuditResult }>> {
  const docs = await buildDocuments(ctx, refs, drafts);
  return auditDocuments(ctx, docs);
}

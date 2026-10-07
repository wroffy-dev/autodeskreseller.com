import { z } from 'zod';

/**
 * An editor's unsaved values, for live scoring.
 *
 * The score panels send what is in the form right now; the server lays it
 * over the saved record and scores the result, so a score moves as an editor
 * types without anything being saved. Every field is optional and anything
 * malformed is dropped rather than rejected: a half-typed form must still
 * produce a score.
 */

const text = (max: number) => z.string().max(max).optional().catch(undefined);
const flag = z.boolean().optional().catch(undefined);
const id = z.string().max(64).nullable().optional().catch(undefined);
const list = (max: number) => z.array(z.string().max(600)).max(max).optional().catch(undefined);

const keywords = {
  primaryKeyword1: text(200),
  primaryKeyword2: text(200),
  primaryKeyword3: text(200),
};

export const pageDraftSchema = z.object({
  title: text(240),
  slug: text(300),
  status: text(20),
  publishedAt: text(40),
  isHomepage: flag,
  seoTitle: text(240),
  seoDescription: text(600),
  canonicalUrl: text(600),
  noIndex: flag,
  noFollow: flag,
  ogTitle: text(240),
  ogDescription: text(600),
  ogImageId: id,
  twitterTitle: text(240),
  twitterDescription: text(600),
  twitterImageId: id,
  ...keywords,
});

export const productDraftSchema = z.object({
  name: text(240),
  slug: text(240),
  sku: text(80),
  status: text(20),
  shortDescription: text(1200),
  description: text(40_000),
  storage: text(80),
  minUsers: text(20),
  maxUsers: text(20),
  features: list(60),
  benefits: list(60),
  specs: z
    .array(z.object({ label: z.string().max(200), value: z.string().max(400) }))
    .max(60)
    .optional()
    .catch(undefined),
  imageId: id,
  galleryIds: list(40),
  categoryId: id,
  brandId: id,
  currency: text(3),
  monthlyPrice: text(24),
  annualPrice: text(24),
  priceSuffix: text(120),
  priceNote: text(200),
  ctaLabel: text(80),
  seoTitle: text(240),
  seoDescription: text(600),
  canonicalUrl: text(600),
  noIndex: flag,
  ogImageId: id,
  ...keywords,
});

export const productMarketDraftSchema = z.object({
  status: text(20),
  currency: text(3),
  monthlyPrice: text(24),
  annualPrice: text(24),
  compareAtPrice: text(24),
  priceSuffix: text(120),
  priceNote: text(200),
  shortDescription: text(1200),
  ctaLabel: text(80),
  seoTitle: text(240),
  seoDescription: text(600),
  canonicalUrl: text(600),
  noIndex: flag,
  ...keywords,
});

export const postDraftSchema = z.object({
  title: text(240),
  slug: text(240),
  subtitle: text(240),
  status: text(20),
  publishedAt: text(40),
  excerpt: text(1200),
  content: text(200_000),
  categoryId: id,
  authorId: id,
  tags: list(40),
  featuredImageId: id,
  ogImageId: id,
  twitterImageId: id,
  seoTitle: text(240),
  seoDescription: text(600),
  canonicalUrl: text(600),
  noIndex: flag,
  noFollow: flag,
  ogTitle: text(240),
  ogDescription: text(600),
  ...keywords,
});

export type PageDraft = z.infer<typeof pageDraftSchema>;
export type ProductDraft = z.infer<typeof productDraftSchema>;
export type ProductMarketDraft = z.infer<typeof productMarketDraftSchema>;
export type PostDraft = z.infer<typeof postDraftSchema>;

/** Laid over a saved value: a draft field that is present wins, even when blank. */
export function overlay<T>(saved: T, draft: T | undefined): T {
  return draft === undefined ? saved : draft;
}

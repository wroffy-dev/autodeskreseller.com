'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { AuthorizationError, authorize, getCurrentUser, type SessionUser } from '@/lib/auth/guards';
import { listAccessibleCountries } from '@/lib/country/access';
import { success, failure, toActionError, type ActionResult } from '@/lib/utils/result';
import {
  pageDraftSchema,
  postDraftSchema,
  productDraftSchema,
  productMarketDraftSchema,
} from '@/lib/seo/drafts';
import { SEO_ENTITY_TYPES, type SeoAuditResult, type SeoEntityType } from '@/lib/seo/types';
import { forgetSeoContext, loadSeoContext } from '@/lib/seo/intelligence/context';
import {
  auditEntities,
  forgetMarketIndexes,
  type DraftBundle,
} from '@/lib/seo/intelligence/audit';
import { productMarketKey } from '@/lib/seo/intelligence/documents';
import { recalculateBatch, recalculateEntities, type BatchProgress } from '@/lib/seo/intelligence/cache';
import { AuditNotFoundError, resolveAuditRef } from '@/lib/seo/intelligence/access';

/**
 * SEO Intelligence actions.
 *
 * Scoring reads content; it never changes it. Viewing a score needs the right
 * to view the content it describes, in its market. Recalculating the cached
 * scores for the whole site needs the SEO permission. Nothing here runs for a
 * public request: every entry point is an authenticated admin action.
 */

const refSchema = z.object({
  type: z.enum(SEO_ENTITY_TYPES as [SeoEntityType, ...SeoEntityType[]]),
  id: z.string().min(1).max(64),
  countryId: z.string().max(64).optional(),
});

async function currentUser(): Promise<SessionUser> {
  // Any signed-in admin; each URL is then checked against its own permission.
  const user = await getCurrentUser();
  if (!user) throw new AuthorizationError('authentication');
  return user;
}

function failed(error: unknown, action: string): ActionResult<never> {
  if (error instanceof AuditNotFoundError) return failure(error.message);
  if (error instanceof AuthorizationError) {
    return failure(`You do not have permission to ${action}.`);
  }
  return toActionError(error);
}

const draftInputSchema = z.object({
  ref: refSchema,
  draft: z.unknown().optional(),
  /** The product form's shared values, when scoring a market version. */
  productDraft: z.unknown().optional(),
  /** The country panel's values for this market. */
  marketDraft: z.unknown().optional(),
  /** Re-read settings and the market's other pages rather than the cached ones. */
  refresh: z.boolean().optional(),
});

/**
 * Scores a URL with an editor's unsaved values laid over it.
 *
 * Nothing is stored: this is the live score an editor sees while typing.
 */
export async function scoreSeoDraft(input: unknown): Promise<ActionResult<SeoAuditResult>> {
  try {
    const user = await currentUser();
    const parsed = draftInputSchema.parse(input);
    const ref = await resolveAuditRef(user, parsed.ref);
    const drafts: DraftBundle = {};
    if (ref.type === 'PAGE' && parsed.draft) {
      drafts.pages = new Map([[ref.id, pageDraftSchema.parse(parsed.draft)]]);
    }
    if (ref.type === 'BLOG_POST' && parsed.draft) {
      drafts.posts = new Map([[ref.id, postDraftSchema.parse(parsed.draft)]]);
    }
    if (ref.type === 'PRODUCT_MARKET' && (parsed.productDraft || parsed.marketDraft)) {
      drafts.products = new Map([
        [
          productMarketKey({ productId: ref.id, countryId: ref.countryId }),
          {
            product: parsed.productDraft ? productDraftSchema.parse(parsed.productDraft) : undefined,
            market: parsed.marketDraft ? productMarketDraftSchema.parse(parsed.marketDraft) : undefined,
          },
        ],
      ]);
    }
    if (parsed.refresh) {
      forgetSeoContext();
      forgetMarketIndexes();
    }
    const ctx = await loadSeoContext();
    const [audited] = await auditEntities(ctx, [ref], drafts);
    if (!audited) return failure('That page could not be analysed.');
    return success(audited.result);
  } catch (error) {
    return failed(error, 'view this analysis');
  }
}

/** Recalculates one URL's cached score from its saved content. */
export async function recalculateSeoScore(input: unknown): Promise<ActionResult<SeoAuditResult>> {
  try {
    const user = await currentUser();
    const ref = await resolveAuditRef(user, refSchema.parse(input));
    const [audited] = await recalculateEntities([ref]);
    revalidatePath('/admin/seo-intelligence');
    if (!audited) return failure('That page could not be analysed.');
    return success(audited.result, 'Score recalculated.');
  } catch (error) {
    return failed(error, 'recalculate this score');
  }
}

const batchSchema = z.object({
  cursor: z.string().max(300).nullable(),
  onlyOutdated: z.boolean().default(false),
});

/**
 * One step of "Recalculate all": the next batch after `cursor`.
 *
 * The dashboard calls this in a loop until `nextCursor` is null, so the site
 * is recalculated in small bounded steps and never in one long request.
 * Limited to the markets the user may work in.
 */
export async function recalculateSeoBatch(input: unknown): Promise<ActionResult<BatchProgress>> {
  try {
    const user = await authorize('seo.manage');
    const { cursor, onlyOutdated } = batchSchema.parse(input);
    const countries = await listAccessibleCountries(user, { includeInactive: true });
    const progress = await recalculateBatch({
      cursor,
      size: 20,
      onlyOutdated,
      countryIds: countries.map((country) => country.id),
    });
    if (!progress.nextCursor) revalidatePath('/admin/seo-intelligence');
    return success(progress);
  } catch (error) {
    return toActionError(error);
  }
}

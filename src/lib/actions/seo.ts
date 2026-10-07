'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { authorize, type SessionUser } from '@/lib/auth/guards';
import { assertCountryAccess, listAccessibleCountries } from '@/lib/country/access';
import { listCountries } from '@/lib/country/registry';
import {
  deleteRedirectRule,
  ruleMarket,
  saveRedirectRule,
  toggleRedirectRule,
} from '@/lib/urls/redirect-rules';
import { recordAudit } from '@/lib/services/audit';
import { sanitizeText } from '@/lib/utils/sanitize';
import { success, failure, toActionError, type ActionResult } from '@/lib/utils/result';

const optional = (max: number) =>
  z
    .string()
    .max(max)
    .transform((v) => v.trim())
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

const seoSettingsSchema = z.object({
  defaultTitle: z.string().trim().min(1, 'A default title is required').max(240),
  titleTemplate: z.string().trim().min(1).max(120),
  defaultDescription: z.string().trim().max(400),
  defaultOgImageUrl: optional(500),
  twitterHandle: optional(60),
  organizationName: z.string().trim().min(1).max(160),
  organizationLogoUrl: optional(500),
  organizationType: z.string().trim().max(60).default('Organization'),
  googleSiteVerification: optional(200),
  bingSiteVerification: optional(200),
  robotsTxtExtra: optional(2000),
  sitemapEnabled: z.coerce.boolean().default(true),
  noIndexSite: z.coerce.boolean().default(false),
});

export async function saveSeoSettings(formData: FormData): Promise<ActionResult> {
  try {
    const user = await authorize('seo.manage');
    const input = seoSettingsSchema.parse({
      defaultTitle: formData.get('defaultTitle'),
      titleTemplate: formData.get('titleTemplate'),
      defaultDescription: formData.get('defaultDescription') ?? '',
      defaultOgImageUrl: formData.get('defaultOgImageUrl'),
      twitterHandle: formData.get('twitterHandle'),
      organizationName: formData.get('organizationName'),
      organizationLogoUrl: formData.get('organizationLogoUrl'),
      organizationType: formData.get('organizationType') || 'Organization',
      googleSiteVerification: formData.get('googleSiteVerification'),
      bingSiteVerification: formData.get('bingSiteVerification'),
      robotsTxtExtra: formData.get('robotsTxtExtra'),
      sitemapEnabled: formData.get('sitemapEnabled') === 'true',
      noIndexSite: formData.get('noIndexSite') === 'true',
    });

    if (!input.titleTemplate.includes('%s')) {
      return failure('The title template must contain %s — the page title goes there.', {
        titleTemplate: ['Include %s, for example "%s | Acme"'],
      });
    }

    await prisma.seoSettings.upsert({
      where: { id: 'singleton' },
      update: {
        ...input,
        defaultTitle: sanitizeText(input.defaultTitle),
        defaultDescription: sanitizeText(input.defaultDescription),
        organizationName: sanitizeText(input.organizationName),
      },
      create: {
        id: 'singleton',
        ...input,
        defaultTitle: sanitizeText(input.defaultTitle),
        defaultDescription: sanitizeText(input.defaultDescription),
        organizationName: sanitizeText(input.organizationName),
      },
    });

    await recordAudit({
      actor: user,
      action: 'updated',
      entity: 'SeoSettings',
      summary: 'Updated global SEO settings',
    });

    // Metadata, robots and the sitemap all read these values.
    revalidatePath('/', 'layout');
    revalidatePath('/robots.txt');
    revalidatePath('/sitemap.xml');
    return success(undefined, 'SEO settings saved.');
  } catch (error) {
    return toActionError(error);
  }
}

const redirectSchema = z.object({
  source: z.string().trim().min(1, 'Enter the old path').max(500),
  destination: z.string().trim().max(1000).default(''),
  targetEntityId: z.string().trim().max(60).optional().nullable(),
  targetCountryId: z.string().trim().max(60).optional().nullable(),
  type: z.enum(['PERMANENT', 'TEMPORARY']).default('PERMANENT'),
  isActive: z.coerce.boolean().default(true),
  allMarkets: z.coerce.boolean().default(false),
  note: optional(200),
  expectedUpdatedAt: z.string().max(40).optional().nullable(),
});

/** The markets a user may write redirects for, and whether that is all of them. */
async function redirectAccess(user: SessionUser) {
  const [mine, all] = await Promise.all([listAccessibleCountries(user, { includeInactive: true }), listCountries()]);
  return { countryIds: new Set(mine.map((country) => country.id)), everyMarket: mine.length >= all.length };
}

/**
 * Creates or updates a redirect rule.
 *
 * The rule claims its address in the URL registry, so it cannot shadow a
 * page or product and no second rule can answer for the same address. A
 * destination that is some content's address is stored as that content, so
 * the rule follows it through any rename; a chain is flattened as it is
 * saved, and a loop is refused.
 */
export async function saveRedirect(
  redirectId: string | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await authorize('seo.manage');
    const input = redirectSchema.parse({
      source: formData.get('source'),
      destination: formData.get('destination') ?? '',
      targetEntityId: formData.get('targetEntityId') || null,
      targetCountryId: formData.get('targetCountryId') || null,
      type: formData.get('type') || 'PERMANENT',
      isActive: formData.get('isActive') !== 'false',
      allMarkets: formData.get('allMarkets') === 'true',
      note: formData.get('note'),
      expectedUpdatedAt: formData.get('expectedUpdatedAt') || null,
    });

    if (redirectId) {
      const market = await ruleMarket(redirectId);
      if (market?.countryId) await assertCountryAccess(user, market.countryId);
    }

    const result = await saveRedirectRule(
      {
        id: redirectId,
        source: input.source,
        destination: input.destination,
        target:
          input.targetEntityId && input.targetCountryId
            ? { entityId: input.targetEntityId, countryId: input.targetCountryId }
            : null,
        type: input.type,
        isActive: input.isActive,
        note: input.note ? sanitizeText(input.note) : null,
        allMarkets: input.allMarkets,
        expectedUpdatedAt: input.expectedUpdatedAt,
      },
      user,
      await redirectAccess(user),
    );
    if (!result.ok) {
      return failure(result.error, result.field ? { [result.field]: [result.error] } : undefined);
    }

    const saved = await prisma.redirect.findUniqueOrThrow({ where: { id: result.id } });
    await recordAudit({
      actor: user,
      action: redirectId ? 'updated' : 'created',
      entity: 'Redirect',
      entityId: result.id,
      summary: `${saved.source} → ${saved.destination}`,
    });

    revalidatePath('/admin/redirects');
    revalidatePath('/admin/slug-manager');
    const notes = [
      result.flattened ? 'It pointed at another redirect, so it now goes straight to where that one ends.' : null,
      result.dormant.length > 0
        ? `Content already lives at ${result.dormant.join(', ')}, so it does not apply there.`
        : null,
    ].filter(Boolean);
    return success({ id: result.id }, ['Redirect saved.', ...notes].join(' '));
  } catch (error) {
    return toActionError(error);
  }
}

export async function toggleRedirect(redirectId: string): Promise<ActionResult> {
  try {
    const user = await authorize('seo.manage');
    const market = await ruleMarket(redirectId);
    if (!market) return failure('That redirect no longer exists.');
    if (market.countryId) await assertCountryAccess(user, market.countryId);

    const result = await toggleRedirectRule(redirectId, user);
    if (!result.ok) return failure('That redirect no longer exists.');

    await recordAudit({
      actor: user,
      action: result.isActive ? 'enabled' : 'disabled',
      entity: 'Redirect',
      entityId: redirectId,
      summary: result.isActive ? 'Enabled a redirect' : 'Disabled a redirect',
    });
    revalidatePath('/admin/redirects');
    revalidatePath('/admin/slug-manager');
    return success(undefined, result.isActive ? 'Redirect enabled.' : 'Redirect disabled.');
  } catch (error) {
    return toActionError(error);
  }
}

export async function deleteRedirect(redirectId: string): Promise<ActionResult> {
  try {
    const user = await authorize('seo.manage');
    const market = await ruleMarket(redirectId);
    if (!market) return failure('That redirect no longer exists.');
    if (market.countryId) await assertCountryAccess(user, market.countryId);

    const result = await deleteRedirectRule(redirectId);
    if (!result.ok) return failure('That redirect no longer exists.');

    await recordAudit({
      actor: user,
      action: 'deleted',
      entity: 'Redirect',
      entityId: redirectId,
      summary: `Removed ${result.source} → ${result.destination}`,
    });

    revalidatePath('/admin/redirects');
    revalidatePath('/admin/slug-manager');
    return success(undefined, 'Redirect deleted.');
  } catch (error) {
    return toActionError(error);
  }
}

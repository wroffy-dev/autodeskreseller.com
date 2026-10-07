'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { authorize } from '@/lib/auth/guards';
import { recordAudit } from '@/lib/services/audit';
import { uniqueSlug, slugify } from '@/lib/utils/slug';
import { sanitizeText, safeUrl } from '@/lib/utils/sanitize';
import { success, failure, toActionError, type ActionResult } from '@/lib/utils/result';
import { resolveActionCountry } from '@/lib/country/admin';
import type { Prisma } from '@prisma/client';

const optional = (max: number) =>
  z
    .string()
    .max(max)
    .transform((v) => v.trim())
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

// ---------------------------------------------------------------------------
// Popups
// ---------------------------------------------------------------------------

const popupSchema = z
  .object({
    name: z.string().trim().min(1, 'Give the popup a name').max(120),
    type: z.enum(['OFFER', 'IMAGE', 'LEAD_FORM', 'NEWSLETTER', 'PRODUCT', 'LEAD_MAGNET']),
    isActive: z.coerce.boolean().default(false),
    /** Empty shows the popup in every market; an id targets one market. */
    countryId: optional(40),
    heading: optional(200),
    body: optional(1000),
    imageId: optional(40),
    formId: optional(40),
    leadMagnetId: optional(40),
    ctaLabel: optional(60),
    ctaUrl: optional(400),
    trigger: z.enum(['IMMEDIATE', 'DELAY', 'SCROLL', 'EXIT_INTENT']).default('DELAY'),
    delaySeconds: z.coerce.number().int().min(0).max(600).default(5),
    scrollPercent: z.coerce.number().int().min(1).max(100).default(50),
    device: z.enum(['ALL', 'DESKTOP', 'MOBILE']).default('ALL'),
    frequencyDays: z.coerce.number().int().min(0).max(365).default(7),
    startsAt: optional(40),
    endsAt: optional(40),
    urlPatterns: z.array(z.string().max(200)).max(50).default([]),
  })
  .refine(
    (data) => data.type !== 'LEAD_FORM' || Boolean(data.formId),
    { message: 'Choose the form this popup should show', path: ['formId'] },
  );

export async function savePopup(
  popupId: string | null,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await authorize('marketing.manage');
    const parsed = popupSchema.parse(input);

    const startsAt = parsed.startsAt ? new Date(parsed.startsAt) : null;
    const endsAt = parsed.endsAt ? new Date(parsed.endsAt) : null;
    if (startsAt && Number.isNaN(startsAt.getTime())) return failure('Enter a valid start date.');
    if (endsAt && Number.isNaN(endsAt.getTime())) return failure('Enter a valid end date.');
    if (startsAt && endsAt && endsAt <= startsAt) {
      return failure('The end date must be after the start date.', { endsAt: ['Must be later'] });
    }

    // A market-targeted popup is validated against the user's market access,
    // so a crafted payload cannot aim a popup at a storefront they cannot edit.
    const countryId = parsed.countryId
      ? (await resolveActionCountry(user, parsed.countryId)).id
      : null;

    const data = {
      name: sanitizeText(parsed.name),
      type: parsed.type,
      isActive: parsed.isActive,
      countryId,
      heading: parsed.heading ? sanitizeText(parsed.heading) : null,
      body: parsed.body ? sanitizeText(parsed.body) : null,
      imageId: parsed.imageId,
      formId: parsed.formId,
      leadMagnetId: parsed.leadMagnetId,
      ctaLabel: parsed.ctaLabel,
      ctaUrl: safeUrl(parsed.ctaUrl),
      trigger: parsed.trigger,
      delaySeconds: parsed.delaySeconds,
      scrollPercent: parsed.scrollPercent,
      device: parsed.device,
      frequencyDays: parsed.frequencyDays,
      startsAt,
      endsAt,
      urlPatterns: parsed.urlPatterns.filter(Boolean) as Prisma.InputJsonValue,
    };

    const popup = popupId
      ? await prisma.popup.update({ where: { id: popupId }, data })
      : await prisma.popup.create({ data });

    await recordAudit({
      actor: user,
      action: popupId ? 'updated' : 'created',
      entity: 'Popup',
      entityId: popup.id,
      summary: `${popupId ? 'Updated' : 'Created'} popup “${popup.name}”`,
    });

    revalidatePath('/admin/popups');
    revalidatePath('/', 'layout');
    return success({ id: popup.id }, 'Popup saved.');
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * Turns a popup on or off.
 *
 * With `next`, the popup is set to that state rather than flipped, so a switch
 * that was pressed twice in two tabs, or retried after a dropped response,
 * lands where the admin left it. Returns the stored state either way.
 */
export async function togglePopup(
  popupId: string,
  next?: boolean,
): Promise<ActionResult<{ isActive: boolean }>> {
  try {
    const user = await authorize('marketing.manage');
    const popup = await prisma.popup.findUnique({ where: { id: popupId } });
    if (!popup) return failure('That popup no longer exists.');

    const isActive = typeof next === 'boolean' ? next : !popup.isActive;
    if (isActive === popup.isActive) {
      return success({ isActive }, isActive ? 'Popup enabled.' : 'Popup disabled.');
    }

    await prisma.popup.update({ where: { id: popupId }, data: { isActive } });

    await recordAudit({
      actor: user,
      action: isActive ? 'enabled' : 'disabled',
      entity: 'Popup',
      entityId: popupId,
      summary: `${isActive ? 'Enabled' : 'Disabled'} popup “${popup.name}”`,
    });

    revalidatePath('/admin/popups');
    revalidatePath('/', 'layout');
    return success({ isActive }, isActive ? 'Popup enabled.' : 'Popup disabled.');
  } catch (error) {
    return toActionError(error);
  }
}

export async function deletePopup(popupId: string): Promise<ActionResult> {
  try {
    const user = await authorize('marketing.manage');
    const popup = await prisma.popup.findUnique({ where: { id: popupId } });
    if (!popup) return failure('That popup no longer exists.');

    await prisma.popup.delete({ where: { id: popupId } });

    await recordAudit({
      actor: user,
      action: 'deleted',
      entity: 'Popup',
      entityId: popupId,
      summary: `Deleted popup “${popup.name}”`,
    });

    revalidatePath('/admin/popups');
    revalidatePath('/', 'layout');
    return success(undefined, 'Popup deleted.');
  } catch (error) {
    return toActionError(error);
  }
}

// ---------------------------------------------------------------------------
// Lead magnets
// ---------------------------------------------------------------------------

const leadMagnetSchema = z.object({
  title: z.string().trim().min(1, 'Give the lead magnet a title').max(200),
  slug: z
    .string()
    .max(200)
    .transform((v) => slugify(v)),
  kind: z.enum(['EBOOK', 'PDF', 'GUIDE', 'CHECKLIST', 'WHITEPAPER', 'DEMO', 'CONSULTATION', 'OFFER']),
  description: optional(1000),
  isActive: z.coerce.boolean().default(true),
  imageId: optional(40),
  fileId: optional(40),
  externalUrl: optional(500),
  formId: optional(40),
  ctaLabel: z.string().trim().max(60).default('Download'),
  thankYouTitle: optional(200),
  thankYouMessage: optional(600),
  thankYouUrl: optional(400),
});

export async function saveLeadMagnet(
  magnetId: string | null,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await authorize('marketing.manage');
    const parsed = leadMagnetSchema.parse(input);

    const slug =
      magnetId === null
        ? await uniqueSlug(parsed.slug || slugify(parsed.title), async (candidate) => {
            const existing = await prisma.leadMagnet.findUnique({
              where: { slug: candidate },
              select: { id: true },
            });
            return Boolean(existing);
          })
        : parsed.slug;

    if (magnetId) {
      const clash = await prisma.leadMagnet.findFirst({
        where: { slug, id: { not: magnetId } },
        select: { id: true },
      });
      if (clash) return failure('Another lead magnet already uses that slug.', { slug: ['Already in use'] });
    }

    const data = {
      title: sanitizeText(parsed.title),
      slug,
      kind: parsed.kind,
      description: parsed.description ? sanitizeText(parsed.description) : null,
      isActive: parsed.isActive,
      imageId: parsed.imageId,
      fileId: parsed.fileId,
      externalUrl: safeUrl(parsed.externalUrl),
      formId: parsed.formId,
      ctaLabel: parsed.ctaLabel || 'Download',
      thankYouTitle: parsed.thankYouTitle ? sanitizeText(parsed.thankYouTitle) : null,
      thankYouMessage: parsed.thankYouMessage ? sanitizeText(parsed.thankYouMessage) : null,
      thankYouUrl: safeUrl(parsed.thankYouUrl),
    };

    const magnet = magnetId
      ? await prisma.leadMagnet.update({ where: { id: magnetId }, data })
      : await prisma.leadMagnet.create({ data });

    await recordAudit({
      actor: user,
      action: magnetId ? 'updated' : 'created',
      entity: 'LeadMagnet',
      entityId: magnet.id,
      summary: `${magnetId ? 'Updated' : 'Created'} lead magnet “${magnet.title}”`,
    });

    revalidatePath('/admin/lead-magnets');
    revalidatePath('/', 'layout');
    return success({ id: magnet.id }, 'Lead magnet saved.');
  } catch (error) {
    return toActionError(error);
  }
}

export async function deleteLeadMagnet(magnetId: string): Promise<ActionResult> {
  try {
    const user = await authorize('marketing.manage');
    const magnet = await prisma.leadMagnet.findUnique({
      where: { id: magnetId },
      include: { _count: { select: { leads: true } } },
    });
    if (!magnet) return failure('That lead magnet no longer exists.');

    // Soft delete: leads reference it for attribution.
    await prisma.leadMagnet.update({
      where: { id: magnetId },
      data: { deletedAt: new Date(), isActive: false, slug: `${magnet.slug}-deleted-${Date.now()}` },
    });

    await recordAudit({
      actor: user,
      action: 'deleted',
      entity: 'LeadMagnet',
      entityId: magnetId,
      summary: `Deleted lead magnet “${magnet.title}” (${magnet._count.leads} lead(s) retained)`,
    });

    revalidatePath('/admin/lead-magnets');
    revalidatePath('/', 'layout');
    return success(undefined, 'Lead magnet deleted.');
  } catch (error) {
    return toActionError(error);
  }
}

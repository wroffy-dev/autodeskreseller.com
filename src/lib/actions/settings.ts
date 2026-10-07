'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { authorize } from '@/lib/auth/guards';
import { recordAudit } from '@/lib/services/audit';
import { sanitizeText, safeUrl } from '@/lib/utils/sanitize';
import { encryptSecret } from '@/lib/utils/crypto';
import { verifySmtp, sendMail } from '@/lib/email/mailer';
import { success, failure, toActionError, type ActionResult } from '@/lib/utils/result';
import { isCmsIconName } from '@/components/ui/icon-names';
import { HEX_COLOR } from '@/lib/cms/color';

const optional = (max: number) =>
  z
    .string()
    .max(max)
    .transform((v) => v.trim())
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

/*
 * The eight palette colours, which are the one place opacity does not belong.
 *
 * They are published as `R G B` triples for Tailwind's own alpha modifier —
 * `bg-brand/10`, `text-brand/70` and the rest — so an opacity inside one would
 * have nowhere to go in `rgb(var(--brand-primary) / <alpha-value>)` and would
 * quietly do nothing. Every other colour on the site takes one.
 */
const hexColor = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Use a 6-digit hex colour like #0061FF');

const fontWeight = z.string().trim().regex(/^[1-9]00$/, 'Choose a weight between 100 and 900');

/** A CSS length the admin typed, e.g. "16px", "1.5rem", "80%". */
const LENGTH_RE = /^\d{1,4}(\.\d+)?(px|rem|em|%)$/;
const NUMBER_RE = /^\d(\.\d+)?$/;
const TRACKING_RE = /^-?\d(\.\d+)?(em|px|rem)$/;

/**
 * Design tokens all carry a default.
 *
 * The settings form posts every field, but a partial post — an older cached
 * client, or a caller that only wants to change the site name — must not fail
 * validation on a token it never sent. An omitted or blank value falls back to
 * the documented default rather than rejecting the whole save.
 */
const token = (pattern: RegExp, fallback: string, message: string) =>
  z
    .string()
    .trim()
    .optional()
    .transform((v) => (v === undefined || v === '' ? fallback : v))
    .refine((v) => pattern.test(v), message);

/** Same, but an empty value is meaningful: it means "inherit". */
const optionalToken = (pattern: RegExp, message: string) =>
  z
    .string()
    .trim()
    .optional()
    .transform((v) => v ?? '')
    .refine((v) => v === '' || pattern.test(v), message);

const fontSize = (fallback: string, message: string) => token(LENGTH_RE, fallback, message);
const cssLength = (fallback: string, message: string) => token(LENGTH_RE, fallback, message);
const unitlessNumber = (fallback: string) =>
  token(NUMBER_RE, fallback, 'Use a plain number such as 1.5');
const optionalUnitlessNumber = optionalToken(NUMBER_RE, 'Use a plain number such as 1.2');
const optionalFontSize = optionalToken(LENGTH_RE, 'Use a size like 15px or 0.95rem');
/** A size somebody may leave blank, meaning "keep what it looks like now". */
const optionalLength = optionalToken(LENGTH_RE, 'Use a value like 72px or 4.5rem');
/**
 * A colour somebody may leave blank, for the same reason.
 *
 * Opacity lives inside the colour — `#0061FF80` — so there is no second field
 * to keep in step with it and nothing to store twice.
 */
const optionalColor = z
  .string()
  .trim()
  .optional()
  .transform((v) => v ?? '')
  .refine(
    (v) => v === '' || HEX_COLOR.test(v),
    'Use a hex colour like #0061FF, or #0061FF80 for one with opacity',
  );
/** A weight somebody may leave blank. */
const optionalWeight = optionalToken(/^[1-9]00$/, 'Choose a weight between 100 and 900');
const letterSpacing = (fallback: string) =>
  token(TRACKING_RE, fallback, 'Use a value like -0.02em or 1px');

/** An optional font name; blank means "inherit the body font". */
const optionalFontName = z
  .string()
  .trim()
  .max(80)
  .optional()
  .transform((v) => v ?? '');

/** An icon this app ships, or nothing. Never a name that renders blank. */
const iconName = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ?? '').toLowerCase())
  .refine((v) => v === '' || isCmsIconName(v), 'Choose an icon from the list');

const buttonVariant = z.enum([
  'primary',
  'secondary',
  'outline',
  'ghost',
  'subtle',
  'link',
]);

/** Every "show this part" switch on the header tab. */
const CHROME_TOGGLES = [
  'headerShowLogo',
  'headerShowSiteName',
  'headerShowMenu',
  'headerShowMarkets',
] as const;

const websiteSettingsSchema = z.object({
  siteName: z.string().trim().min(1, 'Site name is required').max(120),
  siteTitle: z.string().trim().max(200),
  siteDescription: z.string().trim().max(500),
  siteUrl: z.string().trim().url('Enter the full URL including https://').max(300),
  contactEmail: optional(200),
  contactPhone: optional(40),
  whatsappNumber: optional(40),
  address: optional(400),

  linkedinUrl: optional(300),
  twitterUrl: optional(300),
  facebookUrl: optional(300),
  instagramUrl: optional(300),
  youtubeUrl: optional(300),

  logoUrl: optional(500),
  logoDarkUrl: optional(500),
  faviconUrl: optional(500),
  ogImageUrl: optional(500),

  headingFont: z.string().trim().min(1).max(80),
  bodyFont: z.string().trim().min(1).max(80),
  // Empty means "inherit the body font" and costs no extra font request.
  navFont: optionalFontName,
  buttonFont: optionalFontName,
  headingWeight: fontWeight,
  bodyWeight: fontWeight,
  navWeight: fontWeight.optional().transform((v) => v ?? '500'),
  buttonWeight: fontWeight.optional().transform((v) => v ?? '600'),
  baseFontSize: fontSize('16px', 'Use a size like 16px or 1rem'),
  baseFontSizeTablet: optionalFontSize,
  baseFontSizeMobile: optionalFontSize,
  headingLineHeight: unitlessNumber('1.15'),
  bodyLineHeight: unitlessNumber('1.6'),
  headingLetterSpacing: letterSpacing('-0.02em'),
  bodyLetterSpacing: letterSpacing('0em'),
  navFontSize: fontSize('0.9375rem', 'Use a size like 15px or 0.9375rem'),
  buttonFontSize: fontSize('0.875rem', 'Use a size like 14px or 0.875rem'),
  headingScale: unitlessNumber('1'),
  headingScaleTablet: optionalUnitlessNumber,
  headingScaleMobile: optionalUnitlessNumber,

  containerWidth: cssLength('72rem', 'Use a width like 1200px or 72rem'),
  containerPadding: cssLength('1.5rem', 'Use a value like 24px or 1.5rem'),
  sectionSpacing: cssLength('5rem', 'Use a value like 80px or 5rem'),
  sectionSpacingMobile: cssLength('3rem', 'Use a value like 48px or 3rem'),
  borderRadius: cssLength('0.75rem', 'Use a value like 12px or 0.75rem'),
  cardRadius: cssLength('1rem', 'Use a value like 16px or 1rem'),

  buttonRadius: cssLength('0.5rem', 'Use a value like 8px or 0.5rem'),
  buttonPaddingX: cssLength('1.25rem', 'Use a value like 20px or 1.25rem'),
  buttonPaddingY: cssLength('0.625rem', 'Use a value like 10px or 0.625rem'),
  buttonPrimaryStyle: z.enum(['solid', 'outline', 'soft']).catch('solid').default('solid'),
  buttonSecondaryStyle: z.enum(['solid', 'outline', 'soft']).catch('outline').default('outline'),
  buttonTextTransform: z.enum(['none', 'uppercase', 'capitalize']).catch('none').default('none'),

  colorPrimary: hexColor,
  colorSecondary: hexColor,
  colorAccent1: hexColor,
  colorAccent2: hexColor,
  colorBackground: hexColor,
  colorText: hexColor,
  colorMuted: hexColor,
  colorBorder: hexColor,

  announcementText: optional(300),
  announcementUrl: optional(300),
  announcementEnabled: z.coerce.boolean().default(false),
  headerCtaLabel: optional(60),
  headerCtaUrl: optional(300),
  headerSecondaryCtaLabel: optional(60),
  headerSecondaryCtaUrl: optional(300),
  /*
   * Where the menu sits in the header. `catch` rather than a hard failure:
   * an unknown value means the menu goes back where it has always been,
   * which is never a broken header.
   */
  headerMenuAlign: z.enum(['left', 'center', 'right']).catch('left').default('left'),

  /*
   * Header appearance. Every size and colour here may be left blank, and blank
   * means "leave it as it is" rather than zero or transparent — the renderer
   * emits no variable for it and the component's own value stands. That is
   * what makes this screen safe to open on a site nobody wants restyled.
   */
  headerHeight: optionalLength,
  headerHeightMobile: optionalLength,
  headerWidth: optionalLength,
  headerBg: optionalColor,
  headerText: optionalColor,
  headerLinkHover: optionalColor,
  headerLinkActive: optionalColor,
  headerBorderColor: optionalColor,
  headerBorder: z.coerce.boolean().default(true),
  headerSticky: z.coerce.boolean().default(true),
  headerShadow: z.enum(['none', 'sm', 'md', 'lg']).catch('none').default('none'),
  /*
   * Glass. Blank for both leaves the header's own slight blur alone, which is
   * what every site that never opens this screen keeps.
   */
  headerBlur: z
    .string()
    .trim()
    .optional()
    .transform((v) => v ?? '')
    .refine(
      (v) => v === '' || /^\d{1,3}(\.\d+)?(px|rem)?$/.test(v),
      'Use a blur such as 16px — up to 40px',
    ),
  headerSaturate: z
    .string()
    .trim()
    .optional()
    .transform((v) => v ?? '')
    .refine(
      (v) => v === '' || /^\d{1,3}%?$/.test(v),
      'Use a percentage such as 140% — 100% leaves the colour as it is',
    ),
  headerGlassEdge: z.coerce.boolean().default(false),

  /* What the header shows. All default on — the header as it is. */
  headerShowLogo: z.coerce.boolean().default(true),
  headerShowSiteName: z.coerce.boolean().default(true),
  headerShowMenu: z.coerce.boolean().default(true),
  headerShowMarkets: z.coerce.boolean().default(true),
  headerMenuGap: optionalLength,
  headerMenuSize: optionalFontSize,
  headerMenuWeight: optionalWeight,
  headerMenuTransform: z
    .enum(['none', 'uppercase', 'lowercase', 'capitalize'])
    .catch('none')
    .default('none'),
  headerLogoHeight: optionalLength,
  headerLogoHeightMobile: optionalLength,
  headerLogoMaxWidth: optionalLength,
  announcementBgColor: optionalColor,
  announcementTextColor: optionalColor,

  /*
   * The header buttons. An icon name is checked against the shipped set here
   * as well as at render, so a value that would show nothing is rejected while
   * the administrator is still looking at the field.
   */
  headerCtaIcon: iconName,
  headerCtaIconSide: z.enum(['left', 'right']).catch('left').default('left'),
  headerCtaVariant: buttonVariant.catch('primary').default('primary'),
  headerSecondaryCtaIcon: iconName,
  headerSecondaryCtaIconSide: z.enum(['left', 'right']).catch('left').default('left'),
  headerSecondaryCtaVariant: buttonVariant.catch('ghost').default('ghost'),


  defaultCurrency: z.string().trim().length(3),
  maintenanceMode: z.coerce.boolean().default(false),
});

/** Keeps a font family safe to interpolate into CSS. */
function cleanFontName(value: string): string {
  return value.replace(/["'`;{}<>()\\]/g, '').trim().slice(0, 80);
}

export async function saveWebsiteSettings(formData: FormData): Promise<ActionResult> {
  try {
    const user = await authorize('settings.manage');
    const raw = Object.fromEntries(formData.entries()) as Record<string, string>;

    const input = websiteSettingsSchema.parse({
      ...raw,
      announcementEnabled: raw.announcementEnabled === 'true',
      maintenanceMode: raw.maintenanceMode === 'true',
      headerBorder: raw.headerBorder !== 'false',
      headerSticky: raw.headerSticky !== 'false',
      headerGlassEdge: raw.headerGlassEdge === 'true',
      /*
       * The show/hide toggles, all of which default on. `!== 'false'` rather
       * than `=== 'true'`: a form that never rendered the tab, or a caller
       * that omits the key, must not switch a part of the site off.
       */
      ...Object.fromEntries(
        CHROME_TOGGLES.map((key) => [key, raw[key] !== 'false'] as const),
      ),
    });

    // URL-ish fields are normalised through the same guard the renderer uses,
    // so a javascript: value can never reach an href.
    const data = {
      ...input,
      siteName: sanitizeText(input.siteName),
      siteTitle: sanitizeText(input.siteTitle),
      siteDescription: sanitizeText(input.siteDescription),
      address: input.address ? sanitizeText(input.address) : null,
      // An empty select means "no form", which is the same as off.
      announcementText: input.announcementText ? sanitizeText(input.announcementText) : null,
      announcementUrl: safeUrl(input.announcementUrl),
      headerCtaUrl: safeUrl(input.headerCtaUrl),
      headerSecondaryCtaUrl: safeUrl(input.headerSecondaryCtaUrl),
      linkedinUrl: safeUrl(input.linkedinUrl),
      twitterUrl: safeUrl(input.twitterUrl),
      facebookUrl: safeUrl(input.facebookUrl),
      instagramUrl: safeUrl(input.instagramUrl),
      youtubeUrl: safeUrl(input.youtubeUrl),
      logoUrl: safeUrl(input.logoUrl),
      logoDarkUrl: safeUrl(input.logoDarkUrl),
      faviconUrl: safeUrl(input.faviconUrl),
      ogImageUrl: safeUrl(input.ogImageUrl),
      defaultCurrency: input.defaultCurrency.toUpperCase(),
      // Font names are interpolated into a CSS custom property, so strip any
      // character that could end the declaration early.
      headingFont: cleanFontName(input.headingFont),
      bodyFont: cleanFontName(input.bodyFont),
      navFont: cleanFontName(input.navFont),
      buttonFont: cleanFontName(input.buttonFont),
    };

    await prisma.websiteSettings.upsert({
      where: { id: 'singleton' },
      update: data,
      create: { id: 'singleton', ...data },
    });

    await recordAudit({
      actor: user,
      action: 'updated',
      entity: 'WebsiteSettings',
      summary: 'Updated website settings',
    });

    // Colours, fonts and the header are all read in the root layout.
    revalidatePath('/', 'layout');
    revalidatePath('/admin', 'layout');
    return success(undefined, 'Website settings saved.');
  } catch (error) {
    return toActionError(error);
  }
}

const emailSettingsSchema = z.object({
  host: optional(200),
  port: z.coerce.number().int().min(1).max(65535).default(587),
  username: optional(200),
  password: z.string().max(300).optional().nullable(),
  encryption: z.enum(['none', 'tls', 'ssl']).default('tls'),
  fromName: z.string().trim().min(1, 'A sender name is required').max(120),
  fromEmail: optional(200),
  replyTo: optional(200),
  notifyOnNewLead: z.coerce.boolean().default(true),
  notifyOnAssignment: z.coerce.boolean().default(true),
  notifyOnSubmission: z.coerce.boolean().default(false),
  salesNotificationEmails: optional(600),
  isEnabled: z.coerce.boolean().default(false),
});

export async function saveEmailSettings(formData: FormData): Promise<ActionResult> {
  try {
    const user = await authorize('settings.manage');
    const raw = Object.fromEntries(formData.entries()) as Record<string, string>;

    const input = emailSettingsSchema.parse({
      ...raw,
      notifyOnNewLead: raw.notifyOnNewLead === 'true',
      notifyOnAssignment: raw.notifyOnAssignment === 'true',
      notifyOnSubmission: raw.notifyOnSubmission === 'true',
      isEnabled: raw.isEnabled === 'true',
    });

    if (input.isEnabled && !input.host) {
      return failure('Enter an SMTP host before enabling email.', { host: ['Required to send email'] });
    }
    if (input.isEnabled && !input.fromEmail) {
      return failure('Enter a from address before enabling email.', {
        fromEmail: ['Required to send email'],
      });
    }

    const { password, ...rest } = input;

    // An empty password field means "leave the stored one alone" — the current
    // value is never sent to the browser, so it cannot be echoed back.
    const data = {
      ...rest,
      ...(password ? { password: encryptSecret(password) } : {}),
    };

    await prisma.emailSettings.upsert({
      where: { id: 'singleton' },
      update: data,
      create: { id: 'singleton', ...data },
    });

    await recordAudit({
      actor: user,
      action: 'updated',
      entity: 'EmailSettings',
      summary: `Updated SMTP settings (${input.isEnabled ? 'enabled' : 'disabled'})`,
    });

    revalidatePath('/admin/settings/email');
    return success(undefined, 'Email settings saved.');
  } catch (error) {
    return toActionError(error);
  }
}

export async function testSmtpConnection(): Promise<ActionResult> {
  try {
    await authorize('settings.manage');
    const result = await verifySmtp();
    if (!result.sent) return failure(result.reason ?? 'Could not connect to the SMTP server.');
    return success(undefined, 'Connected to the SMTP server successfully.');
  } catch (error) {
    return toActionError(error);
  }
}

const testEmailSchema = z.object({ to: z.string().trim().email('Enter a valid email address') });

export async function sendTestEmail(input: unknown): Promise<ActionResult> {
  try {
    const user = await authorize('settings.manage');
    const { to } = testEmailSchema.parse(input);

    const result = await sendMail({
      to,
      subject: 'Test email from your website',
      html: `<p>This is a test message sent from your website's admin panel by ${sanitizeText(user.name)}.</p>
<p>If you received it, SMTP is configured correctly and lead notifications will be delivered.</p>`,
    });

    if (!result.sent) return failure(result.reason ?? 'The test email could not be sent.');
    return success(undefined, `Test email sent to ${to}.`);
  } catch (error) {
    return toActionError(error);
  }
}

const templateSchema = z.object({
  key: z.string().min(1).max(60),
  subject: z.string().trim().min(1, 'A subject is required').max(300),
  body: z.string().trim().min(1, 'A body is required').max(20_000),
  isActive: z.coerce.boolean().default(true),
});

export async function saveEmailTemplate(input: unknown): Promise<ActionResult> {
  try {
    const user = await authorize('settings.manage');
    const parsed = templateSchema.parse(input);

    const existing = await prisma.emailTemplate.findUnique({ where: { key: parsed.key } });
    if (!existing) return failure('That template does not exist.');

    await prisma.emailTemplate.update({
      where: { key: parsed.key },
      data: { subject: parsed.subject, body: parsed.body, isActive: parsed.isActive },
    });

    await recordAudit({
      actor: user,
      action: 'updated',
      entity: 'EmailTemplate',
      entityId: existing.id,
      summary: `Updated the “${existing.name}” email template`,
    });

    revalidatePath('/admin/settings/email');
    return success(undefined, 'Template saved.');
  } catch (error) {
    return toActionError(error);
  }
}

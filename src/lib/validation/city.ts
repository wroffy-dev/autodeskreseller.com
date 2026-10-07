import { z } from 'zod';
import { isValidSegment } from '@/lib/urls/path';
import { slugify } from '@/lib/utils/slug';
import { primaryKeywordShape, rejectDuplicateKeywords } from '@/lib/seo/keywords';
import { CITY_STATUSES } from '@/lib/cities/status';

/**
 * City validation.
 *
 * Everything here runs on the server, in the action, against what the form
 * sent — the browser's checks are a convenience, never the rule. What cannot
 * be decided from the input alone (whether the slug's address space is free,
 * whether the user may work in the market) is the action's job.
 *
 * A city's name and region are written into generated pages by the
 * `{{city}}` and `{{region}}` placeholders, where they can land in
 * text, in HTML and inside attribute values. They are therefore limited to
 * characters that are safe in all three: no angle brackets, braces, double
 * quotes or backticks.
 */

const UNSAFE = /[<>{}"`\\\u0000-\u001f\u007f]/;
const UNSAFE_MESSAGE = 'Use letters, numbers, spaces and simple punctuation — not < > { } " ` or \\.';

const optional = (max: number) =>
  z
    .string()
    .max(max, `Use ${max} characters or fewer.`)
    .optional()
    .nullable()
    .transform((value) => (value?.trim() ? value.trim() : null));

const safeOptional = (max: number) =>
  optional(max).refine((value) => value === null || !UNSAFE.test(value), UNSAFE_MESSAGE);

/**
 * A switch as a form submits it: only an explicit yes counts as yes, and a
 * missing value keeps the default. (`z.coerce.boolean()` would read the string
 * "false" as true.)
 */
const formBoolean = (fallback: boolean) =>
  z.preprocess((value) => {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'boolean') return value;
    return ['true', 'on', '1'].includes(String(value).trim().toLowerCase());
  }, z.boolean());

const PHONE = /^[+0-9()\-.\s]{3,40}$/;

const phone = optional(40).refine((value) => value === null || PHONE.test(value), {
  message: 'Use digits, spaces and + ( ) - only.',
});

const coordinate = (limit: number, label: string) =>
  optional(24).refine(
    (value) => {
      if (value === null) return true;
      if (!/^-?\d{1,3}(\.\d{1,10})?$/.test(value)) return false;
      const number = Number(value);
      return Number.isFinite(number) && Math.abs(number) <= limit;
    },
    { message: `Enter a ${label} between -${limit} and ${limit}, e.g. ${limit === 90 ? '28.6139' : '77.2090'}.` },
  );

export const MAX_CITY_SLUG_LENGTH = 80;

/**
 * A city's slug: one URL segment. It becomes the first segment of every
 * address in the city, so it follows the same rules as any path segment.
 */
export const citySlugSchema = z
  .string()
  .max(200)
  .transform((value) => value.trim().toLowerCase().replace(/^\/+|\/+$/g, ''))
  .refine((value) => value.length > 0, { message: 'Enter a slug, e.g. delhi.' })
  .refine((value) => !value.includes('/'), {
    message: 'A city slug is one segment — no slashes. Pages inside the city get their own segments after it.',
  })
  .refine((value) => value.length <= MAX_CITY_SLUG_LENGTH, {
    message: `Keep the slug under ${MAX_CITY_SLUG_LENGTH} characters.`,
  })
  .refine(
    (value) =>
      value.length === 0 || value.length > MAX_CITY_SLUG_LENGTH || value.includes('/') || isValidSegment(value),
    { message: 'Use lower-case letters, numbers and hyphens, starting and ending with a letter or number.' },
  );

/** The slug a city name suggests: "New Delhi" → "new-delhi". */
export function suggestCitySlug(name: string): string {
  return slugify(name).slice(0, MAX_CITY_SLUG_LENGTH).replace(/-+$/, '');
}

export const cityInputSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Name is required')
      .max(120, 'Use 120 characters or fewer.')
      .refine((value) => !UNSAFE.test(value), UNSAFE_MESSAGE),
    slug: citySlugSchema,
    /** Optional free text. Nothing requires a region. */
    region: safeOptional(120),
    /** New cities are drafts: nothing in them is public until they are published. */
    status: z.enum(CITY_STATUSES).default('DRAFT'),
    sortOrder: z.coerce.number().int().min(0).max(9999).default(0),

    salesPhone: phone,
    whatsappNumber: phone,
    salesEmail: optional(200).refine(
      (value) => value === null || z.email().safeParse(value).success,
      { message: 'Enter a valid email address.' },
    ),
    address: optional(600),
    postalCode: optional(24),
    latitude: coordinate(90, 'latitude'),
    longitude: coordinate(180, 'longitude'),

    seoTitle: optional(200),
    seoDescription: optional(400),
    ...primaryKeywordShape,
    noIndex: formBoolean(false),
    excludeFromSitemap: formBoolean(false),
  })
  .superRefine(rejectDuplicateKeywords)
  .superRefine((data, ctx) => {
    // Coordinates only mean something as a pair.
    if ((data.latitude === null) !== (data.longitude === null)) {
      ctx.addIssue({
        code: 'custom',
        path: [data.latitude === null ? 'latitude' : 'longitude'],
        message: 'Enter both latitude and longitude, or neither.',
      });
    }
  });

export type CityInput = z.infer<typeof cityInputSchema>;

/** The optional landing page a new city can be created with. */
export const cityLandingSchema = z.object({
  createLanding: formBoolean(false),
  /** May use the city placeholders; `{{city.name}}` when left blank. */
  landingTitle: optional(200),
});

/** Creating a landing page later, for a city that has none. */
export const createLandingSchema = z.object({
  cityId: z.string().min(1).max(40),
  title: optional(200),
});

export const cityIdSchema = z.object({ cityId: z.string().min(1).max(40) });

export const cityStatusSchema = z.object({
  cityId: z.string().min(1).max(40),
  status: z.enum(CITY_STATUSES),
});

/** The largest number of cities one generator request handles; the screen sends larger runs in parts. */
export const MAX_CITIES_PER_REQUEST = 25;

export const generatorPreviewSchema = z.object({
  sourcePageId: z.string().min(1).max(40),
  countryId: z.string().min(1).max(40),
  cityIds: z.array(z.string().min(1).max(40)).min(1, 'Choose at least one city.').max(500),
  /** The generated pages' title; may use placeholders. Blank keeps the source's title. */
  titleTemplate: optional(200),
  /**
   * The product the pages are about, for city/product pages such as
   * `/delhi/autocad`: recorded as an explicit association and offered as the
   * `{{product}}` placeholder. Optional.
   */
  productId: z.string().min(1).max(40).optional().nullable(),
  /**
   * Cities whose existing page at the address should be regenerated from the
   * source — chosen one by one after the impact preview. Every other existing
   * page is left exactly as it is.
   */
  replaceCityIds: z.array(z.string().min(1).max(40)).max(500).default([]),
});

export const generatorRunSchema = generatorPreviewSchema.extend({
  cityIds: z
    .array(z.string().min(1).max(40))
    .min(1, 'Choose at least one city.')
    .max(MAX_CITIES_PER_REQUEST, `Send at most ${MAX_CITIES_PER_REQUEST} cities per request.`),
  /** Continues a run the screen is sending in parts. */
  batchId: z.string().min(1).max(40).optional().nullable(),
  /**
   * Must be true whenever `replaceCityIds` names a city: regenerating replaces
   * the content of a page somebody may have edited.
   */
  confirmReplace: z.boolean().default(false),
});

export const generatorSourceSearchSchema = z.object({
  countryId: z.string().min(1).max(40),
  q: z.string().max(120).optional().default(''),
});

export const citySlugCheckSchema = z.object({
  countryId: z.string().min(1).max(40),
  slug: z.string().max(200),
  cityId: z.string().min(1).max(40).optional().nullable(),
});

// ---------------------------------------------------------------------------
// Bulk city import
// ---------------------------------------------------------------------------

/** The largest number of cities one import request creates; the screen sends larger files in parts. */
export const MAX_CITIES_PER_IMPORT_REQUEST = 25;
/** The largest file the city import reads. */
export const MAX_CITY_IMPORT_ROWS = 2_000;

export const cityImportPreviewSchema = z.object({
  text: z.string().min(1, 'Choose a file or paste the CSV.').max(1_000_000, 'That file is larger than 1 MB. Import it in parts.'),
  /** Create a draft landing page for every new city, with this title (placeholders allowed). */
  createLanding: z.boolean().default(false),
  landingTitle: optional(200),
});

export const cityImportRunSchema = cityImportPreviewSchema.extend({
  fingerprint: z.string().min(1).max(64),
  /** File lines to create in this request, in order. */
  lines: z
    .array(z.number().int().min(2).max(MAX_CITY_IMPORT_ROWS + 1))
    .min(1)
    .max(MAX_CITIES_PER_IMPORT_REQUEST, `Send at most ${MAX_CITIES_PER_IMPORT_REQUEST} cities per request.`),
});

/** The sample offered for download on the import screen. */
export const CITY_IMPORT_SAMPLE = [
  'Name,Slug,Country,Region,Status',
  'Delhi,delhi,IN,,DRAFT',
  'Gurugram,gurugram,IN,Haryana,DRAFT',
  'Dubai,dubai,AE,,DRAFT',
].join('\r\n').concat('\r\n');

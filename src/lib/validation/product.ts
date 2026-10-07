import { z } from 'zod';
import { slugify } from '@/lib/utils/slug';
import { primaryKeywordShape, rejectDuplicateKeywords } from '@/lib/seo/keywords';

const optional = (max: number) =>
  z
    .string()
    .max(max)
    .transform((v) => v.trim())
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

/** Money arrives as a string from the form and never touches JS floats. */
const money = z
  .string()
  .max(20)
  .optional()
  .nullable()
  .transform((v) => (v && v.trim() ? v.replace(/[,\s]/g, '') : null))
  .refine((v) => v === null || /^\d+(\.\d{1,2})?$/.test(v), 'Enter an amount like 1250 or 1250.00');

const intField = (min: number, max: number) =>
  z
    .string()
    .optional()
    .nullable()
    .transform((v) => (v && v.trim() ? Number(v) : null))
    .refine(
      (v) => v === null || (Number.isInteger(v) && v >= min && v <= max),
      `Enter a whole number between ${min} and ${max}`,
    );

export const productInputSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(200),
    slug: z
      .string()
      .max(200)
      .transform((v) => slugify(v)),
    sku: optional(60),
    status: z.enum(['DRAFT', 'PUBLISHED', 'SCHEDULED', 'ARCHIVED']).default('DRAFT'),
    publishedAt: z
      .string()
      .optional()
      .nullable()
      .transform((v) => (v ? new Date(v) : null))
      .refine((d) => d === null || !Number.isNaN(d.getTime()), 'Enter a valid date'),
    isFeatured: z.coerce.boolean().default(false),
    sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
    /** Position within the featured rail, independent of the catalogue order. */
    featuredOrder: z.coerce.number().int().min(0).max(9999).default(0),

    shortDescription: optional(500),
    description: optional(20000),

    storage: optional(60),
    minUsers: intField(0, 1_000_000),
    maxUsers: intField(0, 1_000_000),
    billingPeriod: z.enum(['MONTHLY', 'ANNUAL', 'BOTH', 'ONE_TIME']).default('BOTH'),

    currency: z.string().length(3).default('INR'),
    monthlyPrice: money,
    annualPrice: money,
    compareAtPrice: money,
    discountPercent: intField(0, 100),
    priceSuffix: optional(80),
    priceNote: optional(120),

    features: z.array(z.string().max(300)).max(40).default([]),
    benefits: z.array(z.string().max(300)).max(40).default([]),
    specs: z
      .array(z.object({ label: z.string().max(80), value: z.string().max(160) }))
      .max(30)
      .default([]),

    ctaLabel: optional(60),
    ctaUrl: optional(500),
    ctaFormId: optional(40),

    imageId: optional(40),
    galleryIds: z.array(z.string().max(40)).max(20).default([]),
    categoryId: optional(40),
    brandId: optional(40),

    seoTitle: optional(200),
    seoDescription: optional(400),
    canonicalUrl: optional(500),
    noIndex: z.coerce.boolean().default(false),
    ogImageId: optional(40),

    ...primaryKeywordShape,
  })
  .refine(
    (data) => data.minUsers === null || data.maxUsers === null || data.maxUsers >= data.minUsers,
    { message: 'Maximum users must be at least the minimum', path: ['maxUsers'] },
  )
  .refine((data) => data.status !== 'SCHEDULED' || data.publishedAt !== null, {
    message: 'A scheduled product needs a publish date',
    path: ['publishedAt'],
  })
  .superRefine(rejectDuplicateKeywords);

export type ProductInput = z.infer<typeof productInputSchema>;

export const productCategorySchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  slug: z
    .string()
    .max(160)
    .transform((v) => slugify(v)),
  description: optional(1000),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
  imageId: optional(40),
});

export const brandSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  slug: z
    .string()
    .max(160)
    .transform((v) => slugify(v)),
  description: optional(1000),
  websiteUrl: optional(300),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
  logoId: optional(40),
});

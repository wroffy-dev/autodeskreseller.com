import { z } from 'zod';
import { slugify } from '@/lib/utils/slug';
import { blogPostOptionsSchema } from '@/lib/cms/blog-settings';
import { primaryKeywordShape, rejectDuplicateKeywords } from '@/lib/seo/keywords';

const optional = (max: number) =>
  z
    .string()
    .max(max)
    .transform((v) => v.trim())
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

export const blogPostSchema = z
  .object({
    title: z.string().trim().min(1, 'Title is required').max(240),
    slug: z
      .string()
      .max(240)
      .transform((v) => slugify(v)),
    status: z.enum(['DRAFT', 'PUBLISHED', 'SCHEDULED', 'ARCHIVED']).default('DRAFT'),
    publishedAt: z
      .string()
      .optional()
      .nullable()
      .transform((v) => (v ? new Date(v) : null))
      .refine((d) => d === null || !Number.isNaN(d.getTime()), 'Enter a valid date'),
    subtitle: optional(240),
    excerpt: optional(600),
    content: z.string().max(200_000).default(''),
    isFeatured: z.coerce.boolean().default(false),
    /** Lower sorts first among featured posts. */
    featuredPriority: z.coerce.number().int().min(0).max(9999).default(0),
    featuredImageId: optional(40),
    thumbnailId: optional(40),
    categoryId: optional(40),
    authorId: optional(40),
    tags: z.array(z.string().max(60)).max(20).default([]),
    relatedIds: z.array(z.string().max(40)).max(6).default([]),

    /** Per-post display overrides and form choices. */
    options: blogPostOptionsSchema,
    sidebarMode: z.enum(['GLOBAL', 'CUSTOM', 'NONE']).catch('GLOBAL').default('GLOBAL'),

    seoTitle: optional(240),
    seoDescription: optional(400),
    focusKeyword: optional(120),
    canonicalUrl: optional(500),
    noIndex: z.coerce.boolean().default(false),
    noFollow: z.coerce.boolean().default(false),
    ogTitle: optional(240),
    ogDescription: optional(400),
    ogImageId: optional(40),
    twitterImageId: optional(40),

    /** The first replaces `focusKeyword`, which the action keeps equal to it. */
    ...primaryKeywordShape,
  })
  .refine((data) => data.status !== 'SCHEDULED' || data.publishedAt !== null, {
    message: 'A scheduled post needs a publish date',
    path: ['publishedAt'],
  })
  .superRefine(rejectDuplicateKeywords);

export const blogCategorySchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  isActive: z.coerce.boolean().default(true),
  /** Optional parent, e.g. Microsoft → Azure. Empty means top level. */
  parentId: z
    .string()
    .max(40)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null)),
  slug: z
    .string()
    .max(160)
    .transform((v) => slugify(v)),
  description: optional(1000),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
  imageId: optional(40),
  bannerImageId: optional(40),
  archiveTitle: optional(240),
  archiveDescription: optional(1000),
  seoTitle: optional(240),
  seoDescription: optional(400),
  canonicalUrl: optional(500),
  ogTitle: optional(240),
  ogDescription: optional(400),
  ogImageId: optional(40),
  noIndex: z.coerce.boolean().default(false),
  noFollow: z.coerce.boolean().default(false),
  ...primaryKeywordShape,
}).superRefine(rejectDuplicateKeywords);

/** A blog tag. Slug uniqueness is enforced in the action. */
export const blogTagSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  slug: z
    .string()
    .max(120)
    .transform((v) => slugify(v)),
  description: optional(1000),
  isActive: z.coerce.boolean().default(true),
  seoTitle: optional(240),
  seoDescription: optional(400),
  canonicalUrl: optional(500),
  noIndex: z.coerce.boolean().default(false),
});

export type BlogTagInput = z.infer<typeof blogTagSchema>;

export const blogCategoryOrderSchema = z.object({
  ids: z.array(z.string().min(1)).max(500),
});

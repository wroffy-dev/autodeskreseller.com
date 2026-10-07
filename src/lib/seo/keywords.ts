import { z } from 'zod';

/**
 * Primary keywords.
 *
 * A page, a product, a product's market version, an article and a blog
 * category can each name up to three keywords they are written for. They are
 * internal optimisation targets: SEO Intelligence looks for them in the title,
 * the description, the URL, the headings and the copy, and reports where they
 * are missing or overused.
 *
 * They are analysis inputs and nothing else: no `<meta name="keywords">` tag
 * is emitted (search engines have ignored it for ranking for years, and it
 * would only publish what each page targets), and no check claims that any
 * keyword markup improves rankings.
 *
 * Pure and dependency-free apart from Zod, so the editors, the server actions
 * and the scoring engine share one definition of "the same keyword".
 */

export const PRIMARY_KEYWORD_FIELDS = [
  'primaryKeyword1',
  'primaryKeyword2',
  'primaryKeyword3',
] as const;

export type PrimaryKeywordField = (typeof PRIMARY_KEYWORD_FIELDS)[number];

export type PrimaryKeywordValues = Partial<
  Record<PrimaryKeywordField, string | null | undefined>
>;

/** Long enough for any real search phrase, short enough to stay a phrase. */
export const MAX_KEYWORD_LENGTH = 100;

/** Trimmed, with every run of whitespace collapsed to one space. */
export function cleanKeyword(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * The comparison key for a keyword.
 *
 * Case, accents and spacing never make two keywords different: "Cloud
 * Storage", "cloud  storage" and "clóud storage" are one keyword.
 */
export function keywordKey(value: unknown): string {
  return cleanKeyword(value)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/** The keywords a record carries, in order, blanks and repeats dropped. */
export function primaryKeywords(record: PrimaryKeywordValues | null | undefined): string[] {
  if (!record) return [];
  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const field of PRIMARY_KEYWORD_FIELDS) {
    const keyword = cleanKeyword(record[field]);
    const key = keywordKey(keyword);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    keywords.push(keyword);
  }
  return keywords;
}

/**
 * The fields that repeat an earlier one, with the position they repeat.
 *
 * The later of each pair is reported, so the keyword somebody typed first
 * keeps its place and the duplicate is the one flagged.
 */
export function duplicateKeywordFields(
  record: PrimaryKeywordValues,
): Array<{ field: PrimaryKeywordField; repeats: number }> {
  const firstSeen = new Map<string, number>();
  const duplicates: Array<{ field: PrimaryKeywordField; repeats: number }> = [];
  PRIMARY_KEYWORD_FIELDS.forEach((field, index) => {
    const key = keywordKey(record[field]);
    if (!key) return;
    const earlier = firstSeen.get(key);
    if (earlier === undefined) firstSeen.set(key, index + 1);
    else duplicates.push({ field, repeats: earlier });
  });
  return duplicates;
}

/** The message a repeated keyword gets, in the editor and from the server. */
export function duplicateKeywordMessage(repeats: number): string {
  return `This repeats primary keyword ${repeats}. Use a different phrase or leave it blank.`;
}

/** One keyword field: blank is allowed and stored as null. */
export const primaryKeywordField = z
  .string()
  .max(MAX_KEYWORD_LENGTH * 2)
  .optional()
  .nullable()
  .transform((value) => cleanKeyword(value) || null)
  .refine((value) => value === null || value.length <= MAX_KEYWORD_LENGTH, {
    message: `Keep a keyword under ${MAX_KEYWORD_LENGTH} characters.`,
  });

/** The three fields, for spreading into an entity schema's shape. */
export const primaryKeywordShape = {
  primaryKeyword1: primaryKeywordField,
  primaryKeyword2: primaryKeywordField,
  primaryKeyword3: primaryKeywordField,
};

/**
 * Rejects an accidental duplicate.
 *
 * Used as a `superRefine` on every schema that carries keywords, so the
 * error lands on the field that repeats, the same way the editor shows it.
 */
export function rejectDuplicateKeywords(data: PrimaryKeywordValues, ctx: z.RefinementCtx): void {
  for (const duplicate of duplicateKeywordFields(data)) {
    ctx.addIssue({
      code: 'custom',
      path: [duplicate.field],
      message: duplicateKeywordMessage(duplicate.repeats),
    });
  }
}

/** Reads the three fields from a submitted form. */
export function keywordsFromForm(formData: FormData): Record<PrimaryKeywordField, string> {
  return {
    primaryKeyword1: String(formData.get('primaryKeyword1') ?? ''),
    primaryKeyword2: String(formData.get('primaryKeyword2') ?? ''),
    primaryKeyword3: String(formData.get('primaryKeyword3') ?? ''),
  };
}

/** The three fields as a record stores them: cleaned, blank as null. */
export function keywordColumns(
  record: PrimaryKeywordValues | null | undefined,
): Record<PrimaryKeywordField, string | null> {
  return {
    primaryKeyword1: cleanKeyword(record?.primaryKeyword1) || null,
    primaryKeyword2: cleanKeyword(record?.primaryKeyword2) || null,
    primaryKeyword3: cleanKeyword(record?.primaryKeyword3) || null,
  };
}

/**
 * A market's keywords, or the product's when the market set none.
 *
 * All three blank on the market row means "use the shared ones"; any one set
 * means the market chose its own, and only those apply there.
 */
export function effectiveKeywords(
  market: PrimaryKeywordValues | null | undefined,
  shared: PrimaryKeywordValues | null | undefined,
): { keywords: string[]; source: 'market' | 'shared' | 'none' } {
  const own = primaryKeywords(market);
  if (own.length > 0) return { keywords: own, source: 'market' };
  const inherited = primaryKeywords(shared);
  return { keywords: inherited, source: inherited.length > 0 ? 'shared' : 'none' };
}

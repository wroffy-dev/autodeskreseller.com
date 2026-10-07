/**
 * SEO Intelligence — the shared vocabulary.
 *
 * Everything the scoring engine reads is a `SeoDocument`: a plain,
 * serialisable description of one public URL as the site actually renders it —
 * its metadata, its visible content, the structured data it emits and how it
 * is indexed. The engine never touches the database; the server builds
 * documents from saved content (or from an editor's unsaved draft), and the
 * engine turns a document into scores. The same document always gets the same
 * scores.
 *
 * Scores are internal optimisation indicators. They are not issued by Google,
 * Bing or any AI platform, and nothing here claims to predict rankings or
 * inclusion in AI answers.
 */

/** Bumped whenever a check changes, so every cached score is recalculated. */
export const SEO_ENGINE_VERSION = '1.0.0';

/** What the dashboard lists: one row per public URL. */
export type SeoEntityType =
  | 'PAGE'
  | 'PRODUCT_MARKET'
  | 'BLOG_POST'
  | 'BLOG_CATEGORY'
  | 'BLOG_TAG'
  | 'BLOG_ARCHIVE';

export const SEO_ENTITY_TYPES: readonly SeoEntityType[] = [
  'PAGE',
  'PRODUCT_MARKET',
  'BLOG_POST',
  'BLOG_CATEGORY',
  'BLOG_TAG',
  'BLOG_ARCHIVE',
];

/** What kind of page a URL is. Checks declare which kinds they apply to. */
export type SeoPageKind =
  | 'homepage'
  | 'page'
  | 'product'
  | 'article'
  | 'category'
  | 'tag'
  | 'archive';

export const SEO_PAGE_KINDS: readonly SeoPageKind[] = [
  'homepage',
  'page',
  'product',
  'article',
  'category',
  'tag',
  'archive',
];

export type SeoDimension = 'seo' | 'aeo' | 'geo';

export type CheckStatus = 'PASS' | 'WARNING' | 'FAIL' | 'INFO' | 'NOT_APPLICABLE';

/** How much a check that did not pass matters. */
export type CheckSeverity = 'critical' | 'improvement' | 'suggestion';

export type CheckCategory =
  | 'metadata'
  | 'content'
  | 'keywords'
  | 'url'
  | 'social'
  | 'technical'
  | 'indexability'
  | 'structuredData'
  | 'images'
  | 'links'
  | 'answers'
  | 'entities'
  | 'trust'
  | 'readability';

export const CHECK_CATEGORY_LABELS: Record<CheckCategory, string> = {
  metadata: 'Metadata',
  content: 'Content',
  keywords: 'Primary keywords',
  url: 'URL',
  social: 'Social metadata',
  technical: 'Technical SEO',
  indexability: 'Indexability',
  structuredData: 'Structured data',
  images: 'Images',
  links: 'Links',
  answers: 'Answers',
  entities: 'Entities',
  trust: 'Trust and attribution',
  readability: 'Readability',
};

/**
 * Where an editor fixes something.
 *
 * `field` is the id of the input on the editor, so a click on an issue can
 * scroll to and focus it; `area` names the part of the editor it lives in
 * when there is no single field (the page's sections, say).
 */
export type SeoFieldTarget = {
  field?: string;
  area?: 'general' | 'seo' | 'social' | 'content' | 'sections' | 'media' | 'organise' | 'pricing';
};

// ---------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------

export type ContentImage = {
  type: 'image';
  src: string | null;
  alt: string;
  /** Deliberately hidden from assistive technology (a backdrop, an icon). */
  decorative: boolean;
  width?: number | null;
  height?: number | null;
  bytes?: number | null;
  mimeType?: string | null;
  /** Which section it came from, for recommendations. */
  source?: string;
};

export type ContentLink = {
  type: 'link';
  href: string;
  text: string;
  source?: string;
};

/**
 * One piece of visible content, in reading order.
 *
 * Headings, paragraphs, lists and tables are what the page says; images and
 * links are what it shows and where it leads; `faq` is a question and answer
 * the page presents as such; `collection` stands for cards the page fills from
 * the catalogue or the blog at render time — counted as links, never scored as
 * copy the editor wrote.
 */
export type ContentNode =
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; text: string; source?: string }
  | { type: 'paragraph'; text: string; source?: string }
  | { type: 'list'; ordered: boolean; items: string[]; source?: string }
  | { type: 'table'; rows: string[][]; caption?: string; source?: string }
  | { type: 'faq'; question: string; answer: string; source?: string }
  | { type: 'collection'; of: 'products' | 'posts' | 'categories'; count: number; source?: string }
  | ContentImage
  | ContentLink;

export type JsonLd = Record<string, unknown>;

export type SeoCountryRef = {
  id: string;
  code: string;
  name: string;
  slug: string;
  locale: string;
  currency: string;
  isDefault: boolean;
  isActive: boolean;
  isPublished: boolean;
};

export type SeoDocument = {
  entityType: SeoEntityType;
  entityId: string;
  kind: SeoPageKind;
  /** What the admin calls it: the page title, product name, article title. */
  name: string;
  country: SeoCountryRef;
  /** The URL path as served, market prefix included. */
  path: string;
  /** The slug the editor controls ("" for a homepage). */
  slug: string;
  absoluteUrl: string;
  /** Where the editor for this URL lives. */
  editPath: string;

  status: {
    value: 'PUBLISHED' | 'DRAFT' | 'SCHEDULED' | 'ARCHIVED';
    /** Actually served to visitors right now. */
    live: boolean;
    publishedAt: string | null;
    /** Why a published record is still not served, e.g. its market is switched off. */
    notServedReason?: string | null;
  };
  updatedAt: string;

  meta: {
    /** The <title> as served, template applied. */
    title: string;
    /** Before the template: what the editor typed, or what it fell back to. */
    ownTitle: string;
    titleSource: 'seo' | 'fallback' | 'default';
    description: string;
    descriptionSource: 'seo' | 'fallback' | 'default';
    canonical: {
      /** What an editor typed, if anything. */
      explicit: string | null;
      /** The canonical the page serves. */
      effective: string;
      /** The page's own absolute URL. */
      self: string;
      /** The market an explicit canonical points into, when it is not this one. */
      otherMarket: string | null;
    };
    keywords: string[];
    /** Whose keywords apply: this record's, a product's shared ones, or none. */
    keywordsSource: 'own' | 'shared' | 'city' | 'none';
    /** A market that overrides the shared SEO fields, named for messages. */
    overrides?: Array<'title' | 'description' | 'canonical' | 'keywords'>;
  };

  robots: {
    noIndex: boolean;
    noFollow: boolean;
    /** Why it is noindex, when it is. Every one of these is deliberate. */
    noIndexReasons: Array<'entity' | 'shared' | 'city' | 'market' | 'site' | 'blog'>;
    inSitemap: boolean;
    /** Why a live, indexable URL is missing from the sitemap. */
    sitemapExclusion: string | null;
    blockedByRobots: boolean;
    blockingRule: string | null;
  };

  social: {
    ogTitle: string;
    ogTitleExplicit: boolean;
    ogDescription: string;
    ogDescriptionExplicit: boolean;
    ogImage: { url: string; source: 'entity' | 'fallback' | 'default' } | null;
    twitterCard: 'summary' | 'summary_large_image';
    twitterSite: string | null;
    twitterTitleExplicit: boolean;
  };

  content: ContentNode[];
  /** Every JSON-LD object the page emits, site-wide ones included. */
  schema: JsonLd[];

  alternates: {
    /** hreflang locales the page announces (its own included). */
    locales: string[];
    /** Markets that are active and published. */
    indexableMarkets: number;
  };

  entity: {
    siteName: string;
    organizationName: string;
    hasLogo: boolean;
    sameAsCount: number;
    /** Where the business can be found and contacted, in this market. */
    hasAddress: boolean;
    hasPhone: boolean;
    hasEmail: boolean;
    localBusinessType: string | null;
  };

  product?: {
    name: string;
    brand: string | null;
    category: string | null;
    sku: string | null;
    shortDescription: string;
    descriptionWords: number;
    currency: string;
    price: string | null;
    annualPrice: string | null;
    priceNote: string | null;
    storage: string | null;
    users: string | null;
    specs: Array<{ label: string; value: string }>;
    features: string[];
    benefits: string[];
    hasImage: boolean;
    imageAlt: string | null;
    galleryCount: number;
    /** Specifications this page actually shows, in a list or a table. */
    specsVisible: boolean;
  };

  article?: {
    author: { name: string; jobTitle: string | null; url: string | null; bio: boolean } | null;
    authorVisible: boolean;
    publishedAt: string | null;
    updatedAt: string;
    datesVisible: boolean;
    category: string | null;
    tags: string[];
    excerpt: string;
    hasFeaturedImage: boolean;
  };

  archive?: {
    /** Articles the archive lists. */
    itemCount: number;
  };

  /** Other URLs in the same market this one collides with. */
  collisions: {
    title: Array<{ name: string; path: string }>;
    description: Array<{ name: string; path: string }>;
    keyword: Array<{ name: string; path: string; keyword: string }>;
    content: Array<{ name: string; path: string }>;
  };
};

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export type CheckResult = {
  id: string;
  dimension: SeoDimension;
  category: CheckCategory;
  label: string;
  status: CheckStatus;
  severity: CheckSeverity;
  pointsEarned: number;
  pointsAvailable: number;
  message: string;
  recommendation: string | null;
  target?: SeoFieldTarget;
};

export type ScoreBreakdown = {
  score: number;
  maxScore: 100;
  pointsEarned: number;
  pointsAvailable: number;
  checks: CheckResult[];
};

export type KeywordPlacement =
  | 'title'
  | 'description'
  | 'url'
  | 'h1'
  | 'firstParagraph'
  | 'headings'
  | 'body'
  | 'imageAlt';

export const KEYWORD_PLACEMENT_LABELS: Record<KeywordPlacement, string> = {
  title: 'SEO title',
  description: 'Meta description',
  url: 'URL',
  h1: 'H1',
  firstParagraph: 'First meaningful content section',
  headings: 'Subheadings (H2–H3)',
  body: 'Body',
  imageAlt: 'Image alt text',
};

export type KeywordAnalysis = {
  keyword: string;
  position: number;
  placements: Record<KeywordPlacement, boolean | null>;
  occurrences: number;
  /** Share of the body's words the keyword accounts for, as a percentage. */
  density: number;
  status: 'strong' | 'good' | 'weak' | 'missing' | 'overused';
};

export type SchemaTypeAnalysis = {
  type: string;
  present: boolean;
  expected: boolean;
  /** Properties this page's markup is missing that it should carry. */
  missing: string[];
  /** Properties worth adding. */
  recommended: string[];
};

export type SchemaAnalysis = {
  types: string[];
  items: SchemaTypeAnalysis[];
};

export type AuditCounts = {
  critical: number;
  warnings: number;
  suggestions: number;
  passed: number;
  info: number;
  /** Critical + warnings: the things somebody should fix. */
  issues: number;
};

export type AuditFlags = {
  live: boolean;
  /** Live and not noindex. */
  indexable: boolean;
  /** noindex on purpose — never scored down for it. */
  intentionallyExcluded: boolean;
  missingMetadata: boolean;
  missingSchema: boolean;
  missingKeywords: boolean;
  indexingConflict: boolean;
};

export type SeoAuditResult = {
  engineVersion: string;
  entityType: SeoEntityType;
  entityId: string;
  countryId: string;
  kind: SeoPageKind;
  name: string;
  path: string;
  absoluteUrl: string;
  editPath: string;
  overall: number;
  seo: ScoreBreakdown;
  aeo: ScoreBreakdown;
  geo: ScoreBreakdown;
  keywords: KeywordAnalysis[];
  structuredData: SchemaAnalysis;
  counts: AuditCounts;
  flags: AuditFlags;
};

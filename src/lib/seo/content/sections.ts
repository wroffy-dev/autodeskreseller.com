import { parseBlockContent, getBlock } from '@/lib/cms/blocks';
import type { ContentImage, ContentNode } from '../types';
import { htmlToNodes } from './html';

/**
 * A page's sections, read the way they render.
 *
 * Each block type maps to what it actually puts on the page: which of its
 * headings is the `<h1>` (the first section's, for the blocks that promote
 * it), which fields are rich text, which images carry alt text and where the
 * text comes from, and which buttons are links. The rules mirror the block
 * renderers in `components/cms/blocks`; a block this file does not know is
 * read generically from its fields rather than ignored.
 *
 * Cards a block fills at render time — a product grid, a list of articles —
 * become a `collection` node. They are links, not copy the editor wrote.
 */

export type ExtractMedia = {
  url: string;
  altText: string | null;
  width: number | null;
  height: number | null;
  size: number | null;
  mimeType: string | null;
};

export type SectionForExtraction = {
  id: string;
  blockType: string;
  content: unknown;
  isVisible: boolean;
  sortOrder: number;
};

export type ProductFacts = {
  name: string;
  shortDescription: string | null;
  descriptionHtml: string | null;
  categoryName: string | null;
  categoryHref: string | null;
  brandName: string | null;
  brandHref: string | null;
  sku: string | null;
  image: (ExtractMedia & { alt: string }) | null;
  gallery: ExtractMedia[];
  features: string[];
  benefits: string[];
  specs: Array<{ label: string; value: string }>;
  storage: string | null;
  users: string | null;
  currency: string;
  monthlyPrice: string | null;
  annualPrice: string | null;
  compareAtPrice: string | null;
  priceSuffix: string | null;
  priceNote: string | null;
  ctaLabel: string;
  homeHref: string;
  productsHref: string;
};

export type ArticleFacts = {
  title: string;
  subtitle: string | null;
  excerpt: string | null;
  contentHtml: string;
  categoryName: string | null;
  categoryHref: string | null;
  featuredImage: ExtractMedia | null;
  author: { name: string; jobTitle: string | null; bio: string | null } | null;
  tags: Array<{ name: string; href: string }>;
  hasPublishedDate: boolean;
  blogHref: string;
  homeHref: string;
};

export type ArchiveFacts = {
  /** Articles the archive lists on its first page. */
  postCount: number;
  categoryCount: number;
  homeHref: string;
};

export type ExtractContext = {
  media: ReadonlyMap<string, ExtractMedia>;
  /** Whether the first section may own the page's `<h1>`. */
  allowFirstH1?: boolean;
  product?: ProductFacts;
  article?: ArticleFacts;
  archive?: ArchiveFacts;
};

/** What the article layout shows, for the article's own checks. */
export type ArticleVisibility = {
  header: boolean;
  content: boolean;
  image: boolean;
  author: boolean;
  dates: boolean;
};

type Content = Record<string, unknown>;

const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const bool = (value: unknown, fallback = true): boolean =>
  typeof value === 'boolean' ? value : fallback;
const items = (value: unknown): Content[] =>
  Array.isArray(value) ? value.filter((item): item is Content => typeof item === 'object' && item !== null) : [];

class Collector {
  readonly nodes: ContentNode[] = [];
  constructor(
    private readonly ctx: ExtractContext,
    private readonly source: string,
  ) {}

  heading(level: number, text: unknown) {
    const value = str(text);
    if (value) {
      this.nodes.push({
        type: 'heading',
        level: Math.min(6, Math.max(1, level)) as 1 | 2 | 3 | 4 | 5 | 6,
        text: value,
        source: this.source,
      });
    }
  }

  paragraph(text: unknown) {
    const value = str(text);
    if (value) this.nodes.push({ type: 'paragraph', text: value, source: this.source });
  }

  /** A field an editor may fill with rich text or plain text. */
  rich(html: unknown) {
    const value = str(html);
    if (value) this.nodes.push(...htmlToNodes(value, this.source));
  }

  list(values: unknown[], ordered = false) {
    const clean = values.map(str).filter(Boolean);
    if (clean.length > 0) this.nodes.push({ type: 'list', ordered, items: clean, source: this.source });
  }

  table(rows: string[][]) {
    const clean = rows.filter((row) => row.some(Boolean));
    if (clean.length > 0) this.nodes.push({ type: 'table', rows: clean, source: this.source });
  }

  link(href: unknown, text: unknown) {
    const url = str(href);
    if (url) this.nodes.push({ type: 'link', href: url, text: str(text), source: this.source });
  }

  faq(question: unknown, answerHtml: unknown) {
    const q = str(question);
    if (!q) return;
    const answer = htmlToNodes(str(answerHtml))
      .map((node) => ('text' in node && node.type !== 'link' ? node.text : node.type === 'list' ? node.items.join(' ') : ''))
      .filter(Boolean)
      .join(' ');
    this.nodes.push({ type: 'faq', question: q, answer, source: this.source });
  }

  collection(of: 'products' | 'posts' | 'categories', count: number) {
    if (count > 0) this.nodes.push({ type: 'collection', of, count, source: this.source });
  }

  /**
   * An image from the media library.
   *
   * `alt` is the block's own alt text; the library's alt text is the fallback,
   * exactly as the renderer resolves it. `decorative` images are drawn with an
   * empty alt on purpose — backgrounds and icon badges.
   */
  media(id: unknown, alt?: unknown, options: { decorative?: boolean; fallback?: unknown } = {}) {
    const key = str(id);
    if (!key) return;
    const media = this.ctx.media.get(key);
    if (!media) return;
    this.image(media, options.decorative ? '' : str(alt) || str(media.altText) || str(options.fallback), options.decorative);
  }

  image(media: ExtractMedia, alt: string, decorative = false) {
    const node: ContentImage = {
      type: 'image',
      src: media.url,
      alt,
      decorative,
      width: media.width,
      height: media.height,
      bytes: media.size,
      mimeType: media.mimeType,
      source: this.source,
    };
    this.nodes.push(node);
  }
}

/** Heading and intro, the pair most sections open with. */
function intro(c: Collector, content: Content, level: number) {
  c.paragraph(content.eyebrow);
  c.heading(level, content.heading);
  c.paragraph(content.description);
}

type Extractor = (c: Collector, content: Content, env: { isFirst: boolean; ctx: ExtractContext }) => void;

const lead = (isFirst: boolean) => (isFirst ? 1 : 2);

const PAGE_EXTRACTORS: Record<string, Extractor> = {
  hero(c, content, { isFirst }) {
    const layout = str(content.layout) || 'content';
    c.paragraph(content.eyebrow);
    c.heading(lead(isFirst), content.heading);
    c.paragraph(content.description);
    c.list(Array.isArray(content.bullets) ? content.bullets : []);
    c.list(items(content.badges).map((badge) => badge.label));
    if (layout === 'contentImage' || layout === 'contentImageForm') {
      c.media(content.imageId, content.imageAlt);
    } else if (layout === 'backgroundImage') {
      c.media(content.imageId, '', { decorative: true });
    }
    c.link(content.primaryCtaUrl, content.primaryCtaLabel);
    c.link(content.secondaryCtaUrl, content.secondaryCtaLabel);
    if (bool(content.showForm, false) || layout === 'contentForm' || layout === 'contentImageForm') {
      c.heading(2, content.formHeading);
      c.paragraph(content.formDescription);
    }
  },
  richText(c, content) {
    c.heading(2, content.heading);
    c.rich(content.content);
  },
  featureGrid(c, content) {
    c.heading(2, content.heading);
    c.paragraph(content.description);
    for (const item of items(content.items)) {
      c.media(item.imageId, '');
      c.heading(3, item.title);
      c.paragraph(item.description);
    }
  },
  imageContent(c, content) {
    intro(c, { ...content, description: '' }, 2);
    c.rich(content.description);
    c.link(content.ctaUrl, content.ctaLabel);
    c.media(content.imageId, '');
  },
  productCards(c, content) {
    c.heading(2, content.heading);
    c.paragraph(content.description);
    const picked = Array.isArray(content.productIds) ? content.productIds.length : 0;
    c.collection('products', content.source === 'selected' ? picked : Number(content.limit) || 3);
  },
  productGrid(c, content) {
    intro(c, content, 2);
    const picked = Array.isArray(content.productIds) ? content.productIds.length : 0;
    c.collection('products', content.source === 'selected' ? picked : Number(content.limit) || 6);
  },
  productTable(c, content) {
    c.heading(2, content.heading);
    c.paragraph(content.description);
    const picked = Array.isArray(content.productIds) ? content.productIds.length : 0;
    const count = content.source === 'selected' ? picked : Number(content.limit) || 6;
    // A comparison table, filled from the catalogue: its rows are what it
    // compares, which is what matters to the checks that look for one.
    const rows = [['Plan'], ...['Storage', 'Users', 'Monthly', 'Annual'].map((label) => [label])];
    if (count > 0) c.table(rows);
    c.collection('products', count);
  },
  faq(c, content) {
    c.heading(2, content.heading);
    c.paragraph(content.description);
    for (const item of items(content.items)) c.faq(item.question, item.answer);
  },
  testimonials(c, content) {
    c.heading(2, content.heading);
    c.paragraph(content.description);
    for (const item of items(content.items)) {
      c.paragraph(item.quote);
      c.paragraph([item.name, item.role, item.company].map(str).filter(Boolean).join(', '));
      c.media(item.imageId, '', { fallback: item.name });
    }
  },
  cta(c, content) {
    intro(c, content, 2);
    if (bool(content.showPrimaryCta)) c.link(content.primaryCtaUrl, content.primaryCtaLabel);
    if (bool(content.showSecondaryCta)) c.link(content.secondaryCtaUrl, content.secondaryCtaLabel);
    const style = (content.formStyle ?? {}) as Content;
    if (str(content.formSlug)) {
      c.heading(3, style.heading);
      c.paragraph(style.description);
    }
  },
  leadMagnet(c, content) {
    c.heading(2, content.heading);
    c.paragraph(content.description);
    c.media(content.imageId, '', { fallback: content.heading });
  },
  formBlock(c, content) {
    c.heading(2, content.heading);
    c.paragraph(content.description);
    if (str(content.layout) === 'split') {
      c.heading(3, content.sideHeading);
      c.list(Array.isArray(content.sideBullets) ? content.sideBullets : []);
    }
    const style = (content.formStyle ?? {}) as Content;
    c.heading(3, style.heading);
    c.paragraph(style.description);
  },
  logoWall(c, content) {
    c.heading(2, content.heading);
    for (const logo of items(content.logos)) {
      c.media(logo.imageId, '', { fallback: logo.label });
      c.link(logo.url, logo.label);
    }
  },
  stats(c, content) {
    c.heading(2, content.heading);
    c.paragraph(content.description);
    for (const item of items(content.items)) c.paragraph(`${str(item.value)} ${str(item.label)}`);
  },
  steps(c, content) {
    c.heading(2, content.heading);
    c.paragraph(content.description);
    const steps = items(content.items);
    c.list(
      steps.map((item) => [str(item.title), str(item.description)].filter(Boolean).join(' — ')),
      true,
    );
  },
  imageCards(c, content) {
    intro(c, content, 2);
    for (const item of items(content.items)) {
      c.media(item.imageId, item.imageAlt);
      c.heading(3, item.heading);
      c.paragraph(item.description);
      if (str(item.linkUrl)) c.link(item.linkUrl, item.ctaLabel || item.heading);
      else c.link(item.ctaUrl, item.ctaLabel);
    }
  },
  iconCards(c, content) {
    intro(c, content, 2);
    for (const item of items(content.items)) {
      c.media(item.imageId, '', { decorative: true });
      c.heading(3, item.heading);
      c.paragraph(item.description);
      if (str(item.linkUrl)) c.link(item.linkUrl, item.ctaLabel || item.heading);
      else c.link(item.ctaUrl, item.ctaLabel);
    }
  },
  imageBox(c, content) {
    c.paragraph(content.eyebrow);
    c.heading(2, content.heading);
    c.rich(content.text);
    c.link(content.ctaUrl, content.ctaLabel);
    c.media(content.imageId, content.imageAlt, {
      decorative: str(content.layout) === 'backgroundImage',
    });
  },
  iconBox(c, content) {
    c.media(content.imageId, '', { decorative: true });
    c.heading(3, content.heading);
    c.paragraph(content.description);
    if (str(content.linkUrl)) c.link(content.linkUrl, content.ctaLabel || content.heading);
    else c.link(content.ctaUrl, content.ctaLabel);
  },
  listSection(c, content) {
    intro(c, content, 2);
    const list = items(content.items);
    c.list(
      list.map((item) => [str(item.text), str(item.description)].filter(Boolean).join(' — ')),
      str(content.marker) === 'number',
    );
    for (const item of list) if (str(item.url)) c.link(item.url, item.text);
  },
  headingText(c, content, { isFirst }) {
    c.paragraph(content.eyebrow);
    c.heading(lead(isFirst), content.heading);
    c.paragraph(content.subheading);
    c.rich(content.content);
    c.link(content.ctaUrl, content.ctaLabel);
  },
  textListImage(c, content, { isFirst }) {
    c.paragraph(content.eyebrow);
    c.heading(lead(isFirst), content.heading);
    c.paragraph(content.subheading);
    c.rich(content.description);
    c.list(items(content.items).map((item) => item.text), str(content.marker) === 'number');
    c.link(content.primaryCtaUrl, content.primaryCtaLabel);
    c.link(content.secondaryCtaUrl, content.secondaryCtaLabel);
    c.media(content.imageId, content.imageAlt);
  },
  statistics(c, content) {
    intro(c, content, 2);
    for (const item of items(content.items)) {
      c.paragraph(
        [`${str(item.prefix)}${str(item.value)}${str(item.suffix)}`, str(item.label), str(item.description)]
          .filter(Boolean)
          .join(' '),
      );
    }
  },

  // --- sliders ------------------------------------------------------------
  logoSlider(c, content, { isFirst }) {
    intro(c, content, lead(isFirst));
    for (const item of items(content.items)) {
      if (item.enabled === false) continue;
      c.media(item.imageId, item.alt, { fallback: item.title });
      c.link(item.url, item.title || item.alt);
    }
  },
  imageSlider(c, content, { isFirst }) {
    intro(c, content, lead(isFirst));
    for (const item of items(content.items)) {
      if (item.enabled === false) continue;
      c.media(item.imageId, item.alt, { fallback: item.heading });
      c.heading(3, item.heading);
      c.paragraph(item.description);
      c.link(item.buttonUrl, item.buttonLabel);
    }
  },
  testimonialSlider(c, content, { isFirst }) {
    intro(c, content, lead(isFirst));
    for (const item of items(content.items)) {
      if (item.enabled === false) continue;
      c.paragraph(item.quote);
      c.paragraph([item.name, item.designation, item.company].map(str).filter(Boolean).join(', '));
      c.media(item.imageId, '', { fallback: item.name });
    }
  },
  contentSlider(c, content, { isFirst }) {
    intro(c, content, lead(isFirst));
    for (const item of items(content.items)) {
      if (item.enabled === false) continue;
      c.media(item.imageId, item.alt, {
        decorative: str(content.layout) === 'backgroundImage',
      });
      c.heading(3, item.heading);
      c.paragraph(item.description);
      c.list(Array.isArray(item.bullets) ? item.bullets : []);
      c.link(item.ctaUrl, item.ctaLabel);
    }
  },
  textBoxSlider(c, content, { isFirst }) {
    intro(c, content, lead(isFirst));
    for (const item of items(content.items)) {
      if (item.enabled === false) continue;
      c.media(item.imageId, '', { fallback: item.heading });
      c.heading(3, item.heading);
      c.paragraph(item.text);
      c.link(item.url, item.ctaLabel || item.heading);
    }
  },
  productSlider(c, content, { isFirst }) {
    intro(c, content, lead(isFirst));
    const picked = Array.isArray(content.productIds) ? content.productIds.length : 0;
    c.collection('products', content.source === 'selected' ? picked : Number(content.limit) || 6);
  },
  blogSlider(c, content, { isFirst }) {
    intro(c, content, lead(isFirst));
    c.collection('posts', Number(content.limit) || 6);
  },

  // --- blog listing -------------------------------------------------------
  blogHero(c, content, { ctx }) {
    if (bool(content.showBreadcrumb)) c.link(ctx.archive?.homeHref ?? '/', 'Home');
    if (bool(content.showSubtitle)) c.paragraph(content.subtitle);
    // The blog hero is always the archive's <h1>, wherever it sits.
    if (bool(content.showHeading)) c.heading(1, content.heading);
    if (bool(content.showDescription)) c.paragraph(content.description);
    if (bool(content.showCta, false)) {
      c.link(content.ctaUrl, content.ctaLabel);
      c.link(content.secondaryCtaUrl, content.secondaryCtaLabel);
    }
    if (str(content.imagePlacement) !== 'none') c.media(content.imageId, content.imageAlt);
  },
  blogBreadcrumb(c, _content, { ctx }) {
    c.link(ctx.archive?.homeHref ?? '/', 'Home');
  },
  blogCategoryFilter(c, _content, { ctx }) {
    c.collection('categories', ctx.archive?.categoryCount ?? 0);
  },
  blogFeatured(c, content, { isFirst }) {
    if (bool(content.showHeading)) intro(c, content, lead(isFirst));
    c.collection('posts', 1);
  },
  blogGrid(c, content, { isFirst, ctx }) {
    if (bool(content.showHeading)) intro(c, content, lead(isFirst));
    c.collection('posts', ctx.archive?.postCount ?? (Number(content.limit) || 0));
  },
  blogNewsletter(c, content) {
    if (bool(content.showHeading)) intro(c, content, 2);
    c.paragraph(content.footnote);
  },

  // --- product page -------------------------------------------------------
  productHeader(c, content, { ctx }) {
    const product = ctx.product;
    if (!product) return;
    if (bool(content.showBreadcrumb)) {
      c.link(product.homeHref, content.homeLabel || 'Home');
      if (bool(content.showProductsCrumb)) c.link(product.productsHref, content.productsLabel || 'Products');
    }
    if (bool(content.showCategory) && product.categoryName) {
      if (bool(content.linkCategory) && product.categoryHref) c.link(product.categoryHref, product.categoryName);
      else c.paragraph(product.categoryName);
    }
    if (bool(content.showBrand) && product.brandName) {
      if (bool(content.linkBrand) && product.brandHref) c.link(product.brandHref, product.brandName);
      else c.paragraph(product.brandName);
    }
    const level = Number(/^h([1-6])$/.exec(str(content.titleTag) || 'h1')?.[1] ?? 1);
    c.heading(level, product.name);
    if (bool(content.showShortDescription)) c.paragraph(product.shortDescription);
    if (bool(content.showSku, false) && product.sku) c.paragraph(`SKU ${product.sku}`);
    if (bool(content.showImage) && product.image) c.image(product.image, product.image.alt);
  },
  productMedia(c, content, { ctx }) {
    const product = ctx.product;
    if (!product) return;
    if (bool(content.showMainImage, false) && product.image) c.image(product.image, product.image.alt);
    if (bool(content.showGallery)) {
      const limit = Number(content.galleryLimit) || 0;
      const gallery = limit > 0 ? product.gallery.slice(0, limit) : product.gallery;
      for (const image of gallery) c.image(image, str(image.altText));
    }
  },
  productDescription(c, content, { ctx }) {
    const product = ctx.product;
    if (!product) return;
    c.heading(2, content.heading);
    if (str(product.descriptionHtml)) c.rich(product.descriptionHtml);
    else if (bool(content.fallbackToShort)) c.paragraph(product.shortDescription);
  },
  productFeatures(c, content, { ctx }) {
    const product = ctx.product;
    if (!product) return;
    const limit = Number(content.limit) || 0;
    const cap = (list: string[]) => (limit > 0 ? list.slice(0, limit) : list);
    const features = bool(content.showFeatures) ? cap(product.features) : [];
    const benefits = bool(content.showBenefits) ? cap(product.benefits) : [];
    if (features.length === 0 && benefits.length === 0) return;
    const named = (value: unknown) => str(value).split('{product}').join(product.name);
    const heading = named(content.heading);
    c.heading(2, heading);
    const sub = heading ? 3 : 2;
    if (named(content.featuresHeading) || named(content.benefitsHeading)) {
      if (features.length > 0) {
        c.heading(sub, named(content.featuresHeading));
        c.list(features);
      }
      if (benefits.length > 0) {
        c.heading(sub, named(content.benefitsHeading));
        c.list(benefits);
      }
    } else {
      c.list([...features, ...benefits]);
    }
  },
  productSpecs(c, content, { ctx }) {
    const product = ctx.product;
    if (!product) return;
    const rows = specRows(product, {
      storage: bool(content.showStorage),
      users: bool(content.showUsers),
      sku: bool(content.showSku, false),
    });
    if (rows.length === 0) return;
    c.heading(2, content.heading);
    if (str(content.layout) === 'list') c.list(rows.map((row) => `${row.label}: ${row.value}`));
    else c.table(rows.map((row) => [row.label, row.value]));
  },
  productRelated(c, content) {
    c.heading(2, content.heading);
    c.collection('products', Number(content.limit) || 3);
  },
  productPriceBox(c, content, { ctx }) {
    const product = ctx.product;
    if (!product) return;
    const price = (value: string | null) =>
      value ? `${product.currency} ${value}${product.priceSuffix ? ` ${product.priceSuffix}` : ''}` : null;
    if (bool(content.showMonthly)) c.paragraph(price(product.monthlyPrice) ?? product.priceNote);
    if (bool(content.showAnnual) && product.annualPrice) c.paragraph(`${price(product.annualPrice)} billed annually`);
    if (bool(content.showCta)) c.paragraph(str(content.ctaLabel) || product.ctaLabel);
    if (bool(content.showSpecs)) {
      c.heading(3, content.specsHeading);
      c.list(product.specs.map((spec) => `${spec.label}: ${spec.value}`));
    }
    c.paragraph(content.note);
    if (bool(content.showForm, false)) c.heading(3, content.formHeading);
  },

  // --- article page -------------------------------------------------------
  articleBreadcrumb(c, content, { ctx }) {
    const article = ctx.article;
    if (!article) return;
    if (bool(content.showHome)) c.link(article.homeHref, content.homeLabel || 'Home');
    c.link(article.blogHref, content.blogLabel || 'Blog');
    if (article.categoryName && article.categoryHref) c.link(article.categoryHref, article.categoryName);
  },
  articleHeader(c, content, { ctx }) {
    const article = ctx.article;
    if (!article) return;
    if (bool(content.showCategory) && article.categoryName && article.categoryHref) {
      c.link(article.categoryHref, article.categoryName);
    }
    c.heading(1, article.title);
    if (bool(content.showSubtitle)) c.paragraph(article.subtitle);
    if (bool(content.showExcerpt)) c.paragraph(article.excerpt);
    if (bool(content.showAuthor) && article.author) c.paragraph(`By ${article.author.name}`);
    if (bool(content.showTags, false)) for (const tag of article.tags) c.link(tag.href, tag.name);
  },
  articleImage(c, content, { ctx }) {
    const article = ctx.article;
    if (!article?.featuredImage) return;
    c.image(article.featuredImage, str(article.featuredImage.altText));
  },
  articleContent(c, content, { ctx }) {
    const article = ctx.article;
    if (!article) return;
    if (bool(content.showLead, false)) c.paragraph(article.excerpt);
    c.rich(article.contentHtml);
  },
  articleAuthor(c, content, { ctx }) {
    const author = ctx.article?.author;
    if (!author) return;
    if (bool(content.showHeading, false)) c.heading(2, content.heading);
    c.paragraph(author.name);
    if (bool(content.showJobTitle)) c.paragraph(author.jobTitle);
    if (bool(content.showBio)) c.paragraph(author.bio);
  },
  articleTags(c, _content, { ctx }) {
    for (const tag of ctx.article?.tags ?? []) c.link(tag.href, tag.name);
  },
  articleRelated(c, content) {
    if (bool(content.showHeading)) c.heading(2, content.heading);
    c.collection('posts', Number(content.limit) || 3);
  },
  articlePrevNext(c) {
    c.collection('posts', 2);
  },
};

/** Blocks that are chrome or navigation rather than content. */
const IGNORED = new Set([
  'divider',
  'spacer',
  'blogSearch',
  'blogPagination',
  'articleToc',
  'articleShare',
]);

/** The rows a product's specification list shows, as the block builds them. */
export function specRows(
  product: Pick<ProductFacts, 'specs' | 'storage' | 'users' | 'sku'>,
  show: { storage: boolean; users: boolean; sku: boolean },
): Array<{ label: string; value: string }> {
  const rows = [...product.specs];
  if (show.storage && product.storage) {
    rows.unshift({ label: 'Storage', value: product.storage });
  }
  if (show.users && product.users) {
    rows.unshift({ label: 'Users', value: product.users });
  }
  if (show.sku && product.sku) rows.push({ label: 'SKU', value: product.sku });
  return rows;
}

/** A block this file has no rule for, read from the shape of its content. */
function generic(c: Collector, content: Content, level: number) {
  c.heading(level, content.heading ?? content.title);
  c.paragraph(content.subheading ?? content.subtitle);
  for (const key of ['description', 'text', 'body', 'content']) {
    const value = str(content[key]);
    if (!value) continue;
    if (value.includes('<')) c.rich(value);
    else c.paragraph(value);
  }
  for (const item of items(content.items)) {
    c.heading(3, item.heading ?? item.title);
    c.paragraph(item.description ?? item.text);
  }
}

export function extractSections(
  sections: readonly SectionForExtraction[],
  ctx: ExtractContext,
): ContentNode[] {
  const visible = sections
    .filter((section) => section.isVisible)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const nodes: ContentNode[] = [];
  visible.forEach((section, index) => {
    if (IGNORED.has(section.blockType) || section.blockType.startsWith('widget')) return;
    const definition = getBlock(section.blockType);
    const label = definition?.label ?? section.blockType;
    const collector = new Collector(ctx, `Section ${index + 1} · ${label}`);
    const content = parseBlockContent<Content>(section.blockType, section.content);
    const isFirst = Boolean(ctx.allowFirstH1) && index === 0;
    const extractor = PAGE_EXTRACTORS[section.blockType];
    if (extractor) extractor(collector, content, { isFirst, ctx });
    else generic(collector, content, isFirst ? 1 : 2);
    nodes.push(...collector.nodes);
  });
  return nodes;
}

/** Which of the article layout's parts are switched on. */
export function articleVisibility(sections: readonly SectionForExtraction[]): ArticleVisibility {
  const visible = sections.filter((section) => section.isVisible);
  const has = (type: string) => visible.some((section) => section.blockType === type);
  const header = visible.find((section) => section.blockType === 'articleHeader');
  const headerContent = header ? parseBlockContent<Content>('articleHeader', header.content) : null;
  return {
    header: has('articleHeader'),
    content: has('articleContent'),
    image: has('articleImage'),
    author: has('articleAuthor') || Boolean(headerContent && bool(headerContent.showAuthor)),
    dates: Boolean(headerContent && (bool(headerContent.showDate) || bool(headerContent.showUpdatedDate))),
  };
}

/** Every media id the sections refer to, so the caller can load them in one query. */
export function sectionMediaIds(sections: readonly SectionForExtraction[]): string[] {
  const ids = new Set<string>();
  const visit = (value: unknown, key?: string) => {
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item));
      return;
    }
    if (value && typeof value === 'object') {
      for (const [childKey, child] of Object.entries(value as Content)) visit(child, childKey);
      return;
    }
    if (typeof value === 'string' && value && key && /imageId$|^imageId$/i.test(key)) ids.add(value);
  };
  for (const section of sections) {
    if (section.isVisible) visit(section.content);
  }
  return [...ids];
}

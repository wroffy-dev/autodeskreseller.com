import type { JsonLd, SchemaAnalysis, SchemaTypeAnalysis, SeoDocument } from './types';

/**
 * What the page's structured data says, and what it should.
 *
 * Reads the JSON-LD the application actually emits for the page — the
 * organisation and website objects every public page carries, plus the page's
 * own — and compares it with what a page of that kind should describe. A type
 * is expected only where the page's visible content supports it: FAQPage only
 * where the page shows questions and answers, Product only on a product page.
 * Nothing here ever asks for markup a page could not honestly carry.
 */

const PAGE_TYPES = new Set([
  'WebSite',
  'WebPage',
  'BreadcrumbList',
  'Product',
  'Offer',
  'Article',
  'BlogPosting',
  'NewsArticle',
  'FAQPage',
  'CollectionPage',
]);

function typesOf(item: JsonLd): string[] {
  const type = item['@type'];
  if (Array.isArray(type)) return type.map(String);
  return typeof type === 'string' ? [type] : [];
}

const filled = (value: unknown): boolean => {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as object).length > 0;
  return true;
};

/** The organisation object: whatever the layout emits that is not a page type. */
export function organizationOf(schema: readonly JsonLd[]): JsonLd | null {
  return (
    schema.find((item) => {
      const types = typesOf(item);
      return types.length > 0 && types.every((type) => !PAGE_TYPES.has(type)) && filled(item.name);
    }) ?? null
  );
}

export function findType(schema: readonly JsonLd[], ...wanted: string[]): JsonLd | null {
  return schema.find((item) => typesOf(item).some((type) => wanted.includes(type))) ?? null;
}

function missingOf(item: JsonLd | null, required: string[]): string[] {
  if (!item) return required;
  return required.filter((property) => !filled(item[property]));
}

export function analyzeSchema(doc: SeoDocument, hasFaq: boolean): SchemaAnalysis {
  const schema = doc.schema;
  const types = [...new Set(schema.flatMap(typesOf))];
  const items: SchemaTypeAnalysis[] = [];

  // --- Organisation (every page, via the layout) ---------------------------
  const organization = organizationOf(schema);
  const orgType = organization ? typesOf(organization).join(', ') : 'Organization';
  const isLocal = Boolean(doc.entity.localBusinessType);
  items.push({
    type: orgType,
    present: Boolean(organization),
    expected: true,
    missing: missingOf(organization, isLocal ? ['name', 'url', 'address'] : ['name', 'url']),
    recommended: organization
      ? ['logo', 'sameAs', 'contactPoint'].filter((property) => !filled(organization[property]))
      : [],
  });

  // --- WebSite (every page, via the layout) --------------------------------
  const website = findType(schema, 'WebSite');
  items.push({
    type: 'WebSite',
    present: Boolean(website),
    expected: doc.kind === 'homepage',
    missing: missingOf(website, ['name', 'url']),
    recommended: [],
  });

  // --- Breadcrumbs (every page but the home page) --------------------------
  const breadcrumbs = findType(schema, 'BreadcrumbList');
  const crumbItems = Array.isArray(breadcrumbs?.itemListElement)
    ? (breadcrumbs!.itemListElement as unknown[])
    : [];
  items.push({
    type: 'BreadcrumbList',
    present: Boolean(breadcrumbs),
    expected: doc.kind !== 'homepage',
    missing: breadcrumbs ? (crumbItems.length >= 2 ? [] : ['itemListElement (two or more)']) : ['itemListElement'],
    recommended: [],
  });

  // --- Product and its Offer -------------------------------------------------
  if (doc.kind === 'product') {
    const product = findType(schema, 'Product');
    const offer = product && typeof product.offers === 'object' && product.offers ? (product.offers as JsonLd) : null;
    const priced = Boolean(doc.product?.price);
    items.push({
      type: 'Product',
      present: Boolean(product),
      expected: true,
      missing: missingOf(product, ['name', 'image', 'brand', ...(priced ? ['offers'] : [])]),
      recommended: product
        ? ['description', 'sku'].filter((property) => !filled(product[property]))
        : [],
    });
    items.push({
      type: 'Offer',
      present: Boolean(offer),
      expected: priced,
      missing: priced ? missingOf(offer, ['price', 'priceCurrency', 'availability']) : [],
      recommended: offer ? ['url'].filter((property) => !filled(offer[property])) : [],
    });
  }

  // --- Article -------------------------------------------------------------------
  if (doc.kind === 'article') {
    const article = findType(schema, 'BlogPosting', 'Article', 'NewsArticle');
    items.push({
      type: 'BlogPosting',
      present: Boolean(article),
      expected: true,
      missing: missingOf(article, ['headline', 'datePublished', 'author', 'publisher']),
      recommended: article
        ? ['image', 'dateModified', 'description', 'mainEntityOfPage'].filter(
            (property) => !filled(article[property]),
          )
        : [],
    });
  }

  // --- FAQ, only where the page shows questions and answers -----------------
  const faq = findType(schema, 'FAQPage');
  if (hasFaq || faq) {
    const questions = Array.isArray(faq?.mainEntity) ? (faq!.mainEntity as JsonLd[]) : [];
    const answered = questions.filter((question) => {
      const answer = question.acceptedAnswer as JsonLd | undefined;
      return filled(question.name) && filled(answer?.text);
    });
    items.push({
      type: 'FAQPage',
      present: Boolean(faq),
      expected: hasFaq,
      missing: faq ? (answered.length > 0 ? [] : ['mainEntity (answered questions)']) : ['mainEntity'],
      recommended: [],
    });
  }

  return { types, items };
}

/** Expected types that are absent, or present without their required properties. */
/**
 * The gaps as an instruction an editor can act on without opening the
 * markup: "Product needs image and brand; FAQPage is not emitted".
 */
export function schemaGapFix(gaps: ReturnType<typeof schemaGaps>): string {
  const names = (list: string[]) =>
    list.length <= 1 ? (list[0] ?? '') : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
  return [
    ...gaps.incomplete.map((gap) => `${gap.type} needs ${names(gap.missing.slice(0, 5))}`),
    ...gaps.absent.map((type) => `${type} is not emitted`),
  ].join('; ');
}

export function schemaGaps(analysis: SchemaAnalysis): {
  absent: string[];
  incomplete: Array<{ type: string; missing: string[] }>;
} {
  const expected = analysis.items.filter((item) => item.expected);
  return {
    absent: expected.filter((item) => !item.present).map((item) => item.type),
    incomplete: expected
      .filter((item) => item.present && item.missing.length > 0)
      .map((item) => ({ type: item.type, missing: item.missing })),
  };
}

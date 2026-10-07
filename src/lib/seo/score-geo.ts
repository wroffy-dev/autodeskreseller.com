import { DENSITY_FAIL, DENSITY_WARNING, type DocumentAnalysis } from './analysis';
import {
  A_KIND,
  fail,
  info,
  listNames,
  notApplicable,
  pass,
  plural,
  quote,
  runChecks,
  warn,
  type SeoCheck,
} from './checks';
import { containsPhrase, overlap } from './content/text';
import { findType, organizationOf, schemaGapFix, schemaGaps } from './schema-analysis';
import type { ScoreBreakdown, SeoDocument, SeoPageKind } from './types';

/**
 * GEO checks: is the page a clear, trustworthy, quotable source?
 *
 * An internal heuristic for generative engines. It does not, and cannot,
 * predict whether any AI system will use the page. It rewards what makes
 * content usable as a source at all: an identifiable entity behind it,
 * specific facts rather than slogans, claims that are supported, attribution,
 * freshness where it matters, machine-readable structure and passages that
 * make sense when lifted out on their own. Every finding comes from what the
 * CMS holds — nothing here invents a claim for the page to make.
 */

const DEPTH: Record<SeoPageKind, number> = {
  homepage: 300,
  page: 400,
  product: 250,
  article: 800,
  category: 60,
  tag: 60,
  archive: 60,
};

const monthsSince = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  return Math.floor((Date.now() - then) / (30.44 * 24 * 60 * 60 * 1000));
};

const LOCATION_SLUG = /(^|\/)(contact|about|locations?|office|offices|visit|support)(\/|$)/i;

export const GEO_CHECKS: readonly SeoCheck[] = [
  {
    id: 'geo.organization',
    dimension: 'geo',
    category: 'entities',
    label: 'Organisation identity',
    weight: 5,
    severity: 'improvement',
    applicableTo: 'all',
    evaluate(doc) {
      const organization = organizationOf(doc.schema);
      if (!organization) return fail('No organisation is described in the page’s structured data.', 'Set the organisation name and type in Admin → SEO.');
      const gaps = [!doc.entity.hasLogo ? 'a logo' : '', doc.entity.sameAsCount === 0 ? 'social profile links' : ''].filter(Boolean);
      if (gaps.length === 0) return pass(`${doc.entity.organizationName} is identified, with its logo and profiles.`);
      return warn(0.7, `${doc.entity.organizationName} is identified but without ${listNames(gaps)}.`, 'Add the logo and the company’s LinkedIn/X profiles in Website Settings, so the entity can be recognised across the web.');
    },
  },
  {
    id: 'geo.entityConsistency',
    dimension: 'geo',
    category: 'entities',
    label: 'Consistent entity data',
    weight: 5,
    severity: 'improvement',
    applicableTo: ['homepage', 'product', 'article'],
    evaluate(doc, analysis) {
      if (doc.kind === 'product') {
        const product = findType(doc.schema, 'Product');
        const conflicts: string[] = [];
        if (product) {
          const brand = (product.brand as { name?: unknown } | undefined)?.name;
          if (doc.product?.brand && typeof brand === 'string' && brand.trim().toLowerCase() !== doc.product.brand.trim().toLowerCase()) {
            conflicts.push(`the structured data names the brand ${quote(brand)} while the product’s brand is ${quote(doc.product.brand)}`);
          }
          const name = typeof product.name === 'string' ? product.name : '';
          if (name && analysis.h1[0] && overlap(name, analysis.h1[0]) < 0.5) {
            conflicts.push(`the H1 ${quote(analysis.h1[0], 40)} differs from the product name ${quote(name, 40)}`);
          }
        }
        if (conflicts.length === 0) return pass('The product’s name and brand agree across the page and its structured data.');
        return warn(0.4, `Contradictory data: ${conflicts.join('; ')}.`, 'Make the page and its structured data name the product and brand the same way.');
      }
      if (doc.kind === 'article') {
        const article = findType(doc.schema, 'BlogPosting', 'Article');
        const headline = typeof article?.headline === 'string' ? article.headline : '';
        if (!headline) return notApplicable('No article markup to compare.');
        if (analysis.h1[0] && overlap(headline, analysis.h1[0]) >= 0.6) return pass('The headline in the markup matches the article’s title.');
        return warn(0.5, `The markup’s headline ${quote(headline, 40)} does not match the H1.`, 'Keep the article title and its H1 the same.');
      }
      const name = doc.entity.organizationName;
      if (containsPhrase(analysis.bodyText, name) || containsPhrase(analysis.bodyText, doc.entity.siteName)) {
        return pass(`The home page names the business: ${quote(name, 40)}.`);
      }
      return warn(0.5, `The home page never names the business (${quote(name, 40)}) in its copy.`, 'Say who you are in the opening section: the company name, what it does and where.');
    },
  },
  {
    id: 'geo.facts',
    dimension: 'geo',
    category: 'content',
    label: 'Specific, factual statements',
    weight: 6,
    severity: 'improvement',
    applicableTo: 'all',
    target: { area: 'content' },
    evaluate(doc, analysis) {
      if (analysis.wordCount < 60) return notApplicable('Too little copy to judge.');
      const productFacts = doc.product
        ? [doc.product.price, doc.product.storage, doc.product.users].filter(Boolean).length + doc.product.specs.length
        : 0;
      const facts = analysis.facts + productFacts;
      const wanted = Math.max(2, Math.round(analysis.wordCount / 150));
      if (facts >= wanted) return pass(`${plural(facts, 'specific fact')} — figures, limits, prices or dates.`);
      if (facts > 0) return warn(0.5, `Only ${plural(facts, 'specific fact')} in ${analysis.wordCount} words.`, 'Replace general statements with checkable ones: storage sizes, user limits, prices, recovery windows, dates.');
      return fail('The copy states no specific facts: no figures, limits, prices or dates.', 'Add the concrete details a buyer or a researcher would quote.');
    },
  },
  {
    id: 'geo.claims',
    dimension: 'geo',
    category: 'trust',
    label: 'Supported claims',
    weight: 4,
    severity: 'improvement',
    applicableTo: 'all',
    target: { area: 'content' },
    evaluate(_doc, analysis) {
      const unsupported = analysis.superlatives.filter((entry) => !entry.supported);
      if (unsupported.length === 0) {
        return pass(analysis.superlatives.length > 0 ? 'Every superlative is backed by a figure or a source.' : 'No unsupported superlatives.');
      }
      const words = [...new Set(unsupported.flatMap((entry) => entry.words))];
      const example = quote(unsupported[0]!.sentence, 80);
      const message = `${plural(unsupported.length, 'sentence')} ${unsupported.length === 1 ? 'makes' : 'make'} unsupported claims (${listNames(words.map((word) => `“${word}”`))}), e.g. ${example}.`;
      const recommendation = 'Back each claim with a figure or a source, or state the underlying fact plainly instead.';
      return unsupported.length >= 3 ? fail(message, recommendation) : warn(0.6, message, recommendation);
    },
  },
  {
    id: 'geo.citations',
    dimension: 'geo',
    category: 'trust',
    label: 'Sources',
    weight: 4,
    severity: 'suggestion',
    applicableTo: ['article', 'page'],
    target: { area: 'content' },
    evaluate(doc, analysis) {
      const external = analysis.links.external.length;
      const stats = analysis.statistics.length;
      if (doc.kind === 'page' && stats === 0) return notApplicable('No statistics on the page that would need a source.');
      if (external > 0) return pass(`${plural(external, 'link')} to outside sources.`);
      if (stats > 0) return warn(0.3, `${plural(stats, 'statistic')} but no source linked.`, 'Link each statistic to where it comes from.');
      return warn(0.6, 'The article cites no outside source.', 'Where the article relies on a fact, cite the source — vendor documentation, a standard, published research.');
    },
  },
  {
    id: 'geo.statistics',
    dimension: 'geo',
    category: 'trust',
    label: 'Statistics with context',
    weight: 3,
    severity: 'suggestion',
    applicableTo: 'all',
    target: { area: 'content' },
    evaluate(_doc, analysis) {
      const stats = analysis.statistics;
      if (stats.length === 0) return notApplicable('No statistics on the page.');
      const bare = stats.filter((entry) => !entry.supported);
      if (bare.length === 0) return pass(`${plural(stats.length, 'statistic')}, each with a date or a source.`);
      return warn(1 - bare.length / stats.length, `${plural(bare.length, 'statistic')} without a date or source, e.g. ${quote(bare[0]!.sentence, 80)}.`, 'Say where each number comes from and when it was measured.');
    },
  },
  {
    id: 'geo.freshness',
    dimension: 'geo',
    category: 'trust',
    label: 'Freshness',
    weight: 3,
    severity: 'suggestion',
    applicableTo: ['article', 'product'],
    evaluate(doc) {
      const updated = doc.kind === 'article' ? doc.article?.updatedAt : doc.updatedAt;
      const age = monthsSince(updated);
      if (age === null) return info('No update date is known.');
      if (age <= 12) return pass(age === 0 ? 'Updated this month.' : `Updated ${plural(age, 'month')} ago.`);
      if (age <= 24) return warn(0.5, `Last updated ${age} months ago.`, doc.kind === 'product' ? 'Check the price and specifications are still current.' : 'Review the article and update anything that has changed.');
      return fail(`Last updated ${age} months ago.`, doc.kind === 'product' ? 'Check the price and specifications are still current.' : 'Review and refresh the article, or retire it if it no longer applies.');
    },
  },
  {
    id: 'geo.machineReadable',
    dimension: 'geo',
    category: 'structuredData',
    label: 'Machine-readable structure',
    weight: 6,
    severity: 'improvement',
    applicableTo: 'all',
    evaluate(_doc, analysis) {
      const expected = analysis.schema.items.filter((item) => item.expected);
      const gaps = schemaGaps(analysis.schema);
      if (expected.length === 0) return notApplicable('No structured data is expected here.');
      if (gaps.absent.length === 0 && gaps.incomplete.length === 0) {
        const recommended = expected.flatMap((item) => item.recommended);
        if (recommended.length > 0) {
          return warn(0.85, `Complete, though ${listNames(recommended)} would add detail.`, 'Fill in the missing details where the data exists.', { severity: 'suggestion' });
        }
        return pass(`${listNames(expected.map((item) => item.type), 6)} complete.`);
      }
      const ratio = (expected.length - gaps.absent.length - gaps.incomplete.length * 0.5) / expected.length;
      return warn(Math.max(0, ratio), `Missing or incomplete: ${listNames([...gaps.absent, ...gaps.incomplete.map((gap) => gap.type)])}.`, `${schemaGapFix(gaps)}. The markup is built from the page’s own fields, so filling those in completes it.`);
    },
  },
  {
    id: 'geo.attribution',
    dimension: 'geo',
    category: 'trust',
    label: 'Author and publisher',
    weight: 4,
    severity: 'improvement',
    applicableTo: ['article'],
    target: { field: 'author', area: 'organise' },
    evaluate(doc) {
      const article = findType(doc.schema, 'BlogPosting', 'Article');
      const author = (article?.author as { name?: unknown } | undefined)?.name;
      const publisher = (article?.publisher as { name?: unknown } | undefined)?.name;
      if (author && publisher) return pass(`Attributed to ${String(author)}, published by ${String(publisher)}.`);
      if (publisher) return warn(0.5, `Published by ${String(publisher)} but no author is attributed.`, 'Choose an author for the article.');
      return fail('The article is not attributed to an author or publisher.', 'Choose an author and set the organisation name in Admin → SEO.');
    },
  },
  {
    id: 'geo.depth',
    dimension: 'geo',
    category: 'content',
    label: 'Topical depth',
    weight: 5,
    severity: 'improvement',
    applicableTo: ['homepage', 'page', 'product', 'article'],
    target: { area: 'content' },
    evaluate(doc, analysis) {
      const sections = analysis.headings.filter((heading) => heading.level === 2).length;
      const wantedWords = DEPTH[doc.kind];
      const secondary = analysis.keywords.slice(1);
      const covered = secondary.filter((keyword) => keyword.occurrences > 0);
      const parts = [
        analysis.wordCount >= wantedWords ? 1 : analysis.wordCount / wantedWords,
        Math.min(1, sections / 3),
        secondary.length === 0 ? 1 : covered.length / secondary.length,
      ];
      const ratio = parts.reduce((total, part) => total + part, 0) / parts.length;
      const summary = `${plural(sections, 'section')}, ${analysis.wordCount} words${secondary.length > 0 ? `, ${covered.length} of ${secondary.length} secondary keywords covered` : ''}`;
      if (ratio >= 0.9) return pass(`Covers the topic in depth: ${summary}.`);
      const advice = [
        analysis.wordCount < wantedWords ? `expand towards ${wantedWords}+ words` : '',
        sections < 3 ? 'organise it into three or more H2 sections' : '',
        covered.length < secondary.length ? `cover ${listNames(secondary.filter((keyword) => keyword.occurrences === 0).map((keyword) => quote(keyword.keyword)))}` : '',
      ].filter(Boolean);
      return warn(ratio, `Coverage is thin for ${A_KIND[doc.kind]}: ${summary}.`, `To go deeper, ${listNames(advice)}.`);
    },
  },
  {
    id: 'geo.extractable',
    dimension: 'geo',
    category: 'answers',
    label: 'Quotable passages',
    weight: 5,
    severity: 'improvement',
    applicableTo: ['homepage', 'page', 'product', 'article'],
    target: { area: 'content' },
    evaluate(_doc, analysis) {
      if (analysis.wordCount < 150) return notApplicable('Too little copy to judge.');
      const quotable = analysis.paragraphs.filter((paragraph) => {
        const words = paragraph.split(/\s+/).length;
        return words >= 40 && words <= 120;
      });
      if (quotable.length >= 2) return pass(`${plural(quotable.length, 'self-contained passage')} of 40–120 words.`);
      if (quotable.length === 1) return warn(0.6, 'Only one passage of 40–120 words that could be quoted on its own.', 'Write a few focused paragraphs that each fully answer one question.');
      return fail('No self-contained passage an answer engine could quote: the copy is all fragments or long walls of text.', 'Write focused paragraphs of 40–120 words that each fully answer one question.');
    },
  },
  {
    id: 'geo.originality',
    dimension: 'geo',
    category: 'content',
    label: 'Original, substantial content',
    weight: 5,
    severity: 'critical',
    applicableTo: ['homepage', 'page', 'product', 'article'],
    target: { area: 'content' },
    evaluate(doc, analysis) {
      const copies = doc.collisions.content;
      if (copies.length > 0) {
        return fail(`The copy is identical to ${listNames(copies.map((copy) => copy.name))} in ${doc.country.name}.`, 'Rewrite it for this page’s own purpose, or keep one page and redirect the other.');
      }
      const thin = doc.kind === 'product' ? 80 : 150;
      if (analysis.wordCount < thin) {
        return warn(0.4, `Only ${analysis.wordCount} words — thin content says little a source could use.`, 'Add original detail: specifics from your own experience, customers and offer.', { severity: 'improvement' });
      }
      return pass('Original copy of substance.');
    },
  },
  {
    id: 'geo.location',
    dimension: 'geo',
    category: 'entities',
    label: 'Location and contact data',
    weight: 3,
    severity: 'suggestion',
    applicableTo: ['homepage', 'page'],
    evaluate(doc) {
      if (doc.kind === 'page' && !LOCATION_SLUG.test(doc.slug)) return notApplicable('Not a home, contact or about page.');
      const { hasAddress, hasPhone, hasEmail, localBusinessType } = doc.entity;
      if (localBusinessType && !hasAddress) {
        return fail(`The ${doc.country.name} market is marked as a ${localBusinessType} but has no address.`, 'Add the address under Settings → Countries.');
      }
      if (hasAddress && (hasPhone || hasEmail)) return pass(`${doc.country.name}’s address and contact details are in the structured data.`);
      return warn(0.5, `${doc.country.name} has no ${[!hasAddress ? 'address' : '', !hasPhone && !hasEmail ? 'phone or email' : ''].filter(Boolean).join(' or ')} in its structured data.`, 'Add this market’s address and phone under Settings → Countries.');
    },
  },
  {
    id: 'geo.stuffing',
    dimension: 'geo',
    category: 'keywords',
    label: 'No keyword stuffing',
    weight: 3,
    severity: 'improvement',
    applicableTo: 'all',
    target: { area: 'content' },
    evaluate(_doc, analysis) {
      if (analysis.keywords.length === 0 || analysis.wordCount < 100) return notApplicable('Nothing to judge.');
      const worst = [...analysis.keywords].sort((a, b) => b.density - a.density)[0]!;
      if (worst.density > DENSITY_FAIL) return fail(`${quote(worst.keyword)} is ${worst.density}% of the copy — stuffed.`, 'Rewrite for the reader; mention the keyword where it belongs and no more.');
      if (worst.density > DENSITY_WARNING) return warn(0.5, `${quote(worst.keyword)} is ${worst.density}% of the copy.`, 'Use natural variations instead of repeating the exact phrase.');
      return pass('Keywords are used naturally.');
    },
  },
  {
    id: 'geo.answerCoverage',
    dimension: 'geo',
    category: 'answers',
    label: 'Question-and-answer coverage',
    weight: 4,
    severity: 'suggestion',
    applicableTo: ['page', 'product', 'article'],
    target: { area: 'sections' },
    evaluate(_doc, analysis) {
      if (analysis.wordCount < 400) return notApplicable('A focused page; Q&A coverage is optional.');
      const answered = analysis.faqs.length + analysis.questionHeadings.filter((question) => question.answer).length;
      if (answered >= 3) return pass(`${plural(answered, 'question')} answered on the page.`);
      if (answered > 0) return warn(0.6, `${plural(answered, 'question')} answered.`, 'Cover the three to five questions buyers ask most, each with a direct answer.');
      return warn(0.3, 'The page answers no explicit questions.', 'Where it helps the reader, answer the questions customers really ask — as question headings or an FAQ.');
    },
  },
];

export function scoreGeo(doc: SeoDocument, analysis: DocumentAnalysis): ScoreBreakdown {
  return runChecks(GEO_CHECKS, doc, analysis);
}

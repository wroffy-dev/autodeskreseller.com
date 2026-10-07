import type { DocumentAnalysis } from './analysis';
import {
  fail,
  info,
  KIND_LABELS,
  listNames,
  notApplicable,
  pass,
  plural,
  quote,
  runChecks,
  warn,
  type SeoCheck,
} from './checks';
import { containsPhrase, countWords, overlap } from './content/text';
import { findType, schemaGapFix, schemaGaps } from './schema-analysis';
import type { ScoreBreakdown, SeoDocument } from './types';

/**
 * AEO checks: could an answer engine lift a clear, correct answer from this
 * page?
 *
 * An internal heuristic, not a score issued by Google, Bing, ChatGPT, Gemini or
 * anyone else. It rewards what makes a page easy to answer from — a clear
 * topic, questions phrased as people ask them with the answer straight after,
 * lists and tables for comparable facts, attribution on editorial content —
 * and only asks for them where the page's kind and length make them sensible.
 * A short product page is never told it needs an FAQ.
 */

/** Pages long enough that structure and Q&A are worth asking for. */
const SUBSTANTIAL = 400;

const topicOf = (doc: SeoDocument, analysis: DocumentAnalysis) =>
  doc.product?.name ?? doc.meta.keywords[0] ?? analysis.h1[0] ?? doc.name;

const monthsSince = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  return Math.floor((Date.now() - then) / (30.44 * 24 * 60 * 60 * 1000));
};

export const AEO_CHECKS: readonly SeoCheck[] = [
  {
    id: 'aeo.intent',
    dimension: 'aeo',
    category: 'answers',
    label: 'Clear topic',
    weight: 6,
    severity: 'improvement',
    applicableTo: 'all',
    target: { field: 'seoTitle', area: 'seo' },
    evaluate(doc, analysis) {
      const h1 = analysis.h1[0];
      if (!h1) return warn(0.3, 'With no H1, the page never states its topic on the page itself.', 'Add an H1 that names what the page is about.', { target: { area: 'sections' } });
      const agreement = Math.max(overlap(doc.meta.ownTitle, h1), overlap(h1, doc.meta.ownTitle));
      if (agreement >= 0.5) return pass(`The title and the H1 agree on the topic: ${quote(h1, 60)}.`);
      if (agreement > 0) {
        return warn(0.6, `The title ${quote(doc.meta.ownTitle, 50)} and the H1 ${quote(h1, 50)} only partly agree.`, 'Make the title and the H1 describe the same topic in similar words.');
      }
      return fail(`The title ${quote(doc.meta.ownTitle, 50)} and the H1 ${quote(h1, 50)} describe different things.`, 'Align the title and the H1 so the page has one unmistakable topic.');
    },
  },
  {
    id: 'aeo.directAnswer',
    dimension: 'aeo',
    category: 'answers',
    label: 'Answer-first opening',
    weight: 5,
    severity: 'improvement',
    applicableTo: ['homepage', 'page', 'product', 'article', 'category'],
    target: { area: 'content' },
    evaluate(doc, analysis) {
      const lead = analysis.leadParagraph;
      if (!lead) {
        return fail('There is no opening paragraph under the H1 that says what the page offers.', `Open with one or two sentences that directly say what ${quote(topicOf(doc, analysis), 40)} is and who it is for.`);
      }
      const words = countWords(lead);
      if (words > 80) {
        return warn(0.6, `The opening paragraph runs to ${words} words before it gets to the point.`, 'Lead with a one- or two-sentence summary (under 60 words), then expand below it.');
      }
      return pass(`The page opens with a ${words}-word summary: ${quote(lead, 80)}.`);
    },
  },
  {
    id: 'aeo.questionHeadings',
    dimension: 'aeo',
    category: 'answers',
    label: 'Question-led headings',
    weight: 5,
    severity: 'suggestion',
    applicableTo: ['page', 'product', 'article'],
    target: { area: 'sections' },
    evaluate(doc, analysis) {
      if (analysis.wordCount < 250) return notApplicable('A short page; question headings are not expected.');
      const questions = analysis.questionHeadings.length + analysis.faqs.length;
      if (questions > 0) return pass(`${plural(questions, 'question')} phrased the way people ask them.`);
      const subheads = analysis.headings.filter((heading) => heading.level === 2).length;
      return warn(0.4, `None of the ${plural(subheads, 'subheading')} is phrased as a question.`, `Where a section answers something customers ask, make its H2 that question — e.g. “What does ${topicOf(doc, analysis)} include?”.`);
    },
  },
  {
    id: 'aeo.answerAfterQuestion',
    dimension: 'aeo',
    category: 'answers',
    label: 'Concise answers',
    weight: 5,
    severity: 'improvement',
    applicableTo: ['page', 'product', 'article', 'homepage'],
    target: { area: 'content' },
    evaluate(_doc, analysis) {
      const questions = analysis.questionHeadings;
      const faqs = analysis.faqs;
      if (questions.length === 0 && faqs.length === 0) return notApplicable('No questions on the page to answer.');
      const concise = (text: string | null) => {
        const words = text ? countWords(text) : 0;
        return words >= 12 && words <= 90;
      };
      const answered = questions.filter((question) => concise(question.answer));
      const faqAnswered = faqs.filter((faq) => concise(faq.answer));
      const total = questions.length + faqs.length;
      const good = answered.length + faqAnswered.length;
      if (good === total) return pass(`Every question (${total}) is followed by a concise answer.`);
      const unanswered = questions.filter((question) => !concise(question.answer)).map((question) => quote(question.text, 45));
      const faqGaps = faqs.filter((faq) => !concise(faq.answer)).map((faq) => quote(faq.question, 45));
      return warn(good / total, `${good} of ${total} questions have a concise answer straight after them.`, `Add a concise answer below this H2: ${listNames([...unanswered, ...faqGaps], 2)} — 20–60 words that answer it outright before any detail.`);
    },
  },
  {
    id: 'aeo.faq',
    dimension: 'aeo',
    category: 'answers',
    label: 'FAQ content',
    weight: 5,
    severity: 'suggestion',
    applicableTo: ['homepage', 'page', 'product', 'article'],
    target: { area: 'sections' },
    evaluate(doc, analysis) {
      const count = analysis.faqs.length;
      if (count >= 2) return pass(`${plural(count, 'question')} answered in an FAQ section.`);
      if (count === 1) return warn(0.6, 'The FAQ section has only one question.', 'Add 3–5 genuine customer questions, taken from sales calls or support tickets.');
      if (analysis.wordCount < SUBSTANTIAL) return notApplicable(`A focused ${KIND_LABELS[doc.kind]}; an FAQ is optional here.`);
      return warn(0.3, 'This page has no FAQ or answer-oriented content.', 'Add 3–5 genuine customer questions in an FAQ section — the ones your team actually hears.');
    },
  },
  {
    id: 'aeo.faqMarkup',
    dimension: 'aeo',
    category: 'structuredData',
    label: 'FAQ structured data',
    weight: 4,
    severity: 'improvement',
    applicableTo: 'all',
    evaluate(doc, analysis) {
      if (analysis.faqs.length === 0) return notApplicable('No FAQ content, so no FAQ markup is expected.');
      const faq = findType(doc.schema, 'FAQPage');
      if (faq) return pass('The FAQ is marked up as FAQPage structured data.');
      return warn(0.3, 'The page shows an FAQ, but it is not marked up as FAQPage.', 'Keep questions in an FAQ section: FAQ markup is generated from those sections automatically.');
    },
  },
  {
    id: 'aeo.structure',
    dimension: 'aeo',
    category: 'readability',
    label: 'Lists and tables',
    weight: 4,
    severity: 'suggestion',
    applicableTo: ['homepage', 'page', 'product', 'article'],
    target: { area: 'content' },
    evaluate(_doc, analysis) {
      if (analysis.wordCount < 300) return notApplicable('A short page; lists and tables are optional.');
      if (analysis.lists + analysis.tables > 0) {
        return pass(`Facts are structured: ${plural(analysis.lists, 'list')} and ${plural(analysis.tables, 'table')}.`);
      }
      return warn(0.5, 'All the copy is prose; nothing is in a list or a table.', 'Turn steps, features or comparable options into a list or a comparison table.');
    },
  },
  {
    id: 'aeo.definitions',
    dimension: 'aeo',
    category: 'answers',
    label: 'Definition',
    weight: 3,
    severity: 'suggestion',
    applicableTo: ['page', 'article', 'category'],
    target: { area: 'content' },
    evaluate(doc, analysis) {
      const subject = doc.meta.keywords[0];
      if (!subject) return notApplicable('Set a primary keyword to check the copy defines it.');
      if (analysis.wordCount < 150) return notApplicable('Too little copy to expect a definition.');
      const defined = analysis.definitions.some((sentence) => containsPhrase(sentence, subject) || overlap(sentence, subject) >= 0.6);
      if (defined) return pass(`The copy defines ${quote(subject, 40)} early on.`);
      return warn(0.5, `The copy never says plainly what ${quote(subject, 40)} is.`, `Open with a one-sentence definition: “${subject} is …”.`);
    },
  },
  {
    id: 'aeo.readability',
    dimension: 'aeo',
    category: 'readability',
    label: 'Readability',
    weight: 4,
    severity: 'improvement',
    applicableTo: 'all',
    target: { area: 'content' },
    evaluate(_doc, analysis) {
      if (analysis.sentences.length < 3) return notApplicable('Too little running text to judge.');
      const average = Math.round(analysis.avgSentenceWords * 10) / 10;
      const long = analysis.longParagraphs;
      if (average <= 20 && long === 0) return pass(`Sentences average ${average} words; paragraphs are a comfortable length.`);
      if (average > 25) return fail(`Sentences average ${average} words — hard to follow and to quote.`, 'Split long sentences; aim for an average under 20 words.');
      return warn(0.6, `Sentences average ${average} words${long > 0 ? ` and ${plural(long, 'paragraph')} run over 120 words` : ''}.`, 'Break long paragraphs into shorter ones that each make one point.');
    },
  },
  {
    id: 'aeo.selfContained',
    dimension: 'aeo',
    category: 'readability',
    label: 'Self-contained sections',
    weight: 2,
    severity: 'suggestion',
    applicableTo: ['page', 'article', 'product'],
    target: { area: 'content' },
    evaluate(_doc, analysis) {
      const opened = analysis.sections.filter((section) => section.firstParagraph);
      if (opened.length < 2) return notApplicable('Fewer than two sections to judge.');
      const dependent = opened.filter((section) => /^(this|it|these|those|that|they|such)\b/i.test(section.firstParagraph!.trim()));
      if (dependent.length === 0) return pass('Each section’s opening sentence makes sense on its own.');
      return warn(0.5, `${plural(dependent.length, 'section')} open with “this” or “it”, which means nothing when quoted alone: ${listNames(dependent.map((section) => quote(section.heading, 40)))}.`, 'Name the subject in the first sentence of each section.');
    },
  },
  {
    id: 'aeo.productFacts',
    dimension: 'aeo',
    category: 'entities',
    label: 'Clear product facts',
    weight: 6,
    severity: 'improvement',
    applicableTo: ['product'],
    target: { area: 'sections' },
    evaluate(doc) {
      const product = doc.product!;
      const facts = [product.price || product.priceNote ? 'price' : '', product.storage ? 'storage' : '', product.users ? 'users' : '', product.specs.length > 0 ? 'specifications' : ''].filter(Boolean);
      if (product.specs.length === 0 && !product.storage && !product.users) {
        return warn(0.3, 'The product has no specifications: no storage, user limits or other facts.', 'Add specifications under Features → Specifications — the facts a buyer compares.', { target: { field: 'specs', area: 'content' } });
      }
      if (!product.specsVisible) {
        return warn(0.5, `The product has ${listNames(facts)}, but no Specifications section shows them on the page.`, 'Product specifications could be converted into structured facts: add a Specifications section to the product’s Page layout.');
      }
      return pass(`Facts are stated plainly: ${listNames(facts)}.`);
    },
  },
  {
    id: 'aeo.entityClarity',
    dimension: 'aeo',
    category: 'entities',
    label: 'Entity named early',
    weight: 4,
    severity: 'improvement',
    applicableTo: ['homepage', 'page', 'product', 'article'],
    target: { area: 'content' },
    evaluate(doc, analysis) {
      const entity = doc.kind === 'homepage' ? doc.entity.organizationName : topicOf(doc, analysis);
      if (!entity) return notApplicable('No entity to look for.');
      const early = [analysis.h1[0] ?? '', analysis.leadParagraph].join(' ');
      if (containsPhrase(early, entity) || overlap(early, entity) >= 0.75) return pass(`${quote(entity, 40)} is named in the heading or the opening paragraph.`);
      return warn(0.4, `${quote(entity, 40)} is not named in the H1 or the opening paragraph.`, `Name ${quote(entity, 40)} in the first paragraph, so the page is unambiguous about what it describes.`);
    },
  },
  {
    id: 'aeo.breadcrumbs',
    dimension: 'aeo',
    category: 'structuredData',
    label: 'Breadcrumbs',
    weight: 3,
    severity: 'improvement',
    applicableTo: ['page', 'product', 'article', 'category', 'tag', 'archive'],
    evaluate(doc) {
      const crumbs = findType(doc.schema, 'BreadcrumbList');
      const items = Array.isArray(crumbs?.itemListElement) ? (crumbs!.itemListElement as unknown[]).length : 0;
      if (items >= 2) return pass(`Breadcrumb trail of ${items} steps.`);
      return fail('No breadcrumb trail is described for this page.', 'Breadcrumbs are generated automatically; if they are missing, the page is being treated as a homepage.');
    },
  },
  {
    id: 'aeo.schema',
    dimension: 'aeo',
    category: 'structuredData',
    label: 'Relevant schema',
    weight: 4,
    severity: 'improvement',
    applicableTo: 'all',
    evaluate(_doc, analysis) {
      const gaps = schemaGaps(analysis.schema);
      const expected = analysis.schema.items.filter((item) => item.expected);
      if (gaps.absent.length === 0 && gaps.incomplete.length === 0) return pass(`All ${plural(expected.length, 'expected type')} present and complete.`);
      const good = expected.length - gaps.absent.length - gaps.incomplete.length * 0.5;
      return warn(Math.max(0, good / Math.max(1, expected.length)), `Schema gaps: ${[...gaps.absent.map((type) => `${type} missing`), ...gaps.incomplete.map((gap) => `${gap.type} incomplete`)].join(', ')}.`, `${schemaGapFix(gaps)}. The markup is built from the page’s own fields, so filling those in completes it.`);
    },
  },
  {
    id: 'aeo.author',
    dimension: 'aeo',
    category: 'trust',
    label: 'Author information',
    weight: 5,
    severity: 'improvement',
    applicableTo: ['article'],
    target: { field: 'author', area: 'organise' },
    evaluate(doc) {
      const article = doc.article!;
      if (!article.author) return fail('The article has no author.', 'Add author information to improve content attribution: choose an author under Organise.');
      if (!article.authorVisible) return warn(0.5, `${article.author.name} is set as author but the article layout does not show it.`, 'Show the author in the Article header or add an Author box in Blog Layout.');
      if (!article.author.jobTitle && !article.author.url && !article.author.bio) {
        return warn(0.6, `The author ${quote(article.author.name)} has no job title, bio or profile link.`, 'Add a job title, a short bio and a profile link to the author’s staff profile.');
      }
      return pass(`Written by ${article.author.name}${article.author.jobTitle ? `, ${article.author.jobTitle}` : ''}.`);
    },
  },
  {
    id: 'aeo.dates',
    dimension: 'aeo',
    category: 'trust',
    label: 'Published and updated dates',
    weight: 3,
    severity: 'suggestion',
    applicableTo: ['article'],
    evaluate(doc) {
      const article = doc.article!;
      if (!article.datesVisible) return warn(0.5, 'The article does not show when it was published or updated.', 'Switch on the date in the Article header (Blog Layout).');
      const age = monthsSince(article.updatedAt);
      if (age !== null && age > 18) return warn(0.6, `The dates are shown, but the article was last updated ${age} months ago.`, 'Review the article and update anything that has changed.');
      return pass('Published and updated dates are shown.');
    },
  },
  {
    id: 'aeo.archiveIntro',
    dimension: 'aeo',
    category: 'answers',
    label: 'Archive introduction',
    weight: 3,
    severity: 'suggestion',
    applicableTo: ['category', 'tag', 'archive'],
    target: { field: 'seoDescription', area: 'seo' },
    evaluate(doc, analysis) {
      if (doc.archive && doc.archive.itemCount === 0) return info('The archive lists no articles yet.');
      if (analysis.paragraphs.some((paragraph) => countWords(paragraph) >= 15)) return pass('The archive introduces what it covers.');
      return warn(0.4, 'The archive lists articles without saying what they have in common.', 'Add a one- or two-sentence description in the Blog hero explaining what the archive covers.');
    },
  },
];

export function scoreAeo(doc: SeoDocument, analysis: DocumentAnalysis): ScoreBreakdown {
  return runChecks(AEO_CHECKS, doc, analysis);
}

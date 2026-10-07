import {
  containsPhrase,
  countPhraseTokens,
  countWords,
  factsIn,
  isDefinition,
  isGenericAnchor,
  isQuestion,
  isStatistic,
  sentences as splitSentences,
  slugCoversKeyword,
  superlativesIn,
  tokens,
} from './content/text';
import { analyzeSchema } from './schema-analysis';
import type {
  ContentImage,
  ContentLink,
  KeywordAnalysis,
  KeywordPlacement,
  SchemaAnalysis,
  SeoDocument,
} from './types';

/**
 * Everything the checks need to know about a document, worked out once.
 *
 * Checks read this rather than walking the content themselves, so a document
 * is tokenised once however many checks look at it, and every check sees the
 * same facts.
 */
export type DocumentAnalysis = {
  headings: Array<{ level: number; text: string }>;
  h1: string[];
  paragraphs: string[];
  bodyText: string;
  bodyTokens: string[];
  wordCount: number;
  /** The first paragraph with something to say, after the H1. */
  leadParagraph: string;
  lists: number;
  listItems: number;
  tables: number;
  faqs: Array<{ question: string; answer: string }>;
  /** Headings phrased as questions, with the paragraph that follows each. */
  questionHeadings: Array<{ text: string; level: number; answer: string | null }>;
  /** Each H2 section's opening paragraph, for answer-first checks. */
  sections: Array<{ heading: string; firstParagraph: string | null; words: number }>;
  links: {
    internal: ContentLink[];
    external: ContentLink[];
    generic: ContentLink[];
    empty: ContentLink[];
    /** Cards the page fills from the catalogue or the blog. */
    collections: number;
  };
  images: {
    /** Images that should describe themselves. */
    meaningful: ContentImage[];
    missingAlt: ContentImage[];
    duplicateAlts: string[];
    heavy: ContentImage[];
  };
  sentences: string[];
  avgSentenceWords: number;
  longParagraphs: number;
  facts: number;
  superlatives: Array<{ sentence: string; words: string[]; supported: boolean }>;
  statistics: Array<{ sentence: string; supported: boolean }>;
  definitions: string[];
  keywords: KeywordAnalysis[];
  schema: SchemaAnalysis;
};

/** Where a link goes: this site, another site, or nowhere a crawler follows. */
export function linkScope(href: string, siteOrigin: string): 'internal' | 'external' | 'other' {
  const value = href.trim();
  if (!value || value.startsWith('#')) return 'other';
  if (/^(mailto|tel|sms|javascript):/i.test(value)) return 'other';
  if (value.startsWith('/') && !value.startsWith('//')) return 'internal';
  try {
    const url = new URL(value.startsWith('//') ? `https:${value}` : value);
    const origin = new URL(siteOrigin);
    const bare = (host: string) => host.replace(/^www\./, '');
    return bare(url.host) === bare(origin.host) ? 'internal' : 'external';
  } catch {
    // A relative path without a leading slash resolves on this site.
    return /^[a-z0-9]/i.test(value) && !value.includes(':') ? 'internal' : 'other';
  }
}

const LONG_PARAGRAPH_WORDS = 120;
const HEAVY_IMAGE_BYTES = 500 * 1024;

export function analyzeDocument(doc: SeoDocument): DocumentAnalysis {
  const headings: Array<{ level: number; text: string }> = [];
  const paragraphs: string[] = [];
  const textParts: string[] = [];
  const faqs: Array<{ question: string; answer: string }> = [];
  const links: ContentLink[] = [];
  const images: ContentImage[] = [];
  let lists = 0;
  let listItems = 0;
  let tables = 0;
  let collections = 0;

  const questionHeadings: DocumentAnalysis['questionHeadings'] = [];
  const sections: DocumentAnalysis['sections'] = [];
  let openSection: DocumentAnalysis['sections'][number] | null = null;
  let pendingQuestion: DocumentAnalysis['questionHeadings'][number] | null = null;
  let seenH1 = false;
  let leadParagraph = '';

  for (const node of doc.content) {
    switch (node.type) {
      case 'heading': {
        headings.push({ level: node.level, text: node.text });
        textParts.push(node.text);
        if (node.level === 1) seenH1 = true;
        pendingQuestion = null;
        if (node.level <= 3 && isQuestion(node.text)) {
          pendingQuestion = { text: node.text, level: node.level, answer: null };
          questionHeadings.push(pendingQuestion);
        }
        if (node.level === 2) {
          openSection = { heading: node.text, firstParagraph: null, words: 0 };
          sections.push(openSection);
        }
        break;
      }
      case 'paragraph': {
        paragraphs.push(node.text);
        textParts.push(node.text);
        const words = countWords(node.text);
        if (pendingQuestion && pendingQuestion.answer === null) pendingQuestion.answer = node.text;
        if (openSection) {
          openSection.words += words;
          if (openSection.firstParagraph === null) openSection.firstParagraph = node.text;
        }
        // The lead is the first real paragraph: after the H1 when there is
        // one, and long enough to be copy rather than an eyebrow or a label.
        if (!leadParagraph && (seenH1 || doc.kind !== 'article') && words >= 12) {
          leadParagraph = node.text;
        }
        break;
      }
      case 'list':
        lists += 1;
        listItems += node.items.length;
        textParts.push(node.items.join('. '));
        if (openSection) openSection.words += countWords(node.items.join(' '));
        break;
      case 'table':
        tables += 1;
        textParts.push(node.rows.map((row) => row.join(' ')).join('. '));
        break;
      case 'faq':
        faqs.push({ question: node.question, answer: node.answer });
        textParts.push(`${node.question} ${node.answer}`);
        break;
      case 'collection':
        collections += node.count;
        break;
      case 'image':
        images.push(node);
        break;
      case 'link':
        links.push(node);
        break;
    }
  }

  const bodyText = textParts.join('\n');
  const bodyTokens = tokens(bodyText);
  const wordCount = bodyTokens.length;
  const allSentences = splitSentences(paragraphs.join(' '));
  const avgSentenceWords =
    allSentences.length > 0
      ? allSentences.reduce((total, sentence) => total + countWords(sentence), 0) / allSentences.length
      : 0;

  // --- links -------------------------------------------------------------
  const origin = (() => {
    try {
      return new URL(doc.absoluteUrl).origin;
    } catch {
      return 'https://localhost';
    }
  })();
  const internal: ContentLink[] = [];
  const external: ContentLink[] = [];
  for (const link of links) {
    const scope = linkScope(link.href, origin);
    if (scope === 'internal') internal.push(link);
    else if (scope === 'external') external.push(link);
  }
  const followed = [...internal, ...external];

  // --- images ------------------------------------------------------------
  const meaningful = images.filter((image) => !image.decorative);
  const missingAlt = meaningful.filter((image) => !image.alt.trim());
  const altCounts = new Map<string, Set<string>>();
  for (const image of meaningful) {
    const alt = image.alt.trim().toLowerCase();
    if (!alt) continue;
    const sources = altCounts.get(alt) ?? new Set<string>();
    sources.add(image.src ?? '');
    altCounts.set(alt, sources);
  }
  const duplicateAlts = [...altCounts.entries()]
    .filter(([, sources]) => sources.size > 1)
    .map(([alt]) => alt);

  // --- claims ------------------------------------------------------------
  const paragraphHasSource = (sentence: string) =>
    /\b(?:according to|source|reported|survey|study|research|per)\b/i.test(sentence);
  const superlatives = allSentences
    .map((sentence) => ({ sentence, words: superlativesIn(sentence) }))
    .filter((entry) => entry.words.length > 0)
    .map((entry) => ({
      ...entry,
      supported: factsIn(entry.sentence) > 0 || paragraphHasSource(entry.sentence),
    }));
  const statistics = allSentences
    .filter((sentence) => isStatistic(sentence))
    .map((sentence) => ({
      sentence,
      supported: paragraphHasSource(sentence) || /\b(?:19|20)\d{2}\b/.test(sentence),
    }));
  const definitions = allSentences.slice(0, 12).filter((sentence) => isDefinition(sentence));

  const analysis: Omit<DocumentAnalysis, 'keywords' | 'schema'> = {
    headings,
    h1: headings.filter((heading) => heading.level === 1).map((heading) => heading.text),
    paragraphs,
    bodyText,
    bodyTokens,
    wordCount,
    leadParagraph,
    lists,
    listItems,
    tables,
    faqs,
    questionHeadings,
    sections,
    links: {
      internal,
      external,
      generic: followed.filter((link) => link.text && isGenericAnchor(link.text)),
      empty: followed.filter((link) => !link.text.trim()),
      collections,
    },
    images: {
      meaningful,
      missingAlt,
      duplicateAlts,
      heavy: meaningful.filter((image) => (image.bytes ?? 0) > HEAVY_IMAGE_BYTES),
    },
    sentences: allSentences,
    avgSentenceWords,
    longParagraphs: paragraphs.filter((paragraph) => countWords(paragraph) > LONG_PARAGRAPH_WORDS).length,
    facts: factsIn(bodyText),
    superlatives,
    statistics,
    definitions,
  };

  return {
    ...analysis,
    keywords: doc.meta.keywords.map((keyword, index) => analyzeKeyword(doc, analysis, keyword, index + 1)),
    schema: analyzeSchema(doc, faqs.length > 0),
  };
}

/** Density above which copy reads as written for the keyword, not the reader. */
export const DENSITY_WARNING = 3;
export const DENSITY_FAIL = 5;

function analyzeKeyword(
  doc: SeoDocument,
  analysis: Omit<DocumentAnalysis, 'keywords' | 'schema'>,
  keyword: string,
  position: number,
): KeywordAnalysis {
  const phrase = tokens(keyword);
  const occurrences = countPhraseTokens(analysis.bodyTokens, phrase);
  // Keyphrase density as editors know it: uses per hundred words, whatever
  // the phrase's length, so a product name is not penalised for being two words.
  const density =
    analysis.wordCount > 0 ? Math.round((occurrences / analysis.wordCount) * 1000) / 10 : 0;

  const placements: Record<KeywordPlacement, boolean | null> = {
    title: containsPhrase(doc.meta.title, keyword),
    description: doc.meta.description ? containsPhrase(doc.meta.description, keyword) : false,
    // The home page's URL is the domain: there is no slug to put it in.
    url: doc.kind === 'homepage' ? null : slugCoversKeyword(doc.slug, keyword),
    h1: analysis.h1.length > 0 ? analysis.h1.some((text) => containsPhrase(text, keyword)) : false,
    firstParagraph: analysis.leadParagraph ? containsPhrase(analysis.leadParagraph, keyword) : false,
    headings: analysis.headings
      .filter((heading) => heading.level === 2 || heading.level === 3)
      .some((heading) => containsPhrase(heading.text, keyword)),
    body: occurrences > 0,
    imageAlt:
      analysis.images.meaningful.length > 0
        ? analysis.images.meaningful.some((image) => containsPhrase(image.alt, keyword))
        : null,
  };

  const overused =
    (analysis.wordCount >= 150 && density > DENSITY_WARNING) || (occurrences >= 15 && density > 2);
  const inHeadline = Boolean(placements.title || placements.h1);
  const status: KeywordAnalysis['status'] = overused
    ? 'overused'
    : !Object.values(placements).some(Boolean)
      ? 'missing'
      : placements.title && (placements.h1 || placements.headings) && placements.body && (placements.description || placements.firstParagraph)
        ? 'strong'
        : inHeadline && placements.body
          ? 'good'
          : 'weak';

  return { keyword, position, placements, occurrences, density, status };
}

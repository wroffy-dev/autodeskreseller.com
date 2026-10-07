/**
 * Text handling for SEO Intelligence.
 *
 * Pure string work, identical on the server and in the browser, so a phrase
 * found by the editor's live score is found by the dashboard too. Matching is
 * case-, accent- and punctuation-insensitive and tolerates a plural ending, so
 * "cloud storage" is found in "Cloud-storage" and "cloud storages" — but it is
 * always a whole-word match: "car" is never found inside "careful".
 */

/** Lower case, accents stripped, everything but letters and digits a space. */
export function normaliseText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function tokens(value: string): string[] {
  const normal = normaliseText(value);
  return normal ? normal.split(' ') : [];
}

export function countWords(value: string): number {
  return tokens(value).length;
}

/** Two tokens are the same word, allowing a plural `s`/`es` either way. */
function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 3 || b.length < 3) return false;
  return a === `${b}s` || b === `${a}s` || a === `${b}es` || b === `${a}es`;
}

/** Whole-phrase occurrences of `phrase` in `haystack`, both already tokenised. */
export function countPhraseTokens(haystack: readonly string[], phrase: readonly string[]): number {
  if (phrase.length === 0 || haystack.length < phrase.length) return 0;
  let count = 0;
  for (let start = 0; start <= haystack.length - phrase.length; start += 1) {
    let matched = true;
    for (let offset = 0; offset < phrase.length; offset += 1) {
      if (!sameWord(haystack[start + offset]!, phrase[offset]!)) {
        matched = false;
        break;
      }
    }
    if (matched) {
      count += 1;
      start += phrase.length - 1;
    }
  }
  return count;
}

export function countPhrase(text: string, phrase: string): number {
  return countPhraseTokens(tokens(text), tokens(phrase));
}

export function containsPhrase(text: string, phrase: string): boolean {
  return countPhrase(text, phrase) > 0;
}

/** Words that carry no meaning in a URL slug or a comparison. */
export const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'how',
  'in',
  'into',
  'is',
  'it',
  'its',
  'of',
  'on',
  'or',
  'our',
  'that',
  'the',
  'their',
  'this',
  'to',
  'vs',
  'was',
  'what',
  'when',
  'which',
  'why',
  'with',
  'you',
  'your',
]);

export function meaningfulTokens(value: string): string[] {
  return tokens(value).filter((token) => !STOP_WORDS.has(token));
}

/**
 * Whether a slug is about a keyword: every meaningful word of the keyword is
 * in the slug, in any order. A slug is rarely the keyword verbatim.
 */
export function slugCoversKeyword(slug: string, keyword: string): boolean {
  const wanted = meaningfulTokens(keyword);
  if (wanted.length === 0) return false;
  const present = tokens(slug.replace(/[\/_]+/g, ' '));
  return wanted.every((word) => present.some((candidate) => sameWord(candidate, word)));
}

/** Share of `b`'s meaningful words that `a` also uses, 0–1. */
export function overlap(a: string, b: string): number {
  const left = new Set(meaningfulTokens(a));
  const right = meaningfulTokens(b);
  if (right.length === 0 || left.size === 0) return 0;
  const shared = right.filter((word) => [...left].some((candidate) => sameWord(candidate, word)));
  return new Set(shared).size / new Set(right).size;
}

/** Sentences, split on terminal punctuation. Whitespace-only pieces dropped. */
export function sentences(value: string): string[] {
  return value
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[\p{Lu}\p{N}"'“‘(])/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => countWords(sentence) > 0);
}

const INTERROGATIVES = new Set([
  'what',
  'how',
  'why',
  'when',
  'where',
  'which',
  'who',
  'whom',
  'whose',
  'can',
  'could',
  'does',
  'do',
  'did',
  'is',
  'are',
  'was',
  'were',
  'should',
  'will',
  'would',
  'may',
  'might',
  'has',
  'have',
]);

/** A heading or phrase written as a question someone would ask. */
export function isQuestion(value: string): boolean {
  const text = value.trim();
  if (!text) return false;
  if (text.endsWith('?')) return true;
  const [first] = tokens(text);
  return Boolean(first && INTERROGATIVES.has(first) && countWords(text) >= 3 && countWords(text) <= 20);
}

/** Link text that says nothing about where the link goes. */
export const GENERIC_ANCHORS = new Set([
  'click here',
  'here',
  'click',
  'read more',
  'more',
  'learn more',
  'this',
  'this page',
  'link',
  'continue',
  'go',
  'details',
  'more info',
  'find out more',
]);

export function isGenericAnchor(text: string): boolean {
  return GENERIC_ANCHORS.has(normaliseText(text));
}

/**
 * Claims that need evidence to be believed — by a reader or a model.
 *
 * Deliberately a short, conservative list: "best practice" and "leading
 * slash" are not boasts, so multi-word exceptions are filtered out below.
 */
const SUPERLATIVES = [
  'best',
  'leading',
  'world class',
  'world-class',
  'number one',
  '#1',
  'no 1',
  'unmatched',
  'unrivalled',
  'unrivaled',
  'unbeatable',
  'revolutionary',
  'ultimate',
  'cheapest',
  'fastest',
  'guaranteed',
  'industry leading',
  'industry-leading',
  'cutting edge',
  'cutting-edge',
  'state of the art',
  'second to none',
  'perfect',
];

const NOT_A_BOAST = ['best practice', 'best practices', 'leading slash', 'leading zero', 'leading zeros'];

/** The superlatives a sentence uses, if any. */
export function superlativesIn(sentence: string): string[] {
  const lower = ` ${sentence.toLowerCase()} `;
  const cleaned = NOT_A_BOAST.reduce((text, phrase) => text.split(phrase).join(' '), lower);
  return SUPERLATIVES.filter((word) => {
    if (word.startsWith('#')) return cleaned.includes(word);
    return new RegExp(`(^|[^a-z])${word.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}([^a-z]|$)`).test(
      cleaned,
    );
  });
}

/** A number with a unit, a currency, a percentage or a year: a checkable fact. */
export function factsIn(text: string): number {
  const patterns = [
    /\b\d+(?:[.,]\d+)?\s?(?:%|percent)\b/gi,
    /(?:₹|\$|€|£|AED|INR|USD|EUR|GBP|QAR|SAR)\s?\d/g,
    /\b\d+(?:[.,]\d+)?\s?(?:tb|gb|mb|kb|users?|seats?|days?|hours?|minutes?|months?|years?|x)\b/gi,
    /\b(?:19|20)\d{2}\b/g,
  ];
  return patterns.reduce((total, pattern) => total + (text.match(pattern)?.length ?? 0), 0);
}

/** A sentence that states a statistic. */
export function isStatistic(sentence: string): boolean {
  return /\b\d+(?:[.,]\d+)?\s?(?:%|percent)|\b\d{1,3}(?:,\d{3})+\b|\b\d+(?:\.\d+)?\s?(?:million|billion|thousand)\b/i.test(
    sentence,
  );
}

/** Definitional phrasing: "X is a …", "X refers to …", "X means …". */
export function isDefinition(sentence: string): boolean {
  return /\b(?:is an?|are|refers to|means|is the|is defined as|stands for)\b/i.test(sentence);
}

/**
 * A 32-bit FNV-1a hash of normalised text, as hex.
 *
 * Deterministic and dependency-free, which is all duplicate detection needs:
 * two pages with the same words produce the same fingerprint.
 */
export function fingerprint(value: string): string {
  let hash = 0x811c9dc5;
  const text = normaliseText(value);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function clip(value: string, length = 80): string {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > length ? `${text.slice(0, length - 1).trimEnd()}…` : text;
}

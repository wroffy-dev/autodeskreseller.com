import 'server-only';
import { keywordKey } from '@/lib/seo/keywords';
import { countWords, fingerprint, normaliseText } from '@/lib/seo/content/text';
import type { SeoDocument } from '@/lib/seo/types';

/**
 * What one URL has in common with the others in its market.
 *
 * Titles, descriptions, first keywords and copy, compared across every other
 * URL in the same market that is live — what search engines actually see. A
 * market is compared with itself only: India and the UAE having the same page
 * in two markets is the multi-market design, not duplication.
 */

export type IndexEntry = {
  key: string;
  countryId: string;
  name: string;
  path: string;
  live: boolean;
  title: string;
  description: string | null;
  keyword: string | null;
  keywordLabel: string | null;
  content: string | null;
};

export const documentKey = (doc: Pick<SeoDocument, 'entityType' | 'entityId' | 'country'>) =>
  `${doc.entityType}:${doc.entityId}:${doc.country.id}`;

/** The page's visible copy as one string: what duplicate detection compares. */
export function documentText(doc: SeoDocument): string {
  return doc.content
    .map((node) => {
      switch (node.type) {
        case 'heading':
        case 'paragraph':
          return node.text;
        case 'list':
          return node.items.join(' ');
        case 'table':
          return node.rows.map((row) => row.join(' ')).join(' ');
        case 'faq':
          return `${node.question} ${node.answer}`;
        default:
          return '';
      }
    })
    .filter(Boolean)
    .join(' ');
}

/** Kinds whose copy is their own. Archives share the blog's listing layout by design. */
const OWN_COPY = new Set(['homepage', 'page', 'product', 'article']);

export function indexEntry(doc: SeoDocument): IndexEntry {
  const text = OWN_COPY.has(doc.kind) ? documentText(doc) : '';
  const keyword = doc.meta.keywords[0] ?? null;
  return {
    key: documentKey(doc),
    countryId: doc.country.id,
    name: doc.name,
    path: doc.path,
    live: doc.status.live,
    title: normaliseText(doc.meta.title),
    // A default description is already reported by its own check; counting
    // it here too would report the same problem twice.
    description: doc.meta.descriptionSource === 'default' ? null : normaliseText(doc.meta.description),
    keyword: keyword ? keywordKey(keyword) : null,
    keywordLabel: keyword,
    content: text && countWords(text) >= 50 ? fingerprint(text) : null,
  };
}

/** The document, with what it shares with the live URLs of its market. */
export function withCollisions(doc: SeoDocument, entries: readonly IndexEntry[]): SeoDocument {
  const self = indexEntry(doc);
  const others = entries.filter(
    (entry) => entry.live && entry.key !== self.key && entry.countryId === self.countryId,
  );
  const ref = (entry: IndexEntry) => ({ name: entry.name, path: entry.path });
  return {
    ...doc,
    collisions: {
      title: self.title ? others.filter((entry) => entry.title === self.title).map(ref) : [],
      description: self.description
        ? others.filter((entry) => entry.description === self.description).map(ref)
        : [],
      keyword: self.keyword
        ? others
            .filter((entry) => entry.keyword === self.keyword)
            .map((entry) => ({ ...ref(entry), keyword: self.keywordLabel ?? '' }))
        : [],
      content: self.content ? others.filter((entry) => entry.content === self.content).map(ref) : [],
    },
  };
}

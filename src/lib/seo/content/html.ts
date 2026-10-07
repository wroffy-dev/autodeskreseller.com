import type { ContentNode } from '../types';

/**
 * Rich text, read the way a crawler reads it.
 *
 * Turns an HTML fragment — an article body, a rich-text section, an FAQ answer
 * — into the content nodes the scoring engine works with: headings with their
 * level, paragraphs, lists, tables, links and images with their alt text.
 *
 * A small tokenizer rather than a DOM, so it runs identically on the server and
 * in the browser and never needs one. The HTML it reads has already been
 * through the sanitizer, so it is well-formed enough for this: unclosed tags
 * are closed at the end, and anything unexpected is read as text.
 */

const TOKEN = /<!--[\s\S]*?-->|<\/?([a-zA-Z][a-zA-Z0-9-]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+)|</g;
const ATTRIBUTE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

const BLOCK_TAGS = new Set([
  'p',
  'div',
  'section',
  'article',
  'header',
  'footer',
  'aside',
  'blockquote',
  'pre',
  'figure',
  'figcaption',
  'address',
  'main',
  'nav',
  'details',
  'summary',
  'hr',
  'dl',
  'dt',
  'dd',
]);

const SKIPPED = new Set(['script', 'style', 'noscript', 'template', 'svg', 'iframe', 'object']);

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  hellip: '…',
  copy: '©',
  reg: '®',
  trade: '™',
  bull: '•',
  middot: '·',
  times: '×',
  rarr: '→',
  larr: '←',
};

export function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === '#') {
      const code =
        entity[1]?.toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

function attributes(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const match of raw.matchAll(ATTRIBUTE)) {
    const name = match[1]!.toLowerCase();
    result[name] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return result;
}

const squash = (value: string) => value.replace(/\s+/g, ' ').trim();

/** Plain text of an HTML fragment. */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return '';
  return htmlToNodes(html)
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

export function htmlToNodes(html: string | null | undefined, source?: string): ContentNode[] {
  const nodes: ContentNode[] = [];
  if (!html || !html.trim()) return nodes;

  let paragraph = '';
  let heading: { level: 1 | 2 | 3 | 4 | 5 | 6; text: string } | null = null;
  const lists: Array<{ ordered: boolean; items: string[]; current: string | null }> = [];
  let table: { rows: string[][]; row: string[] | null; cell: string | null; caption: string } | null =
    null;
  let captionOpen = false;
  let link: { href: string; text: string } | null = null;
  let skipping: string | null = null;

  const emitParagraph = () => {
    const text = squash(paragraph);
    paragraph = '';
    if (text) nodes.push({ type: 'paragraph', text, source });
  };

  const append = (text: string) => {
    if (link) link.text += text;
    if (heading) heading.text += text;
    else if (table && captionOpen) table.caption += text;
    else if (table && table.cell !== null) table.cell += text;
    else if (lists.length > 0 && lists[lists.length - 1]!.current !== null) {
      lists[lists.length - 1]!.current += text;
    } else paragraph += text;
  };

  const closeListItem = (list: { items: string[]; current: string | null }) => {
    if (list.current === null) return;
    const text = squash(list.current);
    if (text) list.items.push(text);
    list.current = null;
  };

  const closeHeading = () => {
    if (!heading) return;
    const text = squash(heading.text);
    if (text) nodes.push({ type: 'heading', level: heading.level, text, source });
    heading = null;
  };

  const closeTable = () => {
    if (!table) return;
    if (table.cell !== null && table.row) table.row.push(squash(table.cell));
    if (table.row && table.row.some(Boolean)) table.rows.push(table.row);
    if (table.rows.length > 0) {
      nodes.push({
        type: 'table',
        rows: table.rows,
        ...(squash(table.caption) ? { caption: squash(table.caption) } : {}),
        source,
      });
    }
    table = null;
    captionOpen = false;
  };

  for (const match of html.matchAll(TOKEN)) {
    const [whole, rawTag, rawAttributes = '', text] = match;

    if (text !== undefined || whole === '<') {
      if (!skipping) append(decodeEntities(text ?? whole));
      continue;
    }
    if (!rawTag) continue; // a comment

    const tag = rawTag.toLowerCase();
    const closing = whole.startsWith('</');

    if (skipping) {
      if (closing && tag === skipping) skipping = null;
      continue;
    }
    if (SKIPPED.has(tag)) {
      if (!closing && !whole.endsWith('/>')) skipping = tag;
      continue;
    }

    const headingMatch = /^h([1-6])$/.exec(tag);

    if (headingMatch) {
      if (closing) closeHeading();
      else {
        emitParagraph();
        closeHeading();
        heading = { level: Number(headingMatch[1]) as 1 | 2 | 3 | 4 | 5 | 6, text: '' };
      }
      continue;
    }

    switch (tag) {
      case 'br':
        append(' ');
        continue;
      case 'img': {
        if (closing) continue;
        const attrs = attributes(rawAttributes);
        const decorative =
          attrs.alt === '' ||
          attrs.role === 'presentation' ||
          attrs['aria-hidden'] === 'true';
        nodes.push({
          type: 'image',
          src: attrs.src ?? null,
          alt: squash(attrs.alt ?? ''),
          decorative: decorative && 'alt' in attrs,
          width: attrs.width ? Number(attrs.width) || null : null,
          height: attrs.height ? Number(attrs.height) || null : null,
          source,
        });
        continue;
      }
      case 'a': {
        if (closing) {
          if (link) {
            const anchor = squash(link.text);
            nodes.push({ type: 'link', href: link.href, text: anchor, source });
            link = null;
          }
        } else {
          const attrs = attributes(rawAttributes);
          if (attrs.href) link = { href: attrs.href, text: '' };
        }
        continue;
      }
      case 'ul':
      case 'ol': {
        if (closing) {
          const list = lists.pop();
          if (list) {
            closeListItem(list);
            if (list.items.length > 0) {
              nodes.push({ type: 'list', ordered: list.ordered, items: list.items, source });
            }
          }
        } else {
          if (lists.length === 0) emitParagraph();
          lists.push({ ordered: tag === 'ol', items: [], current: null });
        }
        continue;
      }
      case 'li': {
        const list = lists[lists.length - 1];
        if (!list) {
          if (!closing) emitParagraph();
          continue;
        }
        closeListItem(list);
        if (!closing) list.current = '';
        continue;
      }
      case 'table':
        if (closing) closeTable();
        else {
          emitParagraph();
          closeTable();
          table = { rows: [], row: null, cell: null, caption: '' };
        }
        continue;
      case 'caption':
        captionOpen = !closing && table !== null;
        continue;
      case 'tr':
        if (!table) continue;
        if (table.cell !== null && table.row) {
          table.row.push(squash(table.cell));
          table.cell = null;
        }
        if (table.row && table.row.some(Boolean)) table.rows.push(table.row);
        table.row = closing ? null : [];
        continue;
      case 'td':
      case 'th':
        if (!table) continue;
        if (closing) {
          if (table.cell !== null) {
            (table.row ??= []).push(squash(table.cell));
            table.cell = null;
          }
        } else {
          if (table.cell !== null) (table.row ??= []).push(squash(table.cell));
          table.cell = '';
          table.row ??= [];
        }
        continue;
      default:
        break;
    }

    if (BLOCK_TAGS.has(tag)) {
      // Inside a list item, a heading or a table cell a block is still part of
      // that item; everywhere else it ends the paragraph.
      const inItem = lists.length > 0 && lists[lists.length - 1]!.current !== null;
      if (heading || inItem || (table && table.cell !== null)) append(' ');
      else emitParagraph();
    } else {
      // Inline elements separate words the way a browser renders them.
      if (tag === 'span' || tag === 'strong' || tag === 'em' || tag === 'b' || tag === 'i') continue;
      append(' ');
    }
  }

  closeHeading();
  while (lists.length > 0) {
    const list = lists.pop()!;
    closeListItem(list);
    if (list.items.length > 0) nodes.push({ type: 'list', ordered: list.ordered, items: list.items, source });
  }
  closeTable();
  if (link) {
    const pending = link as { href: string; text: string };
    nodes.push({ type: 'link', href: pending.href, text: squash(pending.text), source });
  }
  emitParagraph();

  return nodes;
}

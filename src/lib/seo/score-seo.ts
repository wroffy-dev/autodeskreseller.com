import { DENSITY_FAIL, DENSITY_WARNING, type DocumentAnalysis } from './analysis';
import {
  A_KIND,
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
import { containsPhrase, slugCoversKeyword } from './content/text';
import { schemaGaps } from './schema-analysis';
import type { ScoreBreakdown, SeoDocument, SeoPageKind } from './types';

/**
 * SEO checks: can a search engine find, read, understand and present the page?
 *
 * Metadata, content, URL, social and technical signals, read from what the
 * page actually serves. A deliberate noindex is reported as an exclusion,
 * never as a failure: a page somebody chose to keep out of search is not a
 * worse page for it.
 */

const noKeywords = () =>
  notApplicable('No primary keywords are set, so there is nothing to look for yet.');

const firstKeyword = (doc: SeoDocument) => doc.meta.keywords[0] ?? null;

/** Copy length that gives a page of each kind room to answer its topic. */
const CONTENT_LENGTH: Record<SeoPageKind, { pass: number; warn: number }> = {
  homepage: { pass: 300, warn: 150 },
  page: { pass: 300, warn: 150 },
  product: { pass: 250, warn: 120 },
  article: { pass: 800, warn: 400 },
  category: { pass: 60, warn: 25 },
  tag: { pass: 60, warn: 25 },
  archive: { pass: 60, warn: 25 },
};

/** Internal links a page of each kind should offer onwards. */
const INTERNAL_LINKS: Record<SeoPageKind, number> = {
  homepage: 3,
  page: 2,
  product: 2,
  article: 3,
  category: 1,
  tag: 1,
  archive: 1,
};

const H1_FIX: Record<SeoPageKind, string> = {
  homepage:
    'Make the first section a Hero or Heading & text block: its heading becomes the H1. Other sections render their headings as H2.',
  page: 'Make the first section a Hero or Heading & text block: its heading becomes the H1. Other sections render their headings as H2.',
  product: 'In the product’s Page layout, set the Product header’s title tag to H1 and keep the header visible.',
  article: 'Keep the Article header section visible in Blog Layout: it renders the article title as the H1.',
  category: 'Switch on the heading in the Blog hero section (Blog Layout → Listing): it renders the archive’s H1.',
  tag: 'Switch on the heading in the Blog hero section (Blog Layout → Listing): it renders the archive’s H1.',
  archive: 'Switch on the heading in the Blog hero section (Blog Layout → Listing): it renders the archive’s H1.',
};

export const SEO_CHECKS: readonly SeoCheck[] = [
  // --- metadata ------------------------------------------------------------
  {
    id: 'seo.title.present',
    dimension: 'seo',
    category: 'metadata',
    label: 'SEO title',
    weight: 8,
    severity: 'critical',
    applicableTo: 'all',
    target: { field: 'seoTitle', area: 'seo' },
    evaluate(doc) {
      if (doc.meta.titleSource === 'seo') return pass(`SEO title configured: ${quote(doc.meta.ownTitle)}.`);
      if (doc.meta.titleSource === 'fallback') {
        return warn(
          0.6,
          `No SEO title of its own, so the ${KIND_LABELS[doc.kind]}’s name ${quote(doc.meta.ownTitle)} is used.`,
          'Write an SEO title that says what the page offers and who it is for, leading with the main keyword.',
        );
      }
      return fail(
        `No title at all: the site’s default title ${quote(doc.meta.title)} is served, the same as every other untitled page.`,
        'Add an SEO title describing this page specifically.',
      );
    },
  },
  {
    id: 'seo.title.length',
    dimension: 'seo',
    category: 'metadata',
    label: 'Title length',
    weight: 5,
    severity: 'improvement',
    applicableTo: 'all',
    target: { field: 'seoTitle', area: 'seo' },
    evaluate(doc) {
      if (doc.meta.titleSource === 'default') return notApplicable('The site’s default title is served; see “SEO title”.');
      const length = doc.meta.title.length;
      const shown = `The title as served is ${length} characters: ${quote(doc.meta.title, 90)}.`;
      if (length >= 30 && length <= 60) return pass(shown);
      if (length > 60 && length <= 70) {
        return warn(0.6, `${shown} Search results usually cut titles off around 60 characters.`, 'Shorten the SEO title so the important words come first and nothing essential is cut off. The title template adds its suffix after it.');
      }
      if (length > 70) {
        return fail(`${shown} That is well past the roughly 60 characters search results show.`, 'Cut the SEO title down to about 50–60 characters including the template suffix.');
      }
      if (length >= 20) {
        return warn(0.6, `${shown} Short titles leave room unused.`, 'Add the detail a searcher is looking for: the product, the audience or the market.');
      }
      return fail(`${shown} Too short to describe the page.`, 'Write a descriptive SEO title of 30–60 characters.');
    },
  },
  {
    id: 'seo.title.unique',
    dimension: 'seo',
    category: 'metadata',
    label: 'Unique title',
    weight: 4,
    severity: 'improvement',
    applicableTo: 'all',
    target: { field: 'seoTitle', area: 'seo' },
    evaluate(doc) {
      const others = doc.collisions.title;
      if (others.length === 0) return pass(`No other page in ${doc.country.name} has this title.`);
      return fail(
        `${plural(others.length, 'other page')} in ${doc.country.name} ${others.length === 1 ? 'has' : 'have'} the same title: ${listNames(others.map((other) => other.name))}.`,
        'Give each page a title that says what is different about it, so search engines do not treat them as duplicates.',
      );
    },
  },
  {
    id: 'seo.title.keyword',
    dimension: 'seo',
    category: 'keywords',
    label: 'Primary keyword in title',
    weight: 5,
    severity: 'improvement',
    applicableTo: 'all',
    target: { field: 'seoTitle', area: 'seo' },
    evaluate(doc) {
      const keyword = firstKeyword(doc);
      if (!keyword) return noKeywords();
      if (containsPhrase(doc.meta.title, keyword)) {
        return pass(`The title contains primary keyword 1, ${quote(keyword)}.`);
      }
      const other = doc.meta.keywords.slice(1).find((candidate) => containsPhrase(doc.meta.title, candidate));
      if (other) {
        return warn(0.6, `The title uses ${quote(other)} but not primary keyword 1, ${quote(keyword)}.`, `Work ${quote(keyword)} into the title, ideally near the start, if it reads naturally.`);
      }
      return fail(`None of the primary keywords appears in the title ${quote(doc.meta.title)}.`, `Work ${quote(keyword)} into the SEO title, ideally near the start.`);
    },
  },
  {
    id: 'seo.description.present',
    dimension: 'seo',
    category: 'metadata',
    label: 'Meta description',
    weight: 8,
    severity: 'critical',
    applicableTo: 'all',
    target: { field: 'seoDescription', area: 'seo' },
    evaluate(doc) {
      if (doc.meta.descriptionSource === 'seo') return pass('Meta description configured.');
      if (doc.meta.descriptionSource === 'fallback') {
        return warn(
          0.6,
          `No meta description of its own; the ${doc.kind === 'article' ? 'excerpt' : 'summary'} is used instead: ${quote(doc.meta.description, 90)}.`,
          'Write a meta description that summarises the page and gives a reason to click, in 120–160 characters.',
        );
      }
      return fail(
        'Meta description missing: the site’s default description is served, the same as every other page without one.',
        'Write a meta description specific to this page, 120–160 characters.',
      );
    },
  },
  {
    id: 'seo.description.length',
    dimension: 'seo',
    category: 'metadata',
    label: 'Description length',
    weight: 4,
    severity: 'improvement',
    applicableTo: 'all',
    target: { field: 'seoDescription', area: 'seo' },
    evaluate(doc) {
      if (doc.meta.descriptionSource === 'default') return notApplicable('The site’s default description is served; see “Meta description”.');
      const length = doc.meta.description.length;
      if (length === 0) return fail('The page has no description at all.', 'Write a meta description of 120–160 characters.');
      const shown = `The description is ${length} characters.`;
      if (length >= 120 && length <= 160) return pass(shown);
      if (length >= 70 && length < 120) return warn(0.7, `${shown} A little short.`, 'Add a concrete detail or benefit to reach 120–160 characters.');
      if (length > 160 && length <= 200) return warn(0.6, `${shown} Search results usually cut descriptions off around 160.`, 'Trim it to 160 characters, keeping the key point first.');
      if (length > 200) return warn(0.3, `${shown} Most of it will not be shown.`, 'Rewrite it as one or two sentences of about 150 characters.');
      return fail(`${shown} Too short to summarise the page.`, 'Write a meta description of 120–160 characters.');
    },
  },
  {
    id: 'seo.description.keyword',
    dimension: 'seo',
    category: 'keywords',
    label: 'Primary keyword in description',
    weight: 3,
    severity: 'improvement',
    applicableTo: 'all',
    target: { field: 'seoDescription', area: 'seo' },
    evaluate(doc) {
      if (doc.meta.keywords.length === 0) return noKeywords();
      const found = doc.meta.keywords.find((keyword) => containsPhrase(doc.meta.description, keyword));
      if (found) return pass(`The description mentions ${quote(found)}.`);
      return fail('No primary keyword appears in the meta description.', `Mention ${quote(doc.meta.keywords[0]!)} in the description; search engines bold matching words in results.`);
    },
  },
  {
    id: 'seo.description.unique',
    dimension: 'seo',
    category: 'metadata',
    label: 'Unique description',
    weight: 3,
    severity: 'improvement',
    applicableTo: 'all',
    target: { field: 'seoDescription', area: 'seo' },
    evaluate(doc) {
      const others = doc.collisions.description;
      if (others.length === 0) return pass(`No other page in ${doc.country.name} has this description.`);
      return fail(
        `The same description is used by ${listNames(others.map((other) => other.name))}.`,
        'Write a description for each page that reflects its own content.',
      );
    },
  },
  {
    id: 'seo.canonical',
    dimension: 'seo',
    category: 'technical',
    label: 'Canonical URL',
    weight: 5,
    severity: 'critical',
    applicableTo: 'all',
    target: { field: 'canonicalUrl', area: 'seo' },
    evaluate(doc) {
      const { explicit, self, otherMarket } = doc.meta.canonical;
      if (!explicit) return pass(`Self-referencing canonical generated automatically: ${self}.`);
      let url: URL;
      try {
        url = new URL(explicit);
        if (!/^https?:$/.test(url.protocol)) throw new Error('scheme');
      } catch {
        return fail(`The canonical URL ${quote(explicit)} is not a valid absolute http(s) URL, so search engines ignore it.`, 'Clear the canonical field (the page’s own URL is used) or enter a full URL starting with https://.');
      }
      if (otherMarket) {
        return fail(
          `The canonical points at ${otherMarket}’s version of the page (${explicit}), telling search engines this ${doc.country.name} page is a duplicate that need not be shown.`,
          'Clear the canonical field: each market’s page must canonicalise to its own URL.',
        );
      }
      const normalise = (value: string) => value.replace(/\/+$/, '').toLowerCase();
      if (normalise(explicit) === normalise(self)) return pass('The canonical URL is this page’s own URL.');
      let selfHost = '';
      try {
        selfHost = new URL(self).host;
      } catch {
        selfHost = '';
      }
      if (url.host !== selfHost) {
        return warn(0.3, `The canonical points to another site: ${explicit}. This page will not be indexed in its own right.`, 'Only keep this if the content is syndicated from that site; otherwise clear the field.');
      }
      return warn(0.3, `The canonical points to a different page, ${explicit}, so this URL is unlikely to be indexed.`, 'Clear the canonical field unless this page really duplicates that one.');
    },
  },
  {
    id: 'seo.robots.directives',
    dimension: 'seo',
    category: 'indexability',
    label: 'Robots directives',
    weight: 4,
    severity: 'improvement',
    applicableTo: 'all',
    target: { field: 'noIndex', area: 'seo' },
    evaluate(doc) {
      if (doc.robots.noIndex) return info(noIndexMessage(doc));
      if (doc.robots.noFollow) {
        return warn(0.5, 'The page is indexable but tells search engines not to follow its links (nofollow).', 'Switch nofollow off unless the links really should not pass any credit.');
      }
      return pass('Indexable, and links are followed.');
    },
  },

  // --- content ---------------------------------------------------------------
  {
    id: 'seo.h1',
    dimension: 'seo',
    category: 'content',
    label: 'One visible H1',
    weight: 6,
    severity: 'critical',
    applicableTo: 'all',
    target: { area: 'sections' },
    evaluate(doc, analysis) {
      const h1 = analysis.h1;
      if (h1.length === 1) return pass(`One H1: ${quote(h1[0]!)}.`);
      if (h1.length === 0) return fail(`The ${KIND_LABELS[doc.kind]} has no visible H1.`, H1_FIX[doc.kind]);
      return warn(0.5, `${plural(h1.length, 'H1 heading')}: ${listNames(h1.map((text) => quote(text, 40)))}.`, 'Keep one H1 that names the page’s topic, and make the others H2.');
    },
  },
  {
    id: 'seo.h1.keyword',
    dimension: 'seo',
    category: 'keywords',
    label: 'Primary keyword in H1',
    weight: 4,
    severity: 'improvement',
    applicableTo: 'all',
    target: { area: 'sections' },
    evaluate(doc, analysis) {
      const keyword = firstKeyword(doc);
      if (!keyword) return noKeywords();
      if (analysis.h1.length === 0) return notApplicable('There is no H1 to check (see “One visible H1”).');
      const found = doc.meta.keywords.find((candidate) => analysis.h1.some((text) => containsPhrase(text, candidate)));
      if (found) return pass(`The H1 contains ${quote(found)}.`);
      return warn(0.4, `Primary keyword not present in H1 ${quote(analysis.h1[0]!)}.`, `Where it reads naturally, include ${quote(keyword)} in the H1.`);
    },
  },
  {
    id: 'seo.headings.structure',
    dimension: 'seo',
    category: 'content',
    label: 'Heading hierarchy',
    weight: 4,
    severity: 'improvement',
    applicableTo: 'all',
    target: { area: 'sections' },
    evaluate(doc, analysis) {
      const headings = analysis.headings;
      const h2 = headings.filter((heading) => heading.level === 2).length;
      const h3 = headings.filter((heading) => heading.level === 3).length;
      for (let index = 1; index < headings.length; index += 1) {
        const previous = headings[index - 1]!;
        const current = headings[index]!;
        if (current.level > previous.level + 1) {
          return warn(0.6, `Heading levels skip from H${previous.level} to H${current.level} at ${quote(current.text, 50)}.`, `Make ${quote(current.text, 50)} an H${previous.level + 1}, or add the missing level above it.`);
        }
      }
      const firstH1 = headings.findIndex((heading) => heading.level === 1);
      if (firstH1 > 0) {
        return warn(0.7, `${quote(headings[0]!.text, 50)} (H${headings[0]!.level}) comes before the H1.`, 'Put the H1 first: it introduces everything below it.');
      }
      if (h2 === 0 && analysis.wordCount >= 300) {
        return warn(0.5, `${analysis.wordCount} words with no H2 subheadings.`, 'Break the copy into sections with descriptive H2 subheadings.');
      }
      return pass(`Headings are in order: ${plural(h2, 'H2')} and ${plural(h3, 'H3')}.`);
    },
  },
  {
    id: 'seo.content.length',
    dimension: 'seo',
    category: 'content',
    label: 'Useful copy',
    weight: 8,
    severity: 'improvement',
    applicableTo: 'all',
    target: { area: 'content' },
    evaluate(doc, analysis) {
      const wanted = CONTENT_LENGTH[doc.kind];
      const words = analysis.wordCount;
      const archive = doc.kind === 'category' || doc.kind === 'tag' || doc.kind === 'archive';
      const noun = archive ? 'introduction' : 'copy';
      if (words >= wanted.pass) return pass(`${words} words of visible ${noun}.`);
      if (words >= wanted.warn) {
        return warn(0.5, `${words} words of visible ${noun}; ${wanted.pass}+ gives ${A_KIND[doc.kind]} room to answer what searchers ask.`, archive ? 'Add an introduction to the archive describing what it covers.' : `Expand the ${noun} with specifics: what it is, who it is for, how it works, what it costs.`);
      }
      return fail(`Only ${words} words of visible ${noun} — thin for ${A_KIND[doc.kind]}.`, archive ? 'Add an introduction describing what the archive covers and who it is for.' : `Add substantive ${noun}: aim for at least ${wanted.pass} words that answer real questions.`);
    },
  },
  {
    id: 'seo.keyword.body',
    dimension: 'seo',
    category: 'keywords',
    label: 'Primary keyword in body',
    weight: 5,
    severity: 'improvement',
    applicableTo: 'all',
    target: { area: 'content' },
    evaluate(doc, analysis) {
      const [first] = analysis.keywords;
      if (!first) return noKeywords();
      if (first.occurrences > 0) return pass(`${quote(first.keyword)} appears ${plural(first.occurrences, 'time')} in the copy.`);
      const other = analysis.keywords.find((keyword) => keyword.occurrences > 0);
      if (other) return warn(0.5, `The copy uses ${quote(other.keyword)} but never ${quote(first.keyword)}.`, `Use ${quote(first.keyword)} where it naturally belongs, especially near the top.`);
      return fail('None of the primary keywords appears in the visible copy.', `Write about ${quote(first.keyword)} explicitly: search engines match what the page actually says.`);
    },
  },
  {
    id: 'seo.keyword.density',
    dimension: 'seo',
    category: 'keywords',
    label: 'Keyword overuse',
    weight: 3,
    severity: 'improvement',
    applicableTo: 'all',
    target: { area: 'content' },
    evaluate(doc, analysis) {
      if (analysis.keywords.length === 0) return noKeywords();
      if (analysis.wordCount < 100) return notApplicable('Too little copy to judge keyword frequency.');
      const worst = [...analysis.keywords].sort((a, b) => b.density - a.density)[0]!;
      if (worst.density > DENSITY_FAIL) {
        return fail(`${quote(worst.keyword)} makes up ${worst.density}% of the copy (${worst.occurrences} uses). It reads as written for search engines.`, 'Replace some repetitions with synonyms, pronouns or more specific wording; aim well under 3%.');
      }
      if (worst.status === 'overused' || worst.density > DENSITY_WARNING) {
        return warn(0.4, `${quote(worst.keyword)} makes up ${worst.density}% of the copy (${worst.occurrences} uses).`, 'Vary the wording so the keyword reads naturally.');
      }
      return pass(`Keyword use reads naturally (highest: ${quote(worst.keyword)} at ${worst.density}%).`);
    },
  },
  {
    id: 'seo.links.internal',
    dimension: 'seo',
    category: 'links',
    label: 'Internal links',
    weight: 4,
    severity: 'improvement',
    applicableTo: 'all',
    target: { area: 'content' },
    evaluate(doc, analysis) {
      const count = analysis.links.internal.length + analysis.links.collections;
      const wanted = INTERNAL_LINKS[doc.kind];
      if (count >= wanted) return pass(`${plural(count, 'internal link')}${analysis.links.collections > 0 ? ` (${analysis.links.collections} from product or article cards)` : ''}.`);
      if (count > 0) return warn(0.6, `Only ${plural(count, 'internal link')}.`, `Link to ${wanted}+ related pages on this site with descriptive link text — products, guides or the pricing page.`);
      return fail('No links to other pages on this site.', 'Link to related products, articles or pages so visitors and crawlers can go further.');
    },
  },
  {
    id: 'seo.links.external',
    dimension: 'seo',
    category: 'links',
    label: 'Authoritative external links',
    weight: 2,
    severity: 'suggestion',
    applicableTo: ['article'],
    target: { field: 'content', area: 'content' },
    evaluate(_doc, analysis) {
      const count = analysis.links.external.length;
      if (count > 0) return pass(`${plural(count, 'link')} to other sites.`);
      return warn(0.4, 'The article links to no other site.', 'Where you rely on a fact, link to the authoritative source — vendor documentation, a standard, official statistics.');
    },
  },
  {
    id: 'seo.links.anchors',
    dimension: 'seo',
    category: 'links',
    label: 'Descriptive link text',
    weight: 3,
    severity: 'improvement',
    applicableTo: 'all',
    target: { area: 'content' },
    evaluate(_doc, analysis) {
      const vague = [...analysis.links.generic, ...analysis.links.empty];
      if (vague.length === 0) return pass('Every link says where it goes.');
      const examples = vague.slice(0, 3).map((link) => `${link.text ? quote(link.text, 25) : 'empty link text'} → ${link.href}`);
      return warn(0.5, `${plural(vague.length, 'link')} with vague or empty text: ${examples.join('; ')}.`, 'Use link text that names the destination, e.g. “AutoCAD LT pricing” instead of “click here”.');
    },
  },
  {
    id: 'seo.images.alt',
    dimension: 'seo',
    category: 'images',
    label: 'Image alt text',
    weight: 5,
    severity: 'improvement',
    applicableTo: 'all',
    target: { area: 'media' },
    evaluate(_doc, analysis) {
      const images = analysis.images.meaningful;
      if (images.length === 0) return notApplicable('The page shows no content images.');
      const missing = analysis.images.missingAlt;
      if (missing.length === 0) return pass(`All ${plural(images.length, 'image')} have alt text.`);
      const where = listNames(missing.map((image) => image.source ?? image.src ?? 'an image'));
      const message = `${missing.length} of ${plural(images.length, 'image')} ${missing.length === 1 ? 'is' : 'are'} missing alt text (${where}).`;
      const recommendation = 'Add alt text describing each image — in the section’s alt field, or once in the media library, which every page using the image picks up.';
      return missing.length * 2 > images.length ? fail(message, recommendation) : warn(0.5, message, recommendation);
    },
  },
  {
    id: 'seo.images.altDuplicate',
    dimension: 'seo',
    category: 'images',
    label: 'Distinct alt text',
    weight: 2,
    severity: 'suggestion',
    applicableTo: 'all',
    target: { area: 'media' },
    evaluate(_doc, analysis) {
      if (analysis.images.meaningful.length < 2) return notApplicable('Fewer than two content images.');
      const duplicates = analysis.images.duplicateAlts;
      if (duplicates.length === 0) return pass('Each image has its own alt text.');
      return warn(0.5, `Different images share the same alt text: ${listNames(duplicates.map((alt) => quote(alt, 40)))}.`, 'Describe what is different about each image.');
    },
  },
  {
    id: 'seo.images.weight',
    dimension: 'seo',
    category: 'images',
    label: 'Image file size',
    weight: 2,
    severity: 'suggestion',
    applicableTo: 'all',
    target: { area: 'media' },
    evaluate(_doc, analysis) {
      const measured = analysis.images.meaningful.filter((image) => typeof image.bytes === 'number');
      if (measured.length === 0) return notApplicable('No image sizes are known for this page.');
      const heavy = analysis.images.heavy;
      if (heavy.length === 0) return pass(`All ${plural(measured.length, 'image')} are under 500 KB.`);
      const largest = Math.max(...heavy.map((image) => image.bytes ?? 0));
      const legacy = heavy.filter((image) => /jpe?g|png/i.test(image.mimeType ?? '')).length;
      const message = `${plural(heavy.length, 'image')} over 500 KB (largest ${Math.round(largest / 1024)} KB).`;
      const recommendation = `Resize to the width the page displays and compress${legacy > 0 ? '; WebP or AVIF are usually far smaller than JPEG or PNG' : ''}.`;
      return largest > 1024 * 1024 ? fail(message, recommendation) : warn(0.5, message, recommendation);
    },
  },

  // --- URL --------------------------------------------------------------------
  {
    id: 'seo.url.readable',
    dimension: 'seo',
    category: 'url',
    label: 'Readable URL',
    weight: 3,
    severity: 'improvement',
    applicableTo: ['page', 'product', 'article', 'category', 'tag'],
    target: { field: 'slug', area: 'general' },
    evaluate(doc) {
      const slug = doc.slug;
      const problems: string[] = [];
      if (/[A-Z]/.test(slug)) problems.push('capital letters');
      if (/_/.test(slug)) problems.push('underscores');
      if (/%[0-9a-f]{2}|\s/i.test(slug)) problems.push('encoded characters or spaces');
      if (/--|-$|^-|\/\//.test(slug)) problems.push('doubled or trailing separators');
      if (slug.split('/').some((segment) => /^\d+$/.test(segment))) problems.push('a segment that is only a number');
      if (slug.split('/').length > 4) problems.push('more than four levels of nesting');
      if (problems.length === 0) return pass(`Readable URL: ${doc.path}.`);
      return warn(0.4, `The URL ${doc.path} has ${listNames(problems)}.`, 'Use short, lower-case words separated by hyphens. Changing a live URL needs a redirect from the old one.');
    },
  },
  {
    id: 'seo.url.length',
    dimension: 'seo',
    category: 'url',
    label: 'URL length',
    weight: 2,
    severity: 'suggestion',
    applicableTo: ['page', 'product', 'article', 'category', 'tag'],
    target: { field: 'slug', area: 'general' },
    evaluate(doc) {
      const length = doc.path.length;
      if (length <= 75) return pass(`The path is ${length} characters.`);
      if (length <= 100) return warn(0.5, `The path is ${length} characters.`, 'Shorter URLs are easier to read and share; drop filler words from the slug.');
      return fail(`The path is ${length} characters long.`, 'Shorten the slug to the few words that name the page.');
    },
  },
  {
    id: 'seo.url.keyword',
    dimension: 'seo',
    category: 'keywords',
    label: 'Keyword-relevant URL',
    weight: 3,
    severity: 'suggestion',
    applicableTo: ['page', 'product', 'article', 'category', 'tag'],
    target: { field: 'slug', area: 'general' },
    evaluate(doc) {
      if (doc.meta.keywords.length === 0) return noKeywords();
      const found = doc.meta.keywords.find((keyword) => slugCoversKeyword(doc.slug, keyword));
      if (found) return pass(`The URL covers ${quote(found)}.`);
      return warn(0.3, `The URL ${doc.path} does not contain ${quote(doc.meta.keywords[0]!)}.`, 'For a new page, build the slug from the main keyword. For a live page, only change it if the gain is worth a redirect.');
    },
  },

  // --- social -------------------------------------------------------------------
  {
    id: 'seo.social.ogTitle',
    dimension: 'seo',
    category: 'social',
    label: 'Open Graph title',
    weight: 2,
    severity: 'suggestion',
    applicableTo: 'all',
    target: { field: 'ogTitle', area: 'social' },
    evaluate(doc) {
      if (!doc.social.ogTitle) return fail('No Open Graph title.', 'Add an Open Graph title, or an SEO title it can fall back to.');
      return pass(doc.social.ogTitleExplicit ? `Open Graph title configured: ${quote(doc.social.ogTitle)}.` : `Shares use the SEO title: ${quote(doc.social.ogTitle)}.`);
    },
  },
  {
    id: 'seo.social.ogDescription',
    dimension: 'seo',
    category: 'social',
    label: 'Open Graph description',
    weight: 2,
    severity: 'suggestion',
    applicableTo: 'all',
    target: { field: 'ogDescription', area: 'social' },
    evaluate(doc) {
      if (doc.social.ogDescriptionExplicit) return pass('Open Graph description configured.');
      if (doc.meta.descriptionSource === 'default') {
        return warn(0.4, 'Shares fall back to the site’s default description.', 'Add a meta description or an Open Graph description for this page.');
      }
      return pass('Shares use the page’s meta description.');
    },
  },
  {
    id: 'seo.social.ogImage',
    dimension: 'seo',
    category: 'social',
    label: 'Open Graph image',
    weight: 4,
    severity: 'improvement',
    applicableTo: 'all',
    target: { field: 'ogImage', area: 'social' },
    evaluate(doc) {
      const image = doc.social.ogImage;
      if (!image) return fail('No image is shared when the page is posted to LinkedIn, Slack or X.', 'Choose a share image (1200×630) in the page’s social settings.');
      if (image.source === 'entity') return pass('OpenGraph image configured.');
      if (image.source === 'fallback') return pass(`Shares use the ${doc.kind === 'article' ? 'featured' : 'product'} image.`);
      return warn(0.5, 'Shares use the site’s default image, the same as every page without one.', 'Choose a share image specific to this page (1200×630).');
    },
  },
  {
    id: 'seo.social.twitter',
    dimension: 'seo',
    category: 'social',
    label: 'X / Twitter card',
    weight: 2,
    severity: 'suggestion',
    applicableTo: 'all',
    evaluate(doc) {
      if (!doc.social.ogImage) return notApplicable('No share image yet; the X card follows it (see “Open Graph image”).');
      if (doc.social.twitterCard !== 'summary_large_image') {
        return warn(0.5, 'The X card is a small summary.', 'Add a share image so X shows a large card.', { target: { field: 'ogImage', area: 'social' } });
      }
      if (!doc.social.twitterSite) {
        return warn(0.7, 'Large-image card, but no X handle is set for the site.', 'Add the company’s X handle in Admin → SEO so cards credit it.');
      }
      return pass(`Large-image card credited to ${doc.social.twitterSite}.`);
    },
  },

  // --- technical --------------------------------------------------------------------
  {
    id: 'seo.tech.status',
    dimension: 'seo',
    category: 'technical',
    label: 'Page status',
    weight: 3,
    severity: 'improvement',
    applicableTo: 'all',
    target: { field: 'status', area: 'general' },
    evaluate(doc) {
      if (doc.status.live) return pass('Published and live.');
      if (doc.status.notServedReason) return info(`Not served: ${doc.status.notServedReason}`);
      if (doc.status.value === 'SCHEDULED' || (doc.status.value === 'PUBLISHED' && doc.status.publishedAt)) {
        return info(`Scheduled${doc.status.publishedAt ? ` for ${doc.status.publishedAt.slice(0, 10)}` : ''}. These scores show how it will perform once live.`);
      }
      return info(`${doc.status.value === 'ARCHIVED' ? 'Archived' : 'Draft'} — not live. These scores show how it would perform if published.`);
    },
  },
  {
    id: 'seo.tech.indexable',
    dimension: 'seo',
    category: 'indexability',
    label: 'Indexability',
    weight: 6,
    severity: 'critical',
    applicableTo: 'all',
    target: { field: 'noIndex', area: 'seo' },
    evaluate(doc) {
      if (!doc.status.live) return notApplicable('Not live, so there is nothing to index yet.');
      if (doc.robots.noIndex) return info(noIndexMessage(doc));
      return pass('Page is indexable.');
    },
  },
  {
    id: 'seo.tech.sitemap',
    dimension: 'seo',
    category: 'indexability',
    label: 'Sitemap',
    weight: 3,
    severity: 'improvement',
    applicableTo: 'all',
    evaluate(doc) {
      if (!doc.status.live || doc.robots.noIndex) return notApplicable('Only live, indexable pages belong in the sitemap.');
      if (doc.robots.inSitemap) return pass('Listed in the sitemap.');
      return warn(0.3, `Not listed in the sitemap: ${doc.robots.sitemapExclusion ?? 'it is excluded by the site settings'}.`, 'Search engines still find it through links, but listing it helps new pages get crawled sooner.');
    },
  },
  {
    id: 'seo.tech.robots',
    dimension: 'seo',
    category: 'indexability',
    label: 'robots.txt access',
    weight: 4,
    severity: 'critical',
    applicableTo: 'all',
    evaluate(doc) {
      if (!doc.robots.blockedByRobots) return pass('robots.txt lets crawlers fetch this URL.');
      const rule = doc.robots.blockingRule ? ` (Disallow: ${doc.robots.blockingRule})` : '';
      if (doc.robots.noIndex) {
        return warn(0.5, `robots.txt blocks this URL${rule}, so crawlers never see its noindex and may list it anyway.`, 'Remove the Disallow rule and let the noindex do the work.');
      }
      return fail(`robots.txt blocks this URL${rule}: crawlers cannot read it, so it cannot rank.`, 'Remove the Disallow rule in Admin → SEO or the market’s crawler rules.');
    },
  },
  {
    id: 'seo.tech.conflicts',
    dimension: 'seo',
    category: 'indexability',
    label: 'Consistent indexing signals',
    weight: 3,
    severity: 'critical',
    applicableTo: 'all',
    evaluate(doc) {
      if (doc.robots.noIndex && doc.robots.inSitemap) {
        return fail('Listed in the sitemap but served with noindex — search engines are told to crawl it and not to index it.', 'Either remove the noindex or keep the page out of the sitemap (Countries → Exclude from sitemap for a whole market).');
      }
      const canonicalElsewhere =
        doc.meta.canonical.explicit &&
        doc.meta.canonical.explicit.replace(/\/+$/, '') !== doc.meta.canonical.self.replace(/\/+$/, '');
      if (doc.robots.noIndex && canonicalElsewhere) {
        return warn(0.5, 'noindex together with a canonical pointing elsewhere sends mixed signals.', 'Use one: a canonical if this duplicates another page, or noindex if it should not be found.');
      }
      return pass('No conflicting indexing signals.');
    },
  },
  {
    id: 'seo.tech.structuredData',
    dimension: 'seo',
    category: 'structuredData',
    label: 'Structured data',
    weight: 4,
    severity: 'improvement',
    applicableTo: 'all',
    evaluate(_doc, analysis) {
      const gaps = schemaGaps(analysis.schema);
      if (gaps.absent.length === 0 && gaps.incomplete.length === 0) {
        return pass(`Structured data present: ${listNames(analysis.schema.types, 6)}.`);
      }
      if (gaps.absent.length > 0) {
        return fail(`Missing structured data: ${listNames(gaps.absent)}.`, structuredDataFix(gaps.absent));
      }
      return warn(0.6, `Incomplete structured data: ${gaps.incomplete.map((gap) => `${gap.type} lacks ${listNames(gap.missing)}`).join('; ')}.`, structuredDataFix(gaps.incomplete.map((gap) => gap.type)));
    },
  },
  {
    id: 'seo.tech.hreflang',
    dimension: 'seo',
    category: 'technical',
    label: 'Market alternates (hreflang)',
    weight: 2,
    severity: 'suggestion',
    applicableTo: ['homepage', 'page', 'product'],
    evaluate(doc) {
      if (doc.alternates.indexableMarkets < 2) return notApplicable('Only one market is published, so there are no alternates to announce.');
      if (doc.alternates.locales.length >= 2) return pass(`Alternates announced for ${listNames(doc.alternates.locales, 5)}.`);
      return info(`Only published in ${doc.country.name}, so no hreflang alternates are announced — correct until an equivalent page is live in another market.`);
    },
  },

  // --- keywords -----------------------------------------------------------------------
  {
    id: 'seo.keywords.defined',
    dimension: 'seo',
    category: 'keywords',
    label: 'Primary keywords',
    weight: 5,
    severity: 'improvement',
    applicableTo: 'all',
    target: { field: 'primaryKeyword1', area: 'seo' },
    evaluate(doc) {
      const keywords = doc.meta.keywords;
      if (keywords.length === 0) {
        return warn(0.2, 'No primary keywords set, so keyword placement cannot be checked.', 'Add up to three primary keywords in the SEO section — the searches this page should answer.');
      }
      const source =
        doc.meta.keywordsSource === 'shared'
          ? ' (the product’s shared keywords)'
          : doc.meta.keywordsSource === 'city'
            ? ' (the city’s keywords)'
            : '';
      return pass(`Primary keywords${source}: ${keywords.map((keyword) => quote(keyword)).join(', ')}.`);
    },
  },
  {
    id: 'seo.keywords.cannibalization',
    dimension: 'seo',
    category: 'keywords',
    label: 'Keyword overlap',
    weight: 2,
    severity: 'suggestion',
    applicableTo: 'all',
    target: { field: 'primaryKeyword1', area: 'seo' },
    evaluate(doc) {
      if (doc.meta.keywords.length === 0) return noKeywords();
      const overlaps = doc.collisions.keyword;
      if (overlaps.length === 0) return pass(`No other page in ${doc.country.name} targets the same first keyword.`);
      return warn(0.5, `${quote(overlaps[0]!.keyword)} is also primary keyword 1 of ${listNames(overlaps.map((other) => other.name))}.`, 'Give each page its own main search to answer, or merge pages that answer the same one.');
    },
  },
];

function noIndexMessage(doc: SeoDocument): string {
  const reasons = doc.robots.noIndexReasons;
  const why = reasons.includes('site')
    ? 'the whole site is set to noindex in Admin → SEO'
    : reasons.includes('market')
      ? `the ${doc.country.name} market is set to noindex in Countries`
      : reasons.includes('blog')
        ? 'the blog archive is set to noindex'
        : reasons.includes('shared')
          ? 'the shared product is set to noindex'
          : reasons.includes('city') && !reasons.includes('entity')
            ? 'its city is set to noindex in Locations → Cities'
            : 'this page is set to noindex';
  return `Intentionally excluded from search engines: ${why}. It is not scored down for it.`;
}

function structuredDataFix(types: string[]): string {
  if (types.includes('Product') || types.includes('Offer')) {
    return 'Product data comes from the product itself: give it a name, image, brand and a price in this market.';
  }
  if (types.includes('BlogPosting')) return 'Article data comes from the post: give it an author and a publish date.';
  if (types.includes('BreadcrumbList')) return 'Breadcrumbs are generated for every page but the home page; check the page is not the market’s homepage by mistake.';
  if (types.includes('FAQPage')) return 'FAQ markup is generated from FAQ sections; keep questions in an FAQ section rather than plain text.';
  return 'Fill in the organisation’s name, logo and contact details under Settings → Countries and Admin → SEO.';
}

export function scoreSeo(doc: SeoDocument, analysis: DocumentAnalysis): ScoreBreakdown {
  return runChecks(SEO_CHECKS, doc, analysis);
}

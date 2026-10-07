import { effectiveKeywords, primaryKeywords, type PrimaryKeywordValues } from '@/lib/seo/keywords';

/**
 * What a city contributes to its pages' search fields.
 *
 * One function, used by the public page's metadata and by SEO Intelligence,
 * so what is scored is what is served. The chain is Page → City → market →
 * site: a page's own field always wins; the city fills in only where the page
 * left one blank; the market's and the site's defaults are applied after this
 * by the metadata builder, exactly as for any other page.
 *
 * What the city fills in, and where:
 *
 *  - **title** — the landing page only. The city's search title describes the
 *    city; used on `/delhi/revit` it would give every page in the city
 *    the same title. Every other page falls back to its own title, as always.
 *  - **description** — every page in the city: a Delhi description is closer
 *    to a Delhi page than the market's default is.
 *  - **keywords** — the landing page only, and only when it names none of its
 *    own, the same rule a product's market version follows.
 *  - **noindex** — every page in the city, when the city asks for it.
 *
 * Nothing here invents text. There are no automatic keyword variations: the
 * city's keywords are the ones somebody typed.
 */

export type CitySeoSource = PrimaryKeywordValues & {
  name: string;
  seoTitle: string | null;
  seoDescription: string | null;
  noIndex: boolean;
};

export type CityPageSeoInput = PrimaryKeywordValues & {
  title: string;
  seoTitle: string | null;
  seoDescription: string | null;
  noIndex: boolean;
  isCityHomepage: boolean;
};

export type CityPageSeo = {
  /** The title to render: the page's search title, the city's (landing page), or the page's title. */
  title: string;
  /** The description, or null to let the market's and site's defaults apply. */
  description: string | null;
  keywords: string[];
  noIndex: boolean;
  /** What the city offers where it applies: its title (landing page only) and its description. */
  cityTitle: string | null;
  cityDescription: string | null;
  /** Which fields came from the city, for SEO Intelligence to say so. */
  inherited: { title: boolean; description: boolean; keywords: boolean; noIndex: boolean };
};

const clean = (value: string | null | undefined) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

export function cityPageSeo(page: CityPageSeoInput, city: CitySeoSource | null): CityPageSeo {
  const ownTitle = clean(page.seoTitle);
  const ownDescription = clean(page.seoDescription);
  const landing = Boolean(city) && page.isCityHomepage;

  const cityTitle = landing ? clean(city?.seoTitle) : null;
  const cityDescription = city ? clean(city.seoDescription) : null;
  const keywords = landing ? effectiveKeywords(page, city) : { keywords: primaryKeywords(page), source: 'market' };

  return {
    title: ownTitle ?? cityTitle ?? page.title,
    description: ownDescription ?? cityDescription,
    keywords: keywords.keywords,
    noIndex: page.noIndex || Boolean(city?.noIndex),
    cityTitle,
    cityDescription,
    inherited: {
      title: !ownTitle && Boolean(cityTitle),
      description: !ownDescription && Boolean(cityDescription),
      keywords: landing && keywords.source === 'shared',
      noIndex: !page.noIndex && Boolean(city?.noIndex),
    },
  };
}

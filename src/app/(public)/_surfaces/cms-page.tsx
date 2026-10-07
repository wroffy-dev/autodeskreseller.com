import type { Metadata } from 'next';
import { prisma } from '@/lib/db/prisma';
import { getPublishedPageById } from '@/lib/services/pages';
import { getCityById } from '@/lib/services/cities';
import { cityPageSeo } from '@/lib/cities/seo';
import { getWebsiteSettings } from '@/lib/services/settings';
import { SectionList } from '@/components/cms/section-renderer';
import { JsonLd } from '@/components/seo/json-ld';
import { buildMetadata } from '@/lib/seo/metadata';
import { cmsPageJsonLd } from '@/lib/seo/page-schema';
import { pageAlternates } from '@/lib/urls/alternates';
import { missingContent, type PublicTarget } from '@/lib/urls/resolve';

/**
 * A CMS page, in one market.
 *
 * Every entry point renders through here with the page the URL registry (or,
 * while it is switched off, the old router) resolved — by id, so the page is
 * the same page whatever its address is.
 */

const NOT_FOUND: Metadata = { title: 'Page not found', robots: { index: false, follow: false } };

export async function cmsPageMetadata(target: PublicTarget): Promise<Metadata> {
  const page = target.id ? await getPublishedPageById(target.country.id, target.id) : null;
  if (!page) return NOT_FOUND;

  const [ogImage, twitterImage, alternates, city] = await Promise.all([
    page.ogImageId
      ? prisma.media.findUnique({ where: { id: page.ogImageId }, select: { url: true } })
      : null,
    page.twitterImageId
      ? prisma.media.findUnique({ where: { id: page.twitterImageId }, select: { url: true } })
      : null,
    pageAlternates(page, { indexableOnly: true }),
    page.cityId ? getCityById(page.cityId) : null,
  ]);

  // A city page's blank search fields come from its city; the market's and
  // the site's defaults still apply after that, in buildMetadata.
  const seo = cityPageSeo(page, city);

  return buildMetadata({
    title: seo.title,
    description: seo.description,
    publicPath: target.path,
    country: target.country,
    alternates,
    canonicalUrl: page.canonicalUrl,
    noIndex: seo.noIndex,
    noFollow: page.noFollow,
    ogTitle: page.ogTitle,
    ogDescription: page.ogDescription,
    ogImageUrl: ogImage?.url ?? null,
    twitterTitle: page.twitterTitle,
    twitterDescription: page.twitterDescription,
    twitterImageUrl: twitterImage?.url ?? null,
    keywords: seo.keywords,
  });
}

export async function CmsPageSurface({ target }: { target: PublicTarget }) {
  const page = target.id ? await getPublishedPageById(target.country.id, target.id) : null;

  /*
   * A missing page in one market never falls back to another market's content
   * — that would serve the wrong prices to the wrong customers. A draft's
   * address answers 404 exactly like an address that was never used.
   */
  if (!page) return missingContent(target);

  const site = await getWebsiteSettings();

  // FAQ markup from the page's FAQ sections, and its breadcrumb trail — built
  // by the same function SEO Intelligence analyses.
  const jsonLd = cmsPageJsonLd(
    target.country,
    { title: page.title, slug: page.slug, path: target.path, sections: page.sections },
    site.siteName,
  );

  return (
    <>
      <SectionList sections={page.sections} country={target.country} />
      {jsonLd.map((data, index) => (
        <JsonLd key={index} data={data} />
      ))}
    </>
  );
}

import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { ExternalLink, Eye, MapPin } from 'lucide-react';
import { prisma } from '@/lib/db/prisma';
import { listPageCategoryOptions } from '@/lib/services/page-categories';
import { requirePermission, userCan } from '@/lib/auth/guards';
import { AdminPageHeader } from '@/components/admin/page-header';
import { PageForm, type PageFormValues } from '@/components/admin/pages/page-form';
import { PageWorkspace } from '@/components/cms/page-workspace';
import { PageEditorTabs } from '@/components/admin/pages/page-editor-tabs';
import type { BuilderSection } from '@/components/cms/section-builder';
import { PageRowActions } from '@/components/admin/pages/page-list-actions';
import { ContentStatusBadge } from '@/components/admin/status-badge';
import { buttonClasses } from '@/components/ui/button';
import type { FieldValues } from '@/components/cms/field-renderer';
import { getCountryById, getDefaultCountry, listActiveCountries } from '@/lib/country/registry';
import { countryPath } from '@/lib/country/routing';
import { parseBlockContent } from '@/lib/cms/blocks';
import { formatDate } from '@/lib/utils/format';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const page = await prisma.page.findUnique({
    where: { id },
    select: { title: true },
  });
  return { title: page ? `Edit ${page.title}` : 'Page' };
}

function toLocalInput(date: Date | null): string {
  if (!date) return '';
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export default async function EditPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission('pages.view');
  const { id } = await params;
  const categoryOptions = await listPageCategoryOptions();

  const page = await prisma.page.findFirst({
    where: { id, deletedAt: null },
    include: {
      sections: { orderBy: { sortOrder: 'asc' } },
      city: { select: { id: true, name: true, isActive: true } },
      generatedFrom: { select: { id: true, title: true, deletedAt: true } },
      generationBatch: { select: { sourceTitle: true } },
    },
  });
  if (!page) notFound();

  // The market the page belongs to, named in the header so an editor can never
  // be in doubt about which storefront they are changing.
  const [country, countries] = await Promise.all([
    getCountryById(page.countryId).then(async (row) => row ?? (await getDefaultCountry())),
    listActiveCountries(),
  ]);

  const canEdit = userCan(user, 'pages.edit');

  const initial: PageFormValues = {
    id: page.id,
    title: page.title,
    slug: page.slug,
    status: page.status,
    categoryId: page.categoryId ?? '',
    publishedAt: toLocalInput(page.publishedAt),
    isHomepage: page.isHomepage,
    showHeader: page.showHeader,
    showFooter: page.showFooter,
    seoTitle: page.seoTitle ?? '',
    seoDescription: page.seoDescription ?? '',
    canonicalUrl: page.canonicalUrl ?? '',
    noIndex: page.noIndex,
    noFollow: page.noFollow,
    ogTitle: page.ogTitle ?? '',
    ogDescription: page.ogDescription ?? '',
    ogImageId: page.ogImageId,
    twitterTitle: page.twitterTitle ?? '',
    twitterDescription: page.twitterDescription ?? '',
    twitterImageId: page.twitterImageId,
    primaryKeyword1: page.primaryKeyword1 ?? '',
    primaryKeyword2: page.primaryKeyword2 ?? '',
    primaryKeyword3: page.primaryKeyword3 ?? '',
  };

  const sections: BuilderSection[] = page.sections.map((section) => ({
    id: section.id,
    blockType: section.blockType,
    name: section.name,
    isVisible: section.isVisible,
    sortOrder: section.sortOrder,
    content: parseBlockContent(section.blockType, section.content) as FieldValues,
    settings: (section.settings ?? {}) as FieldValues,
  }));

  const publicPath = countryPath(country, page.slug);
  const visibleCount = sections.filter((section) => section.isVisible).length;

  return (
    <>
      <AdminPageHeader
        title={page.title}
        description={
          countries.length > 1
            ? `${country.name} · ${page.isHomepage ? 'homepage' : publicPath}`
            : page.isHomepage
              ? 'Your homepage'
              : publicPath
        }
        backHref="/admin/pages"
        backLabel="All pages"
        status={<ContentStatusBadge status={page.status} />}
        actions={
          <>
            <Link
              href={`/admin/preview/${page.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonClasses('outline', 'md')}
            >
              <Eye className="h-4 w-4" aria-hidden="true" />
              Preview page
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="sr-only">(opens in a new tab)</span>
            </Link>
            {page.status === 'PUBLISHED' ? (
              <Link
                href={publicPath}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonClasses('ghost', 'md')}
              >
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
                View live
              </Link>
            ) : null}
            <PageRowActions
              pageId={page.id}
              slug={page.slug}
              status={page.status}
              isHomepage={page.isHomepage}
              countrySlug={country.slug}
              countries={countries
                .filter((row) => row.id !== country.id)
                .map((row) => ({ id: row.id, code: row.code, name: row.name }))}
              can={{
                edit: canEdit,
                publish: userCan(user, 'pages.publish'),
                create: userCan(user, 'pages.create'),
                delete: userCan(user, 'pages.delete'),
              }}
            />
          </>
        }
      />

      {page.city || page.generatedAt ? (
        <div className="mb-5 space-y-1.5 rounded-lg border border-hairline bg-muted/[0.04] px-3 py-2.5 text-sm text-muted">
          {page.city ? (
            <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
              <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>
                {page.isCityHomepage ? 'The landing page of ' : 'A page in '}
                <span className="font-medium text-content">{page.city.name}</span>.
              </span>
              <Link href={`/admin/cities/${page.city.id}`} className="font-medium text-brand hover:underline">
                Manage the city
              </Link>
              {!page.city.isActive ? (
                <span className="text-amber-700">
                  The city is switched off, so this page answers 404 until it is switched back on.
                </span>
              ) : null}
            </p>
          ) : null}
          {page.generatedAt ? (
            <p>
              Generated from{' '}
              {page.generatedFrom && !page.generatedFrom.deletedAt ? (
                <Link href={`/admin/pages/${page.generatedFrom.id}`} className="font-medium text-brand hover:underline">
                  “{page.generatedFrom.title}”
                </Link>
              ) : (
                <span className="font-medium text-content">
                  “{page.generatedFrom?.title ?? page.generationBatch?.sourceTitle ?? 'a page that no longer exists'}”
                </span>
              )}{' '}
              on {formatDate(page.generatedAt)}
              {page.city ? ` for ${page.city.name}` : ''}. It is an independent page: changes to the source never
              reach it, and changes here reach nothing else.
            </p>
          ) : null}
        </div>
      ) : null}

      <PageEditorTabs
        sectionCount={sections.length}
        visibleCount={visibleCount}
        builder={
          <PageWorkspace pageId={page.id} initialSections={sections} canEdit={canEdit} />
        }
        settings={
          <div className="max-w-3xl">
            <PageForm
              initial={initial}
              categories={categoryOptions}
              canPublish={userCan(user, 'pages.publish')}
              mode="edit"
            />
          </div>
        }
      />
    </>
  );
}

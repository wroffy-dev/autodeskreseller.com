import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePermission, userCan } from '@/lib/auth/guards';
import { userCanAccessCountry } from '@/lib/country/access';
import { AdminPageHeader } from '@/components/admin/page-header';
import { CityForm } from '@/components/admin/cities/city-form';
import type { CityFormValues } from '@/components/admin/cities/city-form-values';
import { CityActions } from '@/components/admin/cities/city-actions';
import { Card, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableWrap, Th, Td, Tr } from '@/components/ui/table';
import { ContentStatusBadge } from '@/components/admin/status-badge';
import { getCityForAdmin, listCityPages, listCityProducts, pageScores } from '@/lib/services/cities';
import { CityProductsCard } from '@/components/admin/cities/city-products-card';
import { CITY_STATUS_LABELS } from '@/lib/cities/status';
import { auditHref } from '@/lib/seo/score-state';

const CITY_STATUS_TONES = { DRAFT: 'warning', PUBLISHED: 'success', ARCHIVED: 'neutral' } as const;
import { joinMarket } from '@/lib/urls/path';
import { formatDate, formatNumber } from '@/lib/utils/format';
import { prisma } from '@/lib/db/prisma';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const city = await prisma.city.findUnique({ where: { id }, select: { name: true } });
  return { title: city ? `${city.name} · Cities` : 'City' };
}

export default async function EditCity({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission('pages.view');
  const { id } = await params;
  const city = await getCityForAdmin(id);
  // A city in a market this user cannot work in does not exist for them.
  if (!city || !(await userCanAccessCountry(user, city.countryId))) notFound();

  const [{ pages, total }, products] = await Promise.all([listCityPages(city.id), listCityProducts(city.id)]);
  const scores = await pageScores(pages.map((page) => page.id));
  const landing = pages.find((page) => page.isCityHomepage) ?? null;
  const path = joinMarket(city.country.slug, city.slug);
  const livePath = city.status === 'PUBLISHED' && landing?.status === 'PUBLISHED' ? path : null;

  const can = {
    create: userCan(user, 'pages.create'),
    edit: userCan(user, 'pages.edit'),
    delete: userCan(user, 'pages.delete'),
    publish: userCan(user, 'pages.publish'),
  };

  const initial: CityFormValues = {
    id: city.id,
    countryId: city.countryId,
    name: city.name,
    slug: city.slug,
    region: city.region ?? '',
    status: city.status,
    sortOrder: city.sortOrder,
    salesPhone: city.salesPhone ?? '',
    whatsappNumber: city.whatsappNumber ?? '',
    salesEmail: city.salesEmail ?? '',
    address: city.address ?? '',
    postalCode: city.postalCode ?? '',
    latitude: city.latitude ?? '',
    longitude: city.longitude ?? '',
    seoTitle: city.seoTitle ?? '',
    seoDescription: city.seoDescription ?? '',
    primaryKeyword1: city.primaryKeyword1 ?? '',
    primaryKeyword2: city.primaryKeyword2 ?? '',
    primaryKeyword3: city.primaryKeyword3 ?? '',
    noIndex: city.noIndex,
    excludeFromSitemap: city.excludeFromSitemap,
  };

  return (
    <>
      <AdminPageHeader
        title={city.name}
        description={`${city.country.name} · ${path}${city.region ? ` · ${city.region}` : ''}`}
        backHref="/admin/cities"
        backLabel="All cities"
        status={
          <span className="flex flex-wrap gap-1">
            <Badge tone={CITY_STATUS_TONES[city.status]}>{CITY_STATUS_LABELS[city.status]}</Badge>
          </span>
        }
        actions={
          <CityActions
            city={{ id: city.id, name: city.name, countryId: city.countryId, status: city.status, path }}
            landing={landing ? { id: landing.id, status: landing.status } : null}
            livePath={livePath}
            pageCount={total}
            can={can}
          />
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <CityForm
          initial={initial}
          markets={[{ id: city.country.id, name: city.country.name, code: city.country.code, slug: city.country.slug }]}
          pageCount={total}
          canPublish={userCan(user, 'pages.publish')}
          canEdit={can.edit}
        />

        <div className="space-y-6 self-start">
        <Card id="pages">
          <CardHeader
            title="Pages in this city"
            description={
              total === 0
                ? 'None yet. Create the landing page, or generate pages from an existing one.'
                : `${formatNumber(total)} page${total === 1 ? '' : 's'}, each an ordinary page in the Page Builder.`
            }
            actions={
              total > 0 ? (
                <Link
                  href={`/admin/pages?country=${city.countryId}&city=${city.id}`}
                  className="text-sm font-medium text-brand hover:underline"
                >
                  View all
                </Link>
              ) : null
            }
          />
          {pages.length > 0 ? (
            <TableWrap>
              <Table>
                <caption className="sr-only">Pages in {city.name}</caption>
                <thead>
                  <tr>
                    <Th>Page</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {pages.map((page) => (
                    <Tr key={page.id}>
                      <Td>
                        <Link href={`/admin/pages/${page.id}`} className="font-medium text-content hover:text-brand">
                          {page.title}
                        </Link>
                        <p className="mt-0.5 font-mono text-xs text-muted">{joinMarket(city.country.slug, page.slug)}</p>
                        {page.isCityHomepage ? (
                          <Badge tone="brand" className="mt-1">
                            Landing page
                          </Badge>
                        ) : null}
                        {page.generatedAt ? (
                          <p className="mt-1 text-xs text-muted">
                            Generated {formatDate(page.generatedAt)}
                            {page.generatedFrom ? ` from “${page.generatedFrom.title}”` : ''}
                          </p>
                        ) : null}
                        <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                          <Link href={`/admin/pages/${page.id}`} className="font-medium text-brand hover:underline">
                            Edit
                          </Link>
                          <Link href={`/admin/preview/${page.id}`} className="font-medium text-brand hover:underline">
                            Preview
                          </Link>
                          <Link href={auditHref({ type: 'PAGE', id: page.id })} className="font-medium text-brand hover:underline">
                            SEO analysis{scores.has(page.id) ? ` · ${scores.get(page.id)}` : ''}
                          </Link>
                        </p>
                      </Td>
                      <Td>
                        <ContentStatusBadge status={page.status} />
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          ) : null}
        </Card>

        <CityProductsCard
          cityId={city.id}
          cityName={city.name}
          canEdit={can.edit}
          generatorHref={can.create ? `/admin/cities/generator?country=${city.countryId}&city=${city.id}` : null}
          rows={products.map((row) => ({
            productId: row.productId,
            productName: row.product.name,
            page:
              row.page && !row.page.deletedAt
                ? {
                    id: row.page.id,
                    title: row.page.title,
                    path: joinMarket(city.country.slug, row.page.slug),
                    status: row.page.status,
                  }
                : null,
          }))}
        />
        </div>
      </div>
    </>
  );
}

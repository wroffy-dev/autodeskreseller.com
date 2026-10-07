import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePermission } from '@/lib/auth/guards';
import { AdminPageHeader } from '@/components/admin/page-header';
import { CityPageGenerator } from '@/components/admin/cities/city-page-generator';
import { Card, CardHeader } from '@/components/ui/card';
import { Table, TableWrap, Th, Td, Tr } from '@/components/ui/table';
import { scopeForUser } from '@/lib/country/admin';
import { listCityOptions, listRecentBatches } from '@/lib/services/cities';
import { prisma } from '@/lib/db/prisma';
import { formatDate } from '@/lib/utils/format';

export const metadata: Metadata = { title: 'City Page Generator' };
export const dynamic = 'force-dynamic';

export default async function CityGenerator({
  searchParams,
}: {
  searchParams: Promise<{ country?: string; city?: string; source?: string; product?: string }>;
}) {
  const user = await requirePermission('pages.create');
  const params = await searchParams;

  // Only markets this user may create pages in; every id in the query string
  // is checked against them, never trusted.
  const scope = await scopeForUser(user);
  const markets = scope.countries.map((row) => ({ id: row.id, name: row.name, code: row.code, slug: row.slug }));
  const marketIds = markets.map((row) => row.id);
  const [cities, batches, products] = await Promise.all([
    listCityOptions(marketIds),
    listRecentBatches(marketIds),
    prisma.product.findMany({
      where: { deletedAt: null, countries: { some: { countryId: { in: marketIds } } } },
      orderBy: { name: 'asc' },
      take: 500,
      select: { id: true, name: true, slug: true, countries: { select: { countryId: true } } },
    }),
  ]);

  const preselected = params.city ? cities.find((city) => city.id === params.city) : undefined;
  const countryId =
    markets.find((row) => row.id === (params.country ?? preselected?.countryId))?.id ?? scope.country.id;

  const source = params.source
    ? await prisma.page.findFirst({
        where: { id: params.source, countryId, deletedAt: null, cityId: null },
        select: { id: true, title: true, slug: true, status: true, _count: { select: { sections: true } } },
      })
    : null;

  return (
    <>
      <AdminPageHeader
        title="City Page Generator"
        description="Copy one page into many cities as drafts: autocad becomes /delhi/autocad, /gurugram/autocad and so on. Each copy is an ordinary, independent page to review and publish on its own."
        crumbs={[{ label: 'Locations' }, { label: 'Cities', href: '/admin/cities' }, { label: 'City Page Generator' }]}
      />

      <div className="mx-auto max-w-5xl space-y-8">
        <CityPageGenerator
          markets={markets}
          cities={cities.map((city) => ({
            id: city.id,
            name: city.name,
            slug: city.slug,
            region: city.region,
            countryId: city.countryId,
            isActive: city.isActive,
            status: city.status,
          }))}
          initialCountryId={countryId}
          initialCityIds={preselected && preselected.countryId === countryId ? [preselected.id] : []}
          initialSource={
            source
              ? {
                  id: source.id,
                  title: source.title,
                  slug: source.slug,
                  status: source.status,
                  sectionCount: source._count.sections,
                }
              : null
          }
          products={products.map((product) => ({
            id: product.id,
            name: product.name,
            slug: product.slug,
            countryIds: product.countries.map((row) => row.countryId),
          }))}
          initialProductId={params.product ?? null}
        />

        {batches.length > 0 ? (
          <Card>
            <CardHeader
              title="Recent runs"
              description="History only. Generated pages do not follow their source; editing either never changes the other."
            />
            <TableWrap>
              <Table>
                <caption className="sr-only">Recent generator runs</caption>
                <thead>
                  <tr>
                    <Th>Source</Th>
                    <Th>Country</Th>
                    <Th align="center">Created</Th>
                    <Th align="center">Skipped</Th>
                    <Th align="center">Failed</Th>
                    <Th>When</Th>
                  </tr>
                </thead>
                <tbody>
                  {batches.map((batch) => (
                    <Tr key={batch.id}>
                      <Td>
                        {batch.sourcePageId ? (
                          <Link href={`/admin/pages/${batch.sourcePageId}`} className="font-medium text-content hover:text-brand">
                            {batch.sourceTitle}
                          </Link>
                        ) : (
                          <span className="font-medium text-content">{batch.sourceTitle}</span>
                        )}
                        <p className="font-mono text-xs text-muted">/{batch.sourceSlug}</p>
                      </Td>
                      <Td>{batch.country.name}</Td>
                      <Td align="center">{batch.created}</Td>
                      <Td align="center">{batch.skipped}</Td>
                      <Td align="center">{batch.failed}</Td>
                      <Td className="text-sm text-muted">
                        {formatDate(batch.createdAt, true)}
                        {batch.actorEmail ? <span className="block text-xs">{batch.actorEmail}</span> : null}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          </Card>
        ) : null}
      </div>
    </>
  );
}

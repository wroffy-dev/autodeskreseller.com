import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@/lib/db/prisma';
import { requirePermission } from '@/lib/auth/guards';
import { AdminPageHeader } from '@/components/admin/page-header';
import { StatCard } from '@/components/admin/stat-card';
import { BarChart, HorizontalBars, FunnelBars } from '@/components/admin/charts';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { DateRangeFilter } from '@/components/admin/date-range-filter';
import { formatPercent } from '@/lib/utils/format';
import { formatMoney } from '@/lib/utils/money';
import { LEAD_STATUS_LABELS } from '@/lib/crm/constants';
import type { Prisma } from '@prisma/client';

export const metadata: Metadata = { title: 'Reports' };
export const dynamic = 'force-dynamic';

function defaultRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - 29 * 86_400_000);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  await requirePermission('leads.view');
  const params = await searchParams;
  const range = { ...defaultRange(), ...params };

  const fromDate = new Date(range.from);
  const toDate = new Date(range.to);
  toDate.setHours(23, 59, 59, 999);

  const where: Prisma.LeadWhereInput = {
    deletedAt: null,
    createdAt: { gte: fromDate, lte: toDate },
  };

  const [
    total,
    won,
    lost,
    byStatus,
    bySource,
    byCampaign,
    byProduct,
    byLanding,
    dailyLeads,
    wonValue,
  ] = await Promise.all([
    prisma.lead.count({ where }),
    prisma.lead.count({ where: { ...where, status: 'WON' } }),
    prisma.lead.count({ where: { ...where, status: 'LOST' } }),
    prisma.lead.groupBy({ by: ['status'], where, _count: { _all: true } }),
    prisma.lead.groupBy({
      by: ['utmSource'],
      where,
      _count: { _all: true },
      orderBy: { _count: { utmSource: 'desc' } },
      take: 10,
    }),
    prisma.lead.groupBy({
      by: ['utmCampaign'],
      where: { ...where, utmCampaign: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { utmCampaign: 'desc' } },
      take: 10,
    }),
    prisma.lead.groupBy({
      by: ['productId'],
      where: { ...where, productId: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { productId: 'desc' } },
      take: 10,
    }),
    prisma.lead.groupBy({
      by: ['landingUrl'],
      where: { ...where, landingUrl: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { landingUrl: 'desc' } },
      take: 10,
    }),
    prisma.lead.findMany({ where, select: { createdAt: true } }),
    prisma.lead.aggregate({ where: { ...where, status: 'WON' }, _sum: { value: true } }),
  ]);

  const productIds = byProduct.map((p) => p.productId).filter((id): id is string => Boolean(id));
  const products = productIds.length
    ? await prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true } })
    : [];
  const productNames = new Map(products.map((p) => [p.id, p.name]));

  // Fill every day in the range so the chart has a continuous axis.
  const days = Math.max(1, Math.round((toDate.getTime() - fromDate.getTime()) / 86_400_000) + 1);
  const counts = new Map<string, number>();
  for (let i = 0; i < days; i += 1) {
    counts.set(new Date(fromDate.getTime() + i * 86_400_000).toISOString().slice(0, 10), 0);
  }
  for (const lead of dailyLeads) {
    const key = lead.createdAt.toISOString().slice(0, 10);
    if (counts.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const decided = won + lost;
  const statusCounts = Object.fromEntries(byStatus.map((s) => [s.status, s._count._all]));

  return (
    <>
      <AdminPageHeader
        title="Reports"
        description="Lead performance by date, source, campaign, product and landing page."
        crumbs={[{ label: 'Reports' }]}
        actions={<DateRangeFilter from={range.from} to={range.to} />}
      />

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard label="Leads in range" value={total} />
        <StatCard label="Won" value={won} tone="success" />
        <StatCard label="Lost" value={lost} tone="danger" />
        <StatCard
          label="Conversion rate"
          value={decided > 0 ? formatPercent((won / decided) * 100) : '—'}
          hint={`${decided} decided`}
        />
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Leads by date"
            description={`${range.from} to ${range.to}`}
          />
          <CardBody>
            <BarChart
              data={Array.from(counts.entries()).map(([date, count]) => ({ date, count }))}
              label="Leads per day"
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Won value"
            description="Sum of the deal value recorded on won leads."
          />
          <CardBody>
            <p className="font-heading text-3xl font-bold text-emerald-600">
              {wonValue._sum.value ? formatMoney(wonValue._sum.value.toString()) : '—'}
            </p>
            <div className="mt-6">
              <FunnelBars
                stages={[
                  { label: 'New', count: statusCounts.NEW ?? 0 },
                  { label: 'Contacted', count: statusCounts.CONTACTED ?? 0 },
                  { label: 'Qualified', count: statusCounts.QUALIFIED ?? 0 },
                  { label: 'Proposal', count: statusCounts.PROPOSAL ?? 0 },
                  { label: 'Negotiation', count: statusCounts.NEGOTIATION ?? 0 },
                  { label: 'Won', count: statusCounts.WON ?? 0, tone: 'bg-emerald-500' },
                  { label: 'Lost', count: statusCounts.LOST ?? 0, tone: 'bg-red-400' },
                ]}
              />
            </div>
          </CardBody>
        </Card>
      </div>

      <div className="mt-6 grid gap-5 md:grid-cols-2">
        <Card>
          <CardHeader title="Leads by source" />
          <CardBody>
            <HorizontalBars
              items={bySource.map((row) => ({
                label: row.utmSource || 'Direct / none',
                count: row._count._all,
              }))}
              emptyLabel="No attribution captured in this range"
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Leads by campaign" />
          <CardBody>
            <HorizontalBars
              items={byCampaign.map((row) => ({
                label: row.utmCampaign ?? 'Unknown',
                count: row._count._all,
              }))}
              emptyLabel="No campaign data in this range"
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Leads by product" />
          <CardBody>
            <HorizontalBars
              items={byProduct.map((row) => ({
                label: productNames.get(row.productId ?? '') ?? 'Unknown',
                count: row._count._all,
              }))}
              emptyLabel="No product-attributed leads in this range"
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Leads by landing page" />
          <CardBody>
            <HorizontalBars
              items={byLanding.map((row) => ({
                label: row.landingUrl ?? 'Unknown',
                count: row._count._all,
              }))}
              emptyLabel="No landing page data in this range"
            />
          </CardBody>
        </Card>
      </div>

      <div className="mt-6">
        <Card>
          <CardHeader title="Status breakdown" />
          <CardBody>
            <dl className="grid gap-4 sm:grid-cols-4">
              {Object.entries(LEAD_STATUS_LABELS).map(([status, label]) => (
                <div key={status} className="rounded-lg border border-hairline p-3">
                  <dt className="text-xs text-muted">{label}</dt>
                  <dd className="mt-1 font-heading text-xl font-bold text-content">
                    <Link href={`/admin/leads?status=${status}`} className="hover:text-brand">
                      {statusCounts[status] ?? 0}
                    </Link>
                  </dd>
                </div>
              ))}
            </dl>
          </CardBody>
        </Card>
      </div>
    </>
  );
}

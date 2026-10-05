import type { Metadata } from 'next';
import Link from 'next/link';
import { Plus, TrendingUp, Users, AlertCircle } from 'lucide-react';
import { requirePermission, userCan } from '@/lib/auth/guards';
import { AdminPageHeader } from '@/components/admin/page-header';
import { DateRangePicker } from '@/components/admin/date-range-picker';
import { StatCard } from '@/components/admin/stat-card';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { ButtonLink } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/states';
import { BarChart, HorizontalBars } from '@/components/admin/charts';
import { LeadStatusBadge } from '@/components/admin/status-badge';
import { resolveRange, formatRangeLabel } from '@/lib/admin/date-range';
import {
  getCrmKpis,
  getLeadTrend,
  getStatusBreakdown,
  getSourcePerformance,
  getCampaignPerformance,
  getTopEntryPoints,
  type Kpi,
} from '@/lib/services/crm-dashboard';
import { getActionItems } from '@/lib/services/dashboard';
import { prisma } from '@/lib/db/prisma';
import { startOfDay, endOfDay } from '@/lib/admin/date-range';
import { formatRelative } from '@/lib/utils/format';
import { resolveListCountry, ALL_COUNTRIES } from '@/lib/admin/country-filter';
import { CountryScopePicker } from '@/components/admin/country-scope-picker';
import { cn } from '@/lib/utils/cn';

export const metadata: Metadata = { title: 'CRM dashboard' };
export const dynamic = 'force-dynamic';

export default async function CrmDashboard({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string; country?: string }>;
}) {
  const user = await requirePermission('leads.view');
  const params = await searchParams;
  const range = resolveRange(params);

  // Every figure on this page reports one market, or all of them — never a
  // silent mixture. The default is the market chosen in the topbar.
  const country = await resolveListCountry(user, params.country);
  const countryId = country.countryId ?? undefined;

  const [kpis, trend, statuses, sources, campaigns, entryPoints, actionItems, recentLeads] =
    await Promise.all([
      getCrmKpis(range, countryId),
      getLeadTrend(range, countryId),
      getStatusBreakdown(range, countryId),
      getSourcePerformance(range, countryId),
      getCampaignPerformance(range, countryId),
      getTopEntryPoints(range, countryId),
      getActionItems(countryId),
      prisma.lead.findMany({
        where: {
          deletedAt: null,
          status: { not: 'SPAM' },
          ...(countryId ? { countryId } : {}),
          createdAt: { gte: startOfDay(range.from), lte: endOfDay(range.to) },
        },
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: {
          id: true,
          name: true,
          company: true,
          status: true,
          utmSource: true,
          createdAt: true,
          assignedTo: { select: { name: true } },
        },
      }),
    ]);

  const canCreate = userCan(user, 'leads.create');

  // Every link out of this dashboard carries the range, so drilling into the
  // leads list shows the same window the chart just described.
  const rangeQuery = new URLSearchParams({
    from: range.from,
    to: range.to,
    // The market travels with the range, so a drill-down into the leads list
    // shows exactly the rows the chart counted.
    ...(country.multiCountry ? { country: country.value } : {}),
  }).toString();

  return (
    <>
      <AdminPageHeader
        title="CRM dashboard"
        description={
          country.multiCountry
            ? `Lead performance for ${formatRangeLabel(range)} · ${country.countryId ? country.current.name : 'all countries'}.`
            : `Lead performance for ${formatRangeLabel(range)}.`
        }
        actions={
          <>
            {country.multiCountry ? (
              <CountryScopePicker
                value={country.value}
                options={[
                  { value: ALL_COUNTRIES, label: 'All countries' },
                  ...country.countries.map((row) => ({ value: row.id, label: row.name })),
                ]}
              />
            ) : null}
            <DateRangePicker range={range} />
            {canCreate ? (
              <ButtonLink href="/admin/leads/new">
                <Plus className="h-4 w-4" aria-hidden="true" />
                Add lead
              </ButtonLink>
            ) : null}
          </>
        }
      />

      <section
        aria-label="Key figures"
        className="mb-6 grid grid-cols-2 gap-3 xl:grid-cols-3 min-[1800px]:grid-cols-6"
      >
        {kpis.map((kpi) => (
          <KpiCard key={kpi.key} kpi={kpi} />
        ))}
      </section>

      <div className="mb-6 grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardHeader
            title="Leads over time"
            description={`Grouped by ${trend.granularity}. ${formatRangeLabel(range)}.`}
          />
          <CardBody>
            {trend.points.every((point) => point.value === 0) ? (
              <EmptyState
                icon={<TrendingUp className="h-5 w-5" />}
                title="No leads in this period"
                description="Try a wider date range, or check that your forms are published."
              />
            ) : (
              <BarChart
                label="Leads"
                data={trend.points.map((point) => ({ date: point.label, count: point.value }))}
              />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="By status" description="Click a status to open those leads." />
          <CardBody>
            {statuses.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted">Nothing in this period.</p>
            ) : (
              <ul className="space-y-2">
                {statuses.map((slice) => (
                  <li key={slice.status}>
                    <Link
                      href={`/admin/leads?status=${slice.status}&${rangeQuery}`}
                      className="flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-muted/[0.06]"
                    >
                      <LeadStatusBadge status={slice.status} />
                      <span
                        className="h-1.5 min-w-1 flex-1 rounded-full bg-brand/70"
                        style={{ maxWidth: `${Math.max(slice.share, 2)}%` }}
                        aria-hidden="true"
                      />
                      <span className="shrink-0 text-sm font-medium text-content">
                        {slice.count}
                      </span>
                      <span className="w-11 shrink-0 text-right text-xs text-muted">
                        {slice.share.toFixed(0)}%
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <AttributionCard
          title="Lead sources"
          description="Where these leads came from, by last-touch utm_source."
          rows={sources}
          hrefFor={(key) => `/admin/leads?source=${encodeURIComponent(key)}&${rangeQuery}`}
        />
        <AttributionCard
          title="Campaign performance"
          description="Last-touch utm_campaign."
          rows={campaigns}
          hrefFor={(key) => `/admin/leads?utmCampaign=${encodeURIComponent(key)}&${rangeQuery}`}
        />
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Top landing pages"
            description="First page of the visit that converted."
          />
          <CardBody>
            <HorizontalBars
              items={entryPoints.landingPages.map((row) => ({
                label: row.label,
                count: row.count,
                href: `/admin/leads?landingUrl=${encodeURIComponent(row.key)}&${rangeQuery}`,
              }))}
              emptyLabel="No landing pages recorded in this period."
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Top forms" description="Which form captured the lead." />
          <CardBody>
            <HorizontalBars
              items={entryPoints.forms.map((row) => ({
                label: row.label,
                count: row.count,
                href: `/admin/leads?formId=${encodeURIComponent(row.key)}&${rangeQuery}`,
              }))}
              emptyLabel="No form-captured leads in this period."
            />
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Needs attention"
            description="Across all time, not just the selected range."
          />
          <CardBody>
            {actionItems.length === 0 ? (
              <EmptyState
                icon={<AlertCircle className="h-5 w-5" />}
                title="Nothing waiting"
                description="Every lead is assigned and no follow-up is overdue."
              />
            ) : (
              <ul className="space-y-1.5">
                {actionItems.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className="flex items-center justify-between gap-3 rounded-lg border border-hairline px-3 py-2.5 transition-colors hover:border-brand/40 hover:bg-brand/[0.03]"
                    >
                      <span className="min-w-0 text-sm text-content">{item.label}</span>
                      <span className="shrink-0 rounded-full bg-brand/10 px-2 py-0.5 text-xs font-semibold text-brand">
                        {item.count}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Recent leads"
            description={formatRangeLabel(range)}
            actions={
              <Link
                href={`/admin/leads?${rangeQuery}`}
                className="text-sm text-brand hover:underline"
              >
                View all
              </Link>
            }
          />
          <CardBody>
            {recentLeads.length === 0 ? (
              <EmptyState
                icon={<Users className="h-5 w-5" />}
                title="No leads in this period"
                description="Try a wider date range."
              />
            ) : (
              <ul className="divide-y divide-hairline">
                {recentLeads.map((lead) => (
                  <li key={lead.id}>
                    <Link
                      href={`/admin/leads/${lead.id}`}
                      className="flex items-center gap-3 py-2.5 transition-colors hover:bg-muted/[0.04]"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-content">
                          {lead.name}
                        </span>
                        <span className="block truncate text-xs text-muted">
                          {[lead.company, lead.utmSource, lead.assignedTo?.name ?? 'Unassigned']
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </span>
                      <LeadStatusBadge status={lead.status} />
                      <span className="hidden shrink-0 text-xs text-muted sm:inline">
                        {formatRelative(lead.createdAt.toISOString())}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}

function KpiCard({ kpi }: { kpi: Kpi }) {
  const display = kpi.isRate ? `${kpi.value.toFixed(1)}%` : kpi.value.toLocaleString();
  return (
    <StatCard
      label={kpi.label}
      value={display}
      trend={kpi.change}
      // For "Lost", moving up is not good news — colour follows meaning, not sign.
      invertTrend={kpi.key === 'lost'}
      hint={kpi.change === null ? 'No activity in the previous period' : 'vs previous period'}
    />
  );
}

function AttributionCard({
  title,
  description,
  rows,
  hrefFor,
}: {
  title: string;
  description: string;
  rows: Array<{ key: string; label: string; leads: number; won: number; conversionRate: number }>;
  hrefFor: (key: string) => string;
}) {
  return (
    <Card>
      <CardHeader title={title} description={description} />
      <CardBody className="p-0">
        {rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted">Nothing recorded in this period.</p>
        ) : (
          <div className="scroll-x">
            <table className="w-full min-w-[26rem] text-sm">
              <caption className="sr-only">{title}</caption>
              <thead>
                <tr className="border-b border-hairline text-xs uppercase tracking-wide text-muted">
                  <th scope="col" className="px-4 py-2 text-left font-semibold">
                    Source
                  </th>
                  <th scope="col" className="px-4 py-2 text-right font-semibold">
                    Leads
                  </th>
                  <th scope="col" className="px-4 py-2 text-right font-semibold">
                    Won
                  </th>
                  <th scope="col" className="px-4 py-2 text-right font-semibold">
                    Rate
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {rows.map((row) => (
                  <tr key={row.key}>
                    <td className="max-w-[12rem] truncate px-4 py-2.5">
                      <Link href={hrefFor(row.key)} className="text-content hover:text-brand">
                        {row.label}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium text-content">{row.leads}</td>
                    <td className="px-4 py-2.5 text-right text-muted">{row.won}</td>
                    <td className="px-4 py-2.5 text-right text-muted">
                      {row.conversionRate.toFixed(0)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

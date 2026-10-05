import Link from 'next/link';
import type { Metadata } from 'next';
import { ArrowUpRight, Check, CircleAlert, ChevronRight } from 'lucide-react';
import { prisma } from '@/lib/db/prisma';
import { requirePermission, userCan } from '@/lib/auth/guards';
import { getDashboardMetrics, getActionItems, getSetupChecks } from '@/lib/services/dashboard';
import { AdminPageHeader } from '@/components/admin/page-header';
import { StatCard } from '@/components/admin/stat-card';
import { QuickActions } from '@/components/admin/quick-actions';
import { BarChart, FunnelBars } from '@/components/admin/charts';
import { LeadStatusBadge } from '@/components/admin/status-badge';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { Alert, EmptyState } from '@/components/ui/states';
import { formatRelative, formatPercent, formatNumber } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';
import type { PermissionKey } from '@/lib/auth/permissions';
import { resolveListCountry, ALL_COUNTRIES } from '@/lib/admin/country-filter';
import { CountryScopePicker } from '@/components/admin/country-scope-picker';

// Absolute so the public site's title template does not leak into the admin.
export const metadata: Metadata = { title: { absolute: 'Dashboard · Admin' } };
export const dynamic = 'force-dynamic';

export default async function AdminDashboard({
  searchParams,
}: {
  searchParams: Promise<{ denied?: string; country?: string }>;
}) {
  const user = await requirePermission('dashboard.view');
  const can = (permission: PermissionKey) => userCan(user, permission);

  const canSeeLeads = can('leads.view');

  const params = await searchParams;
  // Lead figures report one storefront by default — the one chosen in the top
  // bar — with "All countries" one click away.
  const country = await resolveListCountry(user, params.country);
  const countryId = country.countryId ?? undefined;

  const [metrics, actionItems, setupChecks, recentLeads, recentActivity, counts] =
    await Promise.all([
      getDashboardMetrics(30, countryId),
      canSeeLeads ? getActionItems(countryId) : Promise.resolve([]),
      can('settings.manage') ? getSetupChecks() : Promise.resolve([]),
      canSeeLeads
        ? prisma.lead.findMany({
            where: { deletedAt: null, ...(countryId ? { countryId } : {}) },
            orderBy: { createdAt: 'desc' },
            take: 6,
            select: {
              id: true,
              name: true,
              email: true,
              company: true,
              status: true,
              source: true,
              createdAt: true,
              product: { select: { name: true } },
              assignedTo: { select: { name: true } },
            },
          })
        : Promise.resolve([]),
      can('audit.view')
        ? prisma.auditLog.findMany({
            orderBy: { createdAt: 'desc' },
            take: 7,
            select: {
              id: true,
              action: true,
              entity: true,
              entityId: true,
              summary: true,
              createdAt: true,
              actorEmail: true,
              actor: { select: { name: true } },
            },
          })
        : Promise.resolve([]),
      Promise.all([
        prisma.page.count({ where: { deletedAt: null, status: 'PUBLISHED' } }),
        prisma.product.count({ where: { deletedAt: null, status: 'PUBLISHED' } }),
        prisma.customer.count({ where: { deletedAt: null } }),
        prisma.formSubmission.count(),
      ]),
    ]);

  const [pagesCount, productsCount, customersCount, submissionsCount] = counts;
  const needsAttention = actionItems.filter((item) => item.tone === 'attention' && item.count > 0);

  // The 30-day series drives the lead tile's sparkline, and its two halves the
  // trend chip: the last 15 days against the 15 before them.
  const daily = metrics.trend.map((point) => point.count);
  const half = Math.floor(daily.length / 2);
  const recent = daily.slice(half).reduce((sum, n) => sum + n, 0);
  const earlier = daily.slice(0, half).reduce((sum, n) => sum + n, 0);
  const leadTrend = earlier > 0 ? ((recent - earlier) / earlier) * 100 : null;
  const outstandingSetup = setupChecks.filter((check) => !check.configured);

  return (
    // `.dashboard` paints a fixed colour wash behind the page, which is what
    // gives the glass panels something to blur. Every other screen stays on
    // the plain workspace.
    <div className="dashboard">
      <div className="ambient" aria-hidden="true" />
      <AdminPageHeader
        title={`Welcome back, ${user.name.split(' ')[0]}`}
        description={
          country.multiCountry
            ? `What needs your attention today across ${country.countryId ? country.current.name : 'all countries'}.`
            : 'What needs your attention today, and how the website is performing.'
        }
        actions={
          country.multiCountry ? (
            <CountryScopePicker
              value={country.value}
              options={[
                { value: ALL_COUNTRIES, label: 'All countries' },
                ...country.countries.map((row) => ({ value: row.id, label: row.name })),
              ]}
            />
          ) : undefined
        }
      />

      {params.denied ? (
        <Alert tone="warning" className="mb-6" title="Access denied">
          Your role does not include <code className="font-mono">{params.denied}</code>. Ask a super
          admin to grant it.
        </Alert>
      ) : null}

      {/* --- KPIs ------------------------------------------------------- */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {canSeeLeads ? (
          <>
            <StatCard
              label="Total leads"
              value={metrics.totalLeads}
              hint={`${formatNumber(metrics.newThisMonth)} this month`}
              href="/admin/leads"
              icon="inbox"
              trend={leadTrend}
              sparkline={daily.length > 1 ? daily : undefined}
            />
            <StatCard
              label="New today"
              value={metrics.newToday}
              hint="Waiting to be reviewed"
              tone="brand"
              href="/admin/leads?status=NEW"
              icon="star"
            />
            <StatCard
              label="Open pipeline"
              value={metrics.openPipeline}
              hint={`${formatNumber(metrics.qualified)} qualified`}
              href="/admin/pipeline"
              icon="kanban"
            />
            <StatCard
              label="Conversion rate"
              value={formatPercent(metrics.conversionRate)}
              hint={`${formatNumber(metrics.won)} won · ${formatNumber(metrics.lost)} lost`}
              tone={metrics.conversionRate >= 25 ? 'success' : 'default'}
              icon="chart"
            />
          </>
        ) : (
          <>
            {can('pages.view') ? (
              <StatCard
                label="Published pages"
                value={pagesCount}
                href="/admin/pages"
                icon="layout"
              />
            ) : null}
            {can('products.view') ? (
              <StatCard
                label="Published products"
                value={productsCount}
                href="/admin/products"
                icon="package"
              />
            ) : null}
            {can('customers.view') ? (
              <StatCard
                label="Customers"
                value={customersCount}
                href="/admin/customers"
                icon="building"
              />
            ) : null}
            {can('forms.view') ? (
              <StatCard
                label="Form submissions"
                value={submissionsCount}
                href="/admin/forms/submissions"
                icon="clipboard"
              />
            ) : null}
          </>
        )}
      </div>

      {/* --- Needs attention + quick actions ---------------------------- */}
      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        {actionItems.length > 0 ? (
          <Card glass className="lg:col-span-2">
            <CardHeader
              title="Needs attention"
              description={
                needsAttention.length > 0
                  ? `${needsAttention.length} ${needsAttention.length === 1 ? 'item needs' : 'items need'} action`
                  : 'Nothing is waiting on you right now.'
              }
            />
            <CardBody className="pt-0">
              <ul className="grid gap-2 sm:grid-cols-2">
                {actionItems.map((item) => (
                  <li key={item.id}>
                    <Link
                      href={item.href}
                      className={cn(
                        'flex items-center gap-3 rounded-[var(--radius-card-sm)] border px-3 py-2.5 transition-colors',
                        item.tone === 'attention' && item.count > 0
                          ? 'border-amber-200 bg-amber-50/60 hover:border-amber-300'
                          : 'glass-chip border-hairline hover:border-brand/40',
                      )}
                    >
                      <span
                        className={cn(
                          'text-lg font-semibold tabular-nums',
                          item.tone === 'attention' && item.count > 0
                            ? 'text-amber-700'
                            : 'text-content',
                        )}
                      >
                        {formatNumber(item.count)}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm text-content">
                        {item.label}
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        ) : null}

        <Card glass className={cn(actionItems.length === 0 && 'lg:col-span-3')}>
          <CardHeader title="Quick actions" />
          <CardBody className="pt-0">
            <QuickActions can={can} />
          </CardBody>
        </Card>
      </div>

      {/* --- Trend + pipeline ------------------------------------------- */}
      {canSeeLeads ? (
        <div className="mt-5 grid gap-5 lg:grid-cols-3">
          <Card glass className="lg:col-span-2">
            <CardHeader
              title="Leads over the last 30 days"
              actions={
                <Link
                  href="/admin/reports"
                  className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline"
                >
                  Reports
                  <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              }
            />
            <CardBody>
              <BarChart data={metrics.trend} label="Leads per day" />
            </CardBody>
          </Card>

          <Card glass>
            <CardHeader
              title="Pipeline"
              actions={
                <Link
                  href="/admin/pipeline"
                  className="text-sm font-medium text-brand hover:underline"
                >
                  Open
                </Link>
              }
            />
            <CardBody>
              <FunnelBars
                stages={[
                  { label: 'New', count: metrics.byStatus.NEW },
                  { label: 'Contacted', count: metrics.byStatus.CONTACTED },
                  { label: 'Qualified', count: metrics.byStatus.QUALIFIED },
                  { label: 'Proposal', count: metrics.byStatus.PROPOSAL },
                  { label: 'Negotiation', count: metrics.byStatus.NEGOTIATION },
                  {
                    label: 'Won',
                    count: metrics.byStatus.WON,
                    tone: 'bg-emerald-500',
                  },
                  {
                    label: 'Lost',
                    count: metrics.byStatus.LOST,
                    tone: 'bg-red-400',
                  },
                ]}
              />
            </CardBody>
          </Card>
        </div>
      ) : null}

      {/* --- Recent leads + activity + setup ---------------------------- */}
      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        {canSeeLeads ? (
          <Card glass className="lg:col-span-2">
            <CardHeader
              title="Recent leads"
              actions={
                <Link
                  href="/admin/leads"
                  className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline"
                >
                  View all
                  <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              }
            />
            {recentLeads.length === 0 ? (
              <EmptyState
                title="No leads yet"
                description="Leads captured from your website forms will appear here."
              />
            ) : (
              <ul className="divide-y divide-hairline">
                {recentLeads.map((lead) => (
                  <li key={lead.id}>
                    <Link
                      href={`/admin/leads/${lead.id}`}
                      className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-[rgb(var(--glass-tint)/0.5)] sm:px-5"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-content">
                          {lead.name}
                        </span>
                        <span className="block truncate text-xs text-muted">
                          {[lead.company, lead.product?.name, lead.source]
                            .filter(Boolean)
                            .join(' · ') || lead.email}
                        </span>
                      </span>
                      <span className="hidden shrink-0 text-xs text-muted sm:block">
                        {lead.assignedTo?.name ?? 'Unassigned'}
                      </span>
                      <LeadStatusBadge status={lead.status} />
                      <span className="hidden w-20 shrink-0 text-right text-xs text-muted md:block">
                        {formatRelative(lead.createdAt)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ) : null}

        <div className={cn('space-y-5', !canSeeLeads && 'lg:col-span-3')}>
          {setupChecks.length > 0 ? (
            <Card glass>
              <CardHeader
                title="Setup"
                description={
                  outstandingSetup.length === 0
                    ? 'Everything essential is configured.'
                    : `${outstandingSetup.length} still to configure`
                }
              />
              <CardBody className="pt-0">
                <ul className="space-y-1">
                  {setupChecks.map((check) => (
                    <li key={check.id}>
                      <Link
                        href={check.href}
                        className="flex items-center gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-muted/[0.04]"
                      >
                        <span
                          className={cn(
                            'flex h-5 w-5 shrink-0 items-center justify-center rounded-full',
                            check.configured
                              ? 'bg-emerald-50 text-emerald-600'
                              : 'bg-muted/15 text-muted',
                          )}
                        >
                          {check.configured ? (
                            <Check className="h-3 w-3" aria-hidden="true" />
                          ) : (
                            <CircleAlert className="h-3 w-3" aria-hidden="true" />
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-content">{check.label}</span>
                          <span className="block truncate text-xs text-muted">
                            {check.description}
                          </span>
                        </span>
                        <span
                          className={cn(
                            'shrink-0 text-xs font-medium',
                            check.configured ? 'text-emerald-600' : 'text-muted',
                          )}
                        >
                          {check.configured ? 'Configured' : 'Set up'}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          ) : null}

          {recentActivity.length > 0 ? (
            <Card glass>
              <CardHeader
                title="Recent activity"
                actions={
                  <Link
                    href="/admin/audit"
                    className="text-sm font-medium text-brand hover:underline"
                  >
                    Audit log
                  </Link>
                }
              />
              <CardBody className="pt-0">
                <ul className="space-y-3">
                  {recentActivity.map((entry) => (
                    <li key={entry.id} className="flex gap-2.5 text-sm">
                      <span
                        className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand/40"
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-content">{entry.summary}</span>
                        <span className="block text-xs text-muted">
                          {entry.actor?.name ?? entry.actorEmail ?? 'System'} ·{' '}
                          {formatRelative(entry.createdAt)}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}

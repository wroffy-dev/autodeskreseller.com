import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowUpRight, Gauge, Info, Pencil } from 'lucide-react';
import { requirePermission } from '@/lib/auth/guards';
import { listAccessibleCountries } from '@/lib/country/access';
import { AdminPageHeader } from '@/components/admin/page-header';
import { FilterBar } from '@/components/admin/filter-bar';
import { SortableTh } from '@/components/admin/sortable-th';
import { AdminPagination } from '@/components/admin/admin-pagination';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/states';
import { Table, TableWrap, Th, Td, Tr } from '@/components/ui/table';
import { ScoreBadge, ScoreLegend, ScoreNumber, ScoreRing, SCORE_TONES } from '@/components/admin/seo/score-display';
import { RecalculateControls } from '@/components/admin/seo/recalculate-controls';
import type { FilterDefinition, FilterPreset } from '@/lib/admin/filters';
import { loadSeoContext } from '@/lib/seo/intelligence/context';
import { staleness } from '@/lib/seo/intelligence/cache';
import { targetKey } from '@/lib/seo/intelligence/targets';
import {
  ATTENTION_BELOW,
  AUDIT_ROW_STATUSES,
  AUDIT_ROW_STATUS_LABELS,
  AUDIT_SORTS,
  INDEX_FILTERS,
  AUDIT_STATE_FILTERS,
  ISSUE_FILTERS,
  SCORE_FILTERS,
  SEVERITY_FILTERS,
  auditSummary,
  listAudits,
  oneOf,
  parseAuditFilters,
  type AuditListRow,
  type AuditSummary,
} from '@/lib/seo/intelligence/dashboard';
import {
  PAGE_KIND_LABELS,
  SCORE_STATE_LABELS,
  SEO_DISCLAIMER,
  auditHref,
  editPathFor,
  type ScoreState,
} from '@/lib/seo/score-state';
import { OVERALL_WEIGHTS } from '@/lib/seo/score-overall';
import { SEO_PAGE_KINDS } from '@/lib/seo/types';
import { formatDate, formatNumber } from '@/lib/utils/format';
import { prisma } from '@/lib/db/prisma';
import { listCityOptions } from '@/lib/services/cities';
import { cn } from '@/lib/utils/cn';

export const metadata: Metadata = { title: 'SEO Intelligence' };
export const dynamic = 'force-dynamic';

const PER_PAGE = 25;
const BASE_PATH = '/admin/seo-intelligence';

type Params = {
  q?: string;
  country?: string;
  type?: string;
  status?: string;
  score?: string;
  index?: string;
  issue?: string;
  severity?: string;
  audit?: string;
  city?: string;
  sort?: string;
  dir?: string;
  page?: string;
};

export default async function SeoIntelligence({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const user = await requirePermission('seo.manage');
  const params = await searchParams;

  // Every market this user may see; the dashboard spans them all unless one
  // is picked. Each market's URLs stay separate rows — nothing is merged.
  const countries = await listAccessibleCountries(user, { includeInactive: true });
  const multiCountry = countries.length > 1;
  const chosen = params.country ? countries.find((country) => country.id === params.country) : undefined;
  const accessibleIds = countries.map((country) => country.id);
  const countryIds = chosen ? [chosen.id] : accessibleIds;

  // A city narrows the list to its pages. The city must be in a market in
  // view; an id for any other is ignored rather than trusted.
  const cities = await listCityOptions(countryIds);
  const city = params.city ? cities.find((option) => option.id === params.city) : undefined;
  const cityPages = city
    ? await prisma.page.findMany({ where: { cityId: city.id, deletedAt: null }, select: { id: true } })
    : null;

  const filters = {
    ...parseAuditFilters(params, countryIds),
    ...(cityPages ? { pageIds: cityPages.map((row) => row.id) } : {}),
  };
  const sort = oneOf(params.sort, AUDIT_SORTS);
  const dir = params.dir === 'asc' || params.dir === 'desc' ? params.dir : undefined;
  const page = Math.max(1, Number(params.page) || 1);

  // Which cached scores no longer match their content: fingerprints only,
  // nothing is scored here.
  const ctx = await loadSeoContext();
  const state = await staleness(ctx);
  const accessible = new Set(accessibleIds);
  let targets = 0;
  let outdated = 0;
  let cached = 0;
  for (const [key, target] of state.targets) {
    if (!accessible.has(target.countryId)) continue;
    targets += 1;
    if (state.outdated.has(key)) outdated += 1;
    if (state.cached.has(key)) cached += 1;
  }

  const [summary, list] = await Promise.all([
    auditSummary(countryIds),
    listAudits({ ...filters, outdatedIds: [...state.outdatedIds] }, { sort, dir, page, perPage: PER_PAGE }),
  ]);

  const isOutdated = (row: AuditListRow) =>
    state.outdated.has(
      targetKey({ entityType: row.entityType, entityId: row.entityId, countryId: row.countryId }),
    );

  const definitions: FilterDefinition[] = [
    ...(multiCountry
      ? [
          {
            name: 'country',
            label: 'Country',
            allLabel: 'All countries',
            options: countries.map((country) => ({
              label: country.isActive ? country.name : `${country.name} (inactive)`,
              value: country.id,
            })),
          },
        ]
      : []),
    ...(cities.length > 0
      ? [
          {
            name: 'city',
            label: 'City',
            allLabel: 'Any city',
            options: cities.map((option) => ({
              label:
                multiCountry && !chosen
                  ? `${option.name} (${countries.find((country) => country.id === option.countryId)?.code ?? ''})`
                  : option.name,
              value: option.id,
            })),
          },
        ]
      : []),
    {
      name: 'type',
      label: 'Content type',
      allLabel: 'Any type',
      options: SEO_PAGE_KINDS.map((kind) => ({
        label: kind === 'page' ? 'Pages (home page included)' : PAGE_KIND_LABELS[kind],
        value: kind,
      })),
    },
    {
      name: 'score',
      label: 'Score',
      allLabel: 'Any score',
      options: Object.entries(SCORE_FILTERS).map(([value, filter]) => ({
        label: `${filter.label} (${filter.min}–${filter.max})`,
        value,
      })),
    },
    {
      name: 'severity',
      label: 'Severity',
      allLabel: 'Any severity',
      options: Object.entries(SEVERITY_FILTERS).map(([value, label]) => ({ label, value })),
    },
    {
      name: 'issue',
      label: 'Issue',
      allLabel: 'Any issue',
      options: Object.entries(ISSUE_FILTERS).map(([value, label]) => ({ label, value })),
    },
    {
      name: 'audit',
      label: 'Audit status',
      allLabel: 'Up to date or not',
      options: Object.entries(AUDIT_STATE_FILTERS).map(([value, label]) => ({ label, value })),
    },
    {
      name: 'status',
      label: 'Status',
      allLabel: 'Any status',
      advanced: true,
      options: AUDIT_ROW_STATUSES.map((status) => ({ label: AUDIT_ROW_STATUS_LABELS[status], value: status })),
    },
    {
      name: 'index',
      label: 'Indexing',
      allLabel: 'Indexable or not',
      advanced: true,
      options: Object.entries(INDEX_FILTERS).map(([value, label]) => ({ label, value })),
    },
  ];

  const presets: FilterPreset[] = [
    { id: 'all', label: 'All URLs', params: {} },
    { id: 'attention', label: 'Needs attention', params: { score: 'attention' } },
    { id: 'critical', label: 'Critical issues', params: { severity: 'critical' } },
    { id: 'outdated', label: 'Outdated audits', params: { audit: 'outdated' } },
    { id: 'products', label: 'Products', params: { type: 'product' } },
    { id: 'recent', label: 'Recently updated', params: { sort: 'updated', dir: 'desc' } },
  ];

  const filtered = Boolean(
    params.q ||
      params.type ||
      params.status ||
      params.score ||
      params.index ||
      params.issue ||
      params.severity ||
      params.audit ||
      city,
  );
  const link = (extra: Record<string, string>) => {
    const search = new URLSearchParams();
    if (chosen) search.set('country', chosen.id);
    for (const [key, value] of Object.entries(extra)) search.set(key, value);
    const qs = search.toString();
    return qs ? `${BASE_PATH}?${qs}` : BASE_PATH;
  };

  return (
    <>
      <AdminPageHeader
        title="SEO Intelligence"
        description={
          chosen
            ? `How every URL in ${chosen.name} is set up for search engines, answer engines and AI assistants.`
            : 'How every URL on the site is set up for search engines, answer engines and AI assistants.'
        }
        crumbs={[{ label: 'SEO Intelligence' }]}
        actions={<RecalculateControls outdated={outdated} total={targets} autoStart={cached === 0 && targets > 0} />}
      />

      <p className="mb-5 flex items-start gap-2 rounded-lg border border-hairline bg-muted/[0.04] px-3 py-2.5 text-xs leading-relaxed text-muted">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>{SEO_DISCLAIMER}</span>
      </p>

      {outdated > 0 && cached > 0 ? (
        <p className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
          {formatNumber(outdated)} {outdated === 1 ? 'URL has' : 'URLs have'} changed or been added since
          {outdated === 1 ? ' its' : ' their'} score was last calculated. Use <strong>Recalculate outdated</strong> to
          bring {outdated === 1 ? 'it' : 'them'} up to date.
        </p>
      ) : null}

      <SummaryCards summary={summary} link={link} />

      <FilterBar
        searchPlaceholder="Search by title or URL"
        definitions={definitions}
        presets={presets}
      />

      <Card>
        {list.rows.length === 0 ? (
          <EmptyState
            icon={<Gauge className="h-5 w-5" />}
            title={
              filtered
                ? 'No URLs match those filters'
                : targets === 0
                  ? 'Nothing to score yet'
                  : 'Scores have not been calculated yet'
            }
            description={
              filtered
                ? 'Try clearing a filter or the search.'
                : targets === 0
                  ? 'Create pages, products or articles and they will be scored here.'
                  : 'Use Recalculate all to score every URL. It runs in small batches and can be left to finish.'
            }
          />
        ) : (
          <>
            {/* One market chosen: every row is in it, so the column would say nothing. */}
            <AuditCards rows={list.rows} isOutdated={isOutdated} showCountry={multiCountry && !chosen} />
            <AuditTable rows={list.rows} isOutdated={isOutdated} showCountry={multiCountry && !chosen} />
            <AdminPagination
              page={page}
              pages={Math.max(1, Math.ceil(list.total / PER_PAGE))}
              total={list.total}
              basePath={BASE_PATH}
              params={params}
            />
          </>
        )}
      </Card>

      <div className="mt-6 flex flex-col gap-3 text-xs text-muted sm:flex-row sm:items-center sm:justify-between">
        <ScoreLegend />
        <p>
          Overall = SEO {Math.round(OVERALL_WEIGHTS.seo * 100)}% · AEO {Math.round(OVERALL_WEIGHTS.aeo * 100)}% · GEO{' '}
          {Math.round(OVERALL_WEIGHTS.geo * 100)}%
          {summary.lastCalculated ? ` · last calculated ${formatDate(summary.lastCalculated)}` : ''}
        </p>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

function SummaryCards({
  summary,
  link,
}: {
  summary: AuditSummary;
  link: (params: Record<string, string>) => string;
}) {
  const site = summary.site;
  const attention: Array<{ label: string; value: number; href: string; hint: string }> = [
    {
      label: 'URLs with critical issues',
      value: summary.criticalUrls,
      href: link({ issue: 'critical' }),
      hint: `${formatNumber(summary.critical)} critical ${summary.critical === 1 ? 'issue' : 'issues'} in total`,
    },
    {
      label: 'Pages needing attention',
      value: summary.pagesNeedingAttention,
      href: link({ type: 'page', score: 'attention' }),
      hint: `Scoring under ${ATTENTION_BELOW}`,
    },
    {
      label: 'Products needing attention',
      value: summary.productsNeedingAttention,
      href: link({ type: 'product', score: 'attention' }),
      hint: `Scoring under ${ATTENTION_BELOW}`,
    },
    {
      label: 'Missing metadata',
      value: summary.missingMetadata,
      href: link({ issue: 'metadata' }),
      hint: 'No SEO title or description of their own',
    },
    {
      label: 'Missing structured data',
      value: summary.missingSchema,
      href: link({ issue: 'schema' }),
      hint: 'Expected schema types absent',
    },
    {
      label: 'No primary keywords',
      value: summary.missingKeywords,
      href: link({ issue: 'keywords' }),
      hint: 'Nothing to check the copy against',
    },
    {
      label: 'Indexing conflicts',
      value: summary.indexingConflicts,
      href: link({ issue: 'conflict' }),
      hint: 'Canonical, robots or sitemap disagree',
    },
  ];

  return (
    <div className="mb-6 space-y-4">
      {/* Score cards are glass, like the dashboard's KPIs; the audit table below stays solid. */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <Card className="glass-card p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-content">Overall site score</h2>
              <p className="mt-0.5 text-xs leading-relaxed text-muted">
                {site
                  ? `From ${formatNumber(site.counted)} live, indexable ${site.counted === 1 ? 'URL' : 'URLs'}, weighted by page type: the home page and products count most, tag archives least. Drafts and noindex pages are left out.`
                  : 'Appears once at least one live, indexable URL has been scored.'}
              </p>
            </div>
          </div>
          {site ? (
            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <ScoreRing score={site.overall} label="Overall" size="lg" />
              <ScoreRing score={site.seo} label="SEO" />
              <ScoreRing score={site.aeo} label="AEO" />
              <ScoreRing score={site.geo} label="GEO" />
            </div>
          ) : (
            <p className="mt-4 rounded-lg bg-muted/[0.05] px-3 py-6 text-center text-sm text-muted">No site score yet.</p>
          )}
        </Card>

        <Card className="glass-card p-4 sm:p-5">
          <div className="grid grid-cols-3 gap-3">
            <Metric label="Indexable URLs" value={summary.indexable} hint={`of ${formatNumber(summary.total)} scored`} />
            <Metric
              label="Critical issues"
              value={summary.critical}
              hint={`on ${formatNumber(summary.criticalUrls)} ${summary.criticalUrls === 1 ? 'URL' : 'URLs'}`}
              tone={summary.critical > 0 ? 'text-red-700' : undefined}
            />
            <Metric
              label="Warnings"
              value={summary.warnings}
              hint={`on ${formatNumber(summary.warningUrls)} ${summary.warningUrls === 1 ? 'URL' : 'URLs'}`}
              tone={summary.warnings > 0 ? 'text-amber-700' : undefined}
            />
          </div>
          <Distribution summary={summary} link={link} />
        </Card>
      </div>

      <Card className="p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-content">Needs attention</h2>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {attention.map((item) => (
            <li key={item.label}>
              <Link
                href={item.href}
                className="group flex h-full items-start justify-between gap-2 rounded-lg border border-hairline px-3 py-2.5 transition-colors hover:border-brand/40 hover:bg-brand/[0.02]"
              >
                <span className="min-w-0">
                  <span className="block text-xs text-muted">{item.label}</span>
                  <span
                    className={cn(
                      'block font-heading text-xl font-bold tabular-nums',
                      item.value > 0 ? 'text-content' : 'text-muted',
                    )}
                  >
                    {formatNumber(item.value)}
                  </span>
                  <span className="block truncate text-[0.6875rem] text-muted">{item.hint}</span>
                </span>
                <ArrowUpRight
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted opacity-0 transition-opacity group-hover:opacity-100"
                  aria-hidden="true"
                />
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function Metric({ label, value, hint, tone }: { label: string; value: number; hint?: string; tone?: string }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-xs text-muted">{label}</p>
      <p className={cn('font-heading text-2xl font-bold tabular-nums text-content', tone)}>{formatNumber(value)}</p>
      {hint ? <p className="truncate text-[0.6875rem] text-muted">{hint}</p> : null}
    </div>
  );
}

function Distribution({
  summary,
  link,
}: {
  summary: AuditSummary;
  link: (params: Record<string, string>) => string;
}) {
  const states: ScoreState[] = ['poor', 'needs-improvement', 'good', 'excellent'];
  const total = states.reduce((sum, state) => sum + summary.distribution[state], 0);
  return (
    <div className="mt-5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Score distribution</h3>
      <p className="sr-only">Overall scores of live, indexable URLs.</p>
      <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-muted/15" aria-hidden="true">
        {total > 0
          ? states.map((state) =>
              summary.distribution[state] > 0 ? (
                <div
                  key={state}
                  className={SCORE_TONES[state].bar}
                  style={{ width: `${(summary.distribution[state] / total) * 100}%` }}
                />
              ) : null,
            )
          : null}
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2 2xl:grid-cols-4">
        {states.map((state) => (
          <li key={state}>
            <Link
              href={link({ score: state, index: 'indexable' })}
              className="block rounded-lg border border-hairline px-2.5 py-2 transition-colors hover:border-brand/40"
            >
              <span className="flex items-center gap-1.5 text-[0.6875rem] text-muted">
                <span aria-hidden="true" className={cn('h-2 w-2 shrink-0 rounded-full', SCORE_TONES[state].bar)} />
                <span className="truncate">{SCORE_STATE_LABELS[state]}</span>
              </span>
              <span className="block font-semibold tabular-nums text-content">
                {formatNumber(summary.distribution[state])}
                <span className="font-normal text-muted">
                  {' '}
                  {total > 0 ? `(${Math.round((summary.distribution[state] / total) * 100)}%)` : ''}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

function StatusCell({ row, outdated }: { row: AuditListRow; outdated: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <Badge tone={row.status === 'live' ? 'success' : row.status === 'not-served' ? 'warning' : 'neutral'}>
        {AUDIT_ROW_STATUS_LABELS[row.status]}
      </Badge>
      {row.noIndex ? <Badge tone="purple">Noindex</Badge> : null}
      {outdated ? (
        <Badge tone="warning" title="The content changed after this score was calculated.">
          Outdated
        </Badge>
      ) : null}
    </div>
  );
}

function IssuesCell({ row }: { row: AuditListRow }) {
  if (row.issueCount === 0 && row.suggestionCount === 0) {
    return <span className="text-xs text-muted">None</span>;
  }
  return (
    <span className="flex flex-col whitespace-nowrap text-xs">
      {row.criticalCount > 0 ? (
        <span className="font-semibold text-red-700">{row.criticalCount} critical</span>
      ) : null}
      {row.warningCount > 0 ? (
        <span className="text-amber-700">
          {row.warningCount} {row.warningCount === 1 ? 'warning' : 'warnings'}
        </span>
      ) : null}
      {row.issueCount === 0 ? (
        <span className="text-muted">
          {row.suggestionCount} {row.suggestionCount === 1 ? 'suggestion' : 'suggestions'}
        </span>
      ) : null}
    </span>
  );
}

function AuditTable({
  rows,
  isOutdated,
  showCountry,
}: {
  rows: AuditListRow[];
  isOutdated: (row: AuditListRow) => boolean;
  showCountry: boolean;
}) {
  return (
    <div className="hidden md:block">
      <TableWrap className="relative">
        <Table className="min-w-[56rem] [&_td]:px-2.5">
          <caption className="sr-only">SEO, AEO and GEO scores for every URL</caption>
          <thead>
            <tr>
              <SortableTh field="title" defaultDir="asc">
                Page
              </SortableTh>
              <Th>Type</Th>
              {showCountry ? <Th>Country</Th> : null}
              <SortableTh field="seo" align="center" defaultDir="asc">
                SEO
              </SortableTh>
              <SortableTh field="aeo" align="center" defaultDir="asc">
                AEO
              </SortableTh>
              <SortableTh field="geo" align="center" defaultDir="asc">
                GEO
              </SortableTh>
              <SortableTh field="overall" align="center" defaultDir="asc">
                Overall
              </SortableTh>
              <Th>Status</Th>
              <SortableTh field="issues">Issues</SortableTh>
              <SortableTh field="updated">Updated</SortableTh>
              <Th align="right">
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const href = auditHref({ type: row.entityType, id: row.entityId, countryId: row.countryId });
              return (
                <Tr key={row.id}>
                  <Td className="max-w-[15rem]">
                    <Link href={href} className="block truncate font-medium text-content hover:text-brand">
                      {row.title}
                    </Link>
                    <code className="block truncate font-mono text-[0.6875rem] text-muted">{row.url}</code>
                    {row.topIssue ? (
                      <p className="mt-0.5 truncate text-[0.6875rem] text-muted" title={row.topIssue}>
                        {row.topIssue}
                      </p>
                    ) : null}
                  </Td>
                  <Td className="min-w-[5.5rem] text-sm">{PAGE_KIND_LABELS[row.kind]}</Td>
                  {showCountry ? <Td className="min-w-[5.5rem] text-sm">{row.countryName}</Td> : null}
                  <Td align="center">
                    <ScoreNumber score={row.seoScore} />
                  </Td>
                  <Td align="center">
                    <ScoreNumber score={row.aeoScore} />
                  </Td>
                  <Td align="center">
                    <ScoreNumber score={row.geoScore} />
                  </Td>
                  <Td align="center">
                    <ScoreBadge score={row.overallScore} label="Overall" />
                  </Td>
                  <Td>
                    <StatusCell row={row} outdated={isOutdated(row)} />
                  </Td>
                  <Td>
                    <IssuesCell row={row} />
                  </Td>
                  <Td className="whitespace-nowrap text-sm text-muted">
                    <span className="block">{formatDate(row.contentUpdatedAt)}</span>
                    <span className="block text-[0.6875rem]">Audited {formatDate(row.calculatedAt)}</span>
                  </Td>
                  <Td align="right" className="whitespace-nowrap">
                    <span className="inline-flex items-center gap-0.5">
                      <Link
                        href={href}
                        title="View the full analysis"
                        className="rounded-md p-1.5 text-muted transition-colors hover:bg-muted/10 hover:text-brand"
                      >
                        <Gauge className="h-4 w-4" aria-hidden="true" />
                        <span className="sr-only">View the full analysis of {row.title}</span>
                      </Link>
                      <Link
                        href={editPathFor(row.entityType, row.entityId)}
                        title="Edit"
                        className="rounded-md p-1.5 text-muted transition-colors hover:bg-muted/10 hover:text-brand"
                      >
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                        <span className="sr-only">Edit {row.title}</span>
                      </Link>
                    </span>
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      </TableWrap>
    </div>
  );
}

/** The same rows as cards, for narrow screens where a wide table cannot fit. */
function AuditCards({
  rows,
  isOutdated,
  showCountry,
}: {
  rows: AuditListRow[];
  isOutdated: (row: AuditListRow) => boolean;
  showCountry: boolean;
}) {
  return (
    <ul className="divide-y divide-hairline md:hidden">
      {rows.map((row) => {
        const href = auditHref({ type: row.entityType, id: row.entityId, countryId: row.countryId });
        return (
          <li key={row.id} className="space-y-2 px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Link href={href} className="block break-words font-medium text-content hover:text-brand">
                  {row.title}
                </Link>
                <p className="break-all font-mono text-[0.6875rem] text-muted">{row.url}</p>
                <p className="text-xs text-muted">
                  {PAGE_KIND_LABELS[row.kind]}
                  {showCountry ? ` · ${row.countryName}` : ''} · {formatDate(row.contentUpdatedAt)}
                </p>
              </div>
              <ScoreBadge score={row.overallScore} label="Overall" className="shrink-0" />
            </div>
            <dl className="grid grid-cols-3 gap-2 text-xs">
              {(
                [
                  ['SEO', row.seoScore],
                  ['AEO', row.aeoScore],
                  ['GEO', row.geoScore],
                ] as const
              ).map(([label, score]) => (
                <div key={label} className="rounded-lg bg-muted/[0.05] px-2 py-1.5">
                  <dt className="text-muted">{label}</dt>
                  <dd>
                    <ScoreNumber score={score} />
                  </dd>
                </div>
              ))}
            </dl>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <StatusCell row={row} outdated={isOutdated(row)} />
              <IssuesCell row={row} />
            </div>
            {row.topIssue ? <p className="text-xs text-muted">{row.topIssue}</p> : null}
            <div className="flex gap-4 text-xs font-medium">
              <Link href={href} className="text-brand hover:underline">
                View analysis
              </Link>
              <Link href={editPathFor(row.entityType, row.entityId)} className="text-content hover:text-brand">
                Edit
              </Link>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

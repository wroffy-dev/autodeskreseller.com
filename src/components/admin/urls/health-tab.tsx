'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowRight, CheckCircle2, CornerDownRight, EyeOff, RefreshCw, Search, Signpost, Unlink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/field';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Alert, EmptyState } from '@/components/ui/states';
import { Table, TableWrap, Th, Td, Tr } from '@/components/ui/table';
import { Spinner } from '@/components/ui/icons';
import { useToast } from '@/components/ui/toast';
import { formatDate, formatNumber } from '@/lib/utils/format';
import {
  giveAddressHomeAction,
  healthAction,
  notFoundAction,
  setNotFoundStatusAction,
  straightenRedirectAction,
  type Destination,
} from '@/lib/actions/urls';
import type { BrokenLink, NotFoundRow, RedirectProblem } from '@/lib/urls/health-report';
import { REDIRECT_TYPE_LABELS } from '@/lib/urls/types';
import { useManager } from './manager-context';
import { useDebounced, useQueryState } from './use-query-state';
import { FilterSelect, Pager, PathText, useLoader } from './shared';
import { DestinationPicker } from './destination-picker';

const DEFAULTS = { status: 'OPEN', q: '', page: '1' };

const PROBLEMS: Record<RedirectProblem['problem'], { label: string; tone: BadgeTone }> = {
  'target-gone': { label: 'Destination deleted', tone: 'danger' },
  'target-unpublished': { label: 'Destination unpublished', tone: 'warning' },
  chain: { label: 'Chain', tone: 'warning' },
  nowhere: { label: 'Leads nowhere', tone: 'danger' },
  dormant: { label: 'Never fires', tone: 'neutral' },
  disabled: { label: 'Disabled', tone: 'neutral' },
};

type Health = { redirects: RedirectProblem[]; broken: { links: BrokenLink[]; scanned: number; truncated: boolean } };

/** Where an address that answers 404 should send visitors instead. */
type Mapping = { source: string; notFoundId: string | null; title: string; description: string };

/**
 * URL Health, from real data only: addresses visitors asked for that answered
 * 404, redirects that no longer deliver, and stored links that lead nowhere.
 * Nothing here fetches a URL; every list is bounded.
 */
export function HealthTab() {
  const { overview, refresh, go } = useManager();
  const { toast } = useToast();
  const [filters, setFilters] = useQueryState('n_', DEFAULTS);
  const [search, setSearch] = React.useState(filters.q);
  const debounced = useDebounced(search);
  const [mapping, setMapping] = React.useState<Mapping | null>(null);
  const [destination, setDestination] = React.useState<Destination | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [dialogError, setDialogError] = React.useState<string | null>(null);

  React.useEffect(() => setSearch(filters.q), [filters.q]);
  React.useEffect(() => {
    if (debounced !== filters.q) setFilters({ q: debounced, page: '1' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const misses = useLoader<{ rows: NotFoundRow[]; total: number; page: number; pages: number }>(
    () =>
      notFoundAction({
        status: (filters.status || 'OPEN') as NotFoundRow['status'],
        q: filters.q || undefined,
        page: Number(filters.page) || 1,
      }),
    [filters.status, filters.q, filters.page],
  );
  const health = useLoader<Health>(() => healthAction(), []);

  function openMapping(next: Mapping) {
    setDialogError(null);
    setDestination(null);
    setMapping(next);
  }

  async function map() {
    if (!mapping || !destination) return;
    setBusy('map');
    setDialogError(null);
    const result = await giveAddressHomeAction({
      source: mapping.source,
      target: { entityId: destination.entityId, countryId: destination.countryId, type: destination.type },
      notFoundId: mapping.notFoundId,
    });
    setBusy(null);
    if (!result.ok) {
      setDialogError(result.error);
      return;
    }
    toast(result.message ?? 'Saved.', 'success');
    setMapping(null);
    misses.reload();
    health.reload();
    refresh();
  }

  async function setStatus(row: NotFoundRow, status: 'OPEN' | 'IGNORED') {
    setBusy(row.id);
    const result = await setNotFoundStatusAction({ id: row.id, status });
    setBusy(null);
    toast(result.ok ? (result.message ?? 'Saved.') : result.error, result.ok ? 'success' : 'error');
    misses.reload();
    refresh();
  }

  async function straighten(problem: RedirectProblem) {
    setBusy(problem.redirectId);
    const result = await straightenRedirectAction(problem.redirectId);
    setBusy(null);
    toast(result.ok ? (result.message ?? 'Saved.') : result.error, result.ok ? 'success' : 'error');
    health.reload();
  }

  const problems = (health.data?.redirects ?? []).filter((problem) => problem.problem !== 'dormant');

  return (
    <div className="space-y-8">
      <p className="max-w-3xl text-sm text-muted">
        Worked out from real requests and the site’s own data — nothing here fetches a page. An address that
        answers 404 can be sent to published content; it is never sent anywhere by default.
      </p>

      {/* 404s */}
      <section aria-labelledby="health-404" className="space-y-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h3 id="health-404" className="text-sm font-semibold text-content">
              Addresses that answered 404
            </h3>
            <p className="mt-0.5 text-xs text-muted">Most requested first. Probes for files such as .php are not recorded.</p>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,16rem)_minmax(0,10rem)]">
            <div className="relative">
              <label htmlFor="health-search" className="sr-only">
                Search 404s
              </label>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
              <Input
                id="health-search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search addresses"
                className="h-9 pl-9 text-sm"
              />
            </div>
            <FilterSelect
              id="health-status"
              label="Status"
              value={filters.status}
              onChange={(value) => setFilters({ status: value, page: '1' })}
              options={[
                { value: 'OPEN', label: 'Open' },
                { value: 'IGNORED', label: 'Ignored' },
                { value: 'RESOLVED', label: 'Redirected' },
              ]}
            />
          </div>
        </div>

        {misses.error ? (
          <Alert tone="danger" title="Could not load 404s">
            {misses.error}
          </Alert>
        ) : null}

        <div aria-busy={misses.loading} className={misses.loading && misses.data ? 'opacity-60' : undefined}>
          {!misses.data && misses.loading ? (
            <div className="h-32 animate-pulse rounded-xl bg-muted/10" aria-label="Loading 404s" />
          ) : misses.data && misses.data.rows.length === 0 ? (
            <EmptyState
              icon={<CheckCircle2 className="h-6 w-6" aria-hidden="true" />}
              title={filters.status === 'OPEN' ? 'No open 404s' : 'Nothing here'}
              description={
                filters.status === 'OPEN'
                  ? 'No visitor has asked for an address that does not exist — or every one has been dealt with.'
                  : undefined
              }
            />
          ) : misses.data ? (
            <>
              <TableWrap className="relative">
                <Table className="min-w-[48rem]">
                  <caption className="sr-only">Addresses that answered 404</caption>
                  <thead>
                    <tr>
                      <Th>Address</Th>
                      <Th align="center">Requests</Th>
                      <Th>Last seen</Th>
                      <Th>Last referrer</Th>
                      <Th align="right">
                        <span className="sr-only">Actions</span>
                      </Th>
                    </tr>
                  </thead>
                  <tbody>
                    {misses.data.rows.map((row) => (
                      <Tr key={row.id}>
                        <Td>
                          <PathText path={row.path} />
                          {row.countryName && overview.markets.length > 1 ? (
                            <span className="mt-0.5 block text-xs text-muted">{row.countryName}</span>
                          ) : null}
                        </Td>
                        <Td align="center" className="text-sm text-content">
                          {formatNumber(row.hits)}
                        </Td>
                        <Td className="whitespace-nowrap text-xs text-muted">
                          {formatDate(row.lastSeenAt)}
                          <span className="block">first {formatDate(row.firstSeenAt)}</span>
                        </Td>
                        <Td>
                          {row.lastReferrer ? (
                            <span className="block max-w-[16rem] break-all text-xs text-muted">{row.lastReferrer}</span>
                          ) : (
                            <span className="text-xs text-muted">Direct</span>
                          )}
                        </Td>
                        <Td align="right">
                          <div className="flex items-center justify-end gap-1">
                            {row.status === 'RESOLVED' ? (
                              <Badge tone="success">Redirected</Badge>
                            ) : (
                              <>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() =>
                                    openMapping({
                                      source: row.path,
                                      notFoundId: row.id,
                                      title: 'Send this address somewhere',
                                      description: `Requested ${formatNumber(row.hits)} time(s). Visitors will be redirected to the content you choose.`,
                                    })
                                  }
                                  disabled={!overview.resolverEnabled}
                                >
                                  <Signpost className="h-4 w-4" aria-hidden="true" />
                                  <span className="hidden lg:inline">Redirect</span>
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => setStatus(row, row.status === 'IGNORED' ? 'OPEN' : 'IGNORED')}
                                  disabled={busy === row.id}
                                  aria-label={row.status === 'IGNORED' ? `Reopen ${row.path}` : `Ignore ${row.path}`}
                                >
                                  <EyeOff className="h-4 w-4" aria-hidden="true" />
                                  <span className="hidden lg:inline">{row.status === 'IGNORED' ? 'Reopen' : 'Ignore'}</span>
                                </Button>
                              </>
                            )}
                          </div>
                        </Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </TableWrap>
              <div className="mt-3">
                <Pager
                  page={misses.data.page}
                  pages={misses.data.pages}
                  total={misses.data.total}
                  noun="address"
                  plural="addresses"
                  onPage={(page) => setFilters({ page: String(page) })}
                />
              </div>
            </>
          ) : null}
        </div>
      </section>

      {/* Redirect problems */}
      <section aria-labelledby="health-redirects" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 id="health-redirects" className="text-sm font-semibold text-content">
            Redirect problems{health.data ? ` (${formatNumber(problems.length)})` : ''}
          </h3>
          <Button size="sm" variant="outline" onClick={() => health.reload()} disabled={health.loading}>
            {health.loading ? <Spinner className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
            Check again
          </Button>
        </div>
        {health.error ? (
          <Alert tone="danger" title="Could not check redirects and links">
            {health.error}
          </Alert>
        ) : !health.data ? (
          <div className="h-24 animate-pulse rounded-xl bg-muted/10" aria-label="Checking redirects" />
        ) : problems.length === 0 ? (
          <p className="flex items-center gap-1.5 text-sm text-emerald-700">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            Every redirect delivers visitors somewhere that exists.
          </p>
        ) : (
          <ul className="divide-y divide-hairline rounded-xl border border-hairline">
            {problems.map((problem) => {
              const tag = PROBLEMS[problem.problem];
              return (
                <li key={`${problem.redirectId}-${problem.problem}`} className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 space-y-1">
                    <p className="flex flex-wrap items-center gap-1.5">
                      <PathText path={problem.source} />
                      <ArrowRight className="h-3 w-3 text-muted" aria-hidden="true" />
                      <PathText path={problem.destination} />
                      <Badge tone={tag.tone}>{tag.label}</Badge>
                    </p>
                    <p className="text-xs text-muted">{problem.message}</p>
                  </div>
                  <div className="shrink-0">
                    {problem.problem === 'target-gone' || problem.problem === 'target-unpublished' ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          openMapping({
                            source: problem.source,
                            notFoundId: null,
                            title: 'Choose a new destination',
                            description: 'This redirect’s content is gone or unpublished, so it answers 404. Point it at published content.',
                          })
                        }
                        disabled={!overview.resolverEnabled}
                      >
                        Choose a replacement
                      </Button>
                    ) : problem.problem === 'chain' ? (
                      <Button size="sm" variant="outline" onClick={() => straighten(problem)} disabled={busy === problem.redirectId}>
                        {busy === problem.redirectId ? (
                          <Spinner className="h-4 w-4 animate-spin" aria-hidden="true" />
                        ) : (
                          <CornerDownRight className="h-4 w-4" aria-hidden="true" />
                        )}
                        Send it straight
                      </Button>
                    ) : (
                      <Button size="sm" variant="ghost" onClick={() => go('redirects')}>
                        Open Redirects
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Broken internal links */}
      <section aria-labelledby="health-links" className="space-y-3">
        <div>
          <h3 id="health-links" className="text-sm font-semibold text-content">
            Broken internal links{health.data ? ` (${formatNumber(health.data.broken.links.length)})` : ''}
          </h3>
          <p className="mt-0.5 text-xs text-muted">
            Links stored in menus and page content that lead to no page, product, article or redirect.
            {health.data
              ? ` ${formatNumber(health.data.broken.scanned)} link(s) checked${health.data.broken.truncated ? ' — the first part of a large site; fix these and check again' : ''}.`
              : ''}
          </p>
        </div>
        {!health.data ? (
          health.error ? null : <div className="h-24 animate-pulse rounded-xl bg-muted/10" aria-label="Checking links" />
        ) : health.data.broken.links.length === 0 ? (
          <p className="flex items-center gap-1.5 text-sm text-emerald-700">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            No broken internal links found.
          </p>
        ) : (
          <ul className="divide-y divide-hairline rounded-xl border border-hairline">
            {health.data.broken.links.map((link, index) => (
              <li key={`${link.href}-${index}`} className="flex flex-col gap-1 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5">
                    <Unlink className="h-3.5 w-3.5 shrink-0 text-red-600" aria-hidden="true" />
                    <PathText path={link.href} />
                  </p>
                  <p className="mt-0.5 text-xs text-muted">{link.where}</p>
                </div>
                {link.editHref ? (
                  <Link href={link.editHref} className="shrink-0 text-xs font-medium text-brand hover:underline">
                    Fix the link
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <Dialog
        open={Boolean(mapping)}
        onClose={() => setMapping(null)}
        size="lg"
        title={mapping?.title ?? ''}
        description={mapping?.description}
        footer={
          <>
            <Button variant="outline" onClick={() => setMapping(null)} disabled={busy === 'map'}>
              Cancel
            </Button>
            <Button onClick={map} disabled={busy === 'map' || !destination}>
              {busy === 'map' ? <Spinner className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              Redirect here
            </Button>
          </>
        }
      >
        {mapping ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-hairline bg-muted/5 px-3 py-2">
              <p className="text-xs text-muted">Address</p>
              <PathText path={mapping.source} />
            </div>
            <Field label="Send visitors to" htmlFor="health-destination" hint="Only published content can be chosen.">
              <DestinationPicker id="health-destination" value={destination} onChange={setDestination} />
            </Field>
            <p className="text-xs text-muted">
              This writes a permanent redirect ({REDIRECT_TYPE_LABELS.PERMANENT}). Browsers cache it, so choose the
              destination you mean to keep.
            </p>
            {dialogError ? <Alert tone="danger">{dialogError}</Alert> : null}
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}

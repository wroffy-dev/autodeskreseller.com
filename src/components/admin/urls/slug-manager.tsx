'use client';

import * as React from 'react';
import { Link2, RefreshCw, ScanSearch, ShieldCheck, ShieldOff } from 'lucide-react';
import { AdminTabs } from '@/components/admin/admin-tabs';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/states';
import { Checkbox } from '@/components/ui/field';
import { Dialog } from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/icons';
import { useToast } from '@/components/ui/toast';
import { formatDate, formatNumber } from '@/lib/utils/format';
import { overviewAction, runScanAction, setResolverAction } from '@/lib/actions/urls';
import type { ManagerOverview } from '@/lib/urls/manager';
import { MANAGER_TABS, type ManagerTab } from './tabs';
import { ManagerCtx } from './manager-context';
import { AllUrlsTab } from './all-urls-tab';
import { PatternsTab } from './patterns-tab';
import { RedirectsTab } from './redirects-tab';
import { ConflictsTab } from './conflicts-tab';
import { HistoryTab } from './history-tab';
import { HealthTab } from './health-tab';

const LABELS: Record<ManagerTab, string> = {
  urls: 'All URLs',
  patterns: 'URL Patterns',
  redirects: 'Redirects',
  conflicts: 'Conflicts',
  history: 'History',
  health: 'URL Health',
};

export function SlugManager({
  overview: initial,
  initialTab,
}: {
  overview: ManagerOverview;
  initialTab: ManagerTab;
}) {
  const { toast } = useToast();
  const [overview, setOverview] = React.useState(initial);
  const [tab, setTab] = React.useState<ManagerTab>(initialTab);
  // Tabs stay mounted once opened, so their filters and scroll survive a switch.
  const [visited, setVisited] = React.useState<Set<ManagerTab>>(() => new Set([initialTab]));
  const [busy, setBusy] = React.useState<'scan' | 'toggle' | null>(null);
  const [confirmOn, setConfirmOn] = React.useState(false);
  const [acknowledged, setAcknowledged] = React.useState(false);

  const refresh = React.useCallback(async () => {
    const result = await overviewAction();
    if (result.ok && result.data) setOverview(result.data);
  }, []);

  const go = React.useCallback((next: ManagerTab) => {
    setTab(next);
    setVisited((current) => new Set(current).add(next));
    const params = new URLSearchParams(window.location.search);
    if (next === 'urls') params.delete('tab');
    else params.set('tab', next);
    const query = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
  }, []);

  async function scan() {
    setBusy('scan');
    const result = await runScanAction();
    setBusy(null);
    toast(result.ok ? (result.message ?? 'Scan complete.') : result.error, result.ok ? 'success' : 'error');
    await refresh();
  }

  async function setResolver(enabled: boolean) {
    setBusy('toggle');
    const result = await setResolverAction({ enabled, acknowledged });
    setBusy(null);
    setConfirmOn(false);
    toast(result.ok ? (result.message ?? 'Saved.') : result.error, result.ok ? 'success' : 'error');
    await refresh();
  }

  const conflicts = overview.counts.unregistered + (overview.lastScan?.redirectIssues ?? 0);
  const tabs = MANAGER_TABS.map((id) => ({
    id,
    label: LABELS[id],
    badge:
      id === 'conflicts'
        ? conflicts || undefined
        : id === 'health'
          ? overview.counts.notFound || undefined
          : undefined,
  }));

  return (
    <ManagerCtx.Provider value={{ overview, refresh, go }}>
      <RegistryStatus
        overview={overview}
        busy={busy}
        onScan={scan}
        onSwitchOn={() => {
          setAcknowledged(false);
          setConfirmOn(true);
        }}
        onSwitchOff={() => setResolver(false)}
      />

      <div className="mt-5 rounded-2xl border border-hairline bg-surface shadow-sm">
        {/* Sticky under the floating topbar on desktop, so switching tool never
            means scrolling back up a long URL list. */}
        <AdminTabs
          tabs={tabs}
          active={tab}
          onChange={(id) => go(id as ManagerTab)}
          className="z-sticky rounded-t-2xl bg-surface/95 px-2 backdrop-blur sm:px-4 lg:sticky lg:top-[5.25rem]"
        />
        {MANAGER_TABS.map((id) =>
          visited.has(id) ? (
            <div
              key={id}
              role="tabpanel"
              id={`panel-${id}`}
              aria-labelledby={`tab-${id}`}
              hidden={tab !== id}
              className="p-4 sm:p-5"
            >
              {id === 'urls' ? <AllUrlsTab /> : null}
              {id === 'patterns' ? <PatternsTab /> : null}
              {id === 'redirects' ? <RedirectsTab /> : null}
              {id === 'conflicts' ? <ConflictsTab /> : null}
              {id === 'history' ? <HistoryTab /> : null}
              {id === 'health' ? <HealthTab /> : null}
            </div>
          ) : null,
        )}
      </div>

      <Dialog
        open={confirmOn}
        onClose={() => setConfirmOn(false)}
        title="Switch public routing to the URL registry?"
        description="Every public address will be answered from the registry from the next request, on every server."
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmOn(false)} disabled={busy !== null}>
              Cancel
            </Button>
            <Button
              onClick={() => setResolver(true)}
              disabled={busy !== null || ((overview.lastScan?.collisions ?? 0) > 0 && !acknowledged)}
            >
              {busy === 'toggle' ? <Spinner className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              Switch on
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm text-content">
          <p>
            The last scan registered every address the site serves today, exactly where it is. Switching on
            changes no URL. What it adds: addresses you edit here take effect, old addresses redirect before
            anything renders, and 404s are recorded for URL Health.
          </p>
          <p className="text-muted">You can switch back at any time; the previous router takes over again immediately.</p>
          {(overview.lastScan?.collisions ?? 0) > 0 ? (
            <Alert tone="warning" title={`${overview.lastScan!.collisions} collision(s) in the last scan`}>
              <p className="mb-2">
                These addresses were not registered — most were never reachable under the previous router
                either. They stay as they are until you resolve them under Conflicts.
              </p>
              <Checkbox
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
                label="I have reviewed the collisions"
              />
            </Alert>
          ) : null}
        </div>
      </Dialog>
    </ManagerCtx.Provider>
  );
}

function RegistryStatus({
  overview,
  busy,
  onScan,
  onSwitchOn,
  onSwitchOff,
}: {
  overview: ManagerOverview;
  busy: 'scan' | 'toggle' | null;
  onScan: () => void;
  onSwitchOn: () => void;
  onSwitchOff: () => void;
}) {
  const stats = [
    { label: 'Registered addresses', value: overview.counts.addresses },
    { label: 'Without an address', value: overview.counts.unregistered, warn: overview.counts.unregistered > 0 },
    { label: 'Redirects', value: overview.counts.redirects },
    { label: 'Open 404s', value: overview.counts.notFound, warn: overview.counts.notFound > 0 },
  ];

  return (
    <section
      aria-label="URL registry status"
      className="rounded-2xl border border-hairline bg-surface p-4 shadow-sm sm:p-5"
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={
              overview.resolverEnabled
                ? 'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700'
                : 'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-700'
            }
            aria-hidden="true"
          >
            {overview.resolverEnabled ? <ShieldCheck className="h-5 w-5" /> : <ShieldOff className="h-5 w-5" />}
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-content">
              {overview.resolverEnabled ? 'The URL registry answers every public address' : 'The URL registry is switched off'}
            </h2>
            <p className="mt-0.5 text-sm text-muted">
              {overview.resolverEnabled
                ? `Live since ${overview.activatedAt ? formatDate(overview.activatedAt) : 'activation'}. Addresses on `
                : 'The site is served by the previous router. Scan, review conflicts, then switch on. Addresses on '}
              <span className="inline-flex items-center gap-1 font-medium text-content">
                <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
                {overview.origin.replace(/^https?:\/\//, '')}
              </span>
              .
            </p>
            <p className="mt-1 text-xs text-muted">
              {overview.lastScanAt
                ? `Last scan ${formatDate(overview.lastScanAt)}: ${overview.lastScan?.registered ?? 0} new, ${overview.lastScan?.collisions ?? 0} collision(s), ${overview.lastScan?.redirectIssues ?? 0} redirect issue(s).`
                : 'Not scanned yet.'}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {overview.everyMarket ? (
            <>
              <Button variant="outline" onClick={onScan} disabled={busy !== null}>
                {busy === 'scan' ? (
                  <Spinner className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : overview.lastScanAt ? (
                  <RefreshCw className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <ScanSearch className="h-4 w-4" aria-hidden="true" />
                )}
                {overview.lastScanAt ? 'Scan again' : 'Run first scan'}
              </Button>
              {overview.resolverEnabled ? (
                <Button variant="outline" onClick={onSwitchOff} disabled={busy !== null}>
                  Switch off
                </Button>
              ) : (
                <Button onClick={onSwitchOn} disabled={busy !== null || !overview.lastScanAt}>
                  Switch on
                </Button>
              )}
            </>
          ) : null}
        </div>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-xl border border-hairline px-3 py-2.5">
            <dt className="text-xs text-muted">{stat.label}</dt>
            <dd className={stat.warn ? 'text-lg font-semibold text-amber-700' : 'text-lg font-semibold text-content'}>
              {formatNumber(stat.value)}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

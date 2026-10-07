'use client';

import * as React from 'react';
import { ArrowRight, History as HistoryIcon, RotateCcw, Search, Signpost } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/field';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Alert, EmptyState } from '@/components/ui/states';
import { Table, TableWrap, Th, Td, Tr } from '@/components/ui/table';
import { Spinner } from '@/components/ui/icons';
import { useToast } from '@/components/ui/toast';
import { formatDate } from '@/lib/utils/format';
import {
  giveAddressHomeAction,
  historyAction,
  previewRestoreAction,
  restoreHistoryAction,
  type Destination,
} from '@/lib/actions/urls';
import type { HistoryRow, RestorePreview } from '@/lib/urls/history';
import { REDIRECT_TYPE_LABELS, URL_CONTENT_TYPES, URL_TYPE_LABELS } from '@/lib/urls/types';
import { useManager } from './manager-context';
import { useDebounced, useQueryState } from './use-query-state';
import { FilterSelect, Pager, PathText, useLoader } from './shared';
import { DestinationPicker } from './destination-picker';

const DEFAULTS = { q: '', country: '', type: '', reason: '', page: '1' };

export const REASON_LABELS: Record<HistoryRow['reason'], { label: string; tone: BadgeTone }> = {
  CREATE: { label: 'Created', tone: 'success' },
  EDIT: { label: 'Edited', tone: 'brand' },
  SLUG: { label: 'Slug changed', tone: 'brand' },
  PATTERN: { label: 'Pattern change', tone: 'info' },
  BULK: { label: 'Bulk change', tone: 'info' },
  IMPORT: { label: 'CSV import', tone: 'info' },
  RESTORE: { label: 'Restored', tone: 'purple' },
  DELETE: { label: 'Removed', tone: 'danger' },
  BACKFILL: { label: 'First scan', tone: 'neutral' },
  MARKET: { label: 'Market prefix', tone: 'warning' },
};

type Restoring = { row: HistoryRow; preview: RestorePreview | null };

/** The address that answers 404 once content is gone: the one this entry left behind. */
function formerAddress(row: HistoryRow): string | null {
  return row.oldPath ?? row.newPath;
}

/**
 * History: every address every piece of content has had, who changed it and
 * when. An earlier address can be restored — after checking it is still free
 * — and the address of deleted content can be given a deliberate new home.
 */
export function HistoryTab() {
  const { overview, refresh } = useManager();
  const { toast } = useToast();
  const [filters, setFilters] = useQueryState('h_', DEFAULTS);
  const [search, setSearch] = React.useState(filters.q);
  const debounced = useDebounced(search);
  const [restoring, setRestoring] = React.useState<Restoring | null>(null);
  const [rehoming, setRehoming] = React.useState<HistoryRow | null>(null);
  const [destination, setDestination] = React.useState<Destination | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [dialogError, setDialogError] = React.useState<string | null>(null);

  React.useEffect(() => setSearch(filters.q), [filters.q]);
  React.useEffect(() => {
    if (debounced !== filters.q) setFilters({ q: debounced, page: '1' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const { data, error, loading, reload } = useLoader<{ rows: HistoryRow[]; total: number; page: number; pages: number }>(
    () =>
      historyAction({
        q: filters.q || undefined,
        countryId: filters.country || undefined,
        type: (filters.type || '') as HistoryRow['type'] | '',
        reason: (filters.reason || '') as HistoryRow['reason'] | '',
        page: Number(filters.page) || 1,
      }),
    [filters.q, filters.country, filters.type, filters.reason, filters.page, overview.counts.history],
  );

  async function openRestore(row: HistoryRow) {
    setDialogError(null);
    setRestoring({ row, preview: null });
    const result = await previewRestoreAction(row.id);
    setRestoring({
      row,
      preview: result.ok && result.data ? result.data : { ok: false, error: result.ok ? 'Could not preview.' : result.error },
    });
  }

  async function restore() {
    if (!restoring) return;
    setBusy(true);
    setDialogError(null);
    const result = await restoreHistoryAction(restoring.row.id);
    setBusy(false);
    if (!result.ok) {
      setDialogError(result.error);
      return;
    }
    toast(result.message ?? 'Restored.', 'success');
    setRestoring(null);
    reload();
    refresh();
  }

  async function rehome() {
    if (!rehoming || !destination) return;
    const source = formerAddress(rehoming);
    if (!source) return;
    setBusy(true);
    setDialogError(null);
    const result = await giveAddressHomeAction({
      source,
      target: { entityId: destination.entityId, countryId: destination.countryId, type: destination.type },
      note: `Former address of ${rehoming.label}`.slice(0, 200),
    });
    setBusy(false);
    if (!result.ok) {
      setDialogError(result.error);
      return;
    }
    toast(result.message ?? 'Saved.', 'success');
    setRehoming(null);
    setDestination(null);
    reload();
    refresh();
  }

  const rows = data?.rows ?? [];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))]">
        <div className="relative sm:col-span-2 lg:col-span-1">
          <label htmlFor="history-search" className="sr-only">
            Search history
          </label>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
          <Input
            id="history-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by name or address"
            className="h-9 pl-9 text-sm"
          />
        </div>
        <FilterSelect
          id="history-country"
          label="Market"
          value={filters.country}
          onChange={(value) => setFilters({ country: value, page: '1' })}
          options={[{ value: '', label: 'All markets' }, ...overview.markets.map((market) => ({ value: market.id, label: market.name }))]}
        />
        <FilterSelect
          id="history-type"
          label="Content type"
          value={filters.type}
          onChange={(value) => setFilters({ type: value, page: '1' })}
          options={[{ value: '', label: 'All content' }, ...URL_CONTENT_TYPES.map((type) => ({ value: type, label: URL_TYPE_LABELS[type] }))]}
        />
        <FilterSelect
          id="history-reason"
          label="Change"
          value={filters.reason}
          onChange={(value) => setFilters({ reason: value, page: '1' })}
          options={[
            { value: '', label: 'Every change' },
            ...Object.entries(REASON_LABELS).map(([value, entry]) => ({ value, label: entry.label })),
          ]}
        />
      </div>

      {error ? (
        <Alert tone="danger" title="Could not load the history">
          {error}
        </Alert>
      ) : null}

      <div aria-busy={loading} className={loading && data ? 'opacity-60' : undefined}>
        {!data && loading ? (
          <div className="h-40 animate-pulse rounded-xl bg-muted/10" aria-label="Loading history" />
        ) : data && rows.length === 0 ? (
          <EmptyState
            icon={<HistoryIcon className="h-6 w-6" aria-hidden="true" />}
            title="No address changes here"
            description="Every change of a public address is recorded, with who made it and when."
          />
        ) : data ? (
          <>
            <TableWrap className="relative">
              <Table className="min-w-[54rem]">
                <caption className="sr-only">Address history</caption>
                <thead>
                  <tr>
                    <Th>When</Th>
                    <Th>Content</Th>
                    <Th>Change</Th>
                    <Th>By</Th>
                    <Th align="right">
                      <span className="sr-only">Actions</span>
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const reason = REASON_LABELS[row.reason];
                    const canRestore = row.exists && Boolean(row.oldPath) && row.oldPath !== row.currentPath;
                    const former = formerAddress(row);
                    return (
                      <Tr key={row.id}>
                        <Td className="whitespace-nowrap text-xs text-muted">{formatDate(row.createdAt)}</Td>
                        <Td>
                          <span className="block max-w-[16rem] truncate font-medium text-content">{row.label}</span>
                          <span className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-muted">
                            {row.typeLabel}
                            {overview.markets.length > 1 ? ` · ${row.countryName}` : ''}
                            {!row.exists ? <Badge tone="danger">Deleted</Badge> : null}
                          </span>
                        </Td>
                        <Td>
                          <span className="flex flex-wrap items-center gap-1.5">
                            <PathText path={row.oldPath} />
                            <ArrowRight className="h-3 w-3 text-muted" aria-hidden="true" />
                            <PathText path={row.newPath} />
                          </span>
                          <Badge tone={reason.tone} className="mt-1">
                            {reason.label}
                          </Badge>
                        </Td>
                        <Td className="text-xs text-muted">{row.actorEmail ?? 'System'}</Td>
                        <Td align="right">
                          {canRestore ? (
                            <Button size="sm" variant="ghost" onClick={() => openRestore(row)} disabled={!overview.resolverEnabled}>
                              <RotateCcw className="h-4 w-4" aria-hidden="true" />
                              Restore
                            </Button>
                          ) : !row.exists && former ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setDialogError(null);
                                setDestination(null);
                                setRehoming(row);
                              }}
                              disabled={!overview.resolverEnabled}
                            >
                              <Signpost className="h-4 w-4" aria-hidden="true" />
                              New home
                            </Button>
                          ) : null}
                        </Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </Table>
            </TableWrap>
            <div className="mt-3">
              <Pager page={data.page} pages={data.pages} total={data.total} noun="change" onPage={(page) => setFilters({ page: String(page) })} />
            </div>
          </>
        ) : null}
      </div>

      <Dialog
        open={Boolean(restoring)}
        onClose={() => setRestoring(null)}
        title="Restore an earlier address?"
        description={restoring ? restoring.row.label : undefined}
        footer={
          <>
            <Button variant="outline" onClick={() => setRestoring(null)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={restore} disabled={busy || !restoring?.preview?.ok || restoring.preview.unchanged}>
              {busy ? <Spinner className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              Restore
            </Button>
          </>
        }
      >
        {!restoring?.preview ? (
          <p className="flex items-center gap-2 text-sm text-muted" role="status">
            <Spinner className="h-4 w-4 animate-spin" aria-hidden="true" />
            Checking the address…
          </p>
        ) : restoring.preview.ok ? (
          <div className="space-y-3 text-sm">
            <p className="flex flex-wrap items-center gap-1.5">
              <PathText path={restoring.preview.from} />
              <ArrowRight className="h-3 w-3 text-muted" aria-hidden="true" />
              <PathText path={restoring.preview.to} />
            </p>
            <p className="text-muted">
              {restoring.preview.unchanged
                ? 'This is already the current address.'
                : restoring.preview.redirect
                  ? `The current address will redirect permanently (${REDIRECT_TYPE_LABELS.PERMANENT}) to the restored one, and every earlier address goes straight there too.`
                  : 'The current address has never been public, so it is released without a redirect.'}
            </p>
            {dialogError ? <Alert tone="danger">{dialogError}</Alert> : null}
          </div>
        ) : (
          <Alert tone="warning">{restoring.preview.error}</Alert>
        )}
      </Dialog>

      <Dialog
        open={Boolean(rehoming)}
        onClose={() => setRehoming(null)}
        size="lg"
        title="Give this address a new home"
        description="The content that lived here was deleted, so the address answers 404. Choose where visitors should go instead."
        footer={
          <>
            <Button variant="outline" onClick={() => setRehoming(null)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={rehome} disabled={busy || !destination}>
              {busy ? <Spinner className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              Redirect here
            </Button>
          </>
        }
      >
        {rehoming ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-hairline bg-muted/5 px-3 py-2">
              <p className="text-xs text-muted">Address</p>
              <PathText path={formerAddress(rehoming)} />
            </div>
            <Field label="Send visitors to" htmlFor="history-destination" hint="Only published content can be chosen.">
              <DestinationPicker id="history-destination" value={destination} onChange={setDestination} />
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

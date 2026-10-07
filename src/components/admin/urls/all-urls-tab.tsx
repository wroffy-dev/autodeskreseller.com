'use client';

import * as React from 'react';
import { Download, ExternalLink, Pencil, RotateCcw, Search, Upload, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { Dialog } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { EmptyState, Alert } from '@/components/ui/states';
import { Table, TableWrap, Th, Td, Tr } from '@/components/ui/table';
import { BulkBar } from '@/components/admin/row-menu';
import { useToast } from '@/components/ui/toast';
import { exportUrlsCsvAction, listUrlsAction } from '@/lib/actions/urls';
import type { UrlListResult, UrlRow } from '@/lib/urls/manager';
import { URL_CONTENT_TYPES, URL_TYPE_LABELS, PUBLICATION_LABELS } from '@/lib/urls/types';
import { useManager } from './manager-context';
import { useDebounced, useQueryState } from './use-query-state';
import { FilterSelect, ModeBadge, Pager, PathText, StateBadge, useLoader } from './shared';
import { UrlDrawer } from './url-drawer';
import { PlanDialog, type PlanRequest } from './plan-dialog';
import { CsvImportDialog } from './csv-import-dialog';

const DEFAULTS = { q: '', country: '', type: '', state: '', mode: '', page: '1' };

export function AllUrlsTab() {
  const { overview, refresh } = useManager();
  const { toast } = useToast();
  const [filters, setFilters] = useQueryState('u_', DEFAULTS);
  const [search, setSearch] = React.useState(filters.q);
  const debounced = useDebounced(search);
  const [selected, setSelected] = React.useState<Map<string, UrlRow>>(new Map());
  const [editing, setEditing] = React.useState<UrlRow | null>(null);
  const [plan, setPlan] = React.useState<PlanRequest | null>(null);
  const [prefixOpen, setPrefixOpen] = React.useState(false);
  const [importOpen, setImportOpen] = React.useState(false);
  const [exporting, setExporting] = React.useState(false);

  React.useEffect(() => setSearch(filters.q), [filters.q]);
  React.useEffect(() => {
    if (debounced !== filters.q) setFilters({ q: debounced, page: '1' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const query = {
    q: filters.q || undefined,
    countryId: filters.country || undefined,
    type: (filters.type || '') as UrlRow['type'] | '',
    state: (filters.state || '') as UrlRow['state'] | '',
    mode: (filters.mode || '') as 'PATTERN' | 'CUSTOM' | 'UNREGISTERED' | '',
    page: Number(filters.page) || 1,
    pageSize: 25,
  };
  const { data, error, loading, reload } = useLoader<UrlListResult>(
    () => listUrlsAction(query),
    [filters.q, filters.country, filters.type, filters.state, filters.mode, filters.page],
  );

  const rows = data?.rows ?? [];
  const pageKeys = rows.map((row) => row.key);
  const allOnPage = pageKeys.length > 0 && pageKeys.every((key) => selected.has(key));

  function toggle(row: UrlRow) {
    setSelected((current) => {
      const next = new Map(current);
      if (next.has(row.key)) next.delete(row.key);
      else next.set(row.key, row);
      return next;
    });
  }
  function togglePage() {
    setSelected((current) => {
      const next = new Map(current);
      if (allOnPage) for (const key of pageKeys) next.delete(key);
      else for (const row of rows) if (row.canEdit) next.set(row.key, row);
      return next;
    });
  }

  const refs = [...selected.values()].map((row) => ({ entityId: row.entityId, countryId: row.countryId, type: row.type }));

  async function exportCsv() {
    setExporting(true);
    const result = await exportUrlsCsvAction({ ...query, page: 1 });
    setExporting(false);
    if (!result.ok || !result.data) {
      toast(result.ok ? 'Nothing to export.' : result.error, 'error');
      return;
    }
    const blob = new Blob([result.data.csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = result.data.filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  function changed() {
    reload();
    refresh();
  }

  const disabledNote = !overview.resolverEnabled ? (
    <Alert tone="info" className="mb-4">
      The registry is switched off, so the site still answers with the previous router. Addresses can be
      reviewed here now; changing them is possible once the registry is switched on, so that what you change
      is what visitors get.
    </Alert>
  ) : null;

  return (
    <div>
      {disabledNote}

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.6fr)_repeat(4,minmax(0,1fr))]">
          <div className="relative sm:col-span-2 lg:col-span-1">
            <label htmlFor="urls-search" className="sr-only">
              Search by name, slug or path
            </label>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
            <Input
              id="urls-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name, slug or path"
              className="h-9 pl-9 text-sm"
            />
          </div>
          <FilterSelect
            id="urls-country"
            label="Market"
            value={filters.country}
            onChange={(value) => setFilters({ country: value, page: '1' })}
            options={[
              { value: '', label: 'All markets' },
              ...overview.markets.map((market) => ({ value: market.id, label: market.name })),
            ]}
          />
          <FilterSelect
            id="urls-type"
            label="Content type"
            value={filters.type}
            onChange={(value) => setFilters({ type: value, page: '1' })}
            options={[
              { value: '', label: 'All types' },
              ...URL_CONTENT_TYPES.map((type) => ({ value: type, label: URL_TYPE_LABELS[type] })),
            ]}
          />
          <FilterSelect
            id="urls-state"
            label="Publication status"
            value={filters.state}
            onChange={(value) => setFilters({ state: value, page: '1' })}
            options={[
              { value: '', label: 'Any status' },
              ...(['live', 'scheduled', 'draft', 'archived', 'hidden'] as const).map((state) => ({
                value: state,
                label: PUBLICATION_LABELS[state],
              })),
            ]}
          />
          <FilterSelect
            id="urls-mode"
            label="Address mode"
            value={filters.mode}
            onChange={(value) => setFilters({ mode: value, page: '1' })}
            options={[
              { value: '', label: 'Pattern or custom' },
              { value: 'PATTERN', label: 'Follows pattern' },
              { value: 'CUSTOM', label: 'Custom address' },
              { value: 'UNREGISTERED', label: 'No address' },
            ]}
          />
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={exporting}>
            <Download className="h-4 w-4" aria-hidden="true" />
            Export CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => setImportOpen(true)} disabled={!overview.resolverEnabled}>
            <Upload className="h-4 w-4" aria-hidden="true" />
            Import CSV
          </Button>
        </div>
      </div>

      <div className="mt-4">
        <BulkBar count={selected.size} onClear={() => setSelected(new Map())}>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setPlan({ kind: 'reset', refs })}
            disabled={!overview.resolverEnabled}
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            Reset to pattern
          </Button>
          <Button size="sm" variant="outline" onClick={() => setPrefixOpen(true)} disabled={!overview.resolverEnabled}>
            <Wand2 className="h-4 w-4" aria-hidden="true" />
            Replace prefix…
          </Button>
        </BulkBar>
      </div>

      {error ? (
        <Alert tone="danger" title="Could not load the addresses">
          {error}{' '}
          <button type="button" onClick={reload} className="font-medium underline">
            Try again
          </button>
        </Alert>
      ) : null}

      <div aria-busy={loading} className={loading && data ? 'opacity-60 transition-opacity' : undefined}>
        {!data && loading ? (
          <div className="space-y-2 py-4" aria-label="Loading addresses">
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} className="h-11 animate-pulse rounded-lg bg-muted/10" />
            ))}
          </div>
        ) : rows.length === 0 && data ? (
          <EmptyState
            title="No addresses match"
            description="Try a different search or clear a filter."
            action={
              <Button variant="outline" onClick={() => { setSearch(''); setFilters(DEFAULTS); }}>
                Clear filters
              </Button>
            }
          />
        ) : (
          <>
            {/* Desktop and tablet: a table. */}
            <div className="hidden md:block">
              <TableWrap className="relative">
                <Table className="min-w-[52rem]">
                  <caption className="sr-only">Public addresses</caption>
                  <thead>
                    <tr>
                      <Th className="w-10">
                        <input
                          type="checkbox"
                          aria-label="Select every address on this page"
                          checked={allOnPage}
                          onChange={togglePage}
                          className="h-4 w-4 rounded border-hairline text-brand"
                        />
                      </Th>
                      <Th>Content</Th>
                      <Th>Public URL</Th>
                      <Th>Status</Th>
                      <Th>Mode</Th>
                      <Th align="right">
                        <span className="sr-only">Actions</span>
                      </Th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <Tr key={row.key}>
                        <Td>
                          <input
                            type="checkbox"
                            aria-label={`Select ${row.label}`}
                            checked={selected.has(row.key)}
                            disabled={!row.canEdit}
                            onChange={() => toggle(row)}
                            className="h-4 w-4 rounded border-hairline text-brand"
                          />
                        </Td>
                        <Td>
                          <div className="min-w-0 max-w-[18rem]">
                            <button
                              type="button"
                              onClick={() => setEditing(row)}
                              title={row.label}
                              className="block max-w-full truncate text-left font-medium text-content hover:text-brand focus-visible:outline-none focus-visible:underline"
                            >
                              {row.label}
                            </button>
                            <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                              <Badge tone="neutral">{row.typeLabel}</Badge>
                              {row.city ? <Badge tone="info">City: {row.city.name}</Badge> : null}
                              {overview.markets.length > 1 ? <span>{row.countryName}</span> : null}
                            </span>
                          </div>
                        </Td>
                        <Td>
                          <div className="flex max-w-[22rem] items-start gap-1.5">
                            <PathText path={row.path} />
                            {row.path && row.state === 'live' ? (
                              <a
                                href={row.path}
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label={`Open ${row.path} in a new tab`}
                                className="shrink-0 text-muted hover:text-brand"
                              >
                                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                              </a>
                            ) : null}
                          </div>
                          {row.path !== row.patternPath && row.mode !== 'CUSTOM' ? (
                            <span className="mt-0.5 block text-xs text-amber-700">Pattern gives {row.patternPath}</span>
                          ) : null}
                        </Td>
                        <Td>
                          <StateBadge state={row.state} />
                        </Td>
                        <Td>
                          <ModeBadge mode={row.mode} />
                        </Td>
                        <Td align="right">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditing(row)}
                            aria-label={`Edit the address of ${row.label}`}
                          >
                            <Pencil className="h-4 w-4" aria-hidden="true" />
                            <span className="hidden lg:inline">Edit</span>
                          </Button>
                        </Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </TableWrap>
            </div>

            {/* Phone: one card per address. */}
            <ul className="space-y-2 md:hidden" aria-label="Public addresses">
              {rows.map((row) => (
                <li key={row.key} className="rounded-xl border border-hairline p-3">
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      aria-label={`Select ${row.label}`}
                      checked={selected.has(row.key)}
                      disabled={!row.canEdit}
                      onChange={() => toggle(row)}
                      className="mt-1 h-4 w-4 shrink-0 rounded border-hairline text-brand"
                    />
                    <div className="min-w-0 flex-1">
                      <button
                        type="button"
                        onClick={() => setEditing(row)}
                        className="block w-full truncate text-left text-sm font-medium text-content"
                      >
                        {row.label}
                      </button>
                      <PathText path={row.path} className="mt-1 block" />
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <Badge tone="neutral">{row.typeLabel}</Badge>
                        {row.city ? <Badge tone="info">City: {row.city.name}</Badge> : null}
                        <StateBadge state={row.state} />
                        <ModeBadge mode={row.mode} />
                        {overview.markets.length > 1 ? <Badge tone="info">{row.countryCode}</Badge> : null}
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
        {data ? (
          <div className="mt-3">
            <Pager
              page={data.page}
              pages={data.pages}
              total={data.total}
              noun="address"
              plural="addresses"
              onPage={(page) => setFilters({ page: String(page) })}
            />
          </div>
        ) : null}
      </div>

      <UrlDrawer row={editing} onClose={() => setEditing(null)} onChanged={changed} />

      <PrefixDialog
        open={prefixOpen}
        onClose={() => setPrefixOpen(false)}
        onPreview={(from, to) => {
          setPrefixOpen(false);
          setPlan({ kind: 'prefix', refs, from, to });
        }}
      />

      <PlanDialog
        request={plan}
        onClose={() => setPlan(null)}
        onApplied={() => {
          setSelected(new Map());
          changed();
        }}
      />

      <CsvImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onPreview={(text) => {
          setImportOpen(false);
          setPlan({ kind: 'csv', text });
        }}
      />
    </div>
  );
}

function PrefixDialog({
  open,
  onClose,
  onPreview,
}: {
  open: boolean;
  onClose: () => void;
  onPreview: (from: string, to: string) => void;
}) {
  const [from, setFrom] = React.useState('/products');
  const [to, setTo] = React.useState('');
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Replace a path prefix"
      description="For the selected addresses. Addresses that do not start with the prefix are left as they are."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onPreview(from.trim(), to.trim())}>Preview</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Replace" htmlFor="prefix-from" hint="Within the market, e.g. /products">
          <Input id="prefix-from" value={from} onChange={(event) => setFrom(event.target.value)} placeholder="/products" />
        </Field>
        <Field label="With" htmlFor="prefix-to" hint="Leave empty to remove the prefix: /products/autocad becomes /autocad.">
          <Input id="prefix-to" value={to} onChange={(event) => setTo(event.target.value)} placeholder="/software" />
        </Field>
      </div>
    </Dialog>
  );
}

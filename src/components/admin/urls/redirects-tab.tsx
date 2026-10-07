'use client';

import * as React from 'react';
import { ArrowRight, FileUp, Info, Pencil, Plus, Search, Trash } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, ConfirmDialog } from '@/components/ui/dialog';
import { Checkbox, Field, Input, Select, Switch } from '@/components/ui/field';
import { Badge } from '@/components/ui/badge';
import { Alert, EmptyState } from '@/components/ui/states';
import { Table, TableWrap, Th, Td, Tr } from '@/components/ui/table';
import { Spinner } from '@/components/ui/icons';
import { useToast } from '@/components/ui/toast';
import { formatDate, formatNumber } from '@/lib/utils/format';
import { deleteRedirect, saveRedirect, toggleRedirect } from '@/lib/actions/seo';
import { listRedirectImportsAction, redirectImportAction, redirectsAction, type Destination } from '@/lib/actions/urls';
import type { RedirectImportView } from '@/lib/urls/redirect-import';
import type { RedirectRow } from '@/lib/urls/redirect-rules';
import { REDIRECT_TYPE_LABELS, URL_TYPE_LABELS } from '@/lib/urls/types';
import { useManager } from './manager-context';
import { useDebounced, useQueryState } from './use-query-state';
import { FilterSelect, Pager, PathText, useLoader } from './shared';
import { DestinationPicker } from './destination-picker';
import { RedirectImportDialog } from './redirect-import-dialog';

const DEFAULTS = { q: '', origin: '', status: '', country: '', page: '1' };

type Draft = {
  id: string | null;
  source: string;
  destinationKind: 'content' | 'path';
  destination: string;
  target: Destination | null;
  type: 'PERMANENT' | 'TEMPORARY';
  isActive: boolean;
  allMarkets: boolean;
  note: string;
  updatedAt: string | null;
};

const BLANK: Draft = {
  id: null,
  source: '',
  destinationKind: 'content',
  destination: '',
  target: null,
  type: 'PERMANENT',
  isActive: true,
  allMarkets: false,
  note: '',
  updatedAt: null,
};

/**
 * Redirects: the automatic ones the registry writes when a public address
 * changes, and the manual ones people write. Each answers for one address,
 * claimed in the registry so nothing else can hold it.
 */
export function RedirectsTab() {
  const { overview, refresh } = useManager();
  const { toast } = useToast();
  const [filters, setFilters] = useQueryState('r_', DEFAULTS);
  const [search, setSearch] = React.useState(filters.q);
  const debounced = useDebounced(search);
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [errors, setErrors] = React.useState<Record<string, string[]>>({});
  const [saving, setSaving] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState<RedirectRow | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [importing, setImporting] = React.useState(false);
  const [resume, setResume] = React.useState<RedirectImportView | null>(null);
  const imports = useLoader<RedirectImportView[]>(() => listRedirectImportsAction(), []);
  const unfinished = (imports.data ?? []).filter((entry) => entry.status === 'PENDING' || entry.status === 'RUNNING');

  async function openResume(id: string) {
    const result = await redirectImportAction(id);
    if (result.ok && result.data) {
      setResume(result.data);
      setImporting(true);
    } else {
      toast(result.ok ? 'That import no longer exists.' : result.error, 'error');
    }
  }

  React.useEffect(() => setSearch(filters.q), [filters.q]);
  React.useEffect(() => {
    if (debounced !== filters.q) setFilters({ q: debounced, page: '1' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const { data, error, loading, reload } = useLoader<{ rows: RedirectRow[]; total: number; page: number; pages: number }>(
    () =>
      redirectsAction({
        q: filters.q || undefined,
        origin: (filters.origin || '') as 'MANUAL' | 'AUTOMATIC' | '',
        status: (filters.status || '') as 'active' | 'disabled' | 'dormant' | '',
        countryId: filters.country || undefined,
        page: Number(filters.page) || 1,
      }),
    [filters.q, filters.origin, filters.status, filters.country, filters.page],
  );

  function edit(row: RedirectRow) {
    setErrors({});
    setDraft({
      id: row.id,
      source: row.source,
      // A destination with its own query string or fragment is edited as the
      // path it is, so saving keeps them; it is still stored as the content.
      destinationKind: row.target && !/[?#]/.test(row.destination) ? 'content' : 'path',
      destination: row.target && !/[?#]/.test(row.destination) ? '' : row.destination,
      target: row.target && !/[?#]/.test(row.destination)
        ? {
            entityId: row.target.entityId,
            countryId: row.target.countryId,
            type: row.target.type,
            label: row.target.label ?? row.destination,
            path: row.destination,
            countryName: row.countryName ?? '',
          }
        : null,
      type: row.type,
      isActive: row.isActive,
      allMarkets: row.allMarkets,
      note: row.note ?? '',
      updatedAt: row.updatedAt,
    });
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    setErrors({});
    const form = new FormData();
    form.set('source', draft.source);
    if (draft.destinationKind === 'content' && draft.target) {
      form.set('targetEntityId', draft.target.entityId);
      form.set('targetCountryId', draft.target.countryId);
      form.set('destination', '');
    } else {
      form.set('destination', draft.destination);
    }
    form.set('type', draft.type);
    form.set('isActive', String(draft.isActive));
    form.set('allMarkets', String(draft.allMarkets));
    form.set('note', draft.note);
    if (draft.updatedAt) form.set('expectedUpdatedAt', draft.updatedAt);
    const result = await saveRedirect(draft.id, form);
    setSaving(false);
    if (!result.ok) {
      setErrors(result.fieldErrors ?? {});
      toast(result.error, 'error');
      return;
    }
    toast(result.message ?? 'Saved.', 'success');
    setDraft(null);
    reload();
    refresh();
  }

  async function run(id: string, fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) {
    setBusyId(id);
    const result = await fn();
    setBusyId(null);
    toast(result.ok ? (result.message ?? 'Done.') : (result.error ?? 'Something went wrong.'), result.ok ? 'success' : 'error');
    reload();
    refresh();
  }

  const destinationReady = draft
    ? draft.destinationKind === 'content'
      ? Boolean(draft.target)
      : Boolean(draft.destination.trim())
    : false;

  return (
    <div className="space-y-4">
      <details className="rounded-xl border border-hairline bg-muted/[0.03] px-4 py-3 text-sm">
        <summary className="flex cursor-pointer items-center gap-2 font-medium text-content">
          <Info className="h-4 w-4 text-muted" aria-hidden="true" />
          How redirects behave
        </summary>
        <div className="mt-2 space-y-2 text-muted">
          <p>
            Redirects are answered before the page renders, with a real HTTP status and a Location header. They
            are sent with the framework’s own status codes: <strong>308</strong> for permanent and <strong>307</strong>{' '}
            for temporary. Search engines treat 308 like 301 and pass the old address’s ranking to the new one.
          </p>
          <p>
            <strong>Browsers and search engines cache permanent redirects</strong>, often for a long time. Once a 308
            has been followed, switching it off or pointing it elsewhere does not reach visitors who already have it
            cached. Use 307 while you are unsure, and 308 once the move is final.
          </p>
          <p>
            A redirect to content follows that content: if its address changes later, the redirect goes straight to
            the new one — never through a chain. Query strings, including UTM tags, are carried over.
          </p>
        </div>
      </details>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))]">
          <div className="relative sm:col-span-2 lg:col-span-1">
            <label htmlFor="redirects-search" className="sr-only">
              Search redirects
            </label>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
            <Input
              id="redirects-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search source, destination or note"
              className="h-9 pl-9 text-sm"
            />
          </div>
          <FilterSelect
            id="redirects-origin"
            label="Origin"
            value={filters.origin}
            onChange={(value) => setFilters({ origin: value, page: '1' })}
            options={[
              { value: '', label: 'Automatic and manual' },
              { value: 'AUTOMATIC', label: 'Automatic' },
              { value: 'MANUAL', label: 'Manual' },
            ]}
          />
          <FilterSelect
            id="redirects-status"
            label="Status"
            value={filters.status}
            onChange={(value) => setFilters({ status: value, page: '1' })}
            options={[
              { value: '', label: 'Any status' },
              { value: 'active', label: 'Active' },
              { value: 'disabled', label: 'Disabled' },
              { value: 'dormant', label: 'Never fires' },
            ]}
          />
          <FilterSelect
            id="redirects-country"
            label="Market"
            value={filters.country}
            onChange={(value) => setFilters({ country: value, page: '1' })}
            options={[{ value: '', label: 'All markets' }, ...overview.markets.map((market) => ({ value: market.id, label: market.name }))]}
          />
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button variant="outline" onClick={() => { setResume(null); setImporting(true); }}>
            <FileUp className="h-4 w-4" aria-hidden="true" />
            Import CSV
          </Button>
          <Button onClick={() => { setErrors({}); setDraft({ ...BLANK }); }}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            New redirect
          </Button>
        </div>
      </div>

      {unfinished.map((entry) => (
        <Alert key={entry.id} tone="warning" title="A redirect import did not finish">
          <p>
            {entry.summary} — {entry.processed} of {entry.total} done. Resuming continues where it stopped;
            nothing already written is written again.
          </p>
          <Button size="sm" variant="outline" className="mt-2" onClick={() => openResume(entry.id)}>
            Resume import
          </Button>
        </Alert>
      ))}

      <RedirectImportDialog
        open={importing}
        resume={resume}
        onClose={() => {
          setImporting(false);
          setResume(null);
          imports.reload();
        }}
        onImported={() => {
          reload();
          refresh();
          imports.reload();
        }}
      />

      {error ? (
        <Alert tone="danger" title="Could not load redirects">
          {error}
        </Alert>
      ) : null}

      <div aria-busy={loading} className={loading && data ? 'opacity-60' : undefined}>
        {!data && loading ? (
          <div className="h-40 animate-pulse rounded-xl bg-muted/10" aria-label="Loading redirects" />
        ) : data && data.rows.length === 0 ? (
          <EmptyState
            title="No redirects here"
            description="Addresses that change after being published get one automatically. Add your own for anything else."
          />
        ) : data ? (
          <>
            <TableWrap className="relative">
              <Table className="min-w-[56rem]">
                <caption className="sr-only">Redirects</caption>
                <thead>
                  <tr>
                    <Th>From</Th>
                    <Th>To</Th>
                    <Th>Status code</Th>
                    <Th align="center">Hits</Th>
                    <Th>State</Th>
                    <Th align="right">
                      <span className="sr-only">Actions</span>
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row) => (
                    <Tr key={row.id}>
                      <Td>
                        <PathText path={row.source} />
                        <span className="mt-1 flex flex-wrap gap-1">
                          <Badge tone={row.origin === 'AUTOMATIC' ? 'neutral' : 'brand'}>
                            {row.origin === 'AUTOMATIC' ? 'Automatic' : 'Manual'}
                          </Badge>
                          {row.allMarkets ? <Badge tone="info">Every market</Badge> : null}
                        </span>
                        {row.note ? <span className="mt-1 block text-xs text-muted">{row.note}</span> : null}
                      </Td>
                      <Td>
                        <span className="flex items-start gap-1.5">
                          <ArrowRight className="mt-0.5 h-3 w-3 shrink-0 text-muted" aria-hidden="true" />
                          <span className="min-w-0">
                            <PathText path={row.destination} />
                            {row.target ? (
                              <span className="mt-0.5 block text-xs text-muted">
                                {URL_TYPE_LABELS[row.target.type]}: {row.target.label ?? 'deleted content'}
                              </span>
                            ) : null}
                          </span>
                        </span>
                      </Td>
                      <Td>
                        <Badge tone={row.type === 'PERMANENT' ? 'brand' : 'neutral'} className="whitespace-nowrap">{REDIRECT_TYPE_LABELS[row.type]}</Badge>
                      </Td>
                      <Td align="center" className="text-sm text-muted">
                        {formatNumber(row.hitCount)}
                        {row.lastHitAt ? <span className="block text-[0.6875rem]">{formatDate(row.lastHitAt)}</span> : null}
                      </Td>
                      <Td>
                        {row.claims === 0 ? (
                          <Badge tone="warning">Never fires</Badge>
                        ) : (
                          <Badge tone={row.isActive ? 'success' : 'neutral'}>{row.isActive ? 'Active' : 'Disabled'}</Badge>
                        )}
                      </Td>
                      <Td align="right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => run(row.id, () => toggleRedirect(row.id))}
                            disabled={busyId === row.id}
                            className="rounded px-2 py-1 text-xs text-muted hover:bg-muted/10 hover:text-content"
                          >
                            {row.isActive ? 'Disable' : 'Enable'}
                          </button>
                          <button
                            type="button"
                            onClick={() => edit(row)}
                            aria-label={`Edit the redirect from ${row.source}`}
                            className="rounded p-1.5 text-muted hover:bg-muted/10 hover:text-content"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDelete(row)}
                            aria-label={`Delete the redirect from ${row.source}`}
                            className="rounded p-1.5 text-muted hover:bg-red-50 hover:text-red-600"
                          >
                            <Trash className="h-4 w-4" />
                          </button>
                        </div>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
            <div className="mt-3">
              <Pager page={data.page} pages={data.pages} total={data.total} noun="redirect" onPage={(page) => setFilters({ page: String(page) })} />
            </div>
          </>
        ) : null}
      </div>

      <Dialog
        open={Boolean(draft)}
        onClose={() => setDraft(null)}
        size="lg"
        title={draft?.id ? 'Edit redirect' : 'New redirect'}
        description="Visitors to the old address are sent to the destination before anything renders."
        footer={
          <>
            <Button variant="outline" onClick={() => setDraft(null)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving || !draft?.source.trim() || !destinationReady}>
              {saving ? <Spinner className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              Save redirect
            </Button>
          </>
        }
      >
        {draft ? (
          <div className="space-y-4">
            <Field
              label="Old address"
              htmlFor="redirect-source"
              required
              error={errors.source}
              hint="A path on this site, with the market prefix where it has one: /old-pricing, /ae/old-pricing."
            >
              <Input
                id="redirect-source"
                value={draft.source}
                onChange={(event) => setDraft({ ...draft, source: event.target.value })}
                placeholder="/old-pricing"
                spellCheck={false}
                autoCapitalize="none"
                className="font-mono text-sm"
              />
            </Field>

            <fieldset>
              <legend className="mb-1.5 text-sm font-medium text-content">Destination</legend>
              <div className="mb-2 flex flex-wrap gap-4 text-sm">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="destination-kind"
                    checked={draft.destinationKind === 'content'}
                    onChange={() => setDraft({ ...draft, destinationKind: 'content' })}
                    className="h-4 w-4 text-brand"
                  />
                  Published content
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="destination-kind"
                    checked={draft.destinationKind === 'path'}
                    onChange={() => setDraft({ ...draft, destinationKind: 'path' })}
                    className="h-4 w-4 text-brand"
                  />
                  A path or external URL
                </label>
              </div>
              {draft.destinationKind === 'content' ? (
                <DestinationPicker
                  id="redirect-target"
                  value={draft.target}
                  onChange={(target) => setDraft({ ...draft, target })}
                />
              ) : (
                <Field htmlFor="redirect-destination" error={errors.destination} hint="/pricing, or https://example.com/page">
                  <Input
                    id="redirect-destination"
                    value={draft.destination}
                    onChange={(event) => setDraft({ ...draft, destination: event.target.value })}
                    placeholder="/pricing"
                    spellCheck={false}
                    autoCapitalize="none"
                    className="font-mono text-sm"
                  />
                </Field>
              )}
              {draft.destinationKind === 'content' && errors.destination ? (
                <p className="mt-1 text-xs font-medium text-red-600" role="alert">
                  {errors.destination.join(' ')}
                </p>
              ) : null}
            </fieldset>

            <Field label="Type" htmlFor="redirect-type" hint="Permanent moves pass ranking on; see “How redirects behave” about caching.">
              <Select
                id="redirect-type"
                value={draft.type}
                onChange={(event) => setDraft({ ...draft, type: event.target.value as Draft['type'] })}
              >
                <option value="PERMANENT">{REDIRECT_TYPE_LABELS.PERMANENT} — moved for good</option>
                <option value="TEMPORARY">{REDIRECT_TYPE_LABELS.TEMPORARY} — temporarily elsewhere</option>
              </Select>
            </Field>

            <Checkbox
              checked={draft.allMarkets}
              onChange={(event) => setDraft({ ...draft, allMarkets: event.target.checked })}
              label="Also answer under every market prefix"
              hint="For a path without a market prefix: /old-plan also redirects at /ae/old-plan, wherever no content lives there."
            />

            <Field label="Note" htmlFor="redirect-note" hint="Why this exists, for whoever looks at it next.">
              <Input id="redirect-note" value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} />
            </Field>

            <div className="rounded-lg border border-hairline p-3">
              <Switch
                checked={draft.isActive}
                onChange={(next) => setDraft({ ...draft, isActive: next })}
                label="Redirect is active"
                hint="A disabled redirect keeps its address reserved, so switching it back on always works."
              />
            </div>
          </div>
        ) : null}
      </Dialog>

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        onConfirm={async () => {
          if (confirmDelete) await run(confirmDelete.id, () => deleteRedirect(confirmDelete.id));
          setConfirmDelete(null);
        }}
        title="Delete this redirect?"
        message="Visitors following the old address will get a 404 instead, and the address becomes free for other content."
        pending={busyId !== null}
      />
    </div>
  );
}

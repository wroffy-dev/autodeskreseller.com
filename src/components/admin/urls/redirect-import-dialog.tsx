'use client';

import * as React from 'react';
import { ArrowRight, Download, FileUp } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Field, Select, Textarea } from '@/components/ui/field';
import { Alert } from '@/components/ui/states';
import { Spinner } from '@/components/ui/icons';
import { useToast } from '@/components/ui/toast';
import { downloadCsv } from '@/lib/utils/download';
import { formatNumber } from '@/lib/utils/format';
import {
  applyRedirectImportAction,
  previewRedirectImportAction,
  redirectImportResultsCsvAction,
  runRedirectImportAction,
} from '@/lib/actions/urls';
import type {
  ImportResolution,
  ImportRow,
  ImportStatus,
  RedirectImportPlan,
  RedirectImportView,
} from '@/lib/urls/redirect-import';
import { REDIRECT_CSV_COLUMNS, REDIRECT_CSV_SAMPLE } from '@/lib/urls/redirect-csv';
import { REDIRECT_TYPE_LABELS } from '@/lib/urls/types';
import { PathText } from './shared';

const MAX_BYTES = 2_000_000;
const PAGE = 50;

const STATUS: Record<ImportStatus, { label: string; tone: BadgeTone }> = {
  create: { label: 'New', tone: 'success' },
  update: { label: 'Replaces existing', tone: 'brand' },
  unchanged: { label: 'Unchanged', tone: 'neutral' },
  duplicate: { label: 'Duplicate', tone: 'neutral' },
  kept: { label: 'Keeps existing', tone: 'neutral' },
  conflict: { label: 'Conflict', tone: 'warning' },
  invalid: { label: 'Invalid', tone: 'danger' },
};

type Step = 'input' | 'preview' | 'run';

/**
 * Redirects → Import CSV.
 *
 * Exactly two columns, `URL` and `Destination URL`. The whole file is
 * validated against the existing redirects and content before anything is
 * written; conflicts with existing rules need an explicit keep-or-replace
 * decision; and the import runs in batches with its progress and every row's
 * outcome shown. Address changes for content are a different file, imported
 * from All URLs.
 */
export function RedirectImportDialog({
  open,
  resume,
  onClose,
  onImported,
}: {
  open: boolean;
  /** An import to pick up where it stopped. */
  resume?: RedirectImportView | null;
  onClose: () => void;
  onImported: () => void;
}) {
  const { toast } = useToast();
  const [step, setStep] = React.useState<Step>('input');
  const [text, setText] = React.useState('');
  const [fileName, setFileName] = React.useState<string | null>(null);
  const [type, setType] = React.useState<'PERMANENT' | 'TEMPORARY'>('PERMANENT');
  const [resolutions, setResolutions] = React.useState<Record<string, ImportResolution>>({});
  const [plan, setPlan] = React.useState<RedirectImportPlan | null>(null);
  const [filter, setFilter] = React.useState<ImportStatus | 'all' | 'attention'>('all');
  const [page, setPage] = React.useState(0);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [operation, setOperation] = React.useState<RedirectImportView | null>(null);
  const cancelled = React.useRef(false);

  // Fresh state each time it opens; a resumed import opens on its progress.
  React.useEffect(() => {
    if (!open) return;
    cancelled.current = false;
    setError(null);
    setNotice(null);
    if (resume) {
      setOperation(resume);
      setStep('run');
    } else {
      setStep('input');
      setText('');
      setFileName(null);
      setType('PERMANENT');
      setResolutions({});
      setPlan(null);
      setOperation(null);
      setFilter('all');
      setPage(0);
    }
  }, [open, resume]);

  async function readFile(file: File | undefined) {
    setError(null);
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setError('That file is larger than 2 MB. Import it in parts.');
      return;
    }
    setFileName(file.name);
    setText(await file.text());
  }

  async function preview(nextResolutions = resolutions) {
    setBusy(true);
    setError(null);
    const result = await previewRedirectImportAction({ text, type, resolutions: nextResolutions });
    setBusy(false);
    if (!result.ok || !result.data) {
      setError(result.ok ? 'Could not read the file.' : result.error);
      return;
    }
    setPlan(result.data);
    setStep('preview');
  }

  function decide(lines: number[], resolution: ImportResolution) {
    const next = { ...resolutions };
    for (const line of lines) next[String(line)] = resolution;
    setResolutions(next);
    void preview(next);
  }

  async function follow(view: RedirectImportView) {
    setOperation(view);
    setStep('run');
    let current = view;
    while (!cancelled.current && (current.status === 'PENDING' || current.status === 'RUNNING')) {
      const next = await runRedirectImportAction(current.id);
      if (!next.ok || !next.data) {
        setError(next.ok ? 'The import stopped.' : next.error);
        return;
      }
      if (next.data.processed === current.processed && next.data.status === 'RUNNING') {
        setOperation(next.data);
        setError('A batch could not be applied and nothing in it was saved. Resume to try it again.');
        return;
      }
      current = next.data;
      setOperation(current);
    }
    if (current.status === 'COMPLETED' || current.status === 'PARTIAL') {
      toast(
        current.failed > 0
          ? `${current.succeeded} done, ${current.failed} not applied — see the results.`
          : `${current.succeeded} redirect${current.succeeded === 1 ? '' : 's'} imported.`,
        current.failed > 0 ? 'warning' : 'success',
      );
      onImported();
    }
  }

  async function apply() {
    if (!plan) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await applyRedirectImportAction({ text, type, resolutions, fingerprint: plan.fingerprint });
    setBusy(false);
    if (!result.ok || !result.data) {
      setError(result.ok ? 'Could not import.' : result.error);
      return;
    }
    if ('stale' in result.data) {
      setPlan(result.data.plan);
      setNotice(result.message ?? 'The preview was out of date and has been refreshed.');
      return;
    }
    await follow(result.data.operation);
  }

  async function downloadResults() {
    if (!operation) return;
    const result = await redirectImportResultsCsvAction(operation.id);
    if (result.ok && result.data) downloadCsv(result.data.csv, result.data.filename);
    else toast(result.ok ? 'Could not export.' : result.error, 'error');
  }

  const rows = plan
    ? plan.rows.filter((row) =>
        filter === 'all'
          ? true
          : filter === 'attention'
            ? row.status === 'conflict' || row.status === 'invalid'
            : row.status === filter,
      )
    : [];
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const shown = rows.slice(page * PAGE, page * PAGE + PAGE);
  const undecided = plan ? plan.rows.filter((row) => row.status === 'conflict' && row.resolvable && !row.resolution) : [];
  const running = operation && (operation.status === 'PENDING' || operation.status === 'RUNNING');
  const done = operation && (operation.status === 'COMPLETED' || operation.status === 'PARTIAL');

  const close = () => {
    cancelled.current = true;
    onClose();
  };

  const footer =
    step === 'input' ? (
      <>
        <Button variant="outline" onClick={close}>
          Cancel
        </Button>
        <Button onClick={() => preview()} disabled={!text.trim() || busy}>
          {busy ? <Spinner className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          Validate and preview
        </Button>
      </>
    ) : step === 'preview' ? (
      <>
        <Button variant="outline" onClick={() => setStep('input')} disabled={busy}>
          Back
        </Button>
        <Button onClick={apply} disabled={!plan || busy || plan.writes === 0 || plan.undecided > 0}>
          {busy ? <Spinner className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          {plan && plan.undecided > 0
            ? `Decide ${plan.undecided} conflict${plan.undecided === 1 ? '' : 's'} first`
            : `Import ${formatNumber(plan?.writes ?? 0)} redirect${plan?.writes === 1 ? '' : 's'}`}
        </Button>
      </>
    ) : (
      <>
        {operation && operation.results.length > 0 ? (
          <Button variant="outline" onClick={downloadResults}>
            <Download className="h-4 w-4" aria-hidden="true" />
            Results CSV
          </Button>
        ) : null}
        <Button variant="outline" onClick={close}>
          {done ? 'Close' : running ? 'Continue in background' : 'Close'}
        </Button>
        {operation && !done ? (
          <Button onClick={() => { setError(null); cancelled.current = false; void follow(operation); }} disabled={Boolean(running) && !error}>
            Resume
          </Button>
        ) : null}
      </>
    );

  return (
    <Dialog
      open={open}
      onClose={close}
      size="xl"
      title="Import redirects from CSV"
      description={
        step === 'input'
          ? `Exactly two columns: ${REDIRECT_CSV_COLUMNS.join(' and ')}. Nothing is written until you have reviewed the preview.`
          : step === 'preview'
            ? 'Every row checked against the existing redirects, content and each other.'
            : operation?.summary
      }
      footer={footer}
    >
      {error ? (
        <Alert tone="danger" title="Not imported" className="mb-3">
          {error}
        </Alert>
      ) : null}
      {notice ? (
        <Alert tone="warning" className="mb-3">
          {notice}
        </Alert>
      ) : null}

      {step === 'input' ? (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 rounded-xl border border-hairline bg-muted/5 p-3 sm:flex-row sm:items-center sm:justify-between">
            <pre className="min-w-0 overflow-x-auto font-mono text-xs leading-5 text-content">{REDIRECT_CSV_SAMPLE.trim()}</pre>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 self-start sm:self-center"
              onClick={() => downloadCsv(REDIRECT_CSV_SAMPLE, 'redirects-sample.csv')}
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              Download sample
            </Button>
          </div>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
            <li>
              <span className="text-content">URL</span> is the old address: a path such as <code>/old-autocad</code>, or a
              full URL on this site. A market prefix (<code>/ae/…</code>) keeps the redirect in that market.
            </li>
            <li>
              <span className="text-content">Destination URL</span> is a path on this site — its query string and{' '}
              <code>#fragment</code> are kept — or an external <code>https://</code> address.
            </li>
            <li>Addresses that belong to content are never taken; change those in All URLs.</li>
          </ul>
          <Field label="CSV file" htmlFor="redirect-csv-file" hint={fileName ? `Loaded ${fileName}.` : 'Up to 5,000 rows and 2 MB.'}>
            <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-hairline px-3 py-3 text-sm text-content hover:bg-muted/5">
              <FileUp className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
              <span className="min-w-0 truncate">{fileName ?? 'Choose a .csv file'}</span>
              <input
                id="redirect-csv-file"
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                onChange={(event) => readFile(event.target.files?.[0])}
              />
            </label>
          </Field>
          <Field label="…or paste it" htmlFor="redirect-csv-text">
            <Textarea
              id="redirect-csv-text"
              rows={7}
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                setFileName(null);
              }}
              spellCheck={false}
              className="font-mono text-xs"
              placeholder={REDIRECT_CSV_SAMPLE.trim()}
            />
          </Field>
          <Field
            label="Redirect type"
            htmlFor="redirect-csv-type"
            hint="Applies to every row. Browsers cache permanent redirects; use temporary while you are unsure."
          >
            <Select id="redirect-csv-type" value={type} onChange={(event) => setType(event.target.value as typeof type)}>
              <option value="PERMANENT">{REDIRECT_TYPE_LABELS.PERMANENT} — the old address has moved for good</option>
              <option value="TEMPORARY">{REDIRECT_TYPE_LABELS.TEMPORARY} — for now</option>
            </Select>
          </Field>
        </div>
      ) : null}

      {step === 'preview' && plan ? (
        <div aria-busy={busy} className={busy ? 'opacity-60 transition-opacity' : undefined}>
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Summary label="Will be written" value={plan.writes} tone="brand" />
            <Summary label="Already in place" value={plan.counts.unchanged + plan.counts.duplicate} />
            <Summary label="Need a decision" value={plan.undecided} tone={plan.undecided > 0 ? 'warning' : undefined} />
            <Summary label="Not importable" value={plan.counts.invalid + plan.counts.conflict - plan.undecided} tone={plan.counts.invalid > 0 ? 'danger' : undefined} />
          </dl>

          {undecided.length > 0 ? (
            <Alert tone="warning" className="mt-3" title={`${undecided.length} row${undecided.length === 1 ? '' : 's'} disagree with a redirect that already exists`}>
              <p>Nothing is overwritten unless you say so. Decide row by row below, or for all of them:</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => decide(undecided.map((row) => row.line), 'keep')} disabled={busy}>
                  Keep all existing
                </Button>
                <Button size="sm" variant="outline" onClick={() => decide(undecided.map((row) => row.line), 'replace')} disabled={busy}>
                  Replace all with the file’s
                </Button>
              </div>
            </Alert>
          ) : null}

          {plan.repoints.length > 0 ? (
            <p className="mt-3 text-sm text-muted">
              {plan.repoints.length} existing redirect{plan.repoints.length === 1 ? '' : 's'} point{plan.repoints.length === 1 ? 's' : ''} at an
              address this file redirects, and will be re-pointed straight to the new destination so no chain is left:{' '}
              {plan.repoints.slice(0, 5).map((entry) => entry.source).join(', ')}
              {plan.repoints.length > 5 ? '…' : ''}
            </p>
          ) : null}

          <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Show rows">
            <Chip active={filter === 'all'} onClick={() => { setFilter('all'); setPage(0); }}>
              All {plan.rows.length}
            </Chip>
            {plan.counts.conflict + plan.counts.invalid > 0 ? (
              <Chip active={filter === 'attention'} onClick={() => { setFilter('attention'); setPage(0); }}>
                Needs attention {plan.counts.conflict + plan.counts.invalid}
              </Chip>
            ) : null}
            {(Object.keys(STATUS) as ImportStatus[])
              .filter((status) => plan.counts[status] > 0)
              .map((status) => (
                <Chip key={status} active={filter === status} onClick={() => { setFilter(status); setPage(0); }}>
                  {STATUS[status].label} {plan.counts[status]}
                </Chip>
              ))}
          </div>

          {shown.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">Nothing in this group.</p>
          ) : (
            <ul className="mt-3 max-h-[45vh] divide-y divide-hairline overflow-y-auto rounded-xl border border-hairline">
              {shown.map((row) => (
                <PreviewRow key={row.line} row={row} busy={busy} onDecide={(resolution) => decide([row.line], resolution)} />
              ))}
            </ul>
          )}
          {pages > 1 ? (
            <div className="mt-2 flex items-center justify-between text-xs text-muted">
              <span>
                Rows {page * PAGE + 1}–{Math.min(rows.length, (page + 1) * PAGE)} of {rows.length}
              </span>
              <span className="flex gap-1.5">
                <Button size="sm" variant="outline" onClick={() => setPage(page - 1)} disabled={page === 0}>
                  Prev
                </Button>
                <Button size="sm" variant="outline" onClick={() => setPage(page + 1)} disabled={page >= pages - 1}>
                  Next
                </Button>
              </span>
            </div>
          ) : null}
        </div>
      ) : null}

      {step === 'run' && operation ? (
        <div role="status" aria-live="polite">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="font-medium text-content">
              {done ? 'Finished' : running ? 'Importing' : 'Paused'} — {formatNumber(operation.processed)} of {formatNumber(operation.total)}
            </span>
            <span className="text-xs text-muted">
              {operation.succeeded} done · {operation.failed} not applied
            </span>
          </div>
          <div
            className="mt-2 h-2 overflow-hidden rounded-full bg-muted/15"
            role="progressbar"
            aria-label="Import progress"
            aria-valuemin={0}
            aria-valuemax={operation.total || 1}
            aria-valuenow={operation.processed}
          >
            <div
              className="h-full rounded-full bg-brand transition-all"
              style={{ width: `${operation.total ? (operation.processed / operation.total) * 100 : 100}%` }}
            />
          </div>
          {operation.results.length > 0 ? (
            <ul className="mt-4 max-h-[45vh] divide-y divide-hairline overflow-y-auto rounded-xl border border-hairline text-sm">
              {operation.results.slice(-500).map((result, index) => (
                <li key={`${result.key}-${index}`} className="flex flex-col gap-1 px-3 py-2 sm:flex-row sm:items-center sm:gap-3">
                  <span className="shrink-0 text-xs text-muted sm:w-24">{result.key}</span>
                  <Badge tone={result.ok ? (result.outcome === 'unchanged' ? 'neutral' : 'success') : 'danger'}>
                    {result.ok ? result.outcome : 'not applied'}
                  </Badge>
                  <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                    <PathText path={result.oldPath} />
                    {result.newPath ? (
                      <>
                        <ArrowRight className="h-3 w-3 text-muted" aria-hidden="true" />
                        <PathText path={result.newPath} />
                      </>
                    ) : null}
                  </span>
                  {!result.ok || result.outcome === 'repointed' ? (
                    <span className="text-xs text-muted sm:max-w-[40%]">{result.message}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : running ? (
            <p className="mt-4 flex items-center gap-2 text-sm text-muted">
              <Spinner className="h-4 w-4 animate-spin" aria-hidden="true" /> Writing the first batch…
            </p>
          ) : null}
        </div>
      ) : null}
    </Dialog>
  );
}

function PreviewRow({
  row,
  busy,
  onDecide,
}: {
  row: ImportRow;
  busy: boolean;
  onDecide: (resolution: ImportResolution) => void;
}) {
  const status = STATUS[row.status];
  return (
    <li className="px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs tabular-nums text-muted">Line {row.line}</span>
        <Badge tone={status.tone}>{status.label}</Badge>
        {row.countryName ? <span className="text-xs text-muted">{row.countryName}</span> : null}
        {row.target?.label ? <span className="min-w-0 truncate text-xs text-muted">→ {row.target.label}</span> : null}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        <PathText path={row.source ?? row.url} />
        <ArrowRight className="h-3 w-3 text-muted" aria-hidden="true" />
        <PathText path={row.finalDestination ?? row.destination} />
      </div>
      {row.reason ? <p className="mt-1 text-xs text-muted">{row.reason}</p> : null}
      {row.notes.map((note) => (
        <p key={note} className="mt-0.5 text-xs text-amber-700">
          {note}
        </p>
      ))}
      {row.resolvable && row.existing ? (
        <fieldset className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <legend className="sr-only">What to do at {row.source}</legend>
          <label className="inline-flex items-center gap-1.5">
            <input
              type="radio"
              name={`resolution-${row.line}`}
              checked={row.resolution === 'keep'}
              onChange={() => onDecide('keep')}
              disabled={busy}
            />
            Keep existing ({row.existing.destination})
          </label>
          <label className="inline-flex items-center gap-1.5">
            <input
              type="radio"
              name={`resolution-${row.line}`}
              checked={row.resolution === 'replace'}
              onChange={() => onDecide('replace')}
              disabled={busy}
            />
            Replace with the file’s
          </label>
        </fieldset>
      ) : null}
    </li>
  );
}

function Summary({ label, value, tone }: { label: string; value: number; tone?: 'brand' | 'warning' | 'danger' }) {
  const color =
    tone === 'brand' ? 'text-brand' : tone === 'warning' ? 'text-amber-700' : tone === 'danger' ? 'text-red-700' : 'text-content';
  return (
    <div className="rounded-xl border border-hairline px-3 py-2">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`font-heading text-lg font-semibold tabular-nums ${color}`}>{formatNumber(value)}</dd>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={
        active
          ? 'rounded-full bg-brand px-3 py-1 text-xs font-medium text-white'
          : 'rounded-full bg-muted/10 px-3 py-1 text-xs font-medium text-content hover:bg-muted/20'
      }
    >
      {children}
    </button>
  );
}

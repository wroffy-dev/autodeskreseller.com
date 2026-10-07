'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Download, FileUp, Upload } from 'lucide-react';
import { previewCityImport, runCityImportAction } from '@/lib/actions/cities';
import type { CityImportPlan, CityImportResult, CityImportStatus } from '@/lib/cities/import';
import { CITY_IMPORT_SAMPLE, MAX_CITIES_PER_IMPORT_REQUEST } from '@/lib/validation/city';
import { CITY_STATUS_LABELS } from '@/lib/cities/status';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Checkbox, Field, Input, Textarea } from '@/components/ui/field';
import { Alert } from '@/components/ui/states';
import { Spinner } from '@/components/ui/icons';
import { useToast } from '@/components/ui/toast';
import { downloadCsv } from '@/lib/utils/download';
import { formatNumber } from '@/lib/utils/format';

const PLAN: Record<CityImportStatus, { label: string; tone: BadgeTone }> = {
  create: { label: 'Will be created', tone: 'success' },
  exists: { label: 'Exists — kept', tone: 'neutral' },
  duplicate: { label: 'Duplicate', tone: 'neutral' },
  conflict: { label: 'Address taken', tone: 'danger' },
  invalid: { label: 'Invalid', tone: 'danger' },
};

const RESULT: Record<CityImportResult['outcome'], { label: string; tone: BadgeTone }> = {
  created: { label: 'Created', tone: 'success' },
  skipped: { label: 'Skipped', tone: 'neutral' },
  failed: { label: 'Failed', tone: 'danger' },
};

/**
 * Cities → Import. Validates every row — the name, the market, the slug's
 * whole address space in the URL registry — before anything is written, then
 * creates the cities in parts with progress. Existing cities are never
 * changed; running the same file again creates nothing twice.
 */
export function CityImportButton() {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState('');
  const [fileName, setFileName] = React.useState<string | null>(null);
  const [createLanding, setCreateLanding] = React.useState(false);
  const [landingTitle, setLandingTitle] = React.useState('{{city}}');
  const [plan, setPlan] = React.useState<CityImportPlan | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [progress, setProgress] = React.useState<{ done: number; total: number } | null>(null);
  const [results, setResults] = React.useState<CityImportResult[] | null>(null);

  function reset() {
    setText('');
    setFileName(null);
    setPlan(null);
    setError(null);
    setProgress(null);
    setResults(null);
  }

  async function readFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 1_000_000) {
      setError('That file is larger than 1 MB. Import it in parts.');
      return;
    }
    setFileName(file.name);
    setText(await file.text());
    setPlan(null);
  }

  async function preview() {
    setBusy(true);
    setError(null);
    const result = await previewCityImport({ text, createLanding, landingTitle });
    setBusy(false);
    if (!result.ok || !result.data) {
      setError(result.ok ? 'Could not read the file.' : result.error);
      return;
    }
    setPlan(result.data);
  }

  async function run() {
    if (!plan) return;
    const lines = plan.rows.filter((row) => row.outcome === 'create').map((row) => row.line);
    const all: CityImportResult[] = [];
    setBusy(true);
    setError(null);
    setProgress({ done: 0, total: lines.length });
    for (let index = 0; index < lines.length; index += MAX_CITIES_PER_IMPORT_REQUEST) {
      const part = lines.slice(index, index + MAX_CITIES_PER_IMPORT_REQUEST);
      const result = await runCityImportAction({ text, createLanding, landingTitle, fingerprint: plan.fingerprint, lines: part });
      if (!result.ok || !result.data) {
        setError(`${result.ok ? 'The import stopped.' : result.error} ${all.filter((row) => row.outcome === 'created').length} cit${all.length === 1 ? 'y was' : 'ies were'} created before it stopped; importing the file again skips them.`);
        break;
      }
      all.push(...result.data);
      setProgress({ done: Math.min(lines.length, index + part.length), total: lines.length });
    }
    setBusy(false);
    setProgress(null);
    setResults(all);
    const created = all.filter((row) => row.outcome === 'created').length;
    const failed = all.filter((row) => row.outcome === 'failed').length;
    toast(`${created} cit${created === 1 ? 'y' : 'ies'} created${failed ? `, ${failed} failed` : ''}.`, failed ? 'warning' : 'success');
    router.refresh();
  }

  const creatable = plan?.counts.create ?? 0;

  return (
    <>
      <Button
        variant="outline"
        onClick={() => {
          reset();
          setOpen(true);
        }}
      >
        <Upload className="h-4 w-4" aria-hidden="true" />
        Import cities
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        size="xl"
        title="Import cities from CSV"
        description="Name and Country are required; Slug, Region and Status are optional. Existing cities are never changed."
        footer={
          results ? (
            <Button onClick={() => setOpen(false)}>Done</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
                Cancel
              </Button>
              {plan ? (
                <Button onClick={run} disabled={busy || creatable === 0}>
                  {busy ? <Spinner className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                  {progress ? `Creating ${progress.done} of ${progress.total}…` : `Create ${formatNumber(creatable)} cit${creatable === 1 ? 'y' : 'ies'}`}
                </Button>
              ) : (
                <Button onClick={preview} disabled={busy || !text.trim()}>
                  {busy ? <Spinner className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                  Validate and preview
                </Button>
              )}
            </>
          )
        }
      >
        {error ? (
          <Alert tone="danger" title="Not imported" className="mb-3">
            {error}
          </Alert>
        ) : null}

        {!plan ? (
          <div className="space-y-4">
            <div className="flex flex-col gap-3 rounded-xl border border-hairline bg-muted/5 p-3 sm:flex-row sm:items-center sm:justify-between">
              <pre className="min-w-0 overflow-x-auto font-mono text-xs leading-5 text-content">{CITY_IMPORT_SAMPLE.trim()}</pre>
              <Button size="sm" variant="outline" className="shrink-0 self-start" onClick={() => downloadCsv(CITY_IMPORT_SAMPLE, 'cities-sample.csv')}>
                <Download className="h-4 w-4" aria-hidden="true" />
                Download sample
              </Button>
            </div>
            <p className="text-sm text-muted">
              Country is the market’s code, name or URL prefix. Status is DRAFT unless the file says otherwise — a draft
              city’s pages are not public. Region may be left empty.
            </p>
            <Field label="CSV file" htmlFor="city-csv-file" hint={fileName ? `Loaded ${fileName}.` : 'Up to 2,000 cities.'}>
              <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-hairline px-3 py-3 text-sm text-content hover:bg-muted/5">
                <FileUp className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
                <span className="min-w-0 truncate">{fileName ?? 'Choose a .csv file'}</span>
                <input id="city-csv-file" type="file" accept=".csv,text/csv" className="sr-only" onChange={(event) => readFile(event.target.files?.[0])} />
              </label>
            </Field>
            <Field label="…or paste it" htmlFor="city-csv-text">
              <Textarea
                id="city-csv-text"
                rows={6}
                value={text}
                onChange={(event) => {
                  setText(event.target.value);
                  setFileName(null);
                }}
                spellCheck={false}
                className="font-mono text-xs"
                placeholder={CITY_IMPORT_SAMPLE.trim()}
              />
            </Field>
            <Checkbox
              checked={createLanding}
              onChange={(event) => setCreateLanding(event.target.checked)}
              label="Create an empty draft landing page for each new city"
              hint="Built in the Page Builder afterwards, like any page."
            />
            {createLanding ? (
              <Field
                label="Landing page title"
                htmlFor="city-csv-landing"
                hint="Placeholders such as {{city}} and {{region}} are filled in for each city — for example “Autodesk reseller in {{city}}”."
              >
                <Input id="city-csv-landing" value={landingTitle} onChange={(event) => setLandingTitle(event.target.value)} maxLength={200} />
              </Field>
            ) : null}
          </div>
        ) : null}

        {plan && !results ? (
          <div className={busy ? 'opacity-70' : undefined} aria-busy={busy}>
            <p className="text-sm text-muted">
              {formatNumber(plan.counts.create)} to create · {formatNumber(plan.counts.exists + plan.counts.duplicate)} already there ·{' '}
              {formatNumber(plan.counts.conflict + plan.counts.invalid)} not possible. Nothing has been written yet.
            </p>
            {progress ? (
              <div
                className="mt-3 h-2 overflow-hidden rounded-full bg-muted/15"
                role="progressbar"
                aria-label="Import progress"
                aria-valuemin={0}
                aria-valuemax={progress.total || 1}
                aria-valuenow={progress.done}
              >
                <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 100}%` }} />
              </div>
            ) : null}
            <ul className="mt-3 max-h-[45vh] divide-y divide-hairline overflow-y-auto rounded-xl border border-hairline">
              {plan.rows.map((row) => (
                <li key={row.line} className="px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs tabular-nums text-muted">Line {row.line}</span>
                    <span className="text-sm font-medium text-content">{row.name || '—'}</span>
                    {row.region ? <span className="text-xs text-muted">{row.region}</span> : null}
                    <Badge tone={PLAN[row.outcome].tone}>{PLAN[row.outcome].label}</Badge>
                    {row.outcome === 'create' ? <Badge tone="neutral">{CITY_STATUS_LABELS[row.status]}</Badge> : null}
                  </div>
                  <p className="mt-0.5 text-xs text-muted">
                    {row.countryName ?? 'No market'}
                    {row.path ? <code className="ml-1.5 break-all font-mono text-content">{row.path}</code> : null}
                  </p>
                  {row.reason ? <p className="mt-0.5 text-xs text-muted">{row.reason}</p> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {results ? (
          <ul className="max-h-[50vh] divide-y divide-hairline overflow-y-auto rounded-xl border border-hairline">
            {results.map((row) => (
              <li key={row.line} className="flex flex-col gap-1 px-3 py-2 sm:flex-row sm:items-center sm:gap-3">
                <span className="text-xs tabular-nums text-muted">Line {row.line}</span>
                <span className="text-sm font-medium text-content">{row.name}</span>
                <Badge tone={RESULT[row.outcome].tone}>{RESULT[row.outcome].label}</Badge>
                {row.path ? <code className="break-all font-mono text-xs text-content">{row.path}</code> : null}
                {row.reason ? <span className="text-xs text-muted">{row.reason}</span> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </Dialog>
    </>
  );
}

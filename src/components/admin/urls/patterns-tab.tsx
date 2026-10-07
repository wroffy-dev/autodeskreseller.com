'use client';

import * as React from 'react';
import { Pencil, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/field';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/states';
import { Table, TableWrap, Th, Td, Tr } from '@/components/ui/table';
import { formatDate } from '@/lib/utils/format';
import { listOperationsAction, patternsAction, runOperationAction } from '@/lib/actions/urls';
import type { PatternCell, PatternOverview } from '@/lib/urls/manager';
import type { OperationView } from '@/lib/urls/bulk';
import { checkPattern, fillPattern } from '@/lib/urls/path';
import type { UrlContentType } from '@/lib/urls/types';
import { useManager } from './manager-context';
import { useLoader } from './shared';
import { PlanDialog, type PlanRequest } from './plan-dialog';

type Editing = {
  type: UrlContentType;
  label: string;
  needsSlug: boolean;
  countryId: string | null;
  scopeName: string;
  cell: PatternCell;
  inherited: string;
  prefix: string;
};

/**
 * URL patterns: one global default per content type, and an optional
 * override per market. A piece of content follows its market's pattern unless
 * it has a custom address of its own, which no pattern change ever touches.
 */
export function PatternsTab() {
  const { overview, refresh } = useManager();
  const { data, error, loading, reload } = useLoader<PatternOverview>(() => patternsAction(), []);
  const operations = useLoader<OperationView[]>(() => listOperationsAction(), []);
  const [editing, setEditing] = React.useState<Editing | null>(null);
  const [plan, setPlan] = React.useState<PlanRequest | null>(null);

  const unfinished = (operations.data ?? []).filter(
    (operation) => operation.status === 'RUNNING' || operation.status === 'PENDING',
  );

  return (
    <div className="space-y-5">
      <p className="max-w-3xl text-sm text-muted">
        Patterns decide where content lives unless it has a custom address. <code className="font-mono">{'{slug}'}</code>{' '}
        is replaced by the content’s slug: <code className="font-mono">/{'{slug}'}</code> puts a product at{' '}
        <code className="font-mono">/autocad</code>, <code className="font-mono">/software/{'{slug}'}</code> at{' '}
        <code className="font-mono">/software/autocad</code>. A market’s own pattern wins over the global one. Every
        change is previewed first, and every address that moves and has been public redirects permanently.
      </p>

      {!overview.resolverEnabled ? (
        <Alert tone="info">Patterns can be changed once the registry is switched on.</Alert>
      ) : null}

      {unfinished.length > 0 ? (
        <Alert tone="warning" title="A bulk change did not finish">
          {unfinished.map((operation) => (
            <p key={operation.id} className="mt-1">
              {operation.summary} — {operation.processed} of {operation.total} done ({formatDate(operation.createdAt)}).{' '}
              <ResumeButton operation={operation} onDone={() => { operations.reload(); reload(); refresh(); }} />
            </p>
          ))}
        </Alert>
      ) : null}

      {error ? (
        <Alert tone="danger" title="Could not load the patterns">
          {error}
        </Alert>
      ) : !data ? (
        <div className="h-40 animate-pulse rounded-xl bg-muted/10" aria-label="Loading patterns" />
      ) : (
        <div aria-busy={loading}>
          <TableWrap className="relative">
            <Table className="min-w-[46rem]">
              <caption className="sr-only">URL patterns</caption>
              <thead>
                <tr>
                  <Th>Content type</Th>
                  <Th>Global default</Th>
                  {data.markets.map((market) => (
                    <Th key={market.id}>{market.name}</Th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.types.map((row) => (
                  <Tr key={row.type}>
                    <Td>
                      <span className="font-medium text-content">{row.label}</span>
                      {row.rootOnly ? <span className="block text-xs text-muted">Root market only</span> : null}
                    </Td>
                    <Td>
                      <PatternCellView
                        cell={row.global}
                        label={`Edit the ${row.label.toLowerCase()} pattern for every market`}
                        canEdit={data.canGlobal && overview.resolverEnabled}
                        onEdit={() =>
                          setEditing({
                            type: row.type,
                            label: row.label,
                            needsSlug: row.needsSlug,
                            countryId: null,
                            scopeName: 'every market without its own pattern',
                            cell: row.global,
                            inherited: row.global.effective,
                            prefix: '',
                          })
                        }
                      />
                    </Td>
                    {data.markets.map((market) => {
                      const entry = row.markets.find((item) => item.countryId === market.id);
                      return (
                        <Td key={market.id}>
                          {entry ? (
                            <PatternCellView
                              cell={entry.cell}
                              label={`Edit the ${row.label.toLowerCase()} pattern for ${market.name}`}
                              inheritedLabel
                              canEdit={overview.resolverEnabled}
                              onEdit={() =>
                                setEditing({
                                  type: row.type,
                                  label: row.label,
                                  needsSlug: row.needsSlug,
                                  countryId: market.id,
                                  scopeName: market.name,
                                  cell: entry.cell,
                                  inherited: row.global.effective,
                                  prefix: market.slug ? `/${market.slug}` : '',
                                })
                              }
                            />
                          ) : (
                            <span className="text-xs text-muted">—</span>
                          )}
                        </Td>
                      );
                    })}
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
          <p className="mt-3 text-xs text-muted">
            Pages have no pattern: a page’s address is its own path, edited on the page or in All URLs.
          </p>
        </div>
      )}

      <PatternDialog
        editing={editing}
        markets={overview.markets}
        onClose={() => setEditing(null)}
        onPreview={(request) => {
          setEditing(null);
          setPlan(request);
        }}
      />
      <PlanDialog
        request={plan}
        title="Review the pattern change"
        onClose={() => setPlan(null)}
        onApplied={() => {
          reload();
          operations.reload();
          refresh();
        }}
      />
    </div>
  );
}

function PatternCellView({
  cell,
  label,
  canEdit,
  onEdit,
  inheritedLabel = false,
}: {
  cell: PatternCell;
  /** What the edit button does, for screen readers: every cell has one. */
  label: string;
  canEdit: boolean;
  onEdit: () => void;
  inheritedLabel?: boolean;
}) {
  return (
    <div className="flex items-start gap-2">
      <div className="min-w-0">
        <code className="break-all font-mono text-xs text-content">{cell.effective}</code>
        <div className="mt-1 flex flex-wrap gap-1">
          {cell.own ? (
            <Badge tone="brand">{inheritedLabel ? 'Own pattern' : 'Saved'}</Badge>
          ) : (
            <Badge tone="neutral">{inheritedLabel ? 'Inherits' : 'Default'}</Badge>
          )}
          <span className="text-[0.6875rem] text-muted">
            {cell.following} follow · {cell.custom} custom
          </span>
        </div>
      </div>
      {canEdit ? (
        <button
          type="button"
          onClick={onEdit}
          className="ml-auto shrink-0 rounded p-1.5 text-muted hover:bg-muted/10 hover:text-content"
          aria-label={label}
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

function PatternDialog({
  editing,
  markets,
  onClose,
  onPreview,
}: {
  editing: Editing | null;
  markets: Array<{ slug: string }>;
  onClose: () => void;
  onPreview: (request: PlanRequest) => void;
}) {
  const [value, setValue] = React.useState('');
  React.useEffect(() => {
    if (editing) setValue(editing.cell.own ?? editing.cell.effective);
  }, [editing]);

  if (!editing) return null;
  const checked = checkPattern(
    value,
    { marketPrefixes: markets.map((market) => market.slug).filter(Boolean) },
    { needsSlug: editing.needsSlug },
  );
  const example = checked.ok ? `${editing.prefix}${fillPattern(checked.pattern, 'autocad-lt')}`.replace(/\/$/, '') || '/' : null;

  return (
    <Dialog
      open
      onClose={onClose}
      title={`${editing.label} pattern`}
      description={`For ${editing.scopeName}.`}
      footer={
        <>
          {editing.countryId && editing.cell.own ? (
            <Button
              variant="ghost"
              className="mr-auto"
              onClick={() => onPreview({ kind: 'pattern', type: editing.type, countryId: editing.countryId, pattern: null })}
            >
              <RotateCw className="h-4 w-4" aria-hidden="true" />
              Inherit the global pattern
            </Button>
          ) : null}
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() =>
              checked.ok &&
              onPreview({ kind: 'pattern', type: editing.type, countryId: editing.countryId, pattern: checked.pattern })
            }
            disabled={!checked.ok}
          >
            Preview
          </Button>
        </>
      }
    >
      <Field
        label="Pattern"
        htmlFor="pattern-value"
        error={checked.ok ? undefined : checked.error}
        hint={
          editing.needsSlug
            ? 'Include {slug} once, as a whole segment. /{slug} removes the prefix altogether.'
            : 'A plain path, such as /blog or /insights.'
        }
      >
        <Input
          id="pattern-value"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          spellCheck={false}
          autoCapitalize="none"
          className="font-mono text-sm"
        />
      </Field>
      {example ? (
        <p className="mt-3 text-sm text-muted">
          Example: <code className="font-mono text-content">{example}</code>
        </p>
      ) : null}
      {editing.countryId ? (
        <p className="mt-2 text-xs text-muted">
          Without its own pattern this market inherits <code className="font-mono">{editing.inherited}</code>.
        </p>
      ) : null}
    </Dialog>
  );
}

function ResumeButton({ operation, onDone }: { operation: OperationView; onDone: () => void }) {
  const [busy, setBusy] = React.useState(false);
  async function resume() {
    setBusy(true);
    let view = operation;
    while (view.status === 'RUNNING' || view.status === 'PENDING') {
      const result = await runOperationAction(view.id);
      if (!result.ok || !result.data || result.data.processed === view.processed) break;
      view = result.data;
    }
    setBusy(false);
    onDone();
  }
  return (
    <button type="button" onClick={resume} disabled={busy} className="font-medium underline">
      {busy ? 'Resuming…' : 'Resume'}
    </button>
  );
}

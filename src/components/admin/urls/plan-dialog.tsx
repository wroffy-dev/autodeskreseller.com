'use client';

import * as React from 'react';
import { ArrowRight } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/states';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/icons';
import { useToast } from '@/components/ui/toast';
import { applyPlanAction, previewPlanAction, runOperationAction } from '@/lib/actions/urls';
import type { OperationView, Plan, PlanStatus } from '@/lib/urls/bulk';
import type { UrlContentType } from '@/lib/urls/types';
import { PathText } from './shared';

export type PlanRequest =
  | { kind: 'reset'; refs: Array<{ entityId: string; countryId: string; type: UrlContentType }> }
  | {
      kind: 'prefix';
      refs: Array<{ entityId: string; countryId: string; type: UrlContentType }>;
      from: string;
      to: string;
    }
  | { kind: 'pattern'; type: UrlContentType; countryId: string | null; pattern: string | null }
  | { kind: 'csv'; text: string };

const STATUS: Record<PlanStatus, { label: string; tone: BadgeTone }> = {
  change: { label: 'Will change', tone: 'brand' },
  unchanged: { label: 'Unchanged', tone: 'neutral' },
  conflict: { label: 'Conflict', tone: 'danger' },
  invalid: { label: 'Invalid', tone: 'danger' },
  excluded: { label: 'Excluded', tone: 'warning' },
  duplicate: { label: 'Duplicate', tone: 'warning' },
};

/**
 * Preview, then apply, a bulk change.
 *
 * The preview lists every affected address with what will happen to it and
 * why. Applying re-checks it all on the server; if anything changed in the
 * meantime the updated preview is shown instead of applying a stale one.
 * Large changes run in batches with a progress bar and can be resumed.
 */
export function PlanDialog({
  request,
  onClose,
  onApplied,
  title = 'Review the change',
}: {
  request: PlanRequest | null;
  onClose: () => void;
  onApplied: () => void;
  title?: string;
}) {
  const { toast } = useToast();
  const [plan, setPlan] = React.useState<Plan | null>(null);
  const [fingerprint, setFingerprint] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState<PlanStatus | 'all'>('all');
  const [operation, setOperation] = React.useState<OperationView | null>(null);
  const [applying, setApplying] = React.useState(false);
  const cancelled = React.useRef(false);

  React.useEffect(() => {
    setPlan(null);
    setError(null);
    setNotice(null);
    setOperation(null);
    setFilter('all');
    if (!request) return;
    let current = true;
    previewPlanAction(request).then((result) => {
      if (!current) return;
      if (!result.ok || !result.data) {
        setError(result.ok ? 'Could not preview.' : result.error);
        return;
      }
      setPlan(result.data.plan);
      setFingerprint(result.data.fingerprint);
    });
    return () => {
      current = false;
    };
  }, [request]);

  async function follow(start: OperationView) {
    let view = start;
    setOperation(view);
    cancelled.current = false;
    while (!cancelled.current && (view.status === 'PENDING' || view.status === 'RUNNING')) {
      const next = await runOperationAction(view.id);
      if (!next.ok || !next.data) {
        setError(next.ok ? 'The change stopped.' : next.error);
        return;
      }
      if (next.data.processed === view.processed && next.data.status === 'RUNNING') {
        // A batch that could not be applied: stop and let the person decide.
        setOperation(next.data);
        setError('A batch could not be applied; see the results below. Resume to try it again.');
        return;
      }
      view = next.data;
      setOperation(view);
    }
    if (view.status === 'COMPLETED' || view.status === 'PARTIAL') {
      toast(
        view.failed > 0 ? `${view.succeeded} applied, ${view.failed} not applied.` : `${view.succeeded} address(es) changed.`,
        view.failed > 0 ? 'warning' : 'success',
      );
      onApplied();
    }
  }

  async function apply() {
    if (!request) return;
    setApplying(true);
    setError(null);
    setNotice(null);
    const result = await applyPlanAction({ plan: request, fingerprint });
    setApplying(false);
    if (!result.ok || !result.data) {
      setError(result.ok ? 'Could not apply.' : result.error);
      return;
    }
    if ('stale' in result.data) {
      setPlan(result.data.plan);
      setFingerprint(result.data.fingerprint);
      setNotice(result.message ?? 'The preview was out of date and has been refreshed.');
      return;
    }
    await follow(result.data.operation);
  }

  const items = plan ? plan.items.filter((item) => filter === 'all' || item.status === filter) : [];
  const running = operation && (operation.status === 'PENDING' || operation.status === 'RUNNING');
  const done = operation && (operation.status === 'COMPLETED' || operation.status === 'PARTIAL');

  return (
    <Dialog
      open={Boolean(request)}
      onClose={() => {
        cancelled.current = true;
        onClose();
      }}
      size="xl"
      title={title}
      description={plan?.summary}
      footer={
        <>
          <Button
            variant="outline"
            onClick={() => {
              cancelled.current = true;
              onClose();
            }}
          >
            {done ? 'Close' : running ? 'Continue in background' : 'Cancel'}
          </Button>
          {!done ? (
            operation && !running ? (
              <Button onClick={() => follow(operation)}>Resume</Button>
            ) : (
              <Button onClick={apply} disabled={!plan || applying || Boolean(running) || (plan.counts.change === 0 && !plan.pattern)}>
                {applying || running ? <Spinner className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                {plan?.pattern
                  ? `Save pattern${plan.counts.change > 0 ? ` and move ${plan.counts.change}` : ''}`
                  : `Apply ${plan?.counts.change ?? 0} change(s)`}
              </Button>
            )
          ) : null}
        </>
      }
    >
      {error ? (
        <Alert tone="danger" title="Not applied" className="mb-3">
          {error}
        </Alert>
      ) : null}
      {notice ? (
        <Alert tone="warning" className="mb-3">
          {notice}
        </Alert>
      ) : null}

      {!plan && !error ? (
        <p className="flex items-center gap-2 py-8 text-sm text-muted" role="status">
          <Spinner className="h-4 w-4 animate-spin" aria-hidden="true" /> Working out what would change…
        </p>
      ) : null}

      {operation ? (
        <div className="mb-4" role="status" aria-live="polite">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-content">
              {done ? 'Finished' : 'Applying'} — {operation.processed} of {operation.total}
            </span>
            <span className="text-xs text-muted">
              {operation.succeeded} applied · {operation.failed} not applied
            </span>
          </div>
          <div
            className="mt-2 h-2 overflow-hidden rounded-full bg-muted/15"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={operation.total || 1}
            aria-valuenow={operation.processed}
          >
            <div
              className="h-full rounded-full bg-brand transition-all"
              style={{ width: `${operation.total ? (operation.processed / operation.total) * 100 : 100}%` }}
            />
          </div>
          {operation.results.some((result) => !result.ok) ? (
            <ul className="mt-3 max-h-40 space-y-1 overflow-y-auto text-xs">
              {operation.results
                .filter((result) => !result.ok)
                .map((result, index) => (
                  <li key={index} className="text-red-700">
                    {result.oldPath ?? result.key}: {result.message}
                  </li>
                ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {plan ? (
        <>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Show">
            <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>
              All {plan.items.length}
            </FilterChip>
            {(Object.keys(STATUS) as PlanStatus[])
              .filter((status) => plan.counts[status] > 0)
              .map((status) => (
                <FilterChip key={status} active={filter === status} onClick={() => setFilter(status)}>
                  {STATUS[status].label} {plan.counts[status]}
                </FilterChip>
              ))}
          </div>
          {plan.pattern ? (
            <p className="mt-3 text-sm text-muted">
              New content of this type will follow the new pattern straight away. Addresses listed as changing
              move, and each one that has been public redirects permanently to its new address. Custom addresses
              are never changed by a pattern.
            </p>
          ) : null}
          {items.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">Nothing in this group.</p>
          ) : (
            <ul className="mt-3 max-h-[45vh] divide-y divide-hairline overflow-y-auto rounded-lg border border-hairline">
              {items.slice(0, 500).map((item, index) => (
                <li key={`${item.entityId}-${item.countryId}-${index}`} className="px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 truncate text-sm font-medium text-content">{item.label}</span>
                    <Badge tone={STATUS[item.status].tone}>{STATUS[item.status].label}</Badge>
                    {item.status === 'change' && item.redirects && item.from ? (
                      <Badge tone="neutral">308 from old address</Badge>
                    ) : null}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <PathText path={item.from} />
                    {item.to && item.to !== item.from ? (
                      <>
                        <ArrowRight className="h-3 w-3 text-muted" aria-hidden="true" />
                        <PathText path={item.to} />
                      </>
                    ) : null}
                  </div>
                  {item.reason ? <p className="mt-1 text-xs text-muted">{item.reason}</p> : null}
                </li>
              ))}
            </ul>
          )}
          {items.length > 500 ? <p className="mt-2 text-xs text-muted">Showing the first 500.</p> : null}
        </>
      ) : null}
    </Dialog>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
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

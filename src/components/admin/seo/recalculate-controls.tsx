'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { recalculateSeoBatch, recalculateSeoScore } from '@/lib/actions/seo-intelligence';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/icons';
import { useToast } from '@/components/ui/toast';
import type { SeoEntityType } from '@/lib/seo/types';

/**
 * "Recalculate all" and "Recalculate outdated".
 *
 * The server recalculates twenty URLs per call and says where to carry on,
 * so the browser loops until it is done: no request runs long, progress is
 * real, and closing the tab simply stops the run with everything done so far
 * already saved.
 */
export function RecalculateControls({
  outdated,
  total,
  autoStart = false,
}: {
  /** URLs whose cached score is stale or missing. */
  outdated: number;
  total: number;
  /** Start straight away — for a site that has never been scored. */
  autoStart?: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [running, setRunning] = React.useState<null | 'all' | 'outdated'>(null);
  const [progress, setProgress] = React.useState({ done: 0, total: 0 });
  const cancelled = React.useRef(false);

  const run = React.useCallback(
    async (mode: 'all' | 'outdated') => {
      cancelled.current = false;
      setRunning(mode);
      let cursor: string | null = null;
      let done = 0;
      setProgress({ done: 0, total: mode === 'all' ? total : outdated });
      try {
        do {
          const result = await recalculateSeoBatch({ cursor, onlyOutdated: mode === 'outdated' });
          if (!result.ok || !result.data) {
            toast(result.ok ? 'Recalculation stopped.' : result.error, 'error');
            break;
          }
          done += result.data.processed;
          setProgress({ done, total: done + result.data.remaining });
          cursor = result.data.nextCursor;
        } while (cursor && !cancelled.current);
        if (!cancelled.current) toast(`Recalculated ${done} ${done === 1 ? 'URL' : 'URLs'}.`);
      } catch {
        toast('Recalculation was interrupted. Everything finished so far is saved.', 'error');
      } finally {
        setRunning(null);
        router.refresh();
      }
    },
    [outdated, total, router, toast],
  );

  const started = React.useRef(false);
  React.useEffect(() => {
    if (!autoStart || started.current) return;
    started.current = true;
    void run('all');
  }, [autoStart, run]);

  // Leaving the page stops the run after the batch in flight.
  React.useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
    };
  }, []);

  const percent = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="flex flex-col items-stretch gap-2 sm:items-end">
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="md"
          disabled={running !== null || outdated === 0}
          onClick={() => void run('outdated')}
        >
          {running === 'outdated' ? (
            <Spinner className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
          )}
          Recalculate outdated{outdated > 0 ? ` (${outdated})` : ''}
        </Button>
        <Button disabled={running !== null || total === 0} onClick={() => void run('all')}>
          {running === 'all' ? (
            <Spinner className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
          )}
          Recalculate all
        </Button>
      </div>
      {running ? (
        <div className="w-full sm:w-72" aria-live="polite">
          <div
            className="h-1.5 overflow-hidden rounded-full bg-muted/15"
            role="progressbar"
            aria-label="Recalculation progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
          >
            <div className="h-full rounded-full bg-brand transition-[width]" style={{ width: `${percent}%` }} />
          </div>
          <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted">
            <span>
              {progress.done} of {progress.total} URLs
            </span>
            <button
              type="button"
              onClick={() => {
                cancelled.current = true;
              }}
              className="font-medium text-content hover:underline"
            >
              Stop
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Recalculates one URL's cached score. */
export function RecalculateButton({
  entity,
  label = 'Recalculate score',
  variant = 'outline',
}: {
  entity: { type: SeoEntityType; id: string; countryId?: string };
  label?: string;
  variant?: 'outline' | 'ghost';
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, setPending] = React.useState(false);

  return (
    <Button
      variant={variant}
      size="sm"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        try {
          const result = await recalculateSeoScore(entity);
          if (!result.ok) toast(result.error, 'error');
          else toast(result.message ?? 'Score recalculated.');
        } catch {
          toast('The score could not be recalculated. Try again.', 'error');
        } finally {
          setPending(false);
          router.refresh();
        }
      }}
    >
      {pending ? (
        <Spinner className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
      ) : (
        <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
      )}
      {label}
    </Button>
  );
}

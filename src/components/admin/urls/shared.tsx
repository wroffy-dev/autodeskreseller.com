'use client';

import * as React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/field';
import { cn } from '@/lib/utils/cn';
import { formatNumber } from '@/lib/utils/format';
import { PUBLICATION_LABELS, type UrlPublicationState } from '@/lib/urls/types';

export function StateBadge({ state }: { state: UrlPublicationState }) {
  const tone =
    state === 'live' ? 'success' : state === 'scheduled' ? 'info' : state === 'hidden' ? 'purple' : state === 'archived' ? 'neutral' : 'warning';
  return <Badge tone={tone}>{PUBLICATION_LABELS[state]}</Badge>;
}

export function ModeBadge({ mode }: { mode: 'PATTERN' | 'CUSTOM' | null }) {
  if (mode === null) return <Badge tone="danger">No address</Badge>;
  return mode === 'CUSTOM' ? <Badge tone="brand">Custom</Badge> : <Badge tone="neutral">Pattern</Badge>;
}

/** A path, set in monospace and allowed to wrap anywhere so it never widens a phone screen. */
export function PathText({ path, className }: { path: string | null; className?: string }) {
  if (!path) return <span className="text-sm text-muted">—</span>;
  return <code className={cn('break-all font-mono text-xs text-content', className)}>{path}</code>;
}

/** Previous / next, without navigating: the list, its filters and its scroll stay put. */
export function Pager({
  page,
  pages,
  total,
  onPage,
  noun = 'result',
  plural = `${noun}s`,
}: {
  page: number;
  pages: number;
  total: number;
  onPage: (page: number) => void;
  noun?: string;
  plural?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-between gap-3 border-t border-hairline pt-3 sm:flex-row">
      <p className="text-xs text-muted" aria-live="polite">
        {formatNumber(total)} {total === 1 ? noun : plural}
        {pages > 1 ? ` · page ${page} of ${pages}` : ''}
      </p>
      {pages > 1 ? (
        <nav aria-label="Pagination" className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onPage(page - 1)}
            disabled={page <= 1}
            className="inline-flex h-8 items-center gap-1 rounded-lg border border-hairline px-2.5 text-sm text-content hover:bg-muted/10 disabled:opacity-40"
          >
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Prev
          </button>
          <button
            type="button"
            onClick={() => onPage(page + 1)}
            disabled={page >= pages}
            className="inline-flex h-8 items-center gap-1 rounded-lg border border-hairline px-2.5 text-sm text-content hover:bg-muted/10 disabled:opacity-40"
          >
            Next
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </nav>
      ) : null}
    </div>
  );
}

/** A labelled filter select, compact enough for a toolbar. */
export function FilterSelect({
  id,
  label,
  value,
  onChange,
  options,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Select id={id} value={value} onChange={(event) => onChange(event.target.value)} className="h-9 text-sm">
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    </div>
  );
}

/**
 * Loads data through a Server Action whenever its inputs change, keeping the
 * previous result on screen while the next one loads.
 */
export function useLoader<T>(
  load: () => Promise<{ ok: true; data?: T } | { ok: false; error: string }>,
  deps: React.DependencyList,
): { data: T | null; error: string | null; loading: boolean; reload: () => void } {
  const [data, setData] = React.useState<T | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [tick, setTick] = React.useState(0);
  const latest = React.useRef(0);

  React.useEffect(() => {
    const request = ++latest.current;
    setLoading(true);
    load()
      .then((result) => {
        if (request !== latest.current) return;
        if (result.ok) {
          setData((result.data ?? null) as T | null);
          setError(null);
        } else {
          setError(result.error);
        }
      })
      .catch(() => {
        if (request === latest.current) setError('Could not load. Check your connection and try again.');
      })
      .finally(() => {
        if (request === latest.current) setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  return { data, error, loading, reload: () => setTick((value) => value + 1) };
}

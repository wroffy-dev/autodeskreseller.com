'use client';

import * as React from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { Search, X, SlidersHorizontal, Check } from 'lucide-react';
import {
  describeFilters,
  countActiveFilters,
  hasActiveFilters,
  NON_FILTER_KEYS,
  type FilterDefinition,
  type FilterPreset,
} from '@/lib/admin/filters';
import { Input, Select, Label } from '@/components/ui/field';
import {
  resolveRange,
  formatRangeLabel,
  RANGE_PRESET_LABELS,
  type RangePreset,
} from '@/lib/admin/date-range';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';

/**
 * URL-backed filter bar with an advanced drawer, chips and presets.
 *
 * Everything lives in the query string, so filtering happens on the server, the
 * view is shareable, and browser back/forward behaves. Primary filters sit in
 * the bar; anything marked `advanced` moves into "More filters" so the screen
 * never becomes a wall of dropdowns.
 */
export function FilterBar({
  searchPlaceholder = 'Search…',
  definitions,
  presets = [],
  children,
}: {
  searchPlaceholder?: string;
  definitions: FilterDefinition[];
  presets?: FilterPreset[];
  /** Extra controls (export, view toggles) pinned to the end of the bar. */
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const params = React.useMemo(() => {
    const record: Record<string, string | undefined> = {};
    searchParams.forEach((value, key) => {
      record[key] = value;
    });
    return record;
  }, [searchParams]);

  const [query, setQuery] = React.useState(params.q ?? '');
  const [drawerOpen, setDrawerOpen] = React.useState(false);

  // Keep the input in step when the URL changes from elsewhere (a chip, a preset).
  React.useEffect(() => {
    setQuery(searchParams.get('q') ?? '');
  }, [searchParams]);

  const push = React.useCallback(
    (updates: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      // Any filter change returns to the first page of results.
      next.delete('page');
      const qs = next.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  // Debounced search so typing does not fire a query per keystroke.
  React.useEffect(() => {
    const current = searchParams.get('q') ?? '';
    if (query === current) return;
    const timer = window.setTimeout(() => push({ q: query || null }), 350);
    return () => window.clearTimeout(timer);
  }, [query, push, searchParams]);

  const applyPreset = (preset: FilterPreset) => {
    const next = new URLSearchParams();
    // Presets are a complete view, so they replace rather than merge — except
    // for sort, which is a display preference the admin already chose.
    for (const key of ['sort', 'dir'] as const) {
      const value = searchParams.get(key);
      if (value) next.set(key, value);
    }
    for (const [key, value] of Object.entries(preset.params)) next.set(key, value);
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const clearAll = () => {
    const next = new URLSearchParams();
    for (const key of ['sort', 'dir'] as const) {
      const value = searchParams.get(key);
      if (value) next.set(key, value);
    }
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const primary = definitions.filter((definition) => !definition.advanced);
  const advanced = definitions.filter((definition) => definition.advanced);

  const chips = describeFilters(params, definitions);
  const activeCount = countActiveFilters(params);
  const anyActive = hasActiveFilters(params);
  const advancedActive = advanced.filter((definition) => params[definition.name]).length;

  const dateFilter = definitions.find((definition) => definition.kind === 'date');
  const dateActive = Boolean(params.from || params.to);

  const activePreset = presets.find((preset) => {
    const keys = Object.keys(preset.params);
    const current = Object.entries(params).filter(
      ([key, value]) => Boolean(value) && !NON_FILTER_KEYS.has(key),
    );
    return (
      current.length === keys.length && keys.every((key) => params[key] === preset.params[key])
    );
  });

  return (
    <div className="mb-4 space-y-3">
      {presets.length > 0 ? (
        <div className="scroll-x flex items-center gap-1.5 pb-0.5">
          {presets.map((preset) => {
            const isActive = activePreset?.id === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => applyPreset(preset)}
                aria-pressed={isActive}
                className={cn(
                  'shrink-0 rounded-full px-3 py-1.5 text-[0.8125rem] font-medium transition-colors',
                  isActive
                    ? 'bg-brand/10 text-brand ring-1 ring-inset ring-brand/25'
                    : 'text-muted hover:bg-muted/[0.07] hover:text-content',
                )}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      ) : null}

      {/* Search and filters share one glass strip, every control the same
          height and radius, wrapping cleanly on narrow screens. */}
      <div className="glass-card flex flex-wrap items-center gap-2 rounded-[var(--radius-card-sm)] border border-hairline bg-surface p-2">
        <div className="relative min-w-[min(100%,14rem)] flex-1 sm:max-w-xs">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
            aria-hidden="true"
          />
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            className="pl-9"
          />
        </div>

        {primary.map((definition) =>
          definition.kind === 'date' ? null : (
            /*
             * Its own row on a phone, inline from `sm` up.
             *
             * The select below is already `w-full sm:w-auto`, but the wrapper
             * was a flex item with an auto basis — and a select's intrinsic
             * width comes from its longest option, so on a narrow screen it
             * won and squeezed the search box beside it down to fifty pixels,
             * with the two boxes ending up on top of each other. `basis-full`
             * makes the wrap explicit at the width where they cannot share a
             * line.
             */
            <div key={definition.name} className="min-w-0 basis-full sm:basis-auto">
              <label htmlFor={`filter-${definition.name}`} className="sr-only">
                {definition.label}
              </label>
              <Select
                id={`filter-${definition.name}`}
                value={params[definition.name] ?? ''}
                onChange={(event) => push({ [definition.name]: event.target.value || null })}
                className={cn(
                  'w-full sm:w-auto',
                  params[definition.name] && 'border-brand/40 bg-brand/[0.04]',
                )}
              >
                <option value="">{definition.allLabel ?? `${definition.label}: all`}</option>
                {definition.options?.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                    {option.hint ? ` (${option.hint})` : ''}
                  </option>
                ))}
              </Select>
            </div>
          ),
        )}

        {dateFilter ? (
          <DateRangeControl
            label={dateFilter.label}
            from={params.from ?? ''}
            to={params.to ?? ''}
            active={dateActive}
            onChange={(from, to) => push({ from: from || null, to: to || null })}
          />
        ) : null}

        {advanced.length > 0 ? (
          <Button
            variant="outline"
            onClick={() => setDrawerOpen(true)}
            aria-haspopup="dialog"
            className={cn(advancedActive > 0 && 'border-brand/40 bg-brand/[0.04] text-brand')}
          >
            <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
            More filters
            {advancedActive > 0 ? (
              <span className="ml-0.5 rounded-full bg-brand px-1.5 text-[0.6875rem] font-semibold text-white">
                {advancedActive}
              </span>
            ) : null}
          </Button>
        ) : null}

        {children ? <div className="ml-auto flex items-center gap-2">{children}</div> : null}
      </div>

      {anyActive ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium text-muted">
            {activeCount} {activeCount === 1 ? 'filter' : 'filters'} active
          </span>

          {params.q ? (
            <Chip label="Search" display={params.q} onRemove={() => push({ q: null })} />
          ) : null}

          {chips.map((chip) => (
            <Chip
              key={chip.name}
              label={chip.label}
              display={chip.display}
              onRemove={() => push({ [chip.name]: null })}
            />
          ))}

          {dateActive ? (
            <Chip
              label="Date"
              display={`${params.from || 'any'} → ${params.to || 'now'}`}
              onRemove={() => push({ from: null, to: null })}
            />
          ) : null}

          <button
            type="button"
            onClick={clearAll}
            className="rounded-lg px-2 py-1 text-xs font-medium text-muted underline-offset-2 transition-colors hover:text-content hover:underline"
          >
            Clear all
          </button>
        </div>
      ) : null}

      {drawerOpen ? (
        <AdvancedFilterDrawer
          definitions={advanced}
          params={params}
          onApply={(updates) => {
            push(updates);
            setDrawerOpen(false);
          }}
          onClose={() => setDrawerOpen(false)}
        />
      ) : null}
    </div>
  );
}

function Chip({
  label,
  display,
  onRemove,
}: {
  label: string;
  display: string;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-brand/25 bg-brand/[0.07] py-0.5 pl-2.5 pr-1 text-xs text-content">
      <span className="text-muted">{label}:</span>
      <span className="max-w-[10rem] truncate font-medium">{display}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${label} filter`}
        className="rounded-full p-0.5 text-muted transition-colors hover:bg-brand/15 hover:text-content"
      >
        <X className="h-3 w-3" aria-hidden="true" />
      </button>
    </span>
  );
}

/**
 * The quick picks offered on any list's date filter. Same vocabulary and same
 * resolution as the CRM dashboard, so "Last 7 days" means the same window
 * wherever the admin chooses it.
 */
const DATE_QUICK_PICKS: RangePreset[] = [
  'today',
  'yesterday',
  'last7',
  'last30',
  'thisMonth',
  'lastMonth',
];

function DateRangeControl({
  label,
  from,
  to,
  active,
  onChange,
}: {
  label: string;
  from: string;
  to: string;
  active: boolean;
  onChange: (from: string, to: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Named when it matches a preset, spelled out otherwise — "Last 7 days"
  // reads better on the button than "2026-09-04 → 2026-09-10".
  const matchedPreset = active
    ? DATE_QUICK_PICKS.find((pick) => {
        const picked = resolveRange({ range: pick });
        return picked.from === from && picked.to === to;
      })
    : undefined;

  const summary = !active
    ? label
    : matchedPreset
      ? RANGE_PRESET_LABELS[matchedPreset]
      : from && to
        ? formatRangeLabel({ from, to })
        : `${from || 'Any'} → ${to || 'Now'}`;

  return (
    <div className="relative" ref={ref}>
      <Button
        variant="outline"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className={cn('max-w-[14rem]', active && 'border-brand/40 bg-brand/[0.04] text-brand')}
      >
        <span className="truncate">{summary}</span>
      </Button>

      {open ? (
        <div className="glass-menu absolute left-0 top-full z-dropdown mt-1.5 w-72 rounded-xl border border-hairline bg-surface p-3 shadow-xl">
          <div className="mb-3 grid grid-cols-2 gap-1">
            {DATE_QUICK_PICKS.map((pick) => {
              const picked = resolveRange({ range: pick });
              const isActive = from === picked.from && to === picked.to;
              return (
                <button
                  key={pick}
                  type="button"
                  onClick={() => onChange(picked.from, picked.to)}
                  aria-pressed={isActive}
                  className={cn(
                    'rounded-lg px-2.5 py-1.5 text-left text-[0.8125rem] transition-colors',
                    isActive
                      ? 'bg-brand/10 font-medium text-brand'
                      : 'text-content hover:bg-muted/[0.07]',
                  )}
                >
                  {RANGE_PRESET_LABELS[pick]}
                </button>
              );
            })}
          </div>

          <p className="mb-2 border-t border-hairline pt-2.5 text-xs font-semibold uppercase tracking-wide text-muted">
            Custom
          </p>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="filter-from" className="text-xs font-normal text-muted">
                From
              </Label>
              <Input
                id="filter-from"
                type="date"
                value={from}
                max={to || undefined}
                onChange={(event) => onChange(event.target.value, to)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="filter-to" className="text-xs font-normal text-muted">
                To
              </Label>
              <Input
                id="filter-to"
                type="date"
                value={to}
                min={from || undefined}
                onChange={(event) => onChange(from, event.target.value)}
              />
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between">
            <button
              type="button"
              onClick={() => onChange('', '')}
              className="rounded-lg px-2 py-1 text-xs text-muted transition-colors hover:text-content"
            >
              Clear dates
            </button>
            <Button size="sm" onClick={() => setOpen(false)}>
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
              Done
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Advanced filters in a side drawer.
 *
 * Choices are staged locally and applied on submit, so the admin can set several
 * at once without a page load between each one.
 */
function AdvancedFilterDrawer({
  definitions,
  params,
  onApply,
  onClose,
}: {
  definitions: FilterDefinition[];
  params: Record<string, string | undefined>;
  onApply: (updates: Record<string, string | null>) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = React.useState<Record<string, string>>(() =>
    Object.fromEntries(
      definitions.map((definition) => [definition.name, params[definition.name] ?? '']),
    ),
  );
  const panelRef = React.useRef<HTMLDivElement>(null);

  const onCloseRef = React.useRef(onClose);
  React.useEffect(() => {
    onCloseRef.current = onClose;
  });

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);
    panelRef.current?.querySelector<HTMLElement>('select, input, button')?.focus();
    return () => document.removeEventListener('keydown', onKey);
    // Mounting is what this is for. `onClose` is an inline arrow from a parent
    // that also owns the search box above the drawer, so listing it here moved
    // focus into the drawer's first control every time that parent
    // re-rendered — including on each keystroke in that search box.
  }, []);

  const activeInDraft = Object.values(draft).filter(Boolean).length;

  return (
    <div
      className="fixed inset-0 z-drawer flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label="More filters"
    >
      <div
        className="admin-scrim absolute inset-0 bg-[rgb(var(--brand-secondary))]/40"
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        ref={panelRef}
        className="relative flex h-full w-full max-w-sm animate-slide-up flex-col border-l border-hairline bg-surface shadow-2xl"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-hairline px-5 py-4">
          <div>
            <h2 className="font-heading text-base font-semibold text-content">More filters</h2>
            <p className="text-xs text-muted">Narrow the list further. Filters combine.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close filters"
            className="rounded-lg p-1.5 text-muted transition-colors hover:bg-muted/10 hover:text-content"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          {definitions.map((definition) => (
            <div key={definition.name} className="space-y-1.5">
              <Label htmlFor={`advanced-${definition.name}`}>{definition.label}</Label>
              <Select
                id={`advanced-${definition.name}`}
                value={draft[definition.name] ?? ''}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    [definition.name]: event.target.value,
                  }))
                }
              >
                <option value="">{definition.allLabel ?? 'Any'}</option>
                {definition.options?.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                    {option.hint ? ` (${option.hint})` : ''}
                  </option>
                ))}
              </Select>
            </div>
          ))}

          {definitions.every((definition) => (definition.options?.length ?? 0) === 0) ? (
            <p className="rounded-lg border border-dashed border-hairline px-4 py-6 text-center text-sm text-muted">
              There is no attribution data to filter on yet.
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-hairline bg-muted/[0.03] px-5 py-3">
          <button
            type="button"
            onClick={() =>
              setDraft(Object.fromEntries(definitions.map((definition) => [definition.name, ''])))
            }
            className="rounded-lg px-2 py-1.5 text-sm text-muted transition-colors hover:text-content"
          >
            Reset
          </button>
          <Button
            onClick={() =>
              onApply(
                Object.fromEntries(
                  definitions.map((definition) => [
                    definition.name,
                    draft[definition.name] || null,
                  ]),
                ),
              )
            }
          >
            Apply{activeInDraft > 0 ? ` (${activeInDraft})` : ''}
          </Button>
        </div>
      </div>
    </div>
  );
}

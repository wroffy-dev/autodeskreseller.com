'use client';

import * as React from 'react';
import Link from 'next/link';
import { ChevronDown, ExternalLink, EyeOff, Clock, RefreshCw } from 'lucide-react';
import { scoreSeoDraft } from '@/lib/actions/seo-intelligence';
import { allChecks, groupChecks } from '@/lib/seo/recommendations';
import { auditHref, KEYWORD_STATUS_LABELS, PAGE_KIND_LABELS } from '@/lib/seo/score-state';
import {
  KEYWORD_PLACEMENT_LABELS,
  type CheckResult,
  type KeywordAnalysis,
  type KeywordPlacement,
  type SeoAuditResult,
  type SeoEntityType,
} from '@/lib/seo/types';
import { cn } from '@/lib/utils/cn';
import { Spinner } from '@/components/ui/icons';
import { CheckItem } from './check-item';
import { ScoreMeter, ScoreRing } from './score-display';
import type { SeoJumpResolver } from './jump';

/**
 * The live SEO, AEO and GEO score inside an editor.
 *
 * It scores what is in the form right now: the editor's unsaved values are
 * sent to the server, laid over the saved record and scored there by the same
 * engine the dashboard uses, a moment after the editor stops typing. Nothing
 * is saved by scoring. Every issue says what was found and how to fix it, and
 * where the editor can reach the field, a button goes straight to it.
 */

export type SeoScoreEntity = { type: SeoEntityType; id: string; countryId?: string };

export type SeoScorePayload = {
  draft?: unknown;
  productDraft?: unknown;
  marketDraft?: unknown;
};

type Bucket = 'issues' | 'warnings' | 'suggestions' | 'passed';

const BUCKET_LABELS: Record<Bucket, string> = {
  issues: 'Issues',
  warnings: 'Warnings',
  suggestions: 'Suggestions',
  passed: 'Passed',
};

const BUCKET_EMPTY: Record<Bucket, string> = {
  issues: 'No critical issues.',
  warnings: 'No warnings.',
  suggestions: 'No suggestions — nothing more to add here.',
  passed: 'Nothing has passed yet.',
};

const KEYWORD_TONES: Record<KeywordAnalysis['status'], string> = {
  strong: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  good: 'bg-lime-50 text-lime-800 ring-lime-600/20',
  weak: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  missing: 'bg-red-50 text-red-700 ring-red-600/20',
  overused: 'bg-red-50 text-red-700 ring-red-600/20',
};

const DEBOUNCE_MS = 800;
const EXPANDED_KEY = 'seo-score-panel-expanded';

function readExpanded(fallback: boolean): boolean {
  try {
    const stored = window.localStorage.getItem(EXPANDED_KEY);
    return stored === null ? fallback : stored === 'true';
  } catch {
    return fallback;
  }
}

export function SeoScorePanel({
  entity,
  payload,
  resolveJump,
  marketName,
  emptyMessage = 'Save this first to see its SEO, AEO and GEO scores. From then on they update as you edit.',
  defaultExpanded = true,
  rememberExpanded = true,
  className,
}: {
  /** The URL being edited; null before it is first saved. */
  entity: SeoScoreEntity | null;
  /** The editor's unsaved values. */
  payload?: SeoScorePayload;
  resolveJump?: SeoJumpResolver;
  /** The market the score is for, where the editor could mean several. */
  marketName?: string;
  emptyMessage?: string;
  defaultExpanded?: boolean;
  /** Keep the open/closed choice between editors. */
  rememberExpanded?: boolean;
  className?: string;
}) {
  const uid = React.useId();
  const [result, setResult] = React.useState<SeoAuditResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [expanded, setExpanded] = React.useState(defaultExpanded);
  const [bucket, setBucket] = React.useState<Bucket | null>(null);

  // The choice is read after mounting so the server render and the first
  // client render agree.
  React.useEffect(() => {
    if (rememberExpanded) setExpanded(readExpanded(defaultExpanded));
  }, [rememberExpanded, defaultExpanded]);

  const toggleExpanded = () => {
    setExpanded((current) => {
      const next = !current;
      if (rememberExpanded) {
        try {
          window.localStorage.setItem(EXPANDED_KEY, String(next));
        } catch {
          // Private windows may refuse storage; the panel still works.
        }
      }
      return next;
    });
  };

  const serialized = React.useMemo(() => JSON.stringify(payload ?? {}), [payload]);
  const latestPayload = React.useRef(serialized);
  latestPayload.current = serialized;
  const entityKey = entity ? `${entity.type}:${entity.id}:${entity.countryId ?? ''}` : '';
  const latestEntity = React.useRef(entity);
  latestEntity.current = entity;
  const request = React.useRef(0);

  const run = React.useCallback(async (refresh = false) => {
    const target = latestEntity.current;
    if (!target) return;
    const id = ++request.current;
    setLoading(true);
    try {
      const response = await scoreSeoDraft({
        ref: target,
        ...(JSON.parse(latestPayload.current) as SeoScorePayload),
        refresh,
      });
      if (id !== request.current) return;
      if (response.ok && response.data) {
        setResult(response.data);
        setError(null);
      } else {
        setError(response.ok ? 'The score could not be calculated.' : response.error);
      }
    } catch {
      if (id === request.current) {
        setError('The score could not be calculated. Check your connection and try again.');
      }
    } finally {
      if (id === request.current) setLoading(false);
    }
  }, []);

  // Score on open, then a moment after each change.
  const scored = React.useRef(false);
  React.useEffect(() => {
    if (!entityKey) return;
    const delay = scored.current ? DEBOUNCE_MS : 0;
    scored.current = true;
    const handle = window.setTimeout(() => void run(), delay);
    return () => window.clearTimeout(handle);
  }, [entityKey, serialized, run]);

  const groups = React.useMemo(() => {
    const grouped = groupChecks(result ? allChecks(result) : []);
    return {
      issues: grouped.critical,
      warnings: grouped.warnings,
      suggestions: grouped.suggestions,
      passed: grouped.passed,
      info: grouped.info,
    };
  }, [result]);

  // Open on the most urgent list that has something in it, until the editor
  // picks one themselves.
  const shown: Bucket =
    bucket ??
    (['issues', 'warnings', 'suggestions'] as const).find((key) => groups[key].length > 0) ??
    'passed';

  const headingId = `${uid}-heading`;

  return (
    <section
      aria-labelledby={headingId}
      className={cn('rounded-xl border border-hairline bg-surface', className)}
    >
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-hairline px-4 py-3">
        <div className="min-w-0">
          <h3 id={headingId} className="text-sm font-semibold text-content">
            SEO Intelligence
          </h3>
          <p className="mt-0.5 text-xs text-muted" aria-live="polite">
            {!entity
              ? 'Scores appear once this is saved.'
              : loading
                ? 'Analysing…'
                : error
                  ? 'Score unavailable.'
                  : result
                    ? `${PAGE_KIND_LABELS[result.kind]}${marketName ? ` in ${marketName}` : ''} · updates as you edit`
                    : 'Waiting to analyse…'}
          </p>
        </div>
        {entity ? (
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => void run(true)}
              disabled={loading}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-content transition-colors hover:bg-muted/10 disabled:opacity-50"
            >
              {loading ? (
                <Spinner className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              Recalculate
            </button>
            {result ? (
              <button
                type="button"
                onClick={toggleExpanded}
                aria-expanded={expanded}
                aria-controls={`${uid}-details`}
                className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-medium text-muted transition-colors hover:bg-muted/10 hover:text-content"
              >
                {expanded ? 'Hide details' : 'Show details'}
                <ChevronDown
                  className={cn('h-3.5 w-3.5 transition-transform', expanded && 'rotate-180')}
                  aria-hidden="true"
                />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="space-y-4 p-4">
        {!entity ? (
          <p className="rounded-lg bg-muted/[0.06] px-3 py-2.5 text-xs leading-relaxed text-muted">
            {emptyMessage}
          </p>
        ) : error && !result ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-800" role="alert">
            <p>{error}</p>
            <button
              type="button"
              onClick={() => void run(true)}
              className="mt-1 font-medium underline underline-offset-2"
            >
              Try again
            </button>
          </div>
        ) : !result ? (
          <PanelSkeleton />
        ) : (
          <>
            <div
              className={cn('flex flex-wrap items-center gap-4 transition-opacity', loading && 'opacity-60')}
              aria-busy={loading}
            >
              <ScoreRing score={result.overall} label="Overall" size="lg" />
              <div className="min-w-[9rem] flex-1 space-y-2.5">
                <ScoreMeter dimension="seo" score={result.seo.score} />
                <ScoreMeter dimension="aeo" score={result.aeo.score} />
                <ScoreMeter dimension="geo" score={result.geo.score} />
              </div>
            </div>

            <p className="text-xs text-muted">
              <Count value={result.counts.critical} one="critical issue" many="critical issues" tone="text-red-700" />
              {' · '}
              <Count value={result.counts.warnings} one="warning" many="warnings" tone="text-amber-700" />
              {' · '}
              <Count value={result.counts.suggestions} one="suggestion" many="suggestions" tone="text-sky-700" />
            </p>

            {error ? (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800" role="alert">
                {error} The scores shown are from the last successful check.
              </p>
            ) : null}

            <Notices result={result} />

            {expanded ? (
              <div id={`${uid}-details`} className="space-y-4">
                <Keywords result={result} resolveJump={resolveJump} />

                {groups.info.length > 0 ? (
                  <ul className="space-y-1.5">
                    {groups.info.map((check) => (
                      <CheckItem key={check.id} check={check} className="bg-muted/[0.03]" />
                    ))}
                  </ul>
                ) : null}

                <div>
                  <div role="tablist" aria-label="Checks" className="grid grid-cols-4 gap-1 rounded-lg bg-muted/[0.07] p-1">
                    {(Object.keys(BUCKET_LABELS) as Bucket[]).map((key, index, keys) => {
                      const selected = key === shown;
                      return (
                        <button
                          key={key}
                          type="button"
                          role="tab"
                          id={`${uid}-tab-${key}`}
                          aria-selected={selected}
                          aria-controls={`${uid}-panel`}
                          tabIndex={selected ? 0 : -1}
                          onClick={() => setBucket(key)}
                          onKeyDown={(event) => {
                            if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
                            event.preventDefault();
                            const next =
                              keys[(index + (event.key === 'ArrowRight' ? 1 : keys.length - 1)) % keys.length]!;
                            setBucket(next);
                            document.getElementById(`${uid}-tab-${next}`)?.focus();
                          }}
                          className={cn(
                            'flex min-w-0 flex-col items-center rounded-md px-0.5 py-1.5 transition-colors',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
                            selected ? 'bg-surface shadow-sm' : 'hover:bg-surface/60',
                          )}
                        >
                          <span className="text-sm font-semibold tabular-nums text-content">
                            {groups[key].length}
                          </span>
                          <span
                            className={cn(
                              'w-full text-[0.625rem] leading-tight tracking-tight',
                              selected ? 'font-medium text-content' : 'text-muted',
                            )}
                          >
                            {BUCKET_LABELS[key]}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  <div
                    role="tabpanel"
                    id={`${uid}-panel`}
                    aria-labelledby={`${uid}-tab-${shown}`}
                    className="mt-3"
                  >
                    {groups[shown].length === 0 ? (
                      <p className="rounded-lg bg-muted/[0.04] px-3 py-3 text-center text-xs text-muted">
                        {BUCKET_EMPTY[shown]}
                      </p>
                    ) : (
                      <ul className="space-y-2">
                        {groups[shown].map((check) => (
                          <CheckItem
                            key={check.id}
                            check={check}
                            action={<JumpButton check={check} resolveJump={resolveJump} />}
                          />
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </div>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline pt-3">
              <p className="min-w-0 flex-1 text-[0.6875rem] leading-relaxed text-muted">
                Internal indicators from this site&rsquo;s content and settings — not scores issued by
                Google or any AI platform.
              </p>
              {entity ? (
                <Link
                  href={auditHref(entity)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-brand hover:underline"
                >
                  Full analysis
                  <ExternalLink className="h-3 w-3" aria-hidden="true" />
                  <span className="sr-only">(opens in a new tab)</span>
                </Link>
              ) : null}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function Count({ value, one, many, tone }: { value: number; one: string; many: string; tone: string }) {
  return (
    <span>
      <span className={cn('font-semibold tabular-nums', value > 0 ? tone : 'text-content')}>{value}</span>{' '}
      {value === 1 ? one : many}
    </span>
  );
}

function Notices({ result }: { result: SeoAuditResult }) {
  const notices: Array<{ key: string; icon: React.ReactNode; text: string }> = [];
  if (result.flags.intentionallyExcluded) {
    notices.push({
      key: 'noindex',
      icon: <EyeOff className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />,
      text: 'Hidden from search engines (noindex). It is scored for reference only: noindex is never counted against it, and it is left out of the site score.',
    });
  }
  if (!result.flags.live) {
    notices.push({
      key: 'not-live',
      icon: <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />,
      text: 'Not live yet. The score shows how it will perform once visitors can see it, and it counts towards the site score from then on.',
    });
  }
  if (notices.length === 0) return null;
  return (
    <ul className="space-y-1.5">
      {notices.map((notice) => (
        <li
          key={notice.key}
          className="flex items-start gap-2 rounded-lg bg-sky-50 px-3 py-2 text-xs leading-relaxed text-sky-900"
        >
          {notice.icon}
          <span>{notice.text}</span>
        </li>
      ))}
    </ul>
  );
}

const PLACEMENT_ORDER: KeywordPlacement[] = [
  'title',
  'description',
  'url',
  'h1',
  'firstParagraph',
  'headings',
  'body',
  'imageAlt',
];

function Keywords({
  result,
  resolveJump,
}: {
  result: SeoAuditResult;
  resolveJump?: SeoJumpResolver;
}) {
  const jump = resolveJump?.({ field: 'primaryKeyword1', area: 'seo' }) ?? null;
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">Primary keywords</h4>
        {jump ? (
          <button type="button" onClick={jump.run} className="text-xs font-medium text-brand hover:underline">
            Edit keywords
          </button>
        ) : null}
      </div>
      {result.keywords.length === 0 ? (
        <p className="mt-1.5 text-xs leading-relaxed text-muted">
          None set. Add up to three searches this page should answer, and SEO Intelligence will check
          where each one appears.
        </p>
      ) : (
        <ul className="mt-1.5 space-y-2">
          {result.keywords.map((keyword) => {
            const found = PLACEMENT_ORDER.filter((placement) => keyword.placements[placement] === true);
            return (
              <li key={keyword.position} className="text-xs">
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 break-words font-medium text-content">
                    <span className="sr-only">Keyword {keyword.position}: </span>
                    {keyword.keyword}
                  </span>
                  <span
                    className={cn(
                      'shrink-0 rounded-full px-2 py-0.5 text-[0.6875rem] font-medium ring-1 ring-inset',
                      KEYWORD_TONES[keyword.status],
                    )}
                  >
                    {KEYWORD_STATUS_LABELS[keyword.status]}
                  </span>
                </div>
                <p className="mt-0.5 text-[0.6875rem] leading-relaxed text-muted">
                  {found.length > 0
                    ? `In ${found.map((placement) => KEYWORD_PLACEMENT_LABELS[placement].toLowerCase()).join(', ')}`
                    : 'Not found on the page'}
                  {keyword.occurrences > 0
                    ? ` · ${keyword.occurrences} ${keyword.occurrences === 1 ? 'use' : 'uses'} (${keyword.density}%)`
                    : ''}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function JumpButton({ check, resolveJump }: { check: CheckResult; resolveJump?: SeoJumpResolver }) {
  const jump = check.target && resolveJump ? resolveJump(check.target) : null;
  if (!jump) return null;
  return (
    <button
      type="button"
      onClick={jump.run}
      className="text-xs font-medium text-brand hover:underline"
      aria-label={`${jump.label}: ${check.label}`}
    >
      {jump.label}
    </button>
  );
}

function PanelSkeleton() {
  return (
    <div className="flex animate-pulse items-center gap-4" aria-hidden="true">
      <div className="h-24 w-24 rounded-full bg-muted/10" />
      <div className="flex-1 space-y-3">
        <div className="h-3 rounded bg-muted/10" />
        <div className="h-3 rounded bg-muted/10" />
        <div className="h-3 rounded bg-muted/10" />
      </div>
    </div>
  );
}

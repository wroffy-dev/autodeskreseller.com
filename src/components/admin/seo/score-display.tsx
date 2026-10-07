import * as React from 'react';
import { cn } from '@/lib/utils/cn';
import { SCORE_STATE_LABELS, scoreState, type ScoreState } from '@/lib/seo/score-state';

/**
 * How a 0–100 score is drawn, everywhere SEO Intelligence shows one.
 *
 * The number is always written out and the state is always named in words —
 * Poor, Needs improvement, Good, Excellent — so colour only reinforces what
 * the text already says.
 */

export const SCORE_TONES: Record<
  ScoreState,
  { text: string; soft: string; stroke: string; bar: string }
> = {
  poor: {
    text: 'text-red-700',
    soft: 'bg-red-50 text-red-700 ring-red-600/20',
    stroke: 'stroke-red-500',
    bar: 'bg-red-500',
  },
  'needs-improvement': {
    text: 'text-amber-700',
    soft: 'bg-amber-50 text-amber-800 ring-amber-600/20',
    stroke: 'stroke-amber-500',
    bar: 'bg-amber-500',
  },
  good: {
    text: 'text-lime-700',
    soft: 'bg-lime-50 text-lime-800 ring-lime-600/20',
    stroke: 'stroke-lime-600',
    bar: 'bg-lime-600',
  },
  excellent: {
    text: 'text-emerald-700',
    soft: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
    stroke: 'stroke-emerald-600',
    bar: 'bg-emerald-600',
  },
};

export const DIMENSION_NAMES = {
  seo: { short: 'SEO', long: 'Search engine optimisation' },
  aeo: { short: 'AEO', long: 'Answer-engine readiness (internal assessment)' },
  geo: { short: 'GEO', long: 'Generative-engine readiness (internal assessment)' },
} as const;

/** A score in a ring, with its state named underneath. */
export function ScoreRing({
  score,
  label,
  size = 'md',
  className,
}: {
  score: number;
  label: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const state = scoreState(score);
  const tone = SCORE_TONES[state];
  const radius = 28;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.min(100, Math.max(0, score)) / 100);

  return (
    <div className={cn('flex flex-col items-center gap-0.5 text-center', className)}>
      <div
        className="relative"
        role="img"
        aria-label={`${label}: ${score} out of 100, ${SCORE_STATE_LABELS[state]}`}
      >
        <svg
          viewBox="0 0 64 64"
          aria-hidden="true"
          className={cn(size === 'lg' ? 'h-24 w-24' : size === 'sm' ? 'h-12 w-12' : 'h-16 w-16')}
        >
          <circle cx="32" cy="32" r={radius} className="fill-none stroke-muted/15" strokeWidth="6" />
          <circle
            cx="32"
            cy="32"
            r={radius}
            className={cn('fill-none transition-[stroke-dashoffset] duration-500', tone.stroke)}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            transform="rotate(-90 32 32)"
          />
        </svg>
        <span
          aria-hidden="true"
          className={cn(
            'absolute inset-0 flex items-center justify-center font-heading font-bold tabular-nums text-content',
            size === 'lg' ? 'text-2xl' : size === 'sm' ? 'text-sm' : 'text-lg',
          )}
        >
          {score}
        </span>
      </div>
      <p className="text-xs font-medium text-content" aria-hidden="true">
        {label}
      </p>
      <p className={cn('text-[0.6875rem] font-medium', tone.text)} aria-hidden="true">
        {SCORE_STATE_LABELS[state]}
      </p>
    </div>
  );
}

/** A labelled bar: "SEO 72 · Good". */
export function ScoreMeter({
  dimension,
  score,
  className,
}: {
  dimension: keyof typeof DIMENSION_NAMES;
  score: number;
  className?: string;
}) {
  const state = scoreState(score);
  const tone = SCORE_TONES[state];
  const name = DIMENSION_NAMES[dimension];
  return (
    <div className={className}>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <abbr title={name.long} className="font-medium text-content no-underline">
          {name.short}
        </abbr>
        <span className="shrink-0 tabular-nums">
          <span className={cn('font-semibold', tone.text)}>{score}</span>
          <span className="text-muted"> · {SCORE_STATE_LABELS[state]}</span>
        </span>
      </div>
      <div
        className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted/15"
        role="meter"
        aria-label={`${name.long} score`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={score}
        aria-valuetext={`${score} out of 100, ${SCORE_STATE_LABELS[state]}`}
      >
        <div
          className={cn('h-full rounded-full transition-[width] duration-500', tone.bar)}
          style={{ width: `${Math.min(100, Math.max(0, score))}%` }}
        />
      </div>
    </div>
  );
}

/** A compact pill: the number and its state, for tables and headers. */
export function ScoreBadge({
  score,
  label,
  showState = true,
  className,
}: {
  score: number;
  /** Read out before the number, e.g. "Overall". */
  label?: string;
  showState?: boolean;
  className?: string;
}) {
  const state = scoreState(score);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        SCORE_TONES[state].soft,
        className,
      )}
    >
      {label ? <span className="sr-only">{label}: </span> : null}
      <span className="font-semibold tabular-nums">{score}</span>
      {showState ? (
        <span>· {SCORE_STATE_LABELS[state]}</span>
      ) : (
        <span className="sr-only">, {SCORE_STATE_LABELS[state]}</span>
      )}
    </span>
  );
}

/** A bare number in its state's colour, for dense tables; the state is read out. */
export function ScoreNumber({ score, className }: { score: number; className?: string }) {
  const state = scoreState(score);
  return (
    <span className={cn('font-semibold tabular-nums', SCORE_TONES[state].text, className)}>
      {score}
      <span className="sr-only"> ({SCORE_STATE_LABELS[state]})</span>
    </span>
  );
}

/** The key to the four states, for screens that use bare numbers. */
export function ScoreLegend({ className }: { className?: string }) {
  const rows: Array<{ state: ScoreState; range: string }> = [
    { state: 'poor', range: '0–39' },
    { state: 'needs-improvement', range: '40–59' },
    { state: 'good', range: '60–79' },
    { state: 'excellent', range: '80–100' },
  ];
  return (
    <ul className={cn('flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted', className)}>
      {rows.map((row) => (
        <li key={row.state} className="flex items-center gap-1.5">
          <span aria-hidden="true" className={cn('h-2 w-2 rounded-full', SCORE_TONES[row.state].bar)} />
          <span>
            <span className="font-medium text-content">{SCORE_STATE_LABELS[row.state]}</span> {row.range}
          </span>
        </li>
      ))}
    </ul>
  );
}

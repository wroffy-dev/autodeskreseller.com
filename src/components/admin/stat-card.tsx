import Link from 'next/link';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { formatNumber } from '@/lib/utils/format';
import { NavIcon } from './nav-icon';

export type StatTone = 'default' | 'brand' | 'success' | 'danger' | 'warning';

// Literal class maps: Tailwind only ships class names it can read in full.
const VALUE_TONE: Record<StatTone, string> = {
  default: 'text-content',
  brand: 'text-brand',
  success: 'text-emerald-600',
  danger: 'text-red-600',
  warning: 'text-amber-600',
};

const ICON_TONE: Record<StatTone, string> = {
  default: 'bg-muted/10 text-muted',
  brand: 'bg-brand/10 text-brand',
  success: 'bg-emerald-50 text-emerald-600',
  danger: 'bg-red-50 text-red-600',
  warning: 'bg-amber-50 text-amber-600',
};

const SPARK_TONE: Record<StatTone, string> = {
  default: 'text-muted',
  brand: 'text-brand',
  success: 'text-emerald-500',
  danger: 'text-red-400',
  warning: 'text-amber-500',
};

/**
 * KPI tile.
 *
 * Deliberately restrained: one number, one label, an optional supporting line,
 * trend and sparkline. Colour is reserved for values that carry meaning (won,
 * lost) so the eye is drawn to something real rather than to decoration.
 */
export function StatCard({
  label,
  value,
  hint,
  href,
  icon,
  tone = 'default',
  trend,
  invertTrend = false,
  sparkline,
  className,
}: {
  label: string;
  value: number | string;
  hint?: string;
  href?: string;
  /** NavIcon key. */
  icon?: string;
  tone?: StatTone;
  /** Change against the previous period, in percent (12 means +12%). */
  trend?: number | null;
  /** For "bad when up" metrics such as lost leads: a rise reads as negative. */
  invertTrend?: boolean;
  /** Recent values, oldest first, drawn as a small line under the value. */
  sparkline?: number[];
  className?: string;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 truncate pt-0.5 text-[0.6875rem] font-semibold uppercase tracking-wider text-muted">
          {label}
        </p>
        {icon ? (
          <span
            className={cn(
              'flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px]',
              ICON_TONE[tone],
            )}
          >
            <NavIcon name={icon} className="h-4 w-4" />
          </span>
        ) : null}
      </div>

      <div className="mt-2 flex items-end justify-between gap-3">
        <p
          className={cn(
            'min-w-0 truncate text-[1.625rem] font-semibold leading-tight tracking-tight tabular-nums sm:text-[1.75rem]',
            VALUE_TONE[tone],
          )}
        >
          {typeof value === 'number' ? formatNumber(value) : value}
        </p>
        {sparkline && sparkline.length > 1 ? (
          <Sparkline values={sparkline} className={cn('mb-1.5 shrink-0', SPARK_TONE[tone])} />
        ) : null}
      </div>

      <div className="mt-1.5 flex min-w-0 items-center gap-1.5">
        {trend !== undefined && trend !== null ? (
          <TrendChip value={trend} invert={invertTrend} />
        ) : null}
        {hint ? <p className="min-w-0 truncate text-xs text-muted">{hint}</p> : null}
        {href ? (
          <ArrowUpRight
            className="ml-auto h-3.5 w-3.5 shrink-0 text-muted opacity-0 transition-opacity group-hover:opacity-100"
            aria-hidden="true"
          />
        ) : null}
      </div>
    </>
  );

  const shell = cn(
    'glass-card group flex h-full min-w-0 flex-col rounded-xl border border-hairline bg-surface p-4 sm:p-5',
    'stat-card',
    className,
  );

  if (href) {
    return (
      <Link
        href={href}
        className={cn(
          shell,
          'transition-[transform,box-shadow,border-color] duration-200 ease-out hover:-translate-y-px hover:border-brand/30',
        )}
      >
        {body}
      </Link>
    );
  }
  return <div className={shell}>{body}</div>;
}

/**
 * Change against the previous period. Always shows an arrow and a sign, so the
 * direction never depends on colour alone.
 */
export function TrendChip({ value, invert = false }: { value: number; invert?: boolean }) {
  const rounded = Math.round(value * 10) / 10;
  const flat = rounded === 0;
  const good = flat ? null : invert ? rounded < 0 : rounded > 0;
  const Icon = flat ? Minus : rounded > 0 ? ArrowUpRight : ArrowDownRight;
  const sign = rounded > 0 ? '+' : rounded < 0 ? '−' : '±';

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[0.6875rem] font-semibold tabular-nums',
        good === null
          ? 'bg-muted/10 text-muted'
          : good
            ? 'bg-emerald-50 text-emerald-700'
            : 'bg-red-50 text-red-700',
      )}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      {sign}
      {Math.abs(rounded)}%
      <span className="sr-only">
        {flat ? ' unchanged' : good ? ' (improving)' : ' (worsening)'} on the previous period
      </span>
    </span>
  );
}

/** A 72px line of recent values. Decorative: the number beside it is the data. */
export function Sparkline({ values, className }: { values: number[]; className?: string }) {
  const width = 72;
  const height = 24;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const step = width / (values.length - 1);
  const points = values
    .map(
      (v, i) =>
        `${(i * step).toFixed(1)},${(height - 2 - ((v - min) / span) * (height - 4)).toFixed(1)}`,
    )
    .join(' ');

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

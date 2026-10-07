import * as React from 'react';
import { AlertTriangle, CheckCircle2, Info, Lightbulb, MinusCircle, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { checkBucket } from '@/lib/seo/score-state';
import type { CheckResult } from '@/lib/seo/types';
import { DIMENSION_NAMES } from './score-display';

/**
 * One check, as an editor reads it: what was checked, what was found, how to
 * fix it and what it costs. Used by the editor panels and the full audit.
 */

const BUCKETS = {
  critical: { label: 'Critical issue', Icon: XCircle, tone: 'text-red-600' },
  warning: { label: 'Warning', Icon: AlertTriangle, tone: 'text-amber-600' },
  suggestion: { label: 'Suggestion', Icon: Lightbulb, tone: 'text-sky-600' },
  passed: { label: 'Passed', Icon: CheckCircle2, tone: 'text-emerald-600' },
  info: { label: 'Information', Icon: Info, tone: 'text-muted' },
  na: { label: 'Not applicable', Icon: MinusCircle, tone: 'text-muted' },
} as const;

export function checkStatusLabel(check: Pick<CheckResult, 'status' | 'severity'>): string {
  return BUCKETS[checkBucket(check)].label;
}

export function CheckStatusIcon({
  check,
  className,
}: {
  check: Pick<CheckResult, 'status' | 'severity'>;
  className?: string;
}) {
  const bucket = BUCKETS[checkBucket(check)];
  return (
    <>
      <bucket.Icon className={cn('h-4 w-4 shrink-0', bucket.tone, className)} aria-hidden="true" />
      <span className="sr-only">{bucket.label}: </span>
    </>
  );
}

export function CheckItem({
  check,
  action,
  showDimension = true,
  className,
}: {
  check: CheckResult;
  /** A way to fix it: a "Go to field" button, an edit link. */
  action?: React.ReactNode;
  showDimension?: boolean;
  className?: string;
}) {
  const lost = Math.round((check.pointsAvailable - check.pointsEarned) * 10) / 10;
  const scored = check.pointsAvailable > 0;
  return (
    <li className={cn('rounded-lg border border-hairline bg-surface p-3', className)}>
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex">
          <CheckStatusIcon check={check} />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <p className="text-sm font-medium text-content">{check.label}</p>
            {showDimension ? (
              <abbr
                title={DIMENSION_NAMES[check.dimension].long}
                className="rounded bg-muted/10 px-1.5 text-[0.625rem] font-semibold uppercase tracking-wide text-muted no-underline"
              >
                {DIMENSION_NAMES[check.dimension].short}
              </abbr>
            ) : null}
          </div>
          <p className="break-words text-xs leading-relaxed text-muted">{check.message}</p>
          {check.recommendation ? (
            <p className="break-words text-xs leading-relaxed text-content">
              <span className="font-medium">How to fix: </span>
              {check.recommendation}
            </p>
          ) : null}
          {(scored && check.status !== 'PASS') || action ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5">
              {scored && check.status !== 'PASS' ? (
                <span className="text-[0.6875rem] text-muted">
                  {lost > 0
                    ? `${lost} of ${check.pointsAvailable} points lost`
                    : `${check.pointsAvailable} points`}
                </span>
              ) : null}
              {action}
            </div>
          ) : null}
        </div>
      </div>
    </li>
  );
}

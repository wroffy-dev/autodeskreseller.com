'use client';

import { Check, CircleAlert, Loader2, Dot } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { useUnsavedChanges } from '@/lib/admin/unsaved-changes';

export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

/**
 * Tells the admin, in one glance, whether their work is safe.
 *
 * "Unsaved changes" is deliberately the loudest state: losing edits is the
 * failure that actually costs an admin time.
 */
export function SaveStateIndicator({
  state,
  errorMessage,
  className,
}: {
  state: SaveState;
  errorMessage?: string;
  className?: string;
}) {
  // Lets the topbar search ask before leaving a screen with unsaved work.
  useUnsavedChanges(state === 'dirty');

  if (state === 'idle') return null;

  const config = {
    dirty: {
      icon: <Dot className="h-5 w-5 fill-amber-500 text-amber-500" aria-hidden="true" />,
      label: 'Unsaved changes',
      tone: 'text-amber-600',
    },
    saving: {
      icon: <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />,
      label: 'Saving…',
      tone: 'text-muted',
    },
    saved: {
      icon: <Check className="h-3.5 w-3.5" aria-hidden="true" />,
      label: 'Saved',
      tone: 'text-emerald-600',
    },
    error: {
      icon: <CircleAlert className="h-3.5 w-3.5" aria-hidden="true" />,
      label: errorMessage || 'Save failed',
      tone: 'text-red-600',
    },
  }[state];

  return (
    <span
      role="status"
      aria-live="polite"
      className={cn('inline-flex items-center gap-1 text-xs font-medium', config.tone, className)}
    >
      {config.icon}
      {config.label}
    </span>
  );
}

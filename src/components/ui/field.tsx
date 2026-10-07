import * as React from 'react';
import { cn } from '@/lib/utils/cn';
import { announceEdit } from '@/lib/admin/unsaved-changes';
import { settleToggle, type ToggleSave } from '@/lib/ui/persisted-toggle';

export { settleToggle, type ToggleSave };

export const inputClasses =
  'ui-control w-full rounded-lg border border-hairline bg-surface px-3 py-2 text-sm text-content shadow-sm ' +
  'placeholder:text-muted/60 transition-colors ' +
  'focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25 ' +
  'disabled:cursor-not-allowed disabled:bg-muted/5 disabled:text-muted ' +
  'aria-[invalid=true]:border-red-500 aria-[invalid=true]:ring-red-500/20';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cn(inputClasses, 'h-10', className)} {...props} />;
  },
);

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, rows = 4, ...props }, ref) {
  return <textarea ref={ref} rows={rows} className={cn(inputClasses, 'resize-y', className)} {...props} />;
});

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(function Select({ className, ...props }, ref) {
  return (
    <select
      ref={ref}
      className={cn(inputClasses, 'h-10 appearance-none bg-[length:16px] pr-9', className)}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%235B6B85' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\")",
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right 0.6rem center',
      }}
      {...props}
    />
  );
});

export function Label({
  className,
  required,
  children,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement> & { required?: boolean }) {
  return (
    <label className={cn('block text-sm font-medium text-content', className)} {...props}>
      {children}
      {required ? (
        <span className="ml-0.5 text-red-600" aria-hidden="true">
          *
        </span>
      ) : null}
    </label>
  );
}

export function FieldError({ messages }: { messages?: string[] | string | null }) {
  if (!messages || (Array.isArray(messages) && messages.length === 0)) return null;
  const list = Array.isArray(messages) ? messages : [messages];
  return (
    <p className="mt-1 text-xs font-medium text-red-600" role="alert">
      {list.join(' ')}
    </p>
  );
}

export function Field({
  id,
  label,
  htmlFor,
  required,
  hint,
  error,
  className,
  children,
}: {
  /** For a field with no single input (a media picker), so it can be scrolled to. */
  id?: string;
  label?: string;
  htmlFor?: string;
  required?: boolean;
  hint?: React.ReactNode;
  error?: string[] | string | null;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div id={id} className={cn('space-y-1.5', className)}>
      {label ? (
        <Label htmlFor={htmlFor} required={required}>
          {label}
        </Label>
      ) : null}
      {children}
      {hint && !error ? <p className="text-xs text-muted">{hint}</p> : null}
      <FieldError messages={error} />
    </div>
  );
}

export function Checkbox({
  className,
  label,
  hint,
  id,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label?: React.ReactNode; hint?: string }) {
  // useId must run on every render, so it cannot sit behind a ?? short-circuit.
  const generatedId = React.useId();
  const inputId = id ?? generatedId;
  return (
    <div className="flex items-start gap-2.5">
      <input
        id={inputId}
        type="checkbox"
        className={cn(
          'mt-0.5 h-4 w-4 shrink-0 rounded border-hairline text-brand',
          'focus:ring-2 focus:ring-brand/30 focus:ring-offset-0',
          className,
        )}
        {...props}
      />
      {label ? (
        <div className="min-w-0">
          <label htmlFor={inputId} className="cursor-pointer text-sm text-content">
            {label}
          </label>
          {hint ? <p className="text-xs text-muted">{hint}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The one on/off control for binary settings — enabled, visible, indexed.
 *
 * A labelled `role="switch"` button: the visible label is its accessible name
 * (and clicking it toggles), the hint and any error are its description, and
 * an invisible margin gives it a 44px touch target without changing layout.
 *
 * It only reports the change. A switch inside a save-on-submit form stays a
 * form field, carried by `name` as "true"/"false"; a switch that saves on its
 * own uses `usePersistedToggle` for its pending and failure states.
 */
export function Switch({
  id,
  checked,
  onChange,
  label,
  hint,
  name,
  disabled,
  pending,
  error,
  size = 'md',
  className,
}: {
  id?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: React.ReactNode;
  hint?: string;
  name?: string;
  disabled?: boolean;
  /** A save is in flight: shows a spinner in the knob and blocks input. */
  pending?: boolean;
  /** Why the last change failed. Shown under the label. */
  error?: string | null;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const generatedId = React.useId();
  const switchId = id ?? generatedId;
  const labelId = `${switchId}-label`;
  const hintId = `${switchId}-hint`;
  const errorId = `${switchId}-error`;
  const inert = disabled || pending;
  const small = size === 'sm';

  return (
    <div className={cn('ui-switch-row flex items-start justify-between gap-4', className)}>
      {label ? (
        <div className="min-w-0">
          <label
            id={labelId}
            htmlFor={switchId}
            className={cn('text-sm font-medium text-content', inert ? 'cursor-default' : 'cursor-pointer')}
          >
            {label}
          </label>
          {hint ? (
            <p id={hintId} className="text-xs text-muted">
              {hint}
            </p>
          ) : null}
          {error ? (
            <p id={errorId} role="alert" className="mt-0.5 text-xs font-medium text-red-600">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
      <button
        id={switchId}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={label ? labelId : undefined}
        aria-describedby={cn(hint && label && hintId, error && label && errorId) || undefined}
        aria-busy={pending || undefined}
        aria-invalid={error ? true : undefined}
        disabled={disabled}
        aria-disabled={pending || undefined}
        data-state={checked ? 'on' : 'off'}
        onClick={(event) => {
          if (inert) return;
          announceEdit(event.currentTarget);
          onChange(!checked);
        }}
        className={cn(
          'ui-switch relative inline-flex shrink-0 items-center rounded-full',
          // Larger, invisible hit area for touch.
          'before:absolute before:-inset-x-1 before:-inset-y-2.5 before:content-[""]',
          'transition-colors duration-200 ease-out',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2',
          small ? 'h-5 w-9' : 'h-6 w-11',
          checked ? 'bg-brand' : 'bg-muted/30',
          error && 'ring-2 ring-red-500/60 ring-offset-1',
          disabled && 'cursor-not-allowed opacity-50',
          pending && 'cursor-progress',
        )}
      >
        <span
          className={cn(
            // The knob stays white in the admin's dark theme too.
            'ui-switch-knob pointer-events-none absolute left-0.5 flex items-center justify-center rounded-full bg-white shadow transition-transform duration-200 ease-out',
            small ? 'h-4 w-4' : 'h-5 w-5',
            checked ? (small ? 'translate-x-4' : 'translate-x-5') : 'translate-x-0',
          )}
        >
          {pending ? (
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 animate-spin rounded-full border-[1.5px] border-neutral-300 border-t-neutral-600"
            />
          ) : null}
        </span>
        <span className="sr-only">{pending ? 'Saving' : null}</span>
      </button>
      {name ? <input type="hidden" name={name} value={checked ? 'true' : 'false'} /> : null}
    </div>
  );
}

/**
 * State for a switch that saves the moment it is flipped.
 *
 * Shows the new position straight away, blocks a second flip while the save
 * is in flight, and on failure puts the switch back where the server says it
 * is and reports why — so the switch never claims a state that was not saved.
 * `save` resolves to the stored value (or `{ ok: false, error }`).
 */
export function usePersistedToggle(serverValue: boolean, save: ToggleSave) {
  const [checked, setChecked] = React.useState(serverValue);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Follow the server once a save settles or the row is refreshed.
  React.useEffect(() => {
    if (!pending) setChecked(serverValue);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new server value resyncs
  }, [serverValue]);

  const toggle = React.useCallback(
    async (next: boolean) => {
      if (pending) return;
      const previous = checked;
      setChecked(next);
      setPending(true);
      setError(null);
      const settled = await settleToggle(previous, next, save);
      setChecked(settled.checked);
      setError(settled.error);
      setPending(false);
    },
    [checked, pending, save],
  );

  return { checked, pending, error, toggle };
}

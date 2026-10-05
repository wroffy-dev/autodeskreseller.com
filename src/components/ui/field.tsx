import * as React from 'react';
import { cn } from '@/lib/utils/cn';

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
  label,
  htmlFor,
  required,
  hint,
  error,
  className,
  children,
}: {
  label?: string;
  htmlFor?: string;
  required?: boolean;
  hint?: React.ReactNode;
  error?: string[] | string | null;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
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

export function Switch({
  checked,
  onChange,
  label,
  hint,
  name,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: React.ReactNode;
  hint?: string;
  name?: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      {label ? (
        <div className="min-w-0">
          <span className="text-sm font-medium text-content">{label}</span>
          {hint ? <p className="text-xs text-muted">{hint}</p> : null}
        </div>
      ) : null}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={typeof label === 'string' ? label : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2',
          checked ? 'bg-brand' : 'bg-muted/30',
          disabled && 'cursor-not-allowed opacity-50',
        )}
      >
        <span
          className={cn(
            // The knob stays white in the admin's dark theme too.
            'ui-switch-knob pointer-events-none absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-[1.375rem]' : 'translate-x-0.5',
          )}
        />
      </button>
      {name ? <input type="hidden" name={name} value={checked ? 'true' : 'false'} /> : null}
    </div>
  );
}

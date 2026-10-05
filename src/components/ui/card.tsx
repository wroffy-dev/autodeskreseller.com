import * as React from 'react';
import { cn } from '@/lib/utils/cn';

export function Card({
  className,
  glass = false,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  /**
   * Liquid Glass surface, for overview screens that paint a colour wash
   * behind their content (the admin dashboard). Solid by default: dense work
   * areas stay solid and readable.
   */
  glass?: boolean;
}) {
  return (
    <div
      className={cn(
        'ui-card rounded-xl border border-hairline bg-surface shadow-sm',
        glass && 'glass-panel',
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({
  title,
  description,
  actions,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 border-b border-hairline px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5',
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="truncate text-base font-semibold tracking-tight text-content">{title}</h2>
        {description ? <p className="mt-0.5 text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function CardBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-4 sm:p-5', className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-end gap-2 border-t border-hairline bg-muted/[0.03] px-4 py-3 sm:px-5',
        className,
      )}
      {...props}
    />
  );
}

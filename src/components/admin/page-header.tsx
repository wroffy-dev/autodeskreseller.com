import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

/**
 * Retained so existing callers keep compiling. Breadcrumbs are now derived from
 * ADMIN_NAV and rendered once in the top bar, so no page hand-maintains a trail.
 */
export type Crumb = { label: string; href?: string };

/**
 * The standard heading for every admin screen: what this page is, one line on
 * what it does, and its primary actions. Consistent here means consistent
 * everywhere, so pages should not roll their own heading markup.
 */
export function AdminPageHeader({
  title,
  description,
  actions,
  status,
  backHref,
  backLabel = 'Back',
  className,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  /** Badges shown beside the title (draft/published, active/inactive). */
  status?: React.ReactNode;
  /** Shown above the title on detail screens. */
  backHref?: string;
  backLabel?: string;
  /** Accepted for backwards compatibility; the top bar renders the trail. */
  crumbs?: Crumb[];
  className?: string;
}) {
  return (
    <div className={cn('mb-6', className)}>
      {backHref ? (
        <Link
          href={backHref}
          className="mb-3 inline-flex items-center gap-1.5 rounded-md text-xs font-medium text-muted transition-colors hover:text-content"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          {backLabel}
        </Link>
      ) : null}

      {/* The title keeps a readable width; when the actions do not fit beside
          it they wrap underneath instead of squeezing it. */}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 flex-[1_1_20rem]">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <h1 className="font-heading text-2xl font-bold tracking-tight text-content sm:text-[1.875rem] sm:leading-tight">
              {title}
            </h1>
            {status ? <div className="flex flex-wrap items-center gap-1.5">{status}</div> : null}
          </div>
          {description ? (
            <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted sm:text-[0.9375rem]">
              {description}
            </p>
          ) : null}
        </div>

        {actions ? (
          <div className="flex max-w-full flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
    </div>
  );
}

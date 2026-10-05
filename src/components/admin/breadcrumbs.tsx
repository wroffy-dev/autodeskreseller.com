'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { ChevronRight } from 'lucide-react';
import { locateRoute } from '@/lib/admin/nav';
import { cn } from '@/lib/utils/cn';

/**
 * Breadcrumbs derived from the navigation tree.
 *
 * Rendered only inside the admin's top bar, so the colours are the shell's
 * rather than the page's: the muted nav foreground for the trail, the full one
 * for the page you are on.
 *
 * Because the trail comes from ADMIN_NAV, a page never has to restate where it
 * lives — moving an item between modules updates every breadcrumb for free.
 * `leaf` names the current record on a detail route (a page title, a lead name).
 */
export function AdminBreadcrumbs({ leaf, className }: { leaf?: string; className?: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const located = locateRoute(pathname, searchParams.toString());

  if (!located) return null;

  const { group, item } = located;
  const onIndex = Boolean(item) && !leaf;

  const trail: Array<{ label: string; href?: string }> = [];
  if (group.href !== '/admin') trail.push({ label: group.label });
  if (item) trail.push({ label: item.label, href: onIndex ? undefined : item.href });
  if (leaf) trail.push({ label: leaf });

  if (trail.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" className={cn('min-w-0', className)}>
      <ol className="flex flex-wrap items-center gap-1.5 text-xs text-admin-nav/60">
        <li>
          <Link
            href="/admin"
            className="admin-focus admin-focus-header rounded transition-colors hover:text-admin-nav"
          >
            Admin
          </Link>
        </li>
        {trail.map((crumb, index) => {
          const last = index === trail.length - 1;
          return (
            <li key={`${crumb.label}-${index}`} className="flex min-w-0 items-center gap-1.5">
              <ChevronRight className="h-3 w-3 shrink-0 opacity-60" aria-hidden="true" />
              {crumb.href && !last ? (
                <Link
                  href={crumb.href}
                  className="admin-focus admin-focus-header truncate rounded transition-colors hover:text-admin-nav"
                >
                  {crumb.label}
                </Link>
              ) : (
                <span
                  {...(last ? { 'aria-current': 'page' as const } : {})}
                  className={cn('truncate', last && 'font-medium text-admin-nav')}
                >
                  {crumb.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

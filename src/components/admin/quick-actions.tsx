import Link from 'next/link';
import { FileText, Package, ClipboardList, UserPlus, ImagePlus, Globe } from 'lucide-react';
import type { PermissionKey } from '@/lib/auth/permissions';
import { cn } from '@/lib/utils/cn';

type Action = {
  label: string;
  href: string;
  icon: React.ReactNode;
  permission?: PermissionKey;
  external?: boolean;
};

/**
 * The handful of things an admin starts most sessions by doing.
 *
 * Each is permission-gated, so a sales user never sees a button that would
 * bounce them off a page they cannot open.
 */
export function QuickActions({ can }: { can: (permission: PermissionKey) => boolean }) {
  const actions: Action[] = [
    {
      label: 'Create page',
      href: '/admin/pages/new',
      icon: <FileText className="h-4 w-4" />,
      permission: 'pages.create',
    },
    {
      label: 'Create product',
      href: '/admin/products/new',
      icon: <Package className="h-4 w-4" />,
      permission: 'products.create',
    },
    {
      label: 'Create form',
      href: '/admin/forms/new',
      icon: <ClipboardList className="h-4 w-4" />,
      permission: 'forms.create',
    },
    {
      label: 'Add lead',
      href: '/admin/leads/new',
      icon: <UserPlus className="h-4 w-4" />,
      permission: 'leads.create',
    },
    {
      label: 'Upload media',
      href: '/admin/media',
      icon: <ImagePlus className="h-4 w-4" />,
      permission: 'media.upload',
    },
    {
      label: 'View website',
      href: '/',
      icon: <Globe className="h-4 w-4" />,
      external: true,
    },
  ];

  const visible = actions.filter((action) => !action.permission || can(action.permission));
  if (visible.length === 0) return null;

  return (
    <div className="grid grid-cols-2 gap-2">
      {visible.map((action) => (
        <Link
          key={action.href}
          href={action.href}
          {...(action.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
          className={cn(
            // `glass-chip` turns the tile translucent on the dashboard's glass
            // panel; elsewhere it is an ordinary surface tile.
            'glass-chip group flex min-w-0 items-center gap-2.5 rounded-[var(--radius-card-sm)] border border-hairline bg-surface px-3 py-2.5',
            'text-sm font-medium text-content transition-colors',
            'hover:border-brand/40 hover:text-brand',
          )}
        >
          <span className="shrink-0 text-muted transition-colors group-hover:text-brand">
            {action.icon}
          </span>
          <span className="truncate">{action.label}</span>
        </Link>
      ))}
    </div>
  );
}

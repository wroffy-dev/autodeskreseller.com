'use client';

import * as React from 'react';
import { signOut } from 'next-auth/react';
import {
  PanelLeft,
  LogOut,
  ChevronDown,
  Plus,
  ExternalLink,
  User,
  UserCircle,
  ShieldCheck,
} from 'lucide-react';
import { initials } from '@/lib/utils/format';
import type { PermissionKey } from '@/lib/auth/permissions';
import { LOGIN_PATH } from '@/lib/auth/routes';
import { cn } from '@/lib/utils/cn';
import { AdminSearch } from './admin-search';
import { AdminBreadcrumbs } from './breadcrumbs';
import { AdminCountrySwitcher } from './country-switcher';
import { Menu, MenuItem, MenuLabel, MenuSeparator } from '@/components/ui/menu';
import { ThemeMenuItems, ThemeToggle, useAdminTheme } from './theme';
import type { CountryContext } from '@/lib/country/types';

/** Create shortcuts, each gated by the permission its destination requires. */
const QUICK_CREATE: Array<{
  label: string;
  href: string;
  permission: PermissionKey;
}> = [
  { label: 'New page', href: '/admin/pages/new', permission: 'pages.create' },
  {
    label: 'New product',
    href: '/admin/products/new',
    permission: 'products.create',
  },
  { label: 'New form', href: '/admin/forms/new', permission: 'forms.create' },
  { label: 'New lead', href: '/admin/leads/new', permission: 'leads.create' },
  {
    label: 'New blog post',
    href: '/admin/blog/new',
    permission: 'blog.create',
  },
  { label: 'Upload media', href: '/admin/media', permission: 'media.upload' },
];

export function AdminTopbar({
  user,
  permissions,
  isSuperAdmin,
  country,
  countries,
  onOpenSidebar,
}: {
  user: { name: string; email: string; roleName: string; image?: string | null };
  permissions: string[];
  isSuperAdmin: boolean;
  /** The market the admin is currently editing. */
  country: Pick<CountryContext, 'id' | 'code' | 'name'>;
  /** Every market this user may switch to. */
  countries: Array<Pick<CountryContext, 'id' | 'code' | 'name' | 'isDefault'>>;
  onOpenSidebar: () => void;
}) {
  const can = (permission: PermissionKey) => isSuperAdmin || permissions.includes(permission);
  const createOptions = QUICK_CREATE.filter((option) => can(option.permission));

  const { preference, setPreference } = useAdminTheme();

  return (
    // The sticky wrapper fades the workspace colour in behind the floating bar,
    // so content scrolling under it dissolves instead of meeting a hard edge.
    <header className="topbar-fade sticky top-0 z-topbar px-3 pb-3 pt-3 sm:px-4 lg:pl-0 lg:pr-3">
      <div className="relative mx-auto max-w-[100rem] text-admin-nav">
        {/* The glass is a layer behind the bar rather than the bar itself: an
            element with a backdrop filter traps `fixed` descendants (the
            command palette) and blurs only its own box for nested glass (the
            menus), so neither may live inside it. */}
        <div
          aria-hidden="true"
          className="glass-bar pointer-events-none absolute inset-0 rounded-[20px] sm:rounded-[var(--radius-shell)]"
        />

        <div className="relative flex h-14 items-center gap-1.5 px-2 sm:h-16 sm:gap-2 sm:px-3">
          <button
            type="button"
            onClick={onOpenSidebar}
            aria-label="Open navigation"
            title="Open navigation"
            aria-controls="admin-sidebar"
            className="admin-focus flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-admin-nav/70 transition-colors hover:bg-admin-nav/[0.06] hover:text-admin-nav lg:hidden"
          >
            <PanelLeft className="h-5 w-5" />
          </button>

          {/* Breadcrumbs take the space on desktop; search owns it on mobile. */}
          <div className="hidden min-w-0 flex-1 pl-2 lg:block">
            <AdminBreadcrumbs />
          </div>

          <div className="min-w-0 flex-1 lg:max-w-xs lg:flex-none xl:w-80 xl:max-w-none">
            <AdminSearch permissions={permissions} isSuperAdmin={isSuperAdmin} />
          </div>

          <AdminCountrySwitcher current={country} countries={countries} />

          {createOptions.length > 0 ? (
            <Menu
              align="right"
              triggerClassName="admin-focus rounded-[var(--radius-control)]"
              trigger={
                <span
                  className={cn(
                    'inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-control)] px-2.5 text-sm font-medium sm:px-3',
                    'bg-[rgb(var(--primary))] text-[rgb(var(--primary-fg))] shadow-sm transition-colors hover:bg-[rgb(var(--primary)/0.86)]',
                  )}
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  <span className="hidden sm:inline">Create</span>
                  <ChevronDown
                    className="hidden h-3.5 w-3.5 opacity-70 sm:block"
                    aria-hidden="true"
                  />
                </span>
              }
              label="Create new"
            >
              {createOptions.map((option) => (
                <MenuItem key={option.href} href={option.href}>
                  {option.label}
                </MenuItem>
              ))}
            </Menu>
          ) : null}

          {/* On phones the theme choice lives in the profile menu instead. */}
          <div className="hidden sm:block">
            <ThemeToggle />
          </div>

          <a
            href="/"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="View website (opens in a new tab)"
            title="View website"
            className="admin-focus hidden h-9 w-9 shrink-0 items-center justify-center rounded-xl text-admin-nav/70 transition-colors hover:bg-admin-nav/[0.06] hover:text-admin-nav sm:flex"
          >
            <ExternalLink className="h-[1.1rem] w-[1.1rem]" aria-hidden="true" />
          </a>

          <Menu
            align="right"
            label="Account menu"
            triggerClassName="admin-focus rounded-xl"
            trigger={
              <span className="flex items-center gap-2 rounded-xl px-1 py-1 transition-colors hover:bg-admin-nav/[0.06] xl:pr-2">
                {user.image ? (
                  // eslint-disable-next-line @next/next/no-img-element -- storage URL, may be any host
                  <img
                    src={user.image}
                    alt=""
                    className="h-8 w-8 rounded-full object-cover ring-1 ring-admin-nav/10"
                  />
                ) : (
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[rgb(var(--primary))] text-xs font-semibold text-[rgb(var(--primary-fg))]">
                    {initials(user.name)}
                  </span>
                )}
                <span className="hidden text-left xl:block">
                  <span className="block max-w-[9rem] truncate text-sm font-medium leading-tight text-admin-nav">
                    {user.name}
                  </span>
                  <span className="block text-xs leading-tight text-admin-nav/55">
                    {user.roleName}
                  </span>
                </span>
                <ChevronDown
                  className="hidden h-4 w-4 text-admin-nav/50 xl:block"
                  aria-hidden="true"
                />
              </span>
            }
          >
            <div className="border-b border-hairline px-3 py-2.5">
              <p className="truncate text-sm font-medium text-content">{user.name}</p>
              <p className="truncate text-xs text-muted">{user.email}</p>
              <p className="mt-1 text-xs text-muted">{user.roleName}</p>
            </div>
            <MenuItem href="/admin/profile" icon={<UserCircle className="h-4 w-4" />}>
              My profile
            </MenuItem>
            <MenuItem href="/admin/profile?tab=security" icon={<ShieldCheck className="h-4 w-4" />}>
              Security
            </MenuItem>
            {/* The topbar toggle is hidden on phones, so the theme lives here. */}
            <div className="sm:hidden">
              <MenuSeparator />
              <MenuLabel>Theme</MenuLabel>
              <ThemeMenuItems preference={preference} onSelect={setPreference} />
            </div>
            <MenuSeparator />
            <MenuItem href="/" external icon={<ExternalLink className="h-4 w-4" />}>
              View website
            </MenuItem>
            {isSuperAdmin || permissions.includes('staff.manage') ? (
              <MenuItem href="/admin/staff" icon={<User className="h-4 w-4" />}>
                Staff & roles
              </MenuItem>
            ) : null}
            <MenuSeparator />
            <MenuItem
              tone="danger"
              icon={<LogOut className="h-4 w-4" />}
              onClick={() => signOut({ callbackUrl: LOGIN_PATH })}
            >
              Sign out
            </MenuItem>
          </Menu>
        </div>
      </div>

      {/* Breadcrumbs move below the bar on small screens so they stay readable. */}
      <div className="px-2 pt-2.5 lg:hidden">
        <AdminBreadcrumbs />
      </div>
    </header>
  );
}

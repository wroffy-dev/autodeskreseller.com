'use client';

import * as React from 'react';
import { SessionProvider } from 'next-auth/react';
import { usePathname } from 'next/navigation';
import { AdminSidebar } from './sidebar';
import { AdminTopbar } from './topbar';
import { AdminThemeProvider } from './theme';
import { cn } from '@/lib/utils/cn';
import type { CountryContext } from '@/lib/country/types';
import { resetFormEdits, trackFormEdits } from '@/lib/admin/unsaved-changes';

export function AdminShell({
  user,
  branding,
  country,
  countries,
  children,
}: {
  user: {
    name: string;
    email: string;
    roleName: string;
    permissions: string[];
    isSuperAdmin: boolean;
    image?: string | null;
  };
  branding: { siteName: string; logoUrl: string | null; logoDarkUrl: string | null };
  /** The market the admin is editing, resolved on the server. */
  country: Pick<CountryContext, 'id' | 'code' | 'name'>;
  /** Every market this user may switch to. */
  countries: Array<Pick<CountryContext, 'id' | 'code' | 'name' | 'isDefault'>>;
  children: React.ReactNode;
}) {
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const [collapsed, setCollapsed] = React.useState(false);
  // Until the stored preference is read, render the default width so the
  // server and client markup agree and nothing flashes at a wrong size.
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem('admin:nav:collapsed') === '1');
    } catch {
      // No storage available — stay expanded.
    }
    setReady(true);
  }, []);

  const toggleCollapsed = React.useCallback(() => {
    setCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem('admin:nav:collapsed', next ? '1' : '0');
      } catch {
        // Preference simply will not persist.
      }
      return next;
    });
  }, []);

  const isCollapsed = ready && collapsed;

  /*
   * Portals render into <body>, outside this tree, so dialogs, menus and toasts
   * would otherwise miss every `.admin-ui` rule. The class comes off again when
   * the admin unmounts, which is what keeps the public site untouched.
   */
  React.useEffect(() => {
    document.body.classList.add('admin-ui');
    return () => document.body.classList.remove('admin-ui');
  }, []);

  // Edits typed into the current screen, so the topbar search can ask before
  // leaving it. A new route starts clean.
  const mainRef = React.useRef<HTMLElement>(null);
  const pathname = usePathname();
  React.useEffect(() => {
    if (!mainRef.current) return;
    return trackFormEdits(mainRef.current);
  }, []);
  React.useEffect(() => {
    resetFormEdits();
  }, [pathname]);

  return (
    <SessionProvider>
      <AdminThemeProvider>
        <div className="admin-ui min-h-screen bg-admin-workspace">
          <a href="#admin-main" className="skip-link">
            Skip to content
          </a>

          <AdminSidebar
            permissions={user.permissions}
            isSuperAdmin={user.isSuperAdmin}
            siteName={branding.siteName}
            logoUrl={branding.logoUrl}
            logoDarkUrl={branding.logoDarkUrl}
            open={sidebarOpen}
            onClose={() => setSidebarOpen(false)}
            collapsed={isCollapsed}
            onToggleCollapsed={toggleCollapsed}
          />

          {/* The rail floats 12px in from the edge, so the content clears its
            width plus that gap on both sides. */}
          <div
            className={cn(
              'transition-[padding] duration-200 ease-out',
              isCollapsed ? 'lg:pl-[6.25rem]' : 'lg:pl-[17.5rem]',
            )}
          >
            <AdminTopbar
              user={{
                name: user.name,
                email: user.email,
                roleName: user.roleName,
              }}
              permissions={user.permissions}
              isSuperAdmin={user.isSuperAdmin}
              country={country}
              countries={countries}
              onOpenSidebar={() => setSidebarOpen(true)}
            />
            <main
              ref={mainRef}
              id="admin-main"
              className="mx-auto w-full max-w-[100rem] px-4 py-6 sm:px-6 sm:py-8"
            >
              {children}
            </main>
          </div>
        </div>
      </AdminThemeProvider>
    </SessionProvider>
  );
}

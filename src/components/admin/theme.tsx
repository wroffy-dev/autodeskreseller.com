'use client';

import * as React from 'react';
import { Check, Monitor, Moon, Sun } from 'lucide-react';
import {
  ADMIN_THEME_ATTRIBUTE,
  ADMIN_THEME_KEY,
  DARK_QUERY,
  isThemePreference,
  resolveTheme,
  type AdminThemePreference,
} from '@/lib/admin/theme';
import { Menu, MenuItem } from '@/components/ui/menu';

type ThemeContextValue = {
  /** `null` until mounted, so server and client markup agree. */
  preference: AdminThemePreference | null;
  setPreference: (next: AdminThemePreference) => void;
};

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

export const THEME_OPTIONS: Array<{
  value: AdminThemePreference;
  label: string;
  icon: typeof Sun;
}> = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

function apply(preference: AdminThemePreference) {
  const dark = window.matchMedia(DARK_QUERY).matches;
  document.documentElement.setAttribute(ADMIN_THEME_ATTRIBUTE, resolveTheme(preference, dark));
}

/**
 * Owns the admin's Light / Dark / System preference.
 *
 * The inline script in the admin layout has already applied the stored choice
 * before first paint; this reads it back after mount, keeps the attribute in
 * step with changes, and — while the preference is "System" — follows the OS
 * live.
 */
export function AdminThemeProvider({ children }: { children: React.ReactNode }) {
  const [preference, setPreferenceState] = React.useState<AdminThemePreference | null>(null);

  React.useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(ADMIN_THEME_KEY);
    } catch {
      // No storage — follow the system.
    }
    const initial = isThemePreference(stored) ? stored : 'system';
    setPreferenceState(initial);
    // Covers a client-side navigation into the admin, where the inline script
    // in the layout has not run.
    apply(initial);
  }, []);

  React.useEffect(() => {
    if (preference !== 'system') return;
    const query = window.matchMedia(DARK_QUERY);
    const onChange = () => apply('system');
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [preference]);

  const setPreference = React.useCallback((next: AdminThemePreference) => {
    setPreferenceState(next);
    try {
      window.localStorage.setItem(ADMIN_THEME_KEY, next);
    } catch {
      // The choice applies for this visit but will not persist.
    }
    apply(next);
  }, []);

  const value = React.useMemo(() => ({ preference, setPreference }), [preference, setPreference]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useAdminTheme(): ThemeContextValue {
  const context = React.useContext(ThemeContext);
  if (!context) throw new Error('useAdminTheme must be used inside <AdminThemeProvider>');
  return context;
}

/** Topbar button: shows the current choice and opens Light / Dark / System. */
export function ThemeToggle({ className }: { className?: string }) {
  const { preference, setPreference } = useAdminTheme();
  // A neutral icon until mounted, so the server-rendered markup never disagrees.
  const Current = THEME_OPTIONS.find((option) => option.value === preference)?.icon ?? Monitor;

  return (
    <Menu
      align="right"
      width="w-44"
      label="Theme"
      triggerClassName="admin-focus admin-focus-header rounded-xl"
      trigger={
        <span
          title="Theme"
          className={
            'flex h-9 w-9 items-center justify-center rounded-xl text-admin-nav/70 transition-colors hover:bg-admin-nav/[0.06] hover:text-admin-nav ' +
            (className ?? '')
          }
        >
          <Current className="h-[1.1rem] w-[1.1rem]" aria-hidden="true" />
        </span>
      }
    >
      <ThemeMenuItems preference={preference} onSelect={setPreference} />
    </Menu>
  );
}

/** The three options as menu items, shared by the toggle and the profile menu. */
export function ThemeMenuItems({
  preference,
  onSelect,
}: {
  preference: AdminThemePreference | null;
  onSelect: (next: AdminThemePreference) => void;
}) {
  return (
    <>
      {THEME_OPTIONS.map((option) => {
        const Icon = option.icon;
        const selected = preference === option.value;
        return (
          <MenuItem
            key={option.value}
            icon={<Icon className="h-4 w-4" />}
            onClick={() => onSelect(option.value)}
            checked={selected}
          >
            <span className="flex items-center justify-between gap-2">
              {option.label}
              {selected ? <Check className="h-4 w-4 text-brand" aria-hidden="true" /> : null}
            </span>
          </MenuItem>
        );
      })}
    </>
  );
}

'use client';

import * as React from 'react';
import { Check, Monitor, Moon, Sun } from 'lucide-react';
import {
  ADMIN_THEME_ATTRIBUTE,
  ADMIN_THEME_KEY,
  DARK_QUERY,
  isThemePreference,
  resolveTheme,
  type AdminAppliedTheme,
  type AdminThemePreference,
} from '@/lib/admin/theme';
import { MenuItem } from '@/components/ui/menu';

type ThemeContextValue = {
  /** `null` until mounted, so server and client markup agree. */
  preference: AdminThemePreference | null;
  /** What is on screen — `null` until mounted, for the same reason. */
  applied: AdminAppliedTheme | null;
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

function apply(preference: AdminThemePreference, animate = false) {
  const dark = window.matchMedia(DARK_QUERY).matches;
  const next = resolveTheme(preference, dark);
  const root = document.documentElement;
  if (root.getAttribute(ADMIN_THEME_ATTRIBUTE) === next) return;
  const swap = () => root.setAttribute(ADMIN_THEME_ATTRIBUTE, next);

  /*
   * A deliberate switch cross-fades the whole page once, as a single snapshot,
   * instead of putting a colour transition on every element: nothing else is
   * animated, nothing waits for it, and input keeps working throughout.
   * Skipped when motion is reduced or the browser has no View Transitions.
   */
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const start = (
    document as Document & {
      startViewTransition?: (callback: () => void) => unknown;
    }
  ).startViewTransition;
  if (animate && !reduced && typeof start === 'function') {
    start.call(document, swap);
  } else {
    swap();
  }
}

/** The theme actually applied right now, read from <html>. */
function appliedTheme(): AdminAppliedTheme {
  return document.documentElement.getAttribute(ADMIN_THEME_ATTRIBUTE) === 'dark' ? 'dark' : 'light';
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
  const [applied, setApplied] = React.useState<AdminAppliedTheme | null>(null);

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
    setApplied(appliedTheme());
  }, []);

  React.useEffect(() => {
    if (preference !== 'system') return;
    const query = window.matchMedia(DARK_QUERY);
    const onChange = () => {
      apply('system', true);
      setApplied(appliedTheme());
    };
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [preference]);

  // A choice made in another tab follows here too.
  React.useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== ADMIN_THEME_KEY) return;
      const next = isThemePreference(event.newValue) ? event.newValue : 'system';
      setPreferenceState(next);
      apply(next);
      setApplied(appliedTheme());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const setPreference = React.useCallback((next: AdminThemePreference) => {
    setPreferenceState(next);
    try {
      window.localStorage.setItem(ADMIN_THEME_KEY, next);
    } catch {
      // The choice applies for this visit but will not persist.
    }
    apply(next, true);
    setApplied(resolveTheme(next, window.matchMedia(DARK_QUERY).matches));
  }, []);

  const value = React.useMemo(
    () => ({ preference, applied, setPreference }),
    [preference, applied, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useAdminTheme(): ThemeContextValue {
  const context = React.useContext(ThemeContext);
  if (!context) throw new Error('useAdminTheme must be used inside <AdminThemeProvider>');
  return context;
}

/**
 * Topbar appearance switch: a sun and a moon in a sliding track.
 *
 * One press moves between light and dark and saves that as an explicit choice.
 * Following the system ("System") stays available in the account menu, and
 * is what a first visit uses until someone picks.
 *
 * The thumb's position is drawn by CSS from `<html data-admin-theme>`, which
 * the inline script sets before the first paint, so the switch shows the right
 * side immediately — there is no client-only state for hydration to correct.
 */
export function ThemeSwitch({ className }: { className?: string }) {
  const { applied, preference, setPreference } = useAdminTheme();
  const dark = applied === 'dark';
  const following = preference === 'system';

  return (
    <button
      type="button"
      role="switch"
      aria-checked={dark}
      aria-label="Dark appearance"
      title={
        `${dark ? 'Switch to light appearance' : 'Switch to dark appearance'}` +
        (following ? ' (currently following the system)' : '')
      }
      onClick={() => setPreference(dark ? 'light' : 'dark')}
      className={
        'theme-switch admin-focus relative inline-flex h-8 w-[3.75rem] shrink-0 items-center rounded-full ' +
        (className ?? '')
      }
    >
      <span
        aria-hidden="true"
        className="theme-switch-icon theme-switch-sun absolute left-[0.4rem]"
      >
        <Sun className="h-[0.95rem] w-[0.95rem]" />
      </span>
      <span
        aria-hidden="true"
        className="theme-switch-icon theme-switch-moon absolute right-[0.4rem]"
      >
        <Moon className="h-[0.95rem] w-[0.95rem]" />
      </span>
      <span
        aria-hidden="true"
        className="theme-switch-thumb absolute left-[3px] flex h-[1.625rem] w-[1.625rem] items-center justify-center rounded-full"
      >
        <Sun className="theme-switch-thumb-sun h-[0.95rem] w-[0.95rem]" />
        <Moon className="theme-switch-thumb-moon h-[0.95rem] w-[0.95rem]" />
      </span>
    </button>
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

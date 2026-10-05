/**
 * Admin colour theme.
 *
 * The admin has its own light and dark appearance, chosen per browser. The
 * preference is stored as `light`, `dark` or `system`; what is *applied* is
 * always `light` or `dark`, written to `<html data-admin-theme>`. Every dark
 * rule is scoped under `.admin-ui`, so the attribute does nothing to the public
 * site even if it outlives the admin in the same tab.
 */

export type AdminThemePreference = 'light' | 'dark' | 'system';
export type AdminAppliedTheme = 'light' | 'dark';

export const ADMIN_THEME_KEY = 'admin:theme';
export const ADMIN_THEME_ATTRIBUTE = 'data-admin-theme';
export const DARK_QUERY = '(prefers-color-scheme: dark)';

export function isThemePreference(value: unknown): value is AdminThemePreference {
  return value === 'light' || value === 'dark' || value === 'system';
}

export function resolveTheme(
  preference: AdminThemePreference,
  systemPrefersDark: boolean,
): AdminAppliedTheme {
  if (preference === 'system') return systemPrefersDark ? 'dark' : 'light';
  return preference;
}

/**
 * Runs inline, before the shell paints, so a dark-mode admin never flashes
 * light on reload. Kept dependency-free and wrapped in try/catch: storage may be
 * unavailable, and a failure here must never stop the page rendering.
 */
export const ADMIN_THEME_SCRIPT = `(function(){try{var p=localStorage.getItem('${ADMIN_THEME_KEY}')||'system';var d=p==='dark'||(p==='system'&&matchMedia('${DARK_QUERY}').matches);document.documentElement.setAttribute('${ADMIN_THEME_ATTRIBUTE}',d?'dark':'light');}catch(e){}})();`;

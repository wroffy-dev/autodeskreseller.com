import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolveTheme, isThemePreference, ADMIN_THEME_SCRIPT } from '@/lib/admin/theme';
import { buildAdminDarkCss, OUTPUT } from '../../scripts/admin-dark-css.mjs';

const ADMIN_CSS = readFileSync('src/app/admin/admin-ui.css', 'utf8');

/** Strips comments so a selector mentioned in prose is not mistaken for a rule. */
function rules(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

describe('admin theme preference', () => {
  it('resolves System from the OS and leaves an explicit choice alone', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('light', true)).toBe('light');
  });

  it('accepts only the three known preferences', () => {
    expect(isThemePreference('dark')).toBe(true);
    expect(isThemePreference('system')).toBe(true);
    expect(isThemePreference('sepia')).toBe(false);
    expect(isThemePreference(null)).toBe(false);
  });

  it('applies the stored choice before paint, and never throws doing it', () => {
    expect(ADMIN_THEME_SCRIPT).toContain("localStorage.getItem('admin:theme')");
    expect(ADMIN_THEME_SCRIPT).toContain('data-admin-theme');
    expect(ADMIN_THEME_SCRIPT).toMatch(/try\{[\s\S]*\}catch\(e\)\{\}/);

    const layout = readFileSync('src/app/admin/layout.tsx', 'utf8');
    expect(layout).toContain('ADMIN_THEME_SCRIPT');
  });
});

describe('admin styles stay inside the admin', () => {
  it('scopes every rule under .admin-ui, so the public site cannot change', () => {
    for (const file of ['src/app/admin/admin-ui.css', OUTPUT]) {
      const css = rules(readFileSync(file, 'utf8'));
      // Every selector list before a `{`, ignoring at-rules.
      const selectors = css
        .split('}')
        .map((block) => block.split('{')[0]!.trim())
        .filter((selector) => selector && !selector.startsWith('@'));
      for (const list of selectors) {
        for (const selector of list.split(/,(?![^(]*\))/)) {
          expect(selector, `${file}: "${selector.trim()}" is not scoped`).toMatch(/\.admin-ui/);
        }
      }
    }
  });

  it('puts the class on <body> while mounted, so portals inherit it', () => {
    const shell = readFileSync('src/components/admin/admin-shell.tsx', 'utf8');
    expect(shell).toContain("document.body.classList.add('admin-ui')");
    expect(shell).toContain("document.body.classList.remove('admin-ui')");
  });

  it('falls back when blur is unsupported or transparency is reduced', () => {
    expect(ADMIN_CSS).toContain('@supports not ((backdrop-filter: blur(1px))');
    expect(ADMIN_CSS).toContain('@media (prefers-reduced-transparency: reduce)');
  });
});

describe('dark mode status colours', () => {
  it('is regenerated whenever a tinted status colour is added', () => {
    const current = readFileSync(OUTPUT, 'utf8');
    expect(current, 'run `npm run admin:dark-css`').toBe(buildAdminDarkCss());
  });

  it('maps the tints the admin actually uses', () => {
    const css = buildAdminDarkCss();
    expect(css).toContain(".admin-ui .bg-red-50 {");
    expect(css).toContain('.admin-ui .bg-amber-50\\/60 {');
    expect(css).toContain('.admin-ui .hover\\:bg-red-50:hover {');
  });

  it('keeps switch knobs and public-site previews white', () => {
    expect(ADMIN_CSS).toContain('.bg-white:not(.ui-switch-knob):not(.ui-keep-white)');
    expect(readFileSync('src/components/ui/field.tsx', 'utf8')).toContain('ui-switch-knob');
    expect(readFileSync('src/components/admin/preview-frame.tsx', 'utf8')).toContain(
      'ui-keep-white',
    );
  });
});

describe('sidebar', () => {
  const sidebar = readFileSync('src/components/admin/sidebar.tsx', 'utf8');

  it('keeps the collapse toggle in the header and has no footer', () => {
    expect(sidebar).toContain("'Collapse navigation'");
    expect(sidebar).not.toContain('View website');
  });

  it('collapses to 76px and paints fly-outs outside the rail', () => {
    expect(sidebar).toContain('lg:w-[4.75rem]');
    expect(sidebar).toContain('createPortal');
  });
});

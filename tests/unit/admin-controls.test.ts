import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { settleToggle } from '@/lib/ui/persisted-toggle';

/**
 * The shared admin controls: what they promise and the rules that keep them
 * honest. Behaviour is checked directly where it is a pure function, and the
 * remaining contracts are read from the source, in the style of the other
 * admin quality suites.
 */

const read = (path: string) => readFileSync(path, 'utf8');
const ADMIN_CSS = read('src/app/admin/admin-ui.css');

describe('switches that save immediately', () => {
  it('keeps the new position when the save succeeds', async () => {
    expect(await settleToggle(false, true, async () => ({ ok: true }))).toEqual({
      checked: true,
      error: null,
    });
  });

  it('takes the stored value the server reports', async () => {
    expect(await settleToggle(false, true, async () => ({ ok: true, value: false }))).toEqual({
      checked: false,
      error: null,
    });
  });

  it('puts the switch back and says why when the server refuses', async () => {
    expect(
      await settleToggle(true, false, async () => ({ ok: false, error: 'You cannot do that.' })),
    ).toEqual({ checked: true, error: 'You cannot do that.' });
  });

  it('puts the switch back when the request itself fails', async () => {
    const result = await settleToggle(false, true, async () => {
      throw new Error('network');
    });
    expect(result.checked).toBe(false);
    expect(result.error).toMatch(/could not save/i);
  });

  it('is a labelled switch with pending and error states', () => {
    const field = read('src/components/ui/field.tsx');
    expect(field).toContain('role="switch"');
    expect(field).toContain('aria-labelledby');
    expect(field).toContain('aria-busy');
    // A save-on-submit form still receives the value as a field.
    expect(field).toContain('<input type="hidden" name={name}');
  });
});

describe('segmented control', () => {
  const source = read('src/components/ui/segmented-control.tsx');

  it('speaks as radios for a setting and as tabs for panels', () => {
    expect(source).toContain("semantics === 'tabs' ? 'tablist' : 'radiogroup'");
    expect(source).toContain("role={semantics === 'tabs' ? 'tab' : 'radio'}");
    expect(source).toContain('aria-controls');
  });

  it('keeps one segment in the tab order and moves with the arrow keys', () => {
    expect(source).toContain('tabIndex={selected ? 0 : -1}');
    expect(source).toMatch(/ArrowRight[\s\S]*ArrowLeft[\s\S]*Home[\s\S]*End/);
  });

  it('scrolls a long strip inside itself instead of overlapping labels', () => {
    expect(source).toContain('scroll-x');
    expect(source).toContain('whitespace-nowrap');
  });

  it('backs the edit-screen tabs, so TabPanel ids still match', () => {
    const tabs = read('src/components/admin/admin-tabs.tsx');
    expect(tabs).toContain('idPrefix="tab-"');
    expect(tabs).toContain('`panel-${id}`');
  });
});

describe('theme switch', () => {
  it('draws its position from <html data-admin-theme>, so it never renders on the wrong side', () => {
    expect(ADMIN_CSS).toContain(":root[data-admin-theme='dark'] .admin-ui .theme-switch-thumb");
    const theme = read('src/components/admin/theme.tsx');
    expect(theme).toContain('role="switch"');
    // One provider, still the one the layout's pre-paint script feeds.
    expect(theme).toContain('ADMIN_THEME_KEY');
    expect(theme).toContain('startViewTransition');
    expect(theme).toContain('prefers-reduced-motion');
  });

  it('keeps "System" available beside the explicit choice', () => {
    const topbar = read('src/components/admin/topbar.tsx');
    expect(topbar).toContain('<ThemeSwitch');
    expect(topbar).toContain('<ThemeMenuItems');
  });
});

describe('topbar search', () => {
  const source = read('src/components/admin/admin-search.tsx');

  it('is a combobox with keyboard control and a platform shortcut', () => {
    expect(source).toContain('role="combobox"');
    expect(source).toContain('aria-activedescendant');
    expect(source).toMatch(/event\.metaKey \|\| event\.ctrlKey/);
    expect(source).toContain("'⌘K' : 'Ctrl K'");
  });

  it('drops a response that a newer query has overtaken', () => {
    expect(source).toMatch(/if \(id !== latest\.current\) return;/);
  });

  it('asks before leaving a screen with unsaved edits', () => {
    expect(source).toContain('hasUnsavedChanges()');
    expect(source).toContain('Leave without saving?');
  });
});

describe('date pickers', () => {
  it('replaced every native date input in the admin', () => {
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const entry of readdirSync(dir)) {
        const path = `${dir}/${entry}`;
        if (statSync(path).isDirectory()) walk(path, out);
        else if (path.endsWith('.tsx')) out.push(path);
      }
      return out;
    };
    const offenders = [...walk('src/components/admin'), ...walk('src/app/admin')].filter((path) =>
      /type="(date|datetime-local)"/.test(read(path)),
    );
    expect(offenders).toEqual([]);
  });

  it('closes only itself on Escape, so a dialog underneath stays open', () => {
    const popover = read('src/components/ui/popover.tsx');
    expect(popover).toContain("window.addEventListener('keydown', onKey, true)");
    expect(popover).toContain('event.stopPropagation()');
    expect(popover).toContain('[role="dialog"]');
  });

  it('posts the same strings the native inputs did', () => {
    const field = read('src/components/ui/date-field.tsx');
    expect(field).toContain('<input type="hidden" name={name} value={hiddenValue} />');
    expect(field).toContain('formatLocalDateTime');
    expect(field).toContain('setCustomValidity');
  });
});

describe('glass', () => {
  it('has a token for every glass role and an opaque fallback', () => {
    for (const token of [
      '--glass-alpha-bar',
      '--glass-alpha-menu',
      '--glass-alpha-popover',
      '--glass-blur-bar',
      '--focus-ring',
      '--control-border',
      '--motion-base',
    ]) {
      expect(ADMIN_CSS).toContain(token);
    }
    expect(ADMIN_CSS).toMatch(/@media \(prefers-reduced-transparency: reduce\)[\s\S]*\.ui-popover/);
  });
});

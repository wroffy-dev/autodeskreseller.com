import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { GOOGLE_FONTS, googleFontsHref, findGoogleFont } from '@/lib/cms/google-fonts';

function routeDirs(root: string, out: string[] = []): string[] {
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    if (!statSync(path).isDirectory()) continue;
    if (existsSync(join(path, 'page.tsx'))) out.push(path);
    routeDirs(path, out);
  }
  return out;
}

describe('font picker', () => {
  it('requests only the families asked for, never the whole catalogue', () => {
    const href = googleFontsHref([{ family: 'Inter', weights: [400, 700] }])!;
    expect(href).toContain('family=Inter');
    expect(href).toContain('wght@400;700');

    // One family requested must not pull in a second.
    for (const font of GOOGLE_FONTS.filter((candidate) => candidate.family !== 'Inter')) {
      expect(href).not.toContain(`family=${font.family.replace(/ /g, '+')}`);
    }
  });

  it('asks for exactly the weights requested, snapped to ones the family ships', () => {
    const font = GOOGLE_FONTS.find((candidate) => candidate.weights.length > 1)!;
    const href = googleFontsHref([{ family: font.family, weights: [font.weights[0]] }])!;
    const weights = href
      .match(/wght@([\d;]+)/)![1]
      .split(';')
      .map(Number);

    expect(weights).toEqual([font.weights[0]]);
    for (const weight of weights) expect(font.weights).toContain(weight);
  });

  it('skips an unknown family rather than requesting it blindly', () => {
    expect(googleFontsHref([{ family: 'Not A Real Font', weights: [400] }])).toBeNull();
    expect(findGoogleFont('Not A Real Font')).toBeNull();
    // A known family alongside an unknown one still resolves.
    const href = googleFontsHref([
      { family: 'Not A Real Font', weights: [400] },
      { family: 'Inter', weights: [400] },
    ])!;
    expect(href).toContain('family=Inter');
    expect(href).not.toContain('Not+A+Real+Font');
  });

  it('previews options without loading every font at once', () => {
    const source = readFileSync('src/components/admin/settings/font-select.tsx', 'utf8');
    // The preview loader must be capped and must only run while the picker is open.
    expect(source).toMatch(/PREVIEW_LIMIT\s*=\s*\d+/);
    expect(source).toContain('if (!enabled) return;');
    expect(source).toContain('slice(0, PREVIEW_LIMIT)');
    // And only at one weight — previewing is not a reason to fetch nine faces.
    expect(source).toContain('weights: [400]');
  });
});

describe('media library', () => {
  const source = readFileSync('src/components/admin/media/media-library.tsx', 'utf8');

  it('offers both layouts and remembers the choice', () => {
    expect(source).toContain("'grid' | 'list'");
    expect(source).toContain('admin:media:view');
    // Storage may be unavailable in a private window; it must not throw.
    expect(source).toMatch(/try\s*\{[\s\S]*localStorage[\s\S]*\}\s*catch/);
  });

  it('labels the layout buttons, which carry only an icon', () => {
    // Drawn by the shared segmented control, which names each segment from
    // its `ariaLabel`.
    expect(source).toContain("ariaLabel: 'Grid view'");
    expect(source).toContain("ariaLabel: 'List view'");
    const control = readFileSync('src/components/ui/segmented-control.tsx', 'utf8');
    expect(control).toContain('aria-label={option.ariaLabel}');
  });

  it('surfaces missing alt text rather than hiding it', () => {
    expect(source).toContain('No alt text');
  });
});

describe('route loading states', () => {
  const dirs = routeDirs('src/app/admin');

  it('gives every admin list, dashboard and settings route a loading skeleton', () => {
    // Detail and "new" routes render fast and inherit the segment above them;
    // the top-level screens are the ones that run the expensive queries.
    const missing = dirs.filter((dir) => {
      if (/\[[^\]]+\]/.test(dir)) return false;
      if (dir.endsWith('/new') || dir.endsWith('/preview')) return false;
      return !existsSync(join(dir, 'loading.tsx'));
    });

    expect(missing).toEqual([]);
  });

  it('announces the wait to screen readers instead of only showing shapes', () => {
    const skeletons = readFileSync('src/components/admin/loading-skeletons.tsx', 'utf8');
    expect(skeletons).toContain('aria-busy="true"');
    expect(skeletons).toContain('aria-live="polite"');
    expect(skeletons).toContain('Loading…');
  });

  it('keeps an error boundary alongside the loading states', () => {
    expect(existsSync('src/app/admin/error.tsx')).toBe(true);
    expect(existsSync('src/app/error.tsx')).toBe(true);
    expect(existsSync('src/app/not-found.tsx')).toBe(true);
  });
});

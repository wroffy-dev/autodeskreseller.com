#!/usr/bin/env node
/**
 * Generates the admin's dark-mode overrides for Tailwind's tinted status
 * utilities.
 *
 *   npm run admin:dark-css            rewrite src/app/admin/admin-dark.generated.css
 *
 * Status chips, alerts and "needs attention" tiles are written with light-theme
 * tints — `bg-amber-50`, `text-red-700`, `border-emerald-200` — which turn into
 * glaring pale boxes with unreadable text on a dark surface. Rather than
 * hand-maintain a list that drifts, this scans the source for every such class
 * actually used (alpha variants like `bg-amber-50/60` and hover/focus variants
 * included) and maps each to its dark equivalent:
 *
 *   bg-{c}-50 / -100          ->  rgb(c500 / 0.14)
 *   text-{c}-600              ->  c400
 *   text-{c}-700 … -950       ->  c300
 *   border-{c}-200 / -300     ->  rgb(c500 / 0.35)
 *
 * Every rule is scoped `:root[data-admin-theme='dark'] .admin-ui`, so the public
 * site is never affected. A unit test fails when the checked-in file is stale.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const colors = require('tailwindcss/colors');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const OUTPUT = 'src/app/admin/admin-dark.generated.css';
const SCAN = ['src/app', 'src/components'];

const HUES = [
  'red',
  'orange',
  'amber',
  'yellow',
  'lime',
  'green',
  'emerald',
  'teal',
  'cyan',
  'sky',
  'blue',
  'indigo',
  'violet',
  'purple',
  'fuchsia',
  'pink',
  'rose',
];

const VARIANTS = ['', 'hover:', 'group-hover:', 'focus:', 'focus-visible:'];

const PATTERN = new RegExp(
  `(?<![\\w-])((?:group-hover:|hover:|focus-visible:|focus:)?)(bg|text|border)-(${HUES.join('|')})-(50|100|200|300|600|700|800|900|950)(\\/(?:\\d+|\\[[\\d.]+\\]))?(?![\\w-])`,
  'g',
);

function triple(hex) {
  const value = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16)).join(' ');
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(tsx?|jsx?)$/.test(entry)) out.push(path);
  }
  return out;
}

/** Escapes a Tailwind class for use in a CSS selector. */
function escapeClass(name) {
  return name.replace(/([:/.[\]])/g, '\\$1');
}

/** `/80` -> 0.8, `/[0.35]` -> 0.35; null when the class has no alpha. */
function alphaOf(suffix) {
  if (!suffix) return null;
  const raw = suffix.slice(1).replace(/[[\]]/g, '');
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  return raw.includes('.') ? value : value / 100;
}

function declaration(property, hue, shade, alpha = null) {
  const palette = colors[hue];
  // Text keeps any alpha it was written with; tinted backgrounds all become
  // one quiet wash.
  const text = (hex) =>
    alpha === null ? `color: rgb(${triple(hex)});` : `color: rgb(${triple(hex)} / ${alpha});`;
  if (property === 'bg') {
    if (shade !== '50' && shade !== '100') return null;
    return `background-color: rgb(${triple(palette[500])} / 0.14);`;
  }
  if (property === 'text') {
    if (shade === '600') return text(palette[400]);
    if (['700', '800', '900', '950'].includes(shade)) return text(palette[300]);
    return null;
  }
  if (property === 'border') {
    if (shade !== '200' && shade !== '300') return null;
    return `border-color: rgb(${triple(palette[500])} / 0.35);`;
  }
  return null;
}

function selector(variant, className) {
  const scope = ":root[data-admin-theme='dark'] .admin-ui";
  const cls = `.${escapeClass(variant + className)}`;
  if (variant === 'hover:') return `${scope} ${cls}:hover`;
  if (variant === 'focus:') return `${scope} ${cls}:focus`;
  if (variant === 'focus-visible:') return `${scope} ${cls}:focus-visible`;
  if (variant === 'group-hover:') return `${scope} .group:hover ${cls}`;
  return `${scope} ${cls}`;
}

export function collectClasses(root = ROOT) {
  const found = new Set();
  for (const dir of SCAN) {
    for (const file of walk(join(root, dir))) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(PATTERN)) {
        const [, variant, property, hue, shade, alpha = ''] = match;
        if (!VARIANTS.includes(variant)) continue;
        if (!declaration(property, hue, shade)) continue;
        found.add(`${variant}${property}-${hue}-${shade}${alpha}`);
      }
    }
  }
  return [...found].sort();
}

export function buildAdminDarkCss(root = ROOT) {
  const rules = collectClasses(root).map((full) => {
    const [, variant, property, hue, shade, suffix] = full.match(
      /^((?:group-hover:|hover:|focus-visible:|focus:)?)(bg|text|border)-([a-z]+)-(\d+)(\/.+)?$/,
    );
    const className = full.slice(variant.length);
    const rule = declaration(property, hue, shade, alphaOf(suffix));
    return `${selector(variant, className)} {\n  ${rule}\n}`;
  });

  return `/*
  GENERATED by scripts/admin-dark-css.mjs — do not edit by hand.
  Run \`npm run admin:dark-css\` after adding a tinted status colour.

  Dark-mode equivalents for the light-theme tints used across the admin, so
  status chips and alerts stay readable on a dark surface.
*/

${rules.join('\n\n')}
`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(join(ROOT, OUTPUT), buildAdminDarkCss());
  console.log(`Wrote ${OUTPUT}`);
}

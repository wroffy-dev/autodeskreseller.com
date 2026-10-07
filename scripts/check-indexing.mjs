#!/usr/bin/env node
/**
 * Is this site asking search engines not to index it?
 *
 * Fetches each page the way a crawler does and reports both places a noindex
 * can come from: the X-Robots-Tag response header and the robots meta tag.
 * Also reports whether robots.txt blocks the whole site and which sitemaps
 * the index lists. Read-only; needs no credentials.
 *
 * The application sends the market noindex as a meta tag only. An
 * X-Robots-Tag on a public page did not come from the application — look at
 * whatever sits in front of it (proxy labels, CDN rules).
 *
 * Usage:
 *   node scripts/check-indexing.mjs https://example.com / /pricing /ae
 *   node scripts/check-indexing.mjs https://example.com --allow-noindex /ae
 *
 * Exits 1 when a page says noindex, unless --allow-noindex is given.
 */

const args = process.argv.slice(2);
const allowNoindex = args.includes('--allow-noindex');
const [target, ...rest] = args.filter((arg) => arg !== '--allow-noindex');

if (!target) {
  console.error('Usage: node scripts/check-indexing.mjs <https://your-domain> [path ...] [--allow-noindex]');
  process.exit(2);
}

const base = target.replace(/\/+$/, '');
const paths = rest.length > 0 ? rest : ['/'];
const TIMEOUT_MS = 20_000;

async function get(path) {
  return fetch(`${base}${path}`, {
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { 'user-agent': 'check-indexing (+https://developers.google.com/search/docs/crawling-indexing/block-indexing)' },
  });
}

/** The content of every robots-ish meta tag: robots, googlebot, bingbot. */
function robotsMeta(html) {
  const found = [];
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const name = /\bname\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
    if (!name || !['robots', 'googlebot', 'bingbot'].includes(name)) continue;
    const content = /\bcontent\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1] ?? '';
    found.push(`${name}: ${content}`);
  }
  return found;
}

let noindexPages = 0;

console.log(`Checking ${base}\n`);
for (const path of paths) {
  try {
    const response = await get(path);
    const header = response.headers.get('x-robots-tag');
    const html = (response.headers.get('content-type') ?? '').includes('html') ? await response.text() : '';
    const meta = robotsMeta(html);
    const noindex =
      /noindex|\bnone\b/i.test(header ?? '') || meta.some((entry) => /noindex|\bnone\b/i.test(entry));
    if (noindex) noindexPages += 1;
    console.log(`${noindex ? 'NOINDEX ' : 'indexable'}  ${path}  (${response.status}${response.redirected ? ` → ${response.url}` : ''})`);
    console.log(`           X-Robots-Tag: ${header ?? 'none'}`);
    console.log(`           meta:         ${meta.length > 0 ? meta.join(' | ') : 'none'}`);
  } catch (error) {
    console.log(`ERROR     ${path}  ${error instanceof Error ? error.message : String(error)}`);
    noindexPages += 1;
  }
}

try {
  const robots = await get('/robots.txt');
  const body = robots.ok ? await robots.text() : '';
  const blocksAll = /^\s*disallow:\s*\/\s*$/im.test(body);
  const sitemap = /^\s*sitemap:\s*(\S+)/im.exec(body)?.[1] ?? 'none';
  console.log(`\nrobots.txt  ${robots.status}  ${blocksAll ? 'BLOCKS THE WHOLE SITE (Disallow: /)' : 'does not block the whole site'}  sitemap: ${sitemap}`);
} catch (error) {
  console.log(`\nrobots.txt  ERROR ${error instanceof Error ? error.message : String(error)}`);
}

try {
  const index = await get('/sitemap.xml');
  const body = index.ok ? await index.text() : '';
  const listed = [...body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  console.log(`sitemap.xml ${index.status}  ${listed.length} ${listed.length === 1 ? 'sitemap' : 'sitemaps'}${listed.length > 0 ? `: ${listed.join(', ')}` : ''}`);
} catch (error) {
  console.log(`sitemap.xml ERROR ${error instanceof Error ? error.message : String(error)}`);
}

if (noindexPages > 0 && !allowNoindex) {
  console.log(`\n${noindexPages} of ${paths.length} checked pages ask not to be indexed.`);
  process.exit(1);
}

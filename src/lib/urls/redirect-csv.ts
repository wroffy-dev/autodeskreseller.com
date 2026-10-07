import { parseCsvLines } from './csv';

/**
 * The redirect CSV format: exactly two columns.
 *
 * ```
 * URL,Destination URL
 * /old-autocad,/autocad
 * /old-revit,/revit
 * /ae/old-autocad,/ae/autocad
 * ```
 *
 * `URL` is the address that should redirect — a path, or a full URL on this
 * site. `Destination URL` is where it goes — a path on this site (with its own
 * query string and fragment, if any) or an external `https://` URL. An explicit
 * market prefix (`/ae/...`) is kept on both.
 *
 * This is deliberately a separate format from the address CSV (`entity_id,
 * country, …, target_path`), which changes where content lives. A redirect
 * import never moves content and never takes an address content holds.
 *
 * Pure and dependency-free, so the import dialog can offer the sample and
 * check the header before anything is sent.
 */

export const REDIRECT_CSV_COLUMNS = ['URL', 'Destination URL'] as const;

/** One import stays a reviewable change. */
export const MAX_REDIRECT_IMPORT_ROWS = 5_000;

/** The sample offered for download: the format, with nothing else in it. */
export const REDIRECT_CSV_SAMPLE = [
  'URL,Destination URL',
  '/old-autocad,/autocad',
  '/old-revit,/revit',
  '/ae/old-autocad,/ae/autocad',
].join('\r\n').concat('\r\n');

export type RedirectCsvRow = {
  /** The line in the file the row starts on, counting the header as line 1. */
  line: number;
  url: string;
  destination: string;
};

export type RedirectCsvParse =
  | { ok: true; rows: RedirectCsvRow[] }
  | { ok: false; error: string };

function headerName(cell: string): string {
  return cell.replace(/^﻿/, '').trim().replace(/^'/, '').replace(/\s+/g, ' ').toLowerCase();
}

/** A cell as a spreadsheet may have exported it: trimmed, a formula guard removed. */
function clean(value: string | undefined): string {
  return (value ?? '').trim().replace(/^'(?=[=+\-@])/, '');
}

/**
 * Reads a redirect CSV.
 *
 * The header must be exactly `URL` and `Destination URL`, in either order
 * (case and surrounding spaces ignored). Any other column is refused rather
 * than silently ignored, so a file meant for the address import is never read
 * as redirects, or the other way round.
 */
export function readRedirectCsv(text: string): RedirectCsvParse {
  if (!text.trim()) return { ok: false, error: 'The file is empty.' };
  const table = parseCsvLines(text);
  if (table.length === 0) return { ok: false, error: 'The file is empty.' };

  const header = table[0]!.cells.map(headerName);
  while (header.length > 0 && header[header.length - 1] === '') header.pop();
  const urlAt = header.indexOf('url');
  const destinationAt = header.indexOf('destination url');
  if (header.includes('entity_id') || header.includes('target_path')) {
    return {
      ok: false,
      error:
        'This looks like an address file (entity_id, target_path). Import it from All URLs → Import CSV; redirects use exactly two columns: URL and Destination URL.',
    };
  }
  if (urlAt < 0 || destinationAt < 0 || header.length !== 2) {
    return {
      ok: false,
      error: `The first line must be exactly “${REDIRECT_CSV_COLUMNS.join(',')}”. Download the sample to start from.`,
    };
  }

  const body = table.slice(1);
  if (body.length === 0) return { ok: false, error: 'The file has a header but no redirects.' };
  if (body.length > MAX_REDIRECT_IMPORT_ROWS) {
    return { ok: false, error: `Import at most ${MAX_REDIRECT_IMPORT_ROWS.toLocaleString('en')} redirects at a time.` };
  }

  return {
    ok: true,
    rows: body.map((row) => ({
      line: row.line,
      url: clean(row.cells[urlAt]),
      destination: clean(row.cells[destinationAt]),
    })),
  };
}

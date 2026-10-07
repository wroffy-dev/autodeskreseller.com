/**
 * CSV for the URL manager — parsing and writing, with no dependencies.
 *
 * RFC 4180: comma-separated, `"` quotes a field, `""` is a literal quote, and
 * a quoted field may span lines. A cell that a spreadsheet would read as a
 * formula (`=`, `+`, `-`, `@` first) is exported with a leading apostrophe so
 * opening the file never runs anything.
 */

export const CSV_COLUMNS = [
  'entity_id',
  'country',
  'type',
  'name',
  'status',
  'mode',
  'current_path',
  'pattern_path',
  'target_path',
] as const;

/** Rows are limited so one import stays a reviewable change. */
export const MAX_IMPORT_ROWS = 5_000;

export function parseCsv(text: string): string[][] {
  return parseCsvLines(text).map((row) => row.cells);
}

/**
 * Like `parseCsv`, with the line each row starts on (1-based), so a report
 * can name the line an editor sees in their spreadsheet even when the file has
 * blank lines or quoted fields spanning several lines.
 */
export function parseCsvLines(text: string): Array<{ line: number; cells: string[] }> {
  const rows: Array<{ line: number; cells: string[] }> = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let line = 1;
  let rowStart = 1;
  const source = text.replace(/^\uFEFF/, '');

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!;
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        if (char === '\n') line += 1;
        field += char;
      }
      continue;
    }
    if (char === '"' && field === '') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[index + 1] === '\n') index += 1;
      row.push(field);
      rows.push({ line: rowStart, cells: row });
      row = [];
      field = '';
      line += 1;
      rowStart = line;
    } else {
      field += char;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push({ line: rowStart, cells: row });
  }
  return rows.filter((entry) => entry.cells.some((cell) => cell.trim() !== ''));
}

function escape(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(rows: ReadonlyArray<ReadonlyArray<string>>): string {
  return `${rows.map((row) => row.map((cell) => escape(cell ?? '')).join(',')).join('\r\n')}\r\n`;
}

export type ImportRow = {
  line: number;
  entityId: string;
  country: string;
  type: string;
  target: string;
};

export type ImportParse =
  | { ok: true; rows: ImportRow[] }
  | { ok: false; error: string };

/**
 * The rows of an import, keyed by stable id, market and target path.
 *
 * Only `entity_id`, `country` and `target_path` are required; every other
 * column of an export is informational and ignored, so an exported file can be
 * edited in place and imported back. A blank target leaves the row unchanged;
 * `@pattern` resets it to the inherited pattern.
 */
export function readImport(text: string): ImportParse {
  const table = parseCsv(text);
  if (table.length === 0) return { ok: false, error: 'The file is empty.' };
  const header = table[0]!.map((cell) => cell.trim().toLowerCase().replace(/^'/, ''));
  const column = (name: string) => header.indexOf(name);
  const idAt = column('entity_id');
  const countryAt = column('country');
  const targetAt = column('target_path');
  const typeAt = column('type');
  if (idAt < 0 || countryAt < 0 || targetAt < 0) {
    return { ok: false, error: 'The file needs entity_id, country and target_path columns. Export a file to start from.' };
  }
  const body = table.slice(1);
  if (body.length > MAX_IMPORT_ROWS) {
    return { ok: false, error: `Import at most ${MAX_IMPORT_ROWS} rows at a time.` };
  }
  const clean = (value: string | undefined) => (value ?? '').trim().replace(/^'(?=[=+\-@])/, '');
  return {
    ok: true,
    rows: body.map((cells, index) => ({
      line: index + 2,
      entityId: clean(cells[idAt]),
      country: clean(cells[countryAt]).toUpperCase(),
      type: typeAt >= 0 ? clean(cells[typeAt]).toUpperCase() : '',
      target: clean(cells[targetAt]),
    })),
  };
}

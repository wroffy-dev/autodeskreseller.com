import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mockAuth, uniqueSuffix, TEST_ACTOR, ensureTestCountry, ensureSecondCountry } from '../helpers';

mockAuth();

const { prisma } = await import('@/lib/db/prisma');
const { invalidateCountryCache } = await import('@/lib/country/registry');
const { runUrlScan } = await import('@/lib/urls/backfill');
const { resolvePublic } = await import('@/lib/urls/resolve');
const urls = await import('@/lib/actions/urls');
const { saveRedirect } = await import('@/lib/actions/seo');
const { readRedirectCsv, REDIRECT_CSV_SAMPLE } = await import('@/lib/urls/redirect-csv');

/*
 * Redirects → Import CSV, end to end: the file format, whole-file validation
 * against existing rules and content, explicit conflict decisions, stale
 * previews, batches, retries, and what the public site then answers — the
 * real status code and Location header the resolver sends.
 */

const suffix = uniqueSuffix();
const started = new Date();
const past = new Date(Date.now() - 86_400_000);

let IN = '';
let AE = '';
let previousResolver = false;
const pageIds: string[] = [];
let autocad = '';
let revit = '';
let aeAutocad = '';
let draft = '';

const P = (path: string) => path.replace(/X/g, suffix);

type Answer = { status: number; location?: string; kind?: string; id?: string | null };

async function answer(path: string, search = ''): Promise<Answer> {
  try {
    const target = await resolvePublic(path, search);
    return { status: 200, kind: target.kind, id: target.id };
  } catch (error) {
    const digest = String((error as { digest?: string }).digest ?? '');
    if (digest.startsWith('NEXT_REDIRECT')) {
      const [, , location, status] = digest.split(';');
      return { status: Number(status), location };
    }
    if (digest.includes('404')) return { status: 404 };
    throw error;
  }
}

function data<T>(result: { ok: true; data?: T } | { ok: false; error: string }): T {
  if (!result.ok || result.data === undefined) throw new Error(result.ok ? 'no data' : result.error);
  return result.data;
}

function csv(...rows: Array<[string, string]>): string {
  return ['URL,Destination URL', ...rows.map(([a, b]) => `${a},${b}`)].join('\n');
}

async function preview(text: string, resolutions: Record<string, 'keep' | 'replace'> = {}, type = 'PERMANENT') {
  const result = await urls.previewRedirectImportAction({ text, type, resolutions });
  if (!result.ok || !result.data) throw new Error(result.ok ? 'no plan' : result.error);
  return result.data;
}

/** Previews, imports and runs an import to the end. */
async function importCsv(text: string, resolutions: Record<string, 'keep' | 'replace'> = {}, type = 'PERMANENT') {
  const plan = await preview(text, resolutions, type);
  const applied = await urls.applyRedirectImportAction({ text, type, resolutions, fingerprint: plan.fingerprint });
  if (!applied.ok || !applied.data || !('operation' in applied.data)) {
    throw new Error(applied.ok ? 'stale preview' : applied.error);
  }
  let operation = applied.data.operation;
  while (operation.status === 'RUNNING' || operation.status === 'PENDING') {
    const next = await urls.runRedirectImportAction(operation.id);
    if (!next.ok || !next.data) throw new Error(next.ok ? 'no progress' : next.error);
    operation = next.data;
  }
  return { plan, operation };
}

function rowAt(plan: { rows: Array<{ line: number }> }, line: number) {
  const row = plan.rows.find((entry) => entry.line === line);
  if (!row) throw new Error(`no line ${line}`);
  return row as Awaited<ReturnType<typeof preview>>['rows'][number];
}

beforeAll(async () => {
  const role = await prisma.userRole.upsert({
    where: { slug: 'test-role-redirect-import' },
    update: {},
    create: { slug: 'test-role-redirect-import', name: 'Test Role redirect import', rank: 5 },
  });
  await prisma.user.upsert({
    where: { id: TEST_ACTOR.id },
    update: {},
    create: { id: TEST_ACTOR.id, email: TEST_ACTOR.email, name: TEST_ACTOR.name, roleId: role.id },
  });
  IN = await ensureTestCountry();
  AE = await ensureSecondCountry();
  invalidateCountryCache();

  const page = async (countryId: string, slug: string, status: 'PUBLISHED' | 'DRAFT' = 'PUBLISHED') => {
    const created = await prisma.page.create({
      data: { countryId, title: `Page ${slug}`, slug, status, publishedAt: status === 'PUBLISHED' ? past : null },
    });
    pageIds.push(created.id);
    return created.id;
  };
  autocad = await page(IN, P('autocad-X'));
  revit = await page(IN, P('revit-X'));
  aeAutocad = await page(AE, P('autocad-X'));
  draft = await page(IN, P('draft-X'), 'DRAFT');

  const settings = await prisma.urlSettings.upsert({ where: { id: 'singleton' }, update: {}, create: { id: 'singleton' } });
  previousResolver = settings.resolverEnabled;
  await runUrlScan(TEST_ACTOR);
  await prisma.urlSettings.update({ where: { id: 'singleton' }, data: { resolverEnabled: true, version: { increment: 1 } } });
});

afterAll(async () => {
  await prisma.urlRoute.deleteMany({ where: { OR: [{ entityId: { in: pageIds } }, { redirect: { createdAt: { gte: started } } }] } });
  await prisma.redirect.deleteMany({ where: { createdAt: { gte: started } } });
  await prisma.urlHistory.deleteMany({ where: { createdAt: { gte: started } } });
  await prisma.urlOperation.deleteMany({ where: { createdAt: { gte: started } } });
  await prisma.urlNotFound.deleteMany({ where: { firstSeenAt: { gte: started } } });
  await prisma.page.deleteMany({ where: { id: { in: pageIds } } });
  await prisma.urlSettings.update({
    where: { id: 'singleton' },
    data: { resolverEnabled: previousResolver, version: { increment: 1 } },
  });
  await prisma.auditLog.deleteMany({ where: { actorId: TEST_ACTOR.id } });
  await prisma.user.deleteMany({ where: { id: TEST_ACTOR.id } });
  await prisma.userRole.deleteMany({ where: { slug: 'test-role-redirect-import' } });
  await prisma.$disconnect();
});

describe('the file format', () => {
  it('reads exactly URL and Destination URL, and the sample is a valid file', () => {
    const sample = readRedirectCsv(REDIRECT_CSV_SAMPLE);
    expect(sample.ok).toBe(true);
    if (sample.ok) {
      expect(sample.rows).toEqual([
        { line: 2, url: '/old-autocad', destination: '/autocad' },
        { line: 3, url: '/old-revit', destination: '/revit' },
        { line: 4, url: '/ae/old-autocad', destination: '/ae/autocad' },
      ]);
    }
    expect(readRedirectCsv('Destination URL, url \n/b,/a').ok).toBe(true);
  });

  it('refuses other columns, and points an address file to the address import', () => {
    expect(readRedirectCsv('URL,Destination URL,Note\n/a,/b,x')).toMatchObject({ ok: false });
    expect(readRedirectCsv('Source,Target\n/a,/b')).toMatchObject({ ok: false });
    const addresses = readRedirectCsv('entity_id,country,target_path\nabc,IN,/x');
    expect(addresses.ok).toBe(false);
    if (!addresses.ok) expect(addresses.error).toMatch(/All URLs/);
    expect(readRedirectCsv('URL,Destination URL\n')).toMatchObject({ ok: false });
  });

  it('reports the line an editor sees, even after blank lines', () => {
    const parsed = readRedirectCsv('URL,Destination URL\n\n/a,/b\n\n"/c",/d\n');
    expect(parsed.ok && parsed.rows.map((row) => row.line)).toEqual([3, 5]);
  });
});

describe('validating the whole file', () => {
  it('accepts paths, same-site URLs and market prefixes, and stores content destinations by id', async () => {
    const plan = await preview(
      csv(
        [P('/old-autocad-X'), P('/autocad-X')],
        [P('http://localhost:3000/old-revit-X'), P('/revit-X')],
        [P('/ae/old-autocad-X'), P('/ae/autocad-X')],
        [P('/old-guide-X'), 'https://help.example.com/guide'],
      ),
    );
    expect(plan.counts.create).toBe(4);
    expect(rowAt(plan, 2)).toMatchObject({ status: 'create', target: { entityId: autocad, countryId: IN } });
    expect(rowAt(plan, 3)).toMatchObject({ status: 'create', source: P('/old-revit-X'), target: { entityId: revit } });
    expect(rowAt(plan, 4)).toMatchObject({ status: 'create', countryId: AE, target: { entityId: aeAutocad, countryId: AE } });
    expect(rowAt(plan, 5)).toMatchObject({ status: 'create', external: true, target: null });
  });

  it('refuses rows that cannot be redirects, with the reason', async () => {
    const plan = await preview(
      csv(
        ['https://elsewhere.example.org/x', '/y'],
        [P('/q-X?utm_source=a'), '/y'],
        ['/admin/x', '/y'],
        ['/', '/y'],
        ['/ae', '/y'],
        [P('/self-X'), P('/self-X/')],
        [P('/js-X'), 'javascript:alert(1)'],
        ['', '/y'],
      ),
    );
    expect(plan.rows.every((row) => row.status === 'invalid')).toBe(true);
    expect(rowAt(plan, 3).reason).toMatch(/query string/);
    expect(rowAt(plan, 4).reason).toMatch(/system route/);
    expect(rowAt(plan, 7).reason).toMatch(/itself/);
    expect(plan.writes).toBe(0);
  });

  it('never takes an address that belongs to content — published or draft', async () => {
    const plan = await preview(csv([P('/autocad-X'), P('/revit-X')], [P('/draft-X'), P('/revit-X')]));
    expect(rowAt(plan, 2)).toMatchObject({ status: 'conflict', resolvable: false });
    expect(rowAt(plan, 2).reason).toMatch(/never replaces content/);
    expect(rowAt(plan, 3)).toMatchObject({ status: 'conflict', resolvable: false });
  });

  it('treats one address twice: same destination is a duplicate, different destinations a conflict', async () => {
    const plan = await preview(
      csv(
        [P('/dup-X'), P('/revit-X')],
        [P('/DUP-X/'), P('/revit-X')],
        [P('/clash-X'), P('/revit-X')],
        [P('/clash-X'), P('/autocad-X')],
      ),
    );
    expect(rowAt(plan, 2).status).toBe('create');
    expect(rowAt(plan, 3).status).toBe('duplicate');
    expect(rowAt(plan, 4)).toMatchObject({ status: 'conflict', resolvable: false });
    expect(rowAt(plan, 5)).toMatchObject({ status: 'conflict', resolvable: false });
  });

  it('refuses loops within the file and flattens chains to where they end', async () => {
    const plan = await preview(
      csv(
        [P('/loop-a-X'), P('/loop-b-X')],
        [P('/loop-b-X'), P('/loop-a-X')],
        [P('/chain-1-X'), P('/chain-2-X')],
        [P('/chain-2-X'), P('/revit-X#pricing')],
      ),
    );
    expect(rowAt(plan, 2)).toMatchObject({ status: 'conflict' });
    expect(rowAt(plan, 2).reason).toMatch(/loop/);
    expect(rowAt(plan, 3)).toMatchObject({ status: 'conflict' });
    expect(rowAt(plan, 4)).toMatchObject({ status: 'create', target: { entityId: revit }, suffix: '#pricing' });
    expect(rowAt(plan, 4).finalDestination).toBe(P('/revit-X#pricing'));
    expect(rowAt(plan, 4).notes.join(' ')).toMatch(/line 5/);
  });

  it('refuses a loop that runs through an existing rule', async () => {
    const saved = await saveRedirect(null, (() => {
      const form = new FormData();
      form.set('source', P('/existing-loop-X'));
      form.set('destination', P('/incoming-loop-X'));
      form.set('type', 'PERMANENT');
      return form;
    })());
    expect(saved.ok).toBe(true);
    const plan = await preview(csv([P('/incoming-loop-X'), P('/existing-loop-X')]));
    expect(rowAt(plan, 2)).toMatchObject({ status: 'conflict' });
    expect(rowAt(plan, 2).reason).toMatch(/loop/);
  });

  it('says when a destination is not published yet or does not exist', async () => {
    const plan = await preview(csv([P('/to-draft-X'), P('/draft-X')], [P('/to-nowhere-X'), P('/nowhere-X')]));
    expect(rowAt(plan, 2).status).toBe('create');
    expect(rowAt(plan, 2).notes.join(' ')).toMatch(/not published/);
    expect(rowAt(plan, 3).notes.join(' ')).toMatch(/Nothing is registered/);
  });
});

describe('importing', () => {
  it('writes every row and the site answers 308 with the right Location, query and fragment kept', async () => {
    const { operation } = await importCsv(
      csv(
        [P('/old-autocad-X'), P('/autocad-X?edition=lt#buy')],
        [P('/old-revit-X'), P('/revit-X')],
        [P('/ae/old-autocad-X'), P('/ae/autocad-X')],
      ),
    );
    expect(operation.status).toBe('COMPLETED');
    expect(operation.succeeded).toBe(3);

    expect(await answer(P('/old-autocad-X'))).toEqual({ status: 308, location: P('/autocad-X?edition=lt#buy') });
    expect(await answer(P('/old-revit-X'), 'utm_source=mail')).toEqual({ status: 308, location: P('/revit-X?utm_source=mail') });
    expect(await answer(P('/ae/old-autocad-X'))).toEqual({ status: 308, location: P('/ae/autocad-X') });

    const rule = await prisma.redirect.findFirst({ where: { source: P('/old-autocad-X') } });
    expect(rule).toMatchObject({ targetEntityId: autocad, destinationSuffix: '?edition=lt#buy', origin: 'MANUAL', countryId: IN });
  });

  it('follows the content when it moves: the imported redirect never becomes a chain', async () => {
    const route = await prisma.urlRoute.findUniqueOrThrow({ where: { entityId_countryId: { entityId: autocad, countryId: IN } } });
    const moved = await urls.saveUrlAddressAction({
      kind: 'custom',
      entityId: autocad,
      countryId: IN,
      type: 'PAGE',
      relativePath: P('/software/autocad-X'),
      expectedVersion: route.version,
    });
    expect(moved.ok).toBe(true);
    expect(await answer(P('/old-autocad-X'))).toEqual({ status: 308, location: P('/software/autocad-X?edition=lt#buy') });
    expect(await answer(P('/autocad-X'))).toEqual({ status: 308, location: P('/software/autocad-X') });
  });

  it('is safe to run again: identical rows are unchanged and nothing is written twice', async () => {
    const text = csv([P('/old-revit-X'), P('/revit-X')], [P('/ae/old-autocad-X'), P('/ae/autocad-X')]);
    const plan = await preview(text);
    expect(plan.counts.unchanged).toBe(2);
    expect(plan.writes).toBe(0);
    const applied = await urls.applyRedirectImportAction({ text, type: 'PERMANENT', resolutions: {}, fingerprint: plan.fingerprint });
    expect(applied.ok).toBe(false);
    expect(await prisma.redirect.count({ where: { source: P('/old-revit-X') } })).toBe(1);
  });

  it('needs an explicit decision for a row that disagrees with an existing rule, and never overwrites silently', async () => {
    const text = csv([P('/old-revit-X'), P('/ae/autocad-X')]);
    const undecided = await preview(text);
    expect(rowAt(undecided, 2)).toMatchObject({ status: 'conflict', resolvable: true, resolution: null });
    expect(undecided.undecided).toBe(1);
    const refused = await urls.applyRedirectImportAction({ text, type: 'PERMANENT', resolutions: {}, fingerprint: undecided.fingerprint });
    expect(refused.ok).toBe(false);

    const kept = await preview(text, { '2': 'keep' });
    expect(rowAt(kept, 2).status).toBe('kept');
    expect(kept.writes).toBe(0);

    const { operation } = await importCsv(text, { '2': 'replace' });
    expect(operation.results[0]).toMatchObject({ ok: true, outcome: 'replaced' });
    expect(await answer(P('/old-revit-X'))).toEqual({ status: 308, location: P('/ae/autocad-X') });
  });

  it('writes 307 when the import is temporary', async () => {
    await importCsv(csv([P('/promo-X'), P('/revit-X')]), {}, 'TEMPORARY');
    expect(await answer(P('/promo-X'))).toEqual({ status: 307, location: P('/revit-X') });
  });

  it('re-points an existing rule that would otherwise become the first link of a chain', async () => {
    const form = new FormData();
    form.set('source', P('/legacy-X'));
    form.set('destination', P('/retired-X'));
    form.set('type', 'PERMANENT');
    expect((await saveRedirect(null, form)).ok).toBe(true);

    const text = csv([P('/retired-X'), P('/revit-X')]);
    const plan = await preview(text);
    expect(plan.repoints.map((entry) => entry.source)).toEqual([P('/legacy-X')]);
    await importCsv(text);
    expect(await answer(P('/legacy-X'))).toEqual({ status: 308, location: P('/revit-X') });
    const legacy = await prisma.redirect.findFirstOrThrow({ where: { source: P('/legacy-X') } });
    expect(legacy.targetEntityId).toBe(revit);
  });

  it('refuses a preview that went out of date, and returns the new one instead', async () => {
    const text = csv([P('/stale-X'), P('/revit-X')]);
    const plan = await preview(text);
    const form = new FormData();
    form.set('source', P('/stale-X'));
    form.set('destination', P('/autocad-other-X'));
    form.set('type', 'PERMANENT');
    expect((await saveRedirect(null, form)).ok).toBe(true);

    const applied = await urls.applyRedirectImportAction({ text, type: 'PERMANENT', resolutions: {}, fingerprint: plan.fingerprint });
    expect(applied.ok).toBe(true);
    expect(applied.ok && applied.data && 'stale' in applied.data).toBe(true);
    const rule = await prisma.redirect.findFirstOrThrow({ where: { source: P('/stale-X') } });
    expect(rule.destination).toBe(P('/autocad-other-X'));
  });

  it('runs a large file in batches with progress, and a retried batch writes nothing twice', async () => {
    const rows: Array<[string, string]> = Array.from({ length: 60 }, (_, index) => [P(`/bulk-${index}-X`), P('/revit-X')]);
    const text = csv(...rows);
    const plan = await preview(text);
    const applied = await urls.applyRedirectImportAction({ text, type: 'PERMANENT', resolutions: {}, fingerprint: plan.fingerprint });
    if (!applied.ok || !applied.data || !('operation' in applied.data)) throw new Error('not started');
    const started = applied.data.operation;
    expect(started.total).toBe(60);
    expect(started.processed).toBe(0);

    // Two people resuming at once take turns rather than applying a batch twice.
    const [first, second] = await Promise.all([
      urls.runRedirectImportAction(started.id),
      urls.runRedirectImportAction(started.id),
    ]);
    expect(first.ok && second.ok).toBe(true);
    let view = data(await urls.redirectImportAction(started.id));
    expect(view.processed).toBe(60);
    expect(view.status).toBe('COMPLETED');
    expect(view.succeeded).toBe(60);
    expect(await prisma.redirect.count({ where: { source: { startsWith: P('/bulk-').replace(/-$/, '') } } })).toBeGreaterThanOrEqual(60);
    for (let index = 0; index < 60; index += 1) {
      expect(await prisma.redirect.count({ where: { source: P(`/bulk-${index}-X`) } })).toBe(1);
    }

    // Running a finished import again changes nothing.
    view = data(await urls.runRedirectImportAction(started.id));
    expect(view.succeeded).toBe(60);

    const csvResult = await urls.redirectImportResultsCsvAction(started.id);
    expect(csvResult.ok && csvResult.data?.csv.split('\n').length).toBeGreaterThan(60);
  });
});

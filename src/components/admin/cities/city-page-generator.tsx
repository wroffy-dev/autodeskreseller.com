'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CheckCircle2, CircleSlash, Eye, MapPin, Search, Wand2, XCircle } from 'lucide-react';
import {
  generateCityPages,
  previewCityPages,
  searchGeneratorSources,
  type GeneratorPreview,
} from '@/lib/actions/cities';
import type { PlanRow, RunRow } from '@/lib/cities/generator';
import { CITY_PLACEHOLDERS, PLACEHOLDER_HELP } from '@/lib/cities/template';
import { CITY_STATUS_LABELS, type CityStatus } from '@/lib/cities/status';
import { MAX_CITIES_PER_REQUEST } from '@/lib/validation/city';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Checkbox, Field, Input, Select } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Alert, EmptyState } from '@/components/ui/states';
import { Spinner } from '@/components/ui/icons';
import { Table, TableWrap, Th, Td, Tr } from '@/components/ui/table';
import { ContentStatusBadge } from '@/components/admin/status-badge';
import { useToast } from '@/components/ui/toast';
import { formatNumber } from '@/lib/utils/format';

export type GeneratorMarket = { id: string; name: string; code: string; slug: string };
export type GeneratorCityOption = {
  id: string;
  name: string;
  slug: string;
  region: string | null;
  countryId: string;
  isActive: boolean;
  status: CityStatus;
};
type SourceOption = { id: string; title: string; slug: string; status: string; sectionCount: number };
export type GeneratorProductOption = { id: string; name: string; slug: string; countryIds: string[] };

const DEFAULT_TITLE = '{{page.title}} in {{city}}';

const PLAN_LABELS: Record<PlanRow['outcome'], { label: string; tone: BadgeTone }> = {
  create: { label: 'Will be created', tone: 'success' },
  exists: { label: 'Exists — kept', tone: 'neutral' },
  replace: { label: 'Will be regenerated', tone: 'warning' },
  conflict: { label: 'Address taken', tone: 'danger' },
  invalid: { label: 'Not possible', tone: 'danger' },
};

const RUN_LABELS: Record<RunRow['outcome'], { label: string; tone: BadgeTone }> = {
  created: { label: 'Created', tone: 'success' },
  replaced: { label: 'Regenerated', tone: 'warning' },
  skipped: { label: 'Skipped — exists', tone: 'neutral' },
  failed: { label: 'Failed', tone: 'danger' },
};

/**
 * The City Page Generator.
 *
 * Choose a market, a page of that market and some of its cities; see where
 * each copy would go and what is already there; then generate. Every copy is
 * a new, independent draft — nothing links it back to the source afterwards.
 * A page that already exists is kept unless the editor ticks it for
 * regeneration in the preview, sees what that replaces, and confirms.
 */
export function CityPageGenerator({
  markets,
  cities,
  initialCountryId,
  initialCityIds,
  initialSource,
  products = [],
  initialProductId = null,
}: {
  markets: GeneratorMarket[];
  cities: GeneratorCityOption[];
  initialCountryId: string;
  initialCityIds: string[];
  initialSource: SourceOption | null;
  /** Products that can be the subject of city/product pages, with the markets they are sold in. */
  products?: GeneratorProductOption[];
  initialProductId?: string | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [countryId, setCountryId] = React.useState(initialCountryId);
  const [source, setSource] = React.useState<SourceOption | null>(initialSource);
  const [query, setQuery] = React.useState('');
  const [options, setOptions] = React.useState<SourceOption[] | null>(null);
  const [searching, setSearching] = React.useState(false);
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set(initialCityIds));
  const [cityFilter, setCityFilter] = React.useState('');
  const [titleTemplate, setTitleTemplate] = React.useState(DEFAULT_TITLE);
  const [productId, setProductId] = React.useState<string>(initialProductId ?? '');
  const [replaceIds, setReplaceIds] = React.useState<Set<string>>(() => new Set());
  const [confirmReplace, setConfirmReplace] = React.useState(false);
  const [preview, setPreview] = React.useState<GeneratorPreview | null>(null);
  const [previewing, setPreviewing] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);
  const [progress, setProgress] = React.useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = React.useState<{ rows: RunRow[]; counts: Record<RunRow['outcome'], number> } | null>(
    null,
  );
  const [error, setError] = React.useState<string | null>(null);

  const market = markets.find((row) => row.id === countryId) ?? markets[0];
  const marketCities = cities.filter((city) => city.countryId === market?.id);
  const visibleCities = marketCities.filter((city) => {
    const needle = cityFilter.trim().toLowerCase();
    return (
      !needle ||
      city.name.toLowerCase().includes(needle) ||
      city.slug.includes(needle) ||
      (city.region ?? '').toLowerCase().includes(needle)
    );
  });
  const chosen = marketCities.filter((city) => selected.has(city.id));
  const marketProducts = products.filter((product) => market && product.countryIds.includes(market.id));

  // Anything that changes the plan makes the preview out of date.
  React.useEffect(() => {
    setPreview(null);
    setResult(null);
    setError(null);
    setReplaceIds(new Set());
    setConfirmReplace(false);
  }, [countryId, source?.id, selected, titleTemplate, productId]);

  // Pages of the market that can be copied, searched as the name is typed.
  React.useEffect(() => {
    if (!market) return;
    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(async () => {
      const found = await searchGeneratorSources({ countryId: market.id, q: query });
      if (cancelled) return;
      setSearching(false);
      if (found.ok) setOptions(found.data ?? []);
      else setError(found.error);
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [market, query]);

  function changeCountry(next: string) {
    setCountryId(next);
    setSource(null);
    setSelected(new Set());
    setProductId('');
  }

  function toggleCity(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectVisible(all: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      for (const city of visibleCities) {
        if (all) next.add(city.id);
        else next.delete(city.id);
      }
      return next;
    });
  }

  async function runPreview(nextReplace: Set<string> = replaceIds) {
    if (!market || !source || chosen.length === 0) return;
    setPreviewing(true);
    setError(null);
    const planned = await previewCityPages({
      sourcePageId: source.id,
      countryId: market.id,
      cityIds: chosen.map((city) => city.id),
      titleTemplate,
      productId: productId || null,
      replaceCityIds: [...nextReplace],
    });
    setPreviewing(false);
    if (!planned.ok) {
      setError(planned.error);
      return;
    }
    setPreview(planned.data ?? null);
  }

  /** Ticks or unticks one existing page for regeneration, and refreshes the impact preview. */
  function toggleReplace(cityId: string) {
    const next = new Set(replaceIds);
    if (next.has(cityId)) next.delete(cityId);
    else next.add(cityId);
    setReplaceIds(next);
    setConfirmReplace(false);
    void runPreview(next);
  }

  async function generate() {
    if (!market || !source || !preview) return;
    setConfirming(false);
    setError(null);
    // Every chosen city is sent, in parts, so the summary accounts for the
    // skipped ones too. The server checks each one again before writing.
    const ids = preview.rows.map((row) => row.cityId);
    const replacing = new Set(preview.rows.filter((row) => row.outcome === 'replace').map((row) => row.cityId));
    const rows: RunRow[] = [];
    const counts = { created: 0, replaced: 0, skipped: 0, failed: 0 };
    let batchId: string | null = null;
    setProgress({ done: 0, total: ids.length });
    for (let index = 0; index < ids.length; index += MAX_CITIES_PER_REQUEST) {
      const part = ids.slice(index, index + MAX_CITIES_PER_REQUEST);
      const run = await generateCityPages({
        sourcePageId: source.id,
        countryId: market.id,
        cityIds: part,
        titleTemplate,
        productId: productId || null,
        replaceCityIds: part.filter((id) => replacing.has(id)),
        confirmReplace: confirmReplace && part.some((id) => replacing.has(id)),
        batchId,
      });
      if (!run.ok) {
        setError(`${run.error}${rows.length > 0 ? ` ${counts.created} page(s) were created before this stopped.` : ''}`);
        break;
      }
      batchId = run.data!.batchId;
      rows.push(...run.data!.rows);
      counts.created += run.data!.counts.created;
      counts.replaced += run.data!.counts.replaced;
      counts.skipped += run.data!.counts.skipped;
      counts.failed += run.data!.counts.failed;
      setProgress({ done: Math.min(ids.length, index + part.length), total: ids.length });
    }
    setProgress(null);
    setPreview(null);
    setResult({ rows, counts });
    if (rows.length > 0) {
      toast(
        `Created ${counts.created}${counts.replaced ? `, regenerated ${counts.replaced}` : ''}, skipped ${counts.skipped}${counts.failed ? `, ${counts.failed} failed` : ''}.`,
        counts.failed > 0 ? 'error' : 'success',
      );
    }
    router.refresh();
  }

  if (markets.length === 0) {
    return (
      <EmptyState
        icon={<MapPin className="h-5 w-5" />}
        title="No market to work in"
        description="You do not have access to any active market."
      />
    );
  }

  const creatable = preview?.counts.create ?? 0;
  const replacing = preview?.counts.replace ?? 0;
  const writable = creatable + replacing;
  const running = progress !== null;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="1. What to copy" description="A page of the market, outside every city. Its sections come across whole." />
        <CardBody className="space-y-4">
          {markets.length > 1 ? (
            <Field label="Country" htmlFor="generator-country">
              <Select
                id="generator-country"
                value={market?.id}
                onChange={(event) => changeCountry(event.target.value)}
                disabled={running}
              >
                {markets.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}

          {source ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-brand/30 bg-brand/[0.04] px-3 py-2.5">
              <div className="min-w-0">
                <p className="font-medium text-content">{source.title}</p>
                <p className="font-mono text-xs text-muted">
                  /{source.slug} · {source.sectionCount} section{source.sectionCount === 1 ? '' : 's'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <ContentStatusBadge status={source.status} />
                <Button size="sm" variant="outline" onClick={() => setSource(null)} disabled={running}>
                  Change
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <Field label="Source page" htmlFor="generator-source">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
                  <Input
                    id="generator-source"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search pages by title or URL"
                    className="pl-9"
                    autoComplete="off"
                  />
                </div>
              </Field>
              <ul className="max-h-72 divide-y divide-hairline overflow-y-auto rounded-lg border border-hairline" aria-busy={searching}>
                {options === null ? (
                  <li className="px-3 py-3 text-sm text-muted">Loading pages…</li>
                ) : options.length === 0 ? (
                  <li className="px-3 py-3 text-sm text-muted">No page matches. City pages cannot be a source.</li>
                ) : (
                  options.map((option) => (
                    <li key={option.id}>
                      <button
                        type="button"
                        onClick={() => setSource(option)}
                        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-muted/5"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-content">{option.title}</span>
                          <span className="block truncate font-mono text-xs text-muted">/{option.slug}</span>
                        </span>
                        <ContentStatusBadge status={option.status} />
                      </button>
                    </li>
                  ))
                )}
              </ul>
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="2. Which cities"
          description={
            marketCities.length > 0
              ? `${formatNumber(chosen.length)} of ${formatNumber(marketCities.length)} chosen.`
              : `${market?.name ?? 'This market'} has no cities yet.`
          }
          actions={
            marketCities.length > 0 ? (
              <>
                <Button size="sm" variant="ghost" onClick={() => selectVisible(true)} disabled={running}>
                  Select all
                </Button>
                <Button size="sm" variant="ghost" onClick={() => selectVisible(false)} disabled={running}>
                  Clear
                </Button>
              </>
            ) : null
          }
        />
        <CardBody className="space-y-3">
          {marketCities.length === 0 ? (
            <p className="text-sm text-muted">
              <Link href="/admin/cities/new" className="font-medium text-brand hover:underline">
                Add a city
              </Link>{' '}
              first.
            </p>
          ) : (
            <>
              {marketCities.length > 8 ? (
                <Input
                  value={cityFilter}
                  onChange={(event) => setCityFilter(event.target.value)}
                  placeholder="Filter cities"
                  aria-label="Filter cities"
                />
              ) : null}
              <ul className="grid max-h-80 gap-1 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
                {visibleCities.map((city) => (
                  <li key={city.id}>
                    <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-muted/5">
                      <input
                        type="checkbox"
                        checked={selected.has(city.id)}
                        onChange={() => toggleCity(city.id)}
                        disabled={running}
                        className="h-4 w-4 rounded border-hairline text-brand focus:ring-brand/30"
                      />
                      <span className="min-w-0 text-sm text-content">
                        {city.name}
                        <span className="ml-1 font-mono text-xs text-muted">/{city.slug}</span>
                      </span>
                      {city.status !== 'PUBLISHED' ? <Badge tone="neutral">{CITY_STATUS_LABELS[city.status]}</Badge> : null}
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="3. How the copies start" description="Placeholders are filled in once, when each copy is made — never again." />
        <CardBody className="space-y-4">
          <Field
            label="Title of each generated page"
            htmlFor="generator-title"
            hint="Leave blank to keep the source’s title (with its placeholders filled in)."
          >
            <Input
              id="generator-title"
              value={titleTemplate}
              onChange={(event) => setTitleTemplate(event.target.value)}
              maxLength={200}
              disabled={running}
            />
          </Field>
          <details className="rounded-lg border border-hairline px-3 py-2 text-sm">
            <summary className="cursor-pointer font-medium text-content">Placeholders you can use</summary>
            <p className="mt-2 text-xs text-muted">
              Anywhere in the source’s sections, its title and its SEO fields. They are replaced by each city’s values.
            </p>
            <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
              {CITY_PLACEHOLDERS.map((name) => (
                <div key={name} className="flex gap-2">
                  <dt className="font-mono text-content">{`{{${name}}}`}</dt>
                  <dd className="text-muted">{PLACEHOLDER_HELP[name]}</dd>
                </div>
              ))}
            </dl>
          </details>
          {marketProducts.length > 0 ? (
            <Field
              label="Product (optional)"
              htmlFor="generator-product"
              hint="For city/product pages such as /delhi/autocad: each page is recorded as that city’s page for the product, and {{product}} is filled in. Leave blank for any other page."
            >
              <Select
                id="generator-product"
                value={productId}
                onChange={(event) => setProductId(event.target.value)}
                disabled={running}
              >
                <option value="">No product</option>
                {marketProducts.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <Alert tone="info" title="Every generated page is a draft">
            Pages that differ only by the city’s name help nobody. Review each copy, add what is genuinely local —
            and only what is true — then publish it on its own. The generator never invents offices, addresses,
            reviews or certifications.
          </Alert>
        </CardBody>
      </Card>

      {error ? (
        <Alert tone="danger" title="Could not continue">
          {error}
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-center justify-end gap-3">
        <Button
          variant="outline"
          onClick={() => runPreview()}
          disabled={!source || chosen.length === 0 || previewing || running}
        >
          {previewing ? <Spinner className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
          Preview {chosen.length > 0 ? `${formatNumber(chosen.length)} ` : ''}
          {chosen.length === 1 ? 'city' : 'cities'}
        </Button>
        <Button
          onClick={() => setConfirming(true)}
          disabled={!preview || writable === 0 || running || previewing || (replacing > 0 && !confirmReplace)}
        >
          {running ? <Spinner className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Wand2 className="h-4 w-4" aria-hidden="true" />}
          {running
            ? `Generating ${progress!.done} of ${progress!.total}…`
            : `Generate ${writable > 0 ? formatNumber(writable) : ''} page${writable === 1 ? '' : 's'}`}
        </Button>
      </div>

      {preview && replacing > 0 ? (
        <Alert tone="warning" title={`${replacing} existing page${replacing === 1 ? '' : 's'} will be regenerated`}>
          <p>
            Their title, search fields and every section are replaced by a fresh copy of the source. They keep their
            address, status and id; what they held now is kept in this run’s record. Published pages show the new content
            straight away.
          </p>
          <div className="mt-2">
            <Checkbox
              checked={confirmReplace}
              onChange={(event) => setConfirmReplace(event.target.checked)}
              label={`Yes, replace the content of ${replacing === 1 ? 'this page' : `these ${replacing} pages`}`}
            />
          </div>
        </Alert>
      ) : null}

      {preview ? <PreviewTable preview={preview} replaceIds={replaceIds} onToggleReplace={toggleReplace} busy={previewing || running} /> : null}
      {result ? <ResultTable result={result} /> : null}

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={generate}
        tone="primary"
        title={`Generate ${formatNumber(writable)} page${writable === 1 ? '' : 's'}?`}
        message={`${creatable > 0 ? `${formatNumber(creatable)} new draft page${creatable === 1 ? '' : 's'} copied from “${source?.title ?? ''}”, independent from the moment ${creatable === 1 ? 'it exists' : 'they exist'}. ` : ''}${replacing > 0 ? `${formatNumber(replacing)} existing page${replacing === 1 ? ' is' : 's are'} regenerated, as you chose. ` : ''}${preview && preview.rows.length > writable ? `${preview.rows.length - writable} cit${preview.rows.length - writable === 1 ? 'y is' : 'ies are'} left as ${preview.rows.length - writable === 1 ? 'it is' : 'they are'}.` : ''}`}
        confirmLabel="Generate"
      />
    </div>
  );
}

function PreviewTable({
  preview,
  replaceIds,
  onToggleReplace,
  busy,
}: {
  preview: GeneratorPreview;
  replaceIds: ReadonlySet<string>;
  onToggleReplace: (cityId: string) => void;
  busy: boolean;
}) {
  return (
    <Card>
      <CardHeader
        title="Impact preview"
        description={`${preview.counts.create} to create, ${preview.counts.replace} to regenerate, ${preview.counts.exists} kept as they are, ${preview.counts.conflict + preview.counts.invalid} not possible. Nothing has been written yet.${preview.product ? ` Each page is recorded as the city’s ${preview.product.name} page.` : ''}`}
      />
      {preview.source.placeholders.length > 0 ? (
        <p className="border-b border-hairline px-4 py-2 text-xs text-muted sm:px-5">
          The source uses {preview.source.placeholders.map((name) => `{{${name}}}`).join(', ')}.
        </p>
      ) : (
        <p className="border-b border-hairline px-4 py-2 text-xs text-muted sm:px-5">
          The source uses no placeholders: each copy starts with the same content, ready to localise.
        </p>
      )}
      <TableWrap>
        <Table>
          <caption className="sr-only">Where each copy would go</caption>
          <thead>
            <tr>
              <Th>City</Th>
              <Th>URL</Th>
              <Th>Title</Th>
              <Th>Result</Th>
            </tr>
          </thead>
          <tbody>
            {preview.rows.map((row) => (
              <Tr key={row.cityId}>
                <Td>
                  <span className="font-medium text-content">{row.city}</span>
                  {!row.cityActive ? (
                    <Badge tone="neutral" className="ml-1.5">
                      City not public
                    </Badge>
                  ) : null}
                </Td>
                <Td>
                  <code className="font-mono text-xs text-content">{row.path}</code>
                </Td>
                <Td className="text-sm">{row.title}</Td>
                <Td>
                  <Badge tone={PLAN_LABELS[row.outcome].tone}>{PLAN_LABELS[row.outcome].label}</Badge>
                  {row.existing && !row.existing.deleted ? (
                    <span className="ml-1.5 inline-flex flex-wrap gap-1 align-middle">
                      <ContentStatusBadge status={row.existing.status} />
                      {row.existing.editedSince ? <Badge tone="warning">Edited since generated</Badge> : null}
                      {!row.existing.fromThisSource ? <Badge tone="neutral">Not from this source</Badge> : null}
                    </span>
                  ) : null}
                  {row.reason ? <p className="mt-1 max-w-sm text-xs text-muted">{row.reason}</p> : null}
                  {row.existing && !row.existing.deleted && (row.outcome === 'exists' || row.outcome === 'replace') ? (
                    <div className="mt-1.5">
                      <Checkbox
                        checked={replaceIds.has(row.cityId)}
                        onChange={() => onToggleReplace(row.cityId)}
                        disabled={busy}
                        label="Regenerate this page"
                      />
                    </div>
                  ) : null}
                  {row.holder?.editHref ? (
                    <Link href={row.holder.editHref} className="mt-0.5 inline-block text-xs font-medium text-brand hover:underline">
                      Open it
                    </Link>
                  ) : null}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </TableWrap>
    </Card>
  );
}

function ResultTable({ result }: { result: { rows: RunRow[]; counts: Record<RunRow['outcome'], number> } }) {
  const icon = { created: CheckCircle2, replaced: CheckCircle2, skipped: CircleSlash, failed: XCircle };
  return (
    <Card>
      <CardHeader
        title="Summary"
        description={`Created ${result.counts.created} · Regenerated ${result.counts.replaced} · Skipped existing ${result.counts.skipped} · Failed ${result.counts.failed}`}
      />
      <TableWrap>
        <Table>
          <caption className="sr-only">What happened in each city</caption>
          <thead>
            <tr>
              <Th>City</Th>
              <Th>URL</Th>
              <Th>Outcome</Th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row) => {
              const Icon = icon[row.outcome];
              return (
                <Tr key={row.cityId}>
                  <Td className="font-medium text-content">{row.city}</Td>
                  <Td>
                    {row.pageId ? (
                      <Link href={`/admin/pages/${row.pageId}`} className="font-mono text-xs text-brand hover:underline">
                        {row.path}
                      </Link>
                    ) : (
                      <code className="font-mono text-xs text-content">{row.path}</code>
                    )}
                  </Td>
                  <Td>
                    <span className="inline-flex items-center gap-1.5">
                      <Icon className="h-4 w-4 text-muted" aria-hidden="true" />
                      <Badge tone={RUN_LABELS[row.outcome].tone}>{RUN_LABELS[row.outcome].label}</Badge>
                    </span>
                    {row.reason ? <p className="mt-1 max-w-sm text-xs text-muted">{row.reason}</p> : null}
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      </TableWrap>
    </Card>
  );
}

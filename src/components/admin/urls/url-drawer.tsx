'use client';

import * as React from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowRight, CheckCircle2, ExternalLink, History, Link2, RotateCcw } from 'lucide-react';
import { Drawer } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/states';
import { Spinner } from '@/components/ui/icons';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils/cn';
import { formatDate } from '@/lib/utils/format';
import {
  checkUrlPathAction,
  previewResetAction,
  saveUrlAddressAction,
  urlDetailAction,
} from '@/lib/actions/urls';
import type { PathCheckResult, UrlDetail, UrlRow } from '@/lib/urls/manager';
import { REDIRECT_TYPE_LABELS } from '@/lib/urls/types';
import { useManager } from './manager-context';
import { useDebounced } from './use-query-state';
import { ModeBadge, PathText, StateBadge } from './shared';
import { ReferencesPanel } from './references-panel';

type Mode = 'pattern' | 'custom';

const REASONS: Record<string, string> = {
  CREATE: 'Created',
  EDIT: 'Edited',
  SLUG: 'Slug changed',
  PATTERN: 'Pattern',
  BULK: 'Bulk change',
  IMPORT: 'CSV import',
  RESTORE: 'Restored',
  DELETE: 'Removed',
  BACKFILL: 'First scan',
  MARKET: 'Market prefix',
};

export function UrlDrawer({
  row,
  initialPath = null,
  onClose,
  onChanged,
}: {
  row: UrlRow | null;
  /** A full path to start from as a custom address — a suggested alternative, say. Saved only by the user. */
  initialPath?: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { overview } = useManager();
  const { toast } = useToast();
  const [detail, setDetail] = React.useState<UrlDetail | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [mode, setMode] = React.useState<Mode>('pattern');
  const [custom, setCustom] = React.useState('');
  const [slug, setSlug] = React.useState('');
  const [check, setCheck] = React.useState<PathCheckResult | null>(null);
  const [checking, setChecking] = React.useState(false);
  const [saving, setSaving] = React.useState<'path' | 'slug' | 'reset' | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [reset, setReset] = React.useState<
    { ok: true; from: string | null; to: string; redirect: boolean; unchanged: boolean } | { ok: false; error: string } | null
  >(null);
  const [moved, setMoved] = React.useState<{ oldPath: string; newPath: string; countryId: string } | null>(null);

  const initialRef = React.useRef(initialPath);
  initialRef.current = initialPath;

  const load = React.useCallback(async (target: UrlRow, opening = false) => {
    setLoadError(null);
    const result = await urlDetailAction({ entityId: target.entityId, countryId: target.countryId, type: target.type });
    if (!result.ok || !result.data) {
      setLoadError(result.ok ? 'Not available.' : result.error);
      return;
    }
    const next = result.data;
    setDetail(next);
    setMode(next.row.mode === 'CUSTOM' ? 'custom' : 'pattern');
    setCustom(next.customPath ?? (next.row.path ? next.row.path.slice(next.row.marketPrefix.length) || '/' : ''));
    const preset = opening ? initialRef.current : null;
    if (preset) {
      setMode('custom');
      setCustom(
        next.row.marketPrefix && preset.toLowerCase().startsWith(`${next.row.marketPrefix}/`)
          ? preset.slice(next.row.marketPrefix.length)
          : preset,
      );
    }
    setSlug(next.row.slug);
    setCheck(null);
    setError(null);
    setReset(null);
  }, []);

  React.useEffect(() => {
    setDetail(null);
    setMoved(null);
    if (row) void load(row, true);
  }, [row, load]);

  // Live availability, as the path is typed.
  const typed = useDebounced(custom, 350);
  React.useEffect(() => {
    if (!detail || mode !== 'custom' || !typed.trim()) {
      setCheck(null);
      return;
    }
    let current = true;
    setChecking(true);
    checkUrlPathAction({ entityId: detail.row.entityId, countryId: detail.row.countryId, type: detail.row.type, path: typed })
      .then((result) => {
        if (!current) return;
        setCheck(result.ok && result.data ? result.data : { ok: false, error: result.ok ? 'Could not check.' : result.error });
      })
      .finally(() => current && setChecking(false));
    return () => {
      current = false;
    };
  }, [typed, mode, detail]);

  const editable = Boolean(detail?.row.canEdit && overview.resolverEnabled);

  async function save(kind: 'custom' | 'reset' | 'slug') {
    if (!detail) return;
    setSaving(kind === 'custom' ? 'path' : kind);
    setError(null);
    const base = {
      entityId: detail.row.entityId,
      countryId: detail.row.countryId,
      type: detail.row.type,
      expectedVersion: detail.row.version,
    };
    const result = await saveUrlAddressAction(
      kind === 'custom' ? { ...base, kind, relativePath: custom } : kind === 'slug' ? { ...base, kind, slug } : { ...base, kind },
    );
    setSaving(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    toast(result.message ?? 'Saved.', 'success');
    if (result.data?.changed && result.data.oldPath) {
      setMoved({ oldPath: result.data.oldPath, newPath: result.data.newPath, countryId: detail.row.countryId });
    }
    onChanged();
    await load(detail.row as UrlRow);
  }

  async function previewResetNow() {
    if (!detail) return;
    const result = await previewResetAction({
      entityId: detail.row.entityId,
      countryId: detail.row.countryId,
      type: detail.row.type,
    });
    setReset(result.ok && result.data ? result.data : { ok: false, error: result.ok ? 'Could not preview.' : result.error });
  }

  const finalPath =
    mode === 'custom'
      ? check?.ok
        ? check.path
        : null
      : detail?.pattern.path ?? null;
  const origin = detail?.origin ?? overview.origin;

  return (
    <Drawer
      open={Boolean(row)}
      onClose={onClose}
      width="lg"
      title={detail?.row.label ?? row?.label ?? 'Address'}
      description={
        detail ? (
          <span className="flex flex-wrap items-center gap-1.5">
            <Badge tone="neutral">{detail.row.typeLabel}</Badge>
            <StateBadge state={detail.row.state} />
            <ModeBadge mode={detail.row.mode} />
            {overview.markets.length > 1 ? <Badge tone="info">{detail.row.countryName}</Badge> : null}
          </span>
        ) : undefined
      }
      footer={
        detail ? (
          <>
            <Link href={detail.row.editHref} className="mr-auto text-sm font-medium text-brand hover:underline">
              Edit the content
            </Link>
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
            {mode === 'custom' ? (
              <Button
                onClick={() => save('custom')}
                disabled={!editable || saving !== null || !check?.ok || check.unchanged}
              >
                {saving === 'path' ? <Spinner className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                Save address
              </Button>
            ) : (
              <Button
                onClick={() => save('reset')}
                disabled={!editable || saving !== null || (detail.row.mode === 'PATTERN' && detail.row.path === detail.pattern.path)}
              >
                {saving === 'reset' ? <Spinner className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                Follow the pattern
              </Button>
            )}
          </>
        ) : undefined
      }
    >
      {loadError ? (
        <Alert tone="danger" title="Could not open this address">
          {loadError}
        </Alert>
      ) : !detail ? (
        <div className="flex items-center gap-2 py-10 text-sm text-muted" role="status">
          <Spinner className="h-4 w-4 animate-spin" aria-hidden="true" />
          Loading…
        </div>
      ) : (
        <div className="space-y-6">
          <section aria-labelledby="current-url">
            <h3 id="current-url" className="text-xs font-semibold uppercase tracking-wide text-muted">
              Current URL
            </h3>
            {detail.row.path ? (
              <div className="mt-1.5 flex items-start gap-2 rounded-lg border border-hairline bg-muted/5 px-3 py-2">
                <Link2 className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
                <span className="min-w-0 break-all font-mono text-xs text-content">
                  {origin}
                  {detail.row.path === '/' ? '' : detail.row.path}
                </span>
                {detail.row.state === 'live' ? (
                  <a
                    href={detail.row.path}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-auto shrink-0 text-muted hover:text-brand"
                    aria-label="Open the live page in a new tab"
                  >
                    <ExternalLink className="h-4 w-4" aria-hidden="true" />
                  </a>
                ) : null}
              </div>
            ) : (
              <Alert tone="warning" className="mt-1.5">
                This content has no address yet, so it is not reachable. Give it one below.
              </Alert>
            )}
            {detail.row.state !== 'live' && detail.row.path ? (
              <p className="mt-1.5 text-xs text-muted">
                Not public yet: the address is reserved for it, and answers 404 until it is published.
              </p>
            ) : null}
          </section>

          {!overview.resolverEnabled ? (
            <Alert tone="info">
              Switch the registry on to change addresses here. Until then the site is answered by the previous
              router, and a change made here would not match what visitors get.
            </Alert>
          ) : !detail.row.canEdit ? (
            <Alert tone="info">You can see this address but not change it: that needs permission to edit this kind of content.</Alert>
          ) : null}

          <fieldset disabled={!editable} className="space-y-4">
            <legend className="text-xs font-semibold uppercase tracking-wide text-muted">Address</legend>

            <div role="radiogroup" aria-label="How the address is decided" className="grid gap-2 sm:grid-cols-2">
              {(
                [
                  ['pattern', 'Follow the pattern', `${detail.pattern.value} → ${detail.pattern.path}`],
                  ['custom', 'Custom address', 'An explicit URL for this market, kept through pattern changes'],
                ] as const
              ).map(([value, label, hint]) => (
                <label
                  key={value}
                  className={cn(
                    'flex cursor-pointer gap-2.5 rounded-xl border p-3 text-sm transition-colors',
                    mode === value ? 'border-brand bg-brand/[0.04]' : 'border-hairline hover:bg-muted/5',
                  )}
                >
                  <input
                    type="radio"
                    name="address-mode"
                    value={value}
                    checked={mode === value}
                    onChange={() => setMode(value)}
                    className="mt-0.5 h-4 w-4 text-brand"
                  />
                  <span className="min-w-0">
                    <span className="block font-medium text-content">{label}</span>
                    <span className="block break-words text-xs text-muted">{hint}</span>
                  </span>
                </label>
              ))}
            </div>

            <p className="text-xs text-muted">
              Inherited pattern:{' '}
              <code className="font-mono text-content">{detail.pattern.value}</code>{' '}
              {detail.pattern.source === 'market'
                ? `(${detail.row.countryName}’s own pattern)`
                : detail.pattern.source === 'global'
                  ? '(the global pattern)'
                  : '(the built-in default)'}
            </p>

            {mode === 'custom' ? (
              <Field
                label="Custom path"
                htmlFor="custom-path"
                hint="Letters, numbers, hyphens and slashes. Nested paths are fine: /software/autocad-lt."
                error={check && !check.ok ? check.error : undefined}
              >
                <div className="flex items-stretch overflow-hidden rounded-lg border border-hairline focus-within:ring-2 focus-within:ring-brand/30">
                  {detail.row.marketPrefix ? (
                    <span className="flex items-center border-r border-hairline bg-muted/5 px-2.5 font-mono text-xs text-muted">
                      {detail.row.marketPrefix}
                    </span>
                  ) : null}
                  <input
                    id="custom-path"
                    value={custom}
                    onChange={(event) => setCustom(event.target.value)}
                    spellCheck={false}
                    autoCapitalize="none"
                    autoComplete="off"
                    className="min-w-0 flex-1 bg-surface px-3 py-2 font-mono text-sm text-content outline-none"
                    aria-describedby="custom-path-status"
                  />
                </div>
                <div id="custom-path-status" aria-live="polite" className="mt-1.5 text-xs">
                  {checking ? (
                    <span className="inline-flex items-center gap-1 text-muted">
                      <Spinner className="h-3 w-3 animate-spin" aria-hidden="true" /> Checking…
                    </span>
                  ) : check?.ok ? (
                    <span className="inline-flex items-center gap-1 text-emerald-700">
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                      {check.unchanged ? 'This is the current address.' : check.reclaims ? 'Available — an earlier address of this content.' : 'Available.'}
                      {check.notes.length > 0 ? ` ${check.notes.join(' ')}` : ''}
                    </span>
                  ) : check && !check.ok && check.conflict?.editHref ? (
                    <Link href={check.conflict.editHref} className="font-medium text-brand hover:underline">
                      Open {check.conflict.description}
                    </Link>
                  ) : null}
                </div>
              </Field>
            ) : null}

            <div className="rounded-xl border border-hairline p-3">
              <p className="text-xs font-medium text-muted">Final URL</p>
              <p className="mt-1 break-all font-mono text-sm text-content">
                {finalPath ? `${origin}${finalPath === '/' ? '' : finalPath}` : '—'}
              </p>
              {finalPath && detail.row.path && finalPath !== detail.row.path ? (
                <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                  {detail.row.state === 'live' || detail.row.state === 'archived' ? (
                    <>
                      <PathText path={detail.row.path} />
                      <ArrowRight className="h-3 w-3" aria-hidden="true" />
                      <span>
                        will redirect permanently ({REDIRECT_TYPE_LABELS.PERMANENT}) to the new address, and so will
                        every earlier address of this content.
                      </span>
                    </>
                  ) : (
                    <span>The current address is released without a redirect: it has never been public.</span>
                  )}
                </p>
              ) : null}
            </div>

            {detail.slugScope !== 'none' ? (
              <Field
                label={detail.slugScope === 'market' ? 'Page path (its slug)' : 'Slug'}
                htmlFor="content-slug"
                hint={
                  detail.row.type === 'PRODUCT'
                    ? 'Shared by every market. Markets whose address follows the pattern move with it; custom addresses stay.'
                    : 'Changing the slug moves an address that follows the pattern.'
                }
              >
                <div className="flex gap-2">
                  <Input
                    id="content-slug"
                    value={slug}
                    onChange={(event) => setSlug(event.target.value)}
                    spellCheck={false}
                    autoCapitalize="none"
                    className="font-mono text-sm"
                  />
                  <Button
                    variant="outline"
                    onClick={() => save('slug')}
                    disabled={!editable || saving !== null || !slug.trim() || slug.trim() === detail.row.slug}
                  >
                    {saving === 'slug' ? <Spinner className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                    Change slug
                  </Button>
                </div>
              </Field>
            ) : null}

            {detail.row.mode === 'CUSTOM' ? (
              <div className="rounded-xl border border-dashed border-hairline p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-content">Reset to the inherited pattern</p>
                  <Button size="sm" variant="outline" onClick={previewResetNow} disabled={!editable}>
                    <RotateCcw className="h-4 w-4" aria-hidden="true" />
                    Preview the reset
                  </Button>
                </div>
                {reset ? (
                  reset.ok ? (
                    <div className="mt-2 space-y-2 text-xs text-muted">
                      <p className="flex flex-wrap items-center gap-1.5">
                        <PathText path={reset.from} />
                        <ArrowRight className="h-3 w-3" aria-hidden="true" />
                        <PathText path={reset.to} />
                      </p>
                      <p>
                        {reset.unchanged
                          ? 'The address stays the same; it simply follows the pattern from now on.'
                          : reset.redirect
                            ? 'The current address will redirect permanently to the pattern address.'
                            : 'No redirect is needed: the current address has never been public.'}
                      </p>
                      <Button size="sm" onClick={() => save('reset')} disabled={saving !== null}>
                        Reset now
                      </Button>
                    </div>
                  ) : (
                    <p className="mt-2 text-xs font-medium text-red-600" role="alert">
                      {reset.error}
                    </p>
                  )
                ) : null}
              </div>
            ) : null}
          </fieldset>

          {error ? (
            <Alert tone="danger" title="Not saved">
              {error}
            </Alert>
          ) : null}

          {moved ? (
            <ReferencesPanel
              changes={[moved]}
              onDone={() => setMoved(null)}
            />
          ) : null}

          {detail.canonicalOverride ? (
            <Alert tone="warning" title="This content sets its own canonical URL">
              <p className="break-all">
                <code className="font-mono text-xs">{detail.canonicalOverride}</code>
              </p>
              <p className="mt-1">
                An explicit canonical is left exactly as written when the address changes. Review it on the
                content’s SEO tab if it pointed at the old address.
              </p>
            </Alert>
          ) : null}

          <section aria-labelledby="redirects-in">
            <h3 id="redirects-in" className="text-xs font-semibold uppercase tracking-wide text-muted">
              Redirects to this content ({detail.redirectsIn.length})
            </h3>
            {detail.redirectsIn.length === 0 ? (
              <p className="mt-1.5 text-sm text-muted">None.</p>
            ) : (
              <ul className="mt-1.5 divide-y divide-hairline rounded-lg border border-hairline">
                {detail.redirectsIn.map((redirect) => (
                  <li key={redirect.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                    <PathText path={redirect.source} />
                    <Badge tone={redirect.origin === 'AUTOMATIC' ? 'neutral' : 'brand'}>
                      {redirect.origin === 'AUTOMATIC' ? 'Automatic' : 'Manual'}
                    </Badge>
                    {!redirect.isActive ? <Badge tone="warning">Disabled</Badge> : null}
                    <span className="ml-auto text-xs text-muted">{redirect.hitCount} hits</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="url-history">
            <h3 id="url-history" className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
              <History className="h-3.5 w-3.5" aria-hidden="true" />
              History
            </h3>
            {detail.history.length === 0 ? (
              <p className="mt-1.5 text-sm text-muted">No changes recorded.</p>
            ) : (
              <ol className="mt-1.5 space-y-2">
                {detail.history.map((entry) => (
                  <li key={entry.id} className="rounded-lg border border-hairline px-3 py-2 text-xs">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <PathText path={entry.oldPath} />
                      <ArrowRight className="h-3 w-3 text-muted" aria-hidden="true" />
                      {entry.newPath ? <PathText path={entry.newPath} /> : <span className="text-muted">removed</span>}
                    </div>
                    <p className="mt-1 text-muted">
                      {REASONS[entry.reason] ?? entry.reason} · {entry.actorEmail ?? 'system'} · {formatDate(entry.createdAt)}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </section>

          {detail.row.state !== 'live' ? null : detail.row.path && detail.row.path !== detail.pattern.path && detail.row.mode === 'PATTERN' ? (
            <p className="flex items-start gap-1.5 text-xs text-amber-700">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              The pattern now gives {detail.pattern.path}; this address has not been moved to it yet.
            </p>
          ) : null}
        </div>
      )}
    </Drawer>
  );
}

'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowRight, CheckCircle2, Lightbulb } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Alert, EmptyState } from '@/components/ui/states';
import { Spinner } from '@/components/ui/icons';
import { formatDate, formatNumber } from '@/lib/utils/format';
import { conflictsAction, suggestPathsAction } from '@/lib/actions/urls';
import type { ConflictReason, ConflictReport, ConflictRow } from '@/lib/urls/conflicts';
import type { UrlRow } from '@/lib/urls/manager';
import { useManager } from './manager-context';
import { PathText, StateBadge, useLoader } from './shared';
import { UrlDrawer } from './url-drawer';

const REASONS: Record<ConflictReason, { label: string; tone: BadgeTone }> = {
  taken: { label: 'Address taken', tone: 'danger' },
  reserved: { label: 'Reserved path', tone: 'warning' },
  shadowed: { label: 'Never reachable', tone: 'purple' },
  invalid: { label: 'Invalid path', tone: 'danger' },
  free: { label: 'Free now', tone: 'success' },
};

type Suggestions = { loading: boolean; paths: string[] | null; error: string | null };

/**
 * Conflicts: content without a public address, with the reason worked out
 * from the registry as it is now, whoever holds the address it wanted, and
 * free alternatives to choose from. Nothing is renamed to make room, and no
 * suggestion is applied until it has been opened, checked and saved.
 */
export function ConflictsTab() {
  const { overview, refresh, go } = useManager();
  const { data, error, loading, reload } = useLoader<ConflictReport>(() => conflictsAction(), [overview.lastScanAt]);
  const [editing, setEditing] = React.useState<{ row: UrlRow; path: string | null } | null>(null);
  const [suggestions, setSuggestions] = React.useState<Record<string, Suggestions>>({});

  async function suggest(conflict: ConflictRow) {
    const key = conflict.row.key;
    setSuggestions((current) => ({ ...current, [key]: { loading: true, paths: null, error: null } }));
    const result = await suggestPathsAction({
      entityId: conflict.row.entityId,
      countryId: conflict.row.countryId,
      type: conflict.row.type,
      path: conflict.wanted,
    });
    setSuggestions((current) => ({
      ...current,
      [key]: result.ok
        ? { loading: false, paths: result.data ?? [], error: null }
        : { loading: false, paths: null, error: result.error },
    }));
  }

  if (error) {
    return (
      <Alert tone="danger" title="Could not load conflicts">
        {error}
      </Alert>
    );
  }
  if (!data) {
    return <div className="h-40 animate-pulse rounded-xl bg-muted/10" aria-label="Loading conflicts" />;
  }

  const scan = data.scan;
  const nothing = data.rows.length === 0 && data.dormant.length === 0 && data.redirectIssues.length === 0;

  return (
    <div className="space-y-6" aria-busy={loading}>
      <p className="max-w-3xl text-sm text-muted">
        Every public address belongs to exactly one thing. Content that could not have the address it wanted is
        listed here with whatever holds that address now — nothing is overwritten and nothing is renamed to make
        room. Choose a different address, or change the content that holds it.
      </p>

      {scan ? (
        <section aria-labelledby="last-scan" className="rounded-xl border border-hairline p-4">
          <h3 id="last-scan" className="text-sm font-semibold text-content">
            Last scan{data.scannedAt ? `, ${formatDate(data.scannedAt)}` : ''}
          </h3>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3 lg:grid-cols-6">
            {(
              [
                ['Registered', scan.registered],
                ['Already registered', scan.alreadyRegistered],
                ['Released', scan.released],
                ['Redirects imported', scan.redirects.imported],
                ['Chains straightened', scan.redirects.flattened],
                ['Collisions', scan.collisions.length],
              ] as const
            ).map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-muted">{label}</dt>
                <dd className="font-semibold text-content">{formatNumber(value)}</dd>
              </div>
            ))}
          </dl>
          {data.resolvedSinceScan > 0 ? (
            <p className="mt-3 flex items-center gap-1.5 text-xs text-emerald-700">
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
              {data.resolvedSinceScan} of the scan’s collisions have been resolved since.
            </p>
          ) : null}
        </section>
      ) : (
        <Alert tone="info" title="Not scanned yet">
          The first scan registers every address the site serves today, exactly where it is, and lists here what it
          could not register. Run it from the top of this page.
        </Alert>
      )}

      {nothing ? (
        <EmptyState
          icon={<CheckCircle2 className="h-6 w-6" aria-hidden="true" />}
          title="No conflicts"
          description="Every piece of content has its address, and every redirect answers for one."
        />
      ) : null}

      {data.rows.length > 0 ? (
        <section aria-labelledby="without-address" className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 id="without-address" className="text-sm font-semibold text-content">
              Content without an address ({formatNumber(data.total)})
            </h3>
            {data.total > data.rows.length ? (
              <p className="text-xs text-muted">Showing the first {data.rows.length}. Resolve these to see the rest.</p>
            ) : null}
          </div>
          <ul className="space-y-2">
            {data.rows.map((conflict) => {
              const found = suggestions[conflict.row.key];
              const reason = REASONS[conflict.reason];
              return (
                <li key={conflict.row.key} className="rounded-xl border border-hairline p-3 sm:p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 space-y-1.5">
                      <p className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium text-content">{conflict.row.label}</span>
                        <Badge tone="neutral">{conflict.row.typeLabel}</Badge>
                        <StateBadge state={conflict.row.state} />
                        {overview.markets.length > 1 ? <Badge tone="info">{conflict.row.countryName}</Badge> : null}
                      </p>
                      <p className="flex flex-wrap items-center gap-1.5 text-sm">
                        <span className="text-xs text-muted">Wanted</span>
                        <PathText path={conflict.wanted} />
                        <Badge tone={reason.tone}>{reason.label}</Badge>
                      </p>
                      <p className="text-sm text-muted">{conflict.detail}</p>
                      {conflict.owner ? (
                        <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                          Held by {conflict.owner.description} at <PathText path={conflict.owner.path} />
                          {conflict.owner.editHref ? (
                            <Link href={conflict.owner.editHref} className="font-medium text-brand hover:underline">
                              Open it
                            </Link>
                          ) : conflict.owner.kind === 'redirect' ? (
                            <button type="button" onClick={() => go('redirects')} className="font-medium text-brand hover:underline">
                              See Redirects
                            </button>
                          ) : null}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      {conflict.reason !== 'free' ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => suggest(conflict)}
                          disabled={found?.loading || !conflict.row.canEdit}
                        >
                          {found?.loading ? (
                            <Spinner className="h-4 w-4 animate-spin" aria-hidden="true" />
                          ) : (
                            <Lightbulb className="h-4 w-4" aria-hidden="true" />
                          )}
                          Suggest alternatives
                        </Button>
                      ) : null}
                      <Button size="sm" onClick={() => setEditing({ row: conflict.row, path: null })}>
                        Give it an address
                      </Button>
                    </div>
                  </div>
                  {found && !found.loading ? (
                    <div className="mt-3 border-t border-hairline pt-3" aria-live="polite">
                      {found.error ? (
                        <p className="text-xs text-red-600">{found.error}</p>
                      ) : found.paths && found.paths.length > 0 ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs text-muted">Free:</span>
                          {found.paths.map((path) => (
                            <button
                              key={path}
                              type="button"
                              onClick={() => setEditing({ row: conflict.row, path })}
                              className="inline-flex items-center gap-1 rounded-lg border border-hairline px-2 py-1 font-mono text-xs text-content hover:border-brand hover:text-brand"
                            >
                              {path}
                              <ArrowRight className="h-3 w-3" aria-hidden="true" />
                            </button>
                          ))}
                          <span className="text-xs text-muted">Opens it for review; nothing is saved yet.</span>
                        </div>
                      ) : (
                        <p className="text-xs text-muted">No free alternative nearby. Enter your own address instead.</p>
                      )}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {!overview.resolverEnabled ? (
            <p className="text-xs text-muted">
              Addresses can be given once the registry is switched on. Until then the previous router decides what is
              reachable, and these stay as they are.
            </p>
          ) : null}
        </section>
      ) : null}

      {data.dormant.length > 0 ? (
        <section aria-labelledby="dormant-redirects" className="space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 id="dormant-redirects" className="text-sm font-semibold text-content">
              Redirects that never fire ({formatNumber(data.dormant.length)})
            </h3>
            <button type="button" onClick={() => go('redirects')} className="text-xs font-medium text-brand hover:underline">
              Manage redirects
            </button>
          </div>
          <p className="text-sm text-muted">
            Content lives at these addresses, so the content is served and the redirect is never used. Delete the
            redirect, or move the content if the redirect is what should answer.
          </p>
          <ul className="divide-y divide-hairline rounded-xl border border-hairline">
            {data.dormant.map((problem) => (
              <li key={problem.redirectId} className="flex flex-wrap items-center gap-1.5 px-3 py-2">
                <PathText path={problem.source} />
                <ArrowRight className="h-3 w-3 text-muted" aria-hidden="true" />
                <PathText path={problem.destination} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {data.redirectIssues.length > 0 ? (
        <section aria-labelledby="import-issues" className="space-y-2">
          <h3 id="import-issues" className="text-sm font-semibold text-content">
            Redirects the scan could not import ({formatNumber(data.redirectIssues.length)})
          </h3>
          <ul className="divide-y divide-hairline rounded-xl border border-hairline">
            {data.redirectIssues.map((issue) => (
              <li key={`${issue.redirectId}-${issue.source}`} className="px-3 py-2">
                <PathText path={issue.source} />
                <p className="mt-0.5 text-xs text-muted">{issue.reason}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <UrlDrawer
        row={editing?.row ?? null}
        initialPath={editing?.path ?? null}
        onClose={() => setEditing(null)}
        onChanged={() => {
          reload();
          refresh();
        }}
      />
    </div>
  );
}

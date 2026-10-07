'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowRight, FileSearch } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/field';
import { Alert } from '@/components/ui/states';
import { Spinner } from '@/components/ui/icons';
import { useToast } from '@/components/ui/toast';
import { applyReferencesAction, findReferencesAction } from '@/lib/actions/urls';
import type { Reference } from '@/lib/urls/references';

/**
 * Links stored in content that still point at an address that moved.
 *
 * They keep working through the redirect either way; this puts the stored
 * copy right. Only exact references are listed — a link field whose value is
 * the old address, or an href in rich text — and only the ticked ones are
 * changed. Canonical overrides are listed for review and never pre-ticked.
 */
export function ReferencesPanel({
  changes,
  onDone,
}: {
  changes: Array<{ oldPath: string; newPath: string; countryId: string }>;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [references, setReferences] = React.useState<Reference[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [chosen, setChosen] = React.useState<Set<string>>(new Set());
  const [applying, setApplying] = React.useState(false);

  React.useEffect(() => {
    let current = true;
    setReferences(null);
    findReferencesAction(changes).then((result) => {
      if (!current) return;
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const found = result.data ?? [];
      setReferences(found);
      setChosen(new Set(found.filter((ref) => ref.kind === 'link').map((ref) => ref.id)));
    });
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(changes)]);

  async function apply() {
    if (!references) return;
    setApplying(true);
    const result = await applyReferencesAction({
      changes,
      chosen: references.filter((ref) => chosen.has(ref.id)).map((ref) => ({ id: ref.id, fingerprint: ref.fingerprint })),
    });
    setApplying(false);
    toast(result.ok ? (result.message ?? 'Updated.') : result.error, result.ok ? 'success' : 'error');
    if (result.ok) onDone();
  }

  const toggle = (id: string) =>
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <section aria-labelledby="stored-links" className="rounded-xl border border-hairline p-3">
      <h3 id="stored-links" className="flex items-center gap-1.5 text-sm font-semibold text-content">
        <FileSearch className="h-4 w-4 text-muted" aria-hidden="true" />
        Stored links to the old address
      </h3>
      {error ? (
        <Alert tone="danger" className="mt-2">
          {error}
        </Alert>
      ) : references === null ? (
        <p className="mt-2 flex items-center gap-1.5 text-sm text-muted" role="status">
          <Spinner className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Looking through menus, pages, products and articles…
        </p>
      ) : references.length === 0 ? (
        <p className="mt-2 text-sm text-muted">No stored content links to the old address. Nothing to update.</p>
      ) : (
        <>
          <p className="mt-1 text-xs text-muted">
            They already work through the redirect. Updating them avoids the extra hop. Only exact links are changed.
          </p>
          <ul className="mt-2 max-h-72 space-y-2 overflow-y-auto">
            {references.map((ref) => (
              <li key={ref.id} className="rounded-lg border border-hairline px-3 py-2">
                <Checkbox
                  checked={chosen.has(ref.id)}
                  onChange={() => toggle(ref.id)}
                  label={
                    <span className="text-sm">
                      {ref.label}
                      {ref.kind === 'canonical' ? (
                        <span className="ml-1.5 rounded bg-amber-50 px-1.5 py-0.5 text-[0.6875rem] font-medium text-amber-700">
                          canonical — review
                        </span>
                      ) : null}
                    </span>
                  }
                />
                <ul className="ml-6 mt-1 space-y-0.5">
                  {ref.matches.slice(0, 4).map((match, index) => (
                    <li key={index} className="flex flex-wrap items-center gap-1 font-mono text-[0.6875rem] text-muted">
                      <span className="break-all">{match.before}</span>
                      <ArrowRight className="h-3 w-3" aria-hidden="true" />
                      <span className="break-all text-content">{match.after}</span>
                    </li>
                  ))}
                </ul>
                {ref.editHref ? (
                  <Link href={ref.editHref} className="ml-6 mt-1 inline-block text-xs text-brand hover:underline">
                    Open
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onDone}>
              Leave them
            </Button>
            <Button size="sm" onClick={apply} disabled={applying || chosen.size === 0}>
              {applying ? <Spinner className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              Update {chosen.size} selected
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

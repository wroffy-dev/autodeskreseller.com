'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { RotateCcw, Trash2, Package } from 'lucide-react';
import { restoreFromTrash, purgeFromTrash } from '@/lib/actions/trash';
import type { TrashedItem, TrashKind } from '@/lib/services/trash';
import { Table, TableWrap, Th, Td, Tr } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button, buttonClasses } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils/cn';
import { SegmentedControl } from '@/components/ui/segmented-control';

const KIND_LABELS: Record<TrashKind, string> = {
  page: 'Page',
  post: 'Article',
  productCategory: 'Category',
  brand: 'Brand',
};

const FILTERS: Array<{ value: TrashKind | 'all'; label: string }> = [
  { value: 'all', label: 'Everything' },
  { value: 'page', label: 'Pages' },
  { value: 'post', label: 'Articles' },
  { value: 'productCategory', label: 'Categories' },
  { value: 'brand', label: 'Brands' },
];

/**
 * The recycle bin.
 *
 * One list rather than four, because "where did that thing go?" is one
 * question whatever kind of thing it was. The filter narrows it; the default
 * is everything, newest first.
 *
 * Deleting for good is offered only where it is actually allowed. Something
 * credited with a lead keeps that lead's attribution, and saying so here is
 * better than a button that always fails.
 */
export function TrashTable({ items, canManage }: { items: TrashedItem[]; canManage: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState<TrashKind | 'all'>('all');
  const [purging, setPurging] = React.useState<TrashedItem | null>(null);

  const shown = filter === 'all' ? items : items.filter((item) => item.kind === filter);

  async function run(
    key: string,
    action: () => Promise<{ ok: boolean; error?: string; message?: string }>,
  ) {
    setBusy(key);
    const result = await action();
    setBusy(null);
    if (!result.ok) {
      toast(result.error ?? 'That did not work.', 'error');
      return;
    }
    toast(result.message ?? 'Done.');
    router.refresh();
  }

  const counts = React.useMemo(() => {
    const map = new Map<TrashKind | 'all', number>([['all', items.length]]);
    for (const item of items) map.set(item.kind, (map.get(item.kind) ?? 0) + 1);
    return map;
  }, [items]);

  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-hairline p-10 text-center">
        <p className="text-sm font-medium text-content">Nothing has been deleted</p>
        <p className="mx-auto mt-1.5 max-w-md text-sm text-muted">
          A page, article, category or brand you delete waits here, so a mistake costs nothing to
          undo. Products have their own bin.
        </p>
        <Link href="/admin/products/trash" className={cn(buttonClasses('outline', 'md'), 'mt-4')}>
          <Package className="h-4 w-4" aria-hidden="true" />
          Removed products
        </Link>
      </div>
    );
  }

  return (
    <>
      <SegmentedControl
        label="Show"
        className="mb-4"
        value={filter}
        onChange={setFilter}
        options={FILTERS.filter(
          (entry) => entry.value === 'all' || (counts.get(entry.value) ?? 0) > 0,
        ).map((entry) => ({
          value: entry.value,
          label: entry.label,
          badge: counts.get(entry.value) ?? 0,
        }))}
      />

      <TableWrap>
        <Table>
          <thead>
            <Tr>
              <Th>Name</Th>
              <Th>Type</Th>
              <Th>URL</Th>
              <Th>Deleted</Th>
              <Th className="text-right">Actions</Th>
            </Tr>
          </thead>
          <tbody>
            {shown.map((item) => {
              const key = `${item.kind}:${item.id}`;
              return (
                <Tr key={key}>
                  <Td>
                    <span className="font-medium text-content">{item.title}</span>
                    {item.note ? (
                      <span className="mt-0.5 block text-xs text-muted">{item.note}</span>
                    ) : null}
                  </Td>
                  <Td>
                    <Badge tone="neutral">{KIND_LABELS[item.kind]}</Badge>
                  </Td>
                  <Td>
                    {item.path ? <code className="text-xs text-muted">{item.path}</code> : '—'}
                  </Td>
                  <Td>
                    <span className="text-sm text-muted">
                      {item.deletedAt ? new Date(item.deletedAt).toLocaleDateString() : '—'}
                    </span>
                  </Td>
                  <Td className="text-right">
                    {canManage ? (
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy === key}
                          onClick={() => run(key, () => restoreFromTrash(item.kind, item.id))}
                        >
                          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                          Restore
                        </Button>
                        {item.canPurge ? (
                          <Button
                            variant="danger"
                            size="sm"
                            disabled={busy === key}
                            onClick={() => setPurging(item)}
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                            Delete for good
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                    {!item.canPurge ? (
                      <p className="mt-1 text-xs text-muted">Kept for its leads</p>
                    ) : null}
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      </TableWrap>

      <ConfirmDialog
        open={Boolean(purging)}
        onClose={() => setPurging(null)}
        title={`Delete “${purging?.title ?? ''}” for good?`}
        message={
          purging?.kind === 'productCategory' || purging?.kind === 'brand'
            ? 'It is destroyed. Products that used it keep existing and simply lose it. This cannot be undone.'
            : 'It is destroyed, along with the sections it was built from. This cannot be undone.'
        }
        confirmLabel="Delete for good"
        tone="danger"
        onConfirm={async () => {
          const target = purging;
          setPurging(null);
          if (target) {
            await run(`${target.kind}:${target.id}`, () => purgeFromTrash(target.kind, target.id));
          }
        }}
      />
    </>
  );
}

'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { RotateCcw, Trash2 } from 'lucide-react';
import { restoreProduct, purgeProduct } from '@/lib/actions/products';
import { Table, TableWrap, Th, Td, Tr } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';

export type TrashedProduct = {
  id: string;
  name: string;
  /** The URL it had, with the retirement suffix already stripped. */
  slug: string;
  sku: string | null;
  removedAt: string | null;
  /**
   * True when the shared product was retired — no market offers it. False
   * means this market withdrew it and another still sells it.
   */
  retired: boolean;
  marketName: string;
  /** Markets that still offer it. Zero for a retired product. */
  stillSoldIn: number;
  /** Leads attributed to it, which is what blocks a permanent delete. */
  leads: number;
};

/**
 * Removed products, with the two ways back.
 *
 * Restore is the undo the archive exists for. Deleting for good is offered
 * only where it is actually allowed — a product carrying leads keeps them, and
 * saying so here is better than a button that always fails.
 */
export function ProductTrashTable({
  products,
  canManage,
  urlPattern = '/products/{slug}',
}: {
  products: TrashedProduct[];
  canManage: boolean;
  /** Where a restored product would live, from the URL pattern the site serves now. */
  urlPattern?: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [purging, setPurging] = React.useState<TrashedProduct | null>(null);

  async function run(id: string, action: () => Promise<{ ok: boolean; error?: string; message?: string }>) {
    setBusy(id);
    const result = await action();
    setBusy(null);
    if (!result.ok) {
      toast(result.error ?? 'That did not work.', 'error');
      return;
    }
    toast(result.message ?? 'Done.');
    router.refresh();
  }

  if (products.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-hairline p-10 text-center">
        <p className="text-sm font-medium text-content">Nothing has been removed</p>
        <p className="mt-1.5 text-sm text-muted">
          A product you remove from the catalogue waits here, so a mistake costs nothing to undo.
        </p>
      </div>
    );
  }

  return (
    <>
      <TableWrap>
        <Table>
          <thead>
            <Tr>
              <Th>Product</Th>
              <Th>URL</Th>
              <Th>Removed</Th>
              <Th>Where</Th>
              <Th className="text-right">Actions</Th>
            </Tr>
          </thead>
          <tbody>
            {products.map((product) => (
              <Tr key={product.id}>
                <Td>
                  <span className="font-medium text-content">{product.name}</span>
                  {product.sku ? (
                    <span className="mt-0.5 block text-xs text-muted">SKU {product.sku}</span>
                  ) : null}
                </Td>
                <Td>
                  <code className="text-xs text-muted">{urlPattern.replace('{slug}', product.slug)}</code>
                </Td>
                <Td>
                  <span className="text-sm text-muted">
                    {product.removedAt ? new Date(product.removedAt).toLocaleDateString() : '—'}
                  </span>
                </Td>
                <Td>
                  {product.retired ? (
                    <Badge tone="danger">Retired everywhere</Badge>
                  ) : (
                    <Badge tone="warning">
                      Removed from {product.marketName} · still in {product.stillSoldIn} market
                      {product.stillSoldIn === 1 ? '' : 's'}
                    </Badge>
                  )}
                </Td>
                <Td className="text-right">
                  {canManage ? (
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy === product.id}
                        onClick={() => run(product.id, () => restoreProduct(product.id))}
                      >
                        <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                        Restore
                      </Button>
                      {/*
                        * Only where the shared product is retired and nothing
                        * is attributed to it. Anywhere else the action would
                        * be refused server-side, and an button that cannot
                        * work is worse than no button.
                        */}
                      {product.retired && product.leads === 0 ? (
                        <Button
                          variant="danger"
                          size="sm"
                          disabled={busy === product.id}
                          onClick={() => setPurging(product)}
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          Delete for good
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                  {product.retired && product.leads > 0 ? (
                    <p className="mt-1 text-xs text-muted">
                      Kept for {product.leads} lead{product.leads === 1 ? '' : 's'}
                    </p>
                  ) : null}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </TableWrap>

      <ConfirmDialog
        open={Boolean(purging)}
        onClose={() => setPurging(null)}
        title={`Delete “${purging?.name ?? ''}” for good?`}
        message="The product, its market pricing, variants and page sections are destroyed. This cannot be undone."
        confirmLabel="Delete for good"
        tone="danger"
        onConfirm={async () => {
          const target = purging;
          setPurging(null);
          if (target) await run(target.id, () => purgeProduct(target.id));
        }}
      />
    </>
  );
}

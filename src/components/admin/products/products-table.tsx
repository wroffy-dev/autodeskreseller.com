'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Package, Plus, Pencil, ExternalLink, Copy, Trash, Star } from 'lucide-react';
import {
  setProductStatus,
  toggleProductFeatured,
  duplicateProduct,
  deleteProduct,
  bulkProductAction,
} from '@/lib/actions/products';
import { RowMenu, RowMenuItem, BulkBar, useSelection } from '@/components/admin/row-menu';
import { ContentStatusBadge } from '@/components/admin/lead-status-badge';
import { Table, TableWrap, Th, Td, Tr } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/states';
import { Button, ButtonLink } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { formatMoney } from '@/lib/utils/money';

export type ProductRow = {
  id: string;
  name: string;
  slug: string;
  /** The product's public address in the market being worked in. */
  publicPath: string;
  sku: string | null;
  status: string;
  isFeatured: boolean;
  categoryName: string | null;
  storage: string | null;
  currency: string;
  monthlyPrice: string | null;
  annualPrice: string | null;
  /** The markets that publish this product, by code. */
  liveIn: string[];
  leadCount: number;
};

export type ProductPermissions = { edit: boolean; create: boolean; delete: boolean };

export function ProductsTable({
  rows,
  can,
  filtered,
  showCountries = false,
  countryName,
  isDefaultCountry = false,
}: {
  rows: ProductRow[];
  can: ProductPermissions;
  filtered: boolean;
  /** Adds the "Sold in" column. Hidden on a single-market installation. */
  showCountries?: boolean;
  /**
   * The market being worked in. Delete on this screen removes a product from
   * **this** market, so the confirmation has to say which one rather than
   * asking "delete this product?" about a catalogue shared with four others.
   */
  countryName?: string;
  /** The source market: its deletions do not follow content already synced. */
  isDefaultCountry?: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const selection = useSelection(rows);
  const [busy, setBusy] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState<string | null>(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = React.useState(false);

  async function run(fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) {
    setBusy(true);
    const result = await fn();
    setBusy(false);
    if (!result.ok) {
      toast(result.error ?? 'Something went wrong.', 'error');
      return false;
    }
    toast(result.message ?? 'Done.');
    router.refresh();
    return true;
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<Package className="h-5 w-5" />}
        title={filtered ? 'No products match those filters' : 'No products yet'}
        description={
          filtered
            ? 'Try clearing the search or filters.'
            : 'Add your first product so it can appear in product blocks and comparison tables.'
        }
        action={
          can.create ? (
            <ButtonLink href="/admin/products/new">
              <Plus className="h-4 w-4" aria-hidden="true" />
              New product
            </ButtonLink>
          ) : undefined
        }
      />
    );
  }

  return (
    <>
      {can.edit || can.delete ? (
        <div className="px-4 pt-4 sm:px-5">
          <BulkBar count={selection.selected.length} onClear={selection.clear}>
            {can.edit ? (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    run(() => bulkProductAction({ ids: selection.selected, action: 'publish' })).then(
                      (ok) => ok && selection.clear(),
                    )
                  }
                >
                  Publish
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    run(() => bulkProductAction({ ids: selection.selected, action: 'draft' })).then(
                      (ok) => ok && selection.clear(),
                    )
                  }
                >
                  Unpublish
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    run(() => bulkProductAction({ ids: selection.selected, action: 'feature' })).then(
                      (ok) => ok && selection.clear(),
                    )
                  }
                >
                  Feature
                </Button>
              </>
            ) : null}
            {can.delete ? (
              <Button size="sm" variant="danger" disabled={busy} onClick={() => setConfirmBulkDelete(true)}>
                Delete
              </Button>
            ) : null}
          </BulkBar>
        </div>
      ) : null}

      <TableWrap>
        <Table className="min-w-[52rem]">
          <caption className="sr-only">Products</caption>
          <thead>
            <tr>
              {can.edit ? (
                <Th className="w-10">
                  <input
                    type="checkbox"
                    checked={selection.allSelected}
                    onChange={selection.toggleAll}
                    aria-label="Select all products"
                    className="h-4 w-4 rounded border-hairline text-brand focus:ring-brand/30"
                  />
                </Th>
              ) : null}
              <Th>Product</Th>
              <Th>Category</Th>
              <Th>Storage</Th>
              {showCountries ? <Th>Sold in</Th> : null}
              <Th align="right">Monthly</Th>
              <Th align="right">Annual</Th>
              <Th align="center">Leads</Th>
              <Th>Status</Th>
              <Th align="right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <Tr key={row.id}>
                {can.edit ? (
                  <Td>
                    <input
                      type="checkbox"
                      checked={selection.selected.includes(row.id)}
                      onChange={() => selection.toggle(row.id)}
                      aria-label={`Select ${row.name}`}
                      className="h-4 w-4 rounded border-hairline text-brand focus:ring-brand/30"
                    />
                  </Td>
                ) : null}
                <Td>
                  <span className="flex items-center gap-2">
                    <Link
                      href={`/admin/products/${row.id}`}
                      className="font-medium text-content hover:text-brand"
                    >
                      {row.name}
                    </Link>
                    {row.isFeatured ? (
                      <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" aria-label="Featured" />
                    ) : null}
                  </span>
                  {row.sku ? <span className="block text-xs text-muted">{row.sku}</span> : null}
                </Td>
                <Td className="text-sm text-muted">{row.categoryName ?? '—'}</Td>
                <Td className="text-sm text-muted">{row.storage ?? '—'}</Td>
                {showCountries ? (
                  <Td className="whitespace-nowrap text-sm text-muted">
                    {row.liveIn.length > 0 ? row.liveIn.join(', ') : '—'}
                  </Td>
                ) : null}
                <Td align="right" className="whitespace-nowrap text-sm">
                  {row.monthlyPrice ? formatMoney(row.monthlyPrice, row.currency) : '—'}
                </Td>
                <Td align="right" className="whitespace-nowrap text-sm">
                  {row.annualPrice ? formatMoney(row.annualPrice, row.currency) : '—'}
                </Td>
                <Td align="center">
                  {row.leadCount > 0 ? (
                    <Link
                      href={`/admin/leads?product=${row.id}`}
                      className="text-sm font-medium text-brand hover:underline"
                    >
                      {row.leadCount}
                    </Link>
                  ) : (
                    <span className="text-sm text-muted">0</span>
                  )}
                </Td>
                <Td>
                  <ContentStatusBadge status={row.status} />
                </Td>
                <Td align="right">
                  <div className="flex items-center justify-end gap-1">
                    {can.edit ? (
                      <Link
                        href={`/admin/products/${row.id}`}
                        className="rounded p-1.5 text-muted hover:bg-muted/10 hover:text-content"
                        aria-label={`Edit ${row.name}`}
                        title="Edit"
                      >
                        <Pencil className="h-4 w-4" />
                      </Link>
                    ) : null}
                    {row.status === 'PUBLISHED' ? (
                      <Link
                        href={row.publicPath}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded p-1.5 text-muted hover:bg-muted/10 hover:text-content"
                        aria-label={`View ${row.name}`}
                        title="View live"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </Link>
                    ) : null}
                    <RowMenu label={`Actions for ${row.name}`}>
                      {can.edit && row.status !== 'PUBLISHED' ? (
                        <RowMenuItem
                          disabled={busy}
                          onClick={() => run(() => setProductStatus(row.id, 'PUBLISHED'))}
                        >
                          Publish
                        </RowMenuItem>
                      ) : null}
                      {can.edit && row.status === 'PUBLISHED' ? (
                        <RowMenuItem
                          disabled={busy}
                          onClick={() => run(() => setProductStatus(row.id, 'DRAFT'))}
                        >
                          Unpublish
                        </RowMenuItem>
                      ) : null}
                      {can.edit ? (
                        <RowMenuItem disabled={busy} onClick={() => run(() => toggleProductFeatured(row.id))}>
                          <Star className="h-3.5 w-3.5" aria-hidden="true" />
                          {row.isFeatured ? 'Remove from featured' : 'Mark as featured'}
                        </RowMenuItem>
                      ) : null}
                      {can.create ? (
                        <RowMenuItem
                          disabled={busy}
                          onClick={() =>
                            run(async () => {
                              const result = await duplicateProduct(row.id);
                              if (result.ok && result.data) router.push(`/admin/products/${result.data.id}`);
                              return result;
                            })
                          }
                        >
                          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                          Duplicate
                        </RowMenuItem>
                      ) : null}
                      {can.delete ? (
                        <RowMenuItem tone="danger" disabled={busy} onClick={() => setConfirmDelete(row.id)}>
                          <Trash className="h-3.5 w-3.5" aria-hidden="true" />
                          Delete
                        </RowMenuItem>
                      ) : null}
                    </RowMenu>
                  </div>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </TableWrap>

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        onConfirm={async () => {
          if (confirmDelete) await run(() => deleteProduct(confirmDelete));
          setConfirmDelete(null);
        }}
        title={countryName ? `Remove this product from ${countryName}?` : 'Remove this product?'}
        message={
          countryName
            ? `This only removes it from ${countryName} — its pricing and settings here are archived, and existing leads keep their product attribution.` +
              (isDefaultCountry
                ? ' Copies already synced to other markets are not affected.'
                : ' Other markets are not affected.')
            : 'It is removed from this market. Existing leads keep their product attribution.'
        }
        pending={busy}
      />

      <ConfirmDialog
        open={confirmBulkDelete}
        onClose={() => setConfirmBulkDelete(false)}
        onConfirm={async () => {
          const ok = await run(() => bulkProductAction({ ids: selection.selected, action: 'delete' }));
          if (ok) selection.clear();
          setConfirmBulkDelete(false);
        }}
        title={
          countryName
            ? `Remove ${selection.selected.length} product(s) from ${countryName}?`
            : `Remove ${selection.selected.length} product(s)?`
        }
        message={
          countryName
            ? `This only removes them from ${countryName}.` +
              (isDefaultCountry
                ? ' Copies already synced to other markets are not affected.'
                : ' Other markets are not affected.')
            : 'They are removed from this market only.'
        }
        pending={busy}
      />
    </>
  );
}

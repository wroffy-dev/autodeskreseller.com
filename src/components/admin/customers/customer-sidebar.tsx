'use client';

import * as React from 'react';
import { Plus, X, MessageSquarePlus } from 'lucide-react';
import { addCustomerNote, linkCustomerProduct, unlinkCustomerProduct } from '@/lib/actions/customers';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { useRouter } from 'next/navigation';
import { formatDate } from '@/lib/utils/format';
import { formatMoney } from '@/lib/utils/money';
import { DateField } from '@/components/ui/date-field';

export type LinkedProduct = {
  productId: string;
  productName: string;
  quantity: number;
  seats: number | null;
  unitPrice: string | null;
  currency: string;
  renewsAt: string | null;
};

export function CustomerSidebar({
  customerId,
  canEdit,
  products,
  linked,
  notes,
}: {
  customerId: string;
  canEdit: boolean;
  products: Array<{ id: string; name: string }>;
  linked: LinkedProduct[];
  notes: Array<{ id: string; body: string; authorName: string | null; createdAt: string }>;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState('');
  const [newProduct, setNewProduct] = React.useState({ productId: '', quantity: '1', renewsAt: '' });

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

  const available = products.filter((p) => !linked.some((l) => l.productId === p.id));

  return (
    <div className="min-w-0 space-y-6">
      <Card>
        <CardHeader title="Products held" />
        <CardBody className="space-y-4">
          {linked.length === 0 ? (
            <p className="text-sm text-muted">No products linked yet.</p>
          ) : (
            <ul className="space-y-2">
              {linked.map((item) => (
                <li
                  key={item.productId}
                  className="flex items-start gap-2 rounded-lg border border-hairline px-3 py-2.5"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-content">
                      {item.productName}
                    </span>
                    <span className="block text-xs text-muted">
                      {item.seats ?? item.quantity} seat(s)
                      {item.unitPrice ? ` · ${formatMoney(item.unitPrice, item.currency)}` : ''}
                      {item.renewsAt ? ` · renews ${formatDate(item.renewsAt)}` : ''}
                    </span>
                  </span>
                  {canEdit ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => run(() => unlinkCustomerProduct(customerId, item.productId))}
                      aria-label={`Unlink ${item.productName}`}
                      className="shrink-0 rounded p-1 text-muted transition-colors hover:bg-red-50 hover:text-red-600"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {canEdit && available.length > 0 ? (
            <div className="space-y-3 border-t border-hairline pt-4">
              <Field label="Add a product" htmlFor="link-product">
                <Select
                  id="link-product"
                  value={newProduct.productId}
                  onChange={(e) => setNewProduct({ ...newProduct, productId: e.target.value })}
                >
                  <option value="">Choose a product…</option>
                  {available.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Seats" htmlFor="link-quantity">
                  <Input
                    id="link-quantity"
                    type="number"
                    min={1}
                    value={newProduct.quantity}
                    onChange={(e) => setNewProduct({ ...newProduct, quantity: e.target.value })}
                  />
                </Field>
                <Field label="Renews on" htmlFor="link-renews">
                  <DateField
                    id="link-renews"
                    label="Renews on"
                    value={newProduct.renewsAt}
                    onChange={(next) => setNewProduct({ ...newProduct, renewsAt: next })}
                  />
                </Field>
              </div>
              <Button
                size="sm"
                disabled={busy || !newProduct.productId}
                onClick={async () => {
                  const ok = await run(() =>
                    linkCustomerProduct({
                      customerId,
                      productId: newProduct.productId,
                      quantity: Number(newProduct.quantity) || 1,
                      seats: Number(newProduct.quantity) || null,
                      renewsAt: newProduct.renewsAt || null,
                    }),
                  );
                  if (ok) setNewProduct({ productId: '', quantity: '1', renewsAt: '' });
                }}
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                Link product
              </Button>
            </div>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Notes" />
        <CardBody className="space-y-4">
          {canEdit ? (
            <div>
              <label htmlFor="customer-note" className="sr-only">
                Add a note
              </label>
              <Textarea
                id="customer-note"
                rows={3}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Renewal conversation booked for March."
              />
              <div className="mt-2 flex justify-end">
                <Button
                  size="sm"
                  disabled={busy || !note.trim()}
                  onClick={async () => {
                    const ok = await run(() => addCustomerNote({ customerId, body: note }));
                    if (ok) setNote('');
                  }}
                >
                  <MessageSquarePlus className="h-4 w-4" aria-hidden="true" />
                  Add note
                </Button>
              </div>
            </div>
          ) : null}

          {notes.length === 0 ? (
            <p className="text-sm text-muted">No notes yet.</p>
          ) : (
            <ul className="space-y-3">
              {notes.map((entry) => (
                <li key={entry.id} className="rounded-lg border border-hairline p-3">
                  <p className="whitespace-pre-wrap text-sm text-content">{entry.body}</p>
                  <p className="mt-2 text-xs text-muted">
                    {entry.authorName ?? 'Unknown'} · {formatDate(entry.createdAt, true)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

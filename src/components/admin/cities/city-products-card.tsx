'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Unlink, Wand2 } from 'lucide-react';
import { removeCityProduct } from '@/lib/actions/cities';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { ContentStatusBadge } from '@/components/admin/status-badge';
import { useToast } from '@/components/ui/toast';

export type CityProductRow = {
  productId: string;
  productName: string;
  page: { id: string; title: string; path: string; status: string } | null;
};

/**
 * The city's explicit city/product pages: "this is Delhi's AutoCAD page".
 *
 * Nothing here is inferred from addresses. A row exists because an editor
 * generated a page for one product in this city; removing it leaves the page
 * itself exactly as it is.
 */
export function CityProductsCard({
  cityId,
  cityName,
  rows,
  generatorHref,
  canEdit,
}: {
  cityId: string;
  cityName: string;
  rows: CityProductRow[];
  generatorHref: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [removing, setRemoving] = React.useState<CityProductRow | null>(null);

  async function remove() {
    if (!removing) return;
    const result = await removeCityProduct({ cityId, productId: removing.productId });
    setRemoving(null);
    if (!result.ok) {
      toast(result.error, 'error');
      return;
    }
    toast(result.message ?? 'Removed.');
    router.refresh();
  }

  return (
    <Card className="self-start">
      <CardHeader
        title="Product pages"
        description={
          rows.length === 0
            ? `No product has its own page in ${cityName} yet. Generate one with a product chosen to record it here.`
            : `Pages recorded as ${cityName}’s page for a product.`
        }
        actions={
          generatorHref ? (
            <Link href={generatorHref} className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline">
              <Wand2 className="h-3.5 w-3.5" aria-hidden="true" />
              Generate
            </Link>
          ) : null
        }
      />
      {rows.length > 0 ? (
        <CardBody className="p-0">
          <ul className="divide-y divide-hairline">
            {rows.map((row) => (
              <li key={row.productId} className="flex items-start justify-between gap-3 px-4 py-3 sm:px-5">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-content">{row.productName}</p>
                  {row.page ? (
                    <p className="mt-0.5 flex flex-wrap items-center gap-1.5">
                      <Link href={`/admin/pages/${row.page.id}`} className="break-all font-mono text-xs text-brand hover:underline">
                        {row.page.path}
                      </Link>
                      <ContentStatusBadge status={row.page.status} />
                    </p>
                  ) : (
                    <p className="mt-0.5 text-xs text-muted">Its page was deleted or moved out of the city.</p>
                  )}
                </div>
                {canEdit ? (
                  <Button size="sm" variant="ghost" onClick={() => setRemoving(row)} aria-label={`Remove the ${row.productName} association`}>
                    <Unlink className="h-4 w-4" aria-hidden="true" />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </CardBody>
      ) : null}
      <ConfirmDialog
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        onConfirm={remove}
        title={`Remove the ${removing?.productName ?? ''} association?`}
        message="The page stays exactly as it is — an ordinary page in the city. Only the record that it is this city’s page for the product is removed."
        confirmLabel="Remove association"
      />
    </Card>
  );
}

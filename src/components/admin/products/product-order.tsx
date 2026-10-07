'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, ArrowUp, ArrowDown, Star, Package, Search } from 'lucide-react';
import { reorderProducts, toggleProductFeatured } from '@/lib/actions/products';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/states';
import { ContentStatusBadge } from '@/components/admin/lead-status-badge';
import { useToast } from '@/components/ui/toast';
import { Spinner } from '@/components/ui/icons';
import { cn } from '@/lib/utils/cn';

export type OrderableProduct = {
  id: string;
  name: string;
  slug: string;
  status: string;
  isFeatured: boolean;
  categoryName: string | null;
  brandName: string | null;
  imageUrl: string | null;
};

/**
 * Manual product ordering.
 *
 * `scope` decides which column is written: the catalogue order (`sortOrder`) or
 * the featured order (`featuredOrder`). Both persist in the database, so the
 * frontend never falls back to creation date.
 */
export function ProductOrderList({
  products,
  scope,
  canEdit,
}: {
  products: OrderableProduct[];
  scope: 'catalogue' | 'featured';
  canEdit: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [items, setItems] = React.useState(products);
  const [dirty, setDirty] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    setItems(products);
    setDirty(false);
  }, [products]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = items.findIndex((p) => p.id === active.id);
    const to = items.findIndex((p) => p.id === over.id);
    if (from < 0 || to < 0) return;
    setItems(arrayMove(items, from, to));
    setDirty(true);
  }

  function move(id: string, delta: number) {
    const from = items.findIndex((p) => p.id === id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= items.length) return;
    setItems(arrayMove(items, from, to));
    setDirty(true);
  }

  async function save() {
    setSaving(true);
    const result = await reorderProducts({ order: items.map((p) => p.id), scope });
    setSaving(false);
    if (!result.ok) {
      toast(result.error, 'error');
      return;
    }
    setDirty(false);
    toast(result.message ?? 'Order saved.');
    router.refresh();
  }

  // Search narrows what is shown without touching the stored order: dragging
  // is disabled while filtering, because a drop position within a filtered
  // subset does not mean the same thing in the full list.
  const [query, setQuery] = React.useState('');
  const term = query.trim().toLowerCase();
  const filtering = term.length > 0;
  const visible = filtering
    ? items.filter(
        (product) =>
          product.name.toLowerCase().includes(term) ||
          product.slug.toLowerCase().includes(term) ||
          (product.categoryName ?? '').toLowerCase().includes(term) ||
          (product.brandName ?? '').toLowerCase().includes(term),
      )
    : items;

  const [featurePending, setFeaturePending] = React.useState<string | null>(null);

  async function toggleFeatured(product: OrderableProduct) {
    setFeaturePending(product.id);
    const result = await toggleProductFeatured(product.id);
    setFeaturePending(null);
    if (!result.ok) {
      toast(result.error, 'error');
      return;
    }
    toast(
      result.message ?? (product.isFeatured ? 'Removed from featured.' : 'Marked as featured.'),
    );
    // The featured rail is a different query, so let the server resend both.
    router.refresh();
  }

  if (items.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={
            scope === 'featured' ? <Star className="h-5 w-5" /> : <Package className="h-5 w-5" />
          }
          title={scope === 'featured' ? 'No featured products yet' : 'No products yet'}
          description={
            scope === 'featured'
              ? 'Mark products as featured from the product list, then arrange them here.'
              : 'Add a product first, then drag them into the order you want.'
          }
        />
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title={scope === 'featured' ? 'Featured order' : 'Catalogue order'}
        description={
          scope === 'featured'
            ? 'The order featured products appear in, wherever a section uses the “Featured” source.'
            : 'The default order for product sections, category pages and the product index.'
        }
        actions={
          <div className="relative w-full sm:w-64">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
              aria-hidden="true"
            />
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search products"
              aria-label={`Search ${scope === 'featured' ? 'featured products' : 'products'}`}
              className="pl-9"
            />
          </div>
        }
      />
      <CardBody>
        {filtering ? (
          <p className="mb-3 rounded-lg bg-muted/[0.06] px-3 py-2 text-xs text-muted">
            Showing {visible.length} of {items.length}. Clear the search to change the order —
            dragging is disabled while a filter is applied.
          </p>
        ) : null}
        <DndContext
          id="product-order"
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
        >
          <SortableContext items={visible.map((p) => p.id)} strategy={verticalListSortingStrategy}>
            <ol className="space-y-2">
              {visible.length === 0 ? (
                <li className="rounded-lg border border-dashed border-hairline px-3 py-8 text-center text-sm text-muted">
                  No product matches “{query}”.
                </li>
              ) : (
                visible.map((product) => {
                  // Position is always the one in the real list, never the
                  // filtered one, so the number on screen matches what saves.
                  const index = items.findIndex((candidate) => candidate.id === product.id);
                  return (
                    <SortableRow
                      key={product.id}
                      product={product}
                      index={index}
                      canEdit={canEdit && !filtering}
                      onMoveUp={!filtering && index > 0 ? () => move(product.id, -1) : undefined}
                      onMoveDown={
                        !filtering && index < items.length - 1
                          ? () => move(product.id, 1)
                          : undefined
                      }
                      onToggleFeatured={canEdit ? () => toggleFeatured(product) : undefined}
                      featurePending={featurePending === product.id}
                    />
                  );
                })
              )}
            </ol>
          </SortableContext>
        </DndContext>
      </CardBody>

      {canEdit ? (
        <div className="flex items-center justify-end gap-3 border-t border-hairline bg-muted/[0.03] px-4 py-3 sm:px-5">
          {dirty ? <span className="mr-auto text-xs text-amber-600">Unsaved order</span> : null}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setItems(products);
              setDirty(false);
            }}
            disabled={!dirty || saving}
          >
            Reset
          </Button>
          <Button size="sm" onClick={save} disabled={!dirty || saving}>
            {saving ? (
              <>
                <Spinner className="h-4 w-4 animate-spin" aria-hidden="true" />
                Saving…
              </>
            ) : (
              'Save order'
            )}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

function SortableRow({
  product,
  index,
  canEdit,
  onMoveUp,
  onMoveDown,
  onToggleFeatured,
  featurePending,
}: {
  product: OrderableProduct;
  index: number;
  canEdit: boolean;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onToggleFeatured?: () => void;
  featurePending?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: product.id,
    disabled: !canEdit,
  });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'flex items-center gap-2 rounded-lg border bg-surface px-3 py-2.5',
        isDragging ? 'border-brand shadow-lg' : 'border-hairline',
      )}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={`Reorder ${product.name}`}
        disabled={!canEdit}
        className="cursor-grab rounded p-1 text-muted hover:bg-muted/10 active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-40"
      >
        <GripVertical className="h-4 w-4" aria-hidden="true" />
      </button>

      {canEdit ? (
        <span className="flex shrink-0 flex-col">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={!onMoveUp}
            aria-label={`Move ${product.name} up`}
            className="rounded px-1 text-muted transition-colors hover:text-content disabled:opacity-30"
          >
            <ArrowUp className="h-3 w-3" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={!onMoveDown}
            aria-label={`Move ${product.name} down`}
            className="rounded px-1 text-muted transition-colors hover:text-content disabled:opacity-30"
          >
            <ArrowDown className="h-3 w-3" aria-hidden="true" />
          </button>
        </span>
      ) : null}

      <span className="w-7 shrink-0 text-center text-xs font-semibold text-muted">{index + 1}</span>

      {product.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={product.imageUrl}
          alt=""
          aria-hidden="true"
          className="h-9 w-9 shrink-0 rounded-md border border-hairline object-cover"
        />
      ) : (
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted/10">
          <Package className="h-4 w-4 text-muted" aria-hidden="true" />
        </span>
      )}

      <span className="min-w-0 flex-1">
        <Link
          href={`/admin/products/${product.id}`}
          className="block truncate text-sm font-medium text-content hover:text-brand"
        >
          {product.name}
        </Link>
        <span className="block truncate text-xs text-muted">
          {[product.brandName, product.categoryName].filter(Boolean).join(' · ') || product.slug}
        </span>
      </span>

      {onToggleFeatured ? (
        <button
          type="button"
          onClick={onToggleFeatured}
          disabled={featurePending}
          aria-pressed={product.isFeatured}
          title={product.isFeatured ? 'Remove from featured' : 'Mark as featured'}
          className={cn(
            'flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-xs font-medium transition-colors disabled:opacity-50',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1',
            product.isFeatured
              ? 'bg-brand/10 text-brand hover:bg-brand/15'
              : 'text-muted hover:bg-muted/10 hover:text-content',
          )}
        >
          <Star
            className={cn('h-3 w-3', product.isFeatured && 'fill-current')}
            aria-hidden="true"
          />
          <span className="hidden sm:inline">{product.isFeatured ? 'Featured' : 'Feature'}</span>
        </button>
      ) : product.isFeatured ? (
        <Badge tone="brand">
          <Star className="h-3 w-3" aria-hidden="true" />
          Featured
        </Badge>
      ) : null}
      <ContentStatusBadge status={product.status} />
    </li>
  );
}

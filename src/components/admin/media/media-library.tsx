'use client';

import * as React from 'react';
import {
  Upload,
  Search,
  Trash,
  Copy,
  Check,
  Image as ImageIcon,
  LayoutGrid,
  List as ListIcon,
} from 'lucide-react';
import {
  listMedia,
  uploadMedia,
  updateMediaMetadata,
  renameMedia,
  deleteMedia,
  type MediaDto,
} from '@/lib/actions/media';
import { Card } from '@/components/ui/card';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { Dialog, ConfirmDialog } from '@/components/ui/dialog';
import { EmptyState, Skeleton } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { Spinner } from '@/components/ui/icons';
import { formatBytes, formatDate } from '@/lib/utils/format';
import { ACCEPT_ATTRIBUTE } from '@/lib/media/constants';
import {
  listMediaFolders,
  moveMediaToFolder,
  type MediaFolderNode,
} from '@/lib/actions/media-folders';
import { FolderSidebar, FolderBreadcrumb, type FolderSelection } from './folder-sidebar';
import { flattenTree } from '@/lib/utils/tree';
import { BulkBar } from '@/components/admin/row-menu';
import { FolderInput } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { SegmentedControl } from '@/components/ui/segmented-control';

export function MediaLibrary({
  initialItems,
  initialCursor,
  initialFolders,
  initialTotalCount,
  initialUncategorisedCount,
  can,
  selectedId,
  maxUploadLabel,
}: {
  initialItems: MediaDto[];
  initialCursor: string | null;
  initialFolders: MediaFolderNode[];
  initialTotalCount: number;
  initialUncategorisedCount: number;
  can: { upload: boolean; edit: boolean; delete: boolean };
  selectedId?: string;
  /** The configured ceiling, resolved on the server. */
  maxUploadLabel: string;
}) {
  const { toast } = useToast();
  const [items, setItems] = React.useState(initialItems);
  const [cursor, setCursor] = React.useState(initialCursor);
  const [query, setQuery] = React.useState('');
  const [kind, setKind] = React.useState<'ALL' | 'IMAGE' | 'DOCUMENT' | 'VIDEO'>('ALL');
  const [loading, setLoading] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [dragOver, setDragOver] = React.useState(false);
  const [active, setActive] = React.useState<MediaDto | null>(
    selectedId ? (initialItems.find((i) => i.id === selectedId) ?? null) : null,
  );
  const inputRef = React.useRef<HTMLInputElement>(null);
  const firstRender = React.useRef(true);

  // Folder filing. Selection drives the listing query, so filtering happens on
  // the server rather than by hiding rows the browser already downloaded.
  const [folders, setFolders] = React.useState(initialFolders);
  const [folderId, setFolderId] = React.useState<FolderSelection>('ALL');
  const [selection, setSelection] = React.useState<string[]>([]);
  const [moveOpen, setMoveOpen] = React.useState(false);
  const [moveTarget, setMoveTarget] = React.useState('');

  const refreshFolders = React.useCallback(() => {
    listMediaFolders()
      .then((next) => {
        setFolders(next);
        const filed = next.reduce((sum, folder) => sum + folder.fileCount, 0);
        setCounts((current) => ({ ...current, uncategorised: Math.max(0, current.total - filed) }));
      })
      .catch(() => toast('Could not load folders.', 'error'));
  }, [toast]);

  // Seeded from the server and refreshed alongside the tree, so the counts
  // stay honest after an upload, a move or a delete.
  const [counts, setCounts] = React.useState({
    total: initialTotalCount,
    uncategorised: initialUncategorisedCount,
  });

  // Grid reads better for photos, list for documents and for scanning alt
  // text. The choice is a per-admin convenience, so it lives in localStorage
  // rather than the URL.
  const [view, setView] = React.useState<'grid' | 'list'>('grid');

  React.useEffect(() => {
    try {
      if (window.localStorage.getItem('admin:media:view') === 'list') setView('list');
    } catch {
      // Private mode — the library still works, it just will not remember.
    }
  }, []);

  const chooseView = (next: 'grid' | 'list') => {
    setView(next);
    try {
      window.localStorage.setItem('admin:media:view', next);
    } catch {
      // Nothing to do; the choice simply lasts for this visit.
    }
  };

  // Refetch when the search or type filter changes, debounced.
  React.useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    setLoading(true);
    const timer = window.setTimeout(() => {
      listMedia({ query, kind, folderId })
        .then((result) => {
          setItems(result.items);
          setCursor(result.nextCursor);
          // A selection from another folder is meaningless once the view changes.
          setSelection([]);
        })
        .catch(() => toast('Could not load the media library.', 'error'))
        .finally(() => setLoading(false));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query, kind, folderId, toast]);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    let succeeded = 0;

    for (const file of Array.from(files)) {
      const data = new FormData();
      data.set('file', file);
      const result = await uploadMedia(data);
      if (result.ok && result.data) {
        setItems((current) => [result.data as MediaDto, ...current]);
        succeeded += 1;
      } else if (!result.ok) {
        toast(`${file.name}: ${result.error}`, 'error');
      }
    }

    setUploading(false);
    if (succeeded > 0) toast(`${succeeded} file(s) uploaded.`);
  }

  async function loadMore() {
    if (!cursor) return;
    setLoading(true);
    const result = await listMedia({ query, kind, folderId, cursor });
    setItems((current) => [...current, ...result.items]);
    setCursor(result.nextCursor);
    setLoading(false);
  }

  const orderedFolders = flattenTree(folders, (a, b) => a.name.localeCompare(b.name));

  return (
    <div className="grid gap-4 lg:grid-cols-[15rem_1fr]">
      {/* Folder tree. Above the library on small screens, beside it on large. */}
      <aside className="rounded-xl border border-hairline bg-surface p-2 lg:sticky lg:top-20 lg:self-start">
        <FolderSidebar
          folders={folders}
          selected={folderId}
          onSelect={setFolderId}
          canEdit={can.edit}
          canDelete={can.delete}
          onChanged={refreshFolders}
          totalCount={counts.total}
          uncategorisedCount={counts.uncategorised}
        />
      </aside>

      <div className="min-w-0">
        <div className="mb-3">
          <FolderBreadcrumb folders={folders} selected={folderId} onSelect={setFolderId} />
        </div>

        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative min-w-0 flex-1 sm:max-w-xs">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
              aria-hidden="true"
            />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by filename or alt text"
              aria-label="Search media"
              className="pl-9"
            />
          </div>
          <div>
            <label htmlFor="media-kind" className="sr-only">
              File type
            </label>
            <Select
              id="media-kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as typeof kind)}
              className="w-auto"
            >
              <option value="ALL">All types</option>
              <option value="IMAGE">Images</option>
              <option value="DOCUMENT">Documents</option>
              <option value="VIDEO">Video</option>
            </Select>
          </div>
          <SegmentedControl
            label="Layout"
            size="sm"
            className="shrink-0 sm:ml-auto"
            value={view}
            onChange={chooseView}
            options={[
              {
                value: 'grid',
                label: null,
                ariaLabel: 'Grid view',
                icon: <LayoutGrid className="h-4 w-4" aria-hidden="true" />,
              },
              {
                value: 'list',
                label: null,
                ariaLabel: 'List view',
                icon: <ListIcon className="h-4 w-4" aria-hidden="true" />,
              },
            ]}
          />

          {can.upload ? (
            <Button onClick={() => inputRef.current?.click()} disabled={uploading}>
              {uploading ? (
                <>
                  <Spinner className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Uploading…
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4" aria-hidden="true" />
                  Upload files
                </>
              )}
            </Button>
          ) : null}
        </div>

        {can.edit && selection.length > 0 ? (
          <BulkBar count={selection.length} onClear={() => setSelection([])}>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setMoveTarget(folderId !== 'ALL' && folderId !== 'NONE' ? folderId : '');
                setMoveOpen(true);
              }}
            >
              <FolderInput className="h-4 w-4" aria-hidden="true" />
              Move to folder
            </Button>
          </BulkBar>
        ) : null}

        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT_ATTRIBUTE}
          className="sr-only"
          onChange={(e) => {
            void handleFiles(e.target.files);
            e.target.value = '';
          }}
        />

        <Card
          className={cn('p-4 transition-colors sm:p-5', dragOver && 'border-brand bg-brand/[0.04]')}
          onDragOver={(e) => {
            if (!can.upload) return;
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            if (!can.upload) return;
            e.preventDefault();
            setDragOver(false);
            void handleFiles(e.dataTransfer.files);
          }}
        >
          {loading && items.length === 0 ? (
            <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
              {Array.from({ length: 10 }).map((_, i) => (
                <li key={i}>
                  <Skeleton className="aspect-square" />
                </li>
              ))}
            </ul>
          ) : items.length === 0 ? (
            <EmptyState
              icon={<ImageIcon className="h-5 w-5" />}
              title={query ? `No files match “${query}”` : 'No files yet'}
              description={
                can.upload
                  ? `Drag files here, or use the upload button. JPG, PNG, WEBP, GIF, SVG or PDF, up to ${maxUploadLabel} each.`
                  : 'Ask an administrator to upload files.'
              }
              action={
                can.upload ? (
                  <Button onClick={() => inputRef.current?.click()}>Upload files</Button>
                ) : undefined
              }
            />
          ) : (
            <>
              {view === 'grid' ? (
                <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
                  {items.map((item) => (
                    <li key={item.id} className="relative">
                      {can.edit ? (
                        <label className="absolute left-2 top-2 z-sticky flex cursor-pointer items-center rounded bg-surface/90 p-1 shadow-sm">
                          <input
                            type="checkbox"
                            checked={selection.includes(item.id)}
                            onChange={() =>
                              setSelection((current) =>
                                current.includes(item.id)
                                  ? current.filter((id) => id !== item.id)
                                  : [...current, item.id],
                              )
                            }
                            aria-label={`Select ${item.title || item.filename}`}
                            className="h-4 w-4 rounded border-hairline text-brand focus:ring-brand/30"
                          />
                        </label>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => setActive(item)}
                        className="group block w-full overflow-hidden rounded-lg border border-hairline text-left transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                      >
                        <span className="block aspect-square bg-muted/10">
                          <Thumbnail item={item} />
                        </span>
                        <span className="block border-t border-hairline p-2">
                          <span className="block truncate text-xs font-medium text-content">
                            {item.title || item.filename}
                          </span>
                          <span className="block text-[0.6875rem] text-muted">
                            {formatBytes(item.size)}
                            {item.width ? ` · ${item.width}×${item.height}` : ''}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <ul className="divide-y divide-hairline">
                  {items.map((item) => (
                    <li key={item.id} className="flex items-center gap-2">
                      {can.edit ? (
                        <input
                          type="checkbox"
                          checked={selection.includes(item.id)}
                          onChange={() =>
                            setSelection((current) =>
                              current.includes(item.id)
                                ? current.filter((id) => id !== item.id)
                                : [...current, item.id],
                            )
                          }
                          aria-label={`Select ${item.title || item.filename}`}
                          className="h-4 w-4 shrink-0 rounded border-hairline text-brand focus:ring-brand/30"
                        />
                      ) : null}
                      <button
                        type="button"
                        onClick={() => setActive(item)}
                        className="flex w-full items-center gap-3 py-2.5 text-left transition-colors hover:bg-muted/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                      >
                        <span className="block h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-muted/10">
                          <Thumbnail item={item} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-content">
                            {item.title || item.filename}
                          </span>
                          <span className="block truncate text-xs text-muted">
                            {/* Missing alt text is worth seeing at a glance —
                              it is the difference between an accessible page
                              and an inaccessible one. */}
                            {item.kind === 'IMAGE' && !item.altText ? (
                              <span className="text-amber-700">No alt text</span>
                            ) : (
                              item.altText || item.mimeType
                            )}
                          </span>
                        </span>
                        <span className="hidden shrink-0 text-xs text-muted sm:block">
                          {item.width
                            ? `${item.width}×${item.height}`
                            : item.mimeType.split('/')[1]}
                        </span>
                        <span className="shrink-0 text-xs text-muted">
                          {formatBytes(item.size)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {cursor ? (
                <div className="mt-6 flex justify-center">
                  <Button variant="outline" onClick={loadMore} disabled={loading}>
                    {loading ? 'Loading…' : 'Load more'}
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </Card>
      </div>

      <MediaDetail
        media={active}
        can={can}
        onClose={() => setActive(null)}
        onUpdated={(updated) => {
          setItems((current) => current.map((i) => (i.id === updated.id ? updated : i)));
          setActive(updated);
        }}
        onDeleted={(id) => {
          setItems((current) => current.filter((i) => i.id !== id));
          setActive(null);
          refreshFolders();
        }}
      />

      <Dialog
        open={moveOpen}
        onClose={() => setMoveOpen(false)}
        title={`Move ${selection.length} file(s)`}
        footer={
          <>
            <Button variant="outline" onClick={() => setMoveOpen(false)} disabled={loading}>
              Cancel
            </Button>
            <Button
              disabled={loading}
              onClick={async () => {
                const result = await moveMediaToFolder({
                  mediaIds: selection,
                  folderId: moveTarget || null,
                });
                if (!result.ok) {
                  toast(result.error ?? 'Could not move those files.', 'error');
                  return;
                }
                toast(result.message ?? 'Moved.');
                setMoveOpen(false);
                setSelection([]);
                refreshFolders();
                // Re-read the current folder so moved-away items disappear.
                listMedia({ query, kind, folderId })
                  .then((next) => {
                    setItems(next.items);
                    setCursor(next.nextCursor);
                  })
                  .catch(() => undefined);
              }}
            >
              Move files
            </Button>
          </>
        }
      >
        <Field label="Destination folder" htmlFor="media-move-target">
          <Select
            id="media-move-target"
            value={moveTarget}
            onChange={(event) => setMoveTarget(event.target.value)}
          >
            <option value="">Uncategorised</option>
            {orderedFolders.map(({ node, depth }) => (
              <option key={node.id} value={node.id}>
                {`${'— '.repeat(depth)}${node.name}`}
              </option>
            ))}
          </Select>
        </Field>
      </Dialog>
    </div>
  );
}

function MediaDetail({
  media,
  can,
  onClose,
  onUpdated,
  onDeleted,
}: {
  media: MediaDto | null;
  can: { edit: boolean; delete: boolean };
  onClose: () => void;
  onUpdated: (media: MediaDto) => void;
  onDeleted: (id: string) => void;
}) {
  const { toast } = useToast();
  const [pending, setPending] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [values, setValues] = React.useState({
    filename: '',
    slug: '',
    altText: '',
    title: '',
    caption: '',
    description: '',
  });

  React.useEffect(() => {
    if (media) {
      setValues({
        filename: media.filename,
        slug: media.slug,
        altText: media.altText ?? '',
        title: media.title ?? '',
        caption: '',
        description: '',
      });
      setCopied(false);
    }
  }, [media]);

  if (!media) return null;

  async function save() {
    if (!media) return;
    setPending(true);

    const { filename, slug, ...metadata } = values;
    const result = await updateMediaMetadata({ id: media.id, ...metadata });
    if (!result.ok) {
      setPending(false);
      toast(result.error, 'error');
      return;
    }

    let next: MediaDto = {
      ...media,
      altText: metadata.altText || null,
      title: metadata.title || null,
    };
    let message = result.message ?? 'Saved.';

    // Only when something actually changed: a rename moves the stored file, so
    // it is not something to do on every save of an alt text.
    if (filename.trim() !== media.filename || slug.trim() !== media.slug) {
      const renamed = await renameMedia({ id: media.id, filename, slug });
      if (!renamed.ok) {
        setPending(false);
        toast(renamed.error, 'error');
        return;
      }
      // Re-read from the row the action returned, so the new URL and slug are
      // what the dialog and the grid show without a reload.
      if (renamed.data) next = renamed.data;
      message = renamed.message ?? message;
    }

    setPending(false);
    toast(message);
    onUpdated(next);
  }

  async function remove() {
    if (!media) return;
    setPending(true);
    const result = await deleteMedia(media.id);
    setPending(false);
    setConfirmDelete(false);
    if (!result.ok) {
      toast(result.error, 'error');
      return;
    }
    toast(result.message ?? 'Deleted.');
    onDeleted(media.id);
  }

  return (
    <>
      <Dialog
        open={Boolean(media)}
        onClose={onClose}
        title={media.title || media.filename}
        size="lg"
        footer={
          <>
            {can.delete ? (
              <Button
                variant="danger"
                className="mr-auto"
                onClick={() => setConfirmDelete(true)}
                disabled={pending}
              >
                <Trash className="h-4 w-4" aria-hidden="true" />
                Delete
              </Button>
            ) : null}
            <Button variant="outline" onClick={onClose} disabled={pending}>
              Close
            </Button>
            {can.edit ? (
              <Button onClick={save} disabled={pending}>
                {pending ? 'Saving…' : 'Save details'}
              </Button>
            ) : null}
          </>
        }
      >
        <div className="grid gap-5 sm:grid-cols-[minmax(0,14rem)_1fr]">
          <div>
            {media.kind === 'IMAGE' ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={media.url}
                alt={media.altText ?? ''}
                className="w-full rounded-lg border border-hairline object-contain"
              />
            ) : (
              <div className="flex aspect-square items-center justify-center rounded-lg border border-hairline bg-muted/10 text-sm text-muted">
                {media.mimeType}
              </div>
            )}

            <dl className="mt-3 space-y-1 text-xs text-muted">
              <div className="flex justify-between gap-2">
                <dt>Size</dt>
                <dd>{formatBytes(media.size)}</dd>
              </div>
              {media.width ? (
                <div className="flex justify-between gap-2">
                  <dt>Dimensions</dt>
                  <dd>
                    {media.width} × {media.height}
                  </dd>
                </div>
              ) : null}
              <div className="flex justify-between gap-2">
                <dt>Type</dt>
                <dd>{media.mimeType}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>Uploaded</dt>
                <dd>{formatDate(media.createdAt)}</dd>
              </div>
            </dl>
          </div>

          <div className="space-y-4">
            <Field label="File URL">
              <div className="flex gap-2">
                <Input readOnly value={media.url} onFocus={(e) => e.currentTarget.select()} />
                <Button
                  variant="outline"
                  size="md"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(media.url);
                      setCopied(true);
                      window.setTimeout(() => setCopied(false), 2000);
                    } catch {
                      toast('Could not copy — select the field and copy manually.', 'error');
                    }
                  }}
                >
                  {copied ? (
                    <Check className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <Copy className="h-4 w-4" aria-hidden="true" />
                  )}
                  <span className="sr-only">Copy URL</span>
                </Button>
              </div>
            </Field>

            <fieldset disabled={!can.edit} className="space-y-4">
              <Field
                label="File name"
                htmlFor="media-filename"
                hint="Shown in the library and in search. Does not affect the URL."
              >
                <Input
                  id="media-filename"
                  value={values.filename}
                  onChange={(e) => setValues({ ...values, filename: e.target.value })}
                />
              </Field>
              <Field
                label="URL slug"
                htmlFor="media-slug"
                hint="Changing this moves the file and changes its public URL. Pickers follow it automatically; a link typed by hand into content will not."
              >
                <Input
                  id="media-slug"
                  value={values.slug}
                  onChange={(e) => setValues({ ...values, slug: e.target.value })}
                />
              </Field>
              <Field
                label="Alt text"
                htmlFor="media-alt"
                hint="Describes the image for screen readers and search engines."
              >
                <Input
                  id="media-alt"
                  value={values.altText}
                  onChange={(e) => setValues({ ...values, altText: e.target.value })}
                />
              </Field>
              <Field label="Title" htmlFor="media-title">
                <Input
                  id="media-title"
                  value={values.title}
                  onChange={(e) => setValues({ ...values, title: e.target.value })}
                />
              </Field>
              <Field label="Caption" htmlFor="media-caption">
                <Input
                  id="media-caption"
                  value={values.caption}
                  onChange={(e) => setValues({ ...values, caption: e.target.value })}
                />
              </Field>
              <Field label="Description" htmlFor="media-description">
                <Textarea
                  id="media-description"
                  rows={3}
                  value={values.description}
                  onChange={(e) => setValues({ ...values, description: e.target.value })}
                />
              </Field>
            </fieldset>
          </div>
        </div>
      </Dialog>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={remove}
        title="Delete this file?"
        message="The file is removed from storage. Anything still referencing it will show a broken image."
        pending={pending}
      />
    </>
  );
}

/** One thumbnail rendering shared by both views. */
function Thumbnail({ item }: { item: MediaDto }) {
  if (item.kind === 'IMAGE') {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={item.url}
        alt={item.altText ?? ''}
        loading="lazy"
        className="h-full w-full object-cover"
      />
    );
  }
  return (
    <span className="flex h-full w-full items-center justify-center text-xs font-medium text-muted">
      {item.mimeType.split('/')[1]?.slice(0, 6).toUpperCase()}
    </span>
  );
}

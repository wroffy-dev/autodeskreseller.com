'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Layers, Settings2 } from 'lucide-react';
import { parseSectionDesign } from '@/lib/cms/design';
import { getBlock, type BlockSurface } from '@/lib/cms/blocks';
import { ConfirmDialog } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import type { ActionResult } from '@/lib/utils/result';
import { cn } from '@/lib/utils/cn';
import type { BuilderSection } from './section-builder';
import type { FieldValues } from './field-renderer';
import { SectionListPanel } from './section-list-panel';
import { SectionEditorPanel } from './section-editor-panel';
import { AddSectionDialog } from './add-section-dialog';
import { SegmentedControl } from '@/components/ui/segmented-control';

/**
 * The builder workspace, independent of what it is building.
 *
 * The outline on the left and the editor on the right are the same whether the
 * sections belong to a page, the blog archive, the article layout or an
 * article's sidebar — what differs is only which Server Actions persist the
 * change. Those arrive as `actions`, so the blog builder reuses this whole
 * screen rather than growing a parallel one.
 */

export type WorkspaceActions = {
  add: (blockType: string) => Promise<ActionResult<{ id: string }>>;
  save: (
    sectionId: string,
    payload: { name: string | null; content: FieldValues; settings: FieldValues },
  ) => Promise<ActionResult>;
  duplicate: (sectionId: string) => Promise<ActionResult<{ id: string }>>;
  remove: (sectionId: string) => Promise<ActionResult>;
  reorder: (order: string[]) => Promise<ActionResult>;
  toggleVisibility: (sectionId: string) => Promise<ActionResult>;
};

type MobilePane = 'sections' | 'editor';

export function SectionWorkspace({
  initialSections,
  canEdit,
  actions,
  surface = 'page',
  dndId,
  addTitle,
  addDescription,
  emptyTitle,
  emptyDescription,
  listLabel,
  className,
}: {
  initialSections: BuilderSection[];
  canEdit: boolean;
  actions: WorkspaceActions;
  surface?: BlockSurface;
  /** Stable identity for the drag context; see `SectionListPanel`. */
  dndId?: string;
  addTitle?: string;
  addDescription?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  listLabel?: string;
  className?: string;
}) {
  const router = useRouter();
  const { toast } = useToast();

  const [sections, setSections] = React.useState(initialSections);
  const [selectedId, setSelectedId] = React.useState<string | null>(initialSections[0]?.id ?? null);
  const [addOpen, setAddOpen] = React.useState(false);
  const [pendingDelete, setPendingDelete] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [mobilePane, setMobilePane] = React.useState<MobilePane>('sections');

  React.useEffect(() => {
    setSections(initialSections);
  }, [initialSections]);

  const selected = sections.find((section) => section.id === selectedId) ?? null;

  const anchorsForOthers = React.useCallback(
    (sectionId: string) =>
      sections
        .filter((section) => section.id !== sectionId)
        .map((section) => parseSectionDesign(section.settings).anchorId)
        .filter(Boolean),
    [sections],
  );

  /** Types already used that the registry marks as one-per-surface. */
  const usedSingletons = React.useMemo(
    () =>
      sections
        .filter((section) => getBlock(section.blockType)?.singleton)
        .map((section) => section.blockType),
    [sections],
  );

  async function onReorder(ordered: BuilderSection[]) {
    const previous = sections;
    setSections(ordered); // optimistic
    const result = await actions.reorder(ordered.map((section) => section.id));
    if (!result.ok) {
      setSections(previous);
      toast(result.error, 'error');
    }
  }

  async function onAdd(blockType: string) {
    setBusy(true);
    const result = await actions.add(blockType);
    setBusy(false);
    setAddOpen(false);

    if (!result.ok) {
      toast(result.error, 'error');
      return;
    }

    const definition = getBlock(blockType);
    const created: BuilderSection = {
      id: result.data!.id,
      blockType,
      name: definition?.label ?? blockType,
      isVisible: true,
      sortOrder: (sections[sections.length - 1]?.sortOrder ?? 0) + 10,
      content: (definition ? (definition.schema.parse({}) as FieldValues) : {}) as FieldValues,
      settings: {},
    };

    setSections((current) => [...current, created]);
    setSelectedId(created.id);
    setMobilePane('editor');
    toast(result.message ?? 'Section added.');
  }

  async function onSaveSection(next: {
    name: string | null;
    content: FieldValues;
    settings: FieldValues;
  }): Promise<boolean> {
    if (!selected) return false;
    const result = await actions.save(selected.id, next);
    if (!result.ok) {
      toast(result.error, 'error');
      return false;
    }
    setSections((current) =>
      current.map((section) => (section.id === selected.id ? { ...section, ...next } : section)),
    );
    return true;
  }

  async function onDuplicate(sectionId: string) {
    setBusy(true);
    const result = await actions.duplicate(sectionId);
    setBusy(false);
    if (!result.ok) {
      toast(result.error, 'error');
      return;
    }
    toast('Section duplicated.');
    // The copy is created server-side, so pull the authoritative list back.
    router.refresh();
  }

  async function onDelete(sectionId: string) {
    setBusy(true);
    const result = await actions.remove(sectionId);
    setBusy(false);
    setPendingDelete(null);
    if (!result.ok) {
      toast(result.error, 'error');
      return;
    }
    setSections((current) => current.filter((section) => section.id !== sectionId));
    setSelectedId((current) => (current === sectionId ? null : current));
    toast('Section removed.');
  }

  async function onToggleVisibility(sectionId: string) {
    const previous = sections;
    setSections((current) =>
      current.map((section) =>
        section.id === sectionId ? { ...section, isVisible: !section.isVisible } : section,
      ),
    );
    const result = await actions.toggleVisibility(sectionId);
    if (!result.ok) {
      setSections(previous);
      toast(result.error, 'error');
    }
  }

  const deleteTarget = sections.find((section) => section.id === pendingDelete);

  return (
    <>
      {/* Pane switcher — small screens only. */}
      <SegmentedControl
        semantics="tabs"
        label="Workspace pane"
        fullWidth
        className="mb-3 lg:hidden"
        value={mobilePane}
        onChange={setMobilePane}
        options={[
          {
            value: 'sections',
            label: listLabel ?? 'Sections',
            icon: <Layers className="h-3.5 w-3.5" aria-hidden="true" />,
          },
          {
            value: 'editor',
            label: 'Edit',
            icon: <Settings2 className="h-3.5 w-3.5" aria-hidden="true" />,
          },
        ]}
      />

      <div
        className={cn(
          'grid gap-4 lg:h-[calc(100dvh-13rem)] lg:grid-cols-[18rem_1fr] lg:gap-3',
          className,
        )}
      >
        <div
          className={cn(
            'overflow-hidden rounded-xl border border-hairline bg-surface',
            'lg:flex lg:min-h-0 lg:flex-col',
            mobilePane === 'sections' ? 'flex min-h-[24rem] flex-col' : 'hidden',
          )}
        >
          <SectionListPanel
            sections={sections}
            selectedId={selectedId}
            canEdit={canEdit}
            busy={busy}
            label={listLabel}
            dndId={dndId ?? surface}
            emptyTitle={emptyTitle}
            emptyDescription={emptyDescription}
            onSelect={(id) => {
              setSelectedId(id);
              setMobilePane('editor');
            }}
            onReorder={onReorder}
            onToggleVisibility={onToggleVisibility}
            onDuplicate={onDuplicate}
            onDelete={(id) => setPendingDelete(id)}
            onAdd={() => setAddOpen(true)}
          />
        </div>

        <div
          className={cn(
            'overflow-hidden rounded-xl border border-hairline bg-surface',
            'lg:flex lg:min-h-0 lg:flex-col',
            mobilePane === 'editor' ? 'flex min-h-[24rem] flex-col' : 'hidden',
          )}
        >
          {selected ? (
            <SectionEditorPanel
              key={selected.id}
              section={selected}
              canEdit={canEdit}
              takenAnchors={anchorsForOthers(selected.id)}
              onSave={onSaveSection}
              onClose={() => setMobilePane('sections')}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center p-6 text-center">
              <div>
                <Settings2 className="mx-auto h-8 w-8 text-muted/40" aria-hidden="true" />
                <p className="mt-3 text-sm font-medium text-content">Nothing selected</p>
                <p className="mt-1 text-xs text-muted">
                  {sections.length === 0
                    ? (emptyDescription ?? 'Add a section to start building.')
                    : 'Choose an item on the left to edit its content and design.'}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      <AddSectionDialog
        open={addOpen}
        busy={busy}
        surface={surface}
        title={addTitle}
        description={addDescription}
        usedSingletons={usedSingletons}
        onClose={() => setAddOpen(false)}
        onAdd={onAdd}
      />

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => pendingDelete && onDelete(pendingDelete)}
        title={
          deleteTarget
            ? `Remove “${deleteTarget.name || getBlock(deleteTarget.blockType)?.label}”?`
            : 'Remove this section?'
        }
        message="The section and everything you have written in it are permanently removed. To take it off the website without losing the content, hide it instead."
        confirmLabel="Remove section"
        pending={busy}
      />
    </>
  );
}

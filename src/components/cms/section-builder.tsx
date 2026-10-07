'use client';

import * as React from 'react';
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
import {
  GripVertical,
  Eye,
  EyeOff,
  Copy,
  Trash,
  Plus,
  ChevronDown,
  Settings,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import { BLOCK_PICKER_LIST, getBlock, BLOCK_GROUPS } from '@/lib/cms/blocks';
import { parseSectionDesign, type SectionDesign } from '@/lib/cms/design';
import {
  addSection,
  updateSection,
  deleteSection,
  duplicateSection,
  reorderSections,
  toggleSectionVisibility,
} from '@/lib/actions/pages';
import { FieldList, type FieldValues } from './field-renderer';
import { writeFieldPath } from '@/lib/cms/fields';
import { DesignPanel } from './design-panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { Dialog, ConfirmDialog } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/states';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { Spinner } from '@/components/ui/icons';
import { cn } from '@/lib/utils/cn';
import { SegmentedControl } from '@/components/ui/segmented-control';

export type BuilderSection = {
  id: string;
  blockType: string;
  name: string | null;
  isVisible: boolean;
  sortOrder: number;
  content: FieldValues;
  settings: FieldValues;
};

export function SectionBuilder({
  pageId,
  initialSections,
  canEdit,
}: {
  pageId: string;
  initialSections: BuilderSection[];
  canEdit: boolean;
}) {
  const { toast } = useToast();
  const [sections, setSections] = React.useState(initialSections);
  const [addOpen, setAddOpen] = React.useState(false);
  const [pendingDelete, setPendingDelete] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [expanded, setExpanded] = React.useState<string | null>(null);

  React.useEffect(() => setSections(initialSections), [initialSections]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  async function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = sections.findIndex((s) => s.id === active.id);
    const newIndex = sections.findIndex((s) => s.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const previous = sections;
    const next = arrayMove(sections, oldIndex, newIndex);
    setSections(next); // optimistic

    const result = await reorderSections({ pageId, order: next.map((s) => s.id) });
    if (!result.ok) {
      setSections(previous);
      toast(result.error, 'error');
    }
  }

  async function onAdd(blockType: string) {
    setBusy(true);
    const result = await addSection(pageId, blockType);
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
    setExpanded(created.id);
    toast(result.message ?? 'Section added.');
  }

  async function onDuplicate(sectionId: string) {
    setBusy(true);
    const result = await duplicateSection(sectionId);
    setBusy(false);
    if (!result.ok) {
      toast(result.error, 'error');
      return;
    }
    toast('Section duplicated.');
    window.location.reload();
  }

  async function onDelete(sectionId: string) {
    setBusy(true);
    const result = await deleteSection(sectionId);
    setBusy(false);
    setPendingDelete(null);
    if (!result.ok) {
      toast(result.error, 'error');
      return;
    }
    setSections((current) => current.filter((s) => s.id !== sectionId));
    toast('Section removed.');
  }

  async function onToggleVisibility(sectionId: string) {
    const previous = sections;
    setSections((current) =>
      current.map((s) => (s.id === sectionId ? { ...s, isVisible: !s.isVisible } : s)),
    );
    const result = await toggleSectionVisibility(sectionId);
    if (!result.ok) {
      setSections(previous);
      toast(result.error, 'error');
    }
  }

  /** Keyboard-friendly alternative to dragging. Persists the same way. */
  async function onMove(sectionId: string, delta: number) {
    const index = sections.findIndex((s) => s.id === sectionId);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= sections.length) return;

    const previous = sections;
    const next = arrayMove(sections, index, target);
    setSections(next);

    const result = await reorderSections({ pageId, order: next.map((s) => s.id) });
    if (!result.ok) {
      setSections(previous);
      toast(result.error, 'error');
    }
  }

  const grouped = React.useMemo(
    () =>
      BLOCK_GROUPS.map((group) => [group, BLOCK_PICKER_LIST.filter((b) => b.group === group)] as const).filter(
        ([, blocks]) => blocks.length > 0,
      ),
    [],
  );

  /** Anchor IDs already in use, so the design panel can flag duplicates. */
  const anchorsBySection = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const section of sections) {
      const anchor = parseSectionDesign(section.settings).anchorId;
      if (anchor) map.set(section.id, anchor);
    }
    return map;
  }, [sections]);

  return (
    <div>
      {sections.length === 0 ? (
        <EmptyState
          icon={<Plus className="h-5 w-5" />}
          title="This page has no sections yet"
          description="Add a hero, then build the page up section by section."
          action={
            canEdit ? (
              <Button onClick={() => setAddOpen(true)}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                Add section
              </Button>
            ) : undefined
          }
        />
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={sections.map((s) => s.id)} strategy={verticalListSortingStrategy}>
            <ul className="space-y-2.5">
              {sections.map((section, index) => (
                <SortableSection
                  key={section.id}
                  section={section}
                  index={index}
                  canEdit={canEdit}
                  expanded={expanded === section.id}
                  onToggleExpand={() => setExpanded(expanded === section.id ? null : section.id)}
                  onToggleVisibility={() => onToggleVisibility(section.id)}
                  onDuplicate={() => onDuplicate(section.id)}
                  onDelete={() => setPendingDelete(section.id)}
                  onMoveUp={index > 0 ? () => onMove(section.id, -1) : undefined}
                  onMoveDown={index < sections.length - 1 ? () => onMove(section.id, 1) : undefined}
                  takenAnchors={Array.from(anchorsBySection.entries())
                    .filter(([id]) => id !== section.id)
                    .map(([, anchor]) => anchor)}
                  onSaved={(updated) =>
                    setSections((current) =>
                      current.map((s) => (s.id === updated.id ? { ...s, ...updated } : s)),
                    )
                  }
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      {canEdit && sections.length > 0 ? (
        <Button variant="outline" onClick={() => setAddOpen(true)} className="mt-4 w-full justify-center">
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add section
        </Button>
      ) : null}

      <Dialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add a section"
        description="Pick a block. You can reorder and configure it after adding."
        size="lg"
      >
        {busy ? (
          <p className="flex items-center gap-2 py-6 text-sm text-muted">
            <Spinner className="h-4 w-4 animate-spin" aria-hidden="true" />
            Adding…
          </p>
        ) : (
          <div className="space-y-6">
            {grouped.map(([group, blocks]) => (
              <div key={group}>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{group}</h3>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {blocks.map((block) => (
                    <li key={block.type}>
                      <button
                        type="button"
                        onClick={() => onAdd(block.type)}
                        className="w-full rounded-lg border border-hairline p-3 text-left transition-colors hover:border-brand hover:bg-brand/[0.04]"
                      >
                        <span className="block text-sm font-medium text-content">{block.label}</span>
                        <span className="mt-0.5 block text-xs leading-relaxed text-muted">
                          {block.description}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Dialog>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => pendingDelete && onDelete(pendingDelete)}
        title="Remove this section?"
        message="The section and its content will be permanently removed from this page."
        confirmLabel="Remove section"
        pending={busy}
      />
    </div>
  );
}

function SortableSection({
  section,
  index,
  canEdit,
  expanded,
  onToggleExpand,
  onToggleVisibility,
  onDuplicate,
  onDelete,
  onMoveUp,
  onMoveDown,
  takenAnchors,
  onSaved,
}: {
  section: BuilderSection;
  index: number;
  canEdit: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  onToggleVisibility: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  takenAnchors: string[];
  onSaved: (section: BuilderSection) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: section.id,
    disabled: !canEdit,
  });

  const definition = getBlock(section.blockType);

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'rounded-xl border bg-surface shadow-sm',
        isDragging ? 'border-brand opacity-80 shadow-lg' : 'border-hairline',
        !section.isVisible && 'opacity-60',
      )}
    >
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label={`Reorder ${section.name ?? definition?.label ?? 'section'}`}
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
              aria-label="Move section up"
              title="Move up"
              className="rounded px-1 text-[0.625rem] leading-none text-muted transition-colors hover:text-content disabled:opacity-30"
            >
              <ArrowUp className="h-3 w-3" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={onMoveDown}
              disabled={!onMoveDown}
              aria-label="Move section down"
              title="Move down"
              className="rounded px-1 text-[0.625rem] leading-none text-muted transition-colors hover:text-content disabled:opacity-30"
            >
              <ArrowDown className="h-3 w-3" aria-hidden="true" />
            </button>
          </span>
        ) : null}

        <span className="w-6 shrink-0 text-center text-xs font-medium text-muted">{index + 1}</span>

        <button
          type="button"
          onClick={onToggleExpand}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-2 py-1 text-left"
        >
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-content">
              {section.name || definition?.label || section.blockType}
            </span>
            <span className="block text-xs text-muted">{definition?.label ?? section.blockType}</span>
          </span>
        </button>

        {!section.isVisible ? <Badge tone="neutral">Hidden</Badge> : null}
        {!definition ? <Badge tone="danger">Unknown block</Badge> : null}

        {canEdit ? (
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              onClick={onToggleVisibility}
              aria-label={section.isVisible ? 'Hide section' : 'Show section'}
              title={section.isVisible ? 'Hide section' : 'Show section'}
              className="rounded p-1.5 text-muted transition-colors hover:bg-muted/10 hover:text-content"
            >
              {section.isVisible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={onDuplicate}
              aria-label="Duplicate section"
              title="Duplicate section"
              className="rounded p-1.5 text-muted transition-colors hover:bg-muted/10 hover:text-content"
            >
              <Copy className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onDelete}
              aria-label="Remove section"
              title="Remove section"
              className="rounded p-1.5 text-muted transition-colors hover:bg-red-50 hover:text-red-600"
            >
              <Trash className="h-4 w-4" />
            </button>
          </div>
        ) : null}

        <ChevronDown
          className={cn('h-4 w-4 shrink-0 text-muted transition-transform', expanded && 'rotate-180')}
          aria-hidden="true"
        />
      </div>

      {expanded ? (
        <SectionEditor
          section={section}
          canEdit={canEdit}
          takenAnchors={takenAnchors}
          onSaved={onSaved}
        />
      ) : null}
    </li>
  );
}

function SectionEditor({
  section,
  canEdit,
  takenAnchors,
  onSaved,
}: {
  section: BuilderSection;
  canEdit: boolean;
  takenAnchors: string[];
  onSaved: (section: BuilderSection) => void;
}) {
  const { toast } = useToast();
  const definition = getBlock(section.blockType);
  const [tab, setTab] = React.useState<'content' | 'design'>('content');
  const [name, setName] = React.useState(section.name ?? '');
  const [content, setContent] = React.useState<FieldValues>(section.content);
  const [settings, setSettings] = React.useState<FieldValues>(section.settings);
  const [saving, setSaving] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);

  if (!definition) {
    return (
      <div className="border-t border-hairline p-4 text-sm text-muted">
        No editor is registered for the block type <code className="font-mono">{section.blockType}</code>.
        Remove this section or restore the block.
      </div>
    );
  }

  async function save() {
    setSaving(true);
    const result = await updateSection(section.id, {
      name: name || null,
      content,
      settings,
    });
    setSaving(false);
    if (!result.ok) {
      toast(result.error, 'error');
      return;
    }
    setDirty(false);
    onSaved({ ...section, name: name || null, content, settings });
    toast('Section saved.');
  }

  return (
    <div className="border-t border-hairline">
      <div className="border-b border-hairline px-3 py-2">
        <SegmentedControl
          semantics="tabs"
          label="Section editor"
          size="sm"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'content', label: 'Content' },
            {
              value: 'design',
              label: 'Design',
              icon: <Settings className="h-3.5 w-3.5" aria-hidden="true" />,
            },
          ]}
        />
      </div>

      <fieldset disabled={!canEdit || saving} className="space-y-4 p-4">
        {tab === 'content' ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label
                  htmlFor={`name-${section.id}`}
                  className="mb-1.5 block text-sm font-medium text-content"
                >
                  Section label
                </label>
                <Input
                  id={`name-${section.id}`}
                  value={name}
                  placeholder={definition.label}
                  onChange={(e) => {
                    setName(e.target.value);
                    setDirty(true);
                  }}
                />
                <p className="mt-1 text-xs text-muted">Only shown here, to help you find the section.</p>
              </div>
            </div>

            <FieldList
              fields={definition.fields}
              values={content}
              idPrefix={`c-${section.id}`}
              onChange={(field, value) => {
                setContent((current) => writeFieldPath(current, field, value) as FieldValues);
                setDirty(true);
              }}
            />
          </>
        ) : (
          <DesignPanel
            value={settings}
            idPrefix={`s-${section.id}`}
            takenAnchors={takenAnchors}
            onChange={(next: SectionDesign) => {
              setSettings(next as unknown as FieldValues);
              setDirty(true);
            }}
          />
        )}
      </fieldset>

      {canEdit ? (
        <div className="flex items-center justify-end gap-2 border-t border-hairline bg-muted/[0.03] px-4 py-3">
          {dirty ? <span className="mr-auto text-xs text-amber-600">Unsaved changes</span> : null}
          <Button size="sm" onClick={save} disabled={saving || !dirty}>
            {saving ? (
              <>
                <Spinner className="h-4 w-4 animate-spin" aria-hidden="true" />
                Saving…
              </>
            ) : (
              'Save section'
            )}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

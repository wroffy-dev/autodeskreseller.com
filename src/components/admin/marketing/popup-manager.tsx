'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Pencil, Trash, Megaphone } from 'lucide-react';
import { savePopup, togglePopup, deletePopup } from '@/lib/actions/campaigns';
import { Dialog, ConfirmDialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea, Switch, usePersistedToggle } from '@/components/ui/field';
import { DateField } from '@/components/ui/date-field';
import { Button } from '@/components/ui/button';
import { Table, TableWrap, Th, Td, Tr } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/states';
import { Badge } from '@/components/ui/badge';
import { MediaPicker } from '@/components/admin/media-picker';
import { StringListEditor } from '@/components/admin/list-editor';
import { useToast } from '@/components/ui/toast';
import { Spinner } from '@/components/ui/icons';
import { formatDate } from '@/lib/utils/format';

export type PopupRow = {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
  trigger: string;
  delaySeconds: number;
  scrollPercent: number;
  device: string;
  frequencyDays: number;
  heading: string | null;
  body: string | null;
  imageId: string | null;
  formId: string | null;
  leadMagnetId: string | null;
  ctaLabel: string | null;
  ctaUrl: string | null;
  startsAt: string | null;
  endsAt: string | null;
  urlPatterns: string[];
  /** Null shows the popup in every market. */
  countryId: string | null;
};

const TYPE_LABELS: Record<string, string> = {
  OFFER: 'Offer',
  IMAGE: 'Image',
  LEAD_FORM: 'Lead form',
  NEWSLETTER: 'Newsletter',
  PRODUCT: 'Product',
  LEAD_MAGNET: 'Lead magnet',
};

const TRIGGER_LABELS: Record<string, string> = {
  IMMEDIATE: 'Immediately',
  DELAY: 'After a delay',
  SCROLL: 'On scroll',
  EXIT_INTENT: 'On exit intent',
};

function blank(): PopupRow {
  return {
    id: '',
    name: '',
    type: 'LEAD_FORM',
    isActive: false,
    trigger: 'DELAY',
    delaySeconds: 5,
    scrollPercent: 50,
    device: 'ALL',
    frequencyDays: 7,
    heading: '',
    body: '',
    imageId: null,
    formId: null,
    leadMagnetId: null,
    ctaLabel: '',
    ctaUrl: '',
    startsAt: null,
    endsAt: null,
    urlPatterns: [],
    countryId: null,
  };
}

export function PopupManager({
  rows,
  forms,
  leadMagnets,
  countries = [],
  canEdit,
}: {
  rows: PopupRow[];
  /** Markets a popup can be targeted at. Empty on a single-market install. */
  countries?: Array<{ id: string; name: string }>;
  forms: Array<{ id: string; name: string }>;
  leadMagnets: Array<{ id: string; title: string }>;
  canEdit: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [editing, setEditing] = React.useState<PopupRow | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState<PopupRow | null>(null);
  const [pending, setPending] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string[]>>({});

  async function run(fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) {
    setPending(true);
    const result = await fn();
    setPending(false);
    if (!result.ok) {
      toast(result.error ?? 'Something went wrong.', 'error');
      return false;
    }
    toast(result.message ?? 'Done.');
    router.refresh();
    return true;
  }

  async function save() {
    if (!editing) return;
    setPending(true);
    setErrors({});
    const result = await savePopup(editing.id || null, editing);
    setPending(false);
    if (!result.ok) {
      setErrors(result.fieldErrors ?? {});
      toast(result.error, 'error');
      return;
    }
    toast(result.message ?? 'Saved.');
    setEditing(null);
    router.refresh();
  }

  const set = (patch: Partial<PopupRow>) => setEditing((current) => (current ? { ...current, ...patch } : current));

  return (
    <>
      {canEdit ? (
        <div className="mb-4">
          <Button onClick={() => setEditing(blank())}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            New popup
          </Button>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          icon={<Megaphone className="h-5 w-5" />}
          title="No popups yet"
          description="Use a popup for a time-limited offer or to capture newsletter sign-ups."
          action={canEdit ? <Button onClick={() => setEditing(blank())}>New popup</Button> : undefined}
        />
      ) : (
        <TableWrap>
          <Table className="min-w-[44rem]">
            <caption className="sr-only">Popups</caption>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Type</Th>
                <Th>Trigger</Th>
                <Th>Targeting</Th>
                <Th>Schedule</Th>
                <Th>Status</Th>
                <Th align="right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <Tr key={row.id}>
                  <Td>
                    <span className="font-medium text-content">{row.name}</span>
                    {row.heading ? <span className="block text-xs text-muted">{row.heading}</span> : null}
                  </Td>
                  <Td className="text-sm text-muted">{TYPE_LABELS[row.type] ?? row.type}</Td>
                  <Td className="text-sm text-muted">
                    {TRIGGER_LABELS[row.trigger] ?? row.trigger}
                    {row.trigger === 'DELAY' ? ` (${row.delaySeconds}s)` : ''}
                    {row.trigger === 'SCROLL' ? ` (${row.scrollPercent}%)` : ''}
                  </Td>
                  <Td className="text-sm text-muted">
                    {row.urlPatterns.length > 0 ? `${row.urlPatterns.length} page rule(s)` : 'Every page'}
                    {row.device !== 'ALL' ? ` · ${row.device.toLowerCase()}` : ''}
                  </Td>
                  <Td className="whitespace-nowrap text-sm text-muted">
                    {row.startsAt || row.endsAt
                      ? `${row.startsAt ? formatDate(row.startsAt) : '—'} → ${row.endsAt ? formatDate(row.endsAt) : '—'}`
                      : 'Always'}
                  </Td>
                  <Td>
                    {canEdit ? (
                      <PopupActiveSwitch id={row.id} name={row.name} isActive={row.isActive} />
                    ) : (
                      <Badge tone={row.isActive ? 'success' : 'neutral'}>
                        {row.isActive ? 'Active' : 'Off'}
                      </Badge>
                    )}
                  </Td>
                  <Td align="right">
                    {canEdit ? (
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => setEditing(row)}
                          aria-label={`Edit ${row.name}`}
                          className="rounded p-1.5 text-muted hover:bg-muted/10 hover:text-content"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDelete(row)}
                          aria-label={`Delete ${row.name}`}
                          className="rounded p-1.5 text-muted hover:bg-red-50 hover:text-red-600"
                        >
                          <Trash className="h-4 w-4" />
                        </button>
                      </div>
                    ) : null}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      )}

      <Dialog
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing?.id ? 'Edit popup' : 'New popup'}
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={save} disabled={pending || !editing?.name.trim()}>
              {pending ? (
                <>
                  <Spinner className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Saving…
                </>
              ) : (
                'Save popup'
              )}
            </Button>
          </>
        }
      >
        {editing ? (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Internal name" htmlFor="popup-name" required error={errors.name}>
                <Input id="popup-name" value={editing.name} onChange={(e) => set({ name: e.target.value })} />
              </Field>
              <Field label="Type" htmlFor="popup-type">
                <Select id="popup-type" value={editing.type} onChange={(e) => set({ type: e.target.value })}>
                  {Object.entries(TYPE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </Select>
              </Field>
            </div>

            <Field label="Heading" htmlFor="popup-heading">
              <Input
                id="popup-heading"
                value={editing.heading ?? ''}
                onChange={(e) => set({ heading: e.target.value })}
              />
            </Field>
            <Field label="Body" htmlFor="popup-body">
              <Textarea
                id="popup-body"
                rows={3}
                value={editing.body ?? ''}
                onChange={(e) => set({ body: e.target.value })}
              />
            </Field>
            <Field label="Image">
              <MediaPicker value={editing.imageId} onChange={(id) => set({ imageId: id })} label="Popup image" />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Form" htmlFor="popup-form" error={errors.formId} hint="Required for the lead form type.">
                <Select
                  id="popup-form"
                  value={editing.formId ?? ''}
                  onChange={(e) => set({ formId: e.target.value || null })}
                >
                  <option value="">None</option>
                  {forms.map((form) => (<option key={form.id} value={form.id}>{form.name}</option>))}
                </Select>
              </Field>
              <Field label="Lead magnet" htmlFor="popup-magnet">
                <Select
                  id="popup-magnet"
                  value={editing.leadMagnetId ?? ''}
                  onChange={(e) => set({ leadMagnetId: e.target.value || null })}
                >
                  <option value="">None</option>
                  {leadMagnets.map((magnet) => (
                    <option key={magnet.id} value={magnet.id}>{magnet.title}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Button label" htmlFor="popup-cta-label">
                <Input
                  id="popup-cta-label"
                  value={editing.ctaLabel ?? ''}
                  onChange={(e) => set({ ctaLabel: e.target.value })}
                />
              </Field>
              <Field label="Button link" htmlFor="popup-cta-url" hint="Used when no form is attached.">
                <Input
                  id="popup-cta-url"
                  value={editing.ctaUrl ?? ''}
                  onChange={(e) => set({ ctaUrl: e.target.value })}
                />
              </Field>
            </div>

            <fieldset className="space-y-4 rounded-lg border border-hairline p-4">
              <legend className="px-1 text-sm font-medium text-content">When to show it</legend>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Trigger" htmlFor="popup-trigger">
                  <Select
                    id="popup-trigger"
                    value={editing.trigger}
                    onChange={(e) => set({ trigger: e.target.value })}
                  >
                    {Object.entries(TRIGGER_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </Select>
                </Field>
                {editing.trigger === 'DELAY' ? (
                  <Field label="Delay (seconds)" htmlFor="popup-delay">
                    <Input
                      id="popup-delay"
                      type="number"
                      min={0}
                      max={600}
                      value={editing.delaySeconds}
                      onChange={(e) => set({ delaySeconds: Number(e.target.value) })}
                    />
                  </Field>
                ) : null}
                {editing.trigger === 'SCROLL' ? (
                  <Field label="Scroll depth (%)" htmlFor="popup-scroll">
                    <Input
                      id="popup-scroll"
                      type="number"
                      min={1}
                      max={100}
                      value={editing.scrollPercent}
                      onChange={(e) => set({ scrollPercent: Number(e.target.value) })}
                    />
                  </Field>
                ) : null}
                {countries.length > 0 ? (
                  <Field
                    label="Country"
                    htmlFor="popup-country"
                    hint="Targets one storefront. Leave as all countries to show it everywhere."
                  >
                    <Select
                      id="popup-country"
                      value={editing.countryId ?? ''}
                      onChange={(e) => set({ countryId: e.target.value || null })}
                    >
                      <option value="">All countries</option>
                      {countries.map((country) => (
                        <option key={country.id} value={country.id}>
                          {country.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ) : null}
                <Field label="Devices" htmlFor="popup-device">
                  <Select
                    id="popup-device"
                    value={editing.device}
                    onChange={(e) => set({ device: e.target.value })}
                  >
                    <option value="ALL">All devices</option>
                    <option value="DESKTOP">Desktop only</option>
                    <option value="MOBILE">Mobile only</option>
                  </Select>
                </Field>
                <Field
                  label="Show again after (days)"
                  htmlFor="popup-frequency"
                  hint="0 shows it on every visit."
                >
                  <Input
                    id="popup-frequency"
                    type="number"
                    min={0}
                    max={365}
                    value={editing.frequencyDays}
                    onChange={(e) => set({ frequencyDays: Number(e.target.value) })}
                  />
                </Field>
                <Field label="Start date" htmlFor="popup-start">
                  <DateField
                    id="popup-start"
                    label="Start date"
                    value={editing.startsAt ? editing.startsAt.slice(0, 10) : ''}
                    max={editing.endsAt ? editing.endsAt.slice(0, 10) : undefined}
                    onChange={(next) => set({ startsAt: next || null })}
                  />
                </Field>
                <Field label="End date" htmlFor="popup-end" error={errors.endsAt}>
                  <DateField
                    id="popup-end"
                    label="End date"
                    value={editing.endsAt ? editing.endsAt.slice(0, 10) : ''}
                    min={editing.startsAt ? editing.startsAt.slice(0, 10) : undefined}
                    invalid={!!errors.endsAt}
                    onChange={(next) => set({ endsAt: next || null })}
                  />
                </Field>
              </div>

              <StringListEditor
                label="Page rules"
                itemLabel="rule"
                value={editing.urlPatterns}
                onChange={(next) => set({ urlPatterns: next })}
                placeholder="pricing or blog/*"
              />
              <p className="text-xs text-muted">
                Leave empty to show on every page. A trailing * matches everything below that path.
              </p>
            </fieldset>

            <div className="rounded-lg border border-hairline p-4">
              <Switch
                checked={editing.isActive}
                onChange={(next) => set({ isActive: next })}
                label="Popup is live"
              />
            </div>
          </div>
        ) : null}
      </Dialog>

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        onConfirm={async () => {
          if (confirmDelete) await run(() => deletePopup(confirmDelete.id));
          setConfirmDelete(null);
        }}
        title="Delete this popup?"
        message="It stops appearing on the site immediately."
        pending={pending}
      />
    </>
  );
}

/**
 * A popup's on/off state, saved the moment it is flipped. A failed save puts
 * the switch back and says why, so the list never shows a state that is not
 * the stored one.
 */
function PopupActiveSwitch({ id, name, isActive }: { id: string; name: string; isActive: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const state = usePersistedToggle(isActive, async (next) => {
    const result = await togglePopup(id, next);
    if (!result.ok) {
      toast(result.error, 'error');
      return { ok: false, error: result.error };
    }
    toast(result.message ?? 'Saved.');
    router.refresh();
    return { ok: true, value: result.data?.isActive };
  });

  return (
    <div>
      <div className="flex items-center gap-2">
        <Switch
          size="sm"
          checked={state.checked}
          pending={state.pending}
          onChange={state.toggle}
          label={<span className="sr-only">Show “{name}” on the site</span>}
        />
        <span className="text-xs font-medium text-muted" aria-hidden="true">
          {state.pending ? 'Saving…' : state.checked ? 'Active' : 'Off'}
        </span>
      </div>
      {state.error ? (
        <p role="alert" className="mt-1 max-w-[12rem] text-xs font-medium text-red-600">
          Not saved — {state.error}
        </p>
      ) : null}
    </div>
  );
}

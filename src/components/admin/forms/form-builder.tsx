'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Plus, Trash, ChevronDown, Copy } from 'lucide-react';
import { saveForm } from '@/lib/actions/forms';
import { formFieldTypes } from '@/lib/validation/form';
import {
  newField,
  nextFieldKey,
  uniqueFieldName,
  FIELD_TYPE_LABELS,
  MAPPED_FIELD_TYPES,
  CHOICE_FIELD_TYPES,
  NO_PLACEHOLDER_TYPES,
  NUMERIC_FIELD_TYPES,
  STRUCTURAL_FIELD_TYPES,
  EMPTY_FORM,
  toFieldPayload,
  type BuilderField,
  type FormBuilderValues,
} from '@/lib/cms/form-model';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { AdminTabs, TabPanel } from '@/components/admin/admin-tabs';
import { FieldPalette } from './field-palette';
import { FormDesignPanel } from './form-design-panel';
import {
  CONDITION_OPERATOR_LABELS,
  VALUELESS_OPERATORS,
} from '@/lib/forms/field-settings';
import { Field, Input, Select, Textarea, Switch } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { Spinner } from '@/components/ui/icons';
import { Alert } from '@/components/ui/states';
import { buildCombinedLabel, marketingConflict } from '@/lib/privacy/consent';
import { slugify } from '@/lib/utils/slug';
import { cn } from '@/lib/utils/cn';

/*
 * The builder's data model lives in lib/cms/form-model so Server Components can
 * use it too. These re-exports keep the original import paths working.
 */
export { EMPTY_FORM, newField };
export type { BuilderField, FormBuilderValues };

const TYPE_LABELS = FIELD_TYPE_LABELS;

export function FormBuilder({
  initial,
  products,
  countries = [],
  mode,
  canEdit,
}: {
  initial: FormBuilderValues;
  products: Array<{ id: string; name: string }>;
  /** Markets a form can be bound to. Empty on a single-market installation. */
  countries?: Array<{ id: string; name: string }>;
  mode: 'create' | 'edit';
  canEdit: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [values, setValues] = React.useState(initial);
  const [errors, setErrors] = React.useState<Record<string, string[]>>({});
  const [pending, setPending] = React.useState(false);
  const [openField, setOpenField] = React.useState<string | null>(null);
  const [slugTouched, setSlugTouched] = React.useState(mode === 'edit');
  const [settingsTab, setSettingsTab] = React.useState('general');

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const set = <K extends keyof FormBuilderValues>(key: K, value: FormBuilderValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  const updateField = (key: string, patch: Partial<BuilderField>) =>
    setValues((current) => ({
      ...current,
      fields: current.fields.map((field) => (field.key === key ? { ...field, ...patch } : field)),
    }));

  function addField(type: string) {
    const field = newField(type);
    // Derive a machine name from the label so the admin rarely has to think about it.
    field.name = uniqueFieldName(slugify(field.label).replace(/-/g, '_'), values.fields);
    setValues((current) => ({
      ...current,
      fields: [...current.fields, field],
    }));
    setOpenField(field.key);
  }

  function duplicateField(key: string) {
    const index = values.fields.findIndex((f) => f.key === key);
    if (index < 0) return;
    const source = values.fields[index]!;
    const copy: BuilderField = {
      ...source,
      // A copy is a brand-new row: it must not overwrite the original on save,
      // and its machine name has to stay unique within the form.
      key: nextFieldKey(),
      id: null,
      name: uniqueFieldName(source.name || 'field', values.fields),
      options: source.options.map((option) => ({ ...option })),
    };
    const next = [...values.fields];
    next.splice(index + 1, 0, copy);
    set('fields', next);
    setOpenField(copy.key);
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = values.fields.findIndex((f) => f.key === active.id);
    const newIndex = values.fields.findIndex((f) => f.key === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    set('fields', arrayMove(values.fields, oldIndex, newIndex));
  }

  /*
   * Shown while the administrator is still choosing, not only after a rejected
   * save. The same function decides both, so the screen cannot warn about one
   * thing and the server refuse another.
   */
  const consentConflict = marketingConflict(values);

  /** What an empty label will render as, so the field shows its own default. */
  const combinedPlaceholder = buildCombinedLabel({
    presentsEnquiry: values.collectsPersonalData && values.lawfulBasis === 'CONSENT',
    presentsTerms: values.collectsPersonalData && values.requireTermsAcceptance,
    presentsMarketing:
      values.collectsPersonalData &&
      values.offerMarketingConsent &&
      !consentConflict &&
      values.lawfulBasis !== 'CONSENT' &&
      !values.requireTermsAcceptance,
  });

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setErrors({});

    const payload = {
      ...values,
      slug: values.slug || slugify(values.name),
      countryId: values.countryId || null,
      defaultProductId: values.defaultProductId || null,
      redirectUrl: values.redirectUrl || null,
      leadSource: values.leadSource || null,
      notifyEmails: values.notifyEmails || null,
      consentText: values.consentText || null,
      lawfulBasis: values.lawfulBasis,
      collectsPersonalData: values.collectsPersonalData,
      offerMarketingConsent: values.offerMarketingConsent,
      requireTermsAcceptance: values.requireTermsAcceptance,
      consentCombinedLabel: values.consentCombinedLabel,
      description: values.description || null,
      fields: values.fields.map(toFieldPayload),
    };

    const result = await saveForm(initial.id ?? null, payload);
    setPending(false);

    if (!result.ok) {
      setErrors(result.fieldErrors ?? {});
      toast(result.error, 'error');
      return;
    }
    toast(result.message ?? 'Saved.');
    if (mode === 'create' && result.data && 'id' in result.data) {
      router.push(`/admin/forms/${(result.data as { id: string }).id}`);
    } else {
      router.refresh();
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4 xl:grid-cols-[13rem_1fr_23rem]">
      {/* Left: what you can add. */}
      {canEdit ? (
        <div className="min-w-0 xl:order-1">
          <Card>
            <CardHeader title="Add a field" />
            <CardBody>
              <FieldPalette onAdd={addField} disabled={pending} />
            </CardBody>
          </Card>
        </div>
      ) : null}

      {/* Centre: the form itself. */}
      <div className="min-w-0 xl:order-2">
        <Card>
          <CardHeader
            title="Form fields"
            description="Drag to reorder. Name, email, phone, company and paragraph fields fill the lead record automatically."
          />
          <CardBody>
            {errors.fields ? (
              <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
                {errors.fields.join(' ')}
              </p>
            ) : null}

            {values.fields.length === 0 ? (
              <div className="rounded-lg border border-dashed border-hairline px-4 py-10 text-center">
                <p className="text-sm font-medium text-content">This form has no fields yet</p>
                <p className="mt-1 text-sm text-muted">
                  Add an email field so you can reply to whoever fills it in.
                </p>
              </div>
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={onDragEnd}
              >
                <SortableContext
                  items={values.fields.map((f) => f.key)}
                  strategy={verticalListSortingStrategy}
                >
                  <ul className="space-y-2">
                    {values.fields.map((field) => (
                      <SortableFieldRow
                        key={field.key}
                        field={field}
                        canEdit={canEdit}
                        expanded={openField === field.key}
                        onToggle={() => setOpenField(openField === field.key ? null : field.key)}
                        onChange={(patch) => updateField(field.key, patch)}
                        onDuplicate={() => duplicateField(field.key)}
                        onRemove={() =>
                          set(
                            'fields',
                            values.fields.filter((f) => f.key !== field.key),
                          )
                        }
                      />
                    ))}
                  </ul>
                </SortableContext>
              </DndContext>
            )}

            {/* On narrow screens the palette collapses into the field list. */}
            {canEdit ? (
              <div className="mt-4 xl:hidden">
                <label htmlFor="add-field-type" className="sr-only">
                  Field type to add
                </label>
                <Select
                  id="add-field-type"
                  value=""
                  onChange={(event) => {
                    if (event.target.value) addField(event.target.value);
                  }}
                >
                  <option value="">Add a field…</option>
                  {formFieldTypes.map((type) => (
                    <option key={type} value={type}>
                      {TYPE_LABELS[type] ?? type}
                    </option>
                  ))}
                </Select>
              </div>
            ) : null}
          </CardBody>
        </Card>
      </div>

      {/* Right: settings, grouped so the panel is never one long scroll. */}
      <div className="min-w-0 space-y-4 xl:order-3">
        <Card>
          <AdminTabs
            tabs={[
              { id: 'general', label: 'General' },
              { id: 'design', label: 'Design' },
              { id: 'after', label: 'After submit' },
              { id: 'notify', label: 'Notifications' },
            ]}
            active={settingsTab}
            onChange={setSettingsTab}
            className="px-2"
          />
          <CardBody className="space-y-4">
            <TabPanel id="general" active={settingsTab} className="space-y-4">
              <Field label="Form name" htmlFor="form-name" required error={errors.name}>
                <Input
                  id="form-name"
                  value={values.name}
                  required
                  onChange={(e) => {
                    set('name', e.target.value);
                    if (!slugTouched) set('slug', slugify(e.target.value));
                  }}
                />
              </Field>

              <Field
                label="Slug"
                htmlFor="form-slug"
                error={errors.slug}
                hint="Used to reference this form from CMS blocks and product buttons."
              >
                <Input
                  id="form-slug"
                  value={values.slug}
                  onChange={(e) => {
                    setSlugTouched(true);
                    set('slug', e.target.value);
                  }}
                  onBlur={(e) => set('slug', slugify(e.target.value))}
                />
              </Field>

              <Field label="Internal description" htmlFor="form-description">
                <Textarea
                  id="form-description"
                  rows={2}
                  value={values.description}
                  onChange={(e) => set('description', e.target.value)}
                />
              </Field>

              <Field label="Submit button label" htmlFor="form-submit">
                <Input
                  id="form-submit"
                  value={values.submitLabel}
                  onChange={(e) => set('submitLabel', e.target.value)}
                />
              </Field>

              <div className="space-y-4 rounded-lg border border-hairline p-4">
                <div>
                  <p className="text-sm font-medium text-content">Consent</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted">
                    This form shows <strong className="font-medium text-content">one</strong> tick
                    box. The wording it covers is managed once, under Leads &amp; CRM → Consent
                    notice; these settings decide which parts of it this form asks for.
                  </p>
                </div>

                <Switch
                  checked={values.collectsPersonalData}
                  onChange={(next) => set('collectsPersonalData', next)}
                  label="This form collects personal information"
                  hint="Off hides the consent block entirely. Only correct for a form that asks for nothing about a person — no name, email, phone or message."
                />

                {values.collectsPersonalData ? (
                  <>
                    <Field
                      label="Lawful basis"
                      htmlFor="form-basis"
                      hint="Consent makes the tick box mandatory. On any other basis the box would be theatre, and the CRM shows “Not applicable” instead of an apparent gap."
                    >
                      <Select
                        id="form-basis"
                        value={values.lawfulBasis}
                        onChange={(e) =>
                          set('lawfulBasis', e.target.value as typeof values.lawfulBasis)
                        }
                      >
                        <option value="CONSENT">Consent</option>
                        <option value="CONTRACT">Performance of a contract</option>
                        <option value="LEGITIMATE_INTEREST">Legitimate interest</option>
                        <option value="LEGAL_OBLIGATION">Legal obligation</option>
                      </Select>
                    </Field>

                    <Switch
                      checked={values.offerMarketingConsent}
                      onChange={(next) => set('offerMarketingConsent', next)}
                      label="Offer marketing consent in the tick box"
                      hint="Adds the marketing sentence to the box. Only possible when the box is optional, and only when the notice actually has marketing wording — clearing that wording turns this off everywhere."
                    />

                    {consentConflict ? (
                      <Alert tone="warning" title="Marketing cannot be offered on this form">
                        {consentConflict}
                      </Alert>
                    ) : null}

                    <Switch
                      checked={values.requireTermsAcceptance}
                      onChange={(next) => set('requireTermsAcceptance', next)}
                      label="Require Terms & Conditions acceptance"
                      hint="Adds the Terms sentence and link to the box, and makes the box required. Recorded separately from data-processing consent."
                    />

                    <Field
                      label="Tick box wording"
                      htmlFor="form-consent-label"
                      hint="The sentence beside the box. Leave empty to compose one from the purposes it covers. It is not a claim of GDPR or DPDP compliance — see docs/CONSENT-AND-PRIVACY.md."
                      error={errors.consentCombinedLabel?.[0]}
                    >
                      <Textarea
                        id="form-consent-label"
                        rows={2}
                        value={values.consentCombinedLabel}
                        placeholder={combinedPlaceholder}
                        onChange={(e) => set('consentCombinedLabel', e.target.value)}
                      />
                    </Field>
                  </>
                ) : null}

                <Field
                  label="Extra line above the button"
                  htmlFor="form-consent"
                  hint="Optional free text, kept from before the consent block existed."
                >
                  <Textarea
                    id="form-consent"
                    rows={2}
                    value={values.consentText}
                    onChange={(e) => set('consentText', e.target.value)}
                  />
                </Field>
              </div>

              <div className="rounded-lg border border-hairline p-4">
                <Switch
                  checked={values.isActive}
                  onChange={(next) => set('isActive', next)}
                  label="Form is active"
                  hint="Inactive forms stop accepting submissions everywhere they appear."
                />
              </div>

              <div className="rounded-lg border border-hairline p-4">
                <p className="mb-3 text-sm font-medium text-content">Spam protection</p>
                <Switch
                  checked={values.requireCaptcha}
                  onChange={(next) => set('requireCaptcha', next)}
                  label="Enable Math CAPTCHA"
                  hint="Adds a simple verification question to help reduce automated spam."
                />
                <p className="mt-3 text-xs text-muted">
                  Every form is already protected by a hidden trap field, a minimum fill time and a
                  per-visitor submission limit. Turn this on for forms that attract bots anyway.
                </p>
              </div>
            </TabPanel>

            <TabPanel id="after" active={settingsTab} className="space-y-4">
              <Field
                label="Success message"
                htmlFor="form-success"
                hint="Shown in place of the form after a successful submission."
              >
                <Textarea
                  id="form-success"
                  rows={3}
                  value={values.successMessage}
                  onChange={(e) => set('successMessage', e.target.value)}
                />
              </Field>

              <Field
                label="Redirect after submit"
                htmlFor="form-redirect"
                hint="Optional. Sends the visitor to this page instead of showing the success message."
              >
                <Input
                  id="form-redirect"
                  value={values.redirectUrl}
                  placeholder="/thank-you"
                  onChange={(e) => set('redirectUrl', e.target.value)}
                />
              </Field>
            </TabPanel>

            <TabPanel id="notify" active={settingsTab} className="space-y-4">
              <div className="rounded-lg border border-hairline p-4">
                <Switch
                  checked={values.createsLead}
                  onChange={(next) => set('createsLead', next)}
                  label="Create a CRM lead"
                  hint="Turn off for newsletter-style forms that only record a submission."
                />
              </div>

              <Field
                label="Lead source"
                htmlFor="form-source"
                hint="Recorded on every lead from this form."
              >
                <Input
                  id="form-source"
                  value={values.leadSource}
                  onChange={(e) => set('leadSource', e.target.value)}
                />
              </Field>

              {countries.length > 0 ? (
                <Field
                  label="Country"
                  htmlFor="form-country"
                  hint="Shared forms can be placed on any storefront. Choose a country to restrict this form to one market."
                >
                  <Select
                    id="form-country"
                    value={values.countryId}
                    onChange={(e) => set('countryId', e.target.value)}
                  >
                    <option value="">All countries (shared)</option>
                    {countries.map((country) => (
                      <option key={country.id} value={country.id}>
                        {country.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : null}

              <Field
                label="Default product"
                htmlFor="form-product"
                hint="Used when the visitor did not arrive from a specific product."
              >
                <Select
                  id="form-product"
                  value={values.defaultProductId}
                  onChange={(e) => set('defaultProductId', e.target.value)}
                >
                  <option value="">None</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field
                label="Notify these addresses"
                htmlFor="form-notify"
                hint="Comma separated. Added to the sales addresses in Email settings."
              >
                <Input
                  id="form-notify"
                  value={values.notifyEmails}
                  placeholder="sales@example.com, ops@example.com"
                  onChange={(e) => set('notifyEmails', e.target.value)}
                />
              </Field>
            </TabPanel>

            {/*
             * Design applies to this form everywhere it appears — in a popup, a
             * hero, a product enquiry dialog or a page block. There is one
             * renderer and one design record, so there is nothing to configure
             * per location.
             */}
            <TabPanel id="design" active={settingsTab}>
              <FormDesignPanel
                design={values.design}
                onChange={(design) => set('design', design)}
                disabled={!canEdit}
              />
            </TabPanel>
          </CardBody>

          {canEdit ? (
            <div className="flex justify-end gap-2 border-t border-hairline bg-muted/[0.03] px-4 py-3 sm:px-5">
              <Link
                href="/admin/forms"
                className="rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:text-content"
              >
                Cancel
              </Link>
              <Button type="submit" disabled={pending}>
                {pending ? (
                  <>
                    <Spinner className="h-4 w-4 animate-spin" aria-hidden="true" />
                    Saving…
                  </>
                ) : mode === 'create' ? (
                  'Create form'
                ) : (
                  'Save form'
                )}
              </Button>
            </div>
          ) : null}
        </Card>
      </div>
    </form>
  );
}

function SortableFieldRow({
  field,
  canEdit,
  expanded,
  onToggle,
  onChange,
  onDuplicate,
  onRemove,
}: {
  field: BuilderField;
  canEdit: boolean;
  expanded: boolean;
  onToggle: () => void;
  onChange: (patch: Partial<BuilderField>) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: field.key,
    disabled: !canEdit,
  });

  const hasOptions = CHOICE_FIELD_TYPES.has(field.type);

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'rounded-lg border bg-surface',
        isDragging ? 'border-brand shadow-lg' : 'border-hairline',
      )}
    >
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label={`Reorder ${field.label}`}
          disabled={!canEdit}
          className="cursor-grab rounded p-1 text-muted hover:bg-muted/10 active:cursor-grabbing disabled:opacity-40"
        >
          <GripVertical className="h-4 w-4" aria-hidden="true" />
        </button>

        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="min-w-0 flex-1 text-left"
        >
          <span className="block truncate text-sm font-medium text-content">
            {field.label || 'Untitled field'}
          </span>
          <span className="block truncate font-mono text-xs text-muted">{field.name}</span>
        </button>

        {/* On a phone the row keeps only what matters for scanning; the type
            and mapping are shown again when the field is expanded. */}
        <span className="hidden shrink-0 items-center gap-1.5 sm:flex">
          <Badge tone="neutral">{TYPE_LABELS[field.type] ?? field.type}</Badge>
          {MAPPED_FIELD_TYPES.has(field.type) ? <Badge tone="brand">Mapped</Badge> : null}
        </span>
        {field.isRequired ? <Badge tone="warning">Required</Badge> : null}

        {canEdit ? (
          <>
            <button
              type="button"
              onClick={onDuplicate}
              aria-label={`Duplicate ${field.label}`}
              title="Duplicate field"
              className="rounded p-1.5 text-muted transition-colors hover:bg-muted/10 hover:text-content"
            >
              <Copy className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onRemove}
              aria-label={`Remove ${field.label}`}
              title="Remove field"
              className="rounded p-1.5 text-muted transition-colors hover:bg-red-50 hover:text-red-600"
            >
              <Trash className="h-4 w-4" />
            </button>
          </>
        ) : null}

        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 text-muted transition-transform',
            expanded && 'rotate-180',
          )}
          aria-hidden="true"
        />
      </div>

      {expanded ? (
        <fieldset disabled={!canEdit} className="space-y-4 border-t border-hairline p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Label" htmlFor={`${field.key}-label`}>
              <Input
                id={`${field.key}-label`}
                value={field.label}
                onChange={(e) => onChange({ label: e.target.value })}
              />
            </Field>
            <Field
              label="Machine name"
              htmlFor={`${field.key}-name`}
              hint="Key used in submissions and exports."
            >
              <Input
                id={`${field.key}-name`}
                value={field.name}
                onChange={(e) => onChange({ name: e.target.value })}
                onBlur={(e) =>
                  onChange({
                    name: e.target.value.toLowerCase().replace(/[^a-z0-9_]+/g, '_'),
                  })
                }
              />
            </Field>
            <Field label="Type" htmlFor={`${field.key}-type`}>
              <Select
                id={`${field.key}-type`}
                value={field.type}
                onChange={(e) => {
                  const type = e.target.value;
                  onChange({
                    type,
                    options: CHOICE_FIELD_TYPES.has(type)
                      ? field.options.length
                        ? field.options
                        : [{ label: 'Option one', value: 'option-one' }]
                      : [],
                  });
                }}
              >
                {formFieldTypes.map((type) => (
                  <option key={type} value={type}>
                    {TYPE_LABELS[type] ?? type}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Width" htmlFor={`${field.key}-width`}>
              <Select
                id={`${field.key}-width`}
                value={field.width}
                onChange={(e) => onChange({ width: e.target.value as 'full' | 'half' })}
              >
                <option value="full">Full width</option>
                <option value="half">Half width</option>
              </Select>
            </Field>
            <Field
              label="Column span"
              htmlFor={`${field.key}-span`}
              hint="Overrides Width. Never wider than the form's column count."
            >
              <Select
                id={`${field.key}-span`}
                value={field.colSpan}
                onChange={(e) => onChange({ colSpan: e.target.value })}
              >
                <option value="">Use the width setting</option>
                <option value="1">1 column</option>
                <option value="2">2 columns</option>
                <option value="3">3 columns</option>
                <option value="4">Full row</option>
              </Select>
            </Field>
            {NO_PLACEHOLDER_TYPES.has(field.type) ? null : (
              <Field
                label="Placeholder"
                htmlFor={`${field.key}-placeholder`}
                hint="Shown inside the empty field."
              >
                <Input
                  id={`${field.key}-placeholder`}
                  value={field.placeholder}
                  onChange={(e) => onChange({ placeholder: e.target.value })}
                />
              </Field>
            )}
            <Field label="Help text" htmlFor={`${field.key}-help`}>
              <Input
                id={`${field.key}-help`}
                value={field.helpText}
                onChange={(e) => onChange({ helpText: e.target.value })}
              />
            </Field>
            {field.type === 'HIDDEN' || field.type === 'CONSENT' ? (
              <Field
                label={field.type === 'HIDDEN' ? 'Value' : 'Default value'}
                htmlFor={`${field.key}-default`}
                className="sm:col-span-2"
                hint={
                  field.type === 'CONSENT'
                    ? 'Enter “checked” to tick the box by default.'
                    : 'Sent with every submission and never shown to the visitor.'
                }
              >
                <Input
                  id={`${field.key}-default`}
                  value={field.defaultValue}
                  onChange={(e) => onChange({ defaultValue: e.target.value })}
                />
              </Field>
            ) : null}
          </div>

          {hasOptions ? (
            <OptionsEditor
              options={field.options}
              onChange={(options) => onChange({ options })}
              idPrefix={field.key}
            />
          ) : null}

          <details className="rounded-lg border border-hairline p-3">
            <summary className="cursor-pointer text-sm font-medium text-content">
              Validation
            </summary>
            <div className="mt-3 grid gap-4 sm:grid-cols-3">
              {NUMERIC_FIELD_TYPES.has(field.type) ? (
                <>
                  <Field label="Minimum value" htmlFor={`${field.key}-numin`}>
                    <Input
                      id={`${field.key}-numin`}
                      type="number"
                      value={field.settings.min ?? ''}
                      onChange={(e) =>
                        onChange({
                          settings: {
                            ...field.settings,
                            min: e.target.value === '' ? null : Number(e.target.value),
                          },
                        })
                      }
                    />
                  </Field>
                  <Field label="Maximum value" htmlFor={`${field.key}-numax`}>
                    <Input
                      id={`${field.key}-numax`}
                      type="number"
                      value={field.settings.max ?? ''}
                      onChange={(e) =>
                        onChange({
                          settings: {
                            ...field.settings,
                            max: e.target.value === '' ? null : Number(e.target.value),
                          },
                        })
                      }
                    />
                  </Field>
                </>
              ) : null}
              {field.type === 'TEXTAREA' ? (
                <Field label="Rows" htmlFor={`${field.key}-rows`} hint="Visible height.">
                  <Input
                    id={`${field.key}-rows`}
                    type="number"
                    min={2}
                    max={20}
                    value={field.settings.rows ?? ''}
                    onChange={(e) =>
                      onChange({
                        settings: {
                          ...field.settings,
                          rows: e.target.value === '' ? null : Number(e.target.value),
                        },
                      })
                    }
                  />
                </Field>
              ) : null}
              <Field label="Minimum length" htmlFor={`${field.key}-min`}>
                <Input
                  id={`${field.key}-min`}
                  type="number"
                  min={0}
                  value={field.minLength}
                  onChange={(e) => onChange({ minLength: e.target.value })}
                />
              </Field>
              <Field label="Maximum length" htmlFor={`${field.key}-max`}>
                <Input
                  id={`${field.key}-max`}
                  type="number"
                  min={1}
                  value={field.maxLength}
                  onChange={(e) => onChange({ maxLength: e.target.value })}
                />
              </Field>
              <Field
                label="Pattern"
                htmlFor={`${field.key}-pattern`}
                hint="Regular expression. Leave blank for none."
              >
                <Input
                  id={`${field.key}-pattern`}
                  value={field.pattern}
                  onChange={(e) => onChange({ pattern: e.target.value })}
                />
              </Field>
              <Field
                label="Required message"
                htmlFor={`${field.key}-msg-req`}
                hint="Overrides the form default."
              >
                <Input
                  id={`${field.key}-msg-req`}
                  value={field.settings.requiredMessage}
                  maxLength={160}
                  onChange={(e) =>
                    onChange({
                      settings: { ...field.settings, requiredMessage: e.target.value },
                    })
                  }
                />
              </Field>
              <Field label="Invalid message" htmlFor={`${field.key}-msg-inv`}>
                <Input
                  id={`${field.key}-msg-inv`}
                  value={field.settings.invalidMessage}
                  maxLength={160}
                  onChange={(e) =>
                    onChange({
                      settings: { ...field.settings, invalidMessage: e.target.value },
                    })
                  }
                />
              </Field>
            </div>
            <p className="mt-3 text-xs text-muted">
              Every rule here is re-checked on the server, so a visitor cannot skip one by editing
              the page.
            </p>
          </details>

          <FieldStateControls field={field} onChange={onChange} />
          <FieldAppearanceControls field={field} onChange={onChange} />
        </fieldset>
      ) : null}
    </li>
  );
}

function OptionsEditor({
  options,
  onChange,
  idPrefix,
}: {
  options: Array<{ label: string; value: string }>;
  onChange: (next: Array<{ label: string; value: string }>) => void;
  idPrefix: string;
}) {
  return (
    <fieldset className="rounded-lg border border-hairline p-3">
      <legend className="px-1 text-sm font-medium text-content">Options</legend>
      <ul className="space-y-2">
        {options.map((option, index) => (
          <li key={index} className="flex items-center gap-2">
            <Input
              value={option.label}
              aria-label={`Option ${index + 1} label`}
              placeholder="Label shown to the visitor"
              onChange={(e) =>
                onChange(
                  options.map((o, i) =>
                    i === index
                      ? {
                          label: e.target.value,
                          value: o.value || slugify(e.target.value),
                        }
                      : o,
                  ),
                )
              }
            />
            <Input
              value={option.value}
              aria-label={`Option ${index + 1} stored value`}
              placeholder="stored-value"
              onChange={(e) =>
                onChange(options.map((o, i) => (i === index ? { ...o, value: e.target.value } : o)))
              }
            />
            <button
              type="button"
              onClick={() => onChange(options.filter((_, i) => i !== index))}
              aria-label={`Remove option ${index + 1}`}
              className="shrink-0 rounded p-2 text-muted transition-colors hover:bg-red-50 hover:text-red-600"
            >
              <Trash className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>
      <Button
        variant="outline"
        size="sm"
        className="mt-3"
        onClick={() => onChange([...options, { label: '', value: '' }])}
        id={`${idPrefix}-add-option`}
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        Add option
      </Button>
    </fieldset>
  );
}

/**
 * Required, enabled, visible, read-only.
 *
 * Four independent switches rather than one "status" dropdown, because they
 * genuinely compose: a field can be visible but read-only, or enabled but
 * hidden and carrying a default. The hints spell out what the server does with
 * each, since that is not guessable from the label.
 */
function FieldStateControls({
  field,
  onChange,
}: {
  field: BuilderField;
  onChange: (patch: Partial<BuilderField>) => void;
}) {
  const structural = STRUCTURAL_FIELD_TYPES.has(field.type);

  return (
    <div className="space-y-3 rounded-lg border border-hairline p-3">
      <p className="text-sm font-medium text-content">Behaviour</p>

      {structural ? (
        <p className="text-xs text-muted">
          A hidden value is never shown, so it has no label, placeholder or required state to
          configure. Its value is sent with every submission.
        </p>
      ) : (
        <Switch
          checked={field.isRequired}
          onChange={(next) => onChange({ isRequired: next })}
          label="Required"
          hint="Enforced on the server, not just in the browser."
        />
      )}

      <Switch
        checked={field.isEnabled}
        onChange={(next) => onChange({ isEnabled: next })}
        label="Enabled"
        hint="Turning this off removes the field from the form entirely. Submissions already collected keep their values."
      />

      {structural ? null : (
        <>
          <Switch
            checked={field.isHidden}
            onChange={(next) => onChange({ isHidden: next })}
            label="Hidden"
            hint="Keeps the field in the form but draws nothing. Its default value is submitted, taken from here and not from the browser."
          />
          <Switch
            checked={field.isReadOnly}
            onChange={(next) => onChange({ isReadOnly: next })}
            label="Read-only"
            hint="Shown but not editable. The submitted value always comes from the default below."
          />
          <Switch
            checked={field.settings.system}
            onChange={(next) => onChange({ settings: { ...field.settings, system: next } })}
            label="System field"
            hint="For injected context such as a product ID or plan. The value is never taken from the browser, so it cannot be tampered with."
          />
        </>
      )}

      {field.isReadOnly || field.isHidden || field.settings.system || structural ? (
        <Field
          label="Value"
          htmlFor={`${field.key}-sysdefault`}
          hint="The value the server records for this field."
        >
          <Input
            id={`${field.key}-sysdefault`}
            value={field.defaultValue}
            onChange={(e) => onChange({ defaultValue: e.target.value })}
          />
        </Field>
      ) : null}
    </div>
  );
}

/**
 * Label visibility, position, extra classes and conditional display.
 *
 * Turning a label off changes only what is drawn: the renderer moves the
 * accessible name to `aria-label`, so the field keeps working for anyone using
 * a screen reader. The hint says so, because an admin switching it off has no
 * other way to know.
 */
function FieldAppearanceControls({
  field,
  onChange,
}: {
  field: BuilderField;
  onChange: (patch: Partial<BuilderField>) => void;
}) {
  const structural = STRUCTURAL_FIELD_TYPES.has(field.type);
  if (structural) return null;

  const settings = field.settings;

  function setSettings(patch: Partial<typeof settings>) {
    onChange({ settings: { ...settings, ...patch } });
  }

  return (
    <details className="rounded-lg border border-hairline p-3">
      <summary className="cursor-pointer text-sm font-medium text-content">
        Appearance &amp; conditions
      </summary>

      <div className="mt-3 space-y-4">
        <Switch
          checked={field.showLabel}
          onChange={(next) => onChange({ showLabel: next })}
          label="Show the label"
          hint="When off, the label is still read out by screen readers — only the visible text is removed."
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Label position" htmlFor={`${field.key}-labelpos`}>
            <Select
              id={`${field.key}-labelpos`}
              value={settings.labelPosition}
              onChange={(e) =>
                setSettings({ labelPosition: e.target.value as typeof settings.labelPosition })
              }
            >
              <option value="inherit">Same as the form</option>
              <option value="top">Above the field</option>
              <option value="left">Beside the field</option>
              <option value="floating">Floating</option>
            </Select>
          </Field>

          {CHOICE_FIELD_TYPES.has(field.type) ? (
            <Field label="Option layout" htmlFor={`${field.key}-choicelayout`}>
              <Select
                id={`${field.key}-choicelayout`}
                value={settings.choiceLayout}
                onChange={(e) =>
                  setSettings({ choiceLayout: e.target.value as typeof settings.choiceLayout })
                }
              >
                <option value="inherit">Same as the form</option>
                <option value="vertical">Stacked</option>
                <option value="horizontal">Side by side</option>
                <option value="grid">Grid</option>
              </Select>
            </Field>
          ) : null}

          {field.type === 'SELECT' ? (
            <Field
              label="Empty option text"
              htmlFor={`${field.key}-emptyopt`}
              hint="The first, unselected entry."
            >
              <Input
                id={`${field.key}-emptyopt`}
                value={settings.emptyOptionLabel}
                placeholder="Please choose…"
                maxLength={120}
                onChange={(e) => setSettings({ emptyOptionLabel: e.target.value })}
              />
            </Field>
          ) : null}

          <Field
            label="CSS classes"
            htmlFor={`${field.key}-cssclass`}
            hint="Added to the field wrapper. Letters, numbers and dashes only."
          >
            <Input
              id={`${field.key}-cssclass`}
              value={field.cssClass}
              placeholder="my-field"
              maxLength={200}
              onChange={(e) => onChange({ cssClass: e.target.value })}
            />
          </Field>
        </div>

        <ConditionsEditor field={field} onChange={onChange} />
      </div>
    </details>
  );
}

/**
 * Conditional visibility.
 *
 * A flat list of tests joined by one operator, not a nested rules engine — that
 * covers "show Company Size when Product Interest is Dropbox Business" without
 * building a tree nobody can debug from an admin screen. The conditions are
 * re-evaluated on the server, so a field the visitor never saw is not required
 * of them and a value for one is not trusted.
 */
function ConditionsEditor({
  field,
  onChange,
}: {
  field: BuilderField;
  onChange: (patch: Partial<BuilderField>) => void;
}) {
  const { conditions, conditionMatch } = field.settings;

  function setConditions(next: typeof conditions) {
    onChange({ settings: { ...field.settings, conditions: next } });
  }

  return (
    <fieldset className="rounded-lg border border-hairline p-3">
      <legend className="px-1 text-sm font-medium text-content">Show this field only when…</legend>

      {conditions.length === 0 ? (
        <p className="text-xs text-muted">
          Always shown. Add a condition to hide it until another field has a particular answer.
        </p>
      ) : (
        <>
          <Field label="Match" htmlFor={`${field.key}-match`} className="mb-3">
            <Select
              id={`${field.key}-match`}
              value={conditionMatch}
              onChange={(e) =>
                onChange({
                  settings: {
                    ...field.settings,
                    conditionMatch: e.target.value as 'all' | 'any',
                  },
                })
              }
            >
              <option value="all">All of these are true</option>
              <option value="any">Any of these is true</option>
            </Select>
          </Field>

          <ul className="space-y-2">
            {conditions.map((condition, index) => (
              <li key={index} className="grid gap-2 sm:grid-cols-[1fr_auto_1fr_auto]">
                <Input
                  value={condition.field}
                  aria-label={`Condition ${index + 1} field name`}
                  placeholder="field_name"
                  maxLength={60}
                  onChange={(e) =>
                    setConditions(
                      conditions.map((c, i) =>
                        i === index ? { ...c, field: e.target.value } : c,
                      ),
                    )
                  }
                />
                <Select
                  value={condition.operator}
                  aria-label={`Condition ${index + 1} test`}
                  className="sm:w-36"
                  onChange={(e) =>
                    setConditions(
                      conditions.map((c, i) =>
                        i === index
                          ? { ...c, operator: e.target.value as typeof c.operator }
                          : c,
                      ),
                    )
                  }
                >
                  {Object.entries(CONDITION_OPERATOR_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
                {VALUELESS_OPERATORS.has(condition.operator) ? (
                  <span className="self-center text-xs text-muted">No value needed</span>
                ) : (
                  <Input
                    value={condition.value}
                    aria-label={`Condition ${index + 1} value`}
                    placeholder="Expected answer"
                    maxLength={200}
                    onChange={(e) =>
                      setConditions(
                        conditions.map((c, i) =>
                          i === index ? { ...c, value: e.target.value } : c,
                        ),
                      )
                    }
                  />
                )}
                <button
                  type="button"
                  onClick={() => setConditions(conditions.filter((_, i) => i !== index))}
                  aria-label={`Remove condition ${index + 1}`}
                  className="shrink-0 self-center rounded p-2 text-muted transition-colors hover:bg-red-50 hover:text-red-600"
                >
                  <Trash className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {conditions.length < 5 ? (
        <button
          type="button"
          onClick={() =>
            setConditions([...conditions, { field: '', operator: 'equals', value: '' }])
          }
          className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add condition
        </button>
      ) : null}
    </fieldset>
  );
}

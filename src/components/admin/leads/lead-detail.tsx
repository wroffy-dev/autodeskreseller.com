'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Trash, UserCheck, MessageSquarePlus, ArrowRight } from 'lucide-react';
import type { LeadStatus } from '@prisma/client';
import {
  changeLeadStatus,
  addLeadNote,
  updateLead,
  deleteLead,
  convertLeadToCustomer,
} from '@/lib/actions/leads';
import { LeadStatusBadge } from '@/components/admin/lead-status-badge';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { Spinner } from '@/components/ui/icons';
import { PIPELINE_STAGES, LEAD_STATUS_LABELS, LEAD_STATUS_OPTIONS } from '@/lib/crm/constants';
import { formatDate, formatRelative, initials } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';

export type LeadDetailData = {
  id: string;
  reference: number;
  name: string;
  email: string;
  phone: string | null;
  company: string | null;
  jobTitle: string | null;
  message: string | null;
  status: LeadStatus;
  priority: string;
  source: string | null;
  campaign: string | null;
  ctaLabel: string | null;
  ctaLocation: string | null;
  value: string | null;
  followUpAt: string | null;
  lostReason: string | null;
  createdAt: string;
  productId: string | null;
  productName: string | null;
  assignedToId: string | null;
  customerId: string | null;
  formName: string | null;
  blogPostTitle: string | null;
  blogPostUrl: string | null;
  landingUrl: string | null;
  referrer: string | null;
  utm: {
    source: string | null;
    medium: string | null;
    campaign: string | null;
    term: string | null;
    content: string | null;
  };
  firstTouch: {
    source: string | null;
    medium: string | null;
    campaign: string | null;
    landingUrl: string | null;
    at: string | null;
  };
  notes: Array<{ id: string; body: string; authorName: string | null; createdAt: string }>;
  activities: Array<{ id: string; type: string; summary: string; actorName: string | null; createdAt: string }>;
};

export type SubmissionView = {
  formName: string | null;
  pageUrl: string | null;
  countryName: string;
  submittedAt: string;
  fields: Array<{ name: string; label: string; value: string }>;
};

export function LeadDetail({
  lead,
  staff,
  products,
  can,
  submission,
  consent,
  crm,
}: {
  lead: LeadDetailData;
  staff: Array<{ id: string; name: string }>;
  products: Array<{ id: string; name: string }>;
  can: { edit: boolean; assign: boolean; delete: boolean; createCustomer: boolean };
  /** Every configured field as it was submitted, custom ones included. */
  submission?: SubmissionView | null;
  /** Rendered by the page so the IP never reaches a viewer without the right. */
  consent?: React.ReactNode;
  /** The lead's place in the Deskzo CRM, rendered by the page. */
  crm?: React.ReactNode;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState('');
  const [lostReason, setLostReason] = React.useState(lead.lostReason ?? '');
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [askReason, setAskReason] = React.useState(false);

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

  async function moveTo(status: LeadStatus) {
    if (status === 'LOST' && !lostReason) {
      setAskReason(true);
      return;
    }
    await run(() => changeLeadStatus({ leadId: lead.id, status, lostReason: lostReason || null }));
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
      <div className="min-w-0 space-y-6">
        {can.edit ? (
          <Card>
            <CardHeader title="Pipeline stage" description="Move the lead as the conversation progresses." />
            <CardBody>
              <ol className="flex flex-wrap items-center gap-1.5">
                {PIPELINE_STAGES.map((stage) => {
                  const isCurrent = lead.status === stage;
                  return (
                    <li key={stage}>
                      <button
                        type="button"
                        disabled={busy || isCurrent}
                        onClick={() => moveTo(stage)}
                        aria-current={isCurrent ? 'step' : undefined}
                        className={cn(
                          'rounded-full px-3 py-1.5 text-sm transition-colors disabled:cursor-default',
                          isCurrent
                            ? 'bg-brand font-medium text-white'
                            : 'border border-hairline text-muted hover:border-brand hover:text-brand',
                        )}
                      >
                        {LEAD_STATUS_LABELS[stage]}
                      </button>
                    </li>
                  );
                })}
              </ol>

              {lead.status === 'LOST' && lead.lostReason ? (
                <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
                  <strong>Reason lost:</strong> {lead.lostReason}
                </p>
              ) : null}

              {lead.status === 'WON' && can.createCustomer && !lead.customerId ? (
                <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg bg-emerald-50 px-3 py-2.5">
                  <p className="text-sm text-emerald-900">This lead is won. Create the customer record?</p>
                  <Button
                    size="sm"
                    className="ml-auto"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        const result = await convertLeadToCustomer(lead.id);
                        if (result.ok && result.data) router.push(`/admin/customers/${result.data.id}`);
                        return result;
                      })
                    }
                  >
                    Convert to customer
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              ) : null}

              {lead.customerId ? (
                <p className="mt-4 text-sm text-muted">
                  Linked to{' '}
                  <Link href={`/admin/customers/${lead.customerId}`} className="text-brand hover:underline">
                    the customer record
                  </Link>
                  .
                </p>
              ) : null}
            </CardBody>
          </Card>
        ) : null}

        <LeadEditor lead={lead} staff={staff} products={products} can={can} onSaved={() => router.refresh()} />

        <Card>
          <CardHeader title="Notes" description="Internal only — never shown to the lead." />
          <CardBody>
            {can.edit ? (
              <div className="mb-5">
                <label htmlFor="lead-note" className="sr-only">
                  Add a note
                </label>
                <Textarea
                  id="lead-note"
                  rows={3}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Called and left a voicemail. Following up Thursday."
                />
                <div className="mt-2 flex justify-end">
                  <Button
                    size="sm"
                    disabled={busy || !note.trim()}
                    onClick={async () => {
                      const ok = await run(() => addLeadNote({ leadId: lead.id, body: note }));
                      if (ok) setNote('');
                    }}
                  >
                    <MessageSquarePlus className="h-4 w-4" aria-hidden="true" />
                    Add note
                  </Button>
                </div>
              </div>
            ) : null}

            {lead.notes.length === 0 ? (
              <p className="text-sm text-muted">No notes yet.</p>
            ) : (
              <ul className="space-y-3">
                {lead.notes.map((entry) => (
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

        <Card>
          <CardHeader title="Activity" />
          <CardBody>
            {lead.activities.length === 0 ? (
              <p className="text-sm text-muted">No activity recorded.</p>
            ) : (
              <ol className="space-y-4">
                {lead.activities.map((entry) => (
                  <li key={entry.id} className="flex gap-3">
                    <span
                      className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted/10 text-[0.625rem] font-semibold text-muted"
                      aria-hidden="true"
                    >
                      {entry.actorName ? initials(entry.actorName) : '·'}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm text-content">{entry.summary}</span>
                      <span className="block text-xs text-muted">
                        {entry.actorName ? `${entry.actorName} · ` : ''}
                        {formatDate(entry.createdAt, true)}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="min-w-0 space-y-6">
        <Card>
          <CardHeader title="Summary" />
          <CardBody className="space-y-3 text-sm">
            <Row label="Reference" value={`#${lead.reference}`} />
            <Row label="Status" value={<LeadStatusBadge status={lead.status} />} />
            <Row label="Received" value={`${formatDate(lead.createdAt, true)} (${formatRelative(lead.createdAt)})`} />
            <Row label="Source" value={lead.source ?? '—'} />
            <Row label="Form" value={lead.formName ?? '—'} />
            <Row label="Product" value={lead.productName ?? '—'} />
            {lead.blogPostTitle ? (
              <Row
                label="Article"
                value={
                  lead.blogPostUrl ? (
                    <Link
                      href={lead.blogPostUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-brand hover:underline"
                    >
                      {lead.blogPostTitle}
                    </Link>
                  ) : (
                    lead.blogPostTitle
                  )
                }
              />
            ) : null}
            <Row label="Button" value={lead.ctaLabel ?? '—'} />
            <Row label="Placement" value={lead.ctaLocation ?? '—'} />
            <Row label="Landing page" value={lead.landingUrl ?? '—'} />
            <Row label="Referrer" value={lead.referrer ?? '—'} />
          </CardBody>
        </Card>

        {crm}

        <Card>
          <CardHeader title="Attribution" description="Last touch, then first touch." />
          <CardBody className="space-y-3 text-sm">
            <Row label="utm_source" value={lead.utm.source ?? '—'} />
            <Row label="utm_medium" value={lead.utm.medium ?? '—'} />
            <Row label="utm_campaign" value={lead.utm.campaign ?? '—'} />
            <Row label="utm_term" value={lead.utm.term ?? '—'} />
            <Row label="utm_content" value={lead.utm.content ?? '—'} />
            <hr className="border-hairline" />
            <Row label="First source" value={lead.firstTouch.source ?? '—'} />
            <Row label="First campaign" value={lead.firstTouch.campaign ?? '—'} />
            <Row label="First landing" value={lead.firstTouch.landingUrl ?? '—'} />
            <Row
              label="First seen"
              value={lead.firstTouch.at ? formatDate(lead.firstTouch.at, true) : '—'}
            />
          </CardBody>
        </Card>

        {lead.message ? (
          <Card>
            <CardHeader title="Message" />
            <CardBody>
              <p className="whitespace-pre-wrap text-sm text-muted">{lead.message}</p>
            </CardBody>
          </Card>
        ) : null}

        {submission ? (
          <Card>
            <CardHeader
              title="Submitted form"
              description="Every field as it was filled in, with the labels it carried then."
            />
            <CardBody className="space-y-3 text-sm">
              <dl className="space-y-2">
                <SubmissionRow label="Form" value={submission.formName ?? '—'} />
                <SubmissionRow label="Country" value={submission.countryName} />
                <SubmissionRow label="Page" value={submission.pageUrl ?? '—'} />
                <SubmissionRow
                  label="Submitted"
                  value={`${new Date(submission.submittedAt).toLocaleString('en-GB', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                    timeZone: 'UTC',
                  })} UTC`}
                />
              </dl>
              {submission.fields.length > 0 ? (
                <dl className="space-y-2 border-t border-hairline pt-3">
                  {submission.fields.map((field) => (
                    <SubmissionRow key={field.name} label={field.label} value={field.value || '—'} />
                  ))}
                </dl>
              ) : null}
            </CardBody>
          </Card>
        ) : null}

        {consent}

        {can.delete ? (
          <Button variant="outline" className="w-full" onClick={() => setConfirmDelete(true)} disabled={busy}>
            <Trash className="h-4 w-4" aria-hidden="true" />
            Delete lead
          </Button>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={async () => {
          const ok = await run(() => deleteLead(lead.id));
          setConfirmDelete(false);
          if (ok) router.push('/admin/leads');
        }}
        title="Delete this lead?"
        message="It is hidden from the CRM, reports and exports."
        pending={busy}
      />

      <ConfirmDialog
        open={askReason}
        onClose={() => setAskReason(false)}
        onConfirm={async () => {
          setAskReason(false);
          await run(() =>
            changeLeadStatus({ leadId: lead.id, status: 'LOST', lostReason: lostReason || 'Not specified' }),
          );
        }}
        title="Mark this lead as lost"
        message="Recording why helps the reporting later."
        confirmLabel="Mark as lost"
        tone="primary"
        pending={busy}
      />
      {askReason ? (
        <div className="fixed inset-x-4 bottom-24 z-toast mx-auto max-w-sm">
          <label htmlFor="lost-reason" className="sr-only">
            Reason lost
          </label>
          <Input
            id="lost-reason"
            autoFocus
            value={lostReason}
            onChange={(e) => setLostReason(e.target.value)}
            placeholder="Went with a competitor on price"
          />
        </div>
      ) : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="shrink-0 text-muted">{label}</span>
      <span className="min-w-0 break-words text-right text-content">{value}</span>
    </div>
  );
}

function LeadEditor({
  lead,
  staff,
  products,
  can,
  onSaved,
}: {
  lead: LeadDetailData;
  staff: Array<{ id: string; name: string }>;
  products: Array<{ id: string; name: string }>;
  can: { edit: boolean; assign: boolean };
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [pending, setPending] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string[]>>({});
  const [values, setValues] = React.useState({
    name: lead.name,
    email: lead.email,
    phone: lead.phone ?? '',
    company: lead.company ?? '',
    jobTitle: lead.jobTitle ?? '',
    message: lead.message ?? '',
    status: lead.status as string,
    priority: lead.priority,
    source: lead.source ?? '',
    campaign: lead.campaign ?? '',
    productId: lead.productId ?? '',
    assignedToId: lead.assignedToId ?? '',
    value: lead.value ?? '',
    followUpAt: lead.followUpAt ? lead.followUpAt.slice(0, 16) : '',
    lostReason: lead.lostReason ?? '',
  });

  const set = (key: keyof typeof values, value: string) =>
    setValues((current) => ({ ...current, [key]: value }));

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setErrors({});

    const data = new FormData();
    for (const [key, value] of Object.entries(values)) data.set(key, value);

    const result = await updateLead(lead.id, data);
    setPending(false);

    if (!result.ok) {
      setErrors(result.fieldErrors ?? {});
      toast(result.error, 'error');
      return;
    }
    toast(result.message ?? 'Saved.');
    onSaved();
  }

  return (
    <Card>
      <CardHeader title="Lead details" />
      <form onSubmit={onSubmit}>
        <CardBody className="space-y-4">
          <fieldset disabled={!can.edit || pending} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" htmlFor="lead-name" required error={errors.name}>
                <Input id="lead-name" value={values.name} onChange={(e) => set('name', e.target.value)} />
              </Field>
              <Field label="Email" htmlFor="lead-email" required error={errors.email}>
                <Input
                  id="lead-email"
                  type="email"
                  value={values.email}
                  onChange={(e) => set('email', e.target.value)}
                />
              </Field>
              <Field label="Phone" htmlFor="lead-phone" error={errors.phone}>
                <Input id="lead-phone" value={values.phone} onChange={(e) => set('phone', e.target.value)} />
              </Field>
              <Field label="Company" htmlFor="lead-company">
                <Input
                  id="lead-company"
                  value={values.company}
                  onChange={(e) => set('company', e.target.value)}
                />
              </Field>
              <Field label="Job title" htmlFor="lead-title">
                <Input
                  id="lead-title"
                  value={values.jobTitle}
                  onChange={(e) => set('jobTitle', e.target.value)}
                />
              </Field>
              <Field label="Product" htmlFor="lead-product">
                <Select
                  id="lead-product"
                  value={values.productId}
                  onChange={(e) => set('productId', e.target.value)}
                >
                  <option value="">No product</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2" id="assign">
              <Field label="Status" htmlFor="lead-status">
                <Select id="lead-status" value={values.status} onChange={(e) => set('status', e.target.value)}>
                  {LEAD_STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label="Assigned to"
                htmlFor="lead-assignee"
                hint={can.assign ? undefined : 'You do not have permission to reassign leads.'}
              >
                <Select
                  id="lead-assignee"
                  value={values.assignedToId}
                  disabled={!can.assign}
                  onChange={(e) => set('assignedToId', e.target.value)}
                >
                  <option value="">Unassigned</option>
                  {staff.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Priority" htmlFor="lead-priority">
                <Select
                  id="lead-priority"
                  value={values.priority}
                  onChange={(e) => set('priority', e.target.value)}
                >
                  <option value="LOW">Low</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="HIGH">High</option>
                </Select>
              </Field>
              <Field label="Deal value" htmlFor="lead-value" error={errors.value}>
                <Input
                  id="lead-value"
                  inputMode="decimal"
                  value={values.value}
                  placeholder="239000"
                  onChange={(e) => set('value', e.target.value)}
                />
              </Field>
              <Field label="Follow up" htmlFor="lead-followup" error={errors.followUpAt}>
                <Input
                  id="lead-followup"
                  type="datetime-local"
                  value={values.followUpAt}
                  onChange={(e) => set('followUpAt', e.target.value)}
                />
              </Field>
              <Field label="Source" htmlFor="lead-source">
                <Input
                  id="lead-source"
                  value={values.source}
                  onChange={(e) => set('source', e.target.value)}
                />
              </Field>
            </div>

            {values.status === 'LOST' ? (
              <Field label="Reason lost" htmlFor="lead-lost">
                <Input
                  id="lead-lost"
                  value={values.lostReason}
                  onChange={(e) => set('lostReason', e.target.value)}
                />
              </Field>
            ) : null}

            <Field label="Message" htmlFor="lead-message">
              <Textarea
                id="lead-message"
                rows={4}
                value={values.message}
                onChange={(e) => set('message', e.target.value)}
              />
            </Field>
          </fieldset>
        </CardBody>

        {can.edit ? (
          <div className="flex justify-end gap-2 border-t border-hairline bg-muted/[0.03] px-4 py-3 sm:px-5">
            <Button type="submit" disabled={pending}>
              {pending ? (
                <>
                  <Spinner className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Saving…
                </>
              ) : (
                <>
                  <UserCheck className="h-4 w-4" aria-hidden="true" />
                  Save lead
                </>
              )}
            </Button>
          </div>
        ) : null}
      </form>
    </Card>
  );
}

/** One label/value line in the submitted-form card. */
function SubmissionRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)] sm:gap-3">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted sm:text-sm sm:normal-case sm:tracking-normal">
        {label}
      </dt>
      <dd className="break-words text-content">{value}</dd>
    </div>
  );
}

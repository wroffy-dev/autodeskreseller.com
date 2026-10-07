'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createLead } from '@/lib/actions/leads';
import { Card, CardBody } from '@/components/ui/card';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { Spinner } from '@/components/ui/icons';
import { LEAD_STATUS_OPTIONS } from '@/lib/crm/constants';
import { DateTimeField } from '@/components/ui/date-field';

export function NewLeadForm({
  staff,
  products,
  canAssign,
}: {
  staff: Array<{ id: string; name: string }>;
  products: Array<{ id: string; name: string }>;
  canAssign: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, setPending] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string[]>>({});

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setErrors({});

    const result = await createLead(new FormData(event.currentTarget));
    setPending(false);

    if (!result.ok) {
      setErrors(result.fieldErrors ?? {});
      toast(result.error, 'error');
      return;
    }
    toast(result.message ?? 'Lead created.');
    if (result.data && 'id' in result.data) router.push(`/admin/leads/${result.data.id}`);
  }

  return (
    <form onSubmit={onSubmit}>
      <Card>
        <CardBody className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" htmlFor="name" required error={errors.name}>
              <Input id="name" name="name" required autoFocus />
            </Field>
            <Field label="Email" htmlFor="email" required error={errors.email}>
              <Input id="email" name="email" type="email" required />
            </Field>
            <Field label="Phone" htmlFor="phone" error={errors.phone}>
              <Input id="phone" name="phone" type="tel" />
            </Field>
            <Field label="Company" htmlFor="company">
              <Input id="company" name="company" />
            </Field>
            <Field label="Job title" htmlFor="jobTitle">
              <Input id="jobTitle" name="jobTitle" />
            </Field>
            <Field label="Product" htmlFor="productId">
              <Select id="productId" name="productId" defaultValue="">
                <option value="">No product</option>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Status" htmlFor="status">
              <Select id="status" name="status" defaultValue="NEW">
                {LEAD_STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Priority" htmlFor="priority">
              <Select id="priority" name="priority" defaultValue="MEDIUM">
                <option value="LOW">Low</option>
                <option value="MEDIUM">Medium</option>
                <option value="HIGH">High</option>
              </Select>
            </Field>
            <Field label="Source" htmlFor="source" hint="Where did this enquiry come from?">
              <Input id="source" name="source" placeholder="Phone call" />
            </Field>
            <Field
              label="Assigned to"
              htmlFor="assignedToId"
              hint={canAssign ? undefined : 'You cannot assign leads.'}
            >
              <Select id="assignedToId" name="assignedToId" defaultValue="" disabled={!canAssign}>
                <option value="">Unassigned</option>
                {staff.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Deal value" htmlFor="value" error={errors.value}>
              <Input id="value" name="value" inputMode="decimal" placeholder="239000" />
            </Field>
            <Field label="Follow up" htmlFor="followUpAt" error={errors.followUpAt}>
              <DateTimeField
                id="followUpAt"
                name="followUpAt"
                label="Follow up"
                invalid={!!errors.followUpAt}
                // Parsed on the server, so the browser's zone is not the one applied.
                showTimeZone={false}
              />
            </Field>
          </div>

          <Field label="Message" htmlFor="message">
            <Textarea id="message" name="message" rows={4} />
          </Field>
        </CardBody>

        <div className="flex justify-end gap-2 border-t border-hairline bg-muted/[0.03] px-4 py-3 sm:px-5">
          <Link
            href="/admin/leads"
            className="rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:text-content"
          >
            Cancel
          </Link>
          <Button type="submit" disabled={pending}>
            {pending ? (
              <>
                <Spinner className="h-4 w-4 animate-spin" aria-hidden="true" />
                Creating…
              </>
            ) : (
              'Create lead'
            )}
          </Button>
        </div>
      </Card>
    </form>
  );
}

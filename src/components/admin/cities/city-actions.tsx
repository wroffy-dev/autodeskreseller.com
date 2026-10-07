'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Archive, ArchiveRestore, ExternalLink, FilePlus2, FileText, Globe, Trash, Wand2 } from 'lucide-react';
import { createCityLandingPage, deleteCity, setCityStatus } from '@/lib/actions/cities';
import { Button, buttonClasses } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import type { CityStatus } from '@/lib/cities/status';

/** The actions in a city's header: its landing page, the generator, publishing, archiving, deletion. */
export function CityActions({
  city,
  landing,
  livePath,
  pageCount,
  can,
}: {
  city: { id: string; name: string; countryId: string; status: CityStatus; path: string };
  landing: { id: string; status: string } | null;
  /** The landing page's public address while it is live, to open it. */
  livePath: string | null;
  pageCount: number;
  can: { create: boolean; edit: boolean; delete: boolean; publish?: boolean };
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [creating, setCreating] = React.useState(false);
  const [title, setTitle] = React.useState('{{city}}');
  const [deleting, setDeleting] = React.useState(false);
  const [pending, setPending] = React.useState(false);

  async function createLanding() {
    setPending(true);
    const result = await createCityLandingPage({ cityId: city.id, title });
    setPending(false);
    if (!result.ok) {
      toast(result.error, 'error');
      return;
    }
    setCreating(false);
    toast(result.message ?? 'Landing page created.');
    if (result.data) router.push(`/admin/pages/${result.data.id}`);
  }

  async function remove() {
    setPending(true);
    const result = await deleteCity({ cityId: city.id });
    setPending(false);
    setDeleting(false);
    if (!result.ok) {
      toast(result.error, 'error');
      return;
    }
    toast(result.message ?? 'Deleted.');
    router.push('/admin/cities');
  }

  async function changeStatus(status: CityStatus) {
    setPending(true);
    const result = await setCityStatus({ cityId: city.id, status });
    setPending(false);
    setDeleting(false);
    if (!result.ok) {
      toast(result.error, 'error');
      return;
    }
    toast(result.message ?? 'Saved.');
    router.refresh();
  }

  return (
    <>
      {landing ? (
        <Link href={`/admin/pages/${landing.id}`} className={buttonClasses('outline', 'md')}>
          <FileText className="h-4 w-4" aria-hidden="true" />
          Edit landing page
        </Link>
      ) : can.create ? (
        <Button variant="outline" onClick={() => setCreating(true)}>
          <FilePlus2 className="h-4 w-4" aria-hidden="true" />
          Create landing page
        </Button>
      ) : null}
      {livePath ? (
        <Link href={livePath} target="_blank" rel="noopener noreferrer" className={buttonClasses('ghost', 'md')}>
          <ExternalLink className="h-4 w-4" aria-hidden="true" />
          View live
          <span className="sr-only">(opens in a new tab)</span>
        </Link>
      ) : null}
      {can.create ? (
        <Link
          href={`/admin/cities/generator?country=${city.countryId}&city=${city.id}`}
          className={buttonClasses('outline', 'md')}
        >
          <Wand2 className="h-4 w-4" aria-hidden="true" />
          Generate pages
        </Link>
      ) : null}
      {can.publish && city.status !== 'PUBLISHED' ? (
        <Button variant="outline" onClick={() => changeStatus('PUBLISHED')} disabled={pending}>
          <Globe className="h-4 w-4" aria-hidden="true" />
          {city.status === 'ARCHIVED' ? 'Restore and publish' : 'Publish city'}
        </Button>
      ) : null}
      {can.edit && city.status === 'ARCHIVED' ? (
        <Button variant="ghost" onClick={() => changeStatus('DRAFT')} disabled={pending}>
          <ArchiveRestore className="h-4 w-4" aria-hidden="true" />
          Restore as draft
        </Button>
      ) : null}
      {can.edit && city.status !== 'ARCHIVED' ? (
        <Button variant="ghost" onClick={() => changeStatus('ARCHIVED')} disabled={pending}>
          <Archive className="h-4 w-4" aria-hidden="true" />
          Archive
        </Button>
      ) : null}
      {can.delete ? (
        <Button variant="ghost" onClick={() => setDeleting(true)} aria-label={`Delete ${city.name}`}>
          <Trash className="h-4 w-4" aria-hidden="true" />
        </Button>
      ) : null}

      <Dialog
        open={creating}
        onClose={() => setCreating(false)}
        title={`Landing page for ${city.name}`}
        description={`An empty draft page at ${city.path}, built in the Page Builder like any other page.`}
        footer={
          <>
            <Button variant="outline" onClick={() => setCreating(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={createLanding} disabled={pending}>
              {pending ? 'Creating…' : 'Create draft'}
            </Button>
          </>
        }
      >
        <Field
          label="Title"
          htmlFor="landing-title"
          hint="Placeholders such as {{city}}, {{region}} and {{country}} are filled in once, now — for example “Autodesk reseller in {{city}}”."
        >
          <Input id="landing-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} />
        </Field>
      </Dialog>

      <Dialog
        open={deleting && pageCount > 0}
        onClose={() => setDeleting(false)}
        title={`${city.name} still has pages`}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setDeleting(false)}>
              Close
            </Button>
            {city.status !== 'ARCHIVED' && can.edit ? (
              <Button onClick={() => changeStatus('ARCHIVED')} disabled={pending}>
                Archive instead
              </Button>
            ) : null}
          </>
        }
      >
        <p className="text-sm text-muted">
          {city.name} has {pageCount} page{pageCount === 1 ? '' : 's'}
          {landing ? ', including its landing page' : ''}, so it cannot be deleted. Delete or move{' '}
          {pageCount === 1 ? 'it' : 'them'} first — or archive the city: its pages answer 404 until it is published
          again, and nothing is deleted.
        </p>
      </Dialog>
      <ConfirmDialog
        open={deleting && pageCount === 0}
        onClose={() => setDeleting(false)}
        onConfirm={remove}
        pending={pending}
        title={`Delete ${city.name}?`}
        message={`${city.name} has no pages. Deleting it frees ${city.path} for other content. This cannot be undone.`}
        confirmLabel="Delete city"
      />
    </>
  );
}

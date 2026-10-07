'use client';

import * as React from 'react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Field, Textarea } from '@/components/ui/field';

const MAX_BYTES = 2_000_000;

/**
 * Import addresses from a CSV — the file Export CSV produces, edited.
 *
 * Rows are matched by stable id and market, never by name or current path, so
 * renaming something while the file is being edited cannot send an address to
 * the wrong content. Nothing is changed until the preview has been reviewed.
 */
export function CsvImportDialog({
  open,
  onClose,
  onPreview,
}: {
  open: boolean;
  onClose: () => void;
  onPreview: (text: string) => void;
}) {
  const [text, setText] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  async function readFile(file: File | undefined) {
    setError(null);
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setError('That file is larger than 2 MB. Import it in parts.');
      return;
    }
    setText(await file.text());
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title="Import addresses from CSV"
      description="Use the columns of an export: entity_id, country and target_path are what count."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onPreview(text)} disabled={!text.trim()}>
            Preview import
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="CSV file" htmlFor="csv-file" error={error}>
          <input
            id="csv-file"
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => readFile(event.target.files?.[0])}
            className="block w-full text-sm text-content file:mr-3 file:rounded-lg file:border-0 file:bg-muted/10 file:px-3 file:py-2 file:text-sm file:font-medium"
          />
        </Field>
        <Field
          label="…or paste it"
          htmlFor="csv-text"
          hint="A blank target_path leaves the row as it is; @pattern puts it back on its pattern. Paths may include the market prefix."
        >
          <Textarea
            id="csv-text"
            rows={8}
            value={text}
            onChange={(event) => setText(event.target.value)}
            spellCheck={false}
            className="font-mono text-xs"
            placeholder={'entity_id,country,target_path\nclx…,IN,/autocad'}
          />
        </Field>
      </div>
    </Dialog>
  );
}

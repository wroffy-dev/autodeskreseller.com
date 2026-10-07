'use client';

import * as React from 'react';
import { Field, Input } from '@/components/ui/field';
import {
  PRIMARY_KEYWORD_FIELDS,
  MAX_KEYWORD_LENGTH,
  duplicateKeywordFields,
  duplicateKeywordMessage,
  type PrimaryKeywordField,
} from '@/lib/seo/keywords';

export type PrimaryKeywordFormValues = Record<PrimaryKeywordField, string>;

export const EMPTY_KEYWORDS: PrimaryKeywordFormValues = {
  primaryKeyword1: '',
  primaryKeyword2: '',
  primaryKeyword3: '',
};

/**
 * The three primary keyword inputs every SEO section shares.
 *
 * A repeated keyword is flagged as it is typed, with the same message the
 * server returns if it is saved anyway, so an editor never learns about it
 * only from a failed save. Blank fields are fine: one keyword is plenty for
 * most pages.
 */
export function PrimaryKeywordsFields({
  values,
  onChange,
  errors,
  idPrefix = '',
  disabled,
  placeholders,
  description = 'The searches this page is written to answer. SEO Intelligence checks for them in the title, description, URL, headings and copy. They are analysis inputs only: nothing is added to the page’s markup.',
}: {
  values: PrimaryKeywordFormValues;
  onChange: (field: PrimaryKeywordField, value: string) => void;
  /** Server field errors, keyed by field name. */
  errors?: Record<string, string[] | string | undefined>;
  /** Prefixed to each input id, for forms that hold several sets. */
  idPrefix?: string;
  disabled?: boolean;
  /** Shown in empty fields, e.g. the shared keywords a market inherits. */
  placeholders?: Partial<Record<PrimaryKeywordField, string>>;
  description?: string;
}) {
  const duplicates = React.useMemo(() => {
    const map = new Map<PrimaryKeywordField, string>();
    for (const duplicate of duplicateKeywordFields(values)) {
      map.set(duplicate.field, duplicateKeywordMessage(duplicate.repeats));
    }
    return map;
  }, [values]);

  return (
    <fieldset className="space-y-3 rounded-lg border border-hairline p-4">
      <legend className="px-1 text-sm font-semibold text-content">Primary keywords</legend>
      <p className="text-xs leading-relaxed text-muted">{description}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        {PRIMARY_KEYWORD_FIELDS.map((field, index) => {
          const id = `${idPrefix}${field}`;
          const serverError = errors?.[field];
          const error = duplicates.get(field) ?? serverError;
          return (
            <Field key={field} label={`Primary keyword ${index + 1}`} htmlFor={id} error={error}>
              <Input
                id={id}
                value={values[field]}
                maxLength={MAX_KEYWORD_LENGTH}
                disabled={disabled}
                placeholder={placeholders?.[field] ?? (index === 0 ? 'e.g. AutoCAD LT' : '')}
                aria-invalid={Boolean(error) || undefined}
                onChange={(event) => onChange(field, event.target.value)}
              />
            </Field>
          );
        })}
      </div>
    </fieldset>
  );
}

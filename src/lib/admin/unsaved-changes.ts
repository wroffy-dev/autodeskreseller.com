'use client';

import * as React from 'react';

/**
 * Whether the admin screen currently holds edits that have not been saved.
 *
 * Two sources feed it:
 *
 * - Components that already know their own state (anything showing the
 *   "Unsaved changes" indicator) register through `useUnsavedChanges`.
 * - For every other editor, the shell watches typing inside forms in the main
 *   content area (`trackFormEdits`). A form is clean again once submitted, and
 *   everything resets when the route changes.
 *
 * It is consulted before the topbar search moves away from the page, so a
 * result picked mid-edit asks before discarding the work. It is deliberately
 * advisory — it never blocks a save, a link or the browser's own navigation.
 */

const owners = new Set<string>();

/**
 * Fired by controls that change a form value without a native input event —
 * a switch (a button) or a date picked on the calendar — so they count as an
 * edit like typing does.
 */
export const EDIT_EVENT = 'admin:edit';

export function announceEdit(target: Element | null | undefined): void {
  target?.dispatchEvent(new CustomEvent(EDIT_EVENT, { bubbles: true }));
}
let formEdited = false;

export function hasUnsavedChanges(): boolean {
  return formEdited || owners.size > 0;
}

/** Forget typed-in edits — after a submit, or when the page changes. */
export function resetFormEdits(): void {
  formEdited = false;
}

/** Registers this component's dirty state while it is mounted. */
export function useUnsavedChanges(dirty: boolean): void {
  const id = React.useId();
  React.useEffect(() => {
    if (dirty) owners.add(id);
    else owners.delete(id);
    return () => {
      owners.delete(id);
    };
  }, [dirty, id]);
}

/** Inputs that filter or search a list rather than edit a record. */
function isEditInput(target: EventTarget | null, root: HTMLElement): boolean {
  if (!(target instanceof HTMLElement) || !root.contains(target)) return false;
  const form = target.closest('form');
  // `form.method` reads "get" for any form without the attribute, which is every
  // React-handled editor, so only an explicit GET form counts as a filter.
  if (!form || form.getAttribute('method')?.toLowerCase() === 'get') return false;
  if (target.closest('[role="search"],[data-unsaved-ignore]')) return false;
  if (
    target instanceof HTMLInputElement &&
    (target.type === 'search' || (target.type === 'checkbox' && !target.name))
  ) {
    return false;
  }
  return true;
}

/**
 * Watches the given container for edits to form fields. Returns a cleanup.
 * Selection checkboxes in tables (unnamed) and GET filter forms are ignored.
 */
export function trackFormEdits(root: HTMLElement): () => void {
  const onEdit = (event: Event) => {
    if (isEditInput(event.target, root)) formEdited = true;
  };
  const onSubmit = () => {
    formEdited = false;
  };
  root.addEventListener('input', onEdit, true);
  root.addEventListener('change', onEdit, true);
  root.addEventListener(EDIT_EVENT, onEdit, true);
  root.addEventListener('submit', onSubmit, true);
  return () => {
    root.removeEventListener('input', onEdit, true);
    root.removeEventListener('change', onEdit, true);
    root.removeEventListener(EDIT_EVENT, onEdit, true);
    root.removeEventListener('submit', onSubmit, true);
  };
}

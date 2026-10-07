/** Uniform Server Action return type consumed by the admin forms. */
export type ActionResult<T = undefined> =
  | { ok: true; data?: T; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export function success<T>(data?: T, message?: string): ActionResult<T> {
  return { ok: true, data, message };
}

export function failure(error: string, fieldErrors?: Record<string, string[]>): ActionResult<never> {
  return { ok: false, error, fieldErrors };
}

import { z } from 'zod';
import { AuthorizationError } from '@/lib/auth/guards';
import { UrlRegistryError } from '@/lib/urls/errors';

/** Maps thrown errors to a safe, user-facing ActionResult. Never leaks stacks. */
export function toActionError(error: unknown): ActionResult<never> {
  if (error instanceof z.ZodError) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of error.issues) {
      const path = issue.path.join('.') || '_form';
      (fieldErrors[path] ??= []).push(issue.message);
    }
    return failure('Please correct the highlighted fields.', fieldErrors);
  }
  if (error instanceof AuthorizationError) {
    return failure('You do not have permission to perform this action.');
  }
  // A URL the registry refused: the whole save rolled back, and the form
  // shows why beside the field that caused it.
  if (error instanceof UrlRegistryError) {
    return failure(error.message, { [error.field]: [error.message] });
  }
  if (error instanceof Error) {
    // Two saves raced for one address and the database refused the second.
    if (error.message.includes('Unique constraint') && error.message.includes('pathKey')) {
      return failure('That address was just taken by another change. Choose another.', {
        slug: ['That address was just taken by another change.'],
      });
    }
    // Prisma unique-constraint violations are actionable for the user.
    if (error.message.includes('Unique constraint')) {
      return failure('That value is already in use. Please choose another.');
    }
    if (process.env.NODE_ENV !== 'production') return failure(error.message);
  }
  console.error('[action]', error);
  return failure('Something went wrong. Please try again.');
}

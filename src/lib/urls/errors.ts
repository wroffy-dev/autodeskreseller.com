/**
 * A URL the registry refused, carried out of a transaction so the save that
 * asked for it rolls back as a whole and the form can say why.
 *
 * Plain class, no server imports: `toActionError` recognises it and turns it
 * into a field error on the form's slug (or whichever field is named).
 */
export class UrlRegistryError extends Error {
  constructor(
    message: string,
    readonly code: 'conflict' | 'stale' | 'invalid' | 'reserved',
    readonly field: string = 'slug',
  ) {
    super(message);
    this.name = 'UrlRegistryError';
  }
}

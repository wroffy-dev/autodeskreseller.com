'use client';

import * as React from 'react';

/**
 * State mirrored into the address bar's query string, without navigating.
 *
 * Filters, the page of results and the open tab survive a reload and can be
 * shared as a link, while changing them never re-renders the server page or
 * resets the scroll position: the URL is updated with `history.replaceState`,
 * which Next.js keeps in step with its router.
 */
export function useQueryState<T extends Record<string, string>>(
  prefix: string,
  defaults: T,
): [T, (patch: Partial<T>) => void] {
  const read = React.useCallback((): T => {
    if (typeof window === 'undefined') return defaults;
    const params = new URLSearchParams(window.location.search);
    const next = { ...defaults };
    for (const key of Object.keys(defaults) as Array<keyof T & string>) {
      const value = params.get(`${prefix}${key}`);
      if (value !== null) (next as Record<string, string>)[key] = value;
    }
    return next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefix]);

  const [state, setState] = React.useState<T>(defaults);
  React.useEffect(() => setState(read()), [read]);

  const update = React.useCallback(
    (patch: Partial<T>) => {
      setState((current) => {
        const next = { ...current, ...patch };
        const params = new URLSearchParams(window.location.search);
        for (const [key, value] of Object.entries(next)) {
          const name = `${prefix}${key}`;
          if (value === '' || value === (defaults as Record<string, string>)[key]) params.delete(name);
          else params.set(name, value);
        }
        const query = params.toString();
        window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
        return next;
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [prefix],
  );

  return [state, update];
}

/** A value that settles once typing stops. */
export function useDebounced<T>(value: T, delay = 300): T {
  const [settled, setSettled] = React.useState(value);
  React.useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return settled;
}

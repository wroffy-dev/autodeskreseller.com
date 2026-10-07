'use client';

import * as React from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/field';
import { Spinner } from '@/components/ui/icons';
import { cn } from '@/lib/utils/cn';
import { searchDestinationsAction, type Destination } from '@/lib/actions/urls';
import { URL_TYPE_LABELS } from '@/lib/urls/types';
import { useDebounced } from './use-query-state';

/**
 * Picks published content to send visitors to.
 *
 * Only live content is offered — never a draft, never something deleted —
 * and it is chosen by identity, so the redirect keeps working when that
 * content's address changes later.
 */
export function DestinationPicker({
  id,
  value,
  onChange,
}: {
  id: string;
  value: Destination | null;
  onChange: (value: Destination | null) => void;
}) {
  const [query, setQuery] = React.useState('');
  const debounced = useDebounced(query, 250);
  const [results, setResults] = React.useState<Destination[]>([]);
  const [loading, setLoading] = React.useState(false);
  const listId = `${id}-results`;

  React.useEffect(() => {
    if (!debounced.trim()) {
      setResults([]);
      return;
    }
    let current = true;
    setLoading(true);
    searchDestinationsAction({ q: debounced })
      .then((result) => current && setResults(result.ok && result.data ? result.data : []))
      .finally(() => current && setLoading(false));
    return () => {
      current = false;
    };
  }, [debounced]);

  if (value) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-hairline px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-content">{value.label}</p>
          <p className="break-all font-mono text-xs text-muted">
            {value.path} · {URL_TYPE_LABELS[value.type]} · {value.countryName}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onChange(null)}
          className="ml-auto shrink-0 text-xs font-medium text-brand hover:underline"
        >
          Change
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
        <Input
          id={id}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search published pages, products and articles"
          className="pl-9"
          role="combobox"
          aria-expanded={results.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
        />
        {loading ? (
          <Spinner className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted" aria-hidden="true" />
        ) : null}
      </div>
      {results.length > 0 ? (
        <ul id={listId} role="listbox" className="mt-1 max-h-56 overflow-y-auto rounded-lg border border-hairline bg-surface shadow-sm">
          {results.map((result) => (
            <li key={`${result.entityId}-${result.countryId}`} role="option" aria-selected={false}>
              <button
                type="button"
                onClick={() => onChange(result)}
                className={cn('block w-full px-3 py-2 text-left hover:bg-muted/5 focus-visible:bg-muted/5 focus-visible:outline-none')}
              >
                <span className="block truncate text-sm text-content">{result.label}</span>
                <span className="block break-all font-mono text-xs text-muted">
                  {result.path} · {URL_TYPE_LABELS[result.type]} · {result.countryName}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : debounced.trim() && !loading ? (
        <p className="mt-1 text-xs text-muted">No published content matches.</p>
      ) : null}
    </div>
  );
}

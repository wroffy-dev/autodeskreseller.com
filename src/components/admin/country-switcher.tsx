'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Globe, ChevronDown, Check } from 'lucide-react';
import { Menu, MenuItem } from '@/components/ui/menu';
import { setAdminCountry } from '@/lib/actions/countries';
import { cn } from '@/lib/utils/cn';
import type { CountryContext } from '@/lib/country/types';

/**
 * Which market the admin is editing.
 *
 * Built from the topbar's own `Menu`, with the same trigger shape, spacing and
 * dark-chrome focus ring as the Create and account menus beside it, so it reads
 * as part of the bar rather than as a new control.
 *
 * The current market and the list of options are resolved on the server and
 * passed in as props — the component never reads the cookie, so the server and
 * client markup always agree and there is nothing for hydration to flash.
 */
export function AdminCountrySwitcher({
  current,
  countries,
}: {
  current: Pick<CountryContext, 'id' | 'code' | 'name'>;
  countries: Array<Pick<CountryContext, 'id' | 'code' | 'name' | 'isDefault'>>;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  // One market means there is nothing to choose; the bar stays as it was.
  if (countries.length < 2) return null;

  const choose = (code: string) => {
    if (code === current.code) return;
    startTransition(async () => {
      await setAdminCountry({ code });
      router.refresh();
    });
  };

  return (
    <Menu
      align="right"
      label={`Country: ${current.name}`}
      triggerClassName="admin-focus admin-focus-header"
      trigger={
        <span
          className={cn(
            'flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm text-admin-nav',
            'transition-colors hover:bg-admin-nav/[0.08]',
            pending && 'opacity-60',
          )}
        >
          <Globe className="h-4 w-4 text-admin-nav/70" aria-hidden="true" />
          <span className="hidden text-admin-nav/60 sm:inline">Country:</span>
          {/* The code on phones, where a long market name would crowd the bar. */}
          <span className="font-medium sm:hidden">{current.code}</span>
          <span className="hidden max-w-[10rem] truncate font-medium sm:inline">{current.name}</span>
          <ChevronDown className="h-3.5 w-3.5 text-admin-nav/60" aria-hidden="true" />
        </span>
      }
    >
      <div className="border-b border-hairline px-3 py-2">
        <p className="text-xs text-muted">
          CMS screens show the content of the selected country.
        </p>
      </div>
      {countries.map((country) => (
        <MenuItem
          key={country.id}
          onClick={() => choose(country.code)}
          icon={
            country.code === current.code ? (
              <Check className="h-4 w-4 text-brand" aria-hidden="true" />
            ) : (
              <span className="block h-4 w-4" aria-hidden="true" />
            )
          }
        >
          {country.name}
          {country.isDefault ? <span className="ml-1 text-xs text-muted">· default</span> : null}
        </MenuItem>
      ))}
    </Menu>
  );
}

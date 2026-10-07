'use client';

import * as React from 'react';
import { SegmentedControl } from '@/components/ui/segmented-control';

export type AdminTab = { id: string; label: string; badge?: number | string };

/**
 * Horizontal tab strip used by every large edit screen, so a long form becomes
 * a few short ones instead of one overwhelming page.
 *
 * Drawn by the shared segmented control as an underlined strip with a sliding
 * indicator; it keeps the `tab-*` / `panel-*` ids `TabPanel` pairs with, and
 * scrolls inside itself when there are more tabs than room.
 */
export function AdminTabs({
  tabs,
  active,
  onChange,
  className,
}: {
  tabs: AdminTab[];
  active: string;
  onChange: (id: string) => void;
  className?: string;
}) {
  return (
    <SegmentedControl
      semantics="tabs"
      variant="underline"
      label="Sections"
      idPrefix="tab-"
      panelId={(id) => `panel-${id}`}
      value={active}
      onChange={onChange}
      className={className}
      options={tabs.map((tab) => ({
        value: tab.id,
        label: tab.label,
        badge: tab.badge !== undefined && tab.badge !== 0 ? tab.badge : undefined,
      }))}
    />
  );
}

export function TabPanel({
  id,
  active,
  children,
  className,
}: {
  id: string;
  active: string;
  children: React.ReactNode;
  className?: string;
}) {
  if (id !== active) return null;
  return (
    <div role="tabpanel" id={`panel-${id}`} aria-labelledby={`tab-${id}`} className={className}>
      {children}
    </div>
  );
}

'use client';

import * as React from 'react';
import type { ManagerOverview } from '@/lib/urls/manager';
import type { ManagerTab } from './tabs';

export type ManagerContext = {
  overview: ManagerOverview;
  /** Re-reads the header figures after something changed. */
  refresh: () => void;
  /** Opens a tab, e.g. from a link in another tab. */
  go: (tab: ManagerTab) => void;
};

export const ManagerCtx = React.createContext<ManagerContext | null>(null);

export function useManager(): ManagerContext {
  const context = React.useContext(ManagerCtx);
  if (!context) throw new Error('useManager outside the Slug & URL Manager');
  return context;
}

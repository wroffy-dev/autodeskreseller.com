/** The manager's tabs, shared by the server page and the client shell. */
export const MANAGER_TABS = ['urls', 'patterns', 'redirects', 'conflicts', 'history', 'health'] as const;

export type ManagerTab = (typeof MANAGER_TABS)[number];

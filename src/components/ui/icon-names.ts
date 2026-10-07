/**
 * The icons an editor may reference by name from a CMS field.
 *
 * Kept in a module of its own, free of React, so the Server Actions that
 * validate a chosen icon read the list without importing the icon components
 * themselves. `icons.tsx` maps every name here to its component, and the
 * compiler holds the two to the same set.
 */
export const CMS_ICON_NAMES = [
  'shield',
  'zap',
  'users',
  'package',
  'receipt',
  'move',
  'headset',
  'graduation',
  'refresh',
  'star',
  'clock',
  'globe',
  'lock',
  'cloud',
  'server',
  'database',
  'layers',
  'rocket',
  'award',
  'thumbs-up',
  'heart',
  'target',
  'briefcase',
  'file',
  'mail',
  'phone',
  'map-pin',
  'building',
  'trending-up',
  'megaphone',
  'gift',
  'clipboard',
  'quote',
  'table',
  'list',
  'layout',
  'grid',
  'check',
  'image',
] as const;

export type CmsIconName = (typeof CMS_ICON_NAMES)[number];

export function isCmsIconName(value: string): value is CmsIconName {
  return (CMS_ICON_NAMES as readonly string[]).includes(value);
}

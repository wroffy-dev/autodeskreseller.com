import type { SeoFieldTarget } from '@/lib/seo/types';

/**
 * Taking an editor from an issue to the field that fixes it.
 *
 * Each editor knows its own layout — which tab holds which input, and what
 * the input's id is — so it turns a check's target into a `SeoJump`; the
 * score panel only renders the button. Targets an editor cannot reach get no
 * button rather than one that goes nowhere.
 */

export type SeoJump = { label: string; run: () => void };

export type SeoJumpResolver = (target: SeoFieldTarget) => SeoJump | null;

const TEXT_INPUTS =
  'textarea:not([disabled]), [contenteditable="true"], input:not([type="hidden"]):not([disabled]), select:not([disabled])';
const FOCUSABLE =
  'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * Scrolls to an element by id, focuses the input in it and briefly outlines
 * it. Waits a few frames for it to appear, because the tab holding it may
 * have only just been opened.
 */
export function focusField(id: string, attempts = 30): void {
  if (typeof window === 'undefined') return;
  const reduced = prefersReducedMotion();

  const attempt = (left: number) => {
    const element = document.getElementById(id);
    if (!element) {
      if (left > 0) window.requestAnimationFrame(() => attempt(left - 1));
      return;
    }
    element.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
    const input = element.matches(TEXT_INPUTS)
      ? element
      : (element.querySelector<HTMLElement>(TEXT_INPUTS) ??
        (element.matches(FOCUSABLE) ? element : element.querySelector<HTMLElement>(FOCUSABLE)));
    input?.focus({ preventScroll: true });
    if (!reduced && typeof element.animate === 'function') {
      element.animate(
        [
          { outline: '2px solid rgb(var(--brand-primary) / 0.7)', outlineOffset: '4px' },
          { outline: '2px solid rgb(var(--brand-primary) / 0)', outlineOffset: '4px' },
        ],
        { duration: 1800, easing: 'ease-out' },
      );
    }
  };

  attempt(attempts);
}

/**
 * A resolver from a table of where each field lives.
 *
 * `fields` maps a check's field to the tab it is on (if any) and the id of
 * the element to focus; `areas` does the same for checks that point at a
 * part of the editor rather than one field.
 */
export function jumpResolver<Tab extends string>(options: {
  fields: Partial<Record<string, { tab?: Tab; id: string; label?: string }>>;
  areas?: Partial<Record<NonNullable<SeoFieldTarget['area']>, { tab?: Tab; id?: string; label: string; run?: () => void }>>;
  openTab?: (tab: Tab) => void;
}): SeoJumpResolver {
  return (target) => {
    const place = target.field ? options.fields[target.field] : undefined;
    if (place) {
      return {
        label: place.label ?? 'Go to field',
        run: () => {
          if (place.tab) options.openTab?.(place.tab);
          focusField(place.id);
        },
      };
    }
    const area = target.area ? options.areas?.[target.area] : undefined;
    if (area) {
      return {
        label: area.label,
        run: () => {
          if (area.run) {
            area.run();
            return;
          }
          if (area.tab) options.openTab?.(area.tab);
          if (area.id) focusField(area.id);
        },
      };
    }
    return null;
  };
}

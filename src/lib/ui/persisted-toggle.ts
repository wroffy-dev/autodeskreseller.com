/**
 * The save half of a switch that persists the moment it is flipped (see
 * `usePersistedToggle` in components/ui/field.tsx). Kept free of React so the
 * rule it encodes — never show a state that was not saved — is tested directly.
 */

export type ToggleSave = (
  next: boolean,
) => Promise<{ ok: true; value?: boolean } | { ok: false; error: string }>;

/**
 * Where a switch ends up once its save settles: the stored value on success,
 * and the previous value — with the reason — on a refusal or a failed request.
 */
export async function settleToggle(
  previous: boolean,
  next: boolean,
  save: ToggleSave,
): Promise<{ checked: boolean; error: string | null }> {
  try {
    const result = await save(next);
    if (result.ok) return { checked: result.value ?? next, error: null };
    return { checked: previous, error: result.error };
  } catch {
    return { checked: previous, error: 'Could not save. Check your connection and try again.' };
  }
}

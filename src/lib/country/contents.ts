/**
 * What a market is holding, said in words.
 *
 * Deleting a market deletes what belongs only to it, so the confirmation has
 * to name that exactly — "4 pages, 1 lead", not "some content". Counting is
 * the action's job; turning the counts into the sentence lives here, away from
 * the `'use server'` module, so it can be read and tested on its own.
 */

export type CountryContents = {
  pages: number;
  posts: number;
  menus: number;
  leads: number;
  /** Market pricing rows. The products themselves are shared and survive. */
  pricing: number;
  popups: number;
  /**
   * Forms scoped to this market. Not destroyed — a product in another market
   * can name one as its enquiry form — but switched off, which is worth
   * saying out loud before anyone presses the button.
   */
  forms: number;
  /** The market's cities. Their pages are counted with the pages. */
  cities?: number;
};

/** True when removing the market would destroy something. */
export function hasContents(contents: CountryContents): boolean {
  return (
    contents.pages +
      contents.posts +
      contents.menus +
      contents.leads +
      contents.pricing +
      contents.popups +
      contents.forms +
      (contents.cities ?? 0) >
    0
  );
}

/**
 * The counts as a list, in the order somebody would miss them: the pages they
 * wrote first, the leads they cannot get back last. What is not there is not
 * mentioned — naming "0 menus" only makes the real numbers harder to see.
 */
export function describeContents(contents: CountryContents): string {
  const parts: string[] = [];
  const add = (count: number, one: string, many: string) => {
    if (count > 0) parts.push(`${count} ${count === 1 ? one : many}`);
  };

  add(contents.pages, 'page', 'pages');
  add(contents.cities ?? 0, 'city', 'cities');
  add(contents.posts, 'article', 'articles');
  add(contents.menus, 'menu', 'menus');
  add(contents.leads, 'lead', 'leads');
  add(contents.pricing, 'product price', 'product prices');
  add(contents.popups, 'popup', 'popups');

  if (parts.length === 0) return 'nothing';
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/**
 * The sentence shown before a market is deleted.
 *
 * It names what goes, and then what does not: a form is kept and switched off
 * rather than destroyed, and somebody about to press Delete should not have to
 * find that out afterwards.
 */
export function deletionWarning(name: string, contents: CountryContents): string {
  const destroyed = describeContents(contents);
  const kept =
    contents.forms > 0
      ? ` Its ${contents.forms === 1 ? 'form is' : `${contents.forms} forms are`} kept and switched off, because a product in another market can still use ${contents.forms === 1 ? 'it' : 'them'}.`
      : '';

  if (destroyed === 'nothing') {
    return `${name} holds nothing.${kept}`;
  }
  return `${name} holds ${destroyed}. Deleting the market deletes all of it, permanently.${kept} Deactivate it instead to keep everything and just take the storefront offline.`;
}

# Admin design system

How the admin looks and behaves: the tokens every screen is drawn from, where
glass is (and is not) used, the light and dark themes, and the shared controls
— switch, segmented control, topbar search, theme switch, date pickers — with
the rules for when to use each.

Everything here is **admin-only**. The rules live in
`src/app/admin/admin-ui.css` and are scoped under `.admin-ui`, the class the
admin shell puts on its root and on `<body>` while it is mounted (so dialogs,
menus and popovers portalled to `<body>` inherit them). The public site never
carries that class, so nothing in this document can change how it looks. A
unit test fails if any rule in the file is not scoped.

---

## Where the pieces live

| Piece | File |
| --- | --- |
| Tokens, glass, themes, control styles | `src/app/admin/admin-ui.css` |
| Dark-mode status tints (generated) | `src/app/admin/admin-dark.generated.css` (`npm run admin:dark-css`) |
| Theme preference + pre-paint script | `src/lib/admin/theme.ts` |
| Theme provider, topbar switch, menu items | `src/components/admin/theme.tsx` |
| Shell (sidebar, topbar, main) | `src/components/admin/admin-shell.tsx`, `sidebar.tsx`, `topbar.tsx` |
| Topbar search (client) | `src/components/admin/admin-search.tsx` |
| Topbar search (server) | `src/lib/actions/admin-search.ts`, shapes in `src/lib/admin/search.ts` |
| Unsaved-edit tracking | `src/lib/admin/unsaved-changes.ts` |
| Switch, `usePersistedToggle` | `src/components/ui/field.tsx`, `src/lib/ui/persisted-toggle.ts` |
| Segmented control | `src/components/ui/segmented-control.tsx` |
| Edit-screen tabs | `src/components/admin/admin-tabs.tsx` (built on the segmented control) |
| Popover (anchored panel / phone sheet) | `src/components/ui/popover.tsx` |
| Calendar | `src/components/ui/calendar.tsx` |
| Date, date-time and range fields | `src/components/ui/date-field.tsx` |
| Day arithmetic (no UTC) | `src/lib/ui/calendar-date.ts` |
| Layering | `src/lib/ui/z-index.ts` |

---

## Tokens

Colours are `R G B` channel triples so alpha is applied where a colour is used:
`rgb(var(--surface) / 0.9)`. Light values are set on `.admin-ui`; dark values
override them under `:root[data-admin-theme='dark'] .admin-ui`.

### Surfaces and text

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--workspace-bg` | soft neutral `245 246 248` | deep neutral `14 16 20` | page background |
| `--surface` | white | `26 29 35` | cards, tables, forms, editors |
| `--surface-soft` | `250 250 251` | `32 36 43` | inputs (dark), hover rows |
| `--text` | `17 24 39` | `236 237 240` | body text |
| `--text-muted` | `99 104 115` | `156 163 175` | secondary text — ≥ 4.5:1 on `--surface` and `--workspace-bg` in both themes |
| `--border` | `229 231 235` | `46 51 61` | hairlines between areas |
| `--control-border` | `190 195 204` | `88 95 108` | input, select and date-field outlines — stronger than `--border` so a field reads as a field |
| `--accent` | the brand colour | the brand colour (text lifted towards white) | active nav, selected tab, focus, links |
| `--primary` / `--primary-fg` | near-black / white | near-white / near-black | the primary action button |

The generic `text-content`, `text-muted`, `border-hairline` and `bg-surface`
utilities are re-pointed at these, so every screen picks the system up without
markup changes.

### Glass

| Token | Light | Dark | Role |
| --- | --- | --- | --- |
| `--glass-tint` | white | `30 33 40` | the sheet colour |
| `--glass-alpha-bar` | 0.72 | 0.76 | topbar |
| `--glass-alpha-rail` | 0.70 | 0.74 | sidebar rail |
| `--glass-alpha-card` | 0.70 | 0.70 | KPI cards, filter bars |
| `--glass-alpha-menu` | 0.88 | 0.90 | menus, the search results panel |
| `--glass-alpha-popover` | 0.95 | 0.96 | date pickers — glass in name only |
| `--glass-blur-bar` / `--glass-blur-menu` | 20px / 18px | same | backdrop blur |
| `--glass-saturate` | 180% | same | |
| `--glass-edge` / `--glass-highlight` | white 0.7 / 0.8 | white 0.08 / 0.06 | hairline and top-edge highlight |

### Controls, focus, states, type, spacing, motion

| Token | Notes |
| --- | --- |
| `--control-fill`, `--control-fill-alpha` | Apple-style fill for the search field, switch and segment tracks (`118 118 128` at 0.12 light, 0.24 dark) |
| `--segment-thumb` | the segmented control's sliding thumb (white / `72 76 86`) |
| `--switch-off-ring` | outline of an unchecked switch, so it is visible as a control |
| `--focus`, `--focus-ring` | one focus colour (the accent) and a 3px soft ring |
| `--success`, `--warning`, `--danger`, `--info` | semantic colours, text-safe on `--surface` in each theme |
| `--text-xs` … `--text-title` | 12 / 14 / 15 / 18 / 28px |
| `--space-1` … `--space-8` | 4px base scale |
| `--radius-*` | shell 24, card 18, small card 14, control 12, menu 14, dialog 20 |
| `--shadow-sm/md/lg` | a border plus a soft shadow; never a heavy drop shadow |
| `--motion-fast`, `--motion-base`, `--ease-out` | 150ms, 200ms, `cubic-bezier(.2,.8,.2,1)` |

---

## Glass: where and how

**Use glass** for chrome and things that float over content: the sidebar rail
(`glass-rail`), the topbar (`glass-bar`), menus and the search results panel
(`glass-menu`), KPI cards and filter bars (`glass-card`), and the dashboard's
overview panels (`<Card glass>`).

**Do not use glass** for forms, tables, editors or anything dense. Those stay on
an opaque `--surface`. Date pickers use `ui-popover`, which is 95% opaque.

Rules:

- The blur is on the **background layer only**. The topbar's glass is a sibling
  layer behind its content, never a parent of it, so text and icons stay sharp
  and fully opaque, and menus inside the bar are not nested inside a second
  blur.
- **No stacked blur.** A glass panel never sits inside another glass panel.
- **Fallbacks**: without `backdrop-filter` support, and under
  `prefers-reduced-transparency: reduce`, every glass role becomes a 97%-opaque
  sheet and the scrim becomes a plain dark layer.
- Check contrast over what is actually behind the glass (the dashboard wash, a
  table), not against the token alone. Menu and popover alphas are high for
  exactly this reason.

---

## Themes

- One preference: `light`, `dark` or `system`, stored in `localStorage` under
  `admin:theme`. What is applied is always `light` or `dark`, written to
  `<html data-admin-theme>`.
- **First visit** (nothing stored) follows the operating system.
- **No flash**: `ADMIN_THEME_SCRIPT` runs inline in the admin layout before the
  shell paints. The topbar switch draws its thumb position from the
  attribute in CSS, so it is correct on first paint with nothing for hydration
  to correct.
- **Topbar switch** (sun / moon): one press sets an explicit Light or Dark.
  "System" stays in the account menu under *Appearance*. A change made in one
  tab follows in the others.
- **Transition**: a deliberate switch cross-fades the page once through the View
  Transitions API (180ms) — no per-element colour transitions. Skipped under
  reduced motion and where unsupported.
- New colours: write them with tokens. For a light-theme Tailwind tint
  (`bg-amber-50`, `text-red-700`), run `npm run admin:dark-css` — a test fails
  until the generated dark mapping is up to date.

---

## Controls

### Switch — `Switch` from `@/components/ui/field`

For **binary settings**: enabled/disabled, visible/hidden, feature on/off.

- Keep **Save, Delete, Import, Export, Publish** as buttons.
- Keep **checkboxes** for selecting rows, for consent ("I agree"), and for
  confirmations ("I have reviewed the collisions").
- Keep **multi-state** choices as selects or segmented controls.
- A switch inside a form is still a form field: it does **not** save on its
  own. With `name`, it posts `"true"`/`"false"` like before.
- A switch that **saves immediately** (the popup list's on/off) uses
  `usePersistedToggle(serverValue, save)`: it shows the new position, blocks a
  second flip while saving (`pending`), and on failure puts the switch back
  where the server says it is and shows the reason (`error`). The server
  action should take the target state explicitly (`togglePopup(id, next)`)
  rather than flipping, so a retry is idempotent.
- Always give it a `label` (it becomes the accessible name; clicking it
  toggles). Use an `sr-only` label in a table cell.
- States: checked, unchecked (outlined track), disabled, pending (spinner in
  the knob), error (red ring + message). 44px touch target via an invisible
  margin.

### Segmented control — `SegmentedControl`

For **short, mutually exclusive choices** (2–5 options, short labels).

- `semantics="radio"` for a setting or mode: grid/list, preview width,
  breakpoint, a list filter.
- `semantics="tabs"` when it switches which panel is shown. Give `idPrefix` and
  `panelId`, and put `role="tabpanel"` + `aria-labelledby` on the panel.
- `variant="underline"` for longer tab rows on edit screens (this is what
  `AdminTabs` uses). The strip scrolls inside itself; labels never wrap or
  overlap, and the chosen tab is scrolled into view.
- Keyboard: only the chosen segment is tabbable; ←/→ (and Home/End) move and
  select.

### Topbar search — `AdminSearch`

- ⌘K (macOS) / Ctrl+K (Windows, Linux) focuses it from anywhere in the admin;
  the hint shown in the field matches the platform.
- ↑/↓ move, Enter opens, Escape closes the panel (a second Escape clears).
- Empty field: common destinations and create actions. Typing matches admin
  sections from `ADMIN_NAV` straight away; from two characters it also searches
  records — leads, customers, pages, cities, products, blog posts, forms, media
  and staff — grouped by module with a secondary detail line.
- Server side (`adminSearch`): every group is gated by the caller's
  permissions; leads, pages, cities, posts and forms are limited to the
  markets the caller may work in; the query is trimmed and capped at 80
  characters; each type returns at most 5 rows.
- Client side: requests are debounced (200ms) and a response overtaken by a
  newer query is dropped. Loading, empty and error (with Retry) states are
  shown in the panel.
- Below 640px the field is a button that opens a full-screen sheet.
- Picking a result on a screen with unsaved edits asks first.
- It never replaces a list's own search box; those stay scoped to their module.

#### Unsaved edits

`src/lib/admin/unsaved-changes.ts` tracks edits typed into forms inside
`<main>` (filters — `role="search"`, explicit `method="get"`, unnamed selection
checkboxes — are ignored), plus anything that shows the *Unsaved changes*
indicator. Switches and date pickers announce their changes with
`announceEdit()`, since they fire no native input event. A form is clean again
once submitted, and everything resets on navigation. It is advisory: it only
makes the topbar search ask before leaving.

### Date pickers — `DateField`, `DateTimeField`, `DateRangeCalendar`

| Field holds | Use | Value |
| --- | --- | --- |
| A day | `DateField` | `yyyy-mm-dd` or `''` — exactly what `<input type="date">` held |
| A day and a time | `DateTimeField` | `yyyy-mm-ddThh:mm` or `''` — exactly what `<input type="datetime-local">` held |
| A report or filter range | `DateRangeCalendar` inside a `Popover` | two `yyyy-mm-dd` strings |

- **Typing is always allowed.** The box shows and accepts `DD/MM/YYYY`
  (day-first is the only numeric order; ISO and "7 Oct 2026" also work). The
  format is the placeholder, is announced to screen readers, and is repeated
  under the calendar.
- **Open** by clicking the field, the calendar button, or Alt+↓. **Escape**
  closes only the calendar (a dialog underneath stays open) and returns focus
  to the field.
- **Calendar keyboard**: ←/→ day, ↑/↓ week, Home/End week start/end,
  PageUp/PageDown month, Shift+PageUp/PageDown year, Enter/Space choose. The
  month/year heading opens a month and year chooser.
- `min`/`max`, `required` and clearing behave like the native input; a typed
  value that cannot be read or is out of bounds sets the browser's custom
  validity, so form submission is blocked exactly as before.
- With `name`, a hidden input carries the value, so FormData and Server
  Actions receive the same string the native input sent.
- **Time zones**: day values never go through UTC (`calendar-date.ts`; tested
  under UTC−8, UTC+5:30, UTC+14 and a zone with midnight DST). Date-time values
  are wall-clock strings; where the form converts them in the browser (pages,
  blog posts) the field names the zone ("Time in your time zone"). Where the
  server parses them (leads, products) that note is off
  (`showTimeZone={false}`), because the browser's zone is not the one applied.
- **Placement**: anchored below the field, flipped above when there is no room,
  clamped to the viewport, re-measured on scroll and resize, and portalled into
  the enclosing dialog or drawer so it layers and traps focus with it. Below
  640px it is a bottom sheet.
- **Event list**: pass `events` only where real scheduled items exist. Today
  that is the lead follow-up field, which lists other follow-ups in the same
  market. Ordinary date fields show the compact calendar alone.

---

## Layout and responsiveness

- The sidebar is a floating rail (280px, 76px collapsed) on `lg` and up and an
  off-canvas drawer below it. The collapsed state persists.
- The topbar holds breadcrumbs (`lg`+), the search field (a button on phones),
  the market switcher (code on phones, name with truncation above), Create,
  the theme switch (from 360px), View website and the account menu.
- Content width caps at 100rem; editors keep their working columns.
- Use `min-w-0` on flex and grid children that hold text, `scroll-x` around
  anything intentionally wider (tables, tab strips). Never clip overflow on
  `<body>`; the verification sweep checks every admin route for document-level
  horizontal scroll at 360–1920px and at 125%/150% zoom.

## Motion

Transitions are 150–220ms, on transform, opacity and colour only: popovers
(`animate-pop-in`, 160ms), the segmented thumb and switch knob (200ms), the
theme cross-fade (180ms). Nothing loops. The app-wide
`prefers-reduced-motion: reduce` rule turns them all off.

## Accessibility checklist

- Text meets 4.5:1 (3:1 for large text) on its real background, in both
  themes; glass alphas are chosen so this holds over the dashboard wash.
- Controls have visible boundaries (`--control-border`, `--switch-off-ring`)
  and a visible focus indicator (`--focus`).
- State is never colour alone: switches move their knob, segments move their
  thumb, the calendar marks today with a ring and selection with a fill, and
  status text accompanies colour.
- Every overlay restores focus to what opened it.

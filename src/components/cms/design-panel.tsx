'use client';

import * as React from 'react';
import { Monitor, Tablet, Smartphone, Eye, EyeOff } from 'lucide-react';
import {
  BREAKPOINTS,
  BREAKPOINT_LABELS,
  SECTION_PRESETS,
  WIDTH_MODES,
  normaliseAnchor,
  ANCHOR_PATTERN,
  parseSectionDesign,
  type Breakpoint,
  type SectionDesign,
  type BreakpointDesign,
  type BoxValue,
} from '@/lib/cms/design';
import { Field, Input, Select, Switch, Label } from '@/components/ui/field';
import { MediaPicker } from '@/components/admin/media-picker';
import { UnitInput, BoxInput, ColorInput, DesignGroup } from './design-controls';
import { cn } from '@/lib/utils/cn';
import { SegmentedControl } from '@/components/ui/segmented-control';

const BREAKPOINT_ICON: Record<Breakpoint, typeof Monitor> = {
  desktop: Monitor,
  tablet: Tablet,
  mobile: Smartphone,
};

const PRESET_LABELS: Record<(typeof SECTION_PRESETS)[number], string> = {
  default: 'Page background',
  muted: 'Subtle tint',
  brand: 'Brand colour',
  dark: 'Dark',
  gradient: 'Soft gradient',
};

const WIDTH_LABELS: Record<(typeof WIDTH_MODES)[number], string> = {
  boxed: 'Boxed (container width)',
  narrow: 'Narrow',
  wide: 'Wide',
  full: 'Full width (edge to edge)',
  custom: 'Custom width',
};

/**
 * The universal Design panel.
 *
 * Every section gets the same panel regardless of block type. Values are stored
 * in `PageSection.settings` and the public renderer turns them into CSS custom
 * properties, so nothing here needs a matching Tailwind class to exist.
 */
/**
 * Which groups to render.
 *
 * The page builder splits the panel across its Design / Responsive / Advanced
 * tabs; anywhere else "all" renders the complete panel in one column.
 */
export type DesignPanelView = 'all' | 'design' | 'responsive' | 'advanced';

export function DesignPanel({
  value,
  onChange,
  idPrefix,
  view = 'all',
  /** Anchor IDs used by the page's other sections, for duplicate detection. */
  takenAnchors = [],
}: {
  value: unknown;
  onChange: (next: SectionDesign) => void;
  idPrefix: string;
  view?: DesignPanelView;
  takenAnchors?: string[];
}) {
  // Always work against a fully-parsed design so a legacy or partial settings
  // object still renders every control with sensible values.
  const design = React.useMemo(() => parseSectionDesign(value), [value]);
  const [breakpoint, setBreakpoint] = React.useState<Breakpoint>('desktop');
  const [anchorDraft, setAnchorDraft] = React.useState(design.anchorId);

  React.useEffect(() => setAnchorDraft(design.anchorId), [design.anchorId]);

  const patch = (next: Partial<SectionDesign>) => onChange({ ...design, ...next });

  const patchBreakpoint = (bp: Breakpoint, next: Partial<BreakpointDesign>) =>
    onChange({ ...design, [bp]: { ...design[bp], ...next } });

  const current = design[breakpoint];
  const isDesktop = breakpoint === 'desktop';
  const inheritHint = isDesktop
    ? undefined
    : `Leave blank to inherit the ${breakpoint === 'tablet' ? 'desktop' : 'tablet'} value.`;

  const anchorNormalised = normaliseAnchor(anchorDraft);
  const anchorDuplicate = Boolean(anchorNormalised) && takenAnchors.includes(anchorNormalised);
  const anchorRewritten =
    Boolean(anchorDraft.trim()) && anchorNormalised !== anchorDraft.trim().toLowerCase();

  const showResponsive = view === 'all' || view === 'responsive';
  const showDesign = view === 'all' || view === 'design';
  const showAdvanced = view === 'all' || view === 'advanced';

  return (
    <div className="space-y-3">
      {/* Breakpoint switch — scopes the spacing/layout groups below. */}
      {showResponsive ? (
        <>
          <SegmentedControl
            label="Screen size"
            size="sm"
            fullWidth
            value={breakpoint}
            onChange={setBreakpoint}
            options={BREAKPOINTS.map((bp) => {
              const Icon = BREAKPOINT_ICON[bp];
              const overrides = countOverrides(design[bp]);
              return {
                value: bp,
                label: BREAKPOINT_LABELS[bp],
                icon: <Icon className="h-3.5 w-3.5" aria-hidden="true" />,
                badge: bp !== 'desktop' && overrides > 0 ? overrides : undefined,
              };
            })}
          />

          <p className="text-xs text-muted">
            {isDesktop
              ? 'Desktop values apply everywhere unless a smaller screen overrides them.'
              : `Only the values you set here change on ${BREAKPOINT_LABELS[breakpoint].toLowerCase()}. Anything left blank inherits the larger screen.`}
          </p>
        </>
      ) : null}

      {showResponsive ? (
        <>
          <DesignGroup title="Spacing" description="Margin and padding, per side" defaultOpen>
            <BoxInput
              label="Margin"
              hint={inheritHint}
              value={current.margin}
              idPrefix={`${idPrefix}-${breakpoint}-margin`}
              onChange={(margin: BoxValue) => patchBreakpoint(breakpoint, { margin })}
            />
            <BoxInput
              label="Padding"
              hint={inheritHint}
              value={current.padding}
              idPrefix={`${idPrefix}-${breakpoint}-padding`}
              onChange={(padding: BoxValue) => patchBreakpoint(breakpoint, { padding })}
            />
          </DesignGroup>

          <DesignGroup title="Width & height">
            {isDesktop ? (
              <>
                <Field label="Layout" htmlFor={`${idPrefix}-widthMode`}>
                  <Select
                    id={`${idPrefix}-widthMode`}
                    value={design.widthMode}
                    onChange={(e) =>
                      patch({
                        widthMode: e.target.value as SectionDesign['widthMode'],
                      })
                    }
                  >
                    {WIDTH_MODES.map((mode) => (
                      <option key={mode} value={mode}>
                        {WIDTH_LABELS[mode]}
                      </option>
                    ))}
                  </Select>
                </Field>

                {design.widthMode === 'custom' ? (
                  <div className="space-y-1.5">
                    <Label htmlFor={`${idPrefix}-maxWidth`}>Maximum width</Label>
                    <UnitInput
                      id={`${idPrefix}-maxWidth`}
                      value={design.maxWidth}
                      aria-label="Maximum width"
                      placeholder="1200"
                      onChange={(maxWidth) => patch({ maxWidth })}
                    />
                  </div>
                ) : null}
              </>
            ) : null}

            <div className="space-y-1.5">
              <Label htmlFor={`${idPrefix}-${breakpoint}-contentWidth`}>Content width</Label>
              <UnitInput
                id={`${idPrefix}-${breakpoint}-contentWidth`}
                value={current.contentWidth}
                aria-label="Content width"
                placeholder="inherit"
                onChange={(contentWidth) => patchBreakpoint(breakpoint, { contentWidth })}
              />
              <p className="text-xs text-muted">Overrides the layout above for this screen size.</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={`${idPrefix}-${breakpoint}-minHeight`}>Minimum height</Label>
              <UnitInput
                id={`${idPrefix}-${breakpoint}-minHeight`}
                value={current.minHeight}
                aria-label="Minimum height"
                placeholder="auto"
                onChange={(minHeight) => patchBreakpoint(breakpoint, { minHeight })}
              />
            </div>
          </DesignGroup>

          <DesignGroup title="Layout & alignment" description="Columns, alignment and gaps">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Grid columns"
                htmlFor={`${idPrefix}-${breakpoint}-columns`}
                hint={isDesktop ? "Blank uses the section's own setting." : inheritHint}
              >
                <Select
                  id={`${idPrefix}-${breakpoint}-columns`}
                  value={current.columns === null ? '' : String(current.columns)}
                  onChange={(e) =>
                    patchBreakpoint(breakpoint, {
                      columns: e.target.value === '' ? null : Number(e.target.value),
                    })
                  }
                >
                  <option value="">Automatic</option>
                  {[1, 2, 3, 4, 5, 6].map((n) => (
                    <option key={n} value={n}>
                      {n} {n === 1 ? 'column' : 'columns'}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Text alignment" htmlFor={`${idPrefix}-${breakpoint}-align`}>
                <Select
                  id={`${idPrefix}-${breakpoint}-align`}
                  value={current.align}
                  onChange={(e) =>
                    patchBreakpoint(breakpoint, {
                      align: e.target.value as BreakpointDesign['align'],
                    })
                  }
                >
                  <option value="inherit">Default</option>
                  <option value="left">Left</option>
                  <option value="center">Centre</option>
                  <option value="right">Right</option>
                </Select>
              </Field>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {(
                [
                  ['rowGap', 'Row gap'],
                  ['columnGap', 'Column gap'],
                  ['contentGap', 'Content gap'],
                  ['cardGap', 'Card gap'],
                ] as const
              ).map(([key, label]) => (
                <div key={key} className="space-y-1.5">
                  <Label htmlFor={`${idPrefix}-${breakpoint}-${key}`}>{label}</Label>
                  <UnitInput
                    id={`${idPrefix}-${breakpoint}-${key}`}
                    value={current[key]}
                    aria-label={label}
                    placeholder="default"
                    onChange={(next) => patchBreakpoint(breakpoint, { [key]: next })}
                  />
                </div>
              ))}
            </div>
          </DesignGroup>

          <DesignGroup title="Typography & images" description="Sizes for this screen size">
            <div className="grid gap-3 sm:grid-cols-2">
              {(
                [
                  ['headingSize', 'Heading size'],
                  ['bodySize', 'Body text size'],
                  ['imageWidth', 'Image width'],
                  ['imageHeight', 'Image height'],
                ] as const
              ).map(([key, label]) => (
                <div key={key} className="space-y-1.5">
                  <Label htmlFor={`${idPrefix}-${breakpoint}-${key}`}>{label}</Label>
                  <UnitInput
                    id={`${idPrefix}-${breakpoint}-${key}`}
                    value={current[key]}
                    aria-label={label}
                    placeholder="default"
                    onChange={(next) => patchBreakpoint(breakpoint, { [key]: next })}
                  />
                </div>
              ))}
            </div>
          </DesignGroup>
        </>
      ) : null}

      {showDesign ? (
        <>
          <DesignGroup title="Background">
            <Field label="Quick background" htmlFor={`${idPrefix}-preset`}>
              <Select
                id={`${idPrefix}-preset`}
                value={design.preset}
                onChange={(e) => patch({ preset: e.target.value as SectionDesign['preset'] })}
              >
                {SECTION_PRESETS.map((preset) => (
                  <option key={preset} value={preset}>
                    {PRESET_LABELS[preset]}
                  </option>
                ))}
              </Select>
            </Field>

            <Field
              label="Background type"
              htmlFor={`${idPrefix}-bgType`}
              hint="Overrides the quick background above."
            >
              <Select
                id={`${idPrefix}-bgType`}
                value={design.background.type}
                onChange={(e) =>
                  patch({
                    background: {
                      ...design.background,
                      type: e.target.value as SectionDesign['background']['type'],
                    },
                  })
                }
              >
                <option value="none">Use the quick background</option>
                <option value="solid">Solid colour</option>
                <option value="gradient">Gradient</option>
                <option value="image">Image</option>
              </Select>
            </Field>

            {design.background.type === 'solid' ? (
              <ColorInput
                label="Background colour"
                id={`${idPrefix}-bgColor`}
                value={design.background.color}
                onChange={(color) => patch({ background: { ...design.background, color } })}
              />
            ) : null}

            {design.background.type === 'gradient' ? (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <ColorInput
                    label="Gradient start"
                    id={`${idPrefix}-gradFrom`}
                    value={design.background.gradientFrom}
                    onChange={(gradientFrom) =>
                      patch({
                        background: { ...design.background, gradientFrom },
                      })
                    }
                  />
                  <ColorInput
                    label="Gradient end"
                    id={`${idPrefix}-gradTo`}
                    value={design.background.gradientTo}
                    onChange={(gradientTo) =>
                      patch({
                        background: { ...design.background, gradientTo },
                      })
                    }
                  />
                </div>
                <Field
                  label={`Angle — ${design.background.gradientAngle}°`}
                  htmlFor={`${idPrefix}-gradAngle`}
                >
                  <input
                    id={`${idPrefix}-gradAngle`}
                    type="range"
                    min={0}
                    max={360}
                    step={5}
                    value={design.background.gradientAngle}
                    onChange={(e) =>
                      patch({
                        background: {
                          ...design.background,
                          gradientAngle: Number(e.target.value),
                        },
                      })
                    }
                    className="w-full accent-brand"
                  />
                </Field>
              </>
            ) : null}

            {design.background.type === 'image' ? (
              <>
                <Field label="Background image">
                  <MediaPicker
                    value={design.background.imageId}
                    onChange={(imageId) => patch({ background: { ...design.background, imageId } })}
                    label="background image"
                  />
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Position" htmlFor={`${idPrefix}-bgPos`}>
                    <Select
                      id={`${idPrefix}-bgPos`}
                      value={design.background.imagePosition}
                      onChange={(e) =>
                        patch({
                          background: {
                            ...design.background,
                            imagePosition: e.target
                              .value as SectionDesign['background']['imagePosition'],
                          },
                        })
                      }
                    >
                      {[
                        'center',
                        'top',
                        'bottom',
                        'left',
                        'right',
                        'top left',
                        'top right',
                        'bottom left',
                        'bottom right',
                      ].map((pos) => (
                        <option key={pos} value={pos}>
                          {pos.replace(/\b\w/g, (c) => c.toUpperCase())}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Size" htmlFor={`${idPrefix}-bgSize`}>
                    <Select
                      id={`${idPrefix}-bgSize`}
                      value={design.background.imageSize}
                      onChange={(e) =>
                        patch({
                          background: {
                            ...design.background,
                            imageSize: e.target.value as SectionDesign['background']['imageSize'],
                          },
                        })
                      }
                    >
                      <option value="cover">Cover</option>
                      <option value="contain">Contain</option>
                      <option value="auto">Original size</option>
                    </Select>
                  </Field>
                  <Field label="Repeat" htmlFor={`${idPrefix}-bgRepeat`}>
                    <Select
                      id={`${idPrefix}-bgRepeat`}
                      value={design.background.imageRepeat}
                      onChange={(e) =>
                        patch({
                          background: {
                            ...design.background,
                            imageRepeat: e.target
                              .value as SectionDesign['background']['imageRepeat'],
                          },
                        })
                      }
                    >
                      <option value="no-repeat">Don’t repeat</option>
                      <option value="repeat">Tile</option>
                      <option value="repeat-x">Tile horizontally</option>
                      <option value="repeat-y">Tile vertically</option>
                    </Select>
                  </Field>
                  <Field label="Scrolling" htmlFor={`${idPrefix}-bgAttach`}>
                    <Select
                      id={`${idPrefix}-bgAttach`}
                      value={design.background.imageAttachment}
                      onChange={(e) =>
                        patch({
                          background: {
                            ...design.background,
                            imageAttachment: e.target
                              .value as SectionDesign['background']['imageAttachment'],
                          },
                        })
                      }
                    >
                      <option value="scroll">Scrolls with the page</option>
                      <option value="fixed">Fixed (parallax)</option>
                    </Select>
                  </Field>
                </div>
              </>
            ) : null}

            {design.background.type === 'image' || design.background.type === 'gradient' ? (
              <>
                <ColorInput
                  label="Overlay colour"
                  id={`${idPrefix}-overlay`}
                  value={design.background.overlayColor}
                  hint="Darkens or tints the background so text stays readable."
                  onChange={(overlayColor) =>
                    patch({
                      background: { ...design.background, overlayColor },
                    })
                  }
                />
                <Field
                  label={`Overlay opacity — ${design.background.overlayOpacity}%`}
                  htmlFor={`${idPrefix}-overlayOpacity`}
                >
                  <input
                    id={`${idPrefix}-overlayOpacity`}
                    type="range"
                    min={0}
                    max={100}
                    value={design.background.overlayOpacity}
                    onChange={(e) =>
                      patch({
                        background: {
                          ...design.background,
                          overlayOpacity: Number(e.target.value),
                        },
                      })
                    }
                    className="w-full accent-brand"
                  />
                </Field>
              </>
            ) : null}
          </DesignGroup>

          <DesignGroup title="Colours" description="Leave blank to use the global palette">
            <div className="grid gap-4 sm:grid-cols-2">
              <ColorInput
                label="Primary colour"
                id={`${idPrefix}-cPrimary`}
                value={design.colors.primary}
                onChange={(primary) => patch({ colors: { ...design.colors, primary } })}
              />
              <ColorInput
                label="Secondary colour"
                id={`${idPrefix}-cSecondary`}
                value={design.colors.secondary}
                onChange={(secondary) => patch({ colors: { ...design.colors, secondary } })}
              />
              <ColorInput
                label="Heading colour"
                id={`${idPrefix}-cHeading`}
                value={design.colors.heading}
                onChange={(heading) => patch({ colors: { ...design.colors, heading } })}
              />
              <ColorInput
                label="Text colour"
                id={`${idPrefix}-cText`}
                value={design.colors.text}
                onChange={(text) => patch({ colors: { ...design.colors, text } })}
              />
              <ColorInput
                label="Background colour"
                id={`${idPrefix}-cBg`}
                value={design.colors.background}
                onChange={(background) => patch({ colors: { ...design.colors, background } })}
              />
              <ColorInput
                label="Button colour"
                id={`${idPrefix}-cButton`}
                value={design.colors.button}
                onChange={(button) => patch({ colors: { ...design.colors, button } })}
              />
              <ColorInput
                label="Button text colour"
                id={`${idPrefix}-cButtonText`}
                value={design.colors.buttonText}
                onChange={(buttonText) => patch({ colors: { ...design.colors, buttonText } })}
              />
              <ColorInput
                label="Link colour"
                id={`${idPrefix}-cLink`}
                value={design.colors.link}
                onChange={(link) => patch({ colors: { ...design.colors, link } })}
              />
            </div>

            <div className="rounded-lg border border-hairline p-3">
              <Switch
                checked={design.colors.invertText}
                onChange={(invertText) => patch({ colors: { ...design.colors, invertText } })}
                label="Light text on a dark background"
                hint="Turn on when you pick a dark background colour or image."
              />
            </div>
          </DesignGroup>
        </>
      ) : null}

      {showAdvanced ? (
        <DesignGroup title="Visibility & anchor">
          <fieldset className="rounded-lg border border-hairline p-3">
            <legend className="px-1 text-sm font-medium text-content">Show this section on</legend>
            <ul className="space-y-2">
              {BREAKPOINTS.map((bp) => {
                const Icon = BREAKPOINT_ICON[bp];
                const hidden = design[bp].hidden;
                return (
                  <li key={bp} className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2 text-sm text-content">
                      <Icon className="h-4 w-4 text-muted" aria-hidden="true" />
                      {BREAKPOINT_LABELS[bp]}
                    </span>
                    <button
                      type="button"
                      onClick={() => patchBreakpoint(bp, { hidden: !hidden })}
                      aria-pressed={!hidden}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors',
                        hidden ? 'bg-muted/10 text-muted' : 'bg-brand/10 text-brand',
                      )}
                    >
                      {hidden ? (
                        <EyeOff className="h-3.5 w-3.5" />
                      ) : (
                        <Eye className="h-3.5 w-3.5" />
                      )}
                      {hidden ? 'Hidden' : 'Visible'}
                    </button>
                  </li>
                );
              })}
            </ul>
            <p className="mt-2 px-1 text-xs text-muted">
              Hiding a section on every screen keeps it in the page, just not on the site.
            </p>
          </fieldset>

          <Field
            label="Anchor ID"
            htmlFor={`${idPrefix}-anchor`}
            hint="Lets you link straight to this section, e.g. /pricing#plans"
            error={
              anchorDuplicate
                ? ['Another section on this page already uses that anchor. Pick a different one.']
                : undefined
            }
          >
            <Input
              id={`${idPrefix}-anchor`}
              value={anchorDraft}
              placeholder="pricing"
              onChange={(e) => setAnchorDraft(e.target.value)}
              onBlur={() => {
                setAnchorDraft(anchorNormalised);
                patch({ anchorId: anchorNormalised });
              }}
              aria-invalid={anchorDuplicate || undefined}
              className="font-mono text-sm"
            />
          </Field>

          {anchorNormalised && !anchorDuplicate ? (
            <p className="text-xs text-muted">
              Renders as <code className="font-mono">id=&quot;{anchorNormalised}&quot;</code>,
              linkable as <code className="font-mono">#{anchorNormalised}</code>.
            </p>
          ) : null}
          {anchorRewritten && !anchorDuplicate ? (
            <p className="text-xs text-amber-600">
              Adjusted to <code className="font-mono">{anchorNormalised}</code> so it is valid in a
              URL.
            </p>
          ) : null}
          {anchorDraft.trim() && !ANCHOR_PATTERN.test(anchorNormalised) ? (
            <p className="text-xs font-medium text-red-600" role="alert">
              An anchor must start with a letter and use only letters, numbers and hyphens.
            </p>
          ) : null}
        </DesignGroup>
      ) : null}
    </div>
  );
}

/** How many values a breakpoint overrides — shown as a badge on its tab. */
function countOverrides(bp: BreakpointDesign): number {
  let count = 0;
  for (const box of [bp.margin, bp.padding]) {
    for (const side of Object.values(box)) if (side) count += 1;
  }
  for (const key of [
    'contentWidth',
    'minHeight',
    'headingSize',
    'bodySize',
    'rowGap',
    'columnGap',
    'contentGap',
    'cardGap',
    'imageWidth',
    'imageHeight',
  ] as const) {
    if (bp[key]) count += 1;
  }
  if (bp.columns !== null) count += 1;
  if (bp.align !== 'inherit') count += 1;
  return count;
}

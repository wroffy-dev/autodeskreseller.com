'use client';

import * as React from 'react';
import { UnitInput, BoxInput, ColorInput, DesignGroup } from '@/components/cms/design-controls';
import { FontSelect, FontWeightSelect } from '@/components/admin/settings/font-select';
import { Field, Input, Select, Switch } from '@/components/ui/field';
import { BREAKPOINT_LABELS, type Breakpoint, type BoxValue } from '@/lib/cms/design';
import {
  ALIGNMENTS,
  LABEL_POSITIONS,
  BUTTON_WIDTHS,
  CHOICE_LAYOUTS,
  SUCCESS_BEHAVIOURS,
  type FormDesign,
  type Typography,
} from '@/lib/forms/form-design';
import { FORM_BUTTON_ICONS, FORM_BUTTON_ICON_LABELS } from '@/components/forms/form-button-icon';
import { SegmentedControl } from '@/components/ui/segmented-control';

/**
 * The Design tab.
 *
 * Ten collapsed groups in the order §2 of the brief asks for. Everything here
 * writes into one `FormDesign` object which the renderer compiles into CSS
 * custom properties, so this panel never needs to know how any of it is
 * applied — and every control is available to every form, wherever it is used.
 *
 * Controls are built from the section design system's primitives (`UnitInput`,
 * `BoxInput`, `ColorInput`, `FontSelect`) rather than new ones, so an admin who
 * has styled a page section already knows how to use this.
 */

type Patch = (next: FormDesign) => void;

export function FormDesignPanel({
  design,
  onChange,
  disabled,
}: {
  design: FormDesign;
  onChange: Patch;
  disabled?: boolean;
}) {
  const [breakpoint, setBreakpoint] = React.useState<Breakpoint>('desktop');

  /** Replaces one top-level section, leaving the rest untouched. */
  function setSection<K extends keyof FormDesign>(key: K, value: FormDesign[K]) {
    onChange({ ...design, [key]: value });
  }

  const bp = design[breakpoint];

  function setBp<K extends keyof typeof bp>(key: K, value: (typeof bp)[K]) {
    onChange({ ...design, [breakpoint]: { ...bp, [key]: value } });
  }

  return (
    <fieldset disabled={disabled} className="space-y-3 disabled:opacity-70">
      <BreakpointSwitch value={breakpoint} onChange={setBreakpoint} />

      <DesignGroup
        title="Layout"
        description="Width, alignment and how many columns the fields sit in."
        defaultOpen
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Columns" htmlFor="fd-cols" hint="Fields flow across this many columns.">
            <Select
              id="fd-cols"
              value={bp.columns === null ? '' : String(bp.columns)}
              onChange={(event) =>
                setBp('columns', event.target.value ? Number(event.target.value) : null)
              }
            >
              <option value="">
                {breakpoint === 'desktop' ? 'One column' : 'Inherit from larger screen'}
              </option>
              {[1, 2, 3, 4].map((count) => (
                <option key={count} value={count}>
                  {count} column{count === 1 ? '' : 's'}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Alignment" htmlFor="fd-align" hint="Where the form sits in its container.">
            <Select
              id="fd-align"
              value={design.layout.align}
              onChange={(event) =>
                setSection('layout', {
                  ...design.layout,
                  align: event.target.value as FormDesign['layout']['align'],
                })
              }
            >
              {ALIGNMENTS.map((value) => (
                <option key={value} value={value}>
                  {value[0]!.toUpperCase() + value.slice(1)}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Width" htmlFor="fd-width" hint="Leave empty to fill the container.">
            <UnitInput
              id="fd-width"
              value={bp.width}
              onChange={(value) => setBp('width', value)}
              placeholder="Auto"
              aria-label="Form width"
            />
          </Field>

          <Field label="Max width" htmlFor="fd-maxw" hint="Caps the form on wide screens.">
            <UnitInput
              id="fd-maxw"
              value={bp.maxWidth}
              onChange={(value) => setBp('maxWidth', value)}
              placeholder="None"
              aria-label="Form max width"
            />
          </Field>
        </div>

        <Switch
          checked={design.layout.fullWidth}
          onChange={(value) => setSection('layout', { ...design.layout, fullWidth: value })}
          label="Always fill the available width"
          hint="Ignores the width above and stretches to the container."
        />
      </DesignGroup>

      <DesignGroup title="Spacing" description="Margin, padding and the gaps between fields.">
        <div className="grid gap-4 sm:grid-cols-2">
          <BoxInput
            label="Outer margin"
            idPrefix={`fd-margin-${breakpoint}`}
            value={bp.margin}
            onChange={(value: BoxValue) => setBp('margin', value)}
          />
          <BoxInput
            label="Inner padding"
            idPrefix={`fd-padding-${breakpoint}`}
            value={bp.padding}
            onChange={(value: BoxValue) => setBp('padding', value)}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Row gap" htmlFor="fd-rowgap">
            <UnitInput
              id="fd-rowgap"
              value={bp.rowGap}
              onChange={(value) => setBp('rowGap', value)}
              placeholder="16px"
              aria-label="Row gap"
            />
          </Field>
          <Field label="Column gap" htmlFor="fd-colgap">
            <UnitInput
              id="fd-colgap"
              value={bp.columnGap}
              onChange={(value) => setBp('columnGap', value)}
              placeholder="16px"
              aria-label="Column gap"
            />
          </Field>
          <Field label="Label spacing" htmlFor="fd-labelgap" hint="Label to input.">
            <UnitInput
              id="fd-labelgap"
              value={bp.labelGap}
              onChange={(value) => setBp('labelGap', value)}
              placeholder="6px"
              aria-label="Label spacing"
            />
          </Field>
          <Field label="Help text spacing" htmlFor="fd-helpgap">
            <UnitInput
              id="fd-helpgap"
              value={bp.helpGap}
              onChange={(value) => setBp('helpGap', value)}
              placeholder="4px"
              aria-label="Help text spacing"
            />
          </Field>
          <Field label="Button spacing" htmlFor="fd-btngap" hint="Above the submit button.">
            <UnitInput
              id="fd-btngap"
              value={bp.buttonGap}
              onChange={(value) => setBp('buttonGap', value)}
              placeholder="16px"
              aria-label="Button spacing"
            />
          </Field>
        </div>
      </DesignGroup>

      <DesignGroup title="Form container" description="Background, border, corners and shadow.">
        <BackgroundControls
          value={design.container.background}
          onChange={(background) => setSection('container', { ...design.container, background })}
        />

        <BorderControls
          idPrefix="fd-container"
          label="Border"
          value={design.container.border}
          onChange={(border) => setSection('container', { ...design.container, border })}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Shadow" htmlFor="fd-shadow">
            <Select
              id="fd-shadow"
              value={design.container.shadow}
              onChange={(event) =>
                setSection('container', {
                  ...design.container,
                  shadow: event.target.value as FormDesign['container']['shadow'],
                })
              }
            >
              <option value="none">None</option>
              <option value="sm">Subtle</option>
              <option value="md">Medium</option>
              <option value="lg">Large</option>
              <option value="xl">Extra large</option>
            </Select>
          </Field>

          <Field
            label="Backdrop blur"
            htmlFor="fd-blur"
            hint="Blurs what is behind a translucent form. Leave empty for none."
          >
            <UnitInput
              id="fd-blur"
              value={design.container.backdropBlur}
              onChange={(value) =>
                setSection('container', { ...design.container, backdropBlur: value })
              }
              placeholder="None"
              aria-label="Backdrop blur"
            />
          </Field>
        </div>
      </DesignGroup>

      <DesignGroup title="Typography" description="Fonts for each part of the form.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Base font size" htmlFor="fd-basesize">
            <UnitInput
              id="fd-basesize"
              value={bp.baseFontSize}
              onChange={(value) => setBp('baseFontSize', value)}
              placeholder="Inherit"
              aria-label="Base font size"
            />
          </Field>
          <Field label="Label size" htmlFor="fd-labelsize">
            <UnitInput
              id="fd-labelsize"
              value={bp.labelFontSize}
              onChange={(value) => setBp('labelFontSize', value)}
              placeholder="14px"
              aria-label="Label font size"
            />
          </Field>
          <Field label="Input size" htmlFor="fd-inputsize">
            <UnitInput
              id="fd-inputsize"
              value={bp.inputFontSize}
              onChange={(value) => setBp('inputFontSize', value)}
              placeholder="14px"
              aria-label="Input font size"
            />
          </Field>
        </div>

        <TypographyControls
          idPrefix="fd-type-base"
          title="Base"
          description="Inherited by anything without its own font."
          value={design.typography.base}
          onChange={(base) => setSection('typography', { ...design.typography, base })}
        />
        <TypographyControls
          idPrefix="fd-type-input"
          title="Inputs"
          value={design.typography.input}
          onChange={(input) => setSection('typography', { ...design.typography, input })}
        />
        <TypographyControls
          idPrefix="fd-type-help"
          title="Help text"
          value={design.typography.help}
          onChange={(help) => setSection('typography', { ...design.typography, help })}
        />
      </DesignGroup>

      <DesignGroup title="Fields" description="How every input in this form looks and behaves.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Input height" htmlFor="fd-inputh" hint="Leave empty to fit the content.">
            <UnitInput
              id="fd-inputh"
              value={bp.inputHeight}
              onChange={(value) => setBp('inputHeight', value)}
              placeholder="Auto"
              aria-label="Input height"
            />
          </Field>
          <Field label="Minimum height" htmlFor="fd-inputminh">
            <UnitInput
              id="fd-inputminh"
              value={design.input.minHeight}
              onChange={(value) => setSection('input', { ...design.input, minHeight: value })}
              placeholder="Auto"
              aria-label="Input minimum height"
            />
          </Field>
        </div>

        <BoxInput
          label="Input padding"
          idPrefix="fd-input-padding"
          value={design.input.padding}
          onChange={(padding) => setSection('input', { ...design.input, padding })}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <ColorInput
            id="fd-input-bg"
            label="Background"
            value={design.input.background}
            onChange={(background) => setSection('input', { ...design.input, background })}
          />
          <ColorInput
            id="fd-input-text"
            label="Text colour"
            value={design.typography.input.color}
            onChange={(color) =>
              setSection('typography', {
                ...design.typography,
                input: { ...design.typography.input, color },
              })
            }
          />
        </div>

        <BorderControls
          idPrefix="fd-input"
          label="Input border"
          value={design.input.border}
          onChange={(border) => setSection('input', { ...design.input, border })}
        />

        <div className="rounded-lg border border-hairline p-3">
          <p className="mb-3 text-sm font-medium text-content">States</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <ColorInput
              id="fd-focus-border"
              label="Focus border"
              value={design.input.focusBorderColor}
              onChange={(focusBorderColor) =>
                setSection('input', { ...design.input, focusBorderColor })
              }
            />
            <ColorInput
              id="fd-focus-ring"
              label="Focus ring"
              value={design.input.focusRingColor}
              onChange={(focusRingColor) =>
                setSection('input', { ...design.input, focusRingColor })
              }
            />
            <Field label="Focus ring width" htmlFor="fd-focus-ring-w">
              <UnitInput
                id="fd-focus-ring-w"
                value={design.input.focusRingWidth}
                onChange={(focusRingWidth) =>
                  setSection('input', { ...design.input, focusRingWidth })
                }
                placeholder="2px"
                aria-label="Focus ring width"
              />
            </Field>
            <ColorInput
              id="fd-focus-bg"
              label="Focus background"
              value={design.input.focusBackground}
              onChange={(focusBackground) =>
                setSection('input', { ...design.input, focusBackground })
              }
            />
            <ColorInput
              id="fd-hover-border"
              label="Hover border"
              value={design.input.hoverBorderColor}
              onChange={(hoverBorderColor) =>
                setSection('input', { ...design.input, hoverBorderColor })
              }
            />
            <ColorInput
              id="fd-disabled-bg"
              label="Disabled background"
              value={design.input.disabledBackground}
              onChange={(disabledBackground) =>
                setSection('input', { ...design.input, disabledBackground })
              }
            />
            <ColorInput
              id="fd-disabled-text"
              label="Disabled text"
              value={design.input.disabledTextColor}
              onChange={(disabledTextColor) =>
                setSection('input', { ...design.input, disabledTextColor })
              }
            />
          </div>
        </div>

        <div className="rounded-lg border border-hairline p-3">
          <p className="mb-3 text-sm font-medium text-content">Paragraph fields</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Default rows" htmlFor="fd-rows">
              <Input
                id="fd-rows"
                type="number"
                min={2}
                max={20}
                value={design.input.textareaRows ?? ''}
                placeholder="4"
                onChange={(event) =>
                  setSection('input', {
                    ...design.input,
                    textareaRows: event.target.value ? Number(event.target.value) : null,
                  })
                }
              />
            </Field>
            <Field label="Resizing" htmlFor="fd-resize">
              <Select
                id="fd-resize"
                value={design.input.textareaResize}
                onChange={(event) =>
                  setSection('input', {
                    ...design.input,
                    textareaResize: event.target.value as FormDesign['input']['textareaResize'],
                  })
                }
              >
                <option value="none">Not resizable</option>
                <option value="vertical">Vertical only</option>
                <option value="both">Both directions</option>
              </Select>
            </Field>
          </div>
        </div>

        <div className="rounded-lg border border-hairline p-3">
          <p className="mb-1 text-sm font-medium text-content">Checkboxes and radios</p>
          <p className="mb-3 text-xs text-muted">
            Native controls are kept, so keyboard and screen-reader behaviour is unchanged.
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Size" htmlFor="fd-choice-size">
              <UnitInput
                id="fd-choice-size"
                value={design.choice.size}
                onChange={(size) => setSection('choice', { ...design.choice, size })}
                placeholder="16px"
                aria-label="Choice control size"
              />
            </Field>
            <ColorInput
              id="fd-choice-accent"
              label="Accent colour"
              value={design.choice.accentColor}
              onChange={(accentColor) => setSection('choice', { ...design.choice, accentColor })}
            />
            <Field label="Gap" htmlFor="fd-choice-gap">
              <UnitInput
                id="fd-choice-gap"
                value={design.choice.gap}
                onChange={(gap) => setSection('choice', { ...design.choice, gap })}
                placeholder="8px"
                aria-label="Choice gap"
              />
            </Field>
            <Field label="Layout" htmlFor="fd-choice-layout">
              <Select
                id="fd-choice-layout"
                value={design.choice.layout}
                onChange={(event) =>
                  setSection('choice', {
                    ...design.choice,
                    layout: event.target.value as FormDesign['choice']['layout'],
                  })
                }
              >
                {CHOICE_LAYOUTS.map((value) => (
                  <option key={value} value={value}>
                    {value[0]!.toUpperCase() + value.slice(1)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </div>
      </DesignGroup>

      <DesignGroup title="Labels" description="Position, styling and the required marker.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Position"
            htmlFor="fd-label-pos"
            hint="Individual fields can override this."
          >
            <Select
              id="fd-label-pos"
              value={design.label.position}
              onChange={(event) =>
                setSection('label', {
                  ...design.label,
                  position: event.target.value as FormDesign['label']['position'],
                })
              }
            >
              {LABEL_POSITIONS.map((value) => (
                <option key={value} value={value}>
                  {value === 'top' ? 'Above the field' : value === 'left' ? 'Beside the field' : 'Floating'}
                </option>
              ))}
            </Select>
          </Field>

          {design.label.position === 'left' ? (
            <Field label="Label column width" htmlFor="fd-label-w">
              <UnitInput
                id="fd-label-w"
                value={design.label.width}
                onChange={(width) => setSection('label', { ...design.label, width })}
                placeholder="160px"
                aria-label="Label column width"
              />
            </Field>
          ) : null}

          <ColorInput
            id="fd-required-color"
            label="Required marker colour"
            value={design.label.requiredMarkColor}
            onChange={(requiredMarkColor) =>
              setSection('label', { ...design.label, requiredMarkColor })
            }
          />
        </div>

        <Switch
          checked={design.label.showRequiredMark}
          onChange={(showRequiredMark) =>
            setSection('label', { ...design.label, showRequiredMark })
          }
          label="Show an asterisk on required fields"
          hint="Turning this off changes the marker only — the field is still required."
        />

        <TypographyControls
          idPrefix="fd-type-label"
          title="Label text"
          value={design.typography.label}
          onChange={(label) => setSection('typography', { ...design.typography, label })}
        />
      </DesignGroup>

      <DesignGroup
        title="Placeholders"
        description="Applies to fields that accept placeholder text."
      >
        <Field
          label="Opacity"
          htmlFor="fd-ph-opacity"
          hint="0–100. Low values are hard to read; 60 or above is safer."
        >
          <Input
            id="fd-ph-opacity"
            type="number"
            min={0}
            max={100}
            value={design.placeholder.opacity ?? ''}
            placeholder="60"
            onChange={(event) =>
              setSection('placeholder', {
                opacity: event.target.value ? Number(event.target.value) : null,
              })
            }
          />
        </Field>

        <TypographyControls
          idPrefix="fd-type-ph"
          title="Placeholder text"
          value={design.typography.placeholder}
          onChange={(placeholder) =>
            setSection('typography', { ...design.typography, placeholder })
          }
        />
      </DesignGroup>

      <DesignGroup title="Submit button" description="Text, size, colour and states.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Alignment" htmlFor="fd-btn-align">
            <Select
              id="fd-btn-align"
              value={design.button.align}
              onChange={(event) =>
                setSection('button', {
                  ...design.button,
                  align: event.target.value as FormDesign['button']['align'],
                })
              }
            >
              {ALIGNMENTS.map((value) => (
                <option key={value} value={value}>
                  {value[0]!.toUpperCase() + value.slice(1)}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Width" htmlFor="fd-btn-width">
            <Select
              id="fd-btn-width"
              value={design.button.width}
              onChange={(event) =>
                setSection('button', {
                  ...design.button,
                  width: event.target.value as FormDesign['button']['width'],
                })
              }
            >
              {BUTTON_WIDTHS.map((value) => (
                <option key={value} value={value}>
                  {value === 'auto' ? 'Fit the text' : value === 'full' ? 'Full width' : 'Custom'}
                </option>
              ))}
            </Select>
          </Field>

          {design.button.width === 'custom' ? (
            <Field label="Custom width" htmlFor="fd-btn-cw">
              <UnitInput
                id="fd-btn-cw"
                value={design.button.customWidth}
                onChange={(customWidth) => setSection('button', { ...design.button, customWidth })}
                placeholder="200px"
                aria-label="Button width"
              />
            </Field>
          ) : null}

          <Field label="Height" htmlFor="fd-btn-h">
            <UnitInput
              id="fd-btn-h"
              value={design.button.height}
              onChange={(height) => setSection('button', { ...design.button, height })}
              placeholder="Auto"
              aria-label="Button height"
            />
          </Field>

          <Field label="Font size" htmlFor="fd-btn-size">
            <UnitInput
              id="fd-btn-size"
              value={bp.buttonFontSize}
              onChange={(value) => setBp('buttonFontSize', value)}
              placeholder="14px"
              aria-label="Button font size"
            />
          </Field>

          <Field label="Icon" htmlFor="fd-btn-icon">
            <Select
              id="fd-btn-icon"
              value={design.button.icon}
              onChange={(event) =>
                setSection('button', { ...design.button, icon: event.target.value })
              }
            >
              <option value="">No icon</option>
              {FORM_BUTTON_ICONS.map((key) => (
                <option key={key} value={key}>
                  {FORM_BUTTON_ICON_LABELS[key] ?? key}
                </option>
              ))}
            </Select>
          </Field>

          {design.button.icon ? (
            <Field label="Icon position" htmlFor="fd-btn-icon-pos">
              <Select
                id="fd-btn-icon-pos"
                value={design.button.iconPosition}
                onChange={(event) =>
                  setSection('button', {
                    ...design.button,
                    iconPosition: event.target.value as 'left' | 'right',
                  })
                }
              >
                <option value="left">Before the text</option>
                <option value="right">After the text</option>
              </Select>
            </Field>
          ) : null}

          <Field
            label="Sending text"
            htmlFor="fd-btn-loading"
            hint="Shown while the form is submitting."
          >
            <Input
              id="fd-btn-loading"
              value={design.button.loadingText}
              placeholder="Sending…"
              maxLength={40}
              onChange={(event) =>
                setSection('button', { ...design.button, loadingText: event.target.value })
              }
            />
          </Field>
        </div>

        <BoxInput
          label="Button padding"
          idPrefix="fd-btn-padding"
          value={design.button.padding}
          onChange={(padding) => setSection('button', { ...design.button, padding })}
        />

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <ColorInput
            id="fd-btn-bg"
            label="Background"
            value={design.button.background}
            onChange={(background) => setSection('button', { ...design.button, background })}
          />
          <ColorInput
            id="fd-btn-color"
            label="Text colour"
            value={design.button.textColor}
            onChange={(textColor) => setSection('button', { ...design.button, textColor })}
          />
          <ColorInput
            id="fd-btn-hover-bg"
            label="Hover background"
            value={design.button.hoverBackground}
            onChange={(hoverBackground) =>
              setSection('button', { ...design.button, hoverBackground })
            }
          />
          <ColorInput
            id="fd-btn-hover-color"
            label="Hover text"
            value={design.button.hoverTextColor}
            onChange={(hoverTextColor) => setSection('button', { ...design.button, hoverTextColor })}
          />
          <ColorInput
            id="fd-btn-hover-border"
            label="Hover border"
            value={design.button.hoverBorderColor}
            onChange={(hoverBorderColor) =>
              setSection('button', { ...design.button, hoverBorderColor })
            }
          />
          <ColorInput
            id="fd-btn-active-bg"
            label="Pressed background"
            value={design.button.activeBackground}
            onChange={(activeBackground) =>
              setSection('button', { ...design.button, activeBackground })
            }
          />
          <ColorInput
            id="fd-btn-disabled-bg"
            label="Disabled background"
            value={design.button.disabledBackground}
            onChange={(disabledBackground) =>
              setSection('button', { ...design.button, disabledBackground })
            }
          />
          <ColorInput
            id="fd-btn-disabled-color"
            label="Disabled text"
            value={design.button.disabledTextColor}
            onChange={(disabledTextColor) =>
              setSection('button', { ...design.button, disabledTextColor })
            }
          />
        </div>

        <BorderControls
          idPrefix="fd-btn"
          label="Button border"
          value={design.button.border}
          onChange={(border) => setSection('button', { ...design.button, border })}
        />

        <TypographyControls
          idPrefix="fd-type-btn"
          title="Button text"
          value={design.typography.button}
          onChange={(button) => setSection('typography', { ...design.typography, button })}
        />
      </DesignGroup>

      <DesignGroup title="Validation" description="Error styling and the default messages.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Error spacing" htmlFor="fd-err-gap">
            <UnitInput
              id="fd-err-gap"
              value={design.validation.errorSpacing}
              onChange={(errorSpacing) =>
                setSection('validation', { ...design.validation, errorSpacing })
              }
              placeholder="4px"
              aria-label="Error spacing"
            />
          </Field>
          <ColorInput
            id="fd-input-error-border"
            label="Invalid input border"
            value={design.input.errorBorderColor}
            onChange={(errorBorderColor) =>
              setSection('input', { ...design.input, errorBorderColor })
            }
          />
          <ColorInput
            id="fd-input-error-bg"
            label="Invalid input background"
            value={design.input.errorBackground}
            onChange={(errorBackground) => setSection('input', { ...design.input, errorBackground })}
          />
        </div>

        <TypographyControls
          idPrefix="fd-type-err"
          title="Error text"
          value={design.typography.error}
          onChange={(error) => setSection('typography', { ...design.typography, error })}
        />

        <div className="rounded-lg border border-hairline p-3">
          <p className="mb-1 text-sm font-medium text-content">Default messages</p>
          <p className="mb-3 text-xs text-muted">
            Used when a field has no message of its own. The server always decides whether a value
            is valid — these only change the wording.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Required" htmlFor="fd-msg-required">
              <Input
                id="fd-msg-required"
                value={design.validation.requiredMessage}
                placeholder="This field is required."
                maxLength={160}
                onChange={(event) =>
                  setSection('validation', {
                    ...design.validation,
                    requiredMessage: event.target.value,
                  })
                }
              />
            </Field>
            <Field label="Email" htmlFor="fd-msg-email">
              <Input
                id="fd-msg-email"
                value={design.validation.emailMessage}
                placeholder="Please enter a valid email address."
                maxLength={160}
                onChange={(event) =>
                  setSection('validation', { ...design.validation, emailMessage: event.target.value })
                }
              />
            </Field>
            <Field label="Phone" htmlFor="fd-msg-phone">
              <Input
                id="fd-msg-phone"
                value={design.validation.phoneMessage}
                placeholder="Please enter a valid phone number."
                maxLength={160}
                onChange={(event) =>
                  setSection('validation', { ...design.validation, phoneMessage: event.target.value })
                }
              />
            </Field>
            <Field label="Website address" htmlFor="fd-msg-url">
              <Input
                id="fd-msg-url"
                value={design.validation.urlMessage}
                placeholder="Please enter a valid web address."
                maxLength={160}
                onChange={(event) =>
                  setSection('validation', { ...design.validation, urlMessage: event.target.value })
                }
              />
            </Field>
          </div>
        </div>
      </DesignGroup>

      <DesignGroup title="Success message" description="What a visitor sees after submitting.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Behaviour"
            htmlFor="fd-ok-behaviour"
            hint="A redirect URL on the Settings tab always wins over this."
          >
            <Select
              id="fd-ok-behaviour"
              value={design.success.behaviour}
              onChange={(event) =>
                setSection('success', {
                  ...design.success,
                  behaviour: event.target.value as FormDesign['success']['behaviour'],
                })
              }
            >
              {SUCCESS_BEHAVIOURS.map((value) => (
                <option key={value} value={value}>
                  {value === 'inline'
                    ? 'Show the message in place'
                    : value === 'replace'
                      ? 'Replace the form'
                      : 'Redirect'}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Heading" htmlFor="fd-ok-heading" hint="Optional, above the message.">
            <Input
              id="fd-ok-heading"
              value={design.success.heading}
              placeholder="Thank you"
              maxLength={120}
              onChange={(event) =>
                setSection('success', { ...design.success, heading: event.target.value })
              }
            />
          </Field>
        </div>

        <Switch
          checked={design.success.showIcon}
          onChange={(showIcon) => setSection('success', { ...design.success, showIcon })}
          label="Show a tick icon"
        />

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <ColorInput
            id="fd-ok-bg"
            label="Background"
            value={design.success.background}
            onChange={(background) => setSection('success', { ...design.success, background })}
          />
          <ColorInput
            id="fd-ok-text"
            label="Text colour"
            value={design.success.textColor}
            onChange={(textColor) => setSection('success', { ...design.success, textColor })}
          />
          <ColorInput
            id="fd-ok-heading-color"
            label="Heading colour"
            value={design.success.headingColor}
            onChange={(headingColor) => setSection('success', { ...design.success, headingColor })}
          />
        </div>

        <BoxInput
          label="Padding"
          idPrefix="fd-ok-padding"
          value={design.success.padding}
          onChange={(padding) => setSection('success', { ...design.success, padding })}
        />

        <BorderControls
          idPrefix="fd-ok"
          label="Border"
          value={design.success.border}
          onChange={(border) => setSection('success', { ...design.success, border })}
        />
      </DesignGroup>
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// Shared sub-controls
// ---------------------------------------------------------------------------

/**
 * Breakpoint switch.
 *
 * Sticky, because the spacing and typography groups are long and it must stay
 * obvious which screen size is being edited — changing a value on the wrong
 * breakpoint is the easiest mistake to make here.
 */
function BreakpointSwitch({
  value,
  onChange,
}: {
  value: Breakpoint;
  onChange: (next: Breakpoint) => void;
}) {
  return (
    <div className="sticky top-16 z-sticky -mx-1 mb-1 bg-surface/95 px-1 py-2 backdrop-blur">
      <SegmentedControl
        label="Breakpoint"
        fullWidth
        value={value}
        onChange={onChange}
        options={(Object.keys(BREAKPOINT_LABELS) as Breakpoint[]).map((key) => ({
          value: key,
          label: BREAKPOINT_LABELS[key],
        }))}
      />
      <p className="mt-1.5 px-1 text-xs text-muted">
        {value === 'desktop'
          ? 'Values set here apply everywhere unless a smaller screen overrides them.'
          : 'Leave a control empty to inherit the larger screen’s value.'}
      </p>
    </div>
  );
}

type BorderValue = FormDesign['container']['border'];

function BorderControls({
  idPrefix,
  label,
  value,
  onChange,
}: {
  idPrefix: string;
  label: string;
  value: BorderValue;
  onChange: (next: BorderValue) => void;
}) {
  return (
    <div className="rounded-lg border border-hairline p-3">
      <p className="mb-3 text-sm font-medium text-content">{label}</p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Style" htmlFor={`${idPrefix}-style`}>
          <Select
            id={`${idPrefix}-style`}
            value={value.style}
            onChange={(event) =>
              onChange({ ...value, style: event.target.value as BorderValue['style'] })
            }
          >
            <option value="none">None</option>
            <option value="solid">Solid</option>
            <option value="dashed">Dashed</option>
            <option value="dotted">Dotted</option>
          </Select>
        </Field>
        <Field label="Width" htmlFor={`${idPrefix}-width`}>
          <UnitInput
            id={`${idPrefix}-width`}
            value={value.width}
            onChange={(width) => onChange({ ...value, width })}
            placeholder="1px"
            aria-label={`${label} width`}
          />
        </Field>
        <ColorInput
          id={`${idPrefix}-color`}
          label="Colour"
          value={value.color}
          onChange={(color) => onChange({ ...value, color })}
        />
        <Field label="Corner radius" htmlFor={`${idPrefix}-radius`}>
          <UnitInput
            id={`${idPrefix}-radius`}
            value={value.radius}
            onChange={(radius) => onChange({ ...value, radius })}
            placeholder="8px"
            aria-label={`${label} radius`}
          />
        </Field>
      </div>
    </div>
  );
}

function TypographyControls({
  idPrefix,
  title,
  description,
  value,
  onChange,
}: {
  idPrefix: string;
  title: string;
  description?: string;
  value: Typography;
  onChange: (next: Typography) => void;
}) {
  return (
    <details className="rounded-lg border border-hairline">
      <summary className="cursor-pointer list-none px-3 py-2 text-sm font-medium text-content marker:content-['']">
        {title} typography
        {description ? (
          <span className="mt-0.5 block text-xs font-normal text-muted">{description}</span>
        ) : null}
      </summary>
      <div className="grid gap-4 border-t border-hairline p-3 sm:grid-cols-2 lg:grid-cols-3">
        <FontSelect
          id={`${idPrefix}-family`}
          label="Font"
          value={value.fontFamily}
          onChange={(fontFamily) => onChange({ ...value, fontFamily })}
          allowInherit
          inheritLabel="Inherit from the page"
        />
        <Field label="Size" htmlFor={`${idPrefix}-size`}>
          <UnitInput
            id={`${idPrefix}-size`}
            value={value.fontSize}
            onChange={(fontSize) => onChange({ ...value, fontSize })}
            placeholder="Inherit"
            aria-label={`${title} font size`}
          />
        </Field>
        <FontWeightSelect
          id={`${idPrefix}-weight`}
          label="Weight"
          family={value.fontFamily}
          value={value.fontWeight === null ? '' : String(value.fontWeight)}
          onChange={(weight) =>
            onChange({ ...value, fontWeight: weight ? Number(weight) : null })
          }
        />
        <Field label="Line height" htmlFor={`${idPrefix}-line`} hint="A number such as 1.5.">
          <Input
            id={`${idPrefix}-line`}
            value={value.lineHeight}
            placeholder="Inherit"
            maxLength={10}
            onChange={(event) => onChange({ ...value, lineHeight: event.target.value })}
          />
        </Field>
        <Field label="Letter spacing" htmlFor={`${idPrefix}-spacing`}>
          <UnitInput
            id={`${idPrefix}-spacing`}
            value={value.letterSpacing}
            onChange={(letterSpacing) => onChange({ ...value, letterSpacing })}
            placeholder="Normal"
            aria-label={`${title} letter spacing`}
          />
        </Field>
        <Field label="Capitalisation" htmlFor={`${idPrefix}-transform`}>
          <Select
            id={`${idPrefix}-transform`}
            value={value.textTransform}
            onChange={(event) =>
              onChange({ ...value, textTransform: event.target.value as Typography['textTransform'] })
            }
          >
            <option value="none">As typed</option>
            <option value="uppercase">UPPERCASE</option>
            <option value="lowercase">lowercase</option>
            <option value="capitalize">Capitalise Each Word</option>
          </Select>
        </Field>
        <ColorInput
          id={`${idPrefix}-color`}
          label="Colour"
          value={value.color}
          onChange={(color) => onChange({ ...value, color })}
        />
      </div>
    </details>
  );
}

type BackgroundValue = FormDesign['container']['background'];

/**
 * Container background.
 *
 * Image backgrounds reuse the media library's stored id, exactly as a section
 * background does, so an admin picks from the same library and nothing new has
 * to be uploaded or validated here.
 */
function BackgroundControls({
  value,
  onChange,
}: {
  value: BackgroundValue;
  onChange: (next: BackgroundValue) => void;
}) {
  return (
    <div className="rounded-lg border border-hairline p-3">
      <p className="mb-3 text-sm font-medium text-content">Background</p>
      <Field label="Type" htmlFor="fd-bg-type" className="mb-4">
        <Select
          id="fd-bg-type"
          value={value.type}
          onChange={(event) =>
            onChange({ ...value, type: event.target.value as BackgroundValue['type'] })
          }
        >
          <option value="none">Transparent</option>
          <option value="solid">Solid colour</option>
          <option value="gradient">Gradient</option>
          <option value="image">Image</option>
        </Select>
      </Field>

      {value.type === 'solid' ? (
        <ColorInput
          id="fd-bg-color"
          label="Colour"
          value={value.color}
          onChange={(color) => onChange({ ...value, color })}
        />
      ) : null}

      {value.type === 'gradient' ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <ColorInput
            id="fd-bg-from"
            label="From"
            value={value.gradientFrom}
            onChange={(gradientFrom) => onChange({ ...value, gradientFrom })}
          />
          <ColorInput
            id="fd-bg-to"
            label="To"
            value={value.gradientTo}
            onChange={(gradientTo) => onChange({ ...value, gradientTo })}
          />
          <Field label="Angle" htmlFor="fd-bg-angle" hint="0–360 degrees.">
            <Input
              id="fd-bg-angle"
              type="number"
              min={0}
              max={360}
              value={value.gradientAngle}
              onChange={(event) =>
                onChange({ ...value, gradientAngle: Number(event.target.value) || 0 })
              }
            />
          </Field>
        </div>
      ) : null}

      {value.type === 'image' ? (
        <p className="text-xs text-muted">
          Pick the image on the page section that hosts this form — a form’s own image background
          is applied from the section’s media picker, so there is one place to choose it.
        </p>
      ) : null}

      {value.type !== 'none' ? (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <ColorInput
            id="fd-bg-overlay"
            label="Overlay colour"
            value={value.overlayColor}
            onChange={(overlayColor) => onChange({ ...value, overlayColor })}
          />
          <Field label="Overlay opacity" htmlFor="fd-bg-overlay-op" hint="0–100.">
            <Input
              id="fd-bg-overlay-op"
              type="number"
              min={0}
              max={100}
              value={value.overlayOpacity}
              onChange={(event) =>
                onChange({ ...value, overlayOpacity: Number(event.target.value) || 0 })
              }
            />
          </Field>
        </div>
      ) : null}
    </div>
  );
}

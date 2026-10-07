'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { saveWebsiteSettings } from '@/lib/actions/settings';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { Field, Input, Textarea, Select, Switch } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { MediaUrlPicker } from './media-url-picker';
import { ColorField } from './color-field';
import { FontSelect, FontWeightSelect } from './font-select';
import { IconSelect } from '@/components/cms/icon-select';
import { Alert } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { Spinner } from '@/components/ui/icons';
import { SUPPORTED_CURRENCIES } from '@/lib/utils/money';
import { SegmentedControl } from '@/components/ui/segmented-control';

export type WebsiteSettingsValues = Record<string, string | boolean>;

const TABS = [
  { id: 'general', label: 'General' },
  { id: 'branding', label: 'Branding' },
  { id: 'theme', label: 'Colours' },
  { id: 'typography', label: 'Typography' },
  { id: 'design', label: 'Website design' },
  { id: 'header', label: 'Header' },
] as const;

type TabId = (typeof TABS)[number]['id'];


/** The button styles a header button may use. `danger` is deliberately absent. */
const BUTTON_VARIANTS = [
  { value: 'primary', label: 'Primary (filled)' },
  { value: 'secondary', label: 'Secondary' },
  { value: 'outline', label: 'Outline' },
  { value: 'ghost', label: 'Ghost' },
  { value: 'subtle', label: 'Subtle' },
  { value: 'link', label: 'Link' },
] as const;

/**
 * Website settings.
 *
 * `only` narrows the tab strip so the same form — and the same
 * `saveWebsiteSettings` action — can back both Settings and Website Design
 * without a second implementation. Hidden tabs still post their stored values,
 * so saving from one screen never wipes what the other screen owns.
 */
export function WebsiteSettingsForm({
  initial,
  canEdit,
  only,
  forms = [],
}: {
  initial: WebsiteSettingsValues;
  canEdit: boolean;
  only?: readonly TabId[];
  /** Active forms a setting can be pointed at. */
  forms?: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [values, setValues] = React.useState(initial);
  const [errors, setErrors] = React.useState<Record<string, string[]>>({});
  const [pending, setPending] = React.useState(false);
  const visibleTabs = React.useMemo(
    () => (only ? TABS.filter((entry) => only.includes(entry.id)) : TABS),
    [only],
  );
  const [tab, setTab] = React.useState<TabId>(visibleTabs[0]?.id ?? 'general');

  const str = (key: string) => String(values[key] ?? '');
  const bool = (key: string) => Boolean(values[key]);
  const set = (key: string, value: string | boolean) =>
    setValues((current) => ({ ...current, [key]: value }));

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setErrors({});

    const data = new FormData();
    for (const [key, value] of Object.entries(values)) data.set(key, String(value));

    const result = await saveWebsiteSettings(data);
    setPending(false);

    if (!result.ok) {
      setErrors(result.fieldErrors ?? {});
      toast(result.error, 'error');
      const firstError = Object.keys(result.fieldErrors ?? {})[0];
      if (firstError) {
        const target = tabForField(firstError);
        // Only switch to a tab this screen actually shows.
        if (visibleTabs.some((entry) => entry.id === target)) setTab(target);
      }
      return;
    }
    toast(result.message ?? 'Saved.');
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <form onSubmit={onSubmit}>
      {bool('maintenanceMode') ? (
        <Alert tone="warning" className="mb-5" title="Maintenance mode is on">
          The public site is still served, but this flag is available for your deployment to act on.
        </Alert>
      ) : null}

      <Card>
        <div className="border-b border-hairline px-3 pt-1">
          <SegmentedControl
            semantics="tabs"
            variant="underline"
            label="Settings sections"
            idPrefix="settings-tab-"
            panelId={() => 'settings-panel'}
            className="border-b-0"
            value={tab}
            onChange={setTab}
            options={visibleTabs.map((t) => ({ value: t.id, label: t.label }))}
          />
        </div>

        <CardBody
          className="space-y-4"
          id="settings-panel"
          role="tabpanel"
          aria-labelledby={`settings-tab-${tab}`}
        >
          <fieldset disabled={!canEdit || pending} className="space-y-4">
            {tab === 'general' ? (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Website name" htmlFor="siteName" required error={errors.siteName}>
                    <Input
                      id="siteName"
                      value={str('siteName')}
                      onChange={(e) => set('siteName', e.target.value)}
                    />
                  </Field>
                  <Field
                    label="Website URL"
                    htmlFor="siteUrl"
                    required
                    error={errors.siteUrl}
                    hint="Used for canonical URLs and the sitemap."
                  >
                    <Input
                      id="siteUrl"
                      value={str('siteUrl')}
                      onChange={(e) => set('siteUrl', e.target.value)}
                    />
                  </Field>
                </div>

                <Field
                  label="Website title"
                  htmlFor="siteTitle"
                  hint="A short tagline used alongside the name."
                >
                  <Input
                    id="siteTitle"
                    value={str('siteTitle')}
                    onChange={(e) => set('siteTitle', e.target.value)}
                  />
                </Field>

                <Field label="Description" htmlFor="siteDescription">
                  <Textarea
                    id="siteDescription"
                    rows={3}
                    value={str('siteDescription')}
                    onChange={(e) => set('siteDescription', e.target.value)}
                  />
                </Field>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    label="Contact email"
                    htmlFor="contactEmail"
                    hint="Receives lead notifications when no sales address is set."
                  >
                    <Input
                      id="contactEmail"
                      type="email"
                      value={str('contactEmail')}
                      onChange={(e) => set('contactEmail', e.target.value)}
                    />
                  </Field>
                  <Field label="Contact phone" htmlFor="contactPhone">
                    <Input
                      id="contactPhone"
                      value={str('contactPhone')}
                      onChange={(e) => set('contactPhone', e.target.value)}
                    />
                  </Field>
                  <Field label="WhatsApp number" htmlFor="whatsappNumber">
                    <Input
                      id="whatsappNumber"
                      value={str('whatsappNumber')}
                      onChange={(e) => set('whatsappNumber', e.target.value)}
                    />
                  </Field>
                  <Field label="Default currency" htmlFor="defaultCurrency">
                    <Select
                      id="defaultCurrency"
                      value={str('defaultCurrency')}
                      onChange={(e) => set('defaultCurrency', e.target.value)}
                    >
                      {SUPPORTED_CURRENCIES.map((code) => (
                        <option key={code} value={code}>
                          {code}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>

                <Field label="Address" htmlFor="address">
                  <Textarea
                    id="address"
                    rows={2}
                    value={str('address')}
                    onChange={(e) => set('address', e.target.value)}
                  />
                </Field>

                <fieldset className="space-y-4 rounded-lg border border-hairline p-4">
                  <legend className="px-1 text-sm font-medium text-content">Social profiles</legend>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {[
                      ['linkedinUrl', 'LinkedIn'],
                      ['twitterUrl', 'X / Twitter'],
                      ['facebookUrl', 'Facebook'],
                      ['instagramUrl', 'Instagram'],
                      ['youtubeUrl', 'YouTube'],
                    ].map(([key, label]) => (
                      <Field key={key} label={label!} htmlFor={key}>
                        <Input
                          id={key}
                          value={str(key!)}
                          placeholder="https://"
                          onChange={(e) => set(key!, e.target.value)}
                        />
                      </Field>
                    ))}
                  </div>
                </fieldset>

                <div className="rounded-lg border border-hairline p-4">
                  <Switch
                    checked={bool('maintenanceMode')}
                    onChange={(next) => set('maintenanceMode', next)}
                    label="Maintenance mode"
                    hint="A flag your deployment can use to show a holding page."
                  />
                </div>
              </>
            ) : null}

            {tab === 'branding' ? (
              <>
                <MediaUrlPicker
                  label="Logo"
                  value={str('logoUrl')}
                  onChange={(v) => set('logoUrl', v)}
                  hint="Shown in the header, the admin sidebar and the sign-in page."
                />
                <MediaUrlPicker
                  label="Logo for dark backgrounds"
                  value={str('logoDarkUrl')}
                  onChange={(v) => set('logoDarkUrl', v)}
                  hint="Used in the footer. Falls back to the main logo."
                />
                <MediaUrlPicker
                  label="Favicon"
                  value={str('faviconUrl')}
                  onChange={(v) => set('faviconUrl', v)}
                  hint="A square PNG or ICO, at least 32×32."
                />
                <MediaUrlPicker
                  label="Default social share image"
                  value={str('ogImageUrl')}
                  onChange={(v) => set('ogImageUrl', v)}
                  hint="Recommended 1200×630."
                />
              </>
            ) : null}

            {tab === 'theme' ? (
              <>
                <fieldset className="space-y-4 rounded-lg border border-hairline p-4">
                  <legend className="px-1 text-sm font-medium text-content">Colours</legend>
                  <p className="text-xs text-muted">
                    These become CSS variables used across the whole site — buttons, links, headings
                    and borders all follow them. Any section can override them in its own Design
                    panel.
                  </p>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <ColorField
                      label="Primary"
                      name="colorPrimary"
                      allowOpacity={false}
                      value={str('colorPrimary')}
                      error={errors.colorPrimary}
                      onChange={(v) => set('colorPrimary', v)}
                    />
                    <ColorField
                      label="Secondary"
                      name="colorSecondary"
                      allowOpacity={false}
                      value={str('colorSecondary')}
                      error={errors.colorSecondary}
                      onChange={(v) => set('colorSecondary', v)}
                    />
                    <ColorField
                      label="Accent"
                      name="colorAccent1"
                      allowOpacity={false}
                      value={str('colorAccent1')}
                      error={errors.colorAccent1}
                      onChange={(v) => set('colorAccent1', v)}
                    />
                    <ColorField
                      label="Accent 2"
                      name="colorAccent2"
                      allowOpacity={false}
                      value={str('colorAccent2')}
                      error={errors.colorAccent2}
                      onChange={(v) => set('colorAccent2', v)}
                    />
                    <ColorField
                      label="Background"
                      name="colorBackground"
                      allowOpacity={false}
                      value={str('colorBackground')}
                      error={errors.colorBackground}
                      onChange={(v) => set('colorBackground', v)}
                    />
                    <ColorField
                      label="Text"
                      name="colorText"
                      allowOpacity={false}
                      value={str('colorText')}
                      error={errors.colorText}
                      onChange={(v) => set('colorText', v)}
                    />
                    <ColorField
                      label="Muted text"
                      name="colorMuted"
                      allowOpacity={false}
                      value={str('colorMuted')}
                      error={errors.colorMuted}
                      onChange={(v) => set('colorMuted', v)}
                    />
                    <ColorField
                      label="Borders"
                      name="colorBorder"
                      allowOpacity={false}
                      value={str('colorBorder')}
                      error={errors.colorBorder}
                      onChange={(v) => set('colorBorder', v)}
                    />
                  </div>

                  <div
                    className="rounded-lg border p-4"
                    style={{
                      background: str('colorBackground'),
                      borderColor: str('colorBorder'),
                    }}
                  >
                    <p className="text-sm font-semibold" style={{ color: str('colorText') }}>
                      Preview
                    </p>
                    <p className="mt-1 text-xs" style={{ color: str('colorMuted') }}>
                      Supporting copy uses the muted colour.
                    </p>
                    <span
                      className="mt-3 inline-flex text-xs font-medium text-white"
                      style={{
                        background: str('colorPrimary'),
                        borderRadius: str('buttonRadius') || '0.5rem',
                        padding: `${str('buttonPaddingY') || '0.625rem'} ${str('buttonPaddingX') || '1.25rem'}`,
                      }}
                    >
                      Primary button
                    </span>
                  </div>
                </fieldset>
              </>
            ) : null}

            {tab === 'typography' ? (
              <>
                <p className="text-sm text-muted">
                  Pick any Google Font. Only the families and weights chosen here are downloaded by
                  the website — nothing else from the catalogue is bundled or requested.
                </p>

                <fieldset className="space-y-4 rounded-lg border border-hairline p-4">
                  <legend className="px-1 text-sm font-medium text-content">Fonts</legend>

                  <FontSelect
                    id="bodyFont"
                    label="Body font"
                    value={str('bodyFont')}
                    onChange={(v) => set('bodyFont', v)}
                    hint="Used for all body copy, and as the fallback for navigation and buttons."
                  />
                  <FontSelect
                    id="headingFont"
                    label="Heading font"
                    value={str('headingFont')}
                    onChange={(v) => set('headingFont', v)}
                  />
                  <FontSelect
                    id="navFont"
                    label="Navigation font"
                    value={str('navFont')}
                    onChange={(v) => set('navFont', v)}
                    allowInherit
                  />
                  <FontSelect
                    id="buttonFont"
                    label="Button font"
                    value={str('buttonFont')}
                    onChange={(v) => set('buttonFont', v)}
                    allowInherit
                  />
                </fieldset>

                <fieldset className="space-y-4 rounded-lg border border-hairline p-4">
                  <legend className="px-1 text-sm font-medium text-content">Weights</legend>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FontWeightSelect
                      id="bodyWeight"
                      label="Body weight"
                      family={str('bodyFont')}
                      value={str('bodyWeight')}
                      error={errors.bodyWeight}
                      onChange={(v) => set('bodyWeight', v)}
                    />
                    <FontWeightSelect
                      id="headingWeight"
                      label="Heading weight"
                      family={str('headingFont')}
                      value={str('headingWeight')}
                      error={errors.headingWeight}
                      onChange={(v) => set('headingWeight', v)}
                    />
                    <FontWeightSelect
                      id="navWeight"
                      label="Navigation weight"
                      family={str('navFont') || str('bodyFont')}
                      value={str('navWeight')}
                      error={errors.navWeight}
                      onChange={(v) => set('navWeight', v)}
                    />
                    <FontWeightSelect
                      id="buttonWeight"
                      label="Button weight"
                      family={str('buttonFont') || str('bodyFont')}
                      value={str('buttonWeight')}
                      error={errors.buttonWeight}
                      onChange={(v) => set('buttonWeight', v)}
                    />
                  </div>
                </fieldset>

                <fieldset className="space-y-4 rounded-lg border border-hairline p-4">
                  <legend className="px-1 text-sm font-medium text-content">Sizing</legend>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <Field
                      label="Base size"
                      htmlFor="baseFontSize"
                      error={errors.baseFontSize}
                      hint="Scales the whole site."
                    >
                      <Input
                        id="baseFontSize"
                        value={str('baseFontSize')}
                        placeholder="16px"
                        onChange={(e) => set('baseFontSize', e.target.value)}
                      />
                    </Field>
                    <Field
                      label="Base size — tablet"
                      htmlFor="baseFontSizeTablet"
                      error={errors.baseFontSizeTablet}
                      hint="Blank inherits desktop."
                    >
                      <Input
                        id="baseFontSizeTablet"
                        value={str('baseFontSizeTablet')}
                        placeholder="inherit"
                        onChange={(e) => set('baseFontSizeTablet', e.target.value)}
                      />
                    </Field>
                    <Field
                      label="Base size — mobile"
                      htmlFor="baseFontSizeMobile"
                      error={errors.baseFontSizeMobile}
                      hint="Blank inherits tablet."
                    >
                      <Input
                        id="baseFontSizeMobile"
                        value={str('baseFontSizeMobile')}
                        placeholder="inherit"
                        onChange={(e) => set('baseFontSizeMobile', e.target.value)}
                      />
                    </Field>

                    <Field label="Navigation size" htmlFor="navFontSize" error={errors.navFontSize}>
                      <Input
                        id="navFontSize"
                        value={str('navFontSize')}
                        placeholder="0.9375rem"
                        onChange={(e) => set('navFontSize', e.target.value)}
                      />
                    </Field>
                    <Field
                      label="Button size"
                      htmlFor="buttonFontSize"
                      error={errors.buttonFontSize}
                    >
                      <Input
                        id="buttonFontSize"
                        value={str('buttonFontSize')}
                        placeholder="0.875rem"
                        onChange={(e) => set('buttonFontSize', e.target.value)}
                      />
                    </Field>
                  </div>
                </fieldset>

                <fieldset className="space-y-4 rounded-lg border border-hairline p-4">
                  <legend className="px-1 text-sm font-medium text-content">
                    Line height & letter spacing
                  </legend>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field
                      label="Heading line height"
                      htmlFor="headingLineHeight"
                      error={errors.headingLineHeight}
                    >
                      <Input
                        id="headingLineHeight"
                        value={str('headingLineHeight')}
                        placeholder="1.15"
                        onChange={(e) => set('headingLineHeight', e.target.value)}
                      />
                    </Field>
                    <Field
                      label="Body line height"
                      htmlFor="bodyLineHeight"
                      error={errors.bodyLineHeight}
                    >
                      <Input
                        id="bodyLineHeight"
                        value={str('bodyLineHeight')}
                        placeholder="1.6"
                        onChange={(e) => set('bodyLineHeight', e.target.value)}
                      />
                    </Field>
                    <Field
                      label="Heading letter spacing"
                      htmlFor="headingLetterSpacing"
                      error={errors.headingLetterSpacing}
                    >
                      <Input
                        id="headingLetterSpacing"
                        value={str('headingLetterSpacing')}
                        placeholder="-0.02em"
                        onChange={(e) => set('headingLetterSpacing', e.target.value)}
                      />
                    </Field>
                    <Field
                      label="Body letter spacing"
                      htmlFor="bodyLetterSpacing"
                      error={errors.bodyLetterSpacing}
                    >
                      <Input
                        id="bodyLetterSpacing"
                        value={str('bodyLetterSpacing')}
                        placeholder="0em"
                        onChange={(e) => set('bodyLetterSpacing', e.target.value)}
                      />
                    </Field>
                  </div>
                </fieldset>

                <div
                  className="rounded-lg border border-hairline p-5"
                  style={{
                    fontFamily: `'${str('bodyFont')}', system-ui, sans-serif`,
                  }}
                >
                  <p
                    className="text-2xl"
                    style={{
                      fontFamily: `'${str('headingFont')}', system-ui, sans-serif`,
                      fontWeight: Number(str('headingWeight')) || 700,
                      lineHeight: str('headingLineHeight') || '1.15',
                      letterSpacing: str('headingLetterSpacing') || '-0.02em',
                    }}
                  >
                    The quick brown fox jumps
                  </p>
                  <p
                    className="mt-2 text-sm text-muted"
                    style={{
                      fontWeight: Number(str('bodyWeight')) || 400,
                      lineHeight: str('bodyLineHeight') || '1.6',
                      letterSpacing: str('bodyLetterSpacing') || '0em',
                    }}
                  >
                    Body copy preview. Save to load the chosen fonts and see them exactly as
                    visitors will.
                  </p>
                </div>
              </>
            ) : null}

            {tab === 'design' ? (
              <>
                <p className="text-sm text-muted">
                  Site-wide defaults. Every CMS section can override these in its own Design panel.
                </p>

                <fieldset className="space-y-4 rounded-lg border border-hairline p-4">
                  <legend className="px-1 text-sm font-medium text-content">Layout</legend>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field
                      label="Container width"
                      htmlFor="containerWidth"
                      error={errors.containerWidth}
                      hint="The default boxed width for sections."
                    >
                      <Input
                        id="containerWidth"
                        value={str('containerWidth')}
                        placeholder="72rem"
                        onChange={(e) => set('containerWidth', e.target.value)}
                      />
                    </Field>
                    <Field
                      label="Side padding"
                      htmlFor="containerPadding"
                      error={errors.containerPadding}
                    >
                      <Input
                        id="containerPadding"
                        value={str('containerPadding')}
                        placeholder="1.5rem"
                        onChange={(e) => set('containerPadding', e.target.value)}
                      />
                    </Field>
                    <Field
                      label="Section spacing"
                      htmlFor="sectionSpacing"
                      error={errors.sectionSpacing}
                      hint="Default padding above and below a section."
                    >
                      <Input
                        id="sectionSpacing"
                        value={str('sectionSpacing')}
                        placeholder="5rem"
                        onChange={(e) => set('sectionSpacing', e.target.value)}
                      />
                    </Field>
                    <Field
                      label="Section spacing — mobile"
                      htmlFor="sectionSpacingMobile"
                      error={errors.sectionSpacingMobile}
                    >
                      <Input
                        id="sectionSpacingMobile"
                        value={str('sectionSpacingMobile')}
                        placeholder="3rem"
                        onChange={(e) => set('sectionSpacingMobile', e.target.value)}
                      />
                    </Field>
                    <Field label="Border radius" htmlFor="borderRadius" error={errors.borderRadius}>
                      <Input
                        id="borderRadius"
                        value={str('borderRadius')}
                        placeholder="0.75rem"
                        onChange={(e) => set('borderRadius', e.target.value)}
                      />
                    </Field>
                    <Field label="Card radius" htmlFor="cardRadius" error={errors.cardRadius}>
                      <Input
                        id="cardRadius"
                        value={str('cardRadius')}
                        placeholder="1rem"
                        onChange={(e) => set('cardRadius', e.target.value)}
                      />
                    </Field>
                  </div>
                </fieldset>

                <fieldset className="space-y-4 rounded-lg border border-hairline p-4">
                  <legend className="px-1 text-sm font-medium text-content">Buttons</legend>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Primary button style" htmlFor="buttonPrimaryStyle">
                      <Select
                        id="buttonPrimaryStyle"
                        value={str('buttonPrimaryStyle')}
                        onChange={(e) => set('buttonPrimaryStyle', e.target.value)}
                      >
                        <option value="solid">Solid</option>
                        <option value="outline">Outline</option>
                        <option value="soft">Soft tint</option>
                      </Select>
                    </Field>
                    <Field label="Secondary button style" htmlFor="buttonSecondaryStyle">
                      <Select
                        id="buttonSecondaryStyle"
                        value={str('buttonSecondaryStyle')}
                        onChange={(e) => set('buttonSecondaryStyle', e.target.value)}
                      >
                        <option value="solid">Solid</option>
                        <option value="outline">Outline</option>
                        <option value="soft">Soft tint</option>
                      </Select>
                    </Field>
                    <Field label="Button radius" htmlFor="buttonRadius" error={errors.buttonRadius}>
                      <Input
                        id="buttonRadius"
                        value={str('buttonRadius')}
                        placeholder="0.5rem"
                        onChange={(e) => set('buttonRadius', e.target.value)}
                      />
                    </Field>
                    <Field label="Text transform" htmlFor="buttonTextTransform">
                      <Select
                        id="buttonTextTransform"
                        value={str('buttonTextTransform')}
                        onChange={(e) => set('buttonTextTransform', e.target.value)}
                      >
                        <option value="none">Normal</option>
                        <option value="uppercase">UPPERCASE</option>
                        <option value="capitalize">Capitalise</option>
                      </Select>
                    </Field>
                    <Field
                      label="Horizontal padding"
                      htmlFor="buttonPaddingX"
                      error={errors.buttonPaddingX}
                    >
                      <Input
                        id="buttonPaddingX"
                        value={str('buttonPaddingX')}
                        placeholder="1.25rem"
                        onChange={(e) => set('buttonPaddingX', e.target.value)}
                      />
                    </Field>
                    <Field
                      label="Vertical padding"
                      htmlFor="buttonPaddingY"
                      error={errors.buttonPaddingY}
                    >
                      <Input
                        id="buttonPaddingY"
                        value={str('buttonPaddingY')}
                        placeholder="0.625rem"
                        onChange={(e) => set('buttonPaddingY', e.target.value)}
                      />
                    </Field>
                  </div>
                </fieldset>
              </>
            ) : null}

            {tab === 'header' ? (
              <>
                <Alert tone="info">
                  Every size and colour on this tab may be left blank, and blank means “leave it
                  as it is”. Nothing here changes the header until you fill it in.
                </Alert>

                <fieldset className="space-y-4 rounded-lg border border-hairline p-4">
                  <legend className="px-1 text-sm font-medium text-content">Bar</legend>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Height" htmlFor="headerHeight" hint="Default 4rem.">
                      <Input
                        id="headerHeight"
                        value={str('headerHeight')}
                        placeholder="4rem"
                        onChange={(e) => set('headerHeight', e.target.value)}
                      />
                    </Field>
                    <Field label="Height on phones" htmlFor="headerHeightMobile">
                      <Input
                        id="headerHeightMobile"
                        value={str('headerHeightMobile')}
                        placeholder="Same as above"
                        onChange={(e) => set('headerHeightMobile', e.target.value)}
                      />
                    </Field>
                    <Field label="Content width" htmlFor="headerWidth" hint="Default 80rem.">
                      <Input
                        id="headerWidth"
                        value={str('headerWidth')}
                        placeholder="80rem"
                        onChange={(e) => set('headerWidth', e.target.value)}
                      />
                    </Field>
                    <Field label="Shadow" htmlFor="headerShadow">
                      <Select
                        id="headerShadow"
                        value={str('headerShadow') || 'none'}
                        onChange={(e) => set('headerShadow', e.target.value)}
                      >
                        <option value="none">None</option>
                        <option value="sm">Subtle</option>
                        <option value="md">Medium</option>
                        <option value="lg">Strong</option>
                      </Select>
                    </Field>
                    <ColorField
                      label="Background"
                      name="headerBg"
                      value={str('headerBg')}
                      onChange={(v) => set('headerBg', v)}
                    />
                    <ColorField
                      label="Text"
                      name="headerText"
                      value={str('headerText')}
                      onChange={(v) => set('headerText', v)}
                    />
                    <ColorField
                      label="Link on hover"
                      name="headerLinkHover"
                      value={str('headerLinkHover')}
                      onChange={(v) => set('headerLinkHover', v)}
                    />
                    <ColorField
                      label="Current page link"
                      name="headerLinkActive"
                      value={str('headerLinkActive')}
                      onChange={(v) => set('headerLinkActive', v)}
                    />
                    <ColorField
                      label="Bottom border"
                      name="headerBorderColor"
                      value={str('headerBorderColor')}
                      onChange={(v) => set('headerBorderColor', v)}
                    />
                  </div>
                  <Switch
                    checked={str('headerBorder') !== 'false'}
                    onChange={(next) => set('headerBorder', next)}
                    label="Draw the line under the header"
                  />
                  <Switch
                    checked={str('headerSticky') !== 'false'}
                    onChange={(next) => set('headerSticky', next)}
                    label="Keep the header on screen while scrolling"
                  />
                </fieldset>

                <fieldset className="space-y-4 rounded-lg border border-hairline p-4">
                  <legend className="px-1 text-sm font-medium text-content">Glass</legend>
                  <p className="text-xs text-muted">
                    How the header treats what scrolls under it. Leave both blank to keep the
                    slight blur it already has. Glass only shows through a background that is
                    partly transparent — set the background colour above with an opacity below
                    100%.
                  </p>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field
                      label="Blur"
                      htmlFor="headerBlur"
                      hint="Up to 40px. 16px–24px is the usual glass look."
                    >
                      <Input
                        id="headerBlur"
                        value={str('headerBlur')}
                        placeholder="8px"
                        onChange={(e) => set('headerBlur', e.target.value)}
                      />
                    </Field>
                    <Field
                      label="Saturation"
                      htmlFor="headerSaturate"
                      hint="Above 100% stops a blurred backdrop looking washed out."
                    >
                      <Input
                        id="headerSaturate"
                        value={str('headerSaturate')}
                        placeholder="140%"
                        onChange={(e) => set('headerSaturate', e.target.value)}
                      />
                    </Field>
                  </div>
                  <Switch
                    checked={str('headerGlassEdge') === 'true'}
                    onChange={(next) => set('headerGlassEdge', next)}
                    label="Light along the top edge"
                    hint="The hairline that makes glass read as glass rather than as a translucent rectangle."
                  />
                </fieldset>

                <fieldset className="space-y-3 rounded-lg border border-hairline p-4">
                  <legend className="px-1 text-sm font-medium text-content">
                    What the header shows
                  </legend>
                  <Switch
                    checked={str('headerShowLogo') !== 'false'}
                    onChange={(next) => set('headerShowLogo', next)}
                    label="Logo"
                    hint="Switched off, the site name stands in — a home link with nothing in it is not a link."
                  />
                  <Switch
                    checked={str('headerShowSiteName') !== 'false'}
                    onChange={(next) => set('headerShowSiteName', next)}
                    label="Site name beside the mark"
                    hint="Only shown when there is no logo."
                  />
                  <Switch
                    checked={str('headerShowMenu') !== 'false'}
                    onChange={(next) => set('headerShowMenu', next)}
                    label="Menu"
                  />
                  <Switch
                    checked={str('headerShowMarkets') !== 'false'}
                    onChange={(next) => set('headerShowMarkets', next)}
                    label="Country switcher"
                  />
                </fieldset>

                <fieldset className="space-y-4 rounded-lg border border-hairline p-4">
                  <legend className="px-1 text-sm font-medium text-content">Logo</legend>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Logo height" htmlFor="headerLogoHeight" hint="Default 2rem.">
                      <Input
                        id="headerLogoHeight"
                        value={str('headerLogoHeight')}
                        placeholder="2rem"
                        onChange={(e) => set('headerLogoHeight', e.target.value)}
                      />
                    </Field>
                    <Field label="Logo height on phones" htmlFor="headerLogoHeightMobile">
                      <Input
                        id="headerLogoHeightMobile"
                        value={str('headerLogoHeightMobile')}
                        placeholder="Same as above"
                        onChange={(e) => set('headerLogoHeightMobile', e.target.value)}
                      />
                    </Field>
                    <Field
                      label="Maximum logo width"
                      htmlFor="headerLogoMaxWidth"
                      hint="Default 10rem."
                    >
                      <Input
                        id="headerLogoMaxWidth"
                        value={str('headerLogoMaxWidth')}
                        placeholder="10rem"
                        onChange={(e) => set('headerLogoMaxWidth', e.target.value)}
                      />
                    </Field>
                  </div>
                </fieldset>

                <fieldset className="space-y-4 rounded-lg border border-hairline p-4">
                  <legend className="px-1 text-sm font-medium text-content">Menu</legend>
                  <Field
                    label="Menu alignment"
                    htmlFor="headerMenuAlign"
                    hint="Where the menu sits between the logo and the header buttons. On phones the menu is a drawer, so this applies from large screens up."
                  >
                    <Select
                      id="headerMenuAlign"
                      value={str('headerMenuAlign') || 'left'}
                      onChange={(e) => set('headerMenuAlign', e.target.value)}
                    >
                      <option value="left">Left, next to the logo</option>
                      <option value="center">Centred</option>
                      <option value="right">Right, beside the buttons</option>
                    </Select>
                  </Field>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Space between items" htmlFor="headerMenuGap">
                      <Input
                        id="headerMenuGap"
                        value={str('headerMenuGap')}
                        placeholder="0.25rem"
                        onChange={(e) => set('headerMenuGap', e.target.value)}
                      />
                    </Field>
                    <Field label="Menu text size" htmlFor="headerMenuSize">
                      <Input
                        id="headerMenuSize"
                        value={str('headerMenuSize')}
                        placeholder="From Typography"
                        onChange={(e) => set('headerMenuSize', e.target.value)}
                      />
                    </Field>
                    <Field label="Menu text weight" htmlFor="headerMenuWeight">
                      <Select
                        id="headerMenuWeight"
                        value={str('headerMenuWeight')}
                        onChange={(e) => set('headerMenuWeight', e.target.value)}
                      >
                        <option value="">From Typography</option>
                        {[300, 400, 500, 600, 700, 800].map((weight) => (
                          <option key={weight} value={String(weight)}>
                            {weight}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Menu capitalisation" htmlFor="headerMenuTransform">
                      <Select
                        id="headerMenuTransform"
                        value={str('headerMenuTransform') || 'none'}
                        onChange={(e) => set('headerMenuTransform', e.target.value)}
                      >
                        <option value="none">As typed</option>
                        <option value="uppercase">UPPERCASE</option>
                        <option value="capitalize">Capitalise Each Word</option>
                        <option value="lowercase">lowercase</option>
                      </Select>
                    </Field>
                  </div>
                  <p className="text-xs text-muted">
                    A mega menu is switched on per menu item, in Navigation.
                  </p>
                </fieldset>

                <fieldset className="space-y-4 rounded-lg border border-hairline p-4">
                  <legend className="px-1 text-sm font-medium text-content">
                    Announcement bar
                  </legend>
                  <Switch
                    checked={bool('announcementEnabled')}
                    onChange={(next) => set('announcementEnabled', next)}
                    label="Show the announcement bar"
                  />
                  <Field label="Announcement text" htmlFor="announcementText">
                    <Input
                      id="announcementText"
                      value={str('announcementText')}
                      onChange={(e) => set('announcementText', e.target.value)}
                    />
                  </Field>
                  <Field label="Announcement link" htmlFor="announcementUrl">
                    <Input
                      id="announcementUrl"
                      value={str('announcementUrl')}
                      placeholder="/contact"
                      onChange={(e) => set('announcementUrl', e.target.value)}
                    />
                  </Field>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <ColorField
                      label="Announcement background"
                      name="announcementBgColor"
                      value={str('announcementBgColor')}
                      onChange={(v) => set('announcementBgColor', v)}
                    />
                    <ColorField
                      label="Announcement text"
                      name="announcementTextColor"
                      value={str('announcementTextColor')}
                      onChange={(v) => set('announcementTextColor', v)}
                    />
                  </div>
                </fieldset>

                <fieldset className="space-y-4 rounded-lg border border-hairline p-4">
                  <legend className="px-1 text-sm font-medium text-content">Header buttons</legend>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Primary button label" htmlFor="headerCtaLabel">
                      <Input
                        id="headerCtaLabel"
                        value={str('headerCtaLabel')}
                        onChange={(e) => set('headerCtaLabel', e.target.value)}
                      />
                    </Field>
                    <Field label="Primary button link" htmlFor="headerCtaUrl">
                      <Input
                        id="headerCtaUrl"
                        value={str('headerCtaUrl')}
                        placeholder="/contact"
                        onChange={(e) => set('headerCtaUrl', e.target.value)}
                      />
                    </Field>
                    <Field label="Secondary button label" htmlFor="headerSecondaryCtaLabel">
                      <Input
                        id="headerSecondaryCtaLabel"
                        value={str('headerSecondaryCtaLabel')}
                        onChange={(e) => set('headerSecondaryCtaLabel', e.target.value)}
                      />
                    </Field>
                    <Field label="Secondary button link" htmlFor="headerSecondaryCtaUrl">
                      <Input
                        id="headerSecondaryCtaUrl"
                        value={str('headerSecondaryCtaUrl')}
                        onChange={(e) => set('headerSecondaryCtaUrl', e.target.value)}
                      />
                    </Field>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Primary button style" htmlFor="headerCtaVariant">
                      <Select
                        id="headerCtaVariant"
                        value={str('headerCtaVariant') || 'primary'}
                        onChange={(e) => set('headerCtaVariant', e.target.value)}
                      >
                        {BUTTON_VARIANTS.map((variant) => (
                          <option key={variant.value} value={variant.value}>
                            {variant.label}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Primary button icon side" htmlFor="headerCtaIconSide">
                      <Select
                        id="headerCtaIconSide"
                        value={str('headerCtaIconSide') || 'left'}
                        onChange={(e) => set('headerCtaIconSide', e.target.value)}
                      >
                        <option value="left">Before the label</option>
                        <option value="right">After the label</option>
                      </Select>
                    </Field>
                  </div>
                  <Field label="Primary button icon" htmlFor="headerCtaIcon">
                    <IconSelect
                      id="headerCtaIcon"
                      value={str('headerCtaIcon')}
                      onChange={(v) => set('headerCtaIcon', v)}
                    />
                  </Field>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Secondary button style" htmlFor="headerSecondaryCtaVariant">
                      <Select
                        id="headerSecondaryCtaVariant"
                        value={str('headerSecondaryCtaVariant') || 'ghost'}
                        onChange={(e) => set('headerSecondaryCtaVariant', e.target.value)}
                      >
                        {BUTTON_VARIANTS.map((variant) => (
                          <option key={variant.value} value={variant.value}>
                            {variant.label}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Secondary button icon side" htmlFor="headerSecondaryCtaIconSide">
                      <Select
                        id="headerSecondaryCtaIconSide"
                        value={str('headerSecondaryCtaIconSide') || 'left'}
                        onChange={(e) => set('headerSecondaryCtaIconSide', e.target.value)}
                      >
                        <option value="left">Before the label</option>
                        <option value="right">After the label</option>
                      </Select>
                    </Field>
                  </div>
                  <Field label="Secondary button icon" htmlFor="headerSecondaryCtaIcon">
                    <IconSelect
                      id="headerSecondaryCtaIcon"
                      value={str('headerSecondaryCtaIcon')}
                      onChange={(v) => set('headerSecondaryCtaIcon', v)}
                    />
                  </Field>
                </fieldset>
              </>
            ) : null}

          </fieldset>
        </CardBody>

        {canEdit ? (
          <div className="flex justify-end border-t border-hairline bg-muted/[0.03] px-4 py-3 sm:px-5">
            <Button type="submit" disabled={pending}>
              {pending ? (
                <>
                  <Spinner className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Saving…
                </>
              ) : (
                'Save settings'
              )}
            </Button>
          </div>
        ) : null}
      </Card>
      </form>
    </div>
  );
}

function tabForField(field: string): TabId {
  /*
   * The header prefixes are matched first, ahead of the typography and design
   * rules below: `headerMenuWeight` belongs to the header, not to the tabs
   * whose looser patterns would also claim it, and a validation error has to
   * open the tab its field is actually on.
   */
  if (field.startsWith('announcement') || field.startsWith('header')) return 'header';
  if (field.startsWith('color')) return 'theme';
  if (
    field.includes('Font') ||
    field.includes('Weight') ||
    field.includes('LineHeight') ||
    field.includes('LetterSpacing') ||
    field.startsWith('headingScale')
  ) {
    return 'typography';
  }
  if (
    field.startsWith('container') ||
    field.startsWith('section') ||
    field.endsWith('Radius') ||
    field.startsWith('button')
  ) {
    return 'design';
  }
  if (field.startsWith('logo') || field.startsWith('favicon') || field.startsWith('ogImage'))
    return 'branding';
  return 'general';
}

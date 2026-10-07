'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createPage, updatePage } from '@/lib/actions/pages';
import { Field, Input, Textarea, Select, Switch } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { MediaPicker } from '@/components/admin/media-picker';
import { PrimaryKeywordsFields } from '@/components/admin/seo/primary-keywords-fields';
import { SeoScorePanel } from '@/components/admin/seo/seo-score-panel';
import { jumpResolver } from '@/components/admin/seo/jump';
import { usePageEditorTabs } from '@/components/admin/pages/page-editor-tabs';
import { useToast } from '@/components/ui/toast';
import { Spinner } from '@/components/ui/icons';
import { pageSlug } from '@/lib/utils/slug';
import { cn } from '@/lib/utils/cn';

export type PageFormValues = {
  id?: string;
  title: string;
  slug: string;
  status: string;
  /** Empty means uncategorised. */
  categoryId: string;
  publishedAt: string;
  isHomepage: boolean;
  showHeader: boolean;
  showFooter: boolean;
  seoTitle: string;
  seoDescription: string;
  canonicalUrl: string;
  noIndex: boolean;
  noFollow: boolean;
  ogTitle: string;
  ogDescription: string;
  ogImageId: string | null;
  twitterTitle: string;
  twitterDescription: string;
  twitterImageId: string | null;
  primaryKeyword1: string;
  primaryKeyword2: string;
  primaryKeyword3: string;
};

export const EMPTY_PAGE: PageFormValues = {
  title: '',
  slug: '',
  status: 'DRAFT',
  categoryId: '',
  publishedAt: '',
  isHomepage: false,
  showHeader: true,
  showFooter: true,
  seoTitle: '',
  seoDescription: '',
  canonicalUrl: '',
  noIndex: false,
  noFollow: false,
  ogTitle: '',
  ogDescription: '',
  ogImageId: null,
  twitterTitle: '',
  twitterDescription: '',
  twitterImageId: null,
  primaryKeyword1: '',
  primaryKeyword2: '',
  primaryKeyword3: '',
};

type FormTab = 'general' | 'seo' | 'social';

/** Where each field an SEO check can point at lives on this form. */
const SEO_FIELDS: Partial<Record<string, { tab: FormTab; id: string }>> = {
  title: { tab: 'general', id: 'title' },
  slug: { tab: 'general', id: 'slug' },
  status: { tab: 'general', id: 'status' },
  seoTitle: { tab: 'seo', id: 'seoTitle' },
  seoDescription: { tab: 'seo', id: 'seoDescription' },
  canonicalUrl: { tab: 'seo', id: 'canonicalUrl' },
  noIndex: { tab: 'seo', id: 'noIndex' },
  primaryKeyword1: { tab: 'seo', id: 'primaryKeyword1' },
  ogTitle: { tab: 'social', id: 'ogTitle' },
  ogDescription: { tab: 'social', id: 'ogDescription' },
  ogImage: { tab: 'social', id: 'page-og-image' },
};

/** A datetime-local value as an instant, so the server reads the editor's time zone. */
function localToIso(value: string): string {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

export function PageForm({
  initial,
  categories = [],
  canPublish,
  mode,
}: {
  initial: PageFormValues;
  /** Flattened category tree; `depth` drives the indent in the dropdown. */
  categories?: Array<{ id: string; name: string; depth: number }>;
  canPublish: boolean;
  mode: 'create' | 'edit';
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [values, setValues] = React.useState(initial);
  const [errors, setErrors] = React.useState<Record<string, string[]>>({});
  const [pending, setPending] = React.useState(false);
  const [tab, setTab] = React.useState<FormTab>('general');
  const [slugTouched, setSlugTouched] = React.useState(mode === 'edit');
  const editorTabs = usePageEditorTabs();

  const resolveJump = React.useMemo(() => {
    const builder = editorTabs
      ? {
          label: 'Open page builder',
          run: () => editorTabs.show('builder'),
        }
      : undefined;
    return jumpResolver<FormTab>({
      fields: SEO_FIELDS,
      areas: {
        general: { tab: 'general', label: 'Go to page details' },
        seo: { tab: 'seo', label: 'Go to SEO settings' },
        social: { tab: 'social', label: 'Go to social sharing' },
        ...(builder ? { sections: builder, content: builder, media: builder } : {}),
      },
      openTab: setTab,
    });
  }, [editorTabs]);

  // What the score panel scores: the form as it stands, saved or not.
  const seoDraft = {
    title: values.title,
    slug: values.slug,
    status: values.status,
    publishedAt: localToIso(values.publishedAt),
    isHomepage: values.isHomepage,
    seoTitle: values.seoTitle,
    seoDescription: values.seoDescription,
    canonicalUrl: values.canonicalUrl,
    noIndex: values.noIndex,
    noFollow: values.noFollow,
    ogTitle: values.ogTitle,
    ogDescription: values.ogDescription,
    ogImageId: values.ogImageId,
    twitterTitle: values.twitterTitle,
    twitterDescription: values.twitterDescription,
    twitterImageId: values.twitterImageId,
    primaryKeyword1: values.primaryKeyword1,
    primaryKeyword2: values.primaryKeyword2,
    primaryKeyword3: values.primaryKeyword3,
  };

  const set = <K extends keyof PageFormValues>(key: K, value: PageFormValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setErrors({});

    const data = new FormData();
    for (const [key, value] of Object.entries(values)) {
      if (key === 'id') continue;
      data.set(key, value === null ? '' : String(value));
    }

    const result = mode === 'create' ? await createPage(data) : await updatePage(initial.id!, data);
    setPending(false);

    if (!result.ok) {
      setErrors(result.fieldErrors ?? {});
      toast(result.error, 'error');
      return;
    }

    toast(result.message ?? 'Saved.');
    if (mode === 'create' && result.data && 'id' in result.data) {
      router.push(`/admin/pages/${(result.data as { id: string }).id}`);
    } else {
      router.refresh();
    }
  }

  const tabs = [
    { id: 'general' as const, label: 'General' },
    { id: 'seo' as const, label: 'SEO' },
    { id: 'social' as const, label: 'Social sharing' },
  ];

  return (
    <form onSubmit={onSubmit}>
      <Card>
        <div className="flex items-center gap-1 border-b border-hairline px-3 py-2">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-pressed={tab === t.id}
              className={cn(
                'rounded-lg px-3 py-1.5 text-sm transition-colors',
                tab === t.id
                  ? 'bg-brand/10 font-medium text-brand'
                  : 'text-muted hover:text-content',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <CardBody className="space-y-4">
          {tab === 'general' ? (
            <>
              <Field label="Page title" htmlFor="title" required error={errors.title}>
                <Input
                  id="title"
                  value={values.title}
                  required
                  onChange={(e) => {
                    set('title', e.target.value);
                    if (!slugTouched && !values.isHomepage) set('slug', pageSlug(e.target.value));
                  }}
                />
              </Field>

              <Field
                label="URL"
                htmlFor="slug"
                error={errors.slug}
                hint={
                  values.isHomepage
                    ? 'The homepage always lives at /'
                    : 'Use / for nesting, e.g. dropbox/business'
                }
              >
                <div className="flex items-center gap-1.5">
                  <span className="shrink-0 text-sm text-muted">/</span>
                  <Input
                    id="slug"
                    value={values.slug}
                    disabled={values.isHomepage}
                    onChange={(e) => {
                      setSlugTouched(true);
                      set('slug', e.target.value);
                    }}
                    onBlur={(e) => set('slug', pageSlug(e.target.value))}
                    placeholder="pricing"
                  />
                </div>
              </Field>

              <Field
                label="Category"
                htmlFor="categoryId"
                hint="Optional. Groups this page in the admin."
                error={errors.categoryId}
              >
                <Select
                  id="categoryId"
                  value={values.categoryId}
                  onChange={(e) => set('categoryId', e.target.value)}
                >
                  <option value="">Uncategorised</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {`${'— '.repeat(category.depth)}${category.name}`}
                    </option>
                  ))}
                </Select>
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Status" htmlFor="status">
                  <Select
                    id="status"
                    value={values.status}
                    onChange={(e) => set('status', e.target.value)}
                  >
                    <option value="DRAFT">Draft — not visible publicly</option>
                    {canPublish ? <option value="PUBLISHED">Published — live</option> : null}
                    {canPublish ? <option value="SCHEDULED">Scheduled</option> : null}
                    <option value="ARCHIVED">Archived</option>
                  </Select>
                </Field>

                <Field
                  label={values.status === 'SCHEDULED' ? 'Publish at' : 'Published date'}
                  htmlFor="publishedAt"
                  error={errors.publishedAt}
                  required={values.status === 'SCHEDULED'}
                >
                  <Input
                    id="publishedAt"
                    type="datetime-local"
                    value={values.publishedAt}
                    onChange={(e) => set('publishedAt', e.target.value)}
                  />
                </Field>
              </div>

              <div className="space-y-3 rounded-lg border border-hairline p-4">
                <Switch
                  checked={values.isHomepage}
                  onChange={(next) => {
                    set('isHomepage', next);
                    if (next) set('slug', '');
                  }}
                  label="Set as homepage"
                  hint="Replaces the current homepage. Only one page can hold this."
                />
                <Switch
                  checked={values.showHeader}
                  onChange={(next) => set('showHeader', next)}
                  label="Show site header"
                />
                <Switch
                  checked={values.showFooter}
                  onChange={(next) => set('showFooter', next)}
                  label="Show site footer"
                />
              </div>
            </>
          ) : null}

          {tab === 'seo' ? (
            <>
              <SeoScorePanel
                entity={initial.id ? { type: 'PAGE', id: initial.id } : null}
                payload={{ draft: seoDraft }}
                resolveJump={resolveJump}
                emptyMessage="Save this page to see its SEO, AEO and GEO scores. From then on they update as you edit."
              />

              <Field
                label="SEO title"
                htmlFor="seoTitle"
                hint={`Falls back to the page title. ${values.seoTitle.length}/60 characters used.`}
              >
                <Input
                  id="seoTitle"
                  value={values.seoTitle}
                  maxLength={200}
                  onChange={(e) => set('seoTitle', e.target.value)}
                  placeholder={values.title}
                />
              </Field>

              <Field
                label="Meta description"
                htmlFor="seoDescription"
                hint={`Aim for 140–160 characters. ${values.seoDescription.length} used.`}
              >
                <Textarea
                  id="seoDescription"
                  rows={3}
                  maxLength={400}
                  value={values.seoDescription}
                  onChange={(e) => set('seoDescription', e.target.value)}
                />
              </Field>

              <PrimaryKeywordsFields
                values={values}
                onChange={(field, value) => set(field, value)}
                errors={errors}
              />

              <Field
                label="Canonical URL"
                htmlFor="canonicalUrl"
                hint="Leave blank unless this page duplicates another URL."
              >
                <Input
                  id="canonicalUrl"
                  value={values.canonicalUrl}
                  onChange={(e) => set('canonicalUrl', e.target.value)}
                  placeholder="https://example.com/pricing"
                />
              </Field>

              <div className="space-y-3 rounded-lg border border-hairline p-4">
                <Switch
                  id="noIndex"
                  checked={values.noIndex}
                  onChange={(next) => set('noIndex', next)}
                  label="Hide from search engines (noindex)"
                />
                <Switch
                  checked={values.noFollow}
                  onChange={(next) => set('noFollow', next)}
                  label="Do not follow links on this page (nofollow)"
                />
              </div>
            </>
          ) : null}

          {tab === 'social' ? (
            <>
              <Field
                label="Open Graph title"
                htmlFor="ogTitle"
                hint="Used by LinkedIn, Facebook, Slack."
              >
                <Input
                  id="ogTitle"
                  value={values.ogTitle}
                  onChange={(e) => set('ogTitle', e.target.value)}
                  placeholder={values.seoTitle || values.title}
                />
              </Field>
              <Field label="Open Graph description" htmlFor="ogDescription">
                <Textarea
                  id="ogDescription"
                  rows={2}
                  value={values.ogDescription}
                  onChange={(e) => set('ogDescription', e.target.value)}
                />
              </Field>
              <Field id="page-og-image" label="Open Graph image" hint="Recommended 1200×630.">
                <MediaPicker
                  value={values.ogImageId}
                  onChange={(id) => set('ogImageId', id)}
                  label="OG image"
                />
              </Field>

              <hr className="border-hairline" />

              <Field label="X / Twitter title" htmlFor="twitterTitle">
                <Input
                  id="twitterTitle"
                  value={values.twitterTitle}
                  onChange={(e) => set('twitterTitle', e.target.value)}
                  placeholder={values.ogTitle || values.title}
                />
              </Field>
              <Field label="X / Twitter description" htmlFor="twitterDescription">
                <Textarea
                  id="twitterDescription"
                  rows={2}
                  value={values.twitterDescription}
                  onChange={(e) => set('twitterDescription', e.target.value)}
                />
              </Field>
              <Field label="X / Twitter image">
                <MediaPicker
                  value={values.twitterImageId}
                  onChange={(id) => set('twitterImageId', id)}
                  label="Twitter image"
                />
              </Field>
            </>
          ) : null}
        </CardBody>

        <div className="flex items-center justify-end gap-2 border-t border-hairline bg-muted/[0.03] px-4 py-3 sm:px-5">
          <Link
            href="/admin/pages"
            className="rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:text-content"
          >
            Cancel
          </Link>
          <Button type="submit" disabled={pending}>
            {pending ? (
              <>
                <Spinner className="h-4 w-4 animate-spin" aria-hidden="true" />
                Saving…
              </>
            ) : mode === 'create' ? (
              'Create page'
            ) : (
              'Save page'
            )}
          </Button>
        </div>
      </Card>
    </form>
  );
}

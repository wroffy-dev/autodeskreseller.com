'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { X } from 'lucide-react';
import { createBlogPost, updateBlogPost } from '@/lib/actions/blog';
import { Card, CardBody } from '@/components/ui/card';
import { Field, Input, Select, Textarea, Switch } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { AdminTabs, TabPanel } from '@/components/admin/admin-tabs';
import { MediaPicker } from '@/components/admin/media-picker';
import { PrimaryKeywordsFields } from '@/components/admin/seo/primary-keywords-fields';
import { SeoScorePanel } from '@/components/admin/seo/seo-score-panel';
import { jumpResolver } from '@/components/admin/seo/jump';
import { RichTextEditor } from '@/components/cms/rich-text-editor';
import { FormSelect } from '@/components/cms/form-select';
import { useToast } from '@/components/ui/toast';
import { Spinner } from '@/components/ui/icons';
import { slugify } from '@/lib/utils/slug';
import { readingTimeMinutes } from '@/lib/utils/format';
import {
  POST_TOGGLES,
  POST_TOGGLE_LABELS,
  OVERRIDES,
  type Override,
  type PostToggle,
} from '@/lib/cms/blog-settings';
import { EMPTY_POST, type PostFormValues } from '@/lib/cms/post-model';
import { DateTimeField } from '@/components/ui/date-field';

// Re-exported so existing imports from this module keep working; the values
// themselves now come from a server-safe module.
export { EMPTY_POST };
export type { PostFormValues };

const TABS = [
  { id: 'content', label: 'Content' },
  { id: 'organise', label: 'Organise' },
  { id: 'display', label: 'Display' },
  { id: 'seo', label: 'SEO & sharing' },
];

/** Where each field an SEO check can point at lives on this form. */
const SEO_FIELDS: Partial<Record<string, { tab?: string; id: string }>> = {
  title: { tab: 'content', id: 'post-title' },
  slug: { tab: 'content', id: 'post-slug' },
  content: { tab: 'content', id: 'post-content' },
  status: { id: 'post-status' },
  author: { tab: 'organise', id: 'post-author' },
  seoTitle: { tab: 'seo', id: 'post-seo-title' },
  seoDescription: { tab: 'seo', id: 'post-seo-description' },
  canonicalUrl: { tab: 'seo', id: 'post-canonical' },
  noIndex: { tab: 'seo', id: 'post-noindex' },
  primaryKeyword1: { tab: 'seo', id: 'post-primaryKeyword1' },
  ogTitle: { tab: 'seo', id: 'post-og-title' },
  ogDescription: { tab: 'seo', id: 'post-og-description' },
  ogImage: { tab: 'seo', id: 'post-og-image' },
};

/** A datetime-local value as an instant, so the server reads the editor's time zone. */
function localToIso(value: string): string {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

const OVERRIDE_LABELS: Record<Override, string> = {
  default: 'Blog default',
  show: 'Show',
  hide: 'Hide',
};

export function PostForm({
  initial,
  categories,
  authors,
  posts,
  canPublish,
  canEdit,
  mode,
  sidebarSlot,
  urlHint = '/blog/…',
}: {
  initial: PostFormValues;
  categories: Array<{ id: string; name: string; parentName?: string | null }>;
  authors: Array<{ id: string; name: string }>;
  posts: Array<{ id: string; title: string }>;
  canPublish: boolean;
  canEdit: boolean;
  mode: 'create' | 'edit';
  /** The per-post sidebar builder, rendered inside the Display tab. */
  sidebarSlot?: React.ReactNode;
  /** Where articles live, from the URL pattern the site serves now. */
  urlHint?: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [values, setValues] = React.useState(initial);
  const [errors, setErrors] = React.useState<Record<string, string[]>>({});
  const [pending, setPending] = React.useState(false);
  const [tab, setTab] = React.useState('content');
  const [tagInput, setTagInput] = React.useState('');
  const [slugTouched, setSlugTouched] = React.useState(mode === 'edit');

  const set = <K extends keyof PostFormValues>(key: K, value: PostFormValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  const resolveJump = React.useMemo(
    () =>
      jumpResolver<string>({
        fields: SEO_FIELDS,
        areas: {
          general: { tab: 'content', id: 'post-title', label: 'Go to title' },
          content: { tab: 'content', id: 'post-content', label: 'Go to content' },
          sections: { tab: 'content', id: 'post-content', label: 'Go to content' },
          media: { id: 'post-featured-image', label: 'Go to featured image' },
          organise: { tab: 'organise', label: 'Go to category and tags' },
          seo: { tab: 'seo', label: 'Go to SEO settings' },
          social: { tab: 'seo', id: 'post-og-title', label: 'Go to sharing settings' },
        },
        openTab: setTab,
      }),
    [],
  );

  // What the score panel scores: the form as it stands, saved or not.
  const seoDraft = {
    title: values.title,
    slug: values.slug,
    subtitle: values.subtitle,
    status: values.status,
    publishedAt: localToIso(values.publishedAt),
    excerpt: values.excerpt,
    content: values.content,
    categoryId: values.categoryId,
    authorId: values.authorId,
    tags: values.tags,
    featuredImageId: values.featuredImageId,
    ogImageId: values.ogImageId,
    twitterImageId: values.twitterImageId,
    seoTitle: values.seoTitle,
    seoDescription: values.seoDescription,
    canonicalUrl: values.canonicalUrl,
    noIndex: values.noIndex,
    noFollow: values.noFollow,
    ogTitle: values.ogTitle,
    ogDescription: values.ogDescription,
    primaryKeyword1: values.primaryKeyword1,
    primaryKeyword2: values.primaryKeyword2,
    primaryKeyword3: values.primaryKeyword3,
  };

  const setOption = <K extends keyof PostFormValues['options']>(
    key: K,
    value: PostFormValues['options'][K],
  ) => setValues((current) => ({ ...current, options: { ...current.options, [key]: value } }));

  function addTag(raw: string) {
    const name = raw.trim().replace(/,+$/, '');
    if (!name || values.tags.includes(name)) return;
    set('tags', [...values.tags, name]);
    setTagInput('');
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setErrors({});

    const data = new FormData();
    const simple: Array<keyof PostFormValues> = [
      'title',
      'slug',
      'subtitle',
      'status',
      'publishedAt',
      'excerpt',
      'content',
      'categoryId',
      'authorId',
      'sidebarMode',
      'seoTitle',
      'seoDescription',
      'primaryKeyword1',
      'primaryKeyword2',
      'primaryKeyword3',
      'canonicalUrl',
      'ogTitle',
      'ogDescription',
    ];
    for (const key of simple) data.set(key, String(values[key] ?? ''));
    data.set('isFeatured', String(values.isFeatured));
    data.set('featuredPriority', String(values.featuredPriority));
    data.set('noIndex', String(values.noIndex));
    data.set('noFollow', String(values.noFollow));
    data.set('featuredImageId', values.featuredImageId ?? '');
    data.set('thumbnailId', values.thumbnailId ?? '');
    data.set('ogImageId', values.ogImageId ?? '');
    data.set('twitterImageId', values.twitterImageId ?? '');
    data.set('tags', JSON.stringify(values.tags));
    data.set('relatedIds', JSON.stringify(values.relatedIds));
    data.set('options', JSON.stringify(values.options));

    const result =
      mode === 'create' ? await createBlogPost(data) : await updateBlogPost(initial.id!, data);
    setPending(false);

    if (!result.ok) {
      setErrors(result.fieldErrors ?? {});
      toast(result.error, 'error');
      return;
    }
    toast(result.message ?? 'Saved.');
    if (mode === 'create' && result.data && 'id' in result.data) {
      router.push(`/admin/blog/${(result.data as { id: string }).id}`);
    } else {
      router.refresh();
    }
  }

  const availableRelated = posts.filter(
    (p) => p.id !== initial.id && !values.relatedIds.includes(p.id),
  );

  return (
    <form onSubmit={onSubmit} className="grid gap-6 xl:grid-cols-[1fr_22rem]">
      <div className="min-w-0 xl:order-1">
        <Card>
          <AdminTabs tabs={TABS} active={tab} onChange={setTab} className="px-3" />

          <CardBody className="space-y-4">
            <fieldset disabled={!canEdit || pending} className="space-y-4">
              <TabPanel id="content" active={tab} className="space-y-4">
                <Field label="Title" htmlFor="post-title" required error={errors.title}>
                  <Input
                    id="post-title"
                    value={values.title}
                    required
                    onChange={(e) => {
                      set('title', e.target.value);
                      if (!slugTouched) set('slug', slugify(e.target.value));
                    }}
                  />
                </Field>

                <Field label="URL" htmlFor="post-slug" error={errors.slug} hint={urlHint}>
                  <Input
                    id="post-slug"
                    value={values.slug}
                    onChange={(e) => {
                      setSlugTouched(true);
                      set('slug', e.target.value);
                    }}
                    onBlur={(e) => set('slug', slugify(e.target.value))}
                  />
                </Field>

                <Field
                  label="Subtitle"
                  htmlFor="post-subtitle"
                  hint="Optional standfirst shown under the title."
                >
                  <Input
                    id="post-subtitle"
                    value={values.subtitle}
                    onChange={(e) => set('subtitle', e.target.value)}
                  />
                </Field>

                <Field
                  label="Excerpt"
                  htmlFor="post-excerpt"
                  hint="Shown on cards and used as the meta description fallback. Generated automatically if left blank."
                >
                  <Textarea
                    id="post-excerpt"
                    rows={3}
                    value={values.excerpt}
                    onChange={(e) => set('excerpt', e.target.value)}
                  />
                </Field>

                <Field
                  id="post-content"
                  label="Content"
                  hint={`About ${readingTimeMinutes(values.content)} min read. H2 and H3 headings build the table of contents.`}
                >
                  <RichTextEditor
                    value={values.content}
                    onChange={(v) => set('content', v)}
                    rows={22}
                  />
                </Field>
              </TabPanel>

              <TabPanel id="organise" active={tab} className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Category" htmlFor="post-category">
                    <Select
                      id="post-category"
                      value={values.categoryId}
                      onChange={(e) => set('categoryId', e.target.value)}
                    >
                      <option value="">Uncategorised</option>
                      {categories.map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.parentName
                            ? `${category.parentName} → ${category.name}`
                            : category.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Author" htmlFor="post-author">
                    <Select
                      id="post-author"
                      value={values.authorId}
                      onChange={(e) => set('authorId', e.target.value)}
                    >
                      <option value="">No author</option>
                      {authors.map((author) => (
                        <option key={author.id} value={author.id}>
                          {author.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>

                <Field label="Tags" htmlFor="post-tags" hint="Press Enter or comma to add.">
                  <div className="space-y-2">
                    {values.tags.length > 0 ? (
                      <ul className="flex flex-wrap gap-1.5">
                        {values.tags.map((tag) => (
                          <li key={tag}>
                            <span className="inline-flex items-center gap-1 rounded-full bg-muted/10 py-1 pl-2.5 pr-1 text-xs text-content">
                              {tag}
                              <button
                                type="button"
                                onClick={() =>
                                  set(
                                    'tags',
                                    values.tags.filter((t) => t !== tag),
                                  )
                                }
                                aria-label={`Remove tag ${tag}`}
                                className="rounded-full p-0.5 text-muted hover:bg-muted/20 hover:text-content"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    <Input
                      id="post-tags"
                      value={tagInput}
                      placeholder="Migration, Security…"
                      onChange={(e) => {
                        if (e.target.value.endsWith(',')) addTag(e.target.value);
                        else setTagInput(e.target.value);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addTag(tagInput);
                        }
                      }}
                      onBlur={() => addTag(tagInput)}
                    />
                  </div>
                </Field>

                <Field
                  label="Related posts"
                  hint="Up to six, shown before the automatic matches. Leave empty to let the blog choose by category and tags."
                >
                  <div className="space-y-2">
                    {values.relatedIds.length > 0 ? (
                      <ul className="space-y-1.5">
                        {values.relatedIds.map((id) => (
                          <li
                            key={id}
                            className="flex items-center gap-2 rounded-lg border border-hairline px-3 py-2"
                          >
                            <span className="min-w-0 flex-1 truncate text-sm text-content">
                              {posts.find((p) => p.id === id)?.title ?? 'Removed post'}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                set(
                                  'relatedIds',
                                  values.relatedIds.filter((v) => v !== id),
                                )
                              }
                              aria-label="Remove related post"
                              className="rounded p-1 text-muted hover:bg-red-50 hover:text-red-600"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-muted">
                        None chosen — posts from the same category and tags are used instead.
                      </p>
                    )}
                    {values.relatedIds.length < 6 ? (
                      <Select
                        value=""
                        aria-label="Add a related post"
                        onChange={(e) => {
                          if (e.target.value) {
                            set('relatedIds', [...values.relatedIds, e.target.value]);
                            e.target.value = '';
                          }
                        }}
                      >
                        <option value="">Add a related post…</option>
                        {availableRelated.map((post) => (
                          <option key={post.id} value={post.id}>
                            {post.title}
                          </option>
                        ))}
                      </Select>
                    ) : null}
                  </div>
                </Field>
              </TabPanel>

              <TabPanel id="display" active={tab} className="space-y-6">
                <div>
                  <h3 className="text-sm font-semibold text-content">What this article shows</h3>
                  <p className="mt-1 text-xs text-muted">
                    Every row follows Blog → Design unless you override it here.
                  </p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    {POST_TOGGLES.map((toggle: PostToggle) => (
                      <Field
                        key={toggle}
                        label={POST_TOGGLE_LABELS[toggle]}
                        htmlFor={`toggle-${toggle}`}
                      >
                        <Select
                          id={`toggle-${toggle}`}
                          value={values.options[toggle]}
                          onChange={(e) => setOption(toggle, e.target.value as Override)}
                        >
                          {OVERRIDES.map((option) => (
                            <option key={option} value={option}>
                              {OVERRIDE_LABELS[option]}
                            </option>
                          ))}
                        </Select>
                      </Field>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-content">Forms on this article</h3>
                  <p className="mt-1 text-xs text-muted">
                    Chosen from Form management. Every submission becomes a lead, tagged with this
                    article.
                  </p>
                  <div className="mt-3 grid gap-4 sm:grid-cols-3">
                    <Field label="Sidebar form" htmlFor="form-sidebar">
                      <FormSelect
                        id="form-sidebar"
                        value={values.options.sidebarFormSlug}
                        onChange={(next) => setOption('sidebarFormSlug', next)}
                      />
                    </Field>
                    <Field label="In-article CTA form" htmlFor="form-cta">
                      <FormSelect
                        id="form-cta"
                        value={values.options.ctaFormSlug}
                        onChange={(next) => setOption('ctaFormSlug', next)}
                      />
                    </Field>
                    <Field label="End-of-article form" htmlFor="form-bottom">
                      <FormSelect
                        id="form-bottom"
                        value={values.options.bottomFormSlug}
                        onChange={(next) => setOption('bottomFormSlug', next)}
                      />
                    </Field>
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-content">Sidebar</h3>
                  <div className="mt-3 max-w-sm">
                    <Field label="This article uses" htmlFor="post-sidebar-mode">
                      <Select
                        id="post-sidebar-mode"
                        value={values.sidebarMode}
                        onChange={(e) =>
                          set('sidebarMode', e.target.value as PostFormValues['sidebarMode'])
                        }
                      >
                        <option value="GLOBAL">The global sidebar</option>
                        <option value="CUSTOM">Its own sidebar</option>
                        <option value="NONE">No sidebar (full width)</option>
                      </Select>
                    </Field>
                  </div>
                  {sidebarSlot ? <div className="mt-4">{sidebarSlot}</div> : null}
                </div>
              </TabPanel>

              <TabPanel id="seo" active={tab} className="space-y-4">
                <Field
                  label="SEO title"
                  htmlFor="post-seo-title"
                  hint={`${values.seoTitle.length}/60 characters used.`}
                >
                  <Input
                    id="post-seo-title"
                    value={values.seoTitle}
                    placeholder={values.title}
                    onChange={(e) => set('seoTitle', e.target.value)}
                  />
                </Field>
                <Field
                  label="Meta description"
                  htmlFor="post-seo-description"
                  hint={`${values.seoDescription.length} characters. Falls back to the excerpt.`}
                >
                  <Textarea
                    id="post-seo-description"
                    rows={3}
                    value={values.seoDescription}
                    placeholder={values.excerpt}
                    onChange={(e) => set('seoDescription', e.target.value)}
                  />
                </Field>
                <PrimaryKeywordsFields
                  idPrefix="post-"
                  values={values}
                  onChange={(field, value) => set(field, value)}
                  errors={errors}
                  description="The searches this article is written to answer. Keyword 1 is what used to be the focus keyword. SEO Intelligence checks for them in the title, description, URL, headings and copy. They are analysis inputs only: nothing is added to the page’s markup."
                />
                <Field label="Canonical URL" htmlFor="post-canonical">
                  <Input
                    id="post-canonical"
                    value={values.canonicalUrl}
                    onChange={(e) => set('canonicalUrl', e.target.value)}
                  />
                </Field>
                <Field label="Open Graph title" htmlFor="post-og-title">
                  <Input
                    id="post-og-title"
                    value={values.ogTitle}
                    placeholder={values.seoTitle || values.title}
                    onChange={(e) => set('ogTitle', e.target.value)}
                  />
                </Field>
                <Field label="Open Graph description" htmlFor="post-og-description">
                  <Textarea
                    id="post-og-description"
                    rows={2}
                    value={values.ogDescription}
                    onChange={(e) => set('ogDescription', e.target.value)}
                  />
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field id="post-og-image" label="Social share image" hint="Falls back to the featured image.">
                    <MediaPicker
                      value={values.ogImageId}
                      onChange={(id) => set('ogImageId', id)}
                      label="OG image"
                    />
                  </Field>
                  <Field label="X / Twitter image" hint="Falls back to the share image.">
                    <MediaPicker
                      value={values.twitterImageId}
                      onChange={(id) => set('twitterImageId', id)}
                      label="Twitter image"
                    />
                  </Field>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border border-hairline p-4">
                    <Switch
                      id="post-noindex"
                      checked={values.noIndex}
                      onChange={(next) => set('noIndex', next)}
                      label="Hide from search engines (noindex)"
                    />
                  </div>
                  <div className="rounded-lg border border-hairline p-4">
                    <Switch
                      checked={values.noFollow}
                      onChange={(next) => set('noFollow', next)}
                      label="Do not follow links (nofollow)"
                    />
                  </div>
                </div>
              </TabPanel>
            </fieldset>
          </CardBody>
        </Card>
      </div>

      <div className="min-w-0 space-y-6 xl:order-2">
        <Card>
          <CardBody className="space-y-4">
            <fieldset disabled={!canEdit || pending} className="space-y-4">
              <Field label="Status" htmlFor="post-status">
                <Select
                  id="post-status"
                  value={values.status}
                  onChange={(e) => set('status', e.target.value)}
                >
                  <option value="DRAFT">Draft</option>
                  {canPublish ? <option value="PUBLISHED">Published</option> : null}
                  {canPublish ? <option value="SCHEDULED">Scheduled</option> : null}
                  <option value="ARCHIVED">Archived</option>
                </Select>
              </Field>

              <Field
                label={values.status === 'SCHEDULED' ? 'Publish at' : 'Published date'}
                htmlFor="post-published"
                error={errors.publishedAt}
                required={values.status === 'SCHEDULED'}
              >
                <DateTimeField
                  id="post-published"
                  label={values.status === 'SCHEDULED' ? 'Publish at' : 'Published date'}
                  value={values.publishedAt}
                  invalid={!!errors.publishedAt}
                  onChange={(next) => set('publishedAt', next)}
                />
              </Field>

              <Field id="post-featured-image" label="Featured image" hint="Recommended 1200×675.">
                <MediaPicker
                  value={values.featuredImageId}
                  onChange={(id) => set('featuredImageId', id)}
                  label="Featured image"
                />
              </Field>

              <Field label="Thumbnail" hint="Optional. Used by the compact sidebar lists.">
                <MediaPicker
                  value={values.thumbnailId}
                  onChange={(id) => set('thumbnailId', id)}
                  label="Thumbnail"
                />
              </Field>

              <div className="rounded-lg border border-hairline p-4">
                <Switch
                  checked={values.isFeatured}
                  onChange={(next) => set('isFeatured', next)}
                  label="Featured post"
                  hint="Eligible for the featured section and the Featured post sources."
                />
              </div>

              {values.isFeatured ? (
                <Field
                  label="Featured priority"
                  htmlFor="post-featured-priority"
                  hint="Lower numbers come first when several posts are featured."
                >
                  <Input
                    id="post-featured-priority"
                    type="number"
                    min={0}
                    max={9999}
                    value={values.featuredPriority}
                    onChange={(e) => set('featuredPriority', Number(e.target.value) || 0)}
                  />
                </Field>
              ) : null}
            </fieldset>
          </CardBody>

          {canEdit ? (
            <div className="flex justify-end gap-2 border-t border-hairline bg-muted/[0.03] px-4 py-3 sm:px-5">
              <Link
                href="/admin/blog"
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
                  'Create post'
                ) : (
                  'Save post'
                )}
              </Button>
            </div>
          ) : null}
        </Card>

        <SeoScorePanel
          entity={initial.id ? { type: 'BLOG_POST', id: initial.id } : null}
          payload={{ draft: seoDraft }}
          resolveJump={resolveJump}
          emptyMessage="Save this article to see its SEO, AEO and GEO scores. From then on they update as you edit."
        />
      </div>
    </form>
  );
}

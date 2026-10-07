/* eslint-disable no-console */
import { PrismaClient, Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { PERMISSIONS, SYSTEM_ROLES, ALL_PERMISSIONS } from '../src/lib/auth/permissions';
import { DEFAULT_EMAIL_TEMPLATES } from '../src/lib/email/templates';
import { demoHome, demoPricing, demoContact, demoAbout } from './seed-blocks';
import { collectSeedProblems } from '../src/lib/env-validation';
import { isDirectRun } from './seed/_shared';

/**
 * Exported so each file in `prisma/seed/` — one runnable step apiece — closes
 * the same connection it opened. Importing this module runs no seed: `main()`
 * below only executes when this file is the entry point.
 */
export const prisma = new PrismaClient();

/**
 * The markets the platform ships with.
 *
 * India is the root market and keeps the empty slug, which is what serves it
 * from `/` and leaves every original URL untouched. The ids match the ones the
 * multi-country migration inserts, so a seeded database and a migrated one end
 * up with the same rows rather than two near-duplicates.
 *
 * Adding a market later needs no code: this list exists so a brand new database
 * has somewhere to put content, not as the source of truth.
 */
const COUNTRIES = [
  {
    id: 'country_in',
    name: 'India',
    code: 'IN',
    slug: '',
    locale: 'en-IN',
    currency: 'INR',
    currencySymbol: '₹',
    phoneCode: '+91',
    timezone: 'Asia/Kolkata',
    isDefault: true,
    sortOrder: 0,
  },
  {
    id: 'country_ae',
    name: 'United Arab Emirates',
    code: 'AE',
    slug: 'ae',
    locale: 'en-AE',
    currency: 'AED',
    currencySymbol: 'AED',
    phoneCode: '+971',
    timezone: 'Asia/Dubai',
    isDefault: false,
    sortOrder: 1,
  },
];

export async function seedCountries() {
  for (const country of COUNTRIES) {
    await prisma.country.upsert({
      where: { code: country.code },
      // An existing market is never renamed, re-slugged or reactivated: an
      // operator may have changed any of it deliberately.
      update: {},
      create: { ...country, isActive: true },
    });
  }
  console.log(`  countries: ${COUNTRIES.map((c) => c.code).join(', ')}`);
}

/** The root market, which every piece of seeded demo content belongs to. */
async function defaultCountryId(): Promise<string> {
  const row =
    (await prisma.country.findFirst({ where: { isDefault: true } })) ??
    (await prisma.country.findFirst({ orderBy: { sortOrder: 'asc' } }));
  if (!row) throw new Error('No country configured — run seedCountries first.');
  return row.id;
}

export async function seedPermissions() {
  for (const [key, meta] of Object.entries(PERMISSIONS)) {
    await prisma.permission.upsert({
      where: { key },
      update: { group: meta.group, label: meta.label },
      create: { key, group: meta.group, label: meta.label },
    });
  }
  console.log(`  permissions: ${ALL_PERMISSIONS.length}`);
}

export async function seedRoles() {
  const all = await prisma.permission.findMany();
  const byKey = new Map(all.map((p) => [p.key, p.id]));

  for (const role of SYSTEM_ROLES) {
    const record = await prisma.userRole.upsert({
      where: { slug: role.slug },
      update: { name: role.name, description: role.description, rank: role.rank, isSystem: true },
      create: {
        slug: role.slug,
        name: role.name,
        description: role.description,
        rank: role.rank,
        isSystem: true,
      },
    });

    const keys = role.permissions === 'all' ? ALL_PERMISSIONS : role.permissions;
    await prisma.rolePermission.deleteMany({ where: { roleId: record.id } });
    await prisma.rolePermission.createMany({
      data: keys
        .map((k) => byKey.get(k))
        .filter((id): id is string => Boolean(id))
        .map((permissionId) => ({ roleId: record.id, permissionId })),
      skipDuplicates: true,
    });
    console.log(`  role: ${role.name} (${keys.length} permissions)`);
  }
}

/**
 * Initial super-admin provisioning.
 *
 * Idempotent and deliberately conservative: an account that already exists is
 * never given a new password, never renamed and never recreated. Re-running the
 * seed on a live deployment therefore cannot lock the real owner out or hand
 * access back to whoever still has the old SEED_ADMIN_PASSWORD in their
 * pipeline configuration.
 *
 * The password is never logged, and the weakness check reports what is missing
 * rather than echoing the value.
 */
export async function seedAdmin() {
  const email = (process.env.SEED_ADMIN_EMAIL || '').toLowerCase().trim();
  const password = process.env.SEED_ADMIN_PASSWORD || '';
  const name = (process.env.SEED_ADMIN_NAME || 'Super Admin').trim() || 'Super Admin';

  if (!email || !password) {
    console.log('  admin: skipped (set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD)');
    return;
  }

  const problems = collectSeedProblems(process.env);
  if (problems.length > 0) {
    // Names and reasons only — the password itself never reaches a log.
    throw new Error(
      `Cannot create the initial admin:\n${problems
        .map((problem) => `  • ${problem.variable} ${problem.problem}`)
        .join('\n')}`,
    );
  }

  const role = await prisma.userRole.findUniqueOrThrow({ where: { slug: 'super-admin' } });

  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true, status: true, deletedAt: true },
  });

  if (existing) {
    // Reactivating a suspended or soft-deleted account is the one change worth
    // making — it is how an operator recovers a locked-out owner — but the
    // password and the role stay exactly as they are.
    if (existing.status !== 'ACTIVE' || existing.deletedAt) {
      await prisma.user.update({
        where: { email },
        data: { status: 'ACTIVE', deletedAt: null },
      });
      console.log(`  admin: ${email} reactivated (password and role unchanged)`);
    } else {
      console.log(`  admin: ${email} already exists (nothing changed)`);
    }
    return;
  }

  await prisma.user.create({
    data: {
      email,
      name,
      passwordHash: await bcrypt.hash(password, 12),
      roleId: role.id,
      status: 'ACTIVE',
      // Two-step verification is mandatory, so the new owner is walked through
      // enrolment at their first sign-in rather than arriving unprotected.
      twoFactorRequired: true,
      twoFactorEnabled: false,
    },
  });
  console.log(`  admin: ${email} created — set up Microsoft Authenticator at first sign-in`);
  console.log('  NOTE: set RUN_SEED=false and clear SEED_ADMIN_PASSWORD now that the admin exists.');
}

export async function seedSettings() {
  /*
   * Annotated rather than inlined, so a field the schema no longer has fails
   * the typecheck here.
   *
   * `upsert`'s `create` is an XOR of the checked and unchecked input types, and
   * TypeScript does not apply excess-property checking across a union — so a
   * column removed from the schema stayed in this literal, compiled clean, and
   * failed at `RUN_SEED` time on the deployment server. A plain annotated const
   * gets the check.
   */
  const siteSeed: Prisma.WebsiteSettingsUncheckedCreateInput = {
    id: 'singleton',
    siteName: 'CloudShelf',
    siteTitle: 'Authorised Dropbox Reseller',
    siteDescription:
      'Dropbox Business and Enterprise licences with local billing, guided migration and named support.',
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000',
    contactEmail: 'sales@example.com',
    contactPhone: '+91 80 4718 0000',
    address: '2nd Floor, Prestige Tower, Bengaluru 560001, India',
    linkedinUrl: 'https://www.linkedin.com/',
    announcementEnabled: true,
    announcementText: 'Free migration for teams moving from Google Drive or Box — until 31 March.',
    announcementUrl: '/contact',
    headerCtaLabel: 'Talk to Sales',
    headerCtaUrl: '/contact',
  };

  await prisma.websiteSettings.upsert({
    where: { id: 'singleton' },
    update: {},
    create: siteSeed,
  });

  await prisma.seoSettings.upsert({
    where: { id: 'singleton' },
    update: {},
    create: {
      id: 'singleton',
      defaultTitle: 'Authorised Dropbox Reseller',
      titleTemplate: '%s | CloudShelf',
      defaultDescription:
        'Buy Dropbox Business and Enterprise with local billing, free migration and named support.',
      organizationName: 'CloudShelf',
    },
  });

  await prisma.trackingSettings.upsert({ where: { id: 'singleton' }, update: {}, create: { id: 'singleton' } });
  await prisma.emailSettings.upsert({ where: { id: 'singleton' }, update: {}, create: { id: 'singleton' } });

  for (const template of DEFAULT_EMAIL_TEMPLATES) {
    await prisma.emailTemplate.upsert({
      where: { key: template.key },
      update: {},
      create: { key: template.key, name: template.name, subject: template.subject, body: template.body },
    });
  }
  /*
   * The root market's settings start as a copy of the global ones, which is
   * exactly what the multi-country migration does on an existing database — so
   * a freshly seeded install and a migrated one end up in the same state.
   */
  const countryId = await defaultCountryId();
  const site = await prisma.websiteSettings.findUnique({ where: { id: 'singleton' } });
  const seo = await prisma.seoSettings.findUnique({ where: { id: 'singleton' } });

  await prisma.countrySettings.upsert({
    where: { countryId },
    update: {},
    create: {
      countryId,
      companyName: site?.siteName ?? null,
      salesPhone: site?.contactPhone ?? null,
      salesEmail: site?.contactEmail ?? null,
      whatsappNumber: site?.whatsappNumber ?? null,
      address: site?.address ?? null,
      headerCtaLabel: site?.headerCtaLabel ?? null,
      headerCtaUrl: site?.headerCtaUrl ?? null,
      defaultTitle: seo?.defaultTitle ?? null,
      titleTemplate: seo?.titleTemplate ?? null,
      defaultDescription: seo?.defaultDescription ?? null,
      organizationName: seo?.organizationName ?? null,
      organizationType: seo?.organizationType ?? null,
    },
  });

  console.log('  settings + email templates + country settings');
}

const PRODUCTS = [
  {
    name: 'Dropbox Business Standard',
    slug: 'dropbox-business-standard',
    sku: 'DBX-STD',
    shortDescription: '5 TB of shared team storage with admin controls and 180-day file recovery.',
    description:
      '<p>Dropbox Business Standard gives growing teams a shared 5 TB workspace with granular sharing controls, team folders and 180 days of file recovery. It is the right starting point for teams that have outgrown consumer file sync.</p>',
    storage: '5 TB',
    minUsers: 3,
    maxUsers: 250,
    monthlyPrice: '1250.00',
    annualPrice: '12500.00',
    compareAtPrice: '1500.00',
    discountPercent: 16,
    isFeatured: true,
    sortOrder: 1,
    features: [
      '5 TB shared team storage',
      '180-day file recovery and version history',
      'Team folders and granular sharing controls',
      'Admin console with activity logs',
      'Dropbox Paper and Transfer included',
    ],
    benefits: [
      'Replace ageing file servers without retraining your team',
      'Recover from accidental deletion or ransomware in minutes',
    ],
    specs: [
      { label: 'Storage', value: '5 TB shared' },
      { label: 'File recovery', value: '180 days' },
      { label: 'Minimum users', value: '3' },
      { label: 'Transfer size', value: '2 GB' },
    ],
  },
  {
    name: 'Dropbox Business Advanced',
    slug: 'dropbox-business-advanced',
    sku: 'DBX-ADV',
    shortDescription: 'As much space as your team needs, plus tiered admin roles and device approvals.',
    description:
      '<p>Advanced adds unlimited-as-needed storage, tiered administrator roles, device approvals and single sign-on. It is the plan most regulated and multi-site teams settle on.</p>',
    storage: 'As much as needed',
    minUsers: 3,
    maxUsers: null,
    monthlyPrice: '1990.00',
    annualPrice: '19900.00',
    compareAtPrice: '2400.00',
    discountPercent: 17,
    isFeatured: true,
    sortOrder: 2,
    features: [
      'As much storage as your team needs',
      '1-year file recovery and version history',
      'Tiered admin roles and device approvals',
      'Single sign-on (SAML) and directory sync',
      'Advanced audit logs and legal hold',
    ],
    benefits: [
      'Meet security review requirements without extra tooling',
      'Delegate day-to-day administration safely',
    ],
    specs: [
      { label: 'Storage', value: 'As needed' },
      { label: 'File recovery', value: '1 year' },
      { label: 'SSO', value: 'SAML 2.0' },
      { label: 'Transfer size', value: '100 GB' },
    ],
  },
  {
    name: 'Dropbox Enterprise',
    slug: 'dropbox-enterprise',
    sku: 'DBX-ENT',
    shortDescription: 'Enterprise governance, domain insights and a dedicated success manager.',
    description:
      '<p>Enterprise is for organisations that need domain-level governance, network control, custom onboarding and a dedicated success manager alongside their Dropbox deployment.</p>',
    storage: 'As much as needed',
    minUsers: 250,
    maxUsers: null,
    monthlyPrice: null,
    annualPrice: null,
    isFeatured: true,
    sortOrder: 3,
    priceNote: 'Custom pricing',
    ctaLabel: 'Request a quote',
    features: [
      'Everything in Advanced',
      'Domain insights and account capture',
      'Network control and integration support',
      'Dedicated customer success manager',
      'Custom onboarding and training programme',
    ],
    benefits: [
      'Bring shadow-IT accounts under central control',
      'A single accountable contact for the whole estate',
    ],
    specs: [
      { label: 'Storage', value: 'As needed' },
      { label: 'Minimum users', value: '250' },
      { label: 'Success manager', value: 'Dedicated' },
    ],
  },
  {
    name: 'Dropbox Essentials',
    slug: 'dropbox-essentials',
    sku: 'DBX-ESS',
    shortDescription: '3 TB for solo professionals who need PDF editing and eSignatures.',
    description:
      '<p>Essentials is a single-user plan with 3 TB of storage, PDF editing, eSignatures and Dropbox Replay. A good fit for consultants and freelancers.</p>',
    storage: '3 TB',
    minUsers: 1,
    maxUsers: 1,
    monthlyPrice: '1650.00',
    annualPrice: '16500.00',
    isFeatured: false,
    sortOrder: 4,
    features: ['3 TB of storage', 'PDF editing and eSignatures', 'Dropbox Replay video review', '30-day file recovery'],
    benefits: ['Send, track and sign documents without a second subscription'],
    specs: [
      { label: 'Storage', value: '3 TB' },
      { label: 'Users', value: '1' },
      { label: 'File recovery', value: '30 days' },
    ],
  },
];

export async function seedProducts() {
  const category = await prisma.productCategory.upsert({
    where: { slug: 'dropbox-plans' },
    update: {},
    create: {
      slug: 'dropbox-plans',
      name: 'Dropbox Plans',
      description: 'Dropbox subscription plans for teams and enterprises.',
      sortOrder: 1,
    },
  });

  // Brands are the second axis a product section can filter by.
  const brand = await prisma.brand.upsert({
    where: { slug: 'dropbox' },
    update: {},
    create: {
      slug: 'dropbox',
      name: 'Dropbox',
      description: 'Cloud storage and collaboration for teams.',
      websiteUrl: 'https://www.dropbox.com',
      sortOrder: 1,
    },
  });

  for (const p of PRODUCTS) {
    await prisma.product.upsert({
      where: { slug: p.slug },
      update: {},
      create: {
        name: p.name,
        slug: p.slug,
        sku: p.sku,
        status: 'PUBLISHED',
        publishedAt: new Date(),
        isFeatured: p.isFeatured,
        sortOrder: p.sortOrder,
        shortDescription: p.shortDescription,
        description: p.description,
        storage: p.storage,
        minUsers: p.minUsers ?? null,
        maxUsers: p.maxUsers ?? null,
        billingPeriod: 'BOTH',
        currency: 'INR',
        monthlyPrice: p.monthlyPrice ? new Prisma.Decimal(p.monthlyPrice) : null,
        annualPrice: p.annualPrice ? new Prisma.Decimal(p.annualPrice) : null,
        compareAtPrice: p.compareAtPrice ? new Prisma.Decimal(p.compareAtPrice) : null,
        discountPercent: p.discountPercent ?? null,
        priceSuffix: 'per user / month',
        priceNote: p.priceNote ?? null,
        ctaLabel: p.ctaLabel ?? 'Get Started',
        features: p.features,
        benefits: p.benefits,
        specs: p.specs,
        categoryId: category.id,
        brandId: brand.id,
        // Featured ordering is explicit, never derived from creation date.
        featuredOrder: p.sortOrder,
        seoTitle: `${p.name} — pricing and features`,
        seoDescription: p.shortDescription,
      },
    });
  }

  /*
   * Every product is put on sale in the root market at the price on the master
   * record. Other markets deliberately get nothing: a plan is not for sale in a
   * market until somebody prices it there, which is safer than inventing a
   * price or showing another market's currency.
   */
  const countryId = await defaultCountryId();
  for (const p of PRODUCTS) {
    const product = await prisma.product.findUnique({ where: { slug: p.slug } });
    if (!product) continue;
    await prisma.productCountry.upsert({
      where: { productId_countryId: { productId: product.id, countryId } },
      update: {},
      create: {
        productId: product.id,
        countryId,
        status: 'PUBLISHED',
        publishedAt: new Date(),
        isFeatured: p.isFeatured,
        sortOrder: p.sortOrder,
        featuredOrder: p.sortOrder,
        currency: 'INR',
        monthlyPrice: p.monthlyPrice ? new Prisma.Decimal(p.monthlyPrice) : null,
        annualPrice: p.annualPrice ? new Prisma.Decimal(p.annualPrice) : null,
        compareAtPrice: p.compareAtPrice ? new Prisma.Decimal(p.compareAtPrice) : null,
        discountPercent: p.discountPercent ?? null,
        priceSuffix: 'per user / month',
        priceNote: p.priceNote ?? null,
        ctaLabel: p.ctaLabel ?? 'Get Started',
        seoTitle: `${p.name} — pricing and features`,
        seoDescription: p.shortDescription,
      },
    });
  }

  console.log(`  products: ${PRODUCTS.length}`);
}

/**
 * Creates a market-independent form, or returns the one already there.
 *
 * Not an `upsert`: the natural key is (countryId, slug), and a shared form's
 * countryId is null, which SQL cannot match in a unique lookup.
 */
async function upsertSharedForm(slug: string, create: Prisma.FormUncheckedCreateInput) {
  const existing = await prisma.form.findFirst({ where: { slug, countryId: null } });
  if (existing) return existing;
  return prisma.form.create({ data: create });
}

export async function seedForms() {
  const advanced = await prisma.product.findUnique({ where: { slug: 'dropbox-business-advanced' } });

  /*
   * Seeded forms are shared by every market. A slug is unique *within* a
   * market, and SQL treats two NULLs as distinct, so a shared form has no
   * compound key to upsert on — it is looked up and created instead.
   */
  const contact = await upsertSharedForm('contact-sales', {
      slug: 'contact-sales',
      name: 'Contact Sales',
      description: 'Primary enquiry form used on the contact page and header CTA.',
      submitLabel: 'Send enquiry',
      successMessage: 'Thanks — a Dropbox specialist will contact you within one business day.',
      leadSource: 'Contact form',
      notifyEmails: 'sales@example.com',
      consentText: 'By submitting this form you agree to be contacted about your enquiry.',
  });

  const quote = await upsertSharedForm('request-quote', {
      slug: 'request-quote',
      name: 'Request a Quote',
      description: 'Product CTA form. Pre-fills the product the visitor clicked.',
      submitLabel: 'Request quote',
      successMessage: 'Thanks — your quote is on its way. We usually reply within one business day.',
      leadSource: 'Product CTA',
      defaultProductId: advanced?.id ?? null,
      notifyEmails: 'sales@example.com',
  });

  const fields = [
    { form: contact.id, type: 'NAME' as const, label: 'Full name', name: 'name', required: true, width: 'half', order: 1, placeholder: 'Priya Menon' },
    { form: contact.id, type: 'EMAIL' as const, label: 'Work email', name: 'email', required: true, width: 'half', order: 2, placeholder: 'you@company.com' },
    { form: contact.id, type: 'PHONE' as const, label: 'Phone', name: 'phone', required: false, width: 'half', order: 3, placeholder: '+91 98765 43210' },
    { form: contact.id, type: 'COMPANY' as const, label: 'Company', name: 'company', required: true, width: 'half', order: 4 },
    {
      form: contact.id,
      type: 'SELECT' as const,
      label: 'Team size',
      name: 'team_size',
      required: false,
      width: 'full',
      order: 5,
      options: [
        { label: '1–10 users', value: '1-10' },
        { label: '11–50 users', value: '11-50' },
        { label: '51–250 users', value: '51-250' },
        { label: '250+ users', value: '250+' },
      ],
    },
    { form: contact.id, type: 'TEXTAREA' as const, label: 'How can we help?', name: 'message', required: false, width: 'full', order: 6, placeholder: 'Where do your files live today?' },

    { form: quote.id, type: 'NAME' as const, label: 'Full name', name: 'name', required: true, width: 'half', order: 1 },
    { form: quote.id, type: 'EMAIL' as const, label: 'Work email', name: 'email', required: true, width: 'half', order: 2 },
    { form: quote.id, type: 'PHONE' as const, label: 'Phone', name: 'phone', required: true, width: 'half', order: 3 },
    { form: quote.id, type: 'COMPANY' as const, label: 'Company', name: 'company', required: true, width: 'half', order: 4 },
    { form: quote.id, type: 'NUMBER' as const, label: 'Number of users', name: 'seats', required: false, width: 'half', order: 5 },
    { form: quote.id, type: 'TEXTAREA' as const, label: 'Anything we should know?', name: 'message', required: false, width: 'full', order: 6 },
  ];

  for (const f of fields) {
    await prisma.formField.upsert({
      where: { formId_name: { formId: f.form, name: f.name } },
      update: {},
      create: {
        formId: f.form,
        type: f.type,
        label: f.label,
        name: f.name,
        isRequired: f.required,
        width: f.width,
        sortOrder: f.order,
        placeholder: 'placeholder' in f ? (f.placeholder as string) : null,
        options: 'options' in f ? (f.options as Prisma.InputJsonValue) : [],
      },
    });
  }

  // Point every product CTA at the quote form.
  await prisma.product.updateMany({ where: { ctaFormId: null }, data: { ctaFormId: quote.id } });
  console.log('  forms: contact-sales, request-quote');
}

export async function seedPages() {
  const pages = [
    { slug: '', title: 'Home', isHomepage: true, sections: demoHome, seoTitle: 'Authorised Dropbox Reseller — licences, migration and support' },
    { slug: 'pricing', title: 'Pricing', isHomepage: false, sections: demoPricing, seoTitle: 'Dropbox pricing and plan comparison' },
    { slug: 'contact', title: 'Contact', isHomepage: false, sections: demoContact, seoTitle: 'Contact a Dropbox specialist' },
    { slug: 'about', title: 'About', isHomepage: false, sections: demoAbout, seoTitle: 'About us' },
  ];

  const countryId = await defaultCountryId();

  for (const page of pages) {
    const existing = await prisma.page.findUnique({
      where: { countryId_slug: { countryId, slug: page.slug } },
    });
    if (existing) continue;
    await prisma.page.create({
      data: {
        countryId,
        slug: page.slug,
        title: page.title,
        isHomepage: page.isHomepage,
        status: 'PUBLISHED',
        publishedAt: new Date(),
        seoTitle: page.seoTitle,
        sections: {
          create: page.sections.map((s, index) => ({
            blockType: s.blockType,
            name: s.name,
            sortOrder: (index + 1) * 10,
            content: s.content as Prisma.InputJsonValue,
            settings: s.settings as Prisma.InputJsonValue,
          })),
        },
      },
    });
  }
  console.log(`  pages: ${pages.length}`);
}

const POSTS = [
  {
    title: 'Google Drive to Dropbox: a migration checklist that actually works',
    slug: 'google-drive-to-dropbox-migration-checklist',
    category: 'Migration',
    excerpt:
      'The order you migrate in matters more than the tool you use. Here is the sequence we run for teams moving off Google Drive.',
    content: `<p>Most Drive-to-Dropbox migrations go wrong in the same three places: shared drives with inherited permissions, files owned by people who have already left, and Google-native documents that do not have a direct equivalent.</p>
<h2>1. Inventory before you move anything</h2><p>Export a full file listing with owner, last-modified date and sharing scope. Anything untouched for two years is a candidate for archive rather than migration — this routinely cuts the volume by a third.</p>
<h2>2. Resolve orphaned ownership first</h2><p>Files owned by departed employees will silently fail or land in the wrong place. Reassign ownership in Drive before the migration starts, not during it.</p>
<h2>3. Map sharing, do not copy it</h2><p>Inherited permissions on nested Drive folders rarely reflect what the team actually needs. Use the migration as the moment to design team folders deliberately.</p>
<h2>4. Convert Google-native files intentionally</h2><p>Docs, Sheets and Slides convert to Office formats or stay as links. Decide per team — creative teams usually want the link, finance usually wants the file.</p>
<h2>5. Run a delta pass after cutover</h2><p>Users keep working during the migration. A delta sync on cutover weekend catches everything created after the initial pass.</p>
<p>Run in this order and a mid-size migration finishes over a weekend with no lost files.</p>`,
    tags: ['Migration', 'Google Drive', 'Checklist'],
    featured: true,
  },
  {
    title: 'Dropbox Business Standard vs Advanced: which one does your team need?',
    slug: 'dropbox-business-standard-vs-advanced',
    category: 'Guides',
    excerpt:
      'The difference is not really storage. It is administration, compliance and how much control you need to delegate.',
    content: `<p>Teams usually compare Standard and Advanced on storage. That is the least interesting difference.</p>
<h2>Storage is rarely the deciding factor</h2><p>Standard gives you 5 TB shared. Most teams under 30 people never approach that. If you are a media or architecture practice, you will — and then Advanced is obvious.</p>
<h2>Administration is the real difference</h2><p>Advanced adds tiered admin roles. If more than one person administers Dropbox, this alone justifies the upgrade: you can delegate user management without handing over full control.</p>
<h2>Compliance requirements</h2><p>SSO, device approvals, legal hold and extended audit logs are all Advanced features. If you have been through a security questionnaire recently, you already know whether you need them.</p>
<h2>A simple rule</h2><p>Under 25 users, no SSO requirement and no compliance regime: Standard. Anything else: Advanced. The price difference is smaller than the cost of one failed security review.</p>`,
    tags: ['Guides', 'Plans'],
    featured: true,
  },
  {
    title: 'Five Dropbox admin settings worth changing on day one',
    slug: 'dropbox-admin-settings-day-one',
    category: 'Security',
    excerpt: 'Defaults are built for the widest audience. These five changes take ten minutes and remove most of the risk.',
    content: `<p>Dropbox ships with sensible defaults for the broadest possible audience. For a business tenancy, five of them are worth changing immediately.</p>
<h2>1. Restrict external sharing to a default of view-only</h2><p>Edit access should be a deliberate choice, not the default.</p>
<h2>2. Turn on link expiry for external shares</h2><p>Ninety days is a reasonable default. Permanent public links are how data leaks quietly.</p>
<h2>3. Require device approval</h2><p>Available on Advanced. It stops company data landing on unmanaged personal machines.</p>
<h2>4. Set up team folder structure before inviting users</h2><p>Retrofitting structure after 200 people have made their own folders is an order of magnitude more work.</p>
<h2>5. Enable and actually review the activity log</h2><p>Set a monthly reminder. Most anomalies are obvious once someone looks.</p>`,
    tags: ['Security', 'Administration'],
    featured: false,
  },
];

export async function seedBlog() {
  const admin = await prisma.user.findFirst({ where: { roles: { slug: 'super-admin' } } });
  const countryId = await defaultCountryId();

  for (const post of POSTS) {
    const category = await prisma.blogCategory.upsert({
      where: { slug: post.category.toLowerCase().replace(/\s+/g, '-') },
      update: {},
      create: { name: post.category, slug: post.category.toLowerCase().replace(/\s+/g, '-') },
    });

    const existing = await prisma.blogPost.findUnique({
      where: { countryId_slug: { countryId, slug: post.slug } },
    });
    if (existing) continue;

    const words = post.content.replace(/<[^>]*>/g, ' ').split(/\s+/).filter(Boolean).length;
    const created = await prisma.blogPost.create({
      data: {
        countryId,
        title: post.title,
        slug: post.slug,
        status: 'PUBLISHED',
        publishedAt: new Date(Date.now() - POSTS.indexOf(post) * 86_400_000 * 7),
        excerpt: post.excerpt,
        content: post.content,
        readingTime: Math.max(1, Math.round(words / 220)),
        isFeatured: post.featured,
        categoryId: category.id,
        authorId: admin?.id ?? null,
        seoTitle: post.title,
        seoDescription: post.excerpt,
      },
    });

    for (const tagName of post.tags) {
      const tag = await prisma.blogTag.upsert({
        where: { slug: tagName.toLowerCase().replace(/\s+/g, '-') },
        update: {},
        create: { name: tagName, slug: tagName.toLowerCase().replace(/\s+/g, '-') },
      });
      await prisma.blogPostTag.upsert({
        where: { postId_tagId: { postId: created.id, tagId: tag.id } },
        update: {},
        create: { postId: created.id, tagId: tag.id },
      });
    }
  }
  console.log(`  blog posts: ${POSTS.length}`);
}

export async function seedNavigation() {
  const countryId = await defaultCountryId();
  const menu = (slug: string, name: string, location: 'HEADER' | 'FOOTER' | 'LEGAL') =>
    prisma.navigation.upsert({
      where: { countryId_slug: { countryId, slug } },
      update: {},
      create: { countryId, slug, name, location },
    });

  const header = await menu('main-menu', 'Main menu', 'HEADER');
  const footer = await menu('footer-company', 'Company', 'FOOTER');
  const footerResources = await menu('footer-resources', 'Resources', 'FOOTER');
  const legal = await menu('legal', 'Legal', 'LEGAL');

  const existing = await prisma.navigationItem.count({ where: { navigationId: header.id } });
  if (existing > 0) {
    console.log('  navigation: already present');
    return;
  }

  const products = await prisma.product.findMany({ orderBy: { sortOrder: 'asc' }, take: 4 });

  const plans = await prisma.navigationItem.create({
    data: { navigationId: header.id, label: 'Plans', linkType: 'INTERNAL', url: '/pricing', sortOrder: 10 },
  });
  let order = 10;
  for (const product of products) {
    await prisma.navigationItem.create({
      data: {
        navigationId: header.id,
        parentId: plans.id,
        label: product.name,
        linkType: 'PRODUCT',
        productId: product.id,
        description: product.shortDescription,
        sortOrder: order,
      },
    });
    order += 10;
  }

  await prisma.navigationItem.createMany({
    data: [
      { navigationId: header.id, label: 'Pricing', linkType: 'INTERNAL', url: '/pricing', sortOrder: 20 },
      { navigationId: header.id, label: 'Blog', linkType: 'INTERNAL', url: '/blog', sortOrder: 30 },
      { navigationId: header.id, label: 'About', linkType: 'INTERNAL', url: '/about', sortOrder: 40 },
      { navigationId: header.id, label: 'Contact', linkType: 'INTERNAL', url: '/contact', sortOrder: 50 },

      { navigationId: footer.id, label: 'About', linkType: 'INTERNAL', url: '/about', sortOrder: 10 },
      { navigationId: footer.id, label: 'Contact', linkType: 'INTERNAL', url: '/contact', sortOrder: 20 },
      { navigationId: footer.id, label: 'Pricing', linkType: 'INTERNAL', url: '/pricing', sortOrder: 30 },

      { navigationId: footerResources.id, label: 'Blog', linkType: 'INTERNAL', url: '/blog', sortOrder: 10 },
      { navigationId: footerResources.id, label: 'Migration guide', linkType: 'INTERNAL', url: '/blog/google-drive-to-dropbox-migration-checklist', sortOrder: 20 },

      { navigationId: legal.id, label: 'Privacy', linkType: 'INTERNAL', url: '/privacy', sortOrder: 10 },
      { navigationId: legal.id, label: 'Terms', linkType: 'INTERNAL', url: '/terms', sortOrder: 20 },
    ],
  });
  console.log('  navigation: header, footer, legal');
}

export async function seedLeads() {
  const count = await prisma.lead.count();
  if (count > 0) {
    console.log('  leads: already present');
    return;
  }

  const products = await prisma.product.findMany();
  const form = await prisma.form.findFirst({ where: { slug: 'contact-sales' } });
  const staff = await prisma.user.findFirst({ where: { roles: { slug: 'super-admin' } } });

  const samples = [
    { name: 'Ananya Rao', email: 'ananya.rao@meridianlabs.example', company: 'Meridian Labs', status: 'NEW' as const, source: 'Google Ads', utmSource: 'google', utmMedium: 'cpc', utmCampaign: 'dropbox-business-in', days: 0 },
    { name: 'Tom Hargreaves', email: 'tom@blueharbour.example', company: 'Blue Harbour', status: 'CONTACTED' as const, source: 'Organic search', utmSource: 'google', utmMedium: 'organic', utmCampaign: null, days: 2 },
    { name: 'Fatima Khan', email: 'f.khan@vertexlegal.example', company: 'Vertex Legal', status: 'QUALIFIED' as const, source: 'LinkedIn', utmSource: 'linkedin', utmMedium: 'social', utmCampaign: 'q1-awareness', days: 5 },
    { name: 'Marcus Bell', email: 'marcus@acmestudios.example', company: 'Acme Studios', status: 'PROPOSAL' as const, source: 'Referral', utmSource: 'referral', utmMedium: 'partner', utmCampaign: null, days: 9 },
    { name: 'Lena Fischer', email: 'lena@northwind.example', company: 'Northwind', status: 'NEGOTIATION' as const, source: 'Google Ads', utmSource: 'google', utmMedium: 'cpc', utmCampaign: 'dropbox-enterprise', days: 14 },
    { name: 'Ravi Shankar', email: 'ravi@lumen.example', company: 'Lumen Consulting', status: 'WON' as const, source: 'Contact form', utmSource: 'direct', utmMedium: 'none', utmCampaign: null, days: 22 },
    { name: 'Grace Nolan', email: 'grace@harbourpoint.example', company: 'Harbour Point', status: 'LOST' as const, source: 'Organic search', utmSource: 'bing', utmMedium: 'organic', utmCampaign: null, days: 30 },
    { name: 'Sam Ortiz', email: 'sam@driftworks.example', company: 'Driftworks', status: 'NEW' as const, source: 'Product CTA', utmSource: 'google', utmMedium: 'cpc', utmCampaign: 'dropbox-business-in', days: 1 },
  ];

  const leadCountryId = await defaultCountryId();

  let index = 0;
  for (const s of samples) {
    const product = products[index % products.length];
    const createdAt = new Date(Date.now() - s.days * 86_400_000);
    const lead = await prisma.lead.create({
      data: {
        countryId: leadCountryId,
        name: s.name,
        email: s.email,
        phone: '+91 98765 4321' + index,
        company: s.company,
        message: 'We are evaluating Dropbox for the team and would like pricing.',
        status: s.status,
        pipelineOrder: index * 10,
        source: s.source,
        campaign: s.utmCampaign,
        ctaLabel: 'Talk to Sales',
        utmSource: s.utmSource,
        utmMedium: s.utmMedium,
        utmCampaign: s.utmCampaign,
        firstUtmSource: s.utmSource,
        firstUtmMedium: s.utmMedium,
        firstUtmCampaign: s.utmCampaign,
        firstTouchAt: createdAt,
        landingUrl: '/pricing',
        productId: product?.id ?? null,
        formId: form?.id ?? null,
        assignedToId: index % 3 === 0 ? staff?.id ?? null : null,
        value: s.status === 'WON' ? new Prisma.Decimal('239000.00') : null,
        createdAt,
        updatedAt: createdAt,
      },
    });
    await prisma.leadActivity.create({
      data: {
        leadId: lead.id,
        type: 'CREATED',
        summary: `Lead captured from ${s.source}`,
        createdAt,
      },
    });
    index += 1;
  }
  console.log(`  leads: ${samples.length}`);
}

export async function seedCustomers() {
  const count = await prisma.customer.count();
  if (count > 0) return;
  const staff = await prisma.user.findFirst({ where: { roles: { slug: 'super-admin' } } });
  const advanced = await prisma.product.findUnique({ where: { slug: 'dropbox-business-advanced' } });

  const customer = await prisma.customer.create({
    data: {
      name: 'Ravi Shankar',
      company: 'Lumen Consulting',
      email: 'ravi@lumen.example',
      phone: '+91 98765 43219',
      status: 'ACTIVE',
      assignedToId: staff?.id ?? null,
    },
  });

  if (advanced) {
    await prisma.customerProduct.create({
      data: {
        customerId: customer.id,
        productId: advanced.id,
        quantity: 120,
        seats: 120,
        unitPrice: new Prisma.Decimal('19900.00'),
        startsAt: new Date(),
        renewsAt: new Date(Date.now() + 365 * 86_400_000),
      },
    });
  }

  const wonLead = await prisma.lead.findFirst({ where: { email: 'ravi@lumen.example' } });
  if (wonLead) {
    await prisma.lead.update({ where: { id: wonLead.id }, data: { customerId: customer.id } });
  }
  console.log('  customers: 1');
}

/**
 * The initial cities and their draft landing pages: Delhi and Gurugram in the
 * root market (`/delhi`, `/gurugram`) and Dubai in the UAE (`/ae/dubai`).
 *
 * Everything is a draft — the cities and their pages answer 404 until an
 * editor reviews them and publishes — and the copy is a neutral starting point
 * that names the city and nothing else: no offices, addresses, testimonials,
 * certifications or authorisations are invented. Existing cities and pages are
 * never changed, so this can be run again safely. Run a URL scan afterwards
 * (Slug & URL Manager) so the registry knows the new pages.
 */
export async function seedCities() {
  const cities = [
    { country: 'IN', name: 'Delhi', slug: 'delhi', region: null },
    { country: 'IN', name: 'Gurugram', slug: 'gurugram', region: 'Haryana' },
    { country: 'AE', name: 'Dubai', slug: 'dubai', region: null },
  ];
  let created = 0;
  for (const entry of cities) {
    const country = await prisma.country.findUnique({ where: { code: entry.country } });
    if (!country) continue;
    let city = await prisma.city.findUnique({ where: { countryId_slug: { countryId: country.id, slug: entry.slug } } });
    if (!city) {
      try {
        city = await prisma.city.create({
          data: {
            countryId: country.id,
            name: entry.name,
            slug: entry.slug,
            region: entry.region,
            status: 'DRAFT',
            isActive: false,
            isPublished: false,
          },
        });
        created += 1;
      } catch (error) {
        // The address is already somebody else's (the database refuses it):
        // leave it alone rather than move anything to make room.
        console.log(`  cities: skipped ${entry.name} — ${error instanceof Error ? error.message.split('\n').pop() : 'address in use'}`);
        continue;
      }
    }
    const existing = await prisma.page.findUnique({ where: { countryId_slug: { countryId: country.id, slug: entry.slug } } });
    if (existing) continue;
    const page = await prisma.page.create({
      data: {
        countryId: country.id,
        title: `Autodesk reseller in ${entry.name}`,
        slug: entry.slug,
        status: 'DRAFT',
        cityId: city.id,
        isCityHomepage: true,
        seoTitle: `Autodesk reseller in ${entry.name}`,
        seoDescription: `Buy and renew Autodesk subscriptions for teams in ${entry.name}${entry.region ? `, ${entry.region}` : ''}.`,
        primaryKeyword1: `autodesk reseller ${entry.name.toLowerCase()}`,
        sections: {
          create: [
            {
              blockType: 'hero',
              name: 'City hero',
              sortOrder: 10,
              content: {
                eyebrow: entry.name,
                heading: `Autodesk reseller in ${entry.name}`,
                description: `Licences, renewals and help choosing the right Autodesk products for teams in ${entry.name}.`,
                primaryCtaLabel: 'Talk to Sales',
                primaryCtaUrl: country.slug ? `/${country.slug}/contact` : '/contact',
                alignment: 'left',
              },
              settings: { background: 'muted', paddingTop: 'lg', paddingBottom: 'lg' },
            },
            {
              blockType: 'richText',
              name: 'Local details — review before publishing',
              sortOrder: 20,
              content: {
                heading: `Working with teams in ${entry.name}`,
                content:
                  '<p>Replace this paragraph with what is genuinely local: who you serve here, how you support them and how to reach you. Only state what is true — do not add addresses, offices, reviews or certifications that do not exist.</p>',
              },
              settings: {},
            },
          ],
        },
      },
    });
    await prisma.page.update({ where: { id: page.id }, data: { groupKey: page.id } });
  }
  console.log(`  cities: ${created} added as drafts (${cities.map((entry) => entry.slug).join(', ')})`);
}

async function main() {
  console.log('Seeding database…');
  // Markets come first: pages, articles, menus and leads all belong to one.
  await seedCountries();
  await seedPermissions();
  await seedRoles();
  await seedAdmin();
  await seedSettings();

  // Opt-in, not opt-out. A production operator who sets RUN_SEED=true to create
  // the first admin must not silently get demo pages, products and fake leads
  // on their live site because they did not know to say no.
  if (/^(1|true|yes|on)$/i.test((process.env.SEED_DEMO_CONTENT || '').trim())) {
    await seedProducts();
    await seedForms();
    await seedPages();
    await seedCities();
    await seedBlog();
    await seedNavigation();
    await seedLeads();
    await seedCustomers();
  } else {
    console.log('  demo content: skipped (set SEED_DEMO_CONTENT=true to include it)');
  }
  console.log('Seed complete.');
}

/*
 * Only when this file is what was run.
 *
 * The steps above are imported by `prisma/seed/*.ts`, one runnable file each,
 * so that an operator — or the Seed files screen in the admin — can re-run a
 * single part of the seed. Without this guard, importing one step would run
 * every one of them.
 */
if (isDirectRun('seed')) {
  main()
    .then(async () => {
      await prisma.$disconnect();
    })
    .catch(async (error) => {
      // The message, not the stack: a seed failure is a configuration problem and
      // the stack tells an operator nothing useful while risking echoing input.
      console.error(`Seed failed: ${error instanceof Error ? error.message : String(error)}`);
      await prisma.$disconnect().catch(() => undefined);
      process.exit(1);
    });
}

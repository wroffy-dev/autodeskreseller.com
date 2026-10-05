/**
 * Startup environment checks.
 *
 * Deliberately dependency-free — not even zod.
 *
 * `src/instrumentation.ts` imports this, and Next.js bundles instrumentation for
 * the Edge runtime alongside middleware. Importing the zod-based schema module
 * here pushed the middleware bundle from 88 KB to 184 KB, which is paid on every
 * request's cold start. These checks are plain string and URL tests; they never
 * needed a schema library.
 *
 * No error raised here contains a secret value — only a variable's name and what
 * is wrong with it. These messages go to container logs, which are far more
 * widely readable than the secrets store.
 */

// ---------------------------------------------------------------------------
// Startup validation
// ---------------------------------------------------------------------------

export type EnvProblem = { variable: string; problem: string };

/**
 * What these checks actually need: a bag of string values.
 *
 * Structural rather than `NodeJS.ProcessEnv`, which in this project requires
 * `NODE_ENV` and so would force every caller — tests included — to supply
 * fields the checks never read.
 */
export type EnvSource = Record<string, string | undefined>;

/**
 * Everything that must be present for a production deployment to work, and the
 * conditional groups that only apply once a feature is switched on.
 *
 * Returns problems rather than throwing so a caller can report all of them at
 * once — an operator fixing one variable per restart is a slow afternoon.
 */
export function collectEnvProblems(source: EnvSource = process.env): EnvProblem[] {
  const problems: EnvProblem[] = [];
  const present = (name: string) => Boolean(source[name]?.trim());
  const require = (name: string, problem: string) => {
    if (!present(name)) problems.push({ variable: name, problem });
  };

  // --- Always required in production -------------------------------------
  require('DATABASE_URL', 'is required — the PostgreSQL connection string');
  require('AUTH_SECRET', 'is required — generate with `openssl rand -base64 32`');
  require('NEXTAUTH_URL', 'is required — the full public URL, e.g. https://example.com');
  require('NEXT_PUBLIC_SITE_URL', 'is required — normally the same as NEXTAUTH_URL');
  require('ENCRYPTION_KEY', 'is required — encrypts stored integration secrets');
  require(
    'MFA_ENCRYPTION_KEY',
    'is required — encrypts TOTP secrets; without it nobody can enrol in two-step verification',
  );

  const databaseUrl = source.DATABASE_URL?.trim();
  if (databaseUrl && !/^postgres(ql)?:\/\//i.test(databaseUrl)) {
    problems.push({ variable: 'DATABASE_URL', problem: 'must start with postgresql://' });
  }

  if (present('AUTH_SECRET') && (source.AUTH_SECRET?.trim().length ?? 0) < 16) {
    problems.push({ variable: 'AUTH_SECRET', problem: 'must be at least 16 characters' });
  }
  if (present('MFA_ENCRYPTION_KEY') && (source.MFA_ENCRYPTION_KEY?.trim().length ?? 0) < 32) {
    problems.push({ variable: 'MFA_ENCRYPTION_KEY', problem: 'must be at least 32 characters' });
  }

  for (const name of ['NEXTAUTH_URL', 'NEXT_PUBLIC_SITE_URL'] as const) {
    const value = source[name]?.trim();
    if (!value) continue;
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:') {
        problems.push({ variable: name, problem: 'must use https:// in production' });
      }
    } catch {
      problems.push({ variable: name, problem: 'is not a valid absolute URL' });
    }
  }

  // --- Conditional: media storage ----------------------------------------
  //
  // Nothing is required for the default driver. A deployment that stores media
  // on its own disk must be able to boot with no bucket, no account and no key
  // anywhere in its environment — that is the whole point of `local`, and a
  // check that demanded S3 variables regardless would quietly make the cloud
  // mandatory again.
  const storageDriver = (source.STORAGE_DRIVER || source.STORAGE_PROVIDER || 'local').toLowerCase();
  const driverName = source.STORAGE_DRIVER ? 'STORAGE_DRIVER' : 'STORAGE_PROVIDER';
  if (storageDriver === 's3' || storageDriver === 'r2') {
    for (const name of ['S3_BUCKET', 'S3_ACCESS_KEY', 'S3_SECRET_KEY'] as const) {
      require(name, `is required when ${driverName}=${storageDriver}`);
    }
    require(
      'S3_PUBLIC_URL',
      `is required when ${driverName}=${storageDriver} — the public base URL that serves the bucket`,
    );
    if (storageDriver === 'r2') {
      require('S3_ENDPOINT', 'is required for Cloudflare R2');
    }
  }

  // --- Conditional: backup storage ---------------------------------------
  if ((source.BACKUP_STORAGE_DRIVER || 'local').toLowerCase() === 's3') {
    for (const name of [
      'BACKUP_S3_BUCKET',
      'BACKUP_S3_ACCESS_KEY_ID',
      'BACKUP_S3_SECRET_ACCESS_KEY',
    ] as const) {
      require(name, 'is required when BACKUP_STORAGE_DRIVER=s3');
    }
  }

  // --- Conditional: SMTP --------------------------------------------------
  // Only once a host is set: a deployment with no email configured is valid,
  // and SMTP can also be configured from Admin → Settings → Email instead.
  if (present('SMTP_HOST')) {
    require('MAIL_FROM', 'is required when SMTP_HOST is set');
    const port = Number(source.SMTP_PORT);
    if (source.SMTP_PORT && (!Number.isInteger(port) || port < 1 || port > 65535)) {
      problems.push({ variable: 'SMTP_PORT', problem: 'must be a port number between 1 and 65535' });
    }
  }

  // --- Conditional: scheduled backups ------------------------------------
  if (present('CRON_SECRET') && (source.CRON_SECRET?.trim().length ?? 0) < 16) {
    problems.push({
      variable: 'CRON_SECRET',
      problem: 'must be at least 16 characters, or the scheduled-backup endpoint stays disabled',
    });
  }

  // --- Conditional: Deskzo CRM -------------------------------------------
  // Off when neither key is set. Half a key pair is a mistake worth stopping
  // for: every lead would quietly queue against a CRM it can never reach.
  if (present('DESKZO_KEY_ID') || present('DESKZO_SECRET')) {
    require('DESKZO_KEY_ID', 'is required when DESKZO_SECRET is set');
    require('DESKZO_SECRET', 'is required when DESKZO_KEY_ID is set');
  }
  if (present('DESKZO_API_URL') && !/^https:\/\//i.test(source.DESKZO_API_URL!.trim())) {
    // The key travels in every request's Authorization header.
    problems.push({ variable: 'DESKZO_API_URL', problem: 'must be an https:// URL' });
  }

  // --- Conditional: seeding ----------------------------------------------
  if (/^(1|true|yes|on)$/i.test((source.RUN_SEED || '').trim())) {
    problems.push(...collectSeedProblems(source));
  }

  return problems;
}

/**
 * Seed-specific checks, applied only when RUN_SEED is on.
 *
 * The password rules are stricter than the application's own policy on
 * purpose: this account is a super admin created from an environment variable,
 * which is the single most valuable credential in the deployment.
 */
export function collectSeedProblems(source: EnvSource = process.env): EnvProblem[] {
  const problems: EnvProblem[] = [];
  const email = source.SEED_ADMIN_EMAIL?.trim();
  const password = source.SEED_ADMIN_PASSWORD ?? '';

  if (!email && !password) {
    // Seeding roles, permissions and settings without an admin is legitimate.
    return problems;
  }

  if (!email) {
    problems.push({ variable: 'SEED_ADMIN_EMAIL', problem: 'is required alongside a password' });
  } else if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) {
    problems.push({ variable: 'SEED_ADMIN_EMAIL', problem: 'is not a valid email address' });
  }

  if (!password) {
    problems.push({ variable: 'SEED_ADMIN_PASSWORD', problem: 'is required alongside an email' });
    return problems;
  }

  const weaknesses: string[] = [];
  if (password.length < 14) weaknesses.push('at least 14 characters');
  if (!/[a-z]/.test(password)) weaknesses.push('a lowercase letter');
  if (!/[A-Z]/.test(password)) weaknesses.push('an uppercase letter');
  if (!/[0-9]/.test(password)) weaknesses.push('a number');
  if (!/[^A-Za-z0-9]/.test(password)) weaknesses.push('a symbol');

  // Compared case-insensitively against the obvious placeholders, because
  // "ChangeMe123!" satisfies every rule above and is still a published secret.
  const banned = [
    'password',
    'changeme',
    'change-me',
    'admin123',
    'letmein',
    'welcome1',
    'dropbox',
    'qwerty',
    'secret',
  ];
  const lowered = password.toLowerCase();
  if (banned.some((term) => lowered.includes(term))) {
    weaknesses.push('no common word such as “password”, “changeme” or “admin123”');
  }

  if (weaknesses.length > 0) {
    problems.push({
      variable: 'SEED_ADMIN_PASSWORD',
      // The password itself is never echoed — only what it lacks.
      problem: `is too weak for a super-admin account; it needs ${weaknesses.join(', ')}`,
    });
  }

  return problems;
}

/**
 * Boot gate. Throws with every problem listed, so one restart fixes everything.
 *
 * Only enforced when NODE_ENV is production: a developer running `next dev`
 * without SMTP or R2 configured should not be blocked.
 */
export function assertProductionEnv(source: EnvSource = process.env): void {
  if (source.NODE_ENV !== 'production') return;
  if (/^(1|true|yes|on)$/i.test((source.SKIP_ENV_VALIDATION || '').trim())) return;

  const problems = collectEnvProblems(source);
  if (problems.length === 0) return;

  const lines = problems.map((p) => `  • ${p.variable} ${p.problem}`).join('\n');
  throw new Error(
    `Environment is not ready for production.\n${lines}\n` +
      'Set these in Azure Container Apps → Containers → Environment variables, ' +
      'or in your .env file for Docker/Coolify. See docs/AZURE-ENVIRONMENT.md.',
  );
}

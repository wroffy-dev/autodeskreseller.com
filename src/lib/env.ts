import { z } from 'zod';

/**
 * Centralised environment validation.
 *
 * Two goals that pull in opposite directions, resolved deliberately:
 *
 *  - A missing *critical* variable must stop the container at boot, loudly,
 *    rather than surfacing as a confusing runtime error the first time someone
 *    tries to sign in. `assertProductionEnv()` does that.
 *  - A missing *optional integration* must not prevent boot. A deployment with
 *    no SMTP should still serve pages; it just cannot send email.
 *
 * So variables are validated conditionally: storage credentials only matter
 * when STORAGE_PROVIDER is s3/r2, backup credentials only when the backup
 * driver is s3, SMTP only when a host is configured, seed variables only when
 * RUN_SEED is true.
 *
 * No error raised here ever contains a secret value — only the variable's name
 * and what is wrong with it. That matters because these messages go to
 * container logs, which are far more widely readable than the secrets store.
 */

const bool = (defaultValue: boolean) =>
  z
    .string()
    .optional()
    .transform((value) => {
      if (value === undefined || value === '') return defaultValue;
      return /^(1|true|yes|on)$/i.test(value.trim());
    });

const serverSchema = z.object({
  DATABASE_URL: z.string().min(1, 'is required'),
  AUTH_SECRET: z.string().min(16, 'must be at least 16 characters'),
  NEXTAUTH_URL: z.string().url().optional(),
  NEXT_PUBLIC_SITE_URL: z.string().url().optional(),
  ENCRYPTION_KEY: z.string().optional(),
  MFA_ENCRYPTION_KEY: z.string().optional(),
  MFA_ISSUER: z.string().optional(),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.string().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_ENCRYPTION: z.enum(['none', 'tls', 'ssl']).optional(),
  MAIL_FROM: z.string().optional(),

  /** The driver. STORAGE_PROVIDER is the previous name and is still read. */
  STORAGE_DRIVER: z.enum(['local', 's3', 'r2']).optional(),
  STORAGE_PROVIDER: z.enum(['local', 's3', 'r2']).optional(),
  /** Where local uploads are written. LOCAL_UPLOAD_DIR is the previous name. */
  UPLOAD_DIR: z.string().optional(),
  LOCAL_UPLOAD_DIR: z.string().optional(),
  /** The URL prefix local media is served under. */
  MEDIA_PUBLIC_PATH: z.string().optional(),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_PUBLIC_URL: z.string().optional(),
  S3_FORCE_PATH_STYLE: z.string().optional(),

  /**
   * Upload ceiling. MAX_UPLOAD_SIZE_MB is read first and MAX_UPLOAD_KB after
   * it; both fall back to 150 KB when unset or invalid.
   */
  MAX_UPLOAD_SIZE_MB: z.string().optional(),
  MAX_UPLOAD_KB: z.string().optional(),

  BACKUP_STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  BACKUP_LOCAL_PATH: z.string().optional(),
  BACKUP_S3_ENDPOINT: z.string().optional(),
  BACKUP_S3_REGION: z.string().optional(),
  BACKUP_S3_BUCKET: z.string().optional(),
  BACKUP_S3_ACCESS_KEY_ID: z.string().optional(),
  BACKUP_S3_SECRET_ACCESS_KEY: z.string().optional(),
  BACKUP_S3_FORCE_PATH_STYLE: z.string().optional(),
  BACKUP_ENCRYPTION_KEY: z.string().optional(),
  CRON_SECRET: z.string().optional(),

  /** Deskzo CRM lead capture API. Leads are pushed only when both keys are set. */
  DESKZO_API_URL: z.string().optional(),
  DESKZO_KEY_ID: z.string().optional(),
  DESKZO_SECRET: z.string().optional(),

  RUN_MIGRATIONS: bool(true),
  RUN_SEED: bool(false),
  SEED_ADMIN_EMAIL: z.string().optional(),
  SEED_ADMIN_PASSWORD: z.string().optional(),
  SEED_ADMIN_NAME: z.string().optional(),
  SEED_DEMO_CONTENT: bool(false),
});

export type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | null = null;

export function env(): ServerEnv {
  if (cached) return cached;
  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    // Only names and reasons — never the offending value.
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'env'} ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration — ${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Test hook: forces the next `env()` call to re-read `process.env`. */
export function __resetEnvCache(): void {
  cached = null;
}

export {
  collectEnvProblems,
  collectSeedProblems,
  assertProductionEnv,
  type EnvProblem,
  type EnvSource,
} from './env-validation';

/** Base URL used for canonicals, sitemaps and absolute links in emails. */
export function siteUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXTAUTH_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined) ||
    'http://localhost:3000';
  return raw.replace(/\/+$/, '');
}

export const isProduction = process.env.NODE_ENV === 'production';

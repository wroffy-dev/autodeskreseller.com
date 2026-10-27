import { existsSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'prisma/config';

// With a config file present the Prisma CLI no longer reads `.env` on its own,
// so load it here. Node's built-in loader rather than dotenv: dotenv is a
// devDependency and the runtime image, which runs `prisma migrate deploy`, has
// none. Variables already set in the environment win over the file, and
// containers that get their settings from the platform have no `.env` at all.
const envFile = path.join(import.meta.dirname, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    path: path.join('prisma', 'migrations'),
    seed: 'tsx prisma/seed.ts',
  },
});

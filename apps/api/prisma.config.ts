// Prisma config (replaces the deprecated package.json#prisma block).
// NOTE: with a prisma.config.ts present, the Prisma CLI no longer auto-loads
// .env — the dotenv import below preserves that behavior for local commands.
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    seed: 'ts-node --transpile-only prisma/seed.ts',
  },
});

// Runs before every test file.
// reflect-metadata must be imported before any Nest decorator is evaluated.
import 'reflect-metadata';

// Load apps/api/.env so local runs pick up DATABASE_URL without extra setup.
// An already-set DATABASE_URL (CI) always wins — dotenv never overwrites.
import { config } from 'dotenv';
import { resolve } from 'node:path';

config({ path: resolve(__dirname, '..', '.env'), quiet: true });

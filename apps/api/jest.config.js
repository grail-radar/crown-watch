/**
 * Jest config for @crown-watch/api.
 *
 * Two kinds of test live here:
 *  - pure unit tests (hashing, slugs, media parsing) — no I/O, instant
 *  - persistence tests that exercise the real Prisma write path against a
 *    throwaway Postgres (docker-compose locally, a service container in CI)
 *
 * Both run from one command; DATABASE_URL decides which database is used.
 */
/** @type {import('jest').Config} */
module.exports = {
  rootDir: 'src',
  testEnvironment: 'node',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/../tsconfig.json' }],
  },
  setupFiles: ['<rootDir>/../test/setup.ts'],
  // Persistence tests share one database; running files in parallel would let
  // them clash on the same rows.
  maxWorkers: 1,
  testTimeout: 30000,
  clearMocks: true,
};

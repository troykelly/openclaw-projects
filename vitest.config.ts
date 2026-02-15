import { defineConfig } from 'vitest/config';

/**
 * Root vitest config — splits the test suite into two projects:
 *
 *   unit         — pure tests (no DB, no HTTP), fileParallelism: true
 *   integration  — DB-dependent tests, fileParallelism: false (serial)
 *
 * Run both:          pnpm test
 * Run unit only:     pnpm test:unit
 * Run integration:   pnpm test:integration
 *
 * The E2E tests (Level 2) are NOT part of this config; they use their
 * own config via `pnpm run test:e2e` (vitest.config.e2e.ts).
 */
export default defineConfig({
  test: {
    projects: ['vitest.config.unit.ts', 'vitest.config.integration.ts'],
  },
});

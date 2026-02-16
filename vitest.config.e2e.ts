import path from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * Vitest config for Level 2 E2E tests only.
 *
 * The root vitest.config.ts excludes packages/openclaw-plugin/tests/e2e/**
 * to prevent E2E tests from running during `pnpm test` (Level 1).
 * This dedicated config includes only the E2E tests and skips the
 * unit-test setup files that aren't needed for E2E.
 */
export default defineConfig({
  test: {
    globals: true,
    testTimeout: 60000,
    include: ['packages/openclaw-plugin/tests/e2e/**/*.test.ts'],
    exclude: ['packages/openclaw-plugin/tests/e2e/jwt-auth.test.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});

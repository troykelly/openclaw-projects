import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    testTimeout: 30000,

    // Tests share one local Postgres database with per-test TRUNCATE cleanup.
    // Parallelism is disabled to avoid migration race conditions. If migrating
    // to per-file temp databases, this could be re-enabled.
    fileParallelism: false,

    // Exclude E2E tests from default test run (Level 2 requires Docker backend)
    // E2E tests are run separately via `pnpm run test:e2e` with RUN_E2E=true
    // Also exclude Playwright E2E tests (they use their own runner) and node_modules
    exclude: [
      'tests/e2e-playwright/**',
      'packages/openclaw-plugin/tests/e2e/**',
      'node_modules/**',
      '**/node_modules/**',
    ],

    // UI component tests use jsdom environment
    environmentMatchGlobs: [['tests/ui/**', 'jsdom']],
    // setup-api.ts disables bearer token auth for tests
    // setup-ui.ts configures jsdom mocks for UI tests
    setupFiles: ['./tests/setup-api.ts', './tests/setup-ui.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});

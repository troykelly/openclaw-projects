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

    // Exclude Playwright E2E tests (they use their own runner) and all node_modules
    exclude: ['tests/e2e-playwright/**', 'node_modules/**', '**/node_modules/**'],

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

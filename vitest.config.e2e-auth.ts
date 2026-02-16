import path from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * Vitest config for JWT auth E2E tests (Issue #1351).
 *
 * Runs against the auth-enabled backend (port 3002 by default).
 * The backend-auth-test service in docker-compose.test.yml runs with
 * JWT_SECRET set and OPENCLAW_PROJECTS_AUTH_DISABLED unset (auth enabled).
 */
export default defineConfig({
  test: {
    globals: true,
    testTimeout: 60000,
    include: ['packages/openclaw-plugin/tests/e2e/jwt-auth.test.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});

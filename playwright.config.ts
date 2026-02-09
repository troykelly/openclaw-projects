import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e-playwright',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'html',
  timeout: 30_000,

  globalSetup: './tests/e2e-playwright/global-setup.ts',

  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    command: 'node --experimental-transform-types --experimental-detect-module src/api/run.ts',
    url: 'http://localhost:3000/health',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    env: {
      OPENCLAW_PROJECTS_AUTH_DISABLED: 'true',
      OPENCLAW_E2E_SESSION_EMAIL: 'e2e-test@example.com',
      RATE_LIMIT_DISABLED: 'true',
      PORT: '3000',
    },
  },
});

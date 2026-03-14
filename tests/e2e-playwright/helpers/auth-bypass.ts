import type { Page, Route } from '@playwright/test';

/**
 * Bypass frontend auth bootstrap for E2E tests.
 *
 * The server runs with OPENCLAW_PROJECTS_AUTH_DISABLED=true but the frontend
 * SPA still tries POST /auth/refresh (which needs a cookie). This helper
 * intercepts that call and returns a synthetic access_token, then intercepts
 * GET /me to return the E2E session email. The server skips JWT verification
 * when auth is disabled, so actual API calls work without a real token.
 *
 * Must be called BEFORE navigating to any page.
 */
export async function bypassAuth(page: Page, email = 'e2e-test@example.com'): Promise<void> {
  // Intercept POST /auth/refresh → return a fake access token
  await page.route('**/auth/refresh', async (route: Route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ access_token: 'e2e-fake-token' }),
      });
    } else {
      await route.continue();
    }
  });

  // Intercept GET /me → return the E2E user email
  await page.route('**/me', async (route: Route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ email }),
      });
    } else {
      await route.continue();
    }
  });
}

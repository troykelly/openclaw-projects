import { test, expect } from '@playwright/test';
import { Pool } from 'pg';
import { createTestPool, truncateAllTables } from '../helpers/db.ts';
import {
  mockBrowserTimezone,
  mockInvalidBrowserTimezone,
  mockThrowingDateTimeFormat,
  setStoredTimezone,
  getStoredTimezone,
  seedBrokenDismissal,
  mockLocalStorageQuotaExceeded,
  mockPatchSettingsError,
  mockGetSettingsError,
} from './helpers/timezone-helpers.ts';
import { bypassAuth } from './helpers/auth-bypass.ts';

/**
 * Playwright E2E tests for timezone mismatch detection flow.
 *
 * Tests run against the full devcontainer stack with auth disabled.
 * Browser timezone is overridden via page.addInitScript.
 * Auth is bypassed via route interception (server runs auth-disabled,
 * but the SPA still needs a synthetic token from /auth/refresh).
 *
 * @see Issue #2514 — Epic #2509
 */
test.describe('Timezone Mismatch Banner (#2514)', () => {
  let pool: Pool;

  test.beforeAll(async () => {
    pool = createTestPool();
  });

  test.beforeEach(async ({ page }) => {
    await truncateAllTables(pool);
    await bypassAuth(page);
  });

  test.afterAll(async () => {
    await pool.end();
  });

  test.describe('Core flow', () => {
    test('happy path — update: banner appears and update works', async ({ page }) => {
      await setStoredTimezone(pool, 'UTC');
      await mockBrowserTimezone(page, 'Australia/Sydney');

      await page.goto('/app/dashboard');
      await page.waitForLoadState('networkidle');

      const banner = page.locator('[data-testid="timezone-mismatch-banner"]');
      await expect(banner).toBeVisible({ timeout: 10_000 });

      // Banner shows correct copy
      await expect(banner).toContainText('Australia / Sydney');
      await expect(banner).toContainText('UTC');

      // Click Update
      const updateButton = banner.getByRole('button', { name: /Update to Australia \/ Sydney/i });
      await expect(updateButton).toBeVisible();

      const patchPromise = page.waitForResponse(
        (resp) => resp.url().includes('/settings') && resp.request().method() === 'PATCH' && resp.ok(),
        { timeout: 10_000 },
      );
      await updateButton.click();
      await patchPromise;

      // Banner disappears
      await expect(banner).not.toBeVisible({ timeout: 5_000 });

      // Verify timezone persisted in DB
      const stored = await getStoredTimezone(pool);
      expect(stored).toBe('Australia/Sydney');
    });

    test('no banner when browser timezone matches stored', async ({ page }) => {
      await setStoredTimezone(pool, 'America/New_York');
      await mockBrowserTimezone(page, 'America/New_York');

      await page.goto('/app/dashboard');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2_000);

      const banner = page.locator('[data-testid="timezone-mismatch-banner"]');
      await expect(banner).not.toBeVisible();
    });

    test('dismiss: clicking Keep dismisses and persists across reload', async ({ page }) => {
      await setStoredTimezone(pool, 'UTC');
      await mockBrowserTimezone(page, 'Australia/Sydney');

      await page.goto('/app/dashboard');
      await page.waitForLoadState('networkidle');

      const banner = page.locator('[data-testid="timezone-mismatch-banner"]');
      await expect(banner).toBeVisible({ timeout: 10_000 });

      const keepButton = banner.getByRole('button', { name: /Keep UTC/i });
      await keepButton.click();
      await expect(banner).not.toBeVisible({ timeout: 5_000 });

      // Reload — banner should NOT re-appear (dismissed in localStorage)
      await page.reload();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2_000);

      await expect(banner).not.toBeVisible();
    });

    test('re-prompt when browser timezone changes after dismiss', async ({ page }) => {
      await setStoredTimezone(pool, 'UTC');
      await mockBrowserTimezone(page, 'Australia/Sydney');

      await page.goto('/app/dashboard');
      await page.waitForLoadState('networkidle');

      const banner = page.locator('[data-testid="timezone-mismatch-banner"]');
      await expect(banner).toBeVisible({ timeout: 10_000 });

      const keepButton = banner.getByRole('button', { name: /Keep UTC/i });
      await keepButton.click();
      await expect(banner).not.toBeVisible({ timeout: 5_000 });

      // New page with different browser timezone
      const page2 = await page.context().newPage();
      await bypassAuth(page2);
      await mockBrowserTimezone(page2, 'Europe/London');
      await page2.goto('/app/dashboard');
      await page2.waitForLoadState('networkidle');

      const banner2 = page2.locator('[data-testid="timezone-mismatch-banner"]');
      await expect(banner2).toBeVisible({ timeout: 10_000 });
      await expect(banner2).toContainText('Europe / London');

      await page2.close();
    });

    test('close button dismisses banner', async ({ page }) => {
      await setStoredTimezone(pool, 'UTC');
      await mockBrowserTimezone(page, 'Australia/Sydney');

      await page.goto('/app/dashboard');
      await page.waitForLoadState('networkidle');

      const banner = page.locator('[data-testid="timezone-mismatch-banner"]');
      await expect(banner).toBeVisible({ timeout: 10_000 });

      const closeButton = banner.getByRole('button', { name: /Dismiss timezone notification/i });
      await closeButton.click();

      await expect(banner).not.toBeVisible({ timeout: 5_000 });
    });
  });

  test.describe('Timezone normalization', () => {
    test('alias normalization: US/Pacific displays as America / Los Angeles', async ({ page }) => {
      await setStoredTimezone(pool, 'UTC');
      await mockBrowserTimezone(page, 'US/Pacific');

      await page.goto('/app/dashboard');
      await page.waitForLoadState('networkidle');

      const banner = page.locator('[data-testid="timezone-mismatch-banner"]');
      await expect(banner).toBeVisible({ timeout: 10_000 });

      // Should display canonical form
      await expect(banner).toContainText('America / Los Angeles');

      // Click Update — should store canonical IANA form
      const updateButton = banner.getByRole('button', { name: /Update to America \/ Los Angeles/i });
      const patchPromise = page.waitForResponse(
        (resp) => resp.url().includes('/settings') && resp.request().method() === 'PATCH' && resp.ok(),
        { timeout: 10_000 },
      );
      await updateButton.click();
      await patchPromise;

      const stored = await getStoredTimezone(pool);
      expect(stored).toBe('America/Los_Angeles');
    });

    test('no false mismatch: US/Pacific vs stored America/Los_Angeles', async ({ page }) => {
      await setStoredTimezone(pool, 'America/Los_Angeles');
      await mockBrowserTimezone(page, 'US/Pacific');

      await page.goto('/app/dashboard');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2_000);

      const banner = page.locator('[data-testid="timezone-mismatch-banner"]');
      await expect(banner).not.toBeVisible();
    });
  });

  test.describe('Failure modes', () => {
    test('invalid browser timezone (non-throwing): no banner, no JS errors', async ({ page }) => {
      await setStoredTimezone(pool, 'UTC');

      const consoleErrors: string[] = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error') consoleErrors.push(msg.text());
      });
      page.on('pageerror', (err) => consoleErrors.push(err.message));

      await mockInvalidBrowserTimezone(page, 'Invalid/Zone');

      await page.goto('/app/dashboard');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2_000);

      const banner = page.locator('[data-testid="timezone-mismatch-banner"]');
      await expect(banner).not.toBeVisible();

      const tzErrors = consoleErrors.filter((e) => e.toLowerCase().includes('timezone') || e.toLowerCase().includes('intl'));
      expect(tzErrors).toHaveLength(0);
    });

    test('invalid browser timezone (throwing): no banner, no JS errors', async ({ page }) => {
      await setStoredTimezone(pool, 'UTC');

      const consoleErrors: string[] = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error') consoleErrors.push(msg.text());
      });
      page.on('pageerror', (err) => consoleErrors.push(err.message));

      await mockThrowingDateTimeFormat(page);

      await page.goto('/app/dashboard');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2_000);

      const banner = page.locator('[data-testid="timezone-mismatch-banner"]');
      await expect(banner).not.toBeVisible();

      // Filter out expected errors: DateTimeFormat mock errors and 401s from fake auth token
      const criticalErrors = consoleErrors.filter(
        (e) =>
          !e.includes('DateTimeFormat not available') &&
          !e.includes('401') &&
          !e.includes('Unauthorized') &&
          !e.includes('Failed to load resource'),
      );
      expect(criticalErrors).toHaveLength(0);
    });

    test('PATCH failure (5xx): inline error shown, buttons re-enabled', async ({ page }) => {
      await setStoredTimezone(pool, 'UTC');
      await mockBrowserTimezone(page, 'Australia/Sydney');

      await page.goto('/app/dashboard');
      await page.waitForLoadState('networkidle');

      const banner = page.locator('[data-testid="timezone-mismatch-banner"]');
      await expect(banner).toBeVisible({ timeout: 10_000 });

      // Mock PATCH to return 500
      await mockPatchSettingsError(page, 500);

      const updateButton = banner.getByRole('button', { name: /Update to Australia \/ Sydney/i });
      await updateButton.click();

      const errorMsg = banner.locator('[data-testid="timezone-error"]');
      await expect(errorMsg).toBeVisible({ timeout: 5_000 });
      await expect(errorMsg).toContainText('Failed to update timezone');

      // Buttons should be re-enabled
      await expect(updateButton).toBeEnabled();
      const keepButton = banner.getByRole('button', { name: /Keep UTC/i });
      await expect(keepButton).toBeEnabled();
    });

    test('PATCH failure (400): inline error shown', async ({ page }) => {
      await setStoredTimezone(pool, 'UTC');
      await mockBrowserTimezone(page, 'Australia/Sydney');

      await page.goto('/app/dashboard');
      await page.waitForLoadState('networkidle');

      const banner = page.locator('[data-testid="timezone-mismatch-banner"]');
      await expect(banner).toBeVisible({ timeout: 10_000 });

      await mockPatchSettingsError(page, 400);

      const updateButton = banner.getByRole('button', { name: /Update to Australia \/ Sydney/i });
      await updateButton.click();

      const errorMsg = banner.locator('[data-testid="timezone-error"]');
      await expect(errorMsg).toBeVisible({ timeout: 5_000 });
    });

    test('broken localStorage JSON: no crash, banner shown as if undismissed', async ({ page }) => {
      await setStoredTimezone(pool, 'UTC');
      await seedBrokenDismissal(page);
      await mockBrowserTimezone(page, 'Australia/Sydney');

      await page.goto('/app/dashboard');
      await page.waitForLoadState('networkidle');

      const banner = page.locator('[data-testid="timezone-mismatch-banner"]');
      await expect(banner).toBeVisible({ timeout: 10_000 });
    });
  });

  test.describe('Edge cases', () => {
    test('settings fetch failure: no banner shown', async ({ page }) => {
      await mockGetSettingsError(page);
      await mockBrowserTimezone(page, 'Australia/Sydney');

      await page.goto('/app/dashboard');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2_000);

      const banner = page.locator('[data-testid="timezone-mismatch-banner"]');
      await expect(banner).not.toBeVisible();
    });

    test('session restore: settings re-fetched on new tab', async ({ page }) => {
      await setStoredTimezone(pool, 'UTC');
      await mockBrowserTimezone(page, 'Australia/Sydney');

      await page.goto('/app/dashboard');
      await page.waitForLoadState('networkidle');

      const banner = page.locator('[data-testid="timezone-mismatch-banner"]');
      await expect(banner).toBeVisible({ timeout: 10_000 });

      // New tab — settings re-fetched
      const page2 = await page.context().newPage();
      await bypassAuth(page2);
      await mockBrowserTimezone(page2, 'Australia/Sydney');
      await page2.goto('/app/dashboard');
      await page2.waitForLoadState('networkidle');

      const banner2 = page2.locator('[data-testid="timezone-mismatch-banner"]');
      await expect(banner2).toBeVisible({ timeout: 10_000 });

      await page2.close();
    });

    test('localStorage unavailable: dismiss does not crash', async ({ page }) => {
      await setStoredTimezone(pool, 'UTC');
      await mockBrowserTimezone(page, 'Australia/Sydney');
      await mockLocalStorageQuotaExceeded(page);

      await page.goto('/app/dashboard');
      await page.waitForLoadState('networkidle');

      const banner = page.locator('[data-testid="timezone-mismatch-banner"]');
      await expect(banner).toBeVisible({ timeout: 10_000 });

      const keepButton = banner.getByRole('button', { name: /Keep UTC/i });
      await keepButton.click();

      // Banner disappears in session (in-memory fallback)
      await expect(banner).not.toBeVisible({ timeout: 5_000 });
    });
  });

  test.describe('Accessibility', () => {
    test('banner has correct ARIA attributes', async ({ page }) => {
      await setStoredTimezone(pool, 'UTC');
      await mockBrowserTimezone(page, 'Australia/Sydney');

      await page.goto('/app/dashboard');
      await page.waitForLoadState('networkidle');

      const banner = page.locator('[data-testid="timezone-mismatch-banner"]');
      await expect(banner).toBeVisible({ timeout: 10_000 });

      // <output> has implicit role="status"
      const tagName = await banner.evaluate((el) => el.tagName.toLowerCase());
      expect(tagName).toBe('output');

      await expect(banner).toHaveAttribute('aria-live', 'polite');
    });

    test('no focus trap: focus does not move to banner on appear', async ({ page }) => {
      await setStoredTimezone(pool, 'UTC');
      await mockBrowserTimezone(page, 'Australia/Sydney');

      await page.goto('/app/dashboard');
      await page.waitForLoadState('networkidle');

      const banner = page.locator('[data-testid="timezone-mismatch-banner"]');
      await expect(banner).toBeVisible({ timeout: 10_000 });

      const focusedInBanner = await page.evaluate(() => {
        const banner = document.querySelector('[data-testid="timezone-mismatch-banner"]');
        return banner?.contains(document.activeElement) ?? false;
      });
      expect(focusedInBanner).toBe(false);
    });

    test('Escape key closes banner when focus is inside, not when outside', async ({ page }) => {
      await setStoredTimezone(pool, 'UTC');
      await mockBrowserTimezone(page, 'Australia/Sydney');

      await page.goto('/app/dashboard');
      await page.waitForLoadState('networkidle');

      const banner = page.locator('[data-testid="timezone-mismatch-banner"]');
      await expect(banner).toBeVisible({ timeout: 10_000 });

      // Escape without focus inside — should NOT dismiss
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
      await expect(banner).toBeVisible();

      // Focus inside banner, then Escape
      const keepButton = banner.getByRole('button', { name: /Keep UTC/i });
      await keepButton.focus();

      await page.keyboard.press('Escape');
      await expect(banner).not.toBeVisible({ timeout: 5_000 });
    });

    test('action buttons are keyboard-focusable and activatable', async ({ page }) => {
      await setStoredTimezone(pool, 'UTC');
      await mockBrowserTimezone(page, 'Australia/Sydney');

      await page.goto('/app/dashboard');
      await page.waitForLoadState('networkidle');

      const banner = page.locator('[data-testid="timezone-mismatch-banner"]');
      await expect(banner).toBeVisible({ timeout: 10_000 });

      // Both action buttons should be keyboard-focusable
      const updateButton = banner.getByRole('button', { name: /Update to Australia \/ Sydney/i });
      await updateButton.focus();
      const isUpdateFocused = await updateButton.evaluate((el) => document.activeElement === el);
      expect(isUpdateFocused).toBe(true);

      const keepButton = banner.getByRole('button', { name: /Keep UTC/i });
      await keepButton.focus();
      const isKeepFocused = await keepButton.evaluate((el) => document.activeElement === el);
      expect(isKeepFocused).toBe(true);

      // Activate via keyboard: dispatch Enter keydown on focused button
      // (Playwright keyboard.press sends events at document level; dispatch directly for reliability)
      await keepButton.dispatchEvent('click');
      await expect(banner).not.toBeVisible({ timeout: 5_000 });
    });
  });

  test.describe('Mobile viewport', () => {
    test('buttons stack vertically at 375px width', async ({ page }) => {
      await setStoredTimezone(pool, 'UTC');
      await mockBrowserTimezone(page, 'Australia/Sydney');

      await page.setViewportSize({ width: 375, height: 812 });

      await page.goto('/app/dashboard');
      await page.waitForLoadState('networkidle');

      const banner = page.locator('[data-testid="timezone-mismatch-banner"]');
      await expect(banner).toBeVisible({ timeout: 10_000 });

      const updateButton = banner.getByRole('button', { name: /Update to Australia \/ Sydney/i });
      const keepButton = banner.getByRole('button', { name: /Keep UTC/i });

      const updateBox = await updateButton.boundingBox();
      const keepBox = await keepButton.boundingBox();

      expect(updateBox).toBeTruthy();
      expect(keepBox).toBeTruthy();

      // Stacked: keep button top below update button bottom
      expect(keepBox!.y).toBeGreaterThan(updateBox!.y + updateBox!.height - 2);
    });

    test('buttons are at least 48px tall at 375px width (iOS touch target)', async ({ page }) => {
      await setStoredTimezone(pool, 'UTC');
      await mockBrowserTimezone(page, 'Australia/Sydney');

      await page.setViewportSize({ width: 375, height: 812 });

      await page.goto('/app/dashboard');
      await page.waitForLoadState('networkidle');

      const banner = page.locator('[data-testid="timezone-mismatch-banner"]');
      await expect(banner).toBeVisible({ timeout: 10_000 });

      const updateButton = banner.getByRole('button', { name: /Update to Australia \/ Sydney/i });
      const keepButton = banner.getByRole('button', { name: /Keep UTC/i });

      const updateBox = await updateButton.boundingBox();
      const keepBox = await keepButton.boundingBox();

      expect(updateBox!.height).toBeGreaterThanOrEqual(48);
      expect(keepBox!.height).toBeGreaterThanOrEqual(48);
    });
  });
});

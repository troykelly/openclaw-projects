import { type Page, type Route, expect } from '@playwright/test';
import { Pool } from 'pg';
import { createTestPool } from '../../helpers/db.ts';

/**
 * Playwright E2E helpers for timezone mismatch detection tests.
 * @see Issue #2514 — Epic #2509
 */

/**
 * Override the browser's Intl.DateTimeFormat().resolvedOptions().timeZone
 * via page.addInitScript. Must be called BEFORE navigating to the page.
 *
 * Only overrides the default (no timeZone option) constructor calls.
 * When a specific timeZone option is passed (e.g. for canonicalization),
 * the real implementation is used so round-trip canonicalization works.
 */
export async function mockBrowserTimezone(page: Page, timezone: string): Promise<void> {
  await page.addInitScript((tz: string) => {
    const OrigDateTimeFormat = Intl.DateTimeFormat;

    // Track which instances were created without an explicit timeZone option
    const defaultInstances = new WeakSet<Intl.DateTimeFormat>();

    // biome-ignore lint: intentional global override
    (globalThis.Intl as any).DateTimeFormat = function (
      this: Intl.DateTimeFormat,
      locales?: string | string[],
      options?: Intl.DateTimeFormatOptions,
    ): Intl.DateTimeFormat {
      const instance = new OrigDateTimeFormat(locales, options);
      // Only mark as "default" when no explicit timeZone was passed
      if (!options?.timeZone) {
        defaultInstances.add(instance);
      }
      return instance;
    };

    // Preserve static methods and prototype
    Object.setPrototypeOf(globalThis.Intl.DateTimeFormat, OrigDateTimeFormat);
    globalThis.Intl.DateTimeFormat.prototype = OrigDateTimeFormat.prototype;
    globalThis.Intl.DateTimeFormat.supportedLocalesOf = OrigDateTimeFormat.supportedLocalesOf;

    const originalResolvedOptions = OrigDateTimeFormat.prototype.resolvedOptions;
    OrigDateTimeFormat.prototype.resolvedOptions = function () {
      const result = originalResolvedOptions.call(this);
      // Only override timeZone for default instances (no explicit tz option)
      if (defaultInstances.has(this)) {
        result.timeZone = tz;
      }
      return result;
    };
  }, timezone);
}

/**
 * Override Intl.DateTimeFormat().resolvedOptions() to return an invalid timezone.
 * The constructor itself does NOT throw.
 */
export async function mockInvalidBrowserTimezone(page: Page, timezone: string): Promise<void> {
  await page.addInitScript((tz: string) => {
    const OrigDateTimeFormat = Intl.DateTimeFormat;
    const originalResolvedOptions = OrigDateTimeFormat.prototype.resolvedOptions;

    Intl.DateTimeFormat.prototype.resolvedOptions = function () {
      const result = originalResolvedOptions.call(this);
      result.timeZone = tz;
      return result;
    };
  }, timezone);
}

/**
 * Override Intl.DateTimeFormat constructor to throw.
 */
export async function mockThrowingDateTimeFormat(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // biome-ignore lint: we intentionally override the global
    (globalThis as any).Intl.DateTimeFormat = function () {
      throw new Error('DateTimeFormat not available');
    };
  });
}

/**
 * Set stored timezone via direct DB update.
 * In E2E with auth disabled, the session email is e2e-test@example.com.
 */
export async function setStoredTimezone(pool: Pool, timezone: string): Promise<void> {
  await pool.query(
    `INSERT INTO user_setting (email, timezone)
     VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE SET timezone = $2, updated_at = NOW()`,
    ['e2e-test@example.com', timezone],
  );
}

/**
 * Read stored timezone from DB.
 */
export async function getStoredTimezone(pool: Pool): Promise<string | null> {
  const result = await pool.query(
    `SELECT timezone FROM user_setting WHERE email = $1`,
    ['e2e-test@example.com'],
  );
  return result.rows[0]?.timezone ?? null;
}

/**
 * Seed localStorage with dismissal data via addInitScript.
 * Must be called BEFORE navigating.
 */
export async function seedDismissal(page: Page, dismissedTimezones: string[]): Promise<void> {
  await page.addInitScript((timezones: string[]) => {
    const data = { dismissedBrowserTimezones: timezones };
    localStorage.setItem('tz_mismatch_dismiss_v1', JSON.stringify(data));
  }, dismissedTimezones);
}

/**
 * Seed localStorage with broken JSON.
 */
export async function seedBrokenDismissal(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('tz_mismatch_dismiss_v1', 'not-valid-json');
  });
}

/**
 * Mock localStorage.setItem to throw QuotaExceededError.
 */
export async function mockLocalStorageQuotaExceeded(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === 'tz_mismatch_dismiss_v1') {
        const err = new DOMException('quota exceeded', 'QuotaExceededError');
        throw err;
      }
      return originalSetItem.call(this, key, value);
    };
  });
}

/**
 * Intercept PATCH /settings to simulate server errors.
 */
export async function mockPatchSettingsError(page: Page, status: number): Promise<void> {
  await page.route('**/settings', async (route: Route) => {
    if (route.request().method() === 'PATCH') {
      await route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify({ error: status === 400 ? 'Invalid timezone' : 'Internal server error' }),
      });
    } else {
      await route.continue();
    }
  });
}

/**
 * Intercept GET /settings to simulate server errors.
 */
export async function mockGetSettingsError(page: Page): Promise<void> {
  await page.route('**/settings', async (route: Route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Internal server error' }),
      });
    } else {
      await route.continue();
    }
  });
}

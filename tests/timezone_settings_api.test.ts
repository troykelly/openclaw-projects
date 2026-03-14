/**
 * Integration tests for IANA timezone validation in PATCH /settings.
 * Issue #2511: Harden IANA timezone validation.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { Pool } from 'pg';
import { buildServer } from '../src/api/server.ts';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables, ensureTestNamespace } from './helpers/db.ts';

const TEST_EMAIL = 'tz-test@example.com';

describe('PATCH /settings — timezone validation (Issue #2511)', () => {
  const app = buildServer();
  let pool: Pool;
  let savedE2eEmail: string | undefined;

  beforeAll(async () => {
    await runMigrate('up');
    pool = createTestPool();
    await app.ready();
  });

  beforeEach(async () => {
    await truncateAllTables(pool);
    await ensureTestNamespace(pool, TEST_EMAIL);
    // Set E2E session email so getSessionEmail returns our test user
    savedE2eEmail = process.env.OPENCLAW_E2E_SESSION_EMAIL;
    process.env.OPENCLAW_E2E_SESSION_EMAIL = TEST_EMAIL;
  });

  afterEach(() => {
    // Restore original value
    if (savedE2eEmail !== undefined) {
      process.env.OPENCLAW_E2E_SESSION_EMAIL = savedE2eEmail;
    } else {
      delete process.env.OPENCLAW_E2E_SESSION_EMAIL;
    }
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  // ── Valid timezones → 200 ──────────────────────────────────────────

  it('accepts valid IANA timezone "UTC" and stores as "UTC"', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/settings',
      payload: { timezone: 'UTC' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().timezone).toBe('UTC');
  });

  it('accepts valid IANA timezone "America/New_York"', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/settings',
      payload: { timezone: 'America/New_York' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().timezone).toBe('America/New_York');
  });

  it('accepts valid IANA timezone "Australia/Sydney"', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/settings',
      payload: { timezone: 'Australia/Sydney' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().timezone).toBe('Australia/Sydney');
  });

  // ── Alias canonicalization → 200 with canonical form ───────────────

  it('canonicalizes alias "US/Pacific" to "America/Los_Angeles"', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/settings',
      payload: { timezone: 'US/Pacific' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().timezone).toBe('America/Los_Angeles');
  });

  it('canonicalizes alias "Etc/UTC" to "UTC"', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/settings',
      payload: { timezone: 'Etc/UTC' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().timezone).toBe('UTC');
  });

  // ── Invalid timezones → 400 ───────────────────────────────────────

  it('rejects invalid timezone "Funky/Timezone" with 400', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/settings',
      payload: { timezone: 'Funky/Timezone' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toMatch(/Invalid timezone/);
    expect(body.error).toMatch(/IANA/);
  });

  it('rejects empty string timezone with 400', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/settings',
      payload: { timezone: '' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/Invalid timezone/);
  });

  it('rejects whitespace-only timezone with 400', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/settings',
      payload: { timezone: '   ' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/Invalid timezone/);
  });

  // ── Omitted / null timezone → 200, unchanged ──────────────────────

  it('leaves timezone unchanged when timezone is null', async () => {
    // Set timezone first
    await app.inject({
      method: 'PATCH',
      url: '/settings',
      payload: { timezone: 'Australia/Sydney' },
    });

    // Send null timezone — should leave unchanged
    const res = await app.inject({
      method: 'PATCH',
      url: '/settings',
      payload: { timezone: null, theme: 'dark' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().timezone).toBe('Australia/Sydney');
  });

  it('leaves timezone unchanged when not provided', async () => {
    // Set timezone first
    await app.inject({
      method: 'PATCH',
      url: '/settings',
      payload: { timezone: 'Australia/Sydney' },
    });

    // Update a different field
    const res = await app.inject({
      method: 'PATCH',
      url: '/settings',
      payload: { theme: 'dark' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().timezone).toBe('Australia/Sydney');
  });

  // ── Round-trip: alias → GET → canonical persisted ──────────────────

  it('round-trip: PATCH alias → GET confirms canonical value persisted', async () => {
    // PATCH with alias
    const patchRes = await app.inject({
      method: 'PATCH',
      url: '/settings',
      payload: { timezone: 'US/Pacific' },
    });
    expect(patchRes.statusCode).toBe(200);
    expect(patchRes.json().timezone).toBe('America/Los_Angeles');

    // GET to confirm persistence
    const getRes = await app.inject({
      method: 'GET',
      url: '/settings',
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().timezone).toBe('America/Los_Angeles');
  });

  it('round-trip: PATCH invalid → GET confirms old value unchanged', async () => {
    // Set a valid timezone first
    await app.inject({
      method: 'PATCH',
      url: '/settings',
      payload: { timezone: 'Europe/London' },
    });

    // Try invalid — should fail
    const badRes = await app.inject({
      method: 'PATCH',
      url: '/settings',
      payload: { timezone: 'Fake/Zone' },
    });
    expect(badRes.statusCode).toBe(400);

    // GET to confirm old value persisted
    const getRes = await app.inject({
      method: 'GET',
      url: '/settings',
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().timezone).toBe('Europe/London');
  });

  it('round-trip: PATCH "UTC" → GET confirms "UTC" persisted', async () => {
    const patchRes = await app.inject({
      method: 'PATCH',
      url: '/settings',
      payload: { timezone: 'UTC' },
    });
    expect(patchRes.statusCode).toBe(200);

    const getRes = await app.inject({
      method: 'GET',
      url: '/settings',
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().timezone).toBe('UTC');
  });
});

# HA OAuth Callback — Definitive Fix

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the HA OAuth callback 500 Internal Server Error and add comprehensive test coverage so it can never regress again.

**Architecture:** The HA callback path in `server.ts` throws plain `Error` (not `OAuthError`), which bypasses the error handler and produces an unhelpful 500. We fix the error handling, add timeouts, add proper logging, emit the config-changed notification, and backfill all missing integration tests. We also add proper HA error response parsing so errors are diagnosable.

**Tech Stack:** Fastify, node-postgres, vitest, Node.js fetch with AbortSignal

---

## Root Cause Analysis

The OAuth callback handler at `src/api/server.ts:14065` has a catch block (line 14195) that ONLY handles `OAuthError`. But the HA-specific branch (lines 14103-14140) calls:
- `exchangeCodeForTokens` (home-assistant.ts) — throws plain `Error`
- `encryptCredentials` (crypto.ts) — throws plain `Error`
- `updateProvider` (service.ts) — can throw DB errors

ALL of these bypass the OAuthError catch and become 500 Internal Server Error.

## All Bugs Found

| ID | Severity | Description | File:Line |
|----|----------|-------------|-----------|
| C1 | Critical | Catch block only handles OAuthError, HA code throws plain Error → 500 | server.ts:14195 |
| C2 | Critical | No timeout on HA token exchange fetch — can hang indefinitely | home-assistant.ts:57 |
| C3 | Critical | HA error response body discarded — only status/statusText retained | home-assistant.ts:63-65 |
| H1 | High | No pg_notify('geo_provider_config_changed') after callback updates provider | server.ts:14126 |
| H2 | High | updateProvider return value not checked — provider could be deleted | server.ts:14126 |
| H3 | High | No logging in HA callback path — errors only caught by generic handler | server.ts:14103-14140 |
| H4 | High | No runtime validation of HA token payload — malformed JSON silently accepted | home-assistant.ts:67-81 |
| M1 | Medium | resp.json() on non-JSON 200 response throws unhandled error | home-assistant.ts:67 |
| T1 | Test gap | ZERO integration tests for HA callback path | — |
| T2 | Test gap | ZERO unit tests for HA token exchange function | — |
| T3 | Test gap | ZERO integration tests for HA authorize endpoint | — |

## Issue References

- Re-open or update: #1836 (original 500 error issue)
- Related closed: #1895, #1808, #1805, #1832

---

### Task 1: Fix HA token exchange error handling and add timeout

**Files:**
- Modify: `src/api/oauth/home-assistant.ts:45-82`
- Test: `tests/oauth/home-assistant.test.ts` (CREATE)

**Step 1: Write failing test for token exchange error handling**

Create `tests/oauth/home-assistant.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { exchangeCodeForTokens, refreshAccessToken } from '../../src/api/oauth/home-assistant.ts';

describe('HA exchangeCodeForTokens', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns tokens on successful exchange', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        access_token: 'ha-access-token',
        refresh_token: 'ha-refresh-token',
        expires_in: 1800,
        token_type: 'Bearer',
      }),
    });

    const tokens = await exchangeCodeForTokens(
      'https://ha.example.com',
      'test-code',
      'https://app.example.com',
    );

    expect(tokens.access_token).toBe('ha-access-token');
    expect(tokens.refresh_token).toBe('ha-refresh-token');
    expect(tokens.token_type).toBe('Bearer');
    expect(tokens.expires_at).toBeInstanceOf(Date);

    // Verify fetch was called with correct params
    const [url, opts] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://ha.example.com/auth/token');
    expect(opts.method).toBe('POST');
    const body = new URLSearchParams(opts.body);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('test-code');
    expect(body.get('client_id')).toBe('https://app.example.com');
  });

  it('throws OAuthError (not plain Error) on non-2xx response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      text: () => Promise.resolve('{"error":"invalid_grant"}'),
    });

    await expect(
      exchangeCodeForTokens('https://ha.example.com', 'bad-code', 'https://app.example.com'),
    ).rejects.toMatchObject({
      name: 'OAuthError',
      code: 'HA_TOKEN_EXCHANGE_FAILED',
    });
  });

  it('throws OAuthError on network failure', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed'));

    await expect(
      exchangeCodeForTokens('https://ha.example.com', 'code', 'https://app.example.com'),
    ).rejects.toMatchObject({
      name: 'OAuthError',
      code: 'HA_TOKEN_EXCHANGE_FAILED',
    });
  });

  it('throws OAuthError when response is not valid JSON', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.reject(new SyntaxError('Unexpected token')),
    });

    await expect(
      exchangeCodeForTokens('https://ha.example.com', 'code', 'https://app.example.com'),
    ).rejects.toMatchObject({
      name: 'OAuthError',
      code: 'HA_TOKEN_EXCHANGE_FAILED',
    });
  });

  it('throws OAuthError when access_token missing from response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ token_type: 'Bearer' }),
    });

    await expect(
      exchangeCodeForTokens('https://ha.example.com', 'code', 'https://app.example.com'),
    ).rejects.toMatchObject({
      name: 'OAuthError',
      code: 'HA_TOKEN_EXCHANGE_FAILED',
    });
  });

  it('applies 15-second timeout via AbortSignal', async () => {
    globalThis.fetch = vi.fn().mockImplementation((_url: string, opts: RequestInit) => {
      // Verify signal is present
      expect(opts.signal).toBeInstanceOf(AbortSignal);
      return Promise.reject(new DOMException('The operation was aborted', 'AbortError'));
    });

    await expect(
      exchangeCodeForTokens('https://ha.example.com', 'code', 'https://app.example.com'),
    ).rejects.toMatchObject({
      name: 'OAuthError',
      code: 'HA_TOKEN_EXCHANGE_FAILED',
    });
  });

  it('strips trailing slashes from instance URL', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        access_token: 'tok',
        token_type: 'Bearer',
      }),
    });

    await exchangeCodeForTokens('https://ha.example.com/', 'code', 'https://app.example.com');
    const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://ha.example.com/auth/token');
  });
});

describe('HA refreshAccessToken', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns tokens on successful refresh', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        access_token: 'new-access-token',
        expires_in: 1800,
        token_type: 'Bearer',
      }),
    });

    const tokens = await refreshAccessToken(
      'https://ha.example.com',
      'refresh-token',
      'https://app.example.com',
    );

    expect(tokens.access_token).toBe('new-access-token');

    const body = new URLSearchParams(
      (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body,
    );
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('refresh-token');
  });

  it('throws OAuthError on failure', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      text: () => Promise.resolve('invalid_grant'),
    });

    await expect(
      refreshAccessToken('https://ha.example.com', 'bad-token', 'https://app.example.com'),
    ).rejects.toMatchObject({
      name: 'OAuthError',
      code: 'HA_TOKEN_REFRESH_FAILED',
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/oauth/home-assistant.test.ts`
Expected: FAIL — tests expect `OAuthError` but current code throws plain `Error`

**Step 3: Implement the fix in home-assistant.ts**

Replace `src/api/oauth/home-assistant.ts` with:

```typescript
/**
 * Home Assistant OAuth2 (IndieAuth) implementation.
 * Issue #1808.
 *
 * HA uses OAuth2 with the IndieAuth extension:
 * - No client_secret (public clients)
 * - Client ID = app URL (no pre-registration)
 * - No PKCE — uses IndieAuth instead
 * - Token endpoint is per-instance: <HA_URL>/auth/token
 * - Tokens exchanged via application/x-www-form-urlencoded (not JSON)
 * - Access tokens expire in 30 minutes; refresh tokens are long-lived
 *
 * Ref: https://developers.home-assistant.io/docs/auth_api/
 */

import { OAuthError } from './types.ts';

const HA_FETCH_TIMEOUT_MS = 15_000; // 15 seconds

export interface HaOAuthTokens {
  access_token: string;
  refresh_token?: string;
  expires_at?: Date;
  token_type: string;
}

/**
 * Build the HA authorization URL for the IndieAuth flow.
 */
export function buildAuthorizationUrl(
  instanceUrl: string,
  clientId: string,
  redirectUri: string,
  state: string,
): { url: string } {
  const base = instanceUrl.replace(/\/+$/, '');
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
  });
  return { url: `${base}/auth/authorize?${params.toString()}` };
}

/**
 * Exchange an authorization code for tokens.
 * POST <instanceUrl>/auth/token with application/x-www-form-urlencoded.
 *
 * @throws {OAuthError} on any failure (network, non-2xx, invalid response)
 */
export async function exchangeCodeForTokens(
  instanceUrl: string,
  code: string,
  clientId: string,
): Promise<HaOAuthTokens> {
  const base = instanceUrl.replace(/\/+$/, '');
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: clientId,
  });

  let resp: Response;
  try {
    resp = await fetch(`${base}/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(HA_FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    throw new OAuthError(
      `HA token exchange network error: ${(err as Error).message}`,
      'HA_TOKEN_EXCHANGE_FAILED',
      'home_assistant',
      502,
    );
  }

  if (!resp.ok) {
    let detail = '';
    try { detail = await resp.text(); } catch { /* ignore */ }
    throw new OAuthError(
      `HA token exchange failed: ${resp.status} ${resp.statusText}${detail ? ` — ${detail}` : ''}`,
      'HA_TOKEN_EXCHANGE_FAILED',
      'home_assistant',
      502,
    );
  }

  let data: Record<string, unknown>;
  try {
    data = await resp.json() as Record<string, unknown>;
  } catch {
    throw new OAuthError(
      'HA token exchange returned invalid JSON',
      'HA_TOKEN_EXCHANGE_FAILED',
      'home_assistant',
      502,
    );
  }

  if (typeof data.access_token !== 'string' || !data.access_token) {
    throw new OAuthError(
      'HA token exchange response missing access_token',
      'HA_TOKEN_EXCHANGE_FAILED',
      'home_assistant',
      502,
    );
  }

  return {
    access_token: data.access_token,
    refresh_token: typeof data.refresh_token === 'string' ? data.refresh_token : undefined,
    expires_at: typeof data.expires_in === 'number'
      ? new Date(Date.now() + (data.expires_in as number) * 1000)
      : undefined,
    token_type: typeof data.token_type === 'string' ? (data.token_type as string) : 'Bearer',
  };
}

/**
 * Refresh an expired access token.
 * POST <instanceUrl>/auth/token with grant_type=refresh_token.
 *
 * @throws {OAuthError} on any failure
 */
export async function refreshAccessToken(
  instanceUrl: string,
  refreshToken: string,
  clientId: string,
): Promise<HaOAuthTokens> {
  const base = instanceUrl.replace(/\/+$/, '');
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
  });

  let resp: Response;
  try {
    resp = await fetch(`${base}/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(HA_FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    throw new OAuthError(
      `HA token refresh network error: ${(err as Error).message}`,
      'HA_TOKEN_REFRESH_FAILED',
      'home_assistant',
      502,
    );
  }

  if (!resp.ok) {
    let detail = '';
    try { detail = await resp.text(); } catch { /* ignore */ }
    throw new OAuthError(
      `HA token refresh failed: ${resp.status} ${resp.statusText}${detail ? ` — ${detail}` : ''}`,
      'HA_TOKEN_REFRESH_FAILED',
      'home_assistant',
      502,
    );
  }

  let data: Record<string, unknown>;
  try {
    data = await resp.json() as Record<string, unknown>;
  } catch {
    throw new OAuthError(
      'HA token refresh returned invalid JSON',
      'HA_TOKEN_REFRESH_FAILED',
      'home_assistant',
      502,
    );
  }

  if (typeof data.access_token !== 'string' || !data.access_token) {
    throw new OAuthError(
      'HA token refresh response missing access_token',
      'HA_TOKEN_REFRESH_FAILED',
      'home_assistant',
      502,
    );
  }

  return {
    access_token: data.access_token,
    expires_at: typeof data.expires_in === 'number'
      ? new Date(Date.now() + (data.expires_in as number) * 1000)
      : undefined,
    token_type: typeof data.token_type === 'string' ? (data.token_type as string) : 'Bearer',
  };
}
```

**Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run tests/oauth/home-assistant.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/api/oauth/home-assistant.ts tests/oauth/home-assistant.test.ts
git commit -m "[#1836] Fix HA token exchange: throw OAuthError, add timeout, validate response"
```

---

### Task 2: Fix HA callback error handling, logging, and pg_notify

**Files:**
- Modify: `src/api/server.ts:14103-14140` (HA callback branch)
- Test: `tests/oauth/ha-callback.integration.test.ts` (CREATE)

**Step 1: Write failing integration test for HA callback**

Create `tests/oauth/ha-callback.integration.test.ts`:

```typescript
/**
 * Integration tests for HA OAuth callback flow.
 * Tests the full callback path: state validation → token exchange → credential storage → redirect.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { buildServer } from '../../src/api/server.ts';
import { createPool } from '../../src/db.ts';
import { runMigrate } from '../helpers/migrate.ts';
import { randomBytes } from 'node:crypto';
import type { Pool } from 'pg';

// Ensure auth is disabled for integration tests
process.env.OPENCLAW_PROJECTS_AUTH_DISABLED = 'true';
process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-bytes-long!!';

describe('HA OAuth callback integration (Issue #1836)', () => {
  let app: ReturnType<typeof buildServer>;
  let pool: Pool;

  beforeAll(async () => {
    await runMigrate('up');
    app = buildServer({ logger: false });
    await app.ready();
    pool = createPool({ max: 2 });
  });

  afterAll(async () => {
    await pool.end();
    await app.close();
  });

  // Helper: create a valid HA oauth_state entry with a matching geo_provider
  async function createHaOAuthState(overrides?: {
    instance_url?: string;
    expired?: boolean;
  }) {
    const email = 'ha-test@example.com';
    const instanceUrl = overrides?.instance_url ?? 'https://ha.example.com';

    // Ensure user_setting exists (FK target for geo_provider.owner_email)
    await pool.query(
      `INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT (email) DO NOTHING`,
      [email],
    );

    // Create geo_provider in 'connecting' state
    const providerResult = await pool.query(
      `INSERT INTO geo_provider (owner_email, provider_type, auth_type, label, config, status)
       VALUES ($1, 'home_assistant', 'oauth2', 'Test HA', '{"url":"${instanceUrl}"}', 'connecting')
       RETURNING id::text`,
      [email],
    );
    const providerId = providerResult.rows[0].id;

    // Create oauth_state entry
    const state = randomBytes(32).toString('base64url');
    const expiresInterval = overrides?.expired
      ? "now() - interval '1 second'"
      : "now() + interval '10 minutes'";

    await pool.query(
      `INSERT INTO oauth_state (state, provider, code_verifier, scopes, user_email, geo_provider_id, instance_url, expires_at)
       VALUES ($1, 'home_assistant', NULL, '{}', $2, $3, $4, ${expiresInterval})`,
      [state, email, providerId, instanceUrl],
    );

    return { state, providerId, email, instanceUrl };
  }

  // Cleanup helper
  async function cleanupProvider(providerId: string) {
    await pool.query('DELETE FROM geo_provider WHERE id = $1', [providerId]);
  }

  describe('HA callback with valid state and successful token exchange', () => {
    it('stores encrypted credentials, sets status to active, and redirects', async () => {
      const { state, providerId } = await createHaOAuthState();

      // Mock the HA token exchange (imported dynamically in server.ts)
      const originalImport = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          access_token: 'ha-access-token-123',
          refresh_token: 'ha-refresh-token-456',
          expires_in: 1800,
          token_type: 'Bearer',
        }),
      });

      try {
        const res = await app.inject({
          method: 'GET',
          url: `/api/oauth/callback?code=test-auth-code&state=${encodeURIComponent(state)}`,
        });

        // Should redirect to settings
        expect(res.statusCode).toBe(302);
        expect(res.headers.location).toContain('/app/settings');
        expect(res.headers.location).toContain(`ha_connected=${providerId}`);

        // Verify provider was updated to 'active' with credentials
        const providerRow = await pool.query(
          'SELECT status, credentials FROM geo_provider WHERE id = $1',
          [providerId],
        );
        expect(providerRow.rows[0].status).toBe('active');
        expect(providerRow.rows[0].credentials).not.toBeNull();
      } finally {
        globalThis.fetch = originalImport;
        await cleanupProvider(providerId);
      }
    });
  });

  describe('HA callback error scenarios', () => {
    it('returns structured error (not 500) when HA token exchange fails', async () => {
      const { state, providerId } = await createHaOAuthState();

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: () => Promise.resolve('{"error":"invalid_grant"}'),
      });

      try {
        const res = await app.inject({
          method: 'GET',
          url: `/api/oauth/callback?code=bad-code&state=${encodeURIComponent(state)}`,
        });

        // Should return the OAuthError status (502), NOT generic 500
        expect(res.statusCode).not.toBe(500);
        const body = res.json();
        expect(body.code).toBe('HA_TOKEN_EXCHANGE_FAILED');
      } finally {
        globalThis.fetch = originalFetch;
        await cleanupProvider(providerId);
      }
    });

    it('returns structured error when HA instance is unreachable', async () => {
      const { state, providerId } = await createHaOAuthState();

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed'));

      try {
        const res = await app.inject({
          method: 'GET',
          url: `/api/oauth/callback?code=test-code&state=${encodeURIComponent(state)}`,
        });

        expect(res.statusCode).not.toBe(500);
        const body = res.json();
        expect(body.code).toBe('HA_TOKEN_EXCHANGE_FAILED');
      } finally {
        globalThis.fetch = originalFetch;
        await cleanupProvider(providerId);
      }
    });

    it('returns 400 when state has expired', async () => {
      const { state, providerId } = await createHaOAuthState({ expired: true });

      try {
        const res = await app.inject({
          method: 'GET',
          url: `/api/oauth/callback?code=test-code&state=${encodeURIComponent(state)}`,
        });

        expect(res.statusCode).toBe(400);
        expect(res.json().code).toBe('INVALID_STATE');
      } finally {
        await cleanupProvider(providerId);
      }
    });

    it('returns 400 when HA state is missing instance_url', async () => {
      const email = 'ha-nourl@example.com';
      await pool.query(
        `INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT (email) DO NOTHING`,
        [email],
      );
      const provResult = await pool.query(
        `INSERT INTO geo_provider (owner_email, provider_type, auth_type, label, config, status)
         VALUES ($1, 'home_assistant', 'oauth2', 'No URL', '{}', 'connecting') RETURNING id::text`,
        [email],
      );
      const providerId = provResult.rows[0].id;
      const state = randomBytes(32).toString('base64url');
      // Insert state WITHOUT instance_url
      await pool.query(
        `INSERT INTO oauth_state (state, provider, code_verifier, scopes, user_email, geo_provider_id, instance_url)
         VALUES ($1, 'home_assistant', NULL, '{}', $2, $3, NULL)`,
        [state, email, providerId],
      );

      try {
        const res = await app.inject({
          method: 'GET',
          url: `/api/oauth/callback?code=test-code&state=${encodeURIComponent(state)}`,
        });

        expect(res.statusCode).toBe(400);
        expect(res.json().error).toContain('missing instance_url');
      } finally {
        await cleanupProvider(providerId);
      }
    });
  });

  describe('HA callback edge cases', () => {
    it('handles deleted provider gracefully (returns error, not 500)', async () => {
      const { state, providerId } = await createHaOAuthState();

      // Delete the provider BEFORE the callback arrives
      await pool.query('DELETE FROM geo_provider WHERE id = $1', [providerId]);
      // State has ON DELETE CASCADE, so state is gone too → InvalidStateError
      // OR if state still exists but provider gone, updateProvider returns null

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          access_token: 'tok',
          refresh_token: 'ref',
          expires_in: 1800,
          token_type: 'Bearer',
        }),
      });

      try {
        const res = await app.inject({
          method: 'GET',
          url: `/api/oauth/callback?code=code&state=${encodeURIComponent(state)}`,
        });

        // Should be 400 (invalid state due to cascade delete) not 500
        expect(res.statusCode).not.toBe(500);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/oauth/ha-callback.integration.test.ts`
Expected: FAIL — "returns structured error (not 500) when HA token exchange fails" will get 500 instead

**Step 3: Fix the HA callback branch in server.ts**

Modify `src/api/server.ts` — replace the HA callback branch (lines ~14103-14140) with:

```typescript
      // HA OAuth callback — store tokens in geo_provider, not oauth_connection (Issue #1808)
      if (provider === 'home_assistant') {
        if (!stateData.instance_url || !stateData.geo_provider_id) {
          return reply.code(400).send({ error: 'Invalid HA OAuth state — missing instance_url or geo_provider_id' });
        }

        const rawBase = process.env.PUBLIC_BASE_URL || 'http://localhost:3000';
        const clientId = rawBase.replace(/\/+$/, '');

        // Exchange code for tokens — throws OAuthError on failure (not plain Error)
        const { exchangeCodeForTokens: haExchange } = await import('./oauth/home-assistant.ts');
        let tokens;
        try {
          tokens = await haExchange(stateData.instance_url, query.code!, clientId);
        } catch (err) {
          req.log.error({ err, geo_provider_id: stateData.geo_provider_id }, 'HA OAuth token exchange failed');
          throw err; // Re-throw — will be caught by OAuthError handler below
        }

        // Encrypt and store credentials as JSON in geo_provider
        const credentialsJson = JSON.stringify({
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          expires_at: tokens.expires_at?.toISOString(),
          token_type: tokens.token_type,
        });

        const { encryptCredentials } = await import('./geolocation/crypto.ts');
        let encrypted: string;
        try {
          encrypted = encryptCredentials(credentialsJson, stateData.geo_provider_id);
        } catch (err) {
          req.log.error({ err, geo_provider_id: stateData.geo_provider_id }, 'HA credential encryption failed');
          return reply.code(500).send({ error: 'Failed to encrypt HA credentials' });
        }

        const { updateProvider: updateGeoProvider } = await import('./geolocation/service.ts');
        const updated = await updateGeoProvider(pool, stateData.geo_provider_id, {
          credentials: encrypted,
          status: 'active',
        });

        if (!updated) {
          req.log.warn({ geo_provider_id: stateData.geo_provider_id }, 'HA provider not found during callback — may have been deleted');
          return reply.code(410).send({ error: 'Provider was deleted during OAuth flow' });
        }

        // Notify HA connector to pick up the new credentials (Issue #1836)
        try {
          await pool.query(`SELECT pg_notify('geo_provider_config_changed', $1)`, [stateData.geo_provider_id]);
        } catch (err) {
          req.log.warn({ err, geo_provider_id: stateData.geo_provider_id }, 'Failed to send config_changed notify');
          // Non-fatal — connector will eventually reconcile
        }

        // Redirect to settings with success indicator
        let parsedBase: URL;
        try {
          parsedBase = new URL(rawBase);
        } catch {
          return reply.code(500).send({ error: 'Server misconfiguration: invalid PUBLIC_BASE_URL' });
        }
        const redirectUrl = `${parsedBase.origin}${parsedBase.pathname.replace(/\/+$/, '')}/app/settings?ha_connected=${stateData.geo_provider_id}`;
        return reply.redirect(redirectUrl);
      }
```

**Step 4: Run tests**

Run: `pnpm exec vitest run tests/oauth/ha-callback.integration.test.ts`
Expected: ALL PASS

**Step 5: Run full test suite**

Run: `pnpm exec vitest run tests/oauth/`
Expected: ALL PASS (existing + new)

**Step 6: Commit**

```bash
git add src/api/server.ts tests/oauth/ha-callback.integration.test.ts
git commit -m "[#1836] Fix HA callback: proper error handling, logging, pg_notify, null-check"
```

---

### Task 3: Integration test for HA authorize endpoint

**Files:**
- Test: `tests/oauth/ha-authorize.integration.test.ts` (CREATE)

**Step 1: Write integration tests for the authorize endpoint**

Create `tests/oauth/ha-authorize.integration.test.ts`:

```typescript
/**
 * Integration tests for POST /api/geolocation/providers/ha/authorize.
 * Verifies: geo_provider creation, oauth_state persistence, authorization URL format.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../../src/api/server.ts';
import { createPool } from '../../src/db.ts';
import { runMigrate } from '../helpers/migrate.ts';
import type { Pool } from 'pg';

process.env.OPENCLAW_PROJECTS_AUTH_DISABLED = 'true';
process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-bytes-long!!';

describe('HA OAuth authorize endpoint', () => {
  let app: ReturnType<typeof buildServer>;
  let pool: Pool;

  beforeAll(async () => {
    await runMigrate('up');
    app = buildServer({ logger: false });
    await app.ready();
    pool = createPool({ max: 2 });
  });

  afterAll(async () => {
    await pool.end();
    await app.close();
  });

  it('creates provider, state, and returns authorization URL', async () => {
    const email = 'ha-auth-test@example.com';
    await pool.query(
      `INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT (email) DO NOTHING`,
      [email],
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/geolocation/providers/ha/authorize',
      headers: { 'x-user-email': email },
      payload: {
        instance_url: 'https://ha.example.com',
        label: 'Test HA Provider',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.url).toContain('ha.example.com/auth/authorize');
    expect(body.url).toContain('client_id=');
    expect(body.url).toContain('redirect_uri=');
    expect(body.url).toContain('state=');
    expect(body.provider_id).toBeTruthy();

    // Verify geo_provider was created
    const provRow = await pool.query('SELECT * FROM geo_provider WHERE id = $1', [body.provider_id]);
    expect(provRow.rows).toHaveLength(1);
    expect(provRow.rows[0].status).toBe('connecting');
    expect(provRow.rows[0].auth_type).toBe('oauth2');

    // Verify oauth_state was created with correct fields
    const stateMatch = body.url.match(/state=([^&]+)/);
    expect(stateMatch).not.toBeNull();
    const stateRow = await pool.query(
      'SELECT * FROM oauth_state WHERE geo_provider_id = $1',
      [body.provider_id],
    );
    expect(stateRow.rows).toHaveLength(1);
    expect(stateRow.rows[0].provider).toBe('home_assistant');
    expect(stateRow.rows[0].instance_url).toBe('https://ha.example.com');
    expect(stateRow.rows[0].code_verifier).toBeNull();

    // Cleanup
    await pool.query('DELETE FROM geo_provider WHERE id = $1', [body.provider_id]);
  });

  it('returns 400 when instance_url is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/geolocation/providers/ha/authorize',
      headers: { 'x-user-email': 'ha-test@example.com' },
      payload: { label: 'Test' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('instance_url');
  });

  it('returns 400 when label is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/geolocation/providers/ha/authorize',
      headers: { 'x-user-email': 'ha-test@example.com' },
      payload: { instance_url: 'https://ha.example.com' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('label');
  });

  it('returns 401 when not authenticated', async () => {
    // Re-enable auth for this test
    const prevAuth = process.env.OPENCLAW_PROJECTS_AUTH_DISABLED;
    delete process.env.OPENCLAW_PROJECTS_AUTH_DISABLED;
    const authApp = buildServer({ logger: false });
    await authApp.ready();

    try {
      const res = await authApp.inject({
        method: 'POST',
        url: '/api/geolocation/providers/ha/authorize',
        payload: { instance_url: 'https://ha.example.com', label: 'Test' },
      });

      expect(res.statusCode).toBe(401);
    } finally {
      process.env.OPENCLAW_PROJECTS_AUTH_DISABLED = prevAuth ?? 'true';
      await authApp.close();
    }
  });
});
```

**Step 2: Run tests**

Run: `pnpm exec vitest run tests/oauth/ha-authorize.integration.test.ts`
Expected: ALL PASS (these test existing functionality)

**Step 3: Commit**

```bash
git add tests/oauth/ha-authorize.integration.test.ts
git commit -m "[#1836] Add integration tests for HA authorize endpoint"
```

---

### Task 4: Typecheck and full test run

**Step 1: Typecheck**

Run: `pnpm run build`
Expected: No type errors

**Step 2: Run full unit tests**

Run: `pnpm test:unit`
Expected: ALL PASS

**Step 3: Run full integration tests**

Run: `pnpm test:integration`
Expected: ALL PASS

**Step 4: Commit any fixes needed, then push**

```bash
git push -u origin issue/<ISSUE_NUMBER>-ha-oauth-callback-fix
```

---

### Task 5: Create PR and update issues

**Step 1: Create PR**

```bash
gh pr create --title "[#ISSUE] Fix HA OAuth callback: proper error handling + test coverage" --body "$(cat <<'EOF'
## Summary
- **Root cause**: HA callback throws plain `Error` (not `OAuthError`), bypassing error handler → 500
- Fixed `exchangeCodeForTokens` to throw `OAuthError` with structured error codes
- Added 15-second timeout to HA token exchange fetch
- Added HA error response body to error messages for diagnosability
- Added runtime validation of HA token response
- Added `pg_notify('geo_provider_config_changed')` to callback so connector picks up new credentials
- Added null-check on `updateProvider` return (handles deleted provider)
- Added structured logging to HA callback path

## Test coverage added
- `tests/oauth/home-assistant.test.ts` — unit tests for token exchange (8 tests)
- `tests/oauth/ha-callback.integration.test.ts` — integration tests for callback flow (5 tests)
- `tests/oauth/ha-authorize.integration.test.ts` — integration tests for authorize endpoint (4 tests)

## Bugs fixed
| ID | Description |
|----|-------------|
| C1 | Error handler mismatch (plain Error vs OAuthError) |
| C2 | No timeout on HA fetch |
| C3 | HA error body discarded |
| H1 | Missing pg_notify after credential update |
| H2 | updateProvider return not checked |
| H3 | No logging in HA callback |
| H4 | No validation of HA token payload |
| M1 | Non-JSON 200 response unhandled |

Closes #ISSUE_NUMBER

## Test plan
- [x] All new tests pass
- [x] Typecheck passes
- [x] Existing tests unaffected
- [ ] CI green
- [ ] Manual test: HA OAuth flow end-to-end

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

**Step 2: Update GitHub issues**

```bash
gh issue comment ISSUE_NUMBER --body "PR created. Root cause: HA token exchange throws plain Error, not OAuthError — bypasses the catch handler. Fixed with proper OAuthError types, 15s timeout, response validation, pg_notify, logging."
```

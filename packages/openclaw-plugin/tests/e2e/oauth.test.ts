/**
 * E2E tests for OAuth connection management API.
 * Part of Epic #1040, Issue #1057.
 *
 * These tests verify the full OAuth API surface: providers, connections
 * lifecycle, authorization URLs, callback error handling, connection
 * updates, and the drive/email API error paths.
 *
 * Run with: pnpm run test:e2e
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createE2EContext, areE2EServicesAvailable, cleanupResources, type E2ETestContext } from './setup.js';

const RUN_E2E = process.env.RUN_E2E === 'true';

/**
 * Raw fetch helper that returns the Response (not parsed JSON) so tests
 * can assert on status codes and error payloads.
 */
async function rawFetch(baseUrl: string, path: string, options?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}${path}`, options);
}

// ────────────────────────────────────────────────────────────────────────────
// OAuth Providers & Connections E2E
// ────────────────────────────────────────────────────────────────────────────

describe.skipIf(!RUN_E2E)('OAuth Providers API', () => {
  let context: E2ETestContext;

  beforeAll(async () => {
    context = createE2EContext();
    const available = await areE2EServicesAvailable(context.config);
    if (!available) {
      console.log('E2E services not available — skipping OAuth provider tests');
    }
  });

  it('should list configured and unconfigured providers', async () => {
    const res = await rawFetch(context.config.apiUrl, '/api/oauth/providers');
    expect(res.ok).toBe(true);

    const body = (await res.json()) as {
      providers: Array<{ name: string; configured: boolean }>;
      unconfigured: Array<{ name: string; configured: boolean; hint: string }>;
    };

    // providers + unconfigured should cover google and microsoft
    const allNames = [...body.providers.map((p) => p.name), ...body.unconfigured.map((p) => p.name)];
    expect(allNames).toContain('google');
    expect(allNames).toContain('microsoft');

    // Each configured provider should have configured=true
    for (const p of body.providers) {
      expect(p.configured).toBe(true);
    }

    // Each unconfigured provider should have a hint
    for (const p of body.unconfigured) {
      expect(p.configured).toBe(false);
      expect(p.hint).toBeTruthy();
    }
  });

  it('should list connections (initially may be empty)', async () => {
    const res = await rawFetch(context.config.apiUrl, '/api/oauth/connections');
    expect(res.ok).toBe(true);

    const body = (await res.json()) as { connections: Array<{ id: string }> };
    expect(body.connections).toBeDefined();
    expect(Array.isArray(body.connections)).toBe(true);
  });

  it('should filter connections by provider', async () => {
    const res = await rawFetch(context.config.apiUrl, '/api/oauth/connections?provider=google');
    expect(res.ok).toBe(true);

    const body = (await res.json()) as { connections: Array<{ id: string; provider: string }> };
    expect(body.connections).toBeDefined();
    // Every returned connection should be google
    for (const conn of body.connections) {
      expect(conn.provider).toBe('google');
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// OAuth Authorization URL Generation
// ────────────────────────────────────────────────────────────────────────────

describe.skipIf(!RUN_E2E)('OAuth Authorization URL', () => {
  let context: E2ETestContext;
  /** Providers confirmed as configured during setup. */
  let configuredProviders: string[] = [];

  beforeAll(async () => {
    context = createE2EContext();
    const available = await areE2EServicesAvailable(context.config);
    if (!available) return;

    // Discover which providers are configured so we can skip appropriately
    const res = await rawFetch(context.config.apiUrl, '/api/oauth/providers');
    const body = (await res.json()) as {
      providers: Array<{ name: string }>;
    };
    configuredProviders = body.providers.map((p) => p.name);
  });

  it('should reject unknown provider', async () => {
    const res = await rawFetch(context.config.apiUrl, '/api/oauth/authorize/unknown');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/unknown/i);
  });

  it('should reject invalid permission level', async () => {
    // Pick whichever provider is configured, or default to google
    const provider = configuredProviders[0] || 'google';
    const res = await rawFetch(context.config.apiUrl, `/api/oauth/authorize/${provider}?permissionLevel=admin`);
    // If provider is not configured, we get 503. If configured, we get 400.
    if (configuredProviders.includes(provider)) {
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/permission level/i);
    } else {
      expect(res.status).toBe(503);
    }
  });

  it('should reject invalid features', async () => {
    const provider = configuredProviders[0] || 'google';
    const res = await rawFetch(context.config.apiUrl, `/api/oauth/authorize/${provider}?features=invalid_feature`);
    if (configuredProviders.includes(provider)) {
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/invalid feature/i);
    } else {
      expect(res.status).toBe(503);
    }
  });

  it('should generate authorization URL for configured provider', async () => {
    if (configuredProviders.length === 0) {
      console.log('No providers configured — skipping authorization URL test');
      return;
    }

    const provider = configuredProviders[0];
    const res = await rawFetch(
      context.config.apiUrl,
      `/api/oauth/authorize/${provider}?features=contacts&permissionLevel=read`,
    );
    expect(res.ok).toBe(true);

    const body = (await res.json()) as {
      authUrl: string;
      state: string;
      provider: string;
      scopes: string[];
    };

    expect(body.authUrl).toBeTruthy();
    expect(body.state).toBeTruthy();
    expect(body.provider).toBe(provider);
    expect(body.scopes).toBeDefined();
    expect(Array.isArray(body.scopes)).toBe(true);
    expect(body.scopes.length).toBeGreaterThan(0);

    // Authorization URL should point to the provider
    if (provider === 'google') {
      expect(body.authUrl).toContain('accounts.google.com');
    } else if (provider === 'microsoft') {
      expect(body.authUrl).toContain('login.microsoftonline.com');
    }
  });

  it('should include feature-specific scopes', async () => {
    if (configuredProviders.length === 0) {
      console.log('No providers configured — skipping feature-specific scopes test');
      return;
    }

    const provider = configuredProviders[0];
    const res = await rawFetch(
      context.config.apiUrl,
      `/api/oauth/authorize/${provider}?features=contacts,email,files&permissionLevel=read_write`,
    );
    expect(res.ok).toBe(true);

    const body = (await res.json()) as { scopes: string[] };
    // Should have multiple scopes including base + feature scopes
    expect(body.scopes.length).toBeGreaterThan(1);
  });

  it('should return 503 for unconfigured provider', async () => {
    // Find a provider that is NOT configured
    const allProviders = ['google', 'microsoft'];
    const unconfigured = allProviders.find((p) => !configuredProviders.includes(p));
    if (!unconfigured) {
      // Both are configured — skip this test
      return;
    }

    const res = await rawFetch(context.config.apiUrl, `/api/oauth/authorize/${unconfigured}`);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/not configured/i);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// OAuth Callback Error Handling
// ────────────────────────────────────────────────────────────────────────────

describe.skipIf(!RUN_E2E)('OAuth Callback Error Handling', () => {
  let context: E2ETestContext;

  beforeAll(async () => {
    context = createE2EContext();
  });

  it('should reject callback with error parameter', async () => {
    const res = await rawFetch(context.config.apiUrl, '/api/oauth/callback?error=access_denied');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; details: string };
    expect(body.error).toMatch(/failed/i);
    expect(body.details).toBe('access_denied');
  });

  it('should reject callback with missing code', async () => {
    const res = await rawFetch(context.config.apiUrl, '/api/oauth/callback?state=abc123');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/missing.*code/i);
  });

  it('should reject callback with missing state', async () => {
    const res = await rawFetch(context.config.apiUrl, '/api/oauth/callback?code=abc123');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/missing.*state/i);
  });

  it('should reject callback with invalid/expired state', async () => {
    const res = await rawFetch(context.config.apiUrl, '/api/oauth/callback?code=abc123&state=invalid_state_value');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; code: string };
    expect(body.code).toBe('INVALID_STATE');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// OAuth Connection Lifecycle (CRUD via API)
// ────────────────────────────────────────────────────────────────────────────

describe.skipIf(!RUN_E2E)('OAuth Connection Lifecycle', () => {
  let context: E2ETestContext;
  const createdConnectionIds: string[] = [];

  beforeAll(async () => {
    context = createE2EContext();
    const available = await areE2EServicesAvailable(context.config);
    if (!available) {
      console.log('E2E services not available — skipping connection lifecycle tests');
    }
  });

  afterAll(async () => {
    // Clean up any connections created during tests
    for (const id of createdConnectionIds) {
      try {
        await rawFetch(context.config.apiUrl, `/api/oauth/connections/${id}`, {
          method: 'DELETE',
        });
      } catch {
        // Ignore cleanup errors
      }
    }
    await cleanupResources(context);
  });

  it('should return 404 when deleting non-existent connection', async () => {
    const fakeUUID = '00000000-0000-0000-0000-000000000000';
    const res = await rawFetch(context.config.apiUrl, `/api/oauth/connections/${fakeUUID}`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(404);
  });

  it('should return 404 when updating non-existent connection', async () => {
    const fakeUUID = '00000000-0000-0000-0000-000000000000';
    const res = await rawFetch(context.config.apiUrl, `/api/oauth/connections/${fakeUUID}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'test' }),
    });
    expect(res.status).toBe(404);
  });

  it('should reject empty label on update', async () => {
    // We need a real connection to test label validation.
    // Use a fake UUID — the label validation runs before the DB lookup.
    const fakeUUID = '00000000-0000-0000-0000-000000000001';
    const res = await rawFetch(context.config.apiUrl, `/api/oauth/connections/${fakeUUID}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: '   ' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/label/i);
  });

  it('should reject invalid permission level on update', async () => {
    const fakeUUID = '00000000-0000-0000-0000-000000000002';
    const res = await rawFetch(context.config.apiUrl, `/api/oauth/connections/${fakeUUID}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ permissionLevel: 'admin' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/permission level/i);
  });

  it('should reject invalid features on update', async () => {
    const fakeUUID = '00000000-0000-0000-0000-000000000003';
    const res = await rawFetch(context.config.apiUrl, `/api/oauth/connections/${fakeUUID}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabledFeatures: ['invalid_feature'] }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/invalid feature/i);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Drive API Error Handling
// ────────────────────────────────────────────────────────────────────────────

describe.skipIf(!RUN_E2E)('Drive API Error Handling', () => {
  let context: E2ETestContext;

  beforeAll(async () => {
    context = createE2EContext();
  });

  it('should require connectionId for file listing', async () => {
    const res = await rawFetch(context.config.apiUrl, '/api/drive/files');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/connectionId/i);
  });

  it('should reject invalid UUID for connectionId in file listing', async () => {
    const res = await rawFetch(context.config.apiUrl, '/api/drive/files?connectionId=not-a-uuid');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/valid UUID/i);
  });

  it('should return 404 for non-existent connection in file listing', async () => {
    const fakeUUID = '00000000-0000-0000-0000-000000000000';
    const res = await rawFetch(context.config.apiUrl, `/api/drive/files?connectionId=${fakeUUID}`);
    expect(res.status).toBe(404);
  });

  it('should require connectionId for file search', async () => {
    const res = await rawFetch(context.config.apiUrl, '/api/drive/files/search?q=test');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/connectionId/i);
  });

  it('should reject invalid UUID for connectionId in file search', async () => {
    const res = await rawFetch(context.config.apiUrl, '/api/drive/files/search?connectionId=not-a-uuid&q=test');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/valid UUID/i);
  });

  it('should require search query for file search', async () => {
    const fakeUUID = '00000000-0000-0000-0000-000000000000';
    const res = await rawFetch(context.config.apiUrl, `/api/drive/files/search?connectionId=${fakeUUID}`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/search query/i);
  });

  it('should require connectionId for single file get', async () => {
    const res = await rawFetch(context.config.apiUrl, '/api/drive/files/some-file-id');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/connectionId/i);
  });

  it('should reject invalid UUID for connectionId in single file get', async () => {
    const res = await rawFetch(context.config.apiUrl, '/api/drive/files/some-file-id?connectionId=not-a-uuid');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/valid UUID/i);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Email API Error Handling
// ────────────────────────────────────────────────────────────────────────────

describe.skipIf(!RUN_E2E)('Email API Error Handling', () => {
  let context: E2ETestContext;

  beforeAll(async () => {
    context = createE2EContext();
  });

  it('should require connectionId for message listing', async () => {
    const res = await rawFetch(context.config.apiUrl, '/api/email/messages');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/connectionId/i);
  });

  it('should require connectionId for single message get', async () => {
    const res = await rawFetch(context.config.apiUrl, '/api/email/messages/some-msg-id');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/connectionId/i);
  });

  it('should require connectionId for thread listing', async () => {
    const res = await rawFetch(context.config.apiUrl, '/api/email/threads');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/connectionId/i);
  });

  it('should require connectionId for single thread get', async () => {
    const res = await rawFetch(context.config.apiUrl, '/api/email/threads/some-thread-id');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/connectionId/i);
  });

  it('should require connectionId for folder listing', async () => {
    const res = await rawFetch(context.config.apiUrl, '/api/email/folders');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/connectionId/i);
  });

  it('should require connectionId for sending email', async () => {
    const res = await rawFetch(context.config.apiUrl, '/api/email/messages/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: 'test@example.com', subject: 'test', body: 'test' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/connectionId/i);
  });

  it('should require connectionId for creating draft', async () => {
    const res = await rawFetch(context.config.apiUrl, '/api/email/drafts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject: 'test', body: 'test' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/connectionId/i);
  });
});

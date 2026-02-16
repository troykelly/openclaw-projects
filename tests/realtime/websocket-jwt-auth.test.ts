/**
 * Tests for WebSocket JWT authentication logic.
 * Issue #1334: WebSocket auth via JWT query parameter.
 *
 * Tests the JWT verification functions used by the WebSocket handler.
 * Full WebSocket connection tests require the E2E test suite (test:e2e)
 * with a running server and database.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { signAccessToken, verifyAccessToken } from '../../src/api/auth/jwt.ts';
import { getAuthIdentity } from '../../src/api/auth/middleware.ts';
import { SignJWT } from 'jose';
import { randomUUID } from 'node:crypto';

/** JWT_SECRET must be at least 32 bytes. */
const TEST_JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-bytes-long!!';

describe('WebSocket JWT Auth — token verification', () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(() => {
    for (const key of ['OPENCLAW_PROJECTS_AUTH_DISABLED', 'JWT_SECRET']) {
      savedEnv[key] = process.env[key];
    }
    delete process.env.OPENCLAW_PROJECTS_AUTH_DISABLED;
    process.env.JWT_SECRET = TEST_JWT_SECRET;
  });

  afterAll(() => {
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = val;
      }
    }
  });

  it('verifies a valid access token from query parameter', async () => {
    const token = await signAccessToken('ws-user@example.com');
    const payload = await verifyAccessToken(token);

    expect(payload.sub).toBe('ws-user@example.com');
    expect(payload.type).toBe('user');
  });

  it('rejects an invalid token', async () => {
    await expect(verifyAccessToken('not-a-valid-jwt')).rejects.toThrow();
  });

  it('rejects an expired token', async () => {
    const expiredToken = await new SignJWT({ type: 'user' })
      .setProtectedHeader({ alg: 'HS256', kid: 'test' })
      .setSubject('expired@example.com')
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .setJti(randomUUID())
      .sign(new TextEncoder().encode(TEST_JWT_SECRET));

    await expect(verifyAccessToken(expiredToken)).rejects.toThrow();
  });

  it('rejects a token signed with wrong secret', async () => {
    const wrongToken = await new SignJWT({ type: 'user' })
      .setProtectedHeader({ alg: 'HS256', kid: 'test' })
      .setSubject('hacker@example.com')
      .setIssuedAt()
      .setExpirationTime('15m')
      .setJti(randomUUID())
      .sign(new TextEncoder().encode('wrong-secret-that-is-at-least-32-bytes-long!!'));

    await expect(verifyAccessToken(wrongToken)).rejects.toThrow();
  });
});

describe('WebSocket JWT Auth — getAuthIdentity', () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(() => {
    for (const key of ['OPENCLAW_PROJECTS_AUTH_DISABLED', 'JWT_SECRET', 'OPENCLAW_E2E_SESSION_EMAIL']) {
      savedEnv[key] = process.env[key];
    }
    delete process.env.OPENCLAW_PROJECTS_AUTH_DISABLED;
    delete process.env.OPENCLAW_E2E_SESSION_EMAIL;
    process.env.JWT_SECRET = TEST_JWT_SECRET;
  });

  afterAll(() => {
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = val;
      }
    }
  });

  it('extracts identity from Authorization Bearer header', async () => {
    const token = await signAccessToken('bearer-user@example.com');
    const fakeReq = {
      headers: { authorization: `Bearer ${token}` },
    };

    const identity = await getAuthIdentity(fakeReq as never);

    expect(identity).not.toBeNull();
    expect(identity!.email).toBe('bearer-user@example.com');
    expect(identity!.type).toBe('user');
  });

  it('returns null when no Authorization header is present', async () => {
    const fakeReq = { headers: {} };
    const identity = await getAuthIdentity(fakeReq as never);
    expect(identity).toBeNull();
  });

  it('returns null for invalid Bearer token', async () => {
    const fakeReq = {
      headers: { authorization: 'Bearer invalid-token' },
    };
    const identity = await getAuthIdentity(fakeReq as never);
    expect(identity).toBeNull();
  });
});

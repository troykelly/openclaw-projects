/**
 * Tests for M2M JWT token generation and verification.
 * Issue #1342: Migrate M2M auth from static secret to long-lived JWT.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { signM2MToken, verifyAccessToken, type JwtPayload } from '../src/api/auth/jwt.ts';

const TEST_SECRET = 'test-jwt-secret-with-at-least-32-bytes-long!!';

describe('M2M JWT token generation', () => {
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    originalEnv = {
      JWT_SECRET: process.env.JWT_SECRET,
      JWT_SECRET_PREVIOUS: process.env.JWT_SECRET_PREVIOUS,
      OPENCLAW_PROJECTS_AUTH_DISABLED: process.env.OPENCLAW_PROJECTS_AUTH_DISABLED,
    };
    process.env.JWT_SECRET = TEST_SECRET;
    delete process.env.JWT_SECRET_PREVIOUS;
    delete process.env.OPENCLAW_PROJECTS_AUTH_DISABLED;
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it('generates a valid M2M token with correct claims', async () => {
    const token = await signM2MToken('openclaw-gateway', ['api:full']);

    expect(token).toBeTruthy();
    expect(typeof token).toBe('string');

    const payload = await verifyAccessToken(token);
    expect(payload.sub).toBe('openclaw-gateway');
    expect(payload.type).toBe('m2m');
    expect(payload.scope).toBe('api:full');
    expect(payload.jti).toBeTruthy();
    expect(payload.kid).toBeTruthy();
    expect(payload.iat).toBeTruthy();
    expect(payload.exp).toBeTruthy();
  });

  it('sets issuer to openclaw-projects', async () => {
    const token = await signM2MToken('openclaw-gateway', ['api:full']);
    const payload = await verifyAccessToken(token);
    expect(payload.iss).toBe('openclaw-projects');
  });

  it('generates tokens with ~100 year TTL', async () => {
    const token = await signM2MToken('openclaw-gateway', ['api:full']);
    const payload = await verifyAccessToken(token);

    const ttlSeconds = payload.exp - payload.iat;
    // 100 years in seconds = 100 * 365.25 * 24 * 60 * 60 = 3155760000
    // Allow some tolerance (99-101 years)
    const minTtl = 99 * 365.25 * 24 * 60 * 60;
    const maxTtl = 101 * 365.25 * 24 * 60 * 60;
    expect(ttlSeconds).toBeGreaterThan(minTtl);
    expect(ttlSeconds).toBeLessThan(maxTtl);
  });

  it('supports multiple scopes', async () => {
    const token = await signM2MToken('my-service', ['api:read', 'api:write', 'admin']);
    const payload = await verifyAccessToken(token);
    expect(payload.scope).toBe('api:read api:write admin');
  });

  it('generates tokens with empty scope array', async () => {
    const token = await signM2MToken('my-service', []);
    const payload = await verifyAccessToken(token);
    expect(payload.scope).toBeUndefined();
  });

  it('M2M tokens are verified by the same verifyAccessToken path', async () => {
    const token = await signM2MToken('test-service', ['api:full']);

    // This is the same verification used for user tokens
    const payload = await verifyAccessToken(token);
    expect(payload.sub).toBe('test-service');
    expect(payload.type).toBe('m2m');
  });

  it('throws if JWT_SECRET is not set', async () => {
    delete process.env.JWT_SECRET;

    await expect(signM2MToken('test', ['api:full'])).rejects.toThrow('JWT_SECRET');
  });

  it('throws if JWT_SECRET is too short', async () => {
    process.env.JWT_SECRET = 'short';

    await expect(signM2MToken('test', ['api:full'])).rejects.toThrow('at least');
  });

  it('generates unique tokens (different jti each time)', async () => {
    const token1 = await signM2MToken('svc', ['api:full']);
    const token2 = await signM2MToken('svc', ['api:full']);

    const payload1 = await verifyAccessToken(token1);
    const payload2 = await verifyAccessToken(token2);

    expect(payload1.jti).not.toBe(payload2.jti);
  });

  it('tokens signed with one secret fail verification with another', async () => {
    const token = await signM2MToken('svc', ['api:full']);

    // Change secret
    process.env.JWT_SECRET = 'a-completely-different-secret-that-is-also-long-enough!';
    delete process.env.JWT_SECRET_PREVIOUS;

    await expect(verifyAccessToken(token)).rejects.toThrow();
  });

  it('tokens signed with previous secret are verified during key rotation', async () => {
    const token = await signM2MToken('svc', ['api:full']);

    // Rotate: old secret becomes previous
    process.env.JWT_SECRET_PREVIOUS = TEST_SECRET;
    process.env.JWT_SECRET = 'a-brand-new-secret-with-enough-bytes-for-validation!!';

    const payload = await verifyAccessToken(token);
    expect(payload.sub).toBe('svc');
    expect(payload.type).toBe('m2m');
  });
});

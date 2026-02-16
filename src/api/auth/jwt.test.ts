import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SignJWT } from 'jose';

// We'll test the jwt module. Must set env vars before import.
const TEST_SECRET = 'a]Uf9$Lx2!Qm7Kp@Wz4Rn8Yb6Hd3Jt0Vs'; // 36 chars, > 32 bytes
const TEST_SECRET_PREVIOUS = 'Xc5Eg1Ij9Ol3Aq7Uw2Sy6Gk0Mf8Bn4Dp'; // different 34 char secret

describe('JWT signing infrastructure', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    // Reset module cache so env vars take effect
    vi.resetModules();
    vi.stubEnv('JWT_SECRET', TEST_SECRET);
    vi.stubEnv('OPENCLAW_PROJECTS_AUTH_DISABLED', 'true');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function loadModule() {
    return import('./jwt.ts');
  }

  describe('signAccessToken', () => {
    it('should produce a valid JWT string', async () => {
      const { signAccessToken } = await loadModule();
      const token = await signAccessToken('user@example.com');
      expect(typeof token).toBe('string');
      // JWT format: header.payload.signature
      const parts = token.split('.');
      expect(parts).toHaveLength(3);
    });

    it('should include required claims in payload', async () => {
      const { signAccessToken, verifyAccessToken } = await loadModule();
      const token = await signAccessToken('user@example.com');
      const payload = await verifyAccessToken(token);

      expect(payload.sub).toBe('user@example.com');
      expect(payload.type).toBe('user');
      expect(typeof payload.iat).toBe('number');
      expect(typeof payload.exp).toBe('number');
      expect(typeof payload.jti).toBe('string');
      expect(typeof payload.kid).toBe('string');
    });

    it('should set expiration to 15 minutes', async () => {
      const { signAccessToken, verifyAccessToken } = await loadModule();
      const token = await signAccessToken('user@example.com');
      const payload = await verifyAccessToken(token);

      const diff = payload.exp - payload.iat;
      expect(diff).toBe(15 * 60); // 900 seconds
    });

    it('should generate unique jti for each token', async () => {
      const { signAccessToken, verifyAccessToken } = await loadModule();
      const token1 = await signAccessToken('user@example.com');
      const token2 = await signAccessToken('user@example.com');

      const payload1 = await verifyAccessToken(token1);
      const payload2 = await verifyAccessToken(token2);

      expect(payload1.jti).not.toBe(payload2.jti);
    });

    it('should include kid in JWT header', async () => {
      const { signAccessToken } = await loadModule();
      const token = await signAccessToken('user@example.com');

      // Decode header manually
      const headerB64 = token.split('.')[0];
      const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString());
      expect(header.kid).toBeDefined();
      expect(typeof header.kid).toBe('string');
      expect(header.alg).toBe('HS256');
    });

    it('should support m2m token type', async () => {
      const { signAccessToken, verifyAccessToken } = await loadModule();
      const token = await signAccessToken('service@example.com', { type: 'm2m' });
      const payload = await verifyAccessToken(token);

      expect(payload.type).toBe('m2m');
      expect(payload.sub).toBe('service@example.com');
    });

    it('should support scopes', async () => {
      const { signAccessToken, verifyAccessToken } = await loadModule();
      const token = await signAccessToken('service@example.com', {
        type: 'm2m',
        scopes: ['read:work-items', 'write:work-items'],
      });
      const payload = await verifyAccessToken(token);

      expect(payload.scope).toBe('read:work-items write:work-items');
    });

    it('should produce compact tokens under 500 bytes', async () => {
      const { signAccessToken } = await loadModule();
      const token = await signAccessToken('user@example.com');
      expect(token.length).toBeLessThan(500);
    });

    it('should produce compact tokens under 500 bytes even with scopes', async () => {
      const { signAccessToken } = await loadModule();
      const token = await signAccessToken('service@example.com', {
        type: 'm2m',
        scopes: ['read:work-items', 'write:work-items', 'read:contacts'],
      });
      expect(token.length).toBeLessThan(500);
    });
  });

  describe('verifyAccessToken', () => {
    it('should verify a valid token', async () => {
      const { signAccessToken, verifyAccessToken } = await loadModule();
      const token = await signAccessToken('user@example.com');
      const payload = await verifyAccessToken(token);

      expect(payload.sub).toBe('user@example.com');
    });

    it('should reject an expired token', async () => {
      const { verifyAccessToken } = await loadModule();

      // Craft a token that expired 2 minutes ago (well past 30s clock skew)
      const nowSec = Math.floor(Date.now() / 1000);
      const expiredToken = await new SignJWT({ type: 'user' })
        .setProtectedHeader({ alg: 'HS256', kid: 'test' })
        .setSubject('user@example.com')
        .setIssuedAt(nowSec - 20 * 60)
        .setExpirationTime(nowSec - 2 * 60)
        .setJti('expired-jti')
        .sign(new TextEncoder().encode(TEST_SECRET));

      await expect(verifyAccessToken(expiredToken)).rejects.toThrow();
    });

    it('should accept a token within clock skew tolerance', async () => {
      const { verifyAccessToken } = await loadModule();

      // Craft a token that expired 20 seconds ago (within 30s clock skew)
      const nowSec = Math.floor(Date.now() / 1000);
      const recentlyExpiredToken = await new SignJWT({ type: 'user' })
        .setProtectedHeader({ alg: 'HS256', kid: 'test' })
        .setSubject('user@example.com')
        .setIssuedAt(nowSec - 15 * 60)
        .setExpirationTime(nowSec - 20)
        .setJti('skew-jti')
        .sign(new TextEncoder().encode(TEST_SECRET));

      // Should still be valid (20s past expiry, within 30s clock skew)
      const payload = await verifyAccessToken(recentlyExpiredToken);
      expect(payload.sub).toBe('user@example.com');
    });

    it('should reject a token with invalid signature', async () => {
      const { signAccessToken, verifyAccessToken } = await loadModule();
      const token = await signAccessToken('user@example.com');

      // Tamper with the signature
      const parts = token.split('.');
      parts[2] = parts[2].split('').reverse().join('');
      const tamperedToken = parts.join('.');

      await expect(verifyAccessToken(tamperedToken)).rejects.toThrow();
    });

    it('should reject a completely invalid token', async () => {
      const { verifyAccessToken } = await loadModule();

      await expect(verifyAccessToken('not-a-jwt')).rejects.toThrow();
      await expect(verifyAccessToken('')).rejects.toThrow();
    });

    it('should reject a token signed with a different secret', async () => {
      const { signAccessToken } = await loadModule();
      const token = await signAccessToken('user@example.com');

      // Reset module with a different secret
      vi.resetModules();
      vi.stubEnv('JWT_SECRET', 'Z9a8b7c6d5e4f3g2h1i0j9k8l7m6n5o4');

      const freshModule = await loadModule();
      await expect(freshModule.verifyAccessToken(token)).rejects.toThrow();
    });
  });

  describe('key rotation', () => {
    it('should verify a token signed with the primary key', async () => {
      vi.stubEnv('JWT_SECRET', TEST_SECRET);
      vi.stubEnv('JWT_SECRET_PREVIOUS', TEST_SECRET_PREVIOUS);

      const { signAccessToken, verifyAccessToken } = await loadModule();
      const token = await signAccessToken('user@example.com');
      const payload = await verifyAccessToken(token);

      expect(payload.sub).toBe('user@example.com');
    });

    it('should verify a token signed with the previous key', async () => {
      // Sign with OLD key as primary (no previous)
      vi.stubEnv('JWT_SECRET', TEST_SECRET_PREVIOUS);
      const oldModule = await loadModule();
      const token = await oldModule.signAccessToken('user@example.com');

      // Now rotate keys: new primary, old becomes previous
      vi.resetModules();
      vi.stubEnv('JWT_SECRET', TEST_SECRET);
      vi.stubEnv('JWT_SECRET_PREVIOUS', TEST_SECRET_PREVIOUS);
      vi.stubEnv('OPENCLAW_PROJECTS_AUTH_DISABLED', 'true');

      const newModule = await loadModule();
      const payload = await newModule.verifyAccessToken(token);

      expect(payload.sub).toBe('user@example.com');
    });

    it('should always sign with the primary key', async () => {
      vi.stubEnv('JWT_SECRET', TEST_SECRET);
      vi.stubEnv('JWT_SECRET_PREVIOUS', TEST_SECRET_PREVIOUS);

      const { signAccessToken } = await loadModule();
      const token = await signAccessToken('user@example.com');

      // Verify it can be verified with primary key only (no previous)
      vi.resetModules();
      vi.stubEnv('JWT_SECRET', TEST_SECRET);
      // No JWT_SECRET_PREVIOUS set
      vi.stubEnv('OPENCLAW_PROJECTS_AUTH_DISABLED', 'true');

      const primaryOnlyModule = await loadModule();
      const payload = await primaryOnlyModule.verifyAccessToken(token);
      expect(payload.sub).toBe('user@example.com');
    });

    it('should reject a token not signed by either key', async () => {
      vi.stubEnv('JWT_SECRET', TEST_SECRET);
      vi.stubEnv('JWT_SECRET_PREVIOUS', TEST_SECRET_PREVIOUS);

      const { verifyAccessToken } = await loadModule();

      // Sign with a completely different key
      vi.resetModules();
      vi.stubEnv('JWT_SECRET', 'Z9a8b7c6d5e4f3g2h1i0j9k8l7m6n5o4');
      vi.stubEnv('OPENCLAW_PROJECTS_AUTH_DISABLED', 'true');

      const otherModule = await loadModule();
      const token = await otherModule.signAccessToken('user@example.com');

      // Now try to verify with original keys
      vi.resetModules();
      vi.stubEnv('JWT_SECRET', TEST_SECRET);
      vi.stubEnv('JWT_SECRET_PREVIOUS', TEST_SECRET_PREVIOUS);
      vi.stubEnv('OPENCLAW_PROJECTS_AUTH_DISABLED', 'true');

      const originalModule = await loadModule();
      await expect(originalModule.verifyAccessToken(token)).rejects.toThrow();
    });

    it('should use different kid values for different secrets', async () => {
      vi.stubEnv('JWT_SECRET', TEST_SECRET);
      const mod1 = await loadModule();
      const token1 = await mod1.signAccessToken('user@example.com');

      vi.resetModules();
      vi.stubEnv('JWT_SECRET', TEST_SECRET_PREVIOUS);
      vi.stubEnv('OPENCLAW_PROJECTS_AUTH_DISABLED', 'true');
      const mod2 = await loadModule();
      const token2 = await mod2.signAccessToken('user@example.com');

      const header1 = JSON.parse(Buffer.from(token1.split('.')[0], 'base64url').toString());
      const header2 = JSON.parse(Buffer.from(token2.split('.')[0], 'base64url').toString());

      expect(header1.kid).not.toBe(header2.kid);
    });
  });

  describe('missing secret', () => {
    it('should throw when JWT_SECRET is not set and auth is not disabled', async () => {
      vi.stubEnv('OPENCLAW_PROJECTS_AUTH_DISABLED', '');
      delete process.env.JWT_SECRET;
      vi.stubEnv('JWT_SECRET', '');

      await expect(loadModule().then((m) => m.signAccessToken('user@example.com'))).rejects.toThrow(
        /JWT_SECRET/,
      );
    });

    it('should not throw when JWT_SECRET is missing but auth is disabled', async () => {
      vi.stubEnv('OPENCLAW_PROJECTS_AUTH_DISABLED', 'true');
      vi.stubEnv('JWT_SECRET', '');

      const mod = await loadModule();
      // signAccessToken should still throw because you can't sign without a key
      await expect(mod.signAccessToken('user@example.com')).rejects.toThrow(/JWT_SECRET/);
    });

    it('should throw if JWT_SECRET is too short (< 32 bytes)', async () => {
      vi.stubEnv('JWT_SECRET', 'too-short');
      vi.stubEnv('OPENCLAW_PROJECTS_AUTH_DISABLED', 'true');

      const mod = await loadModule();
      await expect(mod.signAccessToken('user@example.com')).rejects.toThrow(/32/);
    });
  });

  describe('JwtPayload type', () => {
    it('should export JwtPayload type', async () => {
      const mod = await loadModule();
      // Just verify the module exports exist
      expect(typeof mod.signAccessToken).toBe('function');
      expect(typeof mod.verifyAccessToken).toBe('function');
    });
  });
});

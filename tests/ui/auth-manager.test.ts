/**
 * Tests for the auth token manager.
 *
 * Covers: getAccessToken, setAccessToken, clearAccessToken,
 * refreshAccessToken, isTokenExpired, and concurrent refresh queuing.
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// We'll import after the module exists — for now define the expected interface
// so tests are written first (TDD).
import { clearAccessToken, getAccessToken, isTokenExpired, refreshAccessToken, setAccessToken } from '../../src/ui/lib/auth-manager.ts';

/** Encode a JWT payload (no signature verification needed for client-side parsing). */
function fakeJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = btoa(JSON.stringify(payload));
  return `${header}.${body}.fake-signature`;
}

// Save original fetch so we can restore it
const originalFetch = globalThis.fetch;

function mockFetch(response: Partial<Response> & { json?: () => Promise<unknown> }) {
  const fn = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({}),
    ...response,
  });
  globalThis.fetch = fn;
  return fn;
}

describe('auth-manager', () => {
  beforeEach(() => {
    clearAccessToken();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('getAccessToken / setAccessToken / clearAccessToken', () => {
    it('should return null when no token is set', () => {
      expect(getAccessToken()).toBeNull();
    });

    it('should store and return a token', () => {
      const token = fakeJwt({ sub: 'user@example.com', exp: Math.floor(Date.now() / 1000) + 900 });
      setAccessToken(token);
      expect(getAccessToken()).toBe(token);
    });

    it('should clear the stored token', () => {
      const token = fakeJwt({ sub: 'user@example.com', exp: Math.floor(Date.now() / 1000) + 900 });
      setAccessToken(token);
      clearAccessToken();
      expect(getAccessToken()).toBeNull();
    });

    it('should not store tokens in localStorage or sessionStorage', () => {
      const token = fakeJwt({ sub: 'user@example.com', exp: Math.floor(Date.now() / 1000) + 900 });
      setAccessToken(token);
      expect(window.localStorage.getItem('access_token')).toBeNull();
      expect(window.localStorage.getItem('token')).toBeNull();
      expect(window.sessionStorage.getItem('access_token')).toBeNull();
      expect(window.sessionStorage.getItem('token')).toBeNull();
    });
  });

  describe('isTokenExpired', () => {
    it('should return true when no token is set', () => {
      expect(isTokenExpired()).toBe(true);
    });

    it('should return false for a token that expires in the future (beyond buffer)', () => {
      const exp = Math.floor(Date.now() / 1000) + 120; // 2 minutes from now
      const token = fakeJwt({ sub: 'user@example.com', exp });
      setAccessToken(token);
      expect(isTokenExpired()).toBe(false);
    });

    it('should return true for an already-expired token', () => {
      const exp = Math.floor(Date.now() / 1000) - 60; // 1 minute ago
      const token = fakeJwt({ sub: 'user@example.com', exp });
      setAccessToken(token);
      expect(isTokenExpired()).toBe(true);
    });

    it('should return true when token expires within the 30s buffer', () => {
      const exp = Math.floor(Date.now() / 1000) + 15; // 15 seconds from now (within 30s buffer)
      const token = fakeJwt({ sub: 'user@example.com', exp });
      setAccessToken(token);
      expect(isTokenExpired()).toBe(true);
    });

    it('should return false when token expires just beyond the 30s buffer', () => {
      const exp = Math.floor(Date.now() / 1000) + 60; // 60 seconds from now
      const token = fakeJwt({ sub: 'user@example.com', exp });
      setAccessToken(token);
      expect(isTokenExpired()).toBe(false);
    });
  });

  describe('refreshAccessToken', () => {
    it('should call POST /api/auth/refresh and store the new token', async () => {
      const newToken = fakeJwt({ sub: 'user@example.com', exp: Math.floor(Date.now() / 1000) + 900 });
      const fetchMock = mockFetch({
        ok: true,
        status: 200,
        json: async () => ({ access_token: newToken }),
      });

      const result = await refreshAccessToken();

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/auth/refresh'),
        expect.objectContaining({
          method: 'POST',
          credentials: 'include',
        }),
      );
      expect(result).toBe(newToken);
      expect(getAccessToken()).toBe(newToken);
    });

    it('should throw when refresh endpoint returns non-2xx', async () => {
      mockFetch({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({ message: 'Refresh token expired' }),
      });

      await expect(refreshAccessToken()).rejects.toThrow();
      expect(getAccessToken()).toBeNull();
    });

    it('should queue concurrent calls and only make one fetch request', async () => {
      const newToken = fakeJwt({ sub: 'user@example.com', exp: Math.floor(Date.now() / 1000) + 900 });
      let resolvePromise: (value: Response) => void;
      const pendingPromise = new Promise<Response>((resolve) => {
        resolvePromise = resolve;
      });

      const fetchMock = vi.fn().mockReturnValue(pendingPromise);
      globalThis.fetch = fetchMock;

      // Fire off 3 concurrent refreshes
      const p1 = refreshAccessToken();
      const p2 = refreshAccessToken();
      const p3 = refreshAccessToken();

      // Only one fetch call should have been made
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Resolve the pending fetch
      resolvePromise!({
        ok: true,
        status: 200,
        json: async () => ({ access_token: newToken }),
      } as Response);

      // All three promises should resolve with the same token
      const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
      expect(r1).toBe(newToken);
      expect(r2).toBe(newToken);
      expect(r3).toBe(newToken);

      // Still only one fetch call
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('should allow a new refresh after the previous one completes', async () => {
      const token1 = fakeJwt({ sub: 'user@example.com', exp: Math.floor(Date.now() / 1000) + 900 });
      const token2 = fakeJwt({ sub: 'user@example.com', exp: Math.floor(Date.now() / 1000) + 1800 });

      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ access_token: token1 }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ access_token: token2 }),
        } as Response);
      globalThis.fetch = fetchMock;

      const r1 = await refreshAccessToken();
      expect(r1).toBe(token1);

      const r2 = await refreshAccessToken();
      expect(r2).toBe(token2);

      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('should reject all queued callers when refresh fails', async () => {
      let resolvePromise: (value: Response) => void;
      const pendingPromise = new Promise<Response>((resolve) => {
        resolvePromise = resolve;
      });

      const fetchMock = vi.fn().mockReturnValue(pendingPromise);
      globalThis.fetch = fetchMock;

      const p1 = refreshAccessToken();
      const p2 = refreshAccessToken();

      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Resolve with failure
      resolvePromise!({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({ message: 'Refresh token expired' }),
      } as unknown as Response);

      await expect(p1).rejects.toThrow();
      await expect(p2).rejects.toThrow();
    });
  });
});

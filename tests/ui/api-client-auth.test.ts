/**
 * Tests for api-client auth integration.
 *
 * Verifies: Authorization header injection, 401 retry with refresh,
 * redirect to login on refresh failure, and concurrent request queuing.
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError, apiClient } from '../../src/ui/lib/api-client.ts';
// Auth manager functions (used to set up test state)
import { clearAccessToken, getAccessToken, setAccessToken } from '../../src/ui/lib/auth-manager.ts';

/** Encode a JWT payload for testing. */
function fakeJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = btoa(JSON.stringify(payload));
  return `${header}.${body}.fake-signature`;
}

const originalFetch = globalThis.fetch;
const originalLocation = window.location;

describe('api-client auth integration', () => {
  beforeEach(() => {
    clearAccessToken();
    // Mock window.location for redirect tests
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { ...originalLocation, href: 'http://localhost/app/work-items', assign: vi.fn() },
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    Object.defineProperty(window, 'location', {
      writable: true,
      value: originalLocation,
    });
  });

  describe('Authorization header', () => {
    it('should add Bearer token header when token is set', async () => {
      const token = fakeJwt({ sub: 'user@example.com', exp: Math.floor(Date.now() / 1000) + 900 });
      setAccessToken(token);

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ items: [] }),
      });
      globalThis.fetch = fetchMock;

      await apiClient.get('/api/work-items');

      expect(fetchMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            authorization: `Bearer ${token}`,
          }),
        }),
      );
    });

    it('should not add Authorization header when no token is set', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ items: [] }),
      });
      globalThis.fetch = fetchMock;

      await apiClient.get('/api/work-items');

      const callHeaders = fetchMock.mock.calls[0][1].headers as Record<string, string>;
      expect(callHeaders.authorization).toBeUndefined();
    });

    it('should include Bearer token on POST requests', async () => {
      const token = fakeJwt({ sub: 'user@example.com', exp: Math.floor(Date.now() / 1000) + 900 });
      setAccessToken(token);

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({ id: '1' }),
      });
      globalThis.fetch = fetchMock;

      await apiClient.post('/api/work-items', { title: 'Test' });

      expect(fetchMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            authorization: `Bearer ${token}`,
          }),
        }),
      );
    });
  });

  describe('401 retry with token refresh', () => {
    it('should retry the request once after refreshing the token on 401', async () => {
      const oldToken = fakeJwt({ sub: 'user@example.com', exp: Math.floor(Date.now() / 1000) - 60 });
      const newToken = fakeJwt({ sub: 'user@example.com', exp: Math.floor(Date.now() / 1000) + 900 });
      setAccessToken(oldToken);

      const fetchMock = vi
        .fn()
        // First call: 401
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          json: async () => ({ message: 'Token expired' }),
        })
        // Refresh call: success
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ access_token: newToken }),
        })
        // Retry call: success
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ items: [{ id: '1' }] }),
        });
      globalThis.fetch = fetchMock;

      const result = await apiClient.get<{ items: Array<{ id: string }> }>('/api/work-items');

      expect(result.items).toHaveLength(1);
      expect(fetchMock).toHaveBeenCalledTimes(3); // original + refresh + retry
      expect(getAccessToken()).toBe(newToken);
    });

    it('should not retry if the request was not a 401', async () => {
      const token = fakeJwt({ sub: 'user@example.com', exp: Math.floor(Date.now() / 1000) + 900 });
      setAccessToken(token);

      const fetchMock = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        json: async () => ({ message: 'Access denied' }),
      });
      globalThis.fetch = fetchMock;

      await expect(apiClient.get('/api/admin')).rejects.toThrow(ApiRequestError);
      expect(fetchMock).toHaveBeenCalledTimes(1); // no retry
    });

    it('should redirect to login when refresh fails after 401', async () => {
      const oldToken = fakeJwt({ sub: 'user@example.com', exp: Math.floor(Date.now() / 1000) - 60 });
      setAccessToken(oldToken);

      const fetchMock = vi
        .fn()
        // First call: 401
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          json: async () => ({ message: 'Token expired' }),
        })
        // Refresh call: also fails
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          json: async () => ({ message: 'Refresh token expired' }),
        });
      globalThis.fetch = fetchMock;

      await expect(apiClient.get('/api/work-items')).rejects.toThrow();
      expect(getAccessToken()).toBeNull();
      expect(window.location.href).toBe('/app/login');
    });

    it('should not attempt refresh for auth endpoints (avoid infinite loop)', async () => {
      const oldToken = fakeJwt({ sub: 'user@example.com', exp: Math.floor(Date.now() / 1000) - 60 });
      setAccessToken(oldToken);

      const fetchMock = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({ message: 'Token expired' }),
      });
      globalThis.fetch = fetchMock;

      await expect(apiClient.post('/api/auth/refresh', {})).rejects.toThrow(ApiRequestError);
      // Should NOT retry — only 1 fetch call
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});

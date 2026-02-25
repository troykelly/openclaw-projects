import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { ApiClient, createApiClient } from '../src/api-client.js';
import type { PluginConfig } from '../src/config.js';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('ApiClient', () => {
  const defaultConfig: PluginConfig = {
    apiUrl: 'https://api.example.com',
    apiKey: 'test-api-key',
    autoRecall: true,
    autoCapture: true,
    userScoping: 'agent',
    maxRecallMemories: 5,
    minRecallScore: 0.7,
    timeout: 30000, // 30s for tests to avoid race conditions with mocks
    maxRetries: 3,
    debug: false,
  };

  const mockLogger = {
    namespace: 'test',
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('createApiClient', () => {
    it('should create an ApiClient instance', () => {
      const client = createApiClient({ config: defaultConfig });
      expect(client).toBeInstanceOf(ApiClient);
    });
  });

  describe('request headers', () => {
    it('should include Authorization header', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: 'test' }),
      });

      const client = createApiClient({ config: defaultConfig, logger: mockLogger });
      await client.get('/test');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/test',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-api-key',
          }),
        }),
      );
    });

    it('should include X-Request-Id header for tracing', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({}),
      });

      const client = createApiClient({ config: defaultConfig, logger: mockLogger });
      await client.get('/test');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Request-Id': expect.any(String),
          }),
        }),
      );
    });

    it('should include user scoping header when user_id provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({}),
      });

      const client = createApiClient({ config: defaultConfig, logger: mockLogger });
      await client.get('/test', { user_id: 'user-123' });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Agent-Id': 'user-123',
          }),
        }),
      );
    });

    it('should include X-User-Email header when user_email provided (#1567)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({}),
      });

      const client = createApiClient({ config: defaultConfig, logger: mockLogger });
      await client.get('/test', { user_id: 'troy', user_email: 'troy@troykelly.com' });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Agent-Id': 'troy',
            'X-User-Email': 'troy@troykelly.com',
          }),
        }),
      );
    });

    it('should not include X-User-Email header when user_email is absent (#1567)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({}),
      });

      const client = createApiClient({ config: defaultConfig, logger: mockLogger });
      await client.get('/test', { user_id: 'troy' });

      const callHeaders = mockFetch.mock.calls[0][1].headers as Record<string, string>;
      expect(callHeaders['X-Agent-Id']).toBe('troy');
      expect(callHeaders['X-User-Email']).toBeUndefined();
    });

    it('should include X-Namespace header when namespace provided (#1760)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({}),
      });

      const client = createApiClient({ config: defaultConfig, logger: mockLogger });
      await client.get('/test', { user_id: 'acme', namespace: 'acme' });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Agent-Id': 'acme',
            'X-Namespace': 'acme',
          }),
        }),
      );
    });

    it('should not include X-Namespace header when namespace is absent (#1760)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({}),
      });

      const client = createApiClient({ config: defaultConfig, logger: mockLogger });
      await client.get('/test', { user_id: 'troy' });

      const callHeaders = mockFetch.mock.calls[0][1].headers as Record<string, string>;
      expect(callHeaders['X-Namespace']).toBeUndefined();
    });

    it('should include X-Namespace header on PATCH requests (#1760)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({}),
      });

      const client = createApiClient({ config: defaultConfig, logger: mockLogger });
      await client.patch('/api/work-items/123/status', { status: 'completed' }, { user_id: 'acme', namespace: 'acme' });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Namespace': 'acme',
          }),
        }),
      );
    });


    it('should include Content-Type header', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({}),
      });

      const client = createApiClient({ config: defaultConfig, logger: mockLogger });
      await client.post('/test', { data: 'value' });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        }),
      );
    });
  });

  describe('successful responses', () => {
    it('should return success with data for 200 response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 1, name: 'Test' }),
      });

      const client = createApiClient({ config: defaultConfig, logger: mockLogger });
      const result = await client.get('/items/1');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ id: 1, name: 'Test' });
      }
    });

    it('should handle 204 No Content', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
        json: async () => {
          throw new Error('No content');
        },
      });

      const client = createApiClient({ config: defaultConfig, logger: mockLogger });
      const result = await client.delete('/items/1');

      expect(result.success).toBe(true);
    });

    it('should handle 201 Created', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({ id: 'new-123' }),
      });

      const client = createApiClient({ config: defaultConfig, logger: mockLogger });
      const result = await client.post('/items', { name: 'New Item' });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ id: 'new-123' });
      }
    });
  });

  describe('error responses', () => {
    it('should return error for 400 Bad Request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        headers: new Headers(),
        json: async () => ({ message: 'Invalid input', code: 'VALIDATION_ERROR' }),
      });

      const client = createApiClient({
        config: { ...defaultConfig, maxRetries: 0 },
        logger: mockLogger,
      });
      const result = await client.post('/items', { invalid: 'data' });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.status).toBe(400);
        expect(result.error.message).toBe('Invalid input');
        expect(result.error.code).toBe('CLIENT_ERROR');
      }
    });

    it('should return error for 401 Unauthorized', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        headers: new Headers(),
        json: async () => ({ message: 'Invalid API key' }),
      });

      const client = createApiClient({
        config: { ...defaultConfig, maxRetries: 0 },
        logger: mockLogger,
      });
      const result = await client.get('/items');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.status).toBe(401);
        expect(result.error.code).toBe('AUTH_ERROR');
      }
    });

    it('should return error for 403 Forbidden', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        headers: new Headers(),
        json: async () => ({ message: 'Access denied' }),
      });

      const client = createApiClient({
        config: { ...defaultConfig, maxRetries: 0 },
        logger: mockLogger,
      });
      const result = await client.get('/admin');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.status).toBe(403);
        expect(result.error.code).toBe('AUTH_ERROR');
      }
    });

    it('should return error for 404 Not Found', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        headers: new Headers(),
        json: async () => ({ message: 'Item not found' }),
      });

      const client = createApiClient({
        config: { ...defaultConfig, maxRetries: 0 },
        logger: mockLogger,
      });
      const result = await client.get('/items/999');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.status).toBe(404);
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('should handle 429 Rate Limit with Retry-After header', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        headers: new Headers({ 'Retry-After': '60' }),
        json: async () => ({ message: 'Rate limit exceeded' }),
      });

      const client = createApiClient({
        config: { ...defaultConfig, maxRetries: 0 },
        logger: mockLogger,
      });
      const result = await client.get('/items');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.status).toBe(429);
        expect(result.error.code).toBe('RATE_LIMITED');
        expect(result.error.retryAfter).toBe(60);
      }
    });

    it('should return error for 500 Internal Server Error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        headers: new Headers(),
        json: async () => ({ message: 'Server error' }),
      });

      const client = createApiClient({
        config: { ...defaultConfig, maxRetries: 0 },
        logger: mockLogger,
      });
      const result = await client.get('/items');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.status).toBe(500);
        expect(result.error.code).toBe('SERVER_ERROR');
      }
    });
  });

  describe('retry logic', () => {
    it('should not retry on 4xx errors (except 429)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        headers: new Headers(),
        json: async () => ({ message: 'Bad request' }),
      });

      // Uses maxRetries: 3, but 4xx should NOT retry
      const client = createApiClient({
        config: { ...defaultConfig, maxRetries: 3 },
        logger: mockLogger,
      });
      const result = await client.get('/items');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(false);
    });

    it('should retry on 429 status', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          statusText: 'Too Many Requests',
          headers: new Headers({ 'Retry-After': '1' }),
          json: async () => ({ message: 'Rate limit exceeded' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ id: 1 }),
        });

      const client = createApiClient({
        config: { ...defaultConfig, maxRetries: 1 },
        logger: mockLogger,
      });
      const result = await client.get('/items');

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result.success).toBe(true);
    });

    it('should use Retry-After header value as delay for 429 responses', async () => {
      const sleepCalls: number[] = [];
      const originalSetTimeout = globalThis.setTimeout;
      vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn: (...args: unknown[]) => void, ms?: number) => {
        if (ms && ms > 100) {
          sleepCalls.push(ms);
        }
        // Execute immediately for test speed
        fn();
        return 0 as unknown as ReturnType<typeof setTimeout>;
      });

      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          statusText: 'Too Many Requests',
          headers: new Headers({ 'Retry-After': '5' }),
          json: async () => ({ message: 'Rate limit exceeded' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ id: 1 }),
        });

      const client = createApiClient({
        config: { ...defaultConfig, maxRetries: 1 },
        logger: mockLogger,
      });
      await client.get('/items');

      // The retry delay should be 5000ms (5 seconds * 1000)
      expect(sleepCalls).toContain(5000);

      vi.mocked(globalThis.setTimeout).mockRestore();
    });

    it('should fail on 5xx errors when maxRetries is 0', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        headers: new Headers(),
        json: async () => ({ message: 'Service down' }),
      });

      const client = createApiClient({
        config: { ...defaultConfig, maxRetries: 0 },
        logger: mockLogger,
      });
      const result = await client.get('/items');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('SERVER_ERROR');
      }
    });

    it('should fail on network errors when maxRetries is 0', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const client = createApiClient({
        config: { ...defaultConfig, maxRetries: 0 },
        logger: mockLogger,
      });
      const result = await client.get('/items');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('NETWORK_ERROR');
      }
    });
  });

  describe('timeout handling', () => {
    it('should use AbortController for timeout', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: 'test' }),
      });

      const client = createApiClient({
        config: { ...defaultConfig, timeout: 5000, maxRetries: 0 },
        logger: mockLogger,
      });
      await client.get('/items');

      // Verify fetch was called with AbortSignal
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          signal: expect.any(AbortSignal),
        }),
      );
    });

    it('should handle abort error as timeout', async () => {
      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';
      mockFetch.mockRejectedValueOnce(abortError);

      const client = createApiClient({
        config: { ...defaultConfig, maxRetries: 0 },
        logger: mockLogger,
      });
      const result = await client.get('/items');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('TIMEOUT');
      }
    });
  });

  describe('HTTP methods', () => {
    beforeEach(() => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({}),
      });
    });

    it('should make GET request', async () => {
      const client = createApiClient({ config: defaultConfig, logger: mockLogger });
      await client.get('/items');

      expect(mockFetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ method: 'GET' }));
    });

    it('should make POST request with body', async () => {
      const client = createApiClient({ config: defaultConfig, logger: mockLogger });
      await client.post('/items', { name: 'Test' });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ name: 'Test' }),
        }),
      );
    });

    it('should make PUT request with body', async () => {
      const client = createApiClient({ config: defaultConfig, logger: mockLogger });
      await client.put('/items/1', { name: 'Updated' });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ name: 'Updated' }),
        }),
      );
    });

    it('should make PATCH request with body', async () => {
      const client = createApiClient({ config: defaultConfig, logger: mockLogger });
      await client.patch('/items/1', { name: 'Patched' });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ name: 'Patched' }),
        }),
      );
    });

    it('should make DELETE request', async () => {
      const client = createApiClient({ config: defaultConfig, logger: mockLogger });
      await client.delete('/items/1');

      expect(mockFetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ method: 'DELETE' }));
    });
  });

  describe('URL handling', () => {
    it('should strip trailing slash from base URL', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({}),
      });

      const client = createApiClient({
        config: { ...defaultConfig, apiUrl: 'https://api.example.com/' },
        logger: mockLogger,
      });
      await client.get('/items');

      expect(mockFetch).toHaveBeenCalledWith('https://api.example.com/items', expect.any(Object));
    });
  });

  describe('health check', () => {
    it('should return healthy status and latency', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: 'ok' }),
      });

      const client = createApiClient({ config: defaultConfig, logger: mockLogger });
      const result = await client.healthCheck();

      expect(result.healthy).toBe(true);
      expect(typeof result.latencyMs).toBe('number');
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('should return unhealthy on error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        headers: new Headers(),
        json: async () => ({}),
      });

      const client = createApiClient({
        config: { ...defaultConfig, maxRetries: 0 },
        logger: mockLogger,
      });
      const result = await client.healthCheck();

      expect(result.healthy).toBe(false);
    });
  });
});

/**
 * Tests for the typed API client.
 *
 * Verifies request methods, error handling, and header management
 * using mocked fetch.
 */
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiClient, ApiRequestError } from '../../src/ui/lib/api-client.ts';

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

describe('apiClient', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('get', () => {
    it('should make a GET request with correct headers', async () => {
      const data = { items: [{ id: '1' }] };
      const fetchMock = mockFetch({
        ok: true,
        status: 200,
        json: async () => data,
      });

      const result = await apiClient.get('/work-items');

      expect(fetchMock).toHaveBeenCalledWith('/work-items', {
        method: 'GET',
        credentials: 'include',
        headers: { accept: 'application/json' },
        signal: undefined,
      });
      expect(result).toEqual(data);
    });

    it('should pass abort signal when provided', async () => {
      const fetchMock = mockFetch({
        ok: true,
        status: 200,
        json: async () => ({}),
      });
      const controller = new AbortController();

      await apiClient.get('/test', { signal: controller.signal });

      expect(fetchMock).toHaveBeenCalledWith(
        '/test',
        expect.objectContaining({
          signal: controller.signal,
        }),
      );
    });

    it('should merge custom headers', async () => {
      const fetchMock = mockFetch({
        ok: true,
        status: 200,
        json: async () => ({}),
      });

      await apiClient.get('/test', { headers: { 'x-custom': 'value' } });

      expect(fetchMock).toHaveBeenCalledWith(
        '/test',
        expect.objectContaining({
          headers: { accept: 'application/json', 'x-custom': 'value' },
        }),
      );
    });

    it('should throw ApiRequestError on non-2xx response', async () => {
      mockFetch({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => ({ message: 'Work item not found' }),
      });

      await expect(apiClient.get('/work-items/missing')).rejects.toThrow(ApiRequestError);

      try {
        await apiClient.get('/work-items/missing');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiRequestError);
        const apiError = err as ApiRequestError;
        expect(apiError.status).toBe(404);
        expect(apiError.message).toBe('Work item not found');
      }
    });

    it('should handle non-JSON error responses gracefully', async () => {
      mockFetch({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => {
          throw new Error('not json');
        },
      });

      await expect(apiClient.get('/broken')).rejects.toThrow(ApiRequestError);

      try {
        await apiClient.get('/broken');
      } catch (err) {
        const apiError = err as ApiRequestError;
        expect(apiError.status).toBe(500);
        expect(apiError.message).toContain('500');
      }
    });
  });

  describe('post', () => {
    it('should make a POST request with JSON body', async () => {
      const payload = { title: 'New item' };
      const responseData = { id: 'abc', title: 'New item' };
      const fetchMock = mockFetch({
        ok: true,
        status: 201,
        json: async () => responseData,
      });

      const result = await apiClient.post('/work-items', payload);

      expect(fetchMock).toHaveBeenCalledWith('/work-items', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(payload),
        signal: undefined,
      });
      expect(result).toEqual(responseData);
    });

    it('should throw ApiRequestError on failure', async () => {
      mockFetch({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => ({ error: 'Title is required' }),
      });

      try {
        await apiClient.post('/work-items', {});
      } catch (err) {
        expect(err).toBeInstanceOf(ApiRequestError);
        const apiError = err as ApiRequestError;
        expect(apiError.status).toBe(400);
        expect(apiError.message).toBe('Title is required');
      }
    });
  });

  describe('put', () => {
    it('should make a PUT request with JSON body', async () => {
      const payload = { title: 'Updated', status: 'in_progress' };
      const fetchMock = mockFetch({
        ok: true,
        status: 200,
        json: async () => ({ id: '1', ...payload }),
      });

      await apiClient.put('/work-items/1', payload);

      expect(fetchMock).toHaveBeenCalledWith('/work-items/1', {
        method: 'PUT',
        credentials: 'include',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(payload),
        signal: undefined,
      });
    });
  });

  describe('patch', () => {
    it('should make a PATCH request with JSON body', async () => {
      const payload = { title: 'Patched' };
      const fetchMock = mockFetch({
        ok: true,
        status: 200,
        json: async () => ({ id: '1', title: 'Patched' }),
      });

      await apiClient.patch('/memories/1', payload);

      expect(fetchMock).toHaveBeenCalledWith('/memories/1', {
        method: 'PATCH',
        credentials: 'include',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(payload),
        signal: undefined,
      });
    });
  });

  describe('delete', () => {
    it('should make a DELETE request', async () => {
      const fetchMock = mockFetch({
        ok: true,
        status: 204,
        json: async () => {
          throw new Error('no body');
        },
      });

      const result = await apiClient.delete('/work-items/1');

      expect(fetchMock).toHaveBeenCalledWith('/work-items/1', {
        method: 'DELETE',
        credentials: 'include',
        headers: { accept: 'application/json' },
        signal: undefined,
      });
      expect(result).toBeUndefined();
    });

    it('should return parsed JSON for non-204 responses', async () => {
      const responseData = { deleted: true, id: '1' };
      mockFetch({
        ok: true,
        status: 200,
        json: async () => responseData,
      });

      const result = await apiClient.delete('/work-items/1');
      expect(result).toEqual(responseData);
    });

    it('should throw ApiRequestError on failure', async () => {
      mockFetch({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        json: async () => ({ message: 'Access denied' }),
      });

      await expect(apiClient.delete('/work-items/1')).rejects.toThrow(ApiRequestError);
    });
  });
});

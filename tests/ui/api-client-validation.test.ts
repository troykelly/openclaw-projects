/**
 * Tests for apiClient runtime validation via optional Zod schema parameter.
 *
 * Covers:
 * - parseBody with no schema (existing behavior, backwards-compatible)
 * - parseBody with a Zod schema that validates correctly
 * - parseBody with a Zod schema that rejects bad data (throws ZodError)
 * - apiClient.get/post/put/patch/delete with and without schema
 * - Schema passthrough allows extra fields
 *
 * @see Issue #1743
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

vi.mock('@/ui/lib/api-config', () => ({
  getApiBaseUrl: vi.fn(() => 'http://localhost:3000'),
}));

vi.mock('@/ui/lib/auth-manager', () => ({
  getAccessToken: vi.fn(() => 'test-token'),
  clearAccessToken: vi.fn(),
  refreshAccessToken: vi.fn(),
}));

function mockResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : status === 204 ? 'No Content' : 'Error',
    json: () => Promise.resolve(body),
    headers: new Headers(),
    redirected: false,
    type: 'basic' as ResponseType,
    url: '',
    clone: () => mockResponse(body, status) as Response,
    body: null,
    bodyUsed: false,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    blob: () => Promise.resolve(new Blob()),
    formData: () => Promise.resolve(new FormData()),
    text: () => Promise.resolve(JSON.stringify(body)),
    bytes: () => Promise.resolve(new Uint8Array()),
  } as Response;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('apiClient without schema (backwards-compatible)', () => {
  it('get returns raw JSON when no schema is provided', async () => {
    const payload = { items: [{ id: '1', title: 'Test' }] };
    mockFetch.mockResolvedValueOnce(mockResponse(payload));

    const { apiClient } = await import('@/ui/lib/api-client');
    const result = await apiClient.get<{ items: Array<{ id: string; title: string }> }>('/api/work-items');

    expect(result).toEqual(payload);
  });

  it('post returns raw JSON when no schema is provided', async () => {
    const payload = { id: '1', title: 'Created' };
    mockFetch.mockResolvedValueOnce(mockResponse(payload));

    const { apiClient } = await import('@/ui/lib/api-client');
    const result = await apiClient.post<{ id: string; title: string }>('/api/work-items', { title: 'New' });

    expect(result).toEqual(payload);
  });

  it('put returns raw JSON when no schema is provided', async () => {
    const payload = { id: '1', title: 'Updated' };
    mockFetch.mockResolvedValueOnce(mockResponse(payload));

    const { apiClient } = await import('@/ui/lib/api-client');
    const result = await apiClient.put<{ id: string; title: string }>('/api/work-items/1', { title: 'Updated' });

    expect(result).toEqual(payload);
  });

  it('patch returns raw JSON when no schema is provided', async () => {
    const payload = { id: '1', title: 'Patched' };
    mockFetch.mockResolvedValueOnce(mockResponse(payload));

    const { apiClient } = await import('@/ui/lib/api-client');
    const result = await apiClient.patch<{ id: string; title: string }>('/api/work-items/1', { title: 'Patched' });

    expect(result).toEqual(payload);
  });

  it('delete returns undefined for 204 No Content', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(undefined, 204));

    const { apiClient } = await import('@/ui/lib/api-client');
    const result = await apiClient.delete('/api/work-items/1');

    expect(result).toBeUndefined();
  });
});

describe('apiClient with Zod schema validation', () => {
  const workItemsResponseSchema = z.object({
    items: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
      }).passthrough(),
    ),
  }).passthrough();

  it('get validates and returns data when schema matches', async () => {
    const payload = { items: [{ id: '1', title: 'Task', status: 'open' }] };
    mockFetch.mockResolvedValueOnce(mockResponse(payload));

    const { apiClient } = await import('@/ui/lib/api-client');
    const result = await apiClient.get('/api/work-items', { schema: workItemsResponseSchema });

    expect(result).toEqual(payload);
    // Extra fields preserved with passthrough
    expect(result.items[0]).toHaveProperty('status', 'open');
  });

  it('get throws ZodError when schema rejects bad data', async () => {
    // items should be an array, but we return a string instead
    const badPayload = { items: 'not-an-array' };
    mockFetch.mockResolvedValueOnce(mockResponse(badPayload));

    const { apiClient } = await import('@/ui/lib/api-client');

    await expect(
      apiClient.get('/api/work-items', { schema: workItemsResponseSchema }),
    ).rejects.toThrow(z.ZodError);
  });

  it('get throws ZodError when response is completely wrong shape', async () => {
    const badPayload = 'just a string';
    mockFetch.mockResolvedValueOnce(mockResponse(badPayload));

    const { apiClient } = await import('@/ui/lib/api-client');

    await expect(
      apiClient.get('/api/work-items', { schema: workItemsResponseSchema }),
    ).rejects.toThrow(z.ZodError);
  });

  it('get throws ZodError when array items miss required fields', async () => {
    // items array contains objects missing required 'title' field
    const badPayload = { items: [{ id: '1' }] };
    mockFetch.mockResolvedValueOnce(mockResponse(badPayload));

    const { apiClient } = await import('@/ui/lib/api-client');

    await expect(
      apiClient.get('/api/work-items', { schema: workItemsResponseSchema }),
    ).rejects.toThrow(z.ZodError);
  });

  it('post validates response with schema', async () => {
    const responseSchema = z.object({ id: z.string(), title: z.string() }).passthrough();
    const payload = { id: '1', title: 'Created' };
    mockFetch.mockResolvedValueOnce(mockResponse(payload));

    const { apiClient } = await import('@/ui/lib/api-client');
    const result = await apiClient.post('/api/work-items', { title: 'New' }, { schema: responseSchema });

    expect(result).toEqual(payload);
  });

  it('post throws ZodError when schema rejects response', async () => {
    const responseSchema = z.object({ id: z.string(), title: z.string() });
    const badPayload = { id: 123, title: null };
    mockFetch.mockResolvedValueOnce(mockResponse(badPayload));

    const { apiClient } = await import('@/ui/lib/api-client');

    await expect(
      apiClient.post('/api/work-items', { title: 'New' }, { schema: responseSchema }),
    ).rejects.toThrow(z.ZodError);
  });

  it('put validates response with schema', async () => {
    const responseSchema = z.object({ id: z.string() }).passthrough();
    const payload = { id: '1', title: 'Updated' };
    mockFetch.mockResolvedValueOnce(mockResponse(payload));

    const { apiClient } = await import('@/ui/lib/api-client');
    const result = await apiClient.put('/api/work-items/1', { title: 'Updated' }, { schema: responseSchema });

    expect(result).toEqual(payload);
  });

  it('patch validates response with schema', async () => {
    const responseSchema = z.object({ id: z.string() }).passthrough();
    const payload = { id: '1', title: 'Patched' };
    mockFetch.mockResolvedValueOnce(mockResponse(payload));

    const { apiClient } = await import('@/ui/lib/api-client');
    const result = await apiClient.patch('/api/work-items/1', { title: 'Patched' }, { schema: responseSchema });

    expect(result).toEqual(payload);
  });

  it('delete validates response with schema when not 204', async () => {
    const responseSchema = z.object({ success: z.boolean() });
    const payload = { success: true };
    mockFetch.mockResolvedValueOnce(mockResponse(payload));

    const { apiClient } = await import('@/ui/lib/api-client');
    const result = await apiClient.delete('/api/work-items/1', { schema: responseSchema });

    expect(result).toEqual(payload);
  });

  it('delete skips schema validation for 204 No Content', async () => {
    // Schema requires { success: boolean } but 204 returns undefined
    const responseSchema = z.object({ success: z.boolean() });
    mockFetch.mockResolvedValueOnce(mockResponse(undefined, 204));

    const { apiClient } = await import('@/ui/lib/api-client');
    const result = await apiClient.delete('/api/work-items/1', { schema: responseSchema });

    expect(result).toBeUndefined();
  });
});

describe('apiClient schema validation edge cases', () => {
  it('empty object fails validation for response expecting array field', async () => {
    const schema = z.object({ items: z.array(z.unknown()) });
    mockFetch.mockResolvedValueOnce(mockResponse({}));

    const { apiClient } = await import('@/ui/lib/api-client');

    await expect(
      apiClient.get('/api/work-items', { schema }),
    ).rejects.toThrow(z.ZodError);
  });

  it('null response fails validation for object schema', async () => {
    const schema = z.object({ items: z.array(z.unknown()) });
    mockFetch.mockResolvedValueOnce(mockResponse(null));

    const { apiClient } = await import('@/ui/lib/api-client');

    await expect(
      apiClient.get('/api/work-items', { schema }),
    ).rejects.toThrow(z.ZodError);
  });

  it('schema with passthrough preserves extra fields', async () => {
    const schema = z.object({
      id: z.string(),
    }).passthrough();
    const payload = { id: '1', extra_field: 'preserved', another: 42 };
    mockFetch.mockResolvedValueOnce(mockResponse(payload));

    const { apiClient } = await import('@/ui/lib/api-client');
    const result = await apiClient.get('/api/test', { schema });

    expect(result).toEqual(payload);
    expect(result).toHaveProperty('extra_field', 'preserved');
    expect(result).toHaveProperty('another', 42);
  });

  it('request options (signal, headers) still work alongside schema', async () => {
    const schema = z.object({ ok: z.boolean() }).passthrough();
    const payload = { ok: true };
    mockFetch.mockResolvedValueOnce(mockResponse(payload));

    const controller = new AbortController();
    const { apiClient } = await import('@/ui/lib/api-client');
    const result = await apiClient.get('/api/test', {
      schema,
      signal: controller.signal,
      headers: { 'x-custom': 'value' },
    });

    expect(result).toEqual(payload);
    // Verify fetch was called with the custom headers and signal
    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        signal: controller.signal,
        headers: expect.objectContaining({ 'x-custom': 'value' }),
      }),
    );
  });
});

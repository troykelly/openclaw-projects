/**
 * Tests for ApiClient error response parsing (Issue #2591).
 *
 * The server sends error responses as { error: 'message' },
 * but ApiClient reads errorBody.message — losing the actual error text.
 * This test confirms the bug and verifies the fix.
 */
import { describe, it, expect, vi, afterEach, afterAll, beforeAll } from 'vitest';
import { ApiClient, type ApiResponse } from '../src/api-client.js';
import type { PluginConfig } from '../src/config.js';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'http';

/**
 * Minimal HTTP server that returns responses in the same format as the real server:
 *   { error: 'descriptive error message' }
 */
function createMockServer(): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
        return;
      }

      // Simulate a 400 error with server's actual error format
      if (req.url?.includes('/memories/bulk-supersede')) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: "Not all source memories found in namespace 'test-ns'. Missing or cross-namespace: abc-123",
        }));
        return;
      }

      // Simulate a 404 error
      if (req.url?.includes('/memories/digest')) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Target memory not found' }));
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ server, port });
    });
  });
}

describe('ApiClient error parsing (#2591)', () => {
  let server: Server;
  let port: number;
  let client: ApiClient;

  beforeAll(async () => {
    const result = await createMockServer();
    server = result.server;
    port = result.port;

    const config: PluginConfig = {
      apiUrl: `http://127.0.0.1:${port}`,
      apiKey: 'test-key',
      autoRecall: false,
      autoCapture: false,
      maxRecallMemories: 5,
      minRecallScore: 0.7,
      timeout: 5000,
      maxRetries: 0, // No retries for tests
      debug: false,
    };

    client = new ApiClient({
      config,
      logger: {
        namespace: 'test',
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('preserves server error message from { error } field (not just statusText)', async () => {
    const response: ApiResponse<unknown> = await client.post(
      '/memories/bulk-supersede',
      { target_id: 'x', source_ids: ['y'] },
    );

    expect(response.success).toBe(false);
    if (!response.success) {
      // The actual server error message should come through, not generic "Bad Request"
      expect(response.error.message).toContain('Not all source memories found');
    }
  });

  it('preserves 404 error message from { error } field', async () => {
    const response: ApiResponse<unknown> = await client.post(
      '/memories/digest',
      { since: '2020-01-01', before: '2020-01-02' },
    );

    expect(response.success).toBe(false);
    if (!response.success) {
      expect(response.error.message).toContain('Target memory not found');
    }
  });
});

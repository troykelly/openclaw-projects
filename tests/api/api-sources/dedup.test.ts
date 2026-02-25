/**
 * Unit tests for inline spec support and deduplication.
 * Part of API Onboarding feature (#1789).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Pool, PoolClient } from 'pg';

// Mock dependencies — must be before imports
vi.mock('../../../src/api/webhooks/ssrf.ts', () => ({
  validateSsrf: vi.fn(() => null),
}));

vi.mock('../../../src/api/api-sources/parser.ts', () => ({
  parseOpenApiSpec: vi.fn(),
}));

vi.mock('../../../src/api/api-sources/embedding-text.ts', () => ({
  generateOperationText: vi.fn(() => ({
    title: 'test-title',
    content: 'test-content',
    descriptionQuality: 'original' as const,
  })),
  generateTagGroupText: vi.fn(() => ({
    title: 'test-tg-title',
    content: 'test-tg-content',
  })),
  generateOverviewText: vi.fn(() => ({
    title: 'test-overview-title',
    content: 'test-overview-content',
  })),
}));

import { onboardApiSource, hashSpec } from '../../../src/api/api-sources/onboard.ts';
import { parseOpenApiSpec } from '../../../src/api/api-sources/parser.ts';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const MINIMAL_PARSED = {
  overview: {
    name: 'Test API',
    description: 'A test',
    version: '1.0.0',
    servers: [{ url: 'https://api.test.com' }],
    authSummary: 'none',
    tagGroups: [],
    totalOperations: 1,
  },
  tagGroups: [],
  operations: [
    {
      operationKey: 'getTest',
      method: 'GET',
      path: '/test',
      summary: 'Test endpoint',
      description: 'A test endpoint',
      tags: [],
      parameters: [],
      requestBody: null,
      responses: {},
    },
  ],
};

function createMockPoolAndClient() {
  const mockClient: Partial<PoolClient> = {
    query: vi.fn()
      // BEGIN
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      // INSERT api_source
      .mockResolvedValueOnce({
        rows: [{
          id: 'new-source-id',
          namespace: 'default',
          name: 'Test API',
          description: 'A test',
          spec_url: null,
          servers: [{ url: 'https://api.test.com' }],
          spec_version: null,
          spec_hash: null,
          tags: [],
          refresh_interval_seconds: null,
          last_fetched_at: null,
          status: 'active',
          error_message: null,
          created_by_agent: null,
          deleted_at: null,
          created_at: new Date(),
          updated_at: new Date(),
        }],
        rowCount: 1,
      })
      // UPDATE api_source (spec metadata)
      .mockResolvedValueOnce({
        rows: [{
          id: 'new-source-id',
          namespace: 'default',
          name: 'Test API',
          description: 'A test',
          spec_url: null,
          servers: [{ url: 'https://api.test.com' }],
          spec_version: '1.0.0',
          spec_hash: 'abc123',
          tags: [],
          refresh_interval_seconds: null,
          last_fetched_at: new Date(),
          status: 'active',
          error_message: null,
          created_by_agent: null,
          deleted_at: null,
          created_at: new Date(),
          updated_at: new Date(),
        }],
        rowCount: 1,
      })
      // INSERT operation memory
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      // INSERT overview memory
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      // COMMIT
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }),
    release: vi.fn(),
  };

  const pool = {
    query: vi.fn()
      // getApiSource (re-fetch after commit)
      .mockResolvedValueOnce({
        rows: [{
          id: 'new-source-id',
          namespace: 'default',
          name: 'Test API',
          description: 'A test',
          spec_url: null,
          servers: [{ url: 'https://api.test.com' }],
          spec_version: '1.0.0',
          spec_hash: 'abc123',
          tags: [],
          refresh_interval_seconds: null,
          last_fetched_at: new Date(),
          status: 'active',
          error_message: null,
          created_by_agent: null,
          deleted_at: null,
          created_at: new Date(),
          updated_at: new Date(),
        }],
        rowCount: 1,
      }),
    connect: vi.fn().mockResolvedValue(mockClient),
  } as unknown as Pool;

  return { pool, mockClient };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Inline spec support', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('accepts spec_content and parses inline JSON', async () => {
    vi.mocked(parseOpenApiSpec).mockResolvedValue(MINIMAL_PARSED);
    const { pool } = createMockPoolAndClient();

    const specContent = JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'Test API', version: '1.0.0' },
      paths: { '/test': { get: { summary: 'Test' } } },
    });

    const result = await onboardApiSource(pool, {
      namespace: 'default',
      spec_content: specContent,
    });

    expect(result.api_source).toBeDefined();
    expect(result.memories_created).toBeGreaterThanOrEqual(1);
    expect(vi.mocked(parseOpenApiSpec)).toHaveBeenCalledWith(specContent);
  });

  it('throws when neither spec_url nor spec_content is provided', async () => {
    const pool = { query: vi.fn() } as unknown as Pool;

    await expect(
      onboardApiSource(pool, { namespace: 'default' }),
    ).rejects.toThrow('Either spec_url or spec_content is required');
  });
});

describe('Deduplication', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns existing source when spec_url matches in same namespace', async () => {
    const existingSource = {
      id: 'existing-id',
      namespace: 'default',
      name: 'Existing API',
      description: 'Already onboarded',
      spec_url: 'https://api.test.com/spec.json',
      servers: [],
      spec_version: '1.0.0',
      spec_hash: 'existing-hash',
      tags: [],
      refresh_interval_seconds: null,
      last_fetched_at: new Date(),
      status: 'active',
      error_message: null,
      created_by_agent: null,
      deleted_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    // Use inline spec_content to avoid the fetch call, but also pass spec_url for dedup test
    // Actually, the onboard flow with spec_url fetches FIRST, then checks dedup.
    // To test dedup without actual network calls, we need to provide spec_content and spec_url.
    // But the current code only checks dedup for spec_url. Let's test it by providing spec_content
    // and verifying that spec_url dedup still works when spec_content is provided alongside spec_url.
    //
    // Actually the simest approach: the onboard function fetches the spec first (via fetchSpec),
    // then checks dedup. Since fetchSpec uses `global.fetch`, we mock that.

    // Mock global fetch to return a simple spec
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: () => Promise.resolve('{"openapi":"3.0.0"}'),
    }) as typeof fetch;

    try {
      const pool = {
        query: vi.fn()
          // findExistingBySpecUrl returns existing source
          .mockResolvedValueOnce({ rows: [existingSource], rowCount: 1 }),
        connect: vi.fn(),
      } as unknown as Pool;

      const result = await onboardApiSource(pool, {
        namespace: 'default',
        spec_url: 'https://api.test.com/spec.json',
      });

      expect(result.api_source.id).toBe('existing-id');
      expect(result.memories_created).toBe(0);
      expect(vi.mocked(parseOpenApiSpec)).not.toHaveBeenCalled();
    } finally {
      global.fetch = originalFetch;
    }
  });
});

describe('hashSpec', () => {
  it('produces a consistent SHA-256 hash', () => {
    const content = '{"openapi":"3.0.0"}';
    const hash1 = hashSpec(content);
    const hash2 = hashSpec(content);
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);
  });

  it('produces different hashes for different content', () => {
    const hash1 = hashSpec('{"openapi":"3.0.0"}');
    const hash2 = hashSpec('{"openapi":"3.1.0"}');
    expect(hash1).not.toBe(hash2);
  });
});

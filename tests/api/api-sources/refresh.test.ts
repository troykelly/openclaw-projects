/**
 * Unit tests for spec refresh and diff logic.
 * Part of API Onboarding feature (#1787).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Pool, PoolClient, QueryResult } from 'pg';

// Mock the modules we depend on
vi.mock('../../../src/api/webhooks/ssrf.ts', () => ({
  validateSsrf: vi.fn(() => null),
}));

vi.mock('../../../src/api/api-sources/parser.ts', () => ({
  parseOpenApiSpec: vi.fn(),
}));

vi.mock('../../../src/api/api-sources/embedding-text.ts', () => ({
  generateOperationText: vi.fn(() => ({
    title: 'test-op-title',
    content: 'test-op-content',
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

vi.mock('../../../src/api/api-sources/onboard.ts', () => ({
  fetchSpec: vi.fn(),
  hashSpec: vi.fn(),
}));

import { refreshApiSource } from '../../../src/api/api-sources/refresh.ts';
import { fetchSpec, hashSpec } from '../../../src/api/api-sources/onboard.ts';
import { parseOpenApiSpec } from '../../../src/api/api-sources/parser.ts';
import { generateOperationText, generateTagGroupText, generateOverviewText } from '../../../src/api/api-sources/embedding-text.ts';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createMockPool(overrides: Partial<Pool> = {}): Pool {
  const mockClient: Partial<PoolClient> = {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    release: vi.fn(),
  };

  return {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    connect: vi.fn().mockResolvedValue(mockClient),
    ...overrides,
  } as unknown as Pool;
}

function makeParsedApi(operations: Array<{ operationKey: string; method: string; path: string }>) {
  return {
    overview: {
      name: 'Test API',
      description: 'A test API',
      version: '2.0.0',
      servers: [{ url: 'https://api.test.com' }],
      authSummary: 'API key',
      tagGroups: [{ tag: 'pets', operationCount: operations.length }],
      totalOperations: operations.length,
    },
    tagGroups: [
      {
        tag: 'pets',
        description: 'Pet operations',
        operations: operations.map((op) => ({
          operationKey: op.operationKey,
          method: op.method,
          path: op.path,
          summary: `Summary for ${op.operationKey}`,
        })),
      },
    ],
    operations: operations.map((op) => ({
      operationKey: op.operationKey,
      method: op.method,
      path: op.path,
      summary: `Summary for ${op.operationKey}`,
      description: `Description for ${op.operationKey}`,
      tags: ['pets'],
      parameters: [],
      requestBody: null,
      responses: {},
    })),
  };
}

const EXISTING_SOURCE = {
  id: '11111111-1111-1111-1111-111111111111',
  namespace: 'default',
  name: 'Test API',
  description: 'A test API',
  spec_url: 'https://api.test.com/spec.json',
  spec_content: null as string | null,
  servers: [{ url: 'https://api.test.com' }],
  spec_version: '1.0.0',
  spec_hash: 'old-hash-abc123',
  tags: [],
  refresh_interval_seconds: null,
  last_fetched_at: new Date('2025-01-01'),
  status: 'active' as const,
  error_message: null,
  created_by_agent: null,
  deleted_at: null,
  created_at: new Date('2025-01-01'),
  updated_at: new Date('2025-01-01'),
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('refreshApiSource', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns early when spec hash has not changed', async () => {
    const specText = '{"openapi":"3.0.0"}';
    vi.mocked(fetchSpec).mockResolvedValue(specText);
    vi.mocked(hashSpec).mockReturnValue('old-hash-abc123'); // Same as existing

    const updatedSource = { ...EXISTING_SOURCE, last_fetched_at: new Date() };
    const pool = createMockPool({
      query: vi.fn()
        // First query: getApiSource
        .mockResolvedValueOnce({ rows: [EXISTING_SOURCE], rowCount: 1 })
        // updateApiSource (last_fetched_at)
        .mockResolvedValueOnce({ rows: [updatedSource], rowCount: 1 })
        // getApiSource after update (re-fetch)
        .mockResolvedValueOnce({ rows: [updatedSource], rowCount: 1 }),
    });

    const result = await refreshApiSource(pool, EXISTING_SOURCE.id, 'default');

    expect(result.spec_changed).toBe(false);
    expect(result.memories_created).toBe(0);
    expect(result.memories_updated).toBe(0);
    expect(result.memories_deleted).toBe(0);
    expect(vi.mocked(parseOpenApiSpec)).not.toHaveBeenCalled();
  });

  it('detects added operations and creates new memories', async () => {
    const specText = '{"openapi":"3.0.0"}';
    vi.mocked(fetchSpec).mockResolvedValue(specText);
    vi.mocked(hashSpec).mockReturnValue('new-hash-xyz789');

    const newParsed = makeParsedApi([
      { operationKey: 'getPet', method: 'GET', path: '/pets/{id}' },
      { operationKey: 'createPet', method: 'POST', path: '/pets' }, // new
    ]);
    vi.mocked(parseOpenApiSpec).mockResolvedValue(newParsed);

    const mockClient: Partial<PoolClient> = {
      query: vi.fn()
        // BEGIN
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // Get existing memories (only getPet exists)
        .mockResolvedValueOnce({
          rows: [
            { id: 'mem-1', operation_key: 'getPet', memory_kind: 'operation', content: 'old content', metadata: '{}' },
            { id: 'mem-tg', operation_key: 'tag:pets', memory_kind: 'tag_group', content: 'old tg', metadata: '{}' },
            { id: 'mem-ov', operation_key: 'overview', memory_kind: 'overview', content: 'old ov', metadata: '{}' },
          ],
          rowCount: 3,
        })
        // UPDATE existing operation (getPet) - content changed
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        // INSERT new operation (createPet)
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        // DELETE old tag groups
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        // INSERT new tag group
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        // DELETE old overview
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        // INSERT new overview
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        // Update api_source metadata
        .mockResolvedValueOnce({ rows: [{ ...EXISTING_SOURCE, spec_hash: 'new-hash-xyz789' }], rowCount: 1 })
        // COMMIT
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }),
      release: vi.fn(),
    };

    const pool = createMockPool({
      query: vi.fn()
        // First query: get existing source
        .mockResolvedValueOnce({ rows: [EXISTING_SOURCE], rowCount: 1 })
        // After commit: re-fetch source
        .mockResolvedValueOnce({ rows: [{ ...EXISTING_SOURCE, spec_hash: 'new-hash-xyz789' }], rowCount: 1 }),
      connect: vi.fn().mockResolvedValue(mockClient),
    });

    const result = await refreshApiSource(pool, EXISTING_SOURCE.id, 'default');

    expect(result.spec_changed).toBe(true);
    expect(result.memories_created).toBeGreaterThanOrEqual(1); // at least createPet
  });

  it('detects removed operations and deletes old memories', async () => {
    const specText = '{"openapi":"3.0.0"}';
    vi.mocked(fetchSpec).mockResolvedValue(specText);
    vi.mocked(hashSpec).mockReturnValue('new-hash-removed');

    // New spec only has getPet (deletePet was removed)
    const newParsed = makeParsedApi([
      { operationKey: 'getPet', method: 'GET', path: '/pets/{id}' },
    ]);
    vi.mocked(parseOpenApiSpec).mockResolvedValue(newParsed);

    const mockClient: Partial<PoolClient> = {
      query: vi.fn()
        // BEGIN
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // Get existing memories (getPet + deletePet)
        .mockResolvedValueOnce({
          rows: [
            { id: 'mem-1', operation_key: 'getPet', memory_kind: 'operation', content: 'old content', metadata: '{}' },
            { id: 'mem-2', operation_key: 'deletePet', memory_kind: 'operation', content: 'delete pet', metadata: '{}' },
            { id: 'mem-tg', operation_key: 'tag:pets', memory_kind: 'tag_group', content: 'old tg', metadata: '{}' },
            { id: 'mem-ov', operation_key: 'overview', memory_kind: 'overview', content: 'old ov', metadata: '{}' },
          ],
          rowCount: 4,
        })
        // UPDATE getPet
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        // DELETE deletePet
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        // DELETE old tag groups
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        // INSERT new tag group
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        // DELETE old overview
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        // INSERT new overview
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        // Update api_source
        .mockResolvedValueOnce({ rows: [EXISTING_SOURCE], rowCount: 1 })
        // COMMIT
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }),
      release: vi.fn(),
    };

    const pool = createMockPool({
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [EXISTING_SOURCE], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [EXISTING_SOURCE], rowCount: 1 }),
      connect: vi.fn().mockResolvedValue(mockClient),
    });

    const result = await refreshApiSource(pool, EXISTING_SOURCE.id, 'default');

    expect(result.spec_changed).toBe(true);
    expect(result.memories_deleted).toBeGreaterThanOrEqual(1);
  });

  it('throws when API source is not found', async () => {
    const pool = createMockPool({
      query: vi.fn().mockResolvedValueOnce({ rows: [], rowCount: 0 }),
    });

    await expect(refreshApiSource(pool, '00000000-0000-0000-0000-000000000000', 'default'))
      .rejects.toThrow('API source not found');
  });

  it('throws when API source has no spec_url or spec_content', async () => {
    const noUrlSource = { ...EXISTING_SOURCE, spec_url: null, spec_content: null };
    const pool = createMockPool({
      query: vi.fn().mockResolvedValueOnce({ rows: [noUrlSource], rowCount: 1 }),
    });

    await expect(refreshApiSource(pool, EXISTING_SOURCE.id, 'default'))
      .rejects.toThrow('no spec_url or spec_content');
  });

  it('refreshes from stored spec_content when no spec_url (#2277)', async () => {
    const storedSpec = '{"openapi":"3.0.3","info":{"title":"Inline API","version":"1.0.0"},"paths":{"/health":{"get":{"operationId":"healthCheck","responses":{"200":{"description":"OK"}}}}}}';
    const inlineSource = { ...EXISTING_SOURCE, spec_url: null, spec_content: storedSpec };

    vi.mocked(hashSpec).mockReturnValue('new-hash-inline');

    const newParsed = makeParsedApi([
      { operationKey: 'healthCheck', method: 'GET', path: '/health' },
    ]);
    vi.mocked(parseOpenApiSpec).mockResolvedValue(newParsed);

    const mockClient: Partial<PoolClient> = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // BEGIN
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // existing memories
        .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // INSERT operation
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // DELETE tag_groups
        .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // INSERT tag_group
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // DELETE overview
        .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // INSERT overview
        .mockResolvedValueOnce({ rows: [inlineSource], rowCount: 1 }) // UPDATE api_source
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }), // COMMIT
      release: vi.fn(),
    };

    const pool = createMockPool({
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [inlineSource], rowCount: 1 }) // getApiSource
        .mockResolvedValueOnce({ rows: [inlineSource], rowCount: 1 }), // re-fetch
      connect: vi.fn().mockResolvedValue(mockClient),
    });

    const result = await refreshApiSource(pool, EXISTING_SOURCE.id, 'default');

    // Should NOT call fetchSpec since there's no spec_url
    expect(vi.mocked(fetchSpec)).not.toHaveBeenCalled();
    // Should parse the stored spec_content
    expect(vi.mocked(parseOpenApiSpec)).toHaveBeenCalledWith(storedSpec);
    expect(result.spec_changed).toBe(true);
  });

  it('accepts spec_content in refresh input to update inline spec (#2277)', async () => {
    const newSpecContent = '{"openapi":"3.0.3","info":{"title":"Updated Inline","version":"2.0.0"},"paths":{"/health":{"get":{"operationId":"healthCheck","responses":{"200":{"description":"OK"}}}}}}';
    const inlineSource = { ...EXISTING_SOURCE, spec_url: null, spec_content: 'old spec' };

    vi.mocked(hashSpec).mockReturnValue('new-hash-updated-inline');

    const newParsed = makeParsedApi([
      { operationKey: 'healthCheck', method: 'GET', path: '/health' },
    ]);
    vi.mocked(parseOpenApiSpec).mockResolvedValue(newParsed);

    const mockClient: Partial<PoolClient> = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // BEGIN
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // existing memories
        .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // INSERT operation
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // DELETE tag_groups
        .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // INSERT tag_group
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // DELETE overview
        .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // INSERT overview
        .mockResolvedValueOnce({ rows: [inlineSource], rowCount: 1 }) // UPDATE api_source (with spec_content)
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }), // COMMIT
      release: vi.fn(),
    };

    const pool = createMockPool({
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [inlineSource], rowCount: 1 }) // getApiSource
        .mockResolvedValueOnce({ rows: [inlineSource], rowCount: 1 }), // re-fetch
      connect: vi.fn().mockResolvedValue(mockClient),
    });

    const result = await refreshApiSource(pool, EXISTING_SOURCE.id, 'default', {
      spec_content: newSpecContent,
    });

    // Should parse the new spec_content, not fetch from URL
    expect(vi.mocked(fetchSpec)).not.toHaveBeenCalled();
    expect(vi.mocked(parseOpenApiSpec)).toHaveBeenCalledWith(newSpecContent);
    expect(result.spec_changed).toBe(true);
  });

  it('updates api_source status to error on fetch failure', async () => {
    vi.mocked(fetchSpec).mockRejectedValue(new Error('Network timeout'));

    const updateQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    const pool = createMockPool({
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [EXISTING_SOURCE], rowCount: 1 })
        .mockImplementation(updateQuery),
    });

    await expect(refreshApiSource(pool, EXISTING_SOURCE.id, 'default'))
      .rejects.toThrow('Network timeout');

    // Verify error status was set
    const updateCall = updateQuery.mock.calls[0];
    expect(updateCall).toBeDefined();
    const sql = updateCall[0] as string;
    expect(sql).toContain('status');
  });
});

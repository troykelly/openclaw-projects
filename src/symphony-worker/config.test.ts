/**
 * Unit tests for symphony orchestrator config loading.
 * Issue #2195 — Symphony Worker Process Skeleton.
 */

import { describe, it, expect, vi } from 'vitest';
import { loadConfig, getDefaultConfig } from './config.ts';

function createMockPool() {
  return {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  };
}

describe('getDefaultConfig', () => {
  it('returns sensible defaults', () => {
    const config = getDefaultConfig();
    expect(config.maxConcurrentRuns).toBe(3);
    expect(config.maxRunDurationSeconds).toBe(3600);
    expect(config.pollIntervalMs).toBe(30_000);
    expect(config.heartbeatIntervalMs).toBe(30_000);
    expect(config.leaseDurationSeconds).toBe(600);
    expect(config.autoRetry).toBe(true);
    expect(config.maxRetryAttempts).toBe(3);
    expect(config.githubRateLimitReserve).toBe(100);
  });

  it('returns a new object each time', () => {
    const a = getDefaultConfig();
    const b = getDefaultConfig();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

describe('loadConfig', () => {
  it('returns defaults when no config rows exist', async () => {
    const pool = createMockPool();
    // Project query
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    // Namespace query
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const result = await loadConfig(pool as never, 'test-ns', 'project-1');
    expect(result.version).toBe(0);
    expect(result.config).toEqual(getDefaultConfig());
  });

  it('loads project-specific config when available', async () => {
    const pool = createMockPool();
    pool.query.mockResolvedValueOnce({
      rows: [{
        id: 'cfg-1',
        namespace: 'test-ns',
        project_id: 'project-1',
        version: 5,
        config: { maxConcurrentRuns: 10, pollIntervalMs: 60000 },
      }],
      rowCount: 1,
    });

    const result = await loadConfig(pool as never, 'test-ns', 'project-1');
    expect(result.version).toBe(5);
    expect(result.config.maxConcurrentRuns).toBe(10);
    expect(result.config.pollIntervalMs).toBe(60_000);
    // Defaults for unspecified keys
    expect(result.config.heartbeatIntervalMs).toBe(30_000);
    expect(result.config.autoRetry).toBe(true);
  });

  it('falls back to namespace config when project config missing', async () => {
    const pool = createMockPool();
    // No project config
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    // Namespace config exists
    pool.query.mockResolvedValueOnce({
      rows: [{
        id: 'cfg-2',
        namespace: 'test-ns',
        project_id: null,
        version: 2,
        config: { maxConcurrentRuns: 5 },
      }],
      rowCount: 1,
    });

    const result = await loadConfig(pool as never, 'test-ns', 'project-1');
    expect(result.version).toBe(2);
    expect(result.config.maxConcurrentRuns).toBe(5);
  });

  it('loads namespace config when no projectId given', async () => {
    const pool = createMockPool();
    pool.query.mockResolvedValueOnce({
      rows: [{
        id: 'cfg-3',
        namespace: 'test-ns',
        project_id: null,
        version: 1,
        config: { autoRetry: false },
      }],
      rowCount: 1,
    });

    const result = await loadConfig(pool as never, 'test-ns');
    expect(result.version).toBe(1);
    expect(result.config.autoRetry).toBe(false);
  });

  it('ignores unknown config keys', async () => {
    const pool = createMockPool();
    pool.query.mockResolvedValueOnce({
      rows: [{
        id: 'cfg-4',
        namespace: 'test-ns',
        project_id: null,
        version: 1,
        config: { unknownKey: 'should-be-ignored', maxConcurrentRuns: 7 },
      }],
      rowCount: 1,
    });

    const result = await loadConfig(pool as never, 'test-ns');
    expect(result.config.maxConcurrentRuns).toBe(7);
    expect((result.config as Record<string, unknown>).unknownKey).toBeUndefined();
  });

  it('uses defaults for wrongly-typed config values', async () => {
    const pool = createMockPool();
    pool.query.mockResolvedValueOnce({
      rows: [{
        id: 'cfg-5',
        namespace: 'test-ns',
        project_id: null,
        version: 1,
        config: { maxConcurrentRuns: 'not-a-number', autoRetry: 42 },
      }],
      rowCount: 1,
    });

    const result = await loadConfig(pool as never, 'test-ns');
    expect(result.config.maxConcurrentRuns).toBe(3); // default
    expect(result.config.autoRetry).toBe(true); // default
  });
});

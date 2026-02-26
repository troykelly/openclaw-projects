/**
 * Unit tests for terminal entry embedding worker.
 * Issue #1861 — Terminal entry embedding pipeline.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Pool, QueryResult } from 'pg';

// We'll import these once the module exists
import { processTerminalEmbeddings, TERMINAL_EMBEDDING_BATCH_SIZE } from './terminal-embeddings.ts';

function createMockPool(): Pool {
  return {
    query: vi.fn(),
  } as unknown as Pool;
}

describe('processTerminalEmbeddings', () => {
  let pool: Pool;

  beforeEach(() => {
    pool = createMockPool();
    vi.resetAllMocks();
    vi.resetModules();
  });

  it('returns 0 when no un-embedded entries exist', async () => {
    (pool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: [] } as QueryResult);
    const result = await processTerminalEmbeddings(pool);
    expect(result).toBe(0);
  });

  it('generates embeddings for command entries', async () => {
    const mockEntry = {
      id: '00000000-0000-0000-0000-000000000001',
      session_id: '00000000-0000-0000-0000-000000000010',
      kind: 'command',
      content: 'ls -la /tmp',
      embed_commands: true,
      embed_scrollback: false,
    };

    // First query: fetch un-embedded entries (JOIN with terminal_session for flags)
    (pool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      rows: [mockEntry],
    } as QueryResult);

    // Mock the embedding service
    const mockEmbed = vi.fn().mockResolvedValue({
      embedding: new Array(1024).fill(0.1),
      provider: 'openai',
      model: 'text-embedding-3-large',
    });

    vi.doMock('../api/embeddings/service.ts', () => ({
      createEmbeddingService: () => ({
        isConfigured: () => true,
        embed: mockEmbed,
      }),
    }));

    // Re-import after mock
    const { processTerminalEmbeddings: fn } = await import('./terminal-embeddings.ts');

    // Second query: UPDATE to set embedding + embedded_at
    (pool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: [], rowCount: 1 } as QueryResult);

    const result = await fn(pool);
    expect(result).toBe(1);
    expect(mockEmbed).toHaveBeenCalledWith('ls -la /tmp');

    // Verify the UPDATE query was called
    const updateCall = (pool.query as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(updateCall[0]).toContain('UPDATE terminal_session_entry');
    expect(updateCall[0]).toContain('embedded_at');
    expect(updateCall[1][0]).toEqual(JSON.stringify(new Array(1024).fill(0.1)));
    expect(updateCall[1][1]).toBe(mockEntry.id);
  });

  it('skips entries when embed_commands is false for command kind', async () => {
    const mockEntry = {
      id: '00000000-0000-0000-0000-000000000001',
      session_id: '00000000-0000-0000-0000-000000000010',
      kind: 'command',
      content: 'ls -la /tmp',
      embed_commands: false,
      embed_scrollback: false,
    };

    (pool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      rows: [mockEntry],
    } as QueryResult);

    // UPDATE to mark as skipped (embedded_at = now() with NULL embedding)
    (pool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: [], rowCount: 1 } as QueryResult);

    const result = await processTerminalEmbeddings(pool);
    expect(result).toBe(1);

    const updateCall = (pool.query as ReturnType<typeof vi.fn>).mock.calls[1];
    // Should mark as skipped, not embed
    expect(updateCall[0]).toContain('embedded_at');
  });

  it('skips scrollback entries when embed_scrollback is false', async () => {
    const mockEntry = {
      id: '00000000-0000-0000-0000-000000000002',
      session_id: '00000000-0000-0000-0000-000000000010',
      kind: 'scrollback',
      content: 'some scrollback content',
      embed_commands: true,
      embed_scrollback: false,
    };

    (pool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      rows: [mockEntry],
    } as QueryResult);

    (pool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: [], rowCount: 1 } as QueryResult);

    const result = await processTerminalEmbeddings(pool);
    expect(result).toBe(1);
  });

  it('embeds scrollback when embed_scrollback is true', async () => {
    const mockEntry = {
      id: '00000000-0000-0000-0000-000000000002',
      session_id: '00000000-0000-0000-0000-000000000010',
      kind: 'scrollback',
      content: 'some scrollback content',
      embed_commands: true,
      embed_scrollback: true,
    };

    (pool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      rows: [mockEntry],
    } as QueryResult);

    const mockEmbed = vi.fn().mockResolvedValue({
      embedding: new Array(1024).fill(0.2),
      provider: 'openai',
      model: 'text-embedding-3-large',
    });

    vi.doMock('../api/embeddings/service.ts', () => ({
      createEmbeddingService: () => ({
        isConfigured: () => true,
        embed: mockEmbed,
      }),
    }));

    const { processTerminalEmbeddings: fn } = await import('./terminal-embeddings.ts');

    (pool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: [], rowCount: 1 } as QueryResult);

    const result = await fn(pool);
    expect(result).toBe(1);
    expect(mockEmbed).toHaveBeenCalledWith('some scrollback content');
  });

  it('returns 0 when embedding service is not configured', async () => {
    const mockEntry = {
      id: '00000000-0000-0000-0000-000000000001',
      session_id: '00000000-0000-0000-0000-000000000010',
      kind: 'command',
      content: 'ls',
      embed_commands: true,
      embed_scrollback: false,
    };

    (pool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      rows: [mockEntry],
    } as QueryResult);

    vi.doMock('../api/embeddings/service.ts', () => ({
      createEmbeddingService: () => ({
        isConfigured: () => false,
        embed: vi.fn(),
      }),
    }));

    const { processTerminalEmbeddings: fn } = await import('./terminal-embeddings.ts');

    const result = await fn(pool);
    expect(result).toBe(0);
  });

  it('continues processing other entries when one fails and marks failed as skipped', async () => {
    const entries = [
      {
        id: '00000000-0000-0000-0000-000000000001',
        session_id: '00000000-0000-0000-0000-000000000010',
        kind: 'command',
        content: 'good command',
        embed_commands: true,
        embed_scrollback: false,
      },
      {
        id: '00000000-0000-0000-0000-000000000002',
        session_id: '00000000-0000-0000-0000-000000000010',
        kind: 'command',
        content: 'bad command that fails',
        embed_commands: true,
        embed_scrollback: false,
      },
    ];

    (pool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      rows: entries,
    } as QueryResult);

    const mockEmbed = vi.fn()
      .mockResolvedValueOnce({
        embedding: new Array(1024).fill(0.1),
        provider: 'openai',
        model: 'text-embedding-3-large',
      })
      .mockRejectedValueOnce(new Error('API rate limit'));

    vi.doMock('../api/embeddings/service.ts', () => ({
      createEmbeddingService: () => ({
        isConfigured: () => true,
        embed: mockEmbed,
      }),
    }));

    const { processTerminalEmbeddings: fn } = await import('./terminal-embeddings.ts');

    // UPDATE for first entry (success)
    (pool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: [], rowCount: 1 } as QueryResult);
    // UPDATE for second entry (mark as skipped on failure)
    (pool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: [], rowCount: 1 } as QueryResult);

    const result = await fn(pool);
    expect(result).toBe(1); // Only 1 succeeded (failed one is skipped, not counted)
    expect(mockEmbed).toHaveBeenCalledTimes(2);

    // Verify the failed entry was marked as skipped (embedded_at set)
    const skipCall = (pool.query as ReturnType<typeof vi.fn>).mock.calls[2];
    expect(skipCall[0]).toContain('embedded_at');
    expect(skipCall[1]).toContain('00000000-0000-0000-0000-000000000002');
  });

  it('skips entries with wrong dimension embedding vectors', async () => {
    const mockEntry = {
      id: '00000000-0000-0000-0000-000000000001',
      session_id: '00000000-0000-0000-0000-000000000010',
      kind: 'command',
      content: 'ls -la',
      embed_commands: true,
      embed_scrollback: false,
    };

    (pool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      rows: [mockEntry],
    } as QueryResult);

    // Return wrong dimension vector (512 instead of 1024)
    const mockEmbed = vi.fn().mockResolvedValue({
      embedding: new Array(512).fill(0.1),
      provider: 'openai',
      model: 'text-embedding-3-large',
    });

    vi.doMock('../api/embeddings/service.ts', () => ({
      createEmbeddingService: () => ({
        isConfigured: () => true,
        embed: mockEmbed,
      }),
    }));

    const { processTerminalEmbeddings: fn } = await import('./terminal-embeddings.ts');

    // UPDATE to mark as skipped (invalid embedding)
    (pool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: [], rowCount: 1 } as QueryResult);

    const result = await fn(pool);
    expect(result).toBe(1);

    // Verify it was marked as skipped, not embedded
    const updateCall = (pool.query as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(updateCall[0]).toContain('embedded_at');
    expect(updateCall[0]).not.toContain('embedding = $1');
  });

  it('respects batch size', async () => {
    expect(TERMINAL_EMBEDDING_BATCH_SIZE).toBe(50);
  });

  it('queries entries with correct filter (kind, embedded_at IS NULL)', async () => {
    (pool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: [] } as QueryResult);

    await processTerminalEmbeddings(pool);

    const selectCall = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0];
    const sql = selectCall[0] as string;

    // Must filter for entries that need embedding
    expect(sql).toContain('embedded_at IS NULL');
    // Must join with terminal_session to get embed_commands/embed_scrollback flags
    expect(sql).toContain('terminal_session');
    // Must limit batch size
    expect(selectCall[1]).toContain(TERMINAL_EMBEDDING_BATCH_SIZE);
  });
});

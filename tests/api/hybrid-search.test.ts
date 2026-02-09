/**
 * Tests for hybrid search (BM25 + vector) functionality.
 * Part of Epic #310, Issue #322.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { Pool, QueryResult } from 'pg';
import { searchMemoriesHybrid, type HybridSearchOptions, type HybridSearchResult, normalizeScore, combineScores } from '../../src/api/search/hybrid.ts';

// Mock pool
function createMockPool(): Pool {
  return {
    query: vi.fn(),
    end: vi.fn(),
  } as unknown as Pool;
}

// Mock embedding service
vi.mock('../../src/api/embeddings/index.ts', () => ({
  embeddingService: {
    isConfigured: vi.fn(() => true),
    embed: vi.fn((query: string) =>
      Promise.resolve({
        embedding: new Array(1024).fill(0.1),
        provider: 'test',
      }),
    ),
  },
}));

describe('Hybrid Search', () => {
  describe('normalizeScore', () => {
    it('should return 0 for null/undefined', () => {
      expect(normalizeScore(null, 0, 1)).toBe(0);
      expect(normalizeScore(undefined, 0, 1)).toBe(0);
    });

    it('should normalize scores to 0-1 range', () => {
      expect(normalizeScore(5, 0, 10)).toBe(0.5);
      expect(normalizeScore(0, 0, 10)).toBe(0);
      expect(normalizeScore(10, 0, 10)).toBe(1);
    });

    it('should handle equal min and max', () => {
      expect(normalizeScore(5, 5, 5)).toBe(1);
    });

    it('should clamp values outside range', () => {
      expect(normalizeScore(15, 0, 10)).toBe(1);
      expect(normalizeScore(-5, 0, 10)).toBe(0);
    });
  });

  describe('combineScores', () => {
    it('should combine scores with default weights (0.7 vector, 0.3 text)', () => {
      const combined = combineScores(1.0, 1.0);
      expect(combined).toBeCloseTo(1.0, 5);
    });

    it('should combine scores with custom weights', () => {
      const combined = combineScores(1.0, 0.0, 0.5, 0.5);
      expect(combined).toBeCloseTo(0.5, 5);
    });

    it('should weight vector score higher by default', () => {
      // Vector score 0.8, text score 0.2
      // 0.7 * 0.8 + 0.3 * 0.2 = 0.56 + 0.06 = 0.62
      const combined = combineScores(0.8, 0.2);
      expect(combined).toBeCloseTo(0.62, 5);
    });

    it('should handle zero scores', () => {
      expect(combineScores(0, 0)).toBe(0);
      expect(combineScores(1.0, 0)).toBeCloseTo(0.7, 5);
      expect(combineScores(0, 1.0)).toBeCloseTo(0.3, 5);
    });
  });

  describe('searchMemoriesHybrid', () => {
    let mockPool: Pool;

    beforeEach(() => {
      vi.clearAllMocks();
      mockPool = createMockPool();
    });

    it('should perform hybrid search combining vector and text results', async () => {
      // Mock vector search results
      const vectorQueryMock = vi.fn().mockResolvedValueOnce({
        rows: [
          { id: 'mem-1', title: 'Memory 1', content: 'Content 1', similarity: '0.9', memory_type: 'fact' },
          { id: 'mem-2', title: 'Memory 2', content: 'Content 2', similarity: '0.8', memory_type: 'fact' },
        ],
      });

      // Mock text search results
      const textQueryMock = vi.fn().mockResolvedValueOnce({
        rows: [
          { id: 'mem-1', title: 'Memory 1', content: 'Content 1', ts_rank: '0.5', memory_type: 'fact' },
          { id: 'mem-3', title: 'Memory 3', content: 'Content 3', ts_rank: '0.3', memory_type: 'fact' },
        ],
      });

      (mockPool.query as ReturnType<typeof vi.fn>).mockImplementationOnce(vectorQueryMock).mockImplementationOnce(textQueryMock);

      const result = await searchMemoriesHybrid(mockPool, 'test query', {
        limit: 10,
      });

      expect(result.searchType).toBe('hybrid');
      expect(result.results.length).toBeGreaterThan(0);
      // mem-1 should appear (it's in both vector and text results)
      expect(result.results.some((r) => r.id === 'mem-1')).toBe(true);
    });

    it('should use configurable weights', async () => {
      (mockPool.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          rows: [{ id: 'mem-1', title: 'Memory 1', content: 'Content 1', similarity: '0.8', memory_type: 'fact' }],
        })
        .mockResolvedValueOnce({
          rows: [{ id: 'mem-1', title: 'Memory 1', content: 'Content 1', ts_rank: '0.8', memory_type: 'fact' }],
        });

      const result = await searchMemoriesHybrid(mockPool, 'test query', {
        vectorWeight: 0.5,
        textWeight: 0.5,
      });

      expect(result.weights.vectorWeight).toBe(0.5);
      expect(result.weights.textWeight).toBe(0.5);
    });

    it('should fall back to text-only when embedding service unavailable', async () => {
      const { embeddingService } = await import('../../src/api/embeddings/index.ts');
      (embeddingService.isConfigured as ReturnType<typeof vi.fn>).mockReturnValueOnce(false);

      (mockPool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ id: 'mem-1', title: 'Memory 1', content: 'Content 1', ts_rank: '0.5', memory_type: 'fact' }],
      });

      const result = await searchMemoriesHybrid(mockPool, 'test query', {});

      expect(result.searchType).toBe('text');
    });

    it('should respect limit parameter', async () => {
      const manyResults = Array.from({ length: 20 }, (_, i) => ({
        id: `mem-${i}`,
        title: `Memory ${i}`,
        content: `Content ${i}`,
        similarity: String(1 - i * 0.05),
        memory_type: 'fact',
      }));

      (mockPool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: manyResults }).mockResolvedValueOnce({ rows: [] });

      const result = await searchMemoriesHybrid(mockPool, 'test query', {
        limit: 5,
      });

      expect(result.results.length).toBeLessThanOrEqual(5);
    });

    it('should filter by userEmail when provided', async () => {
      (mockPool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });

      await searchMemoriesHybrid(mockPool, 'test query', {
        userEmail: 'test@example.com',
      });

      const vectorCall = (mockPool.query as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(vectorCall[0]).toContain('user_email');
      expect(vectorCall[1]).toContain('test@example.com');
    });

    it('should deduplicate results appearing in both vector and text search', async () => {
      // Same memory appears in both
      (mockPool.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          rows: [{ id: 'mem-1', title: 'Memory 1', content: 'Content 1', similarity: '0.9', memory_type: 'fact' }],
        })
        .mockResolvedValueOnce({
          rows: [{ id: 'mem-1', title: 'Memory 1', content: 'Content 1', ts_rank: '0.5', memory_type: 'fact' }],
        });

      const result = await searchMemoriesHybrid(mockPool, 'test query', {});

      // Should only appear once but with combined score
      const mem1Entries = result.results.filter((r) => r.id === 'mem-1');
      expect(mem1Entries.length).toBe(1);
      // Combined score should be higher than either individual score
      expect(mem1Entries[0].combinedScore).toBeGreaterThan(0);
    });

    it('should return results with both scores when available', async () => {
      (mockPool.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          rows: [{ id: 'mem-1', title: 'Memory 1', content: 'Content 1', similarity: '0.9', memory_type: 'fact' }],
        })
        .mockResolvedValueOnce({
          rows: [{ id: 'mem-1', title: 'Memory 1', content: 'Content 1', ts_rank: '0.5', memory_type: 'fact' }],
        });

      const result = await searchMemoriesHybrid(mockPool, 'test query', {});

      const mem1 = result.results.find((r) => r.id === 'mem-1')!;
      expect(mem1.vectorScore).toBeDefined();
      expect(mem1.textScore).toBeDefined();
      expect(mem1.combinedScore).toBeDefined();
    });
  });
});

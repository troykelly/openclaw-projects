/**
 * Unit tests for API memory search scoring improvements.
 * Tests memory_kind boosting and min_similarity threshold.
 * Issue #2276.
 */

import { describe, it, expect } from 'vitest';
import { applyMemoryKindBoost, DEFAULT_API_MIN_SIMILARITY } from '../../../src/api/api-sources/search.ts';
import type { ApiMemorySearchResult } from '../../../src/api/api-sources/types.ts';

function makeResult(overrides: Partial<ApiMemorySearchResult>): ApiMemorySearchResult {
  return {
    id: 'test-id',
    api_source_id: 'source-1',
    memory_kind: 'operation',
    operation_key: 'testOp',
    title: 'Test',
    content: 'Test content',
    metadata: {},
    tags: [],
    score: 0.5,
    ...overrides,
  };
}

describe('DEFAULT_API_MIN_SIMILARITY (#2276)', () => {
  it('is lower than the general memory threshold', () => {
    // API recall needs a lower threshold (0.15) than general memory search (0.3)
    expect(DEFAULT_API_MIN_SIMILARITY).toBeLessThan(0.3);
    expect(DEFAULT_API_MIN_SIMILARITY).toBe(0.15);
  });
});

describe('applyMemoryKindBoost (#2276)', () => {
  it('boosts overview results', () => {
    const results = [
      makeResult({ id: '1', memory_kind: 'operation', score: 0.5 }),
      makeResult({ id: '2', memory_kind: 'overview', score: 0.5 }),
    ];

    const boosted = applyMemoryKindBoost(results);
    const overview = boosted.find((r) => r.id === '2')!;
    const operation = boosted.find((r) => r.id === '1')!;

    expect(overview.score).toBeGreaterThan(operation.score);
  });

  it('boosts tag_group results', () => {
    const results = [
      makeResult({ id: '1', memory_kind: 'operation', score: 0.5 }),
      makeResult({ id: '2', memory_kind: 'tag_group', score: 0.5 }),
    ];

    const boosted = applyMemoryKindBoost(results);
    const tagGroup = boosted.find((r) => r.id === '2')!;
    const operation = boosted.find((r) => r.id === '1')!;

    expect(tagGroup.score).toBeGreaterThan(operation.score);
  });

  it('boosts overview more than tag_group', () => {
    const results = [
      makeResult({ id: '1', memory_kind: 'overview', score: 0.5 }),
      makeResult({ id: '2', memory_kind: 'tag_group', score: 0.5 }),
    ];

    const boosted = applyMemoryKindBoost(results);
    const overview = boosted.find((r) => r.id === '1')!;
    const tagGroup = boosted.find((r) => r.id === '2')!;

    expect(overview.score).toBeGreaterThan(tagGroup.score);
  });

  it('does not boost operations', () => {
    const results = [
      makeResult({ id: '1', memory_kind: 'operation', score: 0.5 }),
    ];

    const boosted = applyMemoryKindBoost(results);
    expect(boosted[0].score).toBe(0.5);
  });

  it('preserves result ordering after boost', () => {
    const results = [
      makeResult({ id: '1', memory_kind: 'operation', score: 0.9 }),
      makeResult({ id: '2', memory_kind: 'overview', score: 0.3 }),
      makeResult({ id: '3', memory_kind: 'tag_group', score: 0.4 }),
    ];

    const boosted = applyMemoryKindBoost(results);
    // High-scoring operation should still be first despite no boost
    expect(boosted[0].id).toBe('1');
  });
});

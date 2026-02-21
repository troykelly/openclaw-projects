/**
 * Unit tests for namespace priority boost in memory search.
 * Issue #1535 — Epic #1533
 *
 * Tests the production applyNamespacePriorityBoost function directly.
 *
 * Tests:
 * - Higher-priority namespace results rank above equal-similarity results
 * - Much-higher-similarity results from low-priority namespace still outrank
 * - Boost is small enough to act as tie-breaker (0.00-0.05 range)
 */

import { describe, expect, it } from 'vitest';
import { applyNamespacePriorityBoost } from './service.ts';

describe('Namespace Priority Boost (Issue #1535)', () => {
  it('should boost higher-priority namespace above equal-similarity results', () => {
    const results = [
      { similarity: 0.90, namespace: 'default' },
      { similarity: 0.90, namespace: 'troy' },
    ];
    const priorities = { troy: 90, default: 10 };

    const boosted = applyNamespacePriorityBoost(results, priorities);

    // Troy (priority 90) should rank above default (priority 10) when similarity is equal
    expect(boosted[0].namespace).toBe('troy');
    expect(boosted[1].namespace).toBe('default');
  });

  it('should not override much-higher similarity from low-priority namespace', () => {
    const results = [
      { similarity: 0.95, namespace: 'default' },
      { similarity: 0.70, namespace: 'troy' },
    ];
    const priorities = { troy: 90, default: 10 };

    const boosted = applyNamespacePriorityBoost(results, priorities);

    // Default has much higher similarity (0.95 vs 0.70), boost can't overcome that
    // default boosted: 0.95 + 10/2000 = 0.955
    // troy boosted: 0.70 + 90/2000 = 0.745
    expect(boosted[0].namespace).toBe('default');
    expect(boosted[0].similarity).toBeCloseTo(0.955, 3);
    expect(boosted[1].namespace).toBe('troy');
    expect(boosted[1].similarity).toBeCloseTo(0.745, 3);
  });

  it('should use default priority 50 for unknown namespaces', () => {
    const results = [
      { similarity: 0.85, namespace: 'unknown-ns' },
    ];
    const priorities = { troy: 90 };

    const boosted = applyNamespacePriorityBoost(results, priorities);

    // Unknown namespace defaults to priority 50 -> boost = 50/2000 = 0.025
    expect(boosted[0].similarity).toBeCloseTo(0.875, 3);
    expect((boosted[0] as Record<string, unknown>).namespace_priority).toBe(50);
  });

  it('should return results unchanged when priorities map is empty', () => {
    const results = [
      { similarity: 0.90, namespace: 'troy' },
      { similarity: 0.85, namespace: 'default' },
    ];

    const boosted = applyNamespacePriorityBoost(results, {});

    expect(boosted).toEqual(results);
  });

  it('should include namespace_priority in results', () => {
    const results = [
      { similarity: 0.85, namespace: 'troy' },
    ];
    const priorities = { troy: 90 };

    const boosted = applyNamespacePriorityBoost(results, priorities);
    expect((boosted[0] as Record<string, unknown>).namespace_priority).toBe(90);
  });

  it('should sort by boosted similarity descending', () => {
    const results = [
      { similarity: 0.80, namespace: 'default' },
      { similarity: 0.83, namespace: 'mattytroy' },
      { similarity: 0.81, namespace: 'troy' },
    ];
    const priorities = { troy: 90, mattytroy: 70, default: 10 };

    const boosted = applyNamespacePriorityBoost(results, priorities);

    // mattytroy: 0.83 + 0.035 = 0.865
    // troy: 0.81 + 0.045 = 0.855
    // default: 0.80 + 0.005 = 0.805
    expect(boosted[0].namespace).toBe('mattytroy');
    expect(boosted[1].namespace).toBe('troy');
    expect(boosted[2].namespace).toBe('default');
  });
});

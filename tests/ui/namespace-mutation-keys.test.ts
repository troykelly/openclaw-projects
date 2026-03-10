/**
 * @vitest-environment jsdom
 * Tests for namespace-aware mutation invalidation (Issue #2363).
 *
 * Validates that mutation hooks use predicate-based invalidation
 * to match namespace-prefixed query keys, not bare key arrays.
 *
 * The core problem: queries use keys like
 *   [{ namespaces: ['ns1'] }, 'work-items', 'list', ...]
 * but mutations were invalidating with bare keys like
 *   ['work-items']
 * which does NOT match because TanStack Query v5 uses prefix matching
 * and the first element differs.
 *
 * The fix: use `invalidateQueries({ predicate })` to match keys
 * containing the base key segment regardless of namespace prefix.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { createNamespaceInvalidator, namespaceAwareInvalidation } from '@/ui/lib/namespace-invalidation';

describe('Namespace-aware invalidation (#2363)', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  describe('namespaceAwareInvalidation', () => {
    it('creates a predicate that matches namespace-prefixed keys', () => {
      const filter = namespaceAwareInvalidation(['work-items']);
      const query = {
        queryKey: [{ namespaces: ['personal'] }, 'work-items', 'list', { status: 'open' }],
      };
      expect(filter.predicate(query as Parameters<NonNullable<typeof filter.predicate>>[0])).toBe(true);
    });

    it('matches single-element base keys', () => {
      const filter = namespaceAwareInvalidation(['work-items']);
      const query = {
        queryKey: [{ namespaces: ['personal'] }, 'work-items'],
      };
      expect(filter.predicate(query as Parameters<NonNullable<typeof filter.predicate>>[0])).toBe(true);
    });

    it('matches multi-element base keys', () => {
      const filter = namespaceAwareInvalidation(['work-items', 'detail', 'abc-123']);
      const query = {
        queryKey: [{ namespaces: ['personal'] }, 'work-items', 'detail', 'abc-123'],
      };
      expect(filter.predicate(query as Parameters<NonNullable<typeof filter.predicate>>[0])).toBe(true);
    });

    it('does not match keys that do not contain the base key sequence', () => {
      const filter = namespaceAwareInvalidation(['work-items']);
      const query = {
        queryKey: [{ namespaces: ['personal'] }, 'contacts', 'list'],
      };
      expect(filter.predicate(query as Parameters<NonNullable<typeof filter.predicate>>[0])).toBe(false);
    });

    it('matches bare (non-namespaced) keys for backwards compatibility', () => {
      const filter = namespaceAwareInvalidation(['work-items']);
      const query = {
        queryKey: ['work-items', 'list'],
      };
      expect(filter.predicate(query as Parameters<NonNullable<typeof filter.predicate>>[0])).toBe(true);
    });

    it('does not partially match base key segments', () => {
      const filter = namespaceAwareInvalidation(['work-items', 'detail', 'abc']);
      const query = {
        queryKey: [{ namespaces: ['personal'] }, 'work-items', 'list'],
      };
      expect(filter.predicate(query as Parameters<NonNullable<typeof filter.predicate>>[0])).toBe(false);
    });
  });

  describe('createNamespaceInvalidator', () => {
    it('returns a function that calls invalidateQueries with predicate', () => {
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);
      const invalidate = createNamespaceInvalidator(queryClient);

      invalidate(['work-items']);

      expect(invalidateSpy).toHaveBeenCalledTimes(1);
      const call = invalidateSpy.mock.calls[0][0];
      expect(call).toHaveProperty('predicate');
      expect(typeof call?.predicate).toBe('function');
    });

    it('invalidator predicate matches namespace-prefixed keys', () => {
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);
      const invalidate = createNamespaceInvalidator(queryClient);

      invalidate(['notes', 'lists']);

      const predicate = invalidateSpy.mock.calls[0][0]?.predicate;
      expect(predicate).toBeDefined();

      // Should match namespace-prefixed
      expect(predicate!({ queryKey: [{ namespaces: ['ns1'] }, 'notes', 'lists'] } as Parameters<typeof predicate>[0])).toBe(true);
      // Should match bare
      expect(predicate!({ queryKey: ['notes', 'lists'] } as Parameters<typeof predicate>[0])).toBe(true);
      // Should not match different keys
      expect(predicate!({ queryKey: [{ namespaces: ['ns1'] }, 'contacts'] } as Parameters<typeof predicate>[0])).toBe(false);
    });
  });
});

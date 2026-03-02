/**
 * Tests for dev session embedding worker.
 * Issue #1987 — Dev session semantic search with embeddings.
 */

import { describe, expect, it } from 'vitest';
import { buildEmbeddingText } from './dev-session-embeddings.ts';

describe('dev-session-embeddings', () => {
  describe('buildEmbeddingText', () => {
    it('should combine all fields with labels', () => {
      const text = buildEmbeddingText({
        id: 'test-id',
        session_name: 'fix-auth-bug',
        task_summary: 'Fix token refresh race condition',
        task_prompt: 'The token refresh causes 401 errors under load',
        completion_summary: 'Added retry with backoff, all tests pass',
      });

      expect(text).toContain('Session: fix-auth-bug');
      expect(text).toContain('Summary: Fix token refresh race condition');
      expect(text).toContain('Prompt: The token refresh causes 401 errors under load');
      expect(text).toContain('Completion: Added retry with backoff, all tests pass');
    });

    it('should handle missing optional fields', () => {
      const text = buildEmbeddingText({
        id: 'test-id',
        session_name: 'my-session',
        task_summary: 'Do something',
        task_prompt: null,
        completion_summary: null,
      });

      expect(text).toContain('Session: my-session');
      expect(text).toContain('Summary: Do something');
      expect(text).not.toContain('Prompt:');
      expect(text).not.toContain('Completion:');
    });

    it('should return null when no embeddable text exists', () => {
      const text = buildEmbeddingText({
        id: 'test-id',
        session_name: '',
        task_summary: null,
        task_prompt: null,
        completion_summary: null,
      });

      expect(text).toBeNull();
    });

    it('should handle session with only completion summary', () => {
      const text = buildEmbeddingText({
        id: 'test-id',
        session_name: 'session-1',
        task_summary: null,
        task_prompt: null,
        completion_summary: 'Completed the migration successfully',
      });

      expect(text).toContain('Session: session-1');
      expect(text).toContain('Completion: Completed the migration successfully');
      expect(text).not.toContain('Summary:');
      expect(text).not.toContain('Prompt:');
    });

    it('should handle session with only task_prompt', () => {
      const text = buildEmbeddingText({
        id: 'test-id',
        session_name: 'dev-session',
        task_summary: null,
        task_prompt: 'Build the search feature for dev sessions',
        completion_summary: null,
      });

      expect(text).toContain('Session: dev-session');
      expect(text).toContain('Prompt: Build the search feature for dev sessions');
    });
  });
});

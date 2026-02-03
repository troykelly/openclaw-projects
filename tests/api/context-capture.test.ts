/**
 * Tests for context capture endpoint.
 * Part of Epic #310, Issue #317.
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import type { Pool, QueryResult } from 'pg';
import {
  captureContext,
  validateCaptureInput,
  type ContextCaptureInput,
  type ContextCaptureResult,
} from '../../src/api/context/capture.ts';

// Mock pool
function createMockPool(): Pool {
  return {
    query: vi.fn(),
    end: vi.fn(),
  } as unknown as Pool;
}

describe('Context Capture Service', () => {
  let mockPool: Pool;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPool = createMockPool();
  });

  describe('validateCaptureInput', () => {
    it('should return null for valid input', () => {
      const input: ContextCaptureInput = {
        conversation: 'This is a conversation that happened between user and agent.',
        messageCount: 5,
      };
      expect(validateCaptureInput(input)).toBeNull();
    });

    it('should require conversation', () => {
      const input = {
        messageCount: 5,
      } as ContextCaptureInput;
      expect(validateCaptureInput(input)).toBe('conversation is required');
    });

    it('should require non-empty conversation', () => {
      const input: ContextCaptureInput = {
        conversation: '   ',
        messageCount: 5,
      };
      expect(validateCaptureInput(input)).toBe('conversation cannot be empty');
    });

    it('should require conversation string type', () => {
      const input = {
        conversation: 123,
        messageCount: 5,
      } as unknown as ContextCaptureInput;
      expect(validateCaptureInput(input)).toBe('conversation is required');
    });

    it('should require messageCount', () => {
      const input = {
        conversation: 'Some conversation',
      } as ContextCaptureInput;
      expect(validateCaptureInput(input)).toBe('messageCount is required');
    });

    it('should require messageCount to be a number', () => {
      const input = {
        conversation: 'Some conversation',
        messageCount: 'five',
      } as unknown as ContextCaptureInput;
      expect(validateCaptureInput(input)).toBe('messageCount must be a positive integer');
    });

    it('should require messageCount to be positive', () => {
      const input: ContextCaptureInput = {
        conversation: 'Some conversation',
        messageCount: 0,
      };
      expect(validateCaptureInput(input)).toBe('messageCount must be a positive integer');
    });

    it('should accept optional userId', () => {
      const input: ContextCaptureInput = {
        conversation: 'A conversation with sufficient content for testing purposes.',
        messageCount: 5,
        userId: 'user@example.com',
      };
      expect(validateCaptureInput(input)).toBeNull();
    });
  });

  describe('captureContext', () => {
    it('should skip capture for short conversations (< 2 messages)', async () => {
      const input: ContextCaptureInput = {
        conversation: 'Short conversation',
        messageCount: 1,
      };

      const result = await captureContext(mockPool, input);

      expect(result.captured).toBe(0);
      expect(result.reason).toBe('conversation too short');
      expect((mockPool.query as Mock).mock.calls.length).toBe(0);
    });

    it('should skip capture for short content (< 100 characters)', async () => {
      const input: ContextCaptureInput = {
        conversation: 'A very short summary.',
        messageCount: 5,
      };

      const result = await captureContext(mockPool, input);

      expect(result.captured).toBe(0);
      expect(result.reason).toBe('content too short');
      expect((mockPool.query as Mock).mock.calls.length).toBe(0);
    });

    it('should store context as memory for valid input', async () => {
      const longConversation = 'This is a conversation summary that is long enough to meet the minimum content requirement. The user discussed their preferences and decisions during this session.';
      const input: ContextCaptureInput = {
        conversation: longConversation,
        messageCount: 10,
        userId: 'user@example.com',
      };

      (mockPool.query as Mock).mockResolvedValue({
        rows: [{
          id: '123e4567-e89b-12d3-a456-426614174000',
          title: 'Conversation Context',
          content: longConversation.substring(0, 2000),
          memory_type: 'context',
          importance: 5,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }],
      });

      const result = await captureContext(mockPool, input);

      expect(result.captured).toBe(1);
      expect(result.memoryId).toBeDefined();
      expect((mockPool.query as Mock).mock.calls.length).toBe(1);
    });

    it('should truncate content to 2000 characters', async () => {
      const veryLongConversation = 'x'.repeat(3000);
      const input: ContextCaptureInput = {
        conversation: veryLongConversation,
        messageCount: 20,
      };

      (mockPool.query as Mock).mockResolvedValue({
        rows: [{
          id: '123e4567-e89b-12d3-a456-426614174000',
          title: 'Conversation Context',
          content: veryLongConversation.substring(0, 2000),
          memory_type: 'context',
          importance: 5,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }],
      });

      await captureContext(mockPool, input);

      const query = (mockPool.query as Mock).mock.calls[0][0] as string;
      const params = (mockPool.query as Mock).mock.calls[0][1] as unknown[];
      // Content parameter (4th or 5th position depending on query structure)
      const contentParam = params.find(p => typeof p === 'string' && p.length === 2000);
      expect(contentParam).toBeDefined();
      expect((contentParam as string).length).toBe(2000);
    });

    it('should use auto-capture agent name', async () => {
      const conversation = 'A conversation summary with enough content to trigger capture and storage in the memory system. This needs to be at least 100 characters long.';
      const input: ContextCaptureInput = {
        conversation,
        messageCount: 5,
      };

      (mockPool.query as Mock).mockResolvedValue({
        rows: [{
          id: '123e4567-e89b-12d3-a456-426614174000',
          title: 'Conversation Context',
          content: conversation,
          memory_type: 'context',
          importance: 5,
          created_by_agent: 'auto-capture',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }],
      });

      await captureContext(mockPool, input);

      const params = (mockPool.query as Mock).mock.calls[0][1] as unknown[];
      expect(params).toContain('auto-capture');
    });

    it('should handle database errors gracefully', async () => {
      const conversation = 'A conversation summary with enough content to trigger capture and storage in the memory system. This needs to be at least 100 characters long.';
      const input: ContextCaptureInput = {
        conversation,
        messageCount: 5,
      };

      (mockPool.query as Mock).mockRejectedValue(new Error('Database connection failed'));

      const result = await captureContext(mockPool, input);

      expect(result.captured).toBe(0);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('Database');
    });

    it('should set memory type to context', async () => {
      const conversation = 'A conversation summary with enough content to trigger capture and storage in the memory system. This needs to be at least 100 characters long.';
      const input: ContextCaptureInput = {
        conversation,
        messageCount: 5,
      };

      (mockPool.query as Mock).mockResolvedValue({
        rows: [{
          id: '123e4567-e89b-12d3-a456-426614174000',
          title: 'Conversation Context',
          content: conversation,
          memory_type: 'context',
          importance: 5,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }],
      });

      await captureContext(mockPool, input);

      const query = (mockPool.query as Mock).mock.calls[0][0] as string;
      expect(query).toContain('memory_type');
      const params = (mockPool.query as Mock).mock.calls[0][1] as unknown[];
      expect(params).toContain('context');
    });

    it('should return captured count of 0 when no rows returned', async () => {
      const conversation = 'A conversation summary with enough content to trigger capture and storage in the memory system. This needs to be at least 100 characters long.';
      const input: ContextCaptureInput = {
        conversation,
        messageCount: 5,
      };

      (mockPool.query as Mock).mockResolvedValue({
        rows: [],
      });

      const result = await captureContext(mockPool, input);

      expect(result.captured).toBe(0);
      expect(result.reason).toBe('insertion returned no rows');
    });

    it('should set default importance of 5', async () => {
      const conversation = 'A conversation summary with enough content to trigger capture and storage in the memory system. This needs to be at least 100 characters long.';
      const input: ContextCaptureInput = {
        conversation,
        messageCount: 5,
      };

      (mockPool.query as Mock).mockResolvedValue({
        rows: [{
          id: '123e4567-e89b-12d3-a456-426614174000',
          title: 'Conversation Context',
          content: conversation,
          memory_type: 'context',
          importance: 5,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }],
      });

      await captureContext(mockPool, input);

      const params = (mockPool.query as Mock).mock.calls[0][1] as unknown[];
      expect(params).toContain(5);
    });
  });

  describe('Result types', () => {
    it('should have proper structure for success result', async () => {
      const conversation = 'A conversation summary with enough content to trigger capture and storage in the memory system. This needs to be at least 100 characters long.';
      const input: ContextCaptureInput = {
        conversation,
        messageCount: 5,
      };

      (mockPool.query as Mock).mockResolvedValue({
        rows: [{
          id: '123e4567-e89b-12d3-a456-426614174000',
          title: 'Conversation Context',
          content: conversation,
          memory_type: 'context',
          importance: 5,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }],
      });

      const result = await captureContext(mockPool, input);

      expect(result).toHaveProperty('captured');
      expect(result).toHaveProperty('memoryId');
      expect(typeof result.captured).toBe('number');
      expect(typeof result.memoryId).toBe('string');
    });

    it('should have proper structure for skip result', async () => {
      const input: ContextCaptureInput = {
        conversation: 'Short',
        messageCount: 1,
      };

      const result = await captureContext(mockPool, input);

      expect(result).toHaveProperty('captured');
      expect(result).toHaveProperty('reason');
      expect(result.captured).toBe(0);
      expect(typeof result.reason).toBe('string');
    });
  });
});

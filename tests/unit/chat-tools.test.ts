/**
 * Unit tests for chat plugin tool definitions (#1954).
 *
 * Tests tool metadata structure and parameter schemas.
 * Pure unit tests — no database required.
 *
 * Epic #1940 — Agent Chat.
 */

import { describe, it, expect } from 'vitest';
import {
  CHAT_SEND_MESSAGE_TOOL,
  CHAT_ATTRACT_ATTENTION_TOOL,
} from '../../src/api/chat/tools.ts';

describe('Chat Plugin Tools (#1954)', () => {
  describe('CHAT_SEND_MESSAGE_TOOL', () => {
    it('has correct name', () => {
      expect(CHAT_SEND_MESSAGE_TOOL.name).toBe('chat_send_message');
    });

    it('has non-empty description', () => {
      expect(CHAT_SEND_MESSAGE_TOOL.description.length).toBeGreaterThan(20);
    });

    it('requires session_id and content', () => {
      expect(CHAT_SEND_MESSAGE_TOOL.parameters.required).toEqual(['session_id', 'content']);
    });

    it('has session_id parameter', () => {
      expect(CHAT_SEND_MESSAGE_TOOL.parameters.properties.session_id).toBeDefined();
      expect(CHAT_SEND_MESSAGE_TOOL.parameters.properties.session_id.type).toBe('string');
    });

    it('has content parameter', () => {
      expect(CHAT_SEND_MESSAGE_TOOL.parameters.properties.content).toBeDefined();
      expect(CHAT_SEND_MESSAGE_TOOL.parameters.properties.content.type).toBe('string');
    });

    it('has content_type parameter with valid enum', () => {
      const ct = CHAT_SEND_MESSAGE_TOOL.parameters.properties.content_type;
      expect(ct).toBeDefined();
      expect(ct.enum).toContain('text/plain');
      expect(ct.enum).toContain('text/markdown');
      expect(ct.enum).toContain('application/vnd.openclaw.rich-card');
    });

    it('has urgency parameter with valid enum', () => {
      const u = CHAT_SEND_MESSAGE_TOOL.parameters.properties.urgency;
      expect(u).toBeDefined();
      expect(u.enum).toEqual(['low', 'normal', 'high', 'urgent']);
    });
  });

  describe('CHAT_ATTRACT_ATTENTION_TOOL', () => {
    it('has correct name', () => {
      expect(CHAT_ATTRACT_ATTENTION_TOOL.name).toBe('chat_attract_attention');
    });

    it('has non-empty description', () => {
      expect(CHAT_ATTRACT_ATTENTION_TOOL.description.length).toBeGreaterThan(20);
    });

    it('requires message, urgency, and reason_key', () => {
      expect(CHAT_ATTRACT_ATTENTION_TOOL.parameters.required).toEqual(['message', 'urgency', 'reason_key']);
    });

    it('has message parameter', () => {
      expect(CHAT_ATTRACT_ATTENTION_TOOL.parameters.properties.message).toBeDefined();
      expect(CHAT_ATTRACT_ATTENTION_TOOL.parameters.properties.message.type).toBe('string');
    });

    it('has urgency parameter with valid enum', () => {
      const u = CHAT_ATTRACT_ATTENTION_TOOL.parameters.properties.urgency;
      expect(u).toBeDefined();
      expect(u.enum).toEqual(['low', 'normal', 'high', 'urgent']);
    });

    it('has reason_key parameter', () => {
      expect(CHAT_ATTRACT_ATTENTION_TOOL.parameters.properties.reason_key).toBeDefined();
      expect(CHAT_ATTRACT_ATTENTION_TOOL.parameters.properties.reason_key.type).toBe('string');
    });

    it('has optional session_id parameter', () => {
      expect(CHAT_ATTRACT_ATTENTION_TOOL.parameters.properties.session_id).toBeDefined();
      // Not in required
      expect(CHAT_ATTRACT_ATTENTION_TOOL.parameters.required).not.toContain('session_id');
    });

    it('has optional action_url parameter', () => {
      expect(CHAT_ATTRACT_ATTENTION_TOOL.parameters.properties.action_url).toBeDefined();
      expect(CHAT_ATTRACT_ATTENTION_TOOL.parameters.required).not.toContain('action_url');
    });
  });
});

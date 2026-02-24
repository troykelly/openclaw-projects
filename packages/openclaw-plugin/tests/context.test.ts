import { describe, expect, it } from 'vitest';
import {
  extractUserContext,
  extractAgentContext,
  extractSessionContext,
  extractContext,
  parseAgentIdFromSessionKey,
  getUserScopeKey,
  validateSessionKey,
  resolveAgentId,
  MAX_AGENT_ID_LENGTH,
  type UserContext,
} from '../src/context.js';

describe('Context Extraction', () => {
  describe('extractUserContext', () => {
    it('should return undefined for null/undefined input', () => {
      expect(extractUserContext(null)).toBeUndefined();
      expect(extractUserContext(undefined)).toBeUndefined();
    });

    it('should return undefined for non-object input', () => {
      expect(extractUserContext('string')).toBeUndefined();
      expect(extractUserContext(123)).toBeUndefined();
    });

    it('should return undefined if no user property', () => {
      expect(extractUserContext({})).toBeUndefined();
      expect(extractUserContext({ agent: {} })).toBeUndefined();
    });

    it('should return undefined if user has no id', () => {
      expect(extractUserContext({ user: {} })).toBeUndefined();
      expect(extractUserContext({ user: { name: 'test' } })).toBeUndefined();
    });

    it('should extract user_id from user.id', () => {
      const result = extractUserContext({ user: { id: 'user-123' } });
      expect(result?.user_id).toBe('user-123');
    });

    it('should extract display_name if present', () => {
      const result = extractUserContext({
        user: { id: 'user-123', display_name: 'John Doe' },
      });
      expect(result?.display_name).toBe('John Doe');
    });

    it('should extract email if present', () => {
      const result = extractUserContext({
        user: { id: 'user-123', email: 'john@example.com' },
      });
      expect(result?.email).toBe('john@example.com');
    });
  });

  describe('extractAgentContext', () => {
    it('should return default for null/undefined input', () => {
      const result = extractAgentContext(null);
      expect(result.agentId).toBe('unknown');
      expect(result.name).toBe('Unknown Agent');
    });

    it('should return default for non-object input', () => {
      const result = extractAgentContext('string');
      expect(result.agentId).toBe('unknown');
    });

    it('should return default if no agent property', () => {
      const result = extractAgentContext({});
      expect(result.agentId).toBe('unknown');
    });

    it('should extract agentId from agent.id', () => {
      const result = extractAgentContext({ agent: { id: 'agent-1' } });
      expect(result.agentId).toBe('agent-1');
    });

    it('should extract name from agent.name', () => {
      const result = extractAgentContext({
        agent: { id: 'agent-1', name: 'My Agent' },
      });
      expect(result.name).toBe('My Agent');
    });

    it('should extract version if present', () => {
      const result = extractAgentContext({
        agent: { id: 'agent-1', name: 'Agent', version: '1.0.0' },
      });
      expect(result.version).toBe('1.0.0');
    });
  });

  describe('extractSessionContext', () => {
    it('should return default with generated sessionId for null input', () => {
      const result = extractSessionContext(null);
      expect(result.sessionId).toBeDefined();
      expect(result.sessionId.length).toBeGreaterThan(0);
      expect(result.startedAt).toBeInstanceOf(Date);
    });

    it('should extract sessionId from session.id', () => {
      const result = extractSessionContext({
        session: { id: 'session-123' },
      });
      expect(result.sessionId).toBe('session-123');
    });

    it('should extract startedAt from Date', () => {
      const date = new Date('2024-01-01');
      const result = extractSessionContext({
        session: { id: 'session-123', startedAt: date },
      });
      expect(result.startedAt).toEqual(date);
    });

    it('should parse startedAt from string', () => {
      const result = extractSessionContext({
        session: { id: 'session-123', startedAt: '2024-01-01T00:00:00Z' },
      });
      expect(result.startedAt).toBeInstanceOf(Date);
    });

    it('should extract thread_id if present', () => {
      const result = extractSessionContext({
        session: { id: 'session-123', thread_id: 'thread-456' },
      });
      expect(result.thread_id).toBe('thread-456');
    });
  });

  describe('extractContext', () => {
    it('should combine all contexts', () => {
      const runtime = {
        user: { id: 'user-1' },
        agent: { id: 'agent-1', name: 'Test Agent' },
        session: { id: 'session-1' },
      };
      const result = extractContext(runtime);
      expect(result.user?.user_id).toBe('user-1');
      expect(result.agent.agentId).toBe('agent-1');
      expect(result.session.sessionId).toBe('session-1');
    });

    it('should have undefined user if not present', () => {
      const result = extractContext({
        agent: { id: 'agent-1', name: 'Test' },
        session: { id: 'session-1' },
      });
      expect(result.user).toBeUndefined();
    });
  });

  describe('validateSessionKey', () => {
    it('should accept valid session keys', () => {
      expect(validateSessionKey('agent:agent-1:telegram:dm:user-123')).toBe(true);
      expect(validateSessionKey('agent:test-agent:whatsapp:group:group-456')).toBe(true);
      expect(validateSessionKey('simple-key')).toBe(true);
    });

    it('should reject empty keys', () => {
      expect(validateSessionKey('')).toBe(false);
    });

    it('should reject keys that are too long (>500 chars)', () => {
      const longKey = 'a'.repeat(501);
      expect(validateSessionKey(longKey)).toBe(false);
    });

    it('should reject keys with invalid characters', () => {
      expect(validateSessionKey('key with spaces')).toBe(false);
      expect(validateSessionKey('key<script>')).toBe(false);
      expect(validateSessionKey("key'injection")).toBe(false);
    });

    it('should accept keys with colons, hyphens, underscores', () => {
      expect(validateSessionKey('a:b-c_d')).toBe(true);
      expect(validateSessionKey('agent:id-123:channel_type')).toBe(true);
    });
  });

  describe('parseAgentIdFromSessionKey', () => {
    it('should parse agentId from standard session key format', () => {
      // Format: agent:<agentId>:<channel>:...
      expect(parseAgentIdFromSessionKey('agent:my-agent:telegram:dm:user-123')).toBe('my-agent');
      expect(parseAgentIdFromSessionKey('agent:agent-1:whatsapp:group:456')).toBe('agent-1');
    });

    it('should return "unknown" for undefined/null', () => {
      expect(parseAgentIdFromSessionKey(undefined)).toBe('unknown');
      expect(parseAgentIdFromSessionKey(null as unknown as string)).toBe('unknown');
    });

    it('should return "unknown" for empty string', () => {
      expect(parseAgentIdFromSessionKey('')).toBe('unknown');
    });

    it('should return "unknown" for invalid format', () => {
      expect(parseAgentIdFromSessionKey('invalid-key')).toBe('unknown');
      expect(parseAgentIdFromSessionKey('not:agent:prefix')).toBe('unknown');
    });

    it('should return "unknown" for malformed session key', () => {
      expect(parseAgentIdFromSessionKey('agent:')).toBe('unknown');
      expect(parseAgentIdFromSessionKey('agent::')).toBe('unknown');
    });

    it('should sanitize invalid characters and return unknown', () => {
      expect(parseAgentIdFromSessionKey('agent:<script>:channel')).toBe('unknown');
    });

    it('should return unknown for agent ID exceeding MAX_AGENT_ID_LENGTH', () => {
      const longId = 'a'.repeat(64);
      const key = `agent:${longId}:channel`;
      expect(parseAgentIdFromSessionKey(key)).toBe('unknown');
    });

    it('should accept agent ID at exactly MAX_AGENT_ID_LENGTH', () => {
      const exactId = 'a'.repeat(MAX_AGENT_ID_LENGTH);
      const key = `agent:${exactId}:channel`;
      expect(parseAgentIdFromSessionKey(key)).toBe(exactId);
    });
  });

  describe('getUserScopeKey', () => {
    const baseContext: UserContext & {
      agentId: string;
      sessionKey?: string;
      senderId?: string;
      channel?: string;
      identityKey?: string;
    } = {
      user_id: 'user-1',
      agentId: 'agent-1',
      sessionKey: 'agent:agent-1:telegram:dm:user-123',
      senderId: 'tg-user-456',
      channel: 'telegram',
      identityKey: 'identity-789',
    };

    describe('agent scoping mode', () => {
      it('should return agentId for agent scoping', () => {
        const result = getUserScopeKey(baseContext, 'agent');
        expect(result).toBe('agent-1');
      });

      it('should fallback to "unknown" if no agentId', () => {
        const ctx = { ...baseContext, agentId: '' };
        const result = getUserScopeKey(ctx, 'agent');
        expect(result).toBe('unknown');
      });
    });

    describe('identity scoping mode', () => {
      it('should return identityKey if present', () => {
        const result = getUserScopeKey(baseContext, 'identity');
        expect(result).toBe('identity-789');
      });

      it('should fallback to agentId if no identityKey', () => {
        const ctx = { ...baseContext, identityKey: undefined };
        const result = getUserScopeKey(ctx, 'identity');
        expect(result).toBe('agent-1');
      });
    });

    describe('session scoping mode', () => {
      it('should return sessionKey if present', () => {
        const result = getUserScopeKey(baseContext, 'session');
        expect(result).toBe('agent:agent-1:telegram:dm:user-123');
      });

      it('should fallback to agentId if no sessionKey', () => {
        const ctx = { ...baseContext, sessionKey: undefined };
        const result = getUserScopeKey(ctx, 'session');
        expect(result).toBe('agent-1');
      });
    });

    it('should handle missing optional fields gracefully', () => {
      const minimalContext = {
        user_id: 'user-1',
        agentId: 'agent-1',
      };
      expect(getUserScopeKey(minimalContext, 'agent')).toBe('agent-1');
      expect(getUserScopeKey(minimalContext, 'identity')).toBe('agent-1');
      expect(getUserScopeKey(minimalContext, 'session')).toBe('agent-1');
    });
  });

  describe('resolveAgentId', () => {
    it('should prefer explicit config agentId over everything', () => {
      const result = resolveAgentId(
        { agentId: 'from-hook', sessionKey: 'agent:from-session:telegram:123' },
        'from-config',
        'existing-state',
      );
      expect(result).toBe('from-config');
    });

    it('should use hook context agentId when no config', () => {
      const result = resolveAgentId(
        { agentId: 'from-hook' },
        undefined,
        'unknown',
      );
      expect(result).toBe('from-hook');
    });

    it('should parse from session key when agentId missing', () => {
      const result = resolveAgentId(
        { sessionKey: 'agent:my-agent:telegram:123' },
        undefined,
        'unknown',
      );
      expect(result).toBe('my-agent');
    });

    it('should keep existing state when hook provides nothing useful', () => {
      const result = resolveAgentId(
        {},
        undefined,
        'previously-resolved',
      );
      expect(result).toBe('previously-resolved');
    });

    it('should return "unknown" as last resort', () => {
      const result = resolveAgentId({}, undefined, 'unknown');
      expect(result).toBe('unknown');
    });

    it('should skip hook agentId if it is "unknown"', () => {
      const result = resolveAgentId(
        { agentId: 'unknown', sessionKey: 'agent:real-agent:web:1' },
        undefined,
        'unknown',
      );
      expect(result).toBe('real-agent');
    });
  });
});

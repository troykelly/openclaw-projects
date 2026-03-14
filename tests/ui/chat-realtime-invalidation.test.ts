/**
 * @vitest-environment jsdom
 * Tests for chat realtime cache invalidation with namespace-prefixed keys (#2561).
 *
 * Verifies that useRealtimeChatInvalidation and useRealtimeAgentInvalidation
 * use namespace-aware predicate-based invalidation instead of bare key arrays.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { namespaceAwareInvalidation } from '@/ui/lib/namespace-invalidation';

// Track handlers registered via addEventHandler
type EventHandler = (event: { event: string; payload: unknown }) => void;
const registeredHandlers = new Map<string, EventHandler>();

vi.mock('@/ui/components/realtime/realtime-context', () => ({
  useRealtimeOptional: vi.fn(() => ({
    addEventHandler: vi.fn((eventType: string, handler: EventHandler) => {
      registeredHandlers.set(eventType, handler);
      return () => { registeredHandlers.delete(eventType); };
    }),
  })),
}));

import {
  useRealtimeChatInvalidation,
  useRealtimeAgentInvalidation,
} from '@/ui/hooks/queries/use-chat';

describe('useRealtimeChatInvalidation (#2561)', () => {
  let queryClient: QueryClient;
  let invalidateSpy: ReturnType<typeof vi.spyOn>;

  function createWrapper() {
    return function Wrapper({ children }: { children: React.ReactNode }) {
      return React.createElement(
        QueryClientProvider,
        { client: queryClient },
        children,
      );
    };
  }

  beforeEach(() => {
    registeredHandlers.clear();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);
  });

  afterEach(() => {
    queryClient.clear();
    vi.restoreAllMocks();
  });

  it('registers handlers for chat:message_received, chat:session_created, chat:session_ended', () => {
    renderHook(() => useRealtimeChatInvalidation(), { wrapper: createWrapper() });

    expect(registeredHandlers.has('chat:message_received')).toBe(true);
    expect(registeredHandlers.has('chat:session_created')).toBe(true);
    expect(registeredHandlers.has('chat:session_ended')).toBe(true);
  });

  it('uses predicate-based invalidation on chat:message_received (not bare key)', () => {
    renderHook(() => useRealtimeChatInvalidation(), { wrapper: createWrapper() });

    const handler = registeredHandlers.get('chat:message_received')!;
    handler({ event: 'chat:message_received', payload: { session_id: 'sess-1' } });

    // Should have called invalidateQueries with predicate (not bare queryKey)
    expect(invalidateSpy).toHaveBeenCalled();
    for (const call of invalidateSpy.mock.calls) {
      const filter = call[0];
      expect(filter).toHaveProperty('predicate');
      expect(filter).not.toHaveProperty('queryKey');
    }
  });

  it('invalidation predicate matches namespace-prefixed chat keys', () => {
    renderHook(() => useRealtimeChatInvalidation(), { wrapper: createWrapper() });

    const handler = registeredHandlers.get('chat:message_received')!;
    handler({ event: 'chat:message_received', payload: { session_id: 'sess-1' } });

    // At least one call should match namespace-prefixed unread count key
    const matchesNamespacedUnread = invalidateSpy.mock.calls.some((call) => {
      const predicate = call[0]?.predicate;
      if (!predicate) return false;
      return predicate({
        queryKey: [{ namespaces: ['personal'] }, 'chat', 'unread-count'],
      } as Parameters<typeof predicate>[0]);
    });
    expect(matchesNamespacedUnread).toBe(true);

    // At least one call should match namespace-prefixed sessions key
    const matchesNamespacedSessions = invalidateSpy.mock.calls.some((call) => {
      const predicate = call[0]?.predicate;
      if (!predicate) return false;
      return predicate({
        queryKey: [{ namespaces: ['personal'] }, 'chat', 'sessions'],
      } as Parameters<typeof predicate>[0]);
    });
    expect(matchesNamespacedSessions).toBe(true);

    // Should also match namespace-prefixed messages for the session
    const matchesNamespacedMessages = invalidateSpy.mock.calls.some((call) => {
      const predicate = call[0]?.predicate;
      if (!predicate) return false;
      return predicate({
        queryKey: [{ namespaces: ['personal'] }, 'chat', 'messages', 'sess-1'],
      } as Parameters<typeof predicate>[0]);
    });
    expect(matchesNamespacedMessages).toBe(true);
  });

  it('uses predicate-based invalidation on chat:session_created', () => {
    renderHook(() => useRealtimeChatInvalidation(), { wrapper: createWrapper() });

    const handler = registeredHandlers.get('chat:session_created')!;
    handler({ event: 'chat:session_created', payload: {} });

    expect(invalidateSpy).toHaveBeenCalled();
    for (const call of invalidateSpy.mock.calls) {
      const filter = call[0];
      expect(filter).toHaveProperty('predicate');
      expect(filter).not.toHaveProperty('queryKey');
    }
  });

  it('uses predicate-based invalidation on chat:session_ended', () => {
    renderHook(() => useRealtimeChatInvalidation(), { wrapper: createWrapper() });

    const handler = registeredHandlers.get('chat:session_ended')!;
    handler({ event: 'chat:session_ended', payload: {} });

    expect(invalidateSpy).toHaveBeenCalled();
    for (const call of invalidateSpy.mock.calls) {
      const filter = call[0];
      expect(filter).toHaveProperty('predicate');
      expect(filter).not.toHaveProperty('queryKey');
    }
  });
});

describe('useRealtimeAgentInvalidation (#2561)', () => {
  let queryClient: QueryClient;
  let invalidateSpy: ReturnType<typeof vi.spyOn>;

  function createWrapper() {
    return function Wrapper({ children }: { children: React.ReactNode }) {
      return React.createElement(
        QueryClientProvider,
        { client: queryClient },
        children,
      );
    };
  }

  beforeEach(() => {
    registeredHandlers.clear();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);
  });

  afterEach(() => {
    queryClient.clear();
    vi.restoreAllMocks();
  });

  it('uses predicate-based invalidation on agent:status_changed', () => {
    renderHook(() => useRealtimeAgentInvalidation(), { wrapper: createWrapper() });

    const handler = registeredHandlers.get('agent:status_changed')!;
    handler({ event: 'agent:status_changed', payload: {} });

    expect(invalidateSpy).toHaveBeenCalled();
    for (const call of invalidateSpy.mock.calls) {
      const filter = call[0];
      expect(filter).toHaveProperty('predicate');
      expect(filter).not.toHaveProperty('queryKey');
    }
  });

  it('invalidation predicate matches namespace-prefixed agent keys', () => {
    renderHook(() => useRealtimeAgentInvalidation(), { wrapper: createWrapper() });

    const handler = registeredHandlers.get('agent:status_changed')!;
    handler({ event: 'agent:status_changed', payload: {} });

    const matchesNamespacedAgents = invalidateSpy.mock.calls.some((call) => {
      const predicate = call[0]?.predicate;
      if (!predicate) return false;
      return predicate({
        queryKey: [{ namespaces: ['personal'] }, 'chat', 'agents'],
      } as Parameters<typeof predicate>[0]);
    });
    expect(matchesNamespacedAgents).toBe(true);
  });
});

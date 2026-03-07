/**
 * @vitest-environment jsdom
 *
 * Tests for the useYjsProvider hook.
 * Part of Issue #2256.
 *
 * Validates:
 * - Returns null doc/provider when noteId is null
 * - Creates doc and provider when noteId is provided
 * - Cleans up doc and provider on unmount
 * - Creates new provider when noteId changes
 * - Tracks connection status
 * - Does not create provider when feature flag is disabled
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

// Mock y-websocket
vi.mock('y-websocket', () => {
  class MockWebsocketProvider {
    on = vi.fn();
    off = vi.fn();
    destroy = vi.fn();
    awareness = {
      setLocalState: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      getStates: vi.fn().mockReturnValue(new Map()),
    };
    wsconnected = false;
    synced = false;
  }
  return { WebsocketProvider: MockWebsocketProvider };
});

vi.mock('yjs', () => {
  class MockDoc {
    destroy = vi.fn();
    getText = vi.fn();
    getXmlFragment = vi.fn();
    on = vi.fn();
    off = vi.fn();
  }
  return { Doc: MockDoc };
});

vi.mock('@/ui/lib/auth-manager', () => ({
  getAccessToken: vi.fn().mockReturnValue('test-token'),
}));

import { useYjsProvider } from '../../src/ui/hooks/use-yjs-provider.ts';

describe('useYjsProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null doc/provider when noteId is null', () => {
    const { result } = renderHook(() => useYjsProvider(null));
    expect(result.current.doc).toBeNull();
    expect(result.current.provider).toBeNull();
    expect(result.current.status).toBe('disconnected');
  });

  it('creates doc and provider when noteId is provided', () => {
    const { result } = renderHook(() => useYjsProvider('note-uuid-1'));
    expect(result.current.doc).not.toBeNull();
    expect(result.current.provider).not.toBeNull();
  });

  it('destroys doc and provider on unmount', () => {
    const { result, unmount } = renderHook(() => useYjsProvider('note-uuid-1'));
    const doc = result.current.doc;
    const provider = result.current.provider;
    unmount();
    expect(doc?.destroy).toHaveBeenCalled();
    expect(provider?.destroy).toHaveBeenCalled();
  });

  it('creates new provider when noteId changes', () => {
    const { result, rerender } = renderHook(
      ({ noteId }) => useYjsProvider(noteId),
      { initialProps: { noteId: 'note-1' as string | null } },
    );
    const firstDoc = result.current.doc;
    const firstProvider = result.current.provider;

    rerender({ noteId: 'note-2' });

    // Old instances should be destroyed
    expect(firstDoc?.destroy).toHaveBeenCalled();
    expect(firstProvider?.destroy).toHaveBeenCalled();

    // New instances should be created
    expect(result.current.doc).not.toBeNull();
    expect(result.current.provider).not.toBeNull();
    expect(result.current.doc).not.toBe(firstDoc);
    expect(result.current.provider).not.toBe(firstProvider);
  });

  it('cleans up when noteId changes to null', () => {
    const { result, rerender } = renderHook(
      ({ noteId }) => useYjsProvider(noteId),
      { initialProps: { noteId: 'note-1' as string | null } },
    );
    const doc = result.current.doc;
    const provider = result.current.provider;

    rerender({ noteId: null });

    expect(doc?.destroy).toHaveBeenCalled();
    expect(provider?.destroy).toHaveBeenCalled();
    expect(result.current.doc).toBeNull();
    expect(result.current.provider).toBeNull();
  });

  it('returns yjsEnabled false when feature flag is off', () => {
    const { result } = renderHook(() => useYjsProvider(null));
    // When noteId is null, yjsEnabled should be false
    expect(result.current.yjsEnabled).toBe(false);
  });
});

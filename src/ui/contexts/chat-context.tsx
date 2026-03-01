/**
 * Chat context for managing chat panel state (Epic #1940, Issue #1947).
 *
 * Manages active session ID, panel open/closed state, unread count,
 * draft text per session (sessionStorage), and deep link handling
 * via ?chat= query parameter.
 *
 * Follows the patterns established by NamespaceContext and UserContext.
 */

import * as React from 'react';
import { useSearchParams } from 'react-router';

const DRAFT_STORAGE_PREFIX = 'openclaw-chat-draft-';

interface ChatContextValue {
  /** The currently active (selected) chat session ID, or null. */
  activeSessionId: string | null;
  /** Set the active session ID. */
  setActiveSessionId: (id: string | null) => void;
  /** Whether the chat panel is open. */
  isPanelOpen: boolean;
  /** Open the chat panel. */
  openPanel: () => void;
  /** Close the chat panel. */
  closePanel: () => void;
  /** Toggle the chat panel. */
  togglePanel: () => void;
  /** Get draft text for a session from sessionStorage. */
  getDraft: (sessionId: string) => string;
  /** Set draft text for a session in sessionStorage. */
  setDraft: (sessionId: string, text: string) => void;
  /** Clear draft text for a session. */
  clearDraft: (sessionId: string) => void;
}

const ChatContext = React.createContext<ChatContextValue | null>(null);

export function ChatProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeSessionId, setActiveSessionIdState] = React.useState<string | null>(null);
  const [isPanelOpen, setIsPanelOpen] = React.useState(false);

  // Handle deep link: ?chat=<session_id>
  React.useEffect(() => {
    const chatParam = searchParams.get('chat');
    if (chatParam) {
      setActiveSessionIdState(chatParam);
      setIsPanelOpen(true);
      // Remove the query param after consuming it
      const next = new URLSearchParams(searchParams);
      next.delete('chat');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const setActiveSessionId = React.useCallback((id: string | null) => {
    setActiveSessionIdState(id);
  }, []);

  const openPanel = React.useCallback(() => {
    setIsPanelOpen(true);
  }, []);

  const closePanel = React.useCallback(() => {
    setIsPanelOpen(false);
  }, []);

  const togglePanel = React.useCallback(() => {
    setIsPanelOpen((prev) => !prev);
  }, []);

  const getDraft = React.useCallback((sessionId: string): string => {
    try {
      return sessionStorage.getItem(`${DRAFT_STORAGE_PREFIX}${sessionId}`) ?? '';
    } catch {
      return '';
    }
  }, []);

  const setDraft = React.useCallback((sessionId: string, text: string) => {
    try {
      if (text) {
        sessionStorage.setItem(`${DRAFT_STORAGE_PREFIX}${sessionId}`, text);
      } else {
        sessionStorage.removeItem(`${DRAFT_STORAGE_PREFIX}${sessionId}`);
      }
    } catch {
      // sessionStorage may be unavailable
    }
  }, []);

  const clearDraft = React.useCallback((sessionId: string) => {
    try {
      sessionStorage.removeItem(`${DRAFT_STORAGE_PREFIX}${sessionId}`);
    } catch {
      // sessionStorage may be unavailable
    }
  }, []);

  const value = React.useMemo<ChatContextValue>(
    () => ({
      activeSessionId,
      setActiveSessionId,
      isPanelOpen,
      openPanel,
      closePanel,
      togglePanel,
      getDraft,
      setDraft,
      clearDraft,
    }),
    [activeSessionId, setActiveSessionId, isPanelOpen, openPanel, closePanel, togglePanel, getDraft, setDraft, clearDraft],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

/**
 * Hook to access the chat context.
 *
 * @throws Error if used outside ChatProvider
 */
export function useChat(): ChatContextValue {
  const context = React.useContext(ChatContext);
  if (!context) {
    throw new Error('useChat must be used within a ChatProvider');
  }
  return context;
}

/**
 * Hook to access chat context without throwing if outside provider.
 * Returns null when no ChatProvider is present (safe for test environments).
 */
export function useChatSafe(): ChatContextValue | null {
  return React.useContext(ChatContext);
}

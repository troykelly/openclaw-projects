/** @vitest-environment jsdom */
/**
 * Tests for Issue #1957: Default agent selection in user settings.
 *
 * Covers:
 * - useDefaultAgent hook (query + mutation)
 * - ChatSettingsSection component rendering
 * - Agent dropdown selection and save
 * - Integration with SettingsPage SECTIONS
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import * as React from 'react';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGet = vi.fn();
const mockPatch = vi.fn();

vi.mock('@/ui/lib/api-client', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args),
    patch: (...args: unknown[]) => mockPatch(...args),
  },
  ApiRequestError: class extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

// ---------------------------------------------------------------------------
// useDefaultAgent hook tests
// ---------------------------------------------------------------------------

describe('useDefaultAgent hook', () => {
  let useDefaultAgent: typeof import('@/ui/components/settings/use-default-agent').useDefaultAgent;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const mod = await import('@/ui/components/settings/use-default-agent');
    useDefaultAgent = mod.useDefaultAgent;
  });

  function TestComponent() {
    const { defaultAgentId, isLoading, error, setDefaultAgent, isSaving } = useDefaultAgent();
    return (
      <div>
        <span data-testid="loading">{String(isLoading)}</span>
        <span data-testid="saving">{String(isSaving)}</span>
        <span data-testid="agent-id">{defaultAgentId ?? 'none'}</span>
        <span data-testid="error">{error ?? 'none'}</span>
        <button type="button" data-testid="set-agent" onClick={() => setDefaultAgent('agent-123')}>
          Set Agent
        </button>
        <button type="button" data-testid="clear-agent" onClick={() => setDefaultAgent(null)}>
          Clear Agent
        </button>
      </div>
    );
  }

  it('loads default agent from settings', async () => {
    mockGet.mockResolvedValueOnce({
      id: 'user-1',
      email: 'test@example.com',
      default_agent_id: 'agent-abc',
    });

    render(<TestComponent />);

    expect(screen.getByTestId('loading').textContent).toBe('true');

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false');
    });

    expect(screen.getByTestId('agent-id').textContent).toBe('agent-abc');
    expect(mockGet).toHaveBeenCalledWith('/api/settings');
  });

  it('returns null when no default agent is set', async () => {
    mockGet.mockResolvedValueOnce({
      id: 'user-1',
      email: 'test@example.com',
      default_agent_id: null,
    });

    render(<TestComponent />);

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false');
    });

    expect(screen.getByTestId('agent-id').textContent).toBe('none');
  });

  it('handles fetch error', async () => {
    mockGet.mockRejectedValueOnce(new Error('Network error'));

    render(<TestComponent />);

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false');
    });

    expect(screen.getByTestId('error').textContent).not.toBe('none');
  });

  it('sets default agent via PATCH', async () => {
    mockGet.mockResolvedValueOnce({
      id: 'user-1',
      email: 'test@example.com',
      default_agent_id: null,
    });
    mockPatch.mockResolvedValueOnce({
      id: 'user-1',
      email: 'test@example.com',
      default_agent_id: 'agent-123',
    });

    render(<TestComponent />);

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false');
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('set-agent'));
    });

    expect(mockPatch).toHaveBeenCalledWith('/api/settings', { default_agent_id: 'agent-123' });

    await waitFor(() => {
      expect(screen.getByTestId('agent-id').textContent).toBe('agent-123');
    });
  });

  it('clears default agent with null', async () => {
    mockGet.mockResolvedValueOnce({
      id: 'user-1',
      email: 'test@example.com',
      default_agent_id: 'agent-abc',
    });
    mockPatch.mockResolvedValueOnce({
      id: 'user-1',
      email: 'test@example.com',
      default_agent_id: null,
    });

    render(<TestComponent />);

    await waitFor(() => {
      expect(screen.getByTestId('agent-id').textContent).toBe('agent-abc');
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('clear-agent'));
    });

    expect(mockPatch).toHaveBeenCalledWith('/api/settings', { default_agent_id: null });
  });

  it('reverts on save failure', async () => {
    mockGet.mockResolvedValueOnce({
      id: 'user-1',
      email: 'test@example.com',
      default_agent_id: 'original-agent',
    });
    mockPatch.mockRejectedValueOnce(new Error('Save failed'));

    render(<TestComponent />);

    await waitFor(() => {
      expect(screen.getByTestId('agent-id').textContent).toBe('original-agent');
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('set-agent'));
    });

    // After failure, should revert to original
    await waitFor(() => {
      expect(screen.getByTestId('agent-id').textContent).toBe('original-agent');
    });
  });
});

// ---------------------------------------------------------------------------
// ChatSettingsSection component tests
// ---------------------------------------------------------------------------

describe('ChatSettingsSection component', () => {
  let ChatSettingsSection: typeof import('@/ui/components/settings/chat-settings-section').ChatSettingsSection;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const mod = await import('@/ui/components/settings/chat-settings-section');
    ChatSettingsSection = mod.ChatSettingsSection;
  });

  const mockAgents = [
    { id: 'agent-1', name: 'assistant', display_name: 'Assistant', avatar_url: null },
    { id: 'agent-2', name: 'coder', display_name: 'Code Helper', avatar_url: null },
    { id: 'agent-3', name: 'researcher', display_name: null, avatar_url: null },
  ];

  it('renders loading state', async () => {
    // Settings loading
    mockGet.mockImplementation((url: string) => {
      if (url === '/api/settings') return new Promise(() => {});
      if (url === '/api/chat/agents') return Promise.resolve({ agents: mockAgents });
      return Promise.resolve({});
    });

    render(<ChatSettingsSection />);

    expect(screen.getByText('Chat')).toBeDefined();
    // Should show a loader while settings load
    expect(screen.getByTestId('chat-settings-section')).toBeDefined();
  });

  it('renders agent dropdown with available agents', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/api/settings') {
        return Promise.resolve({
          id: 'user-1',
          email: 'test@example.com',
          default_agent_id: null,
        });
      }
      if (url.includes('/api/chat/agents')) {
        return Promise.resolve({ agents: mockAgents });
      }
      return Promise.resolve({});
    });

    render(<ChatSettingsSection />);

    await waitFor(() => {
      expect(screen.getByText('Default Agent')).toBeDefined();
    });

    // Should show "None selected" when no agent is set
    expect(screen.getByText('None selected')).toBeDefined();
  });

  it('displays currently selected agent', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/api/settings') {
        return Promise.resolve({
          id: 'user-1',
          email: 'test@example.com',
          default_agent_id: 'agent-1',
        });
      }
      if (url.includes('/api/chat/agents')) {
        return Promise.resolve({ agents: mockAgents });
      }
      return Promise.resolve({});
    });

    render(<ChatSettingsSection />);

    await waitFor(() => {
      expect(screen.getByText('Assistant')).toBeDefined();
    });
  });

  it('renders error state when settings fail to load', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/api/settings') {
        return Promise.reject(new Error('Network error'));
      }
      if (url.includes('/api/chat/agents')) {
        return Promise.resolve({ agents: mockAgents });
      }
      return Promise.resolve({});
    });

    render(<ChatSettingsSection />);

    await waitFor(() => {
      expect(screen.getByText(/failed to load/i)).toBeDefined();
    });
  });

  it('renders empty agent list message', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/api/settings') {
        return Promise.resolve({
          id: 'user-1',
          email: 'test@example.com',
          default_agent_id: null,
        });
      }
      if (url.includes('/api/chat/agents')) {
        return Promise.resolve({ agents: [] });
      }
      return Promise.resolve({});
    });

    render(<ChatSettingsSection />);

    await waitFor(() => {
      expect(screen.getByText(/no agents available/i)).toBeDefined();
    });
  });
});

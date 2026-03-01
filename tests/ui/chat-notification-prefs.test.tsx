/** @vitest-environment jsdom */
/**
 * Tests for Issue #1958: Chat notification preferences in settings.
 *
 * Covers:
 * - useChatNotificationPrefs hook (GET/PATCH)
 * - ChatNotificationPrefsSection component
 * - Sound/auto-open/quiet hours toggles
 * - Per-urgency channel checkboxes
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
    post: vi.fn(),
    delete: vi.fn(),
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
// Default preferences fixture
// ---------------------------------------------------------------------------

const DEFAULT_PREFS = {
  sound_enabled: true,
  auto_open_on_message: true,
  quiet_hours: null,
  escalation: {
    low: ['in_app'],
    normal: ['in_app', 'push'],
    high: ['in_app', 'push', 'email'],
    urgent: ['in_app', 'push', 'sms', 'email'],
  },
};

// ---------------------------------------------------------------------------
// useChatNotificationPrefs hook tests
// ---------------------------------------------------------------------------

describe('useChatNotificationPrefs hook', () => {
  let useChatNotificationPrefs: typeof import('@/ui/components/settings/use-chat-notification-prefs').useChatNotificationPrefs;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const mod = await import('@/ui/components/settings/use-chat-notification-prefs');
    useChatNotificationPrefs = mod.useChatNotificationPrefs;
  });

  function TestComponent() {
    const { prefs, isLoading, error, updatePrefs, isSaving } = useChatNotificationPrefs();
    return (
      <div>
        <span data-testid="loading">{String(isLoading)}</span>
        <span data-testid="saving">{String(isSaving)}</span>
        <span data-testid="error">{error ?? 'none'}</span>
        <span data-testid="sound">{prefs ? String(prefs.sound_enabled) : 'null'}</span>
        <span data-testid="auto-open">{prefs ? String(prefs.auto_open_on_message) : 'null'}</span>
        <button
          type="button"
          data-testid="toggle-sound"
          onClick={() => prefs && updatePrefs({ sound_enabled: !prefs.sound_enabled })}
        >
          Toggle Sound
        </button>
      </div>
    );
  }

  it('loads preferences from API', async () => {
    mockGet.mockResolvedValueOnce(DEFAULT_PREFS);

    render(<TestComponent />);

    expect(screen.getByTestId('loading').textContent).toBe('true');

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false');
    });

    expect(screen.getByTestId('sound').textContent).toBe('true');
    expect(screen.getByTestId('auto-open').textContent).toBe('true');
    expect(mockGet).toHaveBeenCalledWith('/api/chat/preferences');
  });

  it('handles fetch error', async () => {
    mockGet.mockRejectedValueOnce(new Error('Network error'));

    render(<TestComponent />);

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false');
    });

    expect(screen.getByTestId('error').textContent).not.toBe('none');
  });

  it('updates preferences via PATCH', async () => {
    mockGet.mockResolvedValueOnce(DEFAULT_PREFS);
    mockPatch.mockResolvedValueOnce({ ...DEFAULT_PREFS, sound_enabled: false });

    render(<TestComponent />);

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false');
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('toggle-sound'));
    });

    expect(mockPatch).toHaveBeenCalledWith('/api/chat/preferences', {
      sound_enabled: false,
    });

    await waitFor(() => {
      expect(screen.getByTestId('sound').textContent).toBe('false');
    });
  });

  it('reverts on PATCH failure', async () => {
    mockGet.mockResolvedValueOnce(DEFAULT_PREFS);
    mockPatch.mockRejectedValueOnce(new Error('Save failed'));

    render(<TestComponent />);

    await waitFor(() => {
      expect(screen.getByTestId('sound').textContent).toBe('true');
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('toggle-sound'));
    });

    // Should revert to original
    await waitFor(() => {
      expect(screen.getByTestId('sound').textContent).toBe('true');
    });
  });
});

// ---------------------------------------------------------------------------
// ChatNotificationPrefsSection component tests
// ---------------------------------------------------------------------------

describe('ChatNotificationPrefsSection component', () => {
  let ChatNotificationPrefsSection: typeof import('@/ui/components/settings/chat-notification-prefs-section').ChatNotificationPrefsSection;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const mod = await import('@/ui/components/settings/chat-notification-prefs-section');
    ChatNotificationPrefsSection = mod.ChatNotificationPrefsSection;
  });

  it('renders loading state', () => {
    mockGet.mockImplementation(() => new Promise(() => {}));

    render(<ChatNotificationPrefsSection />);

    expect(screen.getByTestId('chat-notification-prefs-section')).toBeDefined();
    expect(screen.getByText('Chat Notifications')).toBeDefined();
  });

  it('renders sound and auto-open toggles', async () => {
    mockGet.mockResolvedValueOnce(DEFAULT_PREFS);

    render(<ChatNotificationPrefsSection />);

    await waitFor(() => {
      expect(screen.getByLabelText('Notification sounds')).toBeDefined();
    });

    expect(screen.getByLabelText('Auto-open chat panel')).toBeDefined();
  });

  it('renders per-urgency channel table', async () => {
    mockGet.mockResolvedValueOnce(DEFAULT_PREFS);

    render(<ChatNotificationPrefsSection />);

    await waitFor(() => {
      expect(screen.getByText('Low')).toBeDefined();
    });

    expect(screen.getByText('Normal')).toBeDefined();
    expect(screen.getByText('High')).toBeDefined();
    expect(screen.getByText('Urgent')).toBeDefined();
  });

  it('renders quiet hours section', async () => {
    mockGet.mockResolvedValueOnce({
      ...DEFAULT_PREFS,
      quiet_hours: { start: '22:00', end: '08:00', timezone: 'UTC' },
    });

    render(<ChatNotificationPrefsSection />);

    await waitFor(() => {
      expect(screen.getByText('Quiet Hours')).toBeDefined();
    });
  });

  it('renders error state', async () => {
    mockGet.mockRejectedValueOnce(new Error('Network error'));

    render(<ChatNotificationPrefsSection />);

    await waitFor(() => {
      expect(screen.getByText(/failed to load/i)).toBeDefined();
    });
  });

  it('handles empty/malformed preferences gracefully', async () => {
    mockGet.mockResolvedValueOnce({});

    render(<ChatNotificationPrefsSection />);

    await waitFor(() => {
      // Should render without crashing, using defaults
      expect(screen.getByTestId('chat-notification-prefs-section')).toBeDefined();
    });
  });
});

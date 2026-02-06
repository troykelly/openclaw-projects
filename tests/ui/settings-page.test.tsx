/**
 * @vitest-environment jsdom
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { SettingsPage } from '@/ui/components/settings/settings-page';
import type { UserSettings, EmbeddingSettings } from '@/ui/components/settings/types';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

const defaultSettings: UserSettings = {
  id: 'test-id',
  email: 'test@example.com',
  theme: 'system',
  default_view: 'activity',
  default_project_id: null,
  sidebar_collapsed: false,
  show_completed_items: true,
  items_per_page: 50,
  email_notifications: true,
  email_digest_frequency: 'daily',
  timezone: 'UTC',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const defaultEmbeddingSettings: EmbeddingSettings = {
  provider: {
    name: 'openai',
    model: 'text-embedding-3-large',
    dimensions: 3072,
    status: 'active',
    keySource: 'environment',
  },
  availableProviders: [
    { name: 'voyageai', configured: false, priority: 1 },
    { name: 'openai', configured: true, priority: 2 },
    { name: 'gemini', configured: false, priority: 3 },
  ],
  budget: {
    dailyLimitUsd: 10.0,
    monthlyLimitUsd: 100.0,
    todaySpendUsd: 1.5,
    monthSpendUsd: 15.0,
    pauseOnLimit: true,
  },
  usage: {
    today: { count: 50, tokens: 10000 },
    month: { count: 500, tokens: 100000 },
    total: { count: 2000, tokens: 400000 },
  },
};

function createMockFetch(userSettings = defaultSettings, embeddingSettings = defaultEmbeddingSettings) {
  return (url: string) => {
    if (url === '/api/settings') {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(userSettings),
      });
    }
    if (url === '/api/settings/embeddings') {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(embeddingSettings),
      });
    }
    return Promise.resolve({
      ok: false,
      status: 404,
    });
  };
}

/** Helper: wait for settings to load (heading appears). */
async function waitForLoaded() {
  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
  });
}

describe('SettingsPage', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    // Default successful fetch for both endpoints
    mockFetch.mockImplementation(createMockFetch());
  });

  describe('Loading state', () => {
    it('shows loading skeleton initially', () => {
      // User settings never resolves (loading state), but embedding settings resolves
      mockFetch.mockImplementation((url: string) => {
        if (url === '/api/settings') {
          return new Promise(() => {}); // Never resolves
        }
        if (url === '/api/settings/embeddings') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(defaultEmbeddingSettings),
          });
        }
        return Promise.resolve({ ok: false, status: 404 });
      });
      render(<SettingsPage />);

      // Loading state shows skeleton elements
      expect(screen.getAllByTestId('skeleton').length).toBeGreaterThan(0);
    });
  });

  describe('Error state', () => {
    it('shows error state on fetch failure', async () => {
      mockFetch.mockImplementation((url: string) => {
        if (url === '/api/settings') {
          return Promise.resolve({ ok: false, status: 500 });
        }
        if (url === '/api/settings/embeddings') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(defaultEmbeddingSettings),
          });
        }
        return Promise.resolve({ ok: false, status: 404 });
      });

      render(<SettingsPage />);

      await waitFor(() => {
        expect(screen.getByText(/error/i)).toBeInTheDocument();
      });
    });

    it('shows unauthorized message on 401', async () => {
      mockFetch.mockImplementation((url: string) => {
        if (url === '/api/settings') {
          return Promise.resolve({ ok: false, status: 401 });
        }
        if (url === '/api/settings/embeddings') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(defaultEmbeddingSettings),
          });
        }
        return Promise.resolve({ ok: false, status: 404 });
      });

      render(<SettingsPage />);

      await waitFor(() => {
        // Multiple elements contain "sign in", use getAllByText
        const signInElements = screen.getAllByText(/sign in/i);
        expect(signInElements.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Page structure', () => {
    it('renders page title', async () => {
      render(<SettingsPage />);

      await waitForLoaded();
    });

    it('organizes settings in cards', async () => {
      render(<SettingsPage />);

      await waitForLoaded();

      const cards = screen.getAllByTestId('settings-card');
      expect(cards.length).toBeGreaterThan(0);
    });

    it('renders sidebar navigation', async () => {
      render(<SettingsPage />);

      await waitForLoaded();

      const sidebar = screen.getByTestId('settings-sidebar');
      expect(sidebar).toBeInTheDocument();
    });

    it('renders all sidebar navigation items', async () => {
      render(<SettingsPage />);

      await waitForLoaded();

      expect(screen.getByTestId('settings-nav-profile')).toBeInTheDocument();
      expect(screen.getByTestId('settings-nav-appearance')).toBeInTheDocument();
      expect(screen.getByTestId('settings-nav-notifications')).toBeInTheDocument();
      expect(screen.getByTestId('settings-nav-shortcuts')).toBeInTheDocument();
      expect(screen.getByTestId('settings-nav-about')).toBeInTheDocument();
    });

    it('profile nav is active by default', async () => {
      render(<SettingsPage />);

      await waitForLoaded();

      const profileNav = screen.getByTestId('settings-nav-profile');
      expect(profileNav.className).toContain('text-primary');
    });
  });

  describe('Profile section', () => {
    it('displays user email', async () => {
      render(<SettingsPage />);

      await waitForLoaded();

      expect(screen.getByText('test@example.com')).toBeInTheDocument();
    });

    it('displays user ID', async () => {
      render(<SettingsPage />);

      await waitForLoaded();

      expect(screen.getByText(/ID: test-id/)).toBeInTheDocument();
    });

    it('displays initials from email', async () => {
      render(<SettingsPage />);

      await waitForLoaded();

      // "test@example.com" -> "test" -> ["test"] -> "T"
      // Use the avatar circle to scope the search since "T" also appears as a kbd key
      const avatarCircle = document.querySelector('.rounded-full.bg-primary\\/10');
      expect(avatarCircle).toBeTruthy();
      expect(avatarCircle!.textContent).toBe('T');
    });

    it('displays initials from compound email', async () => {
      mockFetch.mockImplementation(
        createMockFetch({ ...defaultSettings, email: 'john.doe@example.com' }),
      );

      render(<SettingsPage />);

      await waitForLoaded();

      // "john.doe" -> ["john", "doe"] -> "JD"
      expect(screen.getByText('JD')).toBeInTheDocument();
    });
  });

  describe('Theme settings', () => {
    it('displays theme section in appearance', async () => {
      render(<SettingsPage />);

      await waitForLoaded();

      expect(screen.getByText('Theme')).toBeInTheDocument();
    });

    it('shows all four theme options including OLED', async () => {
      render(<SettingsPage />);

      await waitForLoaded();

      expect(screen.getByLabelText('Light')).toBeInTheDocument();
      expect(screen.getByLabelText('Dark')).toBeInTheDocument();
      expect(screen.getByLabelText('OLED')).toBeInTheDocument();
      expect(screen.getByLabelText('System')).toBeInTheDocument();
    });

    it('renders theme option test ids', async () => {
      render(<SettingsPage />);

      await waitForLoaded();

      expect(screen.getByTestId('theme-option-light')).toBeInTheDocument();
      expect(screen.getByTestId('theme-option-dark')).toBeInTheDocument();
      expect(screen.getByTestId('theme-option-oled')).toBeInTheDocument();
      expect(screen.getByTestId('theme-option-system')).toBeInTheDocument();
    });

    it('shows OLED description text', async () => {
      render(<SettingsPage />);

      await waitForLoaded();

      expect(screen.getByText('True black')).toBeInTheDocument();
    });

    it('updates theme when selected', async () => {
      mockFetch.mockImplementation((url: string, options?: RequestInit) => {
        if (url === '/api/settings' && options?.method === 'PATCH') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ ...defaultSettings, theme: 'dark' }),
          });
        }
        if (url === '/api/settings') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(defaultSettings),
          });
        }
        if (url === '/api/settings/embeddings') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(defaultEmbeddingSettings),
          });
        }
        return Promise.resolve({ ok: false, status: 404 });
      });

      render(<SettingsPage />);

      await waitForLoaded();

      fireEvent.click(screen.getByLabelText('Dark'));

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith('/api/settings', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ theme: 'dark' }),
        });
      });
    });

    it('sends OLED theme update when selected', async () => {
      mockFetch.mockImplementation((url: string, options?: RequestInit) => {
        if (url === '/api/settings' && options?.method === 'PATCH') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ ...defaultSettings, theme: 'oled' }),
          });
        }
        if (url === '/api/settings') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(defaultSettings),
          });
        }
        if (url === '/api/settings/embeddings') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(defaultEmbeddingSettings),
          });
        }
        return Promise.resolve({ ok: false, status: 404 });
      });

      render(<SettingsPage />);

      await waitForLoaded();

      fireEvent.click(screen.getByLabelText('OLED'));

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith('/api/settings', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ theme: 'oled' }),
        });
      });
    });
  });

  describe('Default view settings', () => {
    it('displays default view section', async () => {
      render(<SettingsPage />);

      await waitForLoaded();

      expect(screen.getByText('Default View')).toBeInTheDocument();
    });

    it('shows all view options', async () => {
      render(<SettingsPage />);

      await waitForLoaded();

      // Check for select trigger or current value
      expect(screen.getByRole('combobox', { name: /default view/i })).toBeInTheDocument();
    });
  });

  describe('Display preferences', () => {
    it('displays sidebar collapsed toggle', async () => {
      render(<SettingsPage />);

      await waitForLoaded();

      expect(screen.getByText('Sidebar Collapsed')).toBeInTheDocument();
    });

    it('displays show completed items toggle', async () => {
      render(<SettingsPage />);

      await waitForLoaded();

      expect(screen.getByText('Show Completed Items')).toBeInTheDocument();
    });

    it('displays items per page setting', async () => {
      render(<SettingsPage />);

      await waitForLoaded();

      expect(screen.getByText('Items Per Page')).toBeInTheDocument();
    });

    it('toggles sidebar collapsed setting', async () => {
      mockFetch.mockImplementation((url: string, options?: RequestInit) => {
        if (url === '/api/settings' && options?.method === 'PATCH') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ ...defaultSettings, sidebar_collapsed: true }),
          });
        }
        if (url === '/api/settings') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(defaultSettings),
          });
        }
        if (url === '/api/settings/embeddings') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(defaultEmbeddingSettings),
          });
        }
        return Promise.resolve({ ok: false, status: 404 });
      });

      render(<SettingsPage />);

      await waitForLoaded();

      const toggle = screen.getByRole('switch', { name: /sidebar collapsed/i });
      fireEvent.click(toggle);

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith('/api/settings', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sidebar_collapsed: true }),
        });
      });
    });
  });

  describe('Timezone settings', () => {
    it('displays timezone section', async () => {
      render(<SettingsPage />);

      await waitForLoaded();

      expect(screen.getByText('Timezone')).toBeInTheDocument();
    });

    it('shows current timezone', async () => {
      render(<SettingsPage />);

      await waitForLoaded();

      expect(screen.getByText('UTC')).toBeInTheDocument();
    });
  });

  describe('Notification settings', () => {
    it('displays email notifications toggle', async () => {
      render(<SettingsPage />);

      await waitForLoaded();

      expect(screen.getByText('Email Notifications')).toBeInTheDocument();
    });

    it('displays digest frequency option', async () => {
      render(<SettingsPage />);

      await waitForLoaded();

      expect(screen.getByText('Email Digest')).toBeInTheDocument();
    });
  });

  describe('Keyboard Shortcuts section', () => {
    it('renders keyboard shortcuts heading', async () => {
      render(<SettingsPage />);

      await waitForLoaded();

      // Card title "Keyboard Shortcuts" (also in sidebar nav)
      const cards = screen.getAllByTestId('settings-card');
      const shortcutsCard = cards.find(
        (card) => within(card).queryByText('Keyboard Shortcuts') !== null
          && within(card).queryByText(/Speed up your workflow/) !== null,
      );
      expect(shortcutsCard).toBeTruthy();
    });

    it('shows shortcut groups', async () => {
      render(<SettingsPage />);

      await waitForLoaded();

      // Find the shortcuts card and search within it to avoid conflicts
      // with "Navigation" card title in Appearance section
      const cards = screen.getAllByTestId('settings-card');
      const shortcutsCard = cards.find(
        (card) => within(card).queryByText(/Speed up your workflow/) !== null,
      )!;
      expect(shortcutsCard).toBeTruthy();

      expect(within(shortcutsCard).getByText('Global')).toBeInTheDocument();
      expect(within(shortcutsCard).getByText('Navigation')).toBeInTheDocument();
      expect(within(shortcutsCard).getByText('Work Items')).toBeInTheDocument();
    });

    it('shows shortcut descriptions', async () => {
      render(<SettingsPage />);

      await waitForLoaded();

      expect(screen.getByText('Open command palette')).toBeInTheDocument();
      expect(screen.getByText('Go to Activity')).toBeInTheDocument();
      expect(screen.getByText('Quick add new item')).toBeInTheDocument();
    });

    it('renders keyboard key badges', async () => {
      render(<SettingsPage />);

      await waitForLoaded();

      // Check for kbd elements (keyboard key badges)
      const kbdElements = document.querySelectorAll('kbd');
      expect(kbdElements.length).toBeGreaterThan(0);
    });
  });

  describe('About section', () => {
    it('shows application name', async () => {
      render(<SettingsPage />);

      await waitForLoaded();

      expect(screen.getByText('OpenClaw Projects')).toBeInTheDocument();
    });

    it('shows version badge', async () => {
      render(<SettingsPage />);

      await waitForLoaded();

      expect(screen.getByText('1.0.0')).toBeInTheDocument();
    });

    it('shows license info', async () => {
      render(<SettingsPage />);

      await waitForLoaded();

      expect(screen.getByText('MIT')).toBeInTheDocument();
    });

    it('shows documentation link', async () => {
      render(<SettingsPage />);

      await waitForLoaded();

      const docsLink = screen.getByText('docs.openclaw.ai');
      expect(docsLink).toBeInTheDocument();
      expect(docsLink.closest('a')).toHaveAttribute('href', 'https://docs.openclaw.ai/');
    });

    it('shows OpenClaw integration description', async () => {
      render(<SettingsPage />);

      await waitForLoaded();

      expect(
        screen.getByText(/Built for integration with the OpenClaw AI agent gateway/),
      ).toBeInTheDocument();
    });
  });

  describe('Save confirmation', () => {
    it('shows save confirmation after successful update', async () => {
      mockFetch.mockImplementation((url: string, options?: RequestInit) => {
        if (url === '/api/settings' && options?.method === 'PATCH') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ ...defaultSettings, theme: 'dark' }),
          });
        }
        if (url === '/api/settings') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(defaultSettings),
          });
        }
        if (url === '/api/settings/embeddings') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(defaultEmbeddingSettings),
          });
        }
        return Promise.resolve({ ok: false, status: 404 });
      });

      render(<SettingsPage />);

      await waitForLoaded();

      fireEvent.click(screen.getByLabelText('Dark'));

      await waitFor(() => {
        const confirmation = screen.getByTestId('save-confirmation');
        // When visible, it should contain "Saved"
        expect(confirmation).toHaveTextContent('Saved');
      });
    });

    it('save confirmation element is always in DOM', async () => {
      render(<SettingsPage />);

      await waitForLoaded();

      // The SaveConfirmation component is always rendered, just hidden via CSS
      expect(screen.getByTestId('save-confirmation')).toBeInTheDocument();
    });
  });

  describe('Sidebar navigation interaction', () => {
    it('clicking a nav item updates active state', async () => {
      render(<SettingsPage />);

      await waitForLoaded();

      // Click on Notifications nav
      fireEvent.click(screen.getByTestId('settings-nav-notifications'));

      // Notifications nav should now be active
      const notificationsNav = screen.getByTestId('settings-nav-notifications');
      expect(notificationsNav.className).toContain('text-primary');

      // Profile nav should no longer be active
      const profileNav = screen.getByTestId('settings-nav-profile');
      expect(profileNav.className).not.toContain('text-primary');
    });

    it('clicking About nav updates active state', async () => {
      render(<SettingsPage />);

      await waitForLoaded();

      fireEvent.click(screen.getByTestId('settings-nav-about'));

      const aboutNav = screen.getByTestId('settings-nav-about');
      expect(aboutNav.className).toContain('text-primary');
    });
  });
});

describe('useSettings hook behavior', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockImplementation(createMockFetch());
  });

  it('fetches settings on mount', async () => {
    render(<SettingsPage />);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/settings');
    });
  });

  it('handles optimistic updates', async () => {
    mockFetch.mockImplementation((url: string, options?: RequestInit) => {
      if (url === '/api/settings' && options?.method === 'PATCH') {
        return new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                ok: true,
                json: () => Promise.resolve({ ...defaultSettings, theme: 'dark' }),
              }),
            100
          )
        );
      }
      if (url === '/api/settings') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(defaultSettings),
        });
      }
      if (url === '/api/settings/embeddings') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(defaultEmbeddingSettings),
        });
      }
      return Promise.resolve({ ok: false, status: 404 });
    });

    render(<SettingsPage />);

    await waitForLoaded();

    fireEvent.click(screen.getByLabelText('Dark'));

    // Should show updated value immediately (optimistic)
    await waitFor(() => {
      const darkRadio = screen.getByLabelText('Dark') as HTMLInputElement;
      expect(darkRadio.checked).toBe(true);
    });
  });
});

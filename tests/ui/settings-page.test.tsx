/**
 * @vitest-environment jsdom
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SettingsPage } from '@/ui/components/settings/settings-page';
import type { UserSettings } from '@/ui/components/settings/types';

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

describe('SettingsPage', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    // Default successful fetch
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(defaultSettings),
    });
  });

  describe('Loading state', () => {
    it('shows loading skeleton initially', () => {
      mockFetch.mockImplementation(() => new Promise(() => {})); // Never resolves
      render(<SettingsPage />);

      // Loading state shows skeleton elements
      expect(screen.getAllByTestId('skeleton').length).toBeGreaterThan(0);
    });
  });

  describe('Error state', () => {
    it('shows error state on fetch failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      render(<SettingsPage />);

      await waitFor(() => {
        expect(screen.getByText(/error/i)).toBeInTheDocument();
      });
    });

    it('shows unauthorized message on 401', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
      });

      render(<SettingsPage />);

      await waitFor(() => {
        // Multiple elements contain "sign in", use getAllByText
        const signInElements = screen.getAllByText(/sign in/i);
        expect(signInElements.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Theme settings', () => {
    it('displays current theme selection', async () => {
      render(<SettingsPage />);

      await waitFor(() => {
        expect(screen.getByText('Appearance')).toBeInTheDocument();
      });

      expect(screen.getByText('Theme')).toBeInTheDocument();
    });

    it('shows all theme options', async () => {
      render(<SettingsPage />);

      await waitFor(() => {
        expect(screen.getByText('Appearance')).toBeInTheDocument();
      });

      expect(screen.getByLabelText('Light')).toBeInTheDocument();
      expect(screen.getByLabelText('Dark')).toBeInTheDocument();
      expect(screen.getByLabelText('System')).toBeInTheDocument();
    });

    it('updates theme when selected', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(defaultSettings),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ ...defaultSettings, theme: 'dark' }),
        });

      render(<SettingsPage />);

      await waitFor(() => {
        expect(screen.getByText('Appearance')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByLabelText('Dark'));

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith('/api/settings', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ theme: 'dark' }),
        });
      });
    });
  });

  describe('Default view settings', () => {
    it('displays default view section', async () => {
      render(<SettingsPage />);

      await waitFor(() => {
        expect(screen.getByText('Default View')).toBeInTheDocument();
      });
    });

    it('shows all view options', async () => {
      render(<SettingsPage />);

      await waitFor(() => {
        expect(screen.getByText('Default View')).toBeInTheDocument();
      });

      // Check for select trigger or current value
      expect(screen.getByRole('combobox', { name: /default view/i })).toBeInTheDocument();
    });
  });

  describe('Display preferences', () => {
    it('displays sidebar collapsed toggle', async () => {
      render(<SettingsPage />);

      await waitFor(() => {
        expect(screen.getByText('Sidebar Collapsed')).toBeInTheDocument();
      });
    });

    it('displays show completed items toggle', async () => {
      render(<SettingsPage />);

      await waitFor(() => {
        expect(screen.getByText('Show Completed Items')).toBeInTheDocument();
      });
    });

    it('displays items per page setting', async () => {
      render(<SettingsPage />);

      await waitFor(() => {
        expect(screen.getByText('Items Per Page')).toBeInTheDocument();
      });
    });

    it('toggles sidebar collapsed setting', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(defaultSettings),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ ...defaultSettings, sidebar_collapsed: true }),
        });

      render(<SettingsPage />);

      await waitFor(() => {
        expect(screen.getByText('Sidebar Collapsed')).toBeInTheDocument();
      });

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

      await waitFor(() => {
        expect(screen.getByText('Timezone')).toBeInTheDocument();
      });
    });

    it('shows current timezone', async () => {
      render(<SettingsPage />);

      await waitFor(() => {
        expect(screen.getByText('UTC')).toBeInTheDocument();
      });
    });
  });

  describe('Notification settings', () => {
    it('displays email notifications toggle', async () => {
      render(<SettingsPage />);

      await waitFor(() => {
        expect(screen.getByText('Email Notifications')).toBeInTheDocument();
      });
    });

    it('displays digest frequency option', async () => {
      render(<SettingsPage />);

      await waitFor(() => {
        expect(screen.getByText('Email Digest')).toBeInTheDocument();
      });
    });
  });

  describe('Page structure', () => {
    it('renders page title', async () => {
      render(<SettingsPage />);

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
      });
    });

    it('organizes settings in cards', async () => {
      render(<SettingsPage />);

      await waitFor(() => {
        const cards = screen.getAllByTestId('settings-card');
        expect(cards.length).toBeGreaterThan(0);
      });
    });
  });
});

describe('useSettings hook behavior', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(defaultSettings),
    });
  });

  it('fetches settings on mount', async () => {
    render(<SettingsPage />);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/settings');
    });
  });

  it('handles optimistic updates', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(defaultSettings),
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve({
                  ok: true,
                  json: () => Promise.resolve({ ...defaultSettings, theme: 'dark' }),
                }),
              100
            )
          )
      );

    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText('Appearance')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('Dark'));

    // Should show updated value immediately (optimistic)
    await waitFor(() => {
      const darkRadio = screen.getByLabelText('Dark') as HTMLInputElement;
      expect(darkRadio.checked).toBe(true);
    });
  });
});

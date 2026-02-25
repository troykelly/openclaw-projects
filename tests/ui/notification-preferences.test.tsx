/**
 * @vitest-environment jsdom
 */
/**
 * Tests for the notification preferences section (#1729).
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// Mock apiClient to avoid real HTTP calls
vi.mock('@/ui/lib/api-client', () => ({
  apiClient: {
    get: vi.fn(),
    patch: vi.fn(),
  },
}));

import { NotificationPreferencesSection } from '@/ui/components/settings/notification-preferences-section';
import { apiClient } from '@/ui/lib/api-client';

const mockPreferences = {
  assigned: { in_app: true, email: true },
  mentioned: { in_app: true, email: false },
  status_change: { in_app: false, email: true },
  due_soon: { in_app: true, email: true },
};

describe('NotificationPreferencesSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders loading state initially', () => {
    vi.mocked(apiClient.get).mockReturnValue(new Promise(() => {})); // never resolves
    render(<NotificationPreferencesSection />);
    expect(screen.getByTestId('notification-preferences-section')).toBeInTheDocument();
    expect(screen.getByText('Notification Preferences')).toBeInTheDocument();
  });

  it('renders preferences table after loading', async () => {
    vi.mocked(apiClient.get).mockResolvedValue(mockPreferences);

    render(<NotificationPreferencesSection />);

    await waitFor(() => {
      expect(screen.getByTestId('notification-preferences-table')).toBeInTheDocument();
    });

    // Check that all notification types are rendered
    expect(screen.getByText('Assigned to you')).toBeInTheDocument();
    expect(screen.getByText('Mentioned')).toBeInTheDocument();
    expect(screen.getByText('Status changes')).toBeInTheDocument();
    expect(screen.getByText('Due soon reminders')).toBeInTheDocument();
  });

  it('renders error state on fetch failure', async () => {
    vi.mocked(apiClient.get).mockRejectedValue(new Error('Network error'));

    render(<NotificationPreferencesSection />);

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
  });

  it('renders each notification type row', async () => {
    vi.mocked(apiClient.get).mockResolvedValue(mockPreferences);

    render(<NotificationPreferencesSection />);

    await waitFor(() => {
      expect(screen.getByTestId('notification-pref-row-assigned')).toBeInTheDocument();
      expect(screen.getByTestId('notification-pref-row-mentioned')).toBeInTheDocument();
      expect(screen.getByTestId('notification-pref-row-status_change')).toBeInTheDocument();
      expect(screen.getByTestId('notification-pref-row-due_soon')).toBeInTheDocument();
    });
  });

  it('renders empty state when no types are configured', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({});

    render(<NotificationPreferencesSection />);

    await waitFor(() => {
      expect(screen.getByText('No notification types configured.')).toBeInTheDocument();
    });
  });
});

/**
 * @vitest-environment jsdom
 */
/**
 * Tests for the webhook management section (#1733, #1832).
 *
 * After #1832, the settings-page webhook section only shows global status
 * (from /api/webhooks/status). Project-scoped webhook CRUD is on project pages.
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// Mock apiClient
vi.mock('@/ui/lib/api-client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

import { WebhookManagementSection } from '@/ui/components/settings/webhook-management-section';
import { apiClient } from '@/ui/lib/api-client';

const mockStatus = {
  total: 2,
  active: 1,
  pending_deliveries: 3,
  failed_deliveries: 1,
};

describe('WebhookManagementSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders loading state initially', () => {
    vi.mocked(apiClient.get).mockReturnValue(new Promise(() => {}));
    render(<WebhookManagementSection />);
    expect(screen.getByTestId('webhook-management-section')).toBeInTheDocument();
    expect(screen.getByText('Webhooks')).toBeInTheDocument();
  });

  it('renders status overview after loading', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce(mockStatus);

    render(<WebhookManagementSection />);

    await waitFor(() => {
      expect(screen.getByText('2')).toBeInTheDocument(); // Total
      expect(screen.getByText('Total')).toBeInTheDocument();
    });
  });

  it('shows retry button when failed deliveries exist', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce(mockStatus);

    render(<WebhookManagementSection />);

    await waitFor(() => {
      expect(screen.getByTestId('webhook-retry-btn')).toBeInTheDocument();
    });
  });

  it('does not show retry button when no failed deliveries', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({
      ...mockStatus,
      failed_deliveries: 0,
    });

    render(<WebhookManagementSection />);

    await waitFor(() => {
      expect(screen.getByText('Total')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('webhook-retry-btn')).not.toBeInTheDocument();
  });

  it('renders error state on failure', async () => {
    vi.mocked(apiClient.get).mockRejectedValue(new Error('Connection refused'));

    render(<WebhookManagementSection />);

    await waitFor(() => {
      expect(screen.getByTestId('webhook-error')).toBeInTheDocument();
      expect(screen.getByText('Connection refused')).toBeInTheDocument();
    });
  });

  it('does not call project-scoped endpoints with "default"', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce(mockStatus);

    render(<WebhookManagementSection />);

    await waitFor(() => {
      expect(screen.getByText('Total')).toBeInTheDocument();
    });

    // Verify only the global status endpoint was called, not project-scoped ones
    const calls = vi.mocked(apiClient.get).mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe('/api/webhooks/status');
    // Ensure no calls to /api/projects/default/*
    for (const call of calls) {
      expect(call[0]).not.toContain('/projects/default');
    }
  });

  it('shows empty message when status is null and no error', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({});

    render(<WebhookManagementSection />);

    await waitFor(() => {
      expect(screen.getByText('No webhooks configured.')).toBeInTheDocument();
    });
  });
});

/**
 * @vitest-environment jsdom
 */
/**
 * Tests for the webhook management section (#1733).
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

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

const mockWebhooks = {
  webhooks: [
    { id: 'wh-1', url: 'https://example.com/hook1', events: ['*'], is_active: true, created_at: '2026-02-01T00:00:00Z' },
    { id: 'wh-2', url: 'https://example.com/hook2', events: ['task.created'], is_active: false, created_at: '2026-02-10T00:00:00Z' },
  ],
};

const mockDeliveries = {
  events: [
    { id: 'd-1', webhook_id: 'wh-1', event_type: 'task.created', status: 'success', response_code: 200, attempted_at: '2026-02-20T10:00:00Z' },
    { id: 'd-2', webhook_id: 'wh-1', event_type: 'task.updated', status: 'failed', response_code: 500, attempted_at: '2026-02-20T11:00:00Z', error_message: 'Server error' },
  ],
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

  it('renders webhook list after loading', async () => {
    vi.mocked(apiClient.get)
      .mockResolvedValueOnce(mockStatus)
      .mockResolvedValueOnce(mockWebhooks)
      .mockResolvedValueOnce(mockDeliveries);

    render(<WebhookManagementSection />);

    await waitFor(() => {
      const items = screen.getAllByTestId('webhook-item');
      expect(items).toHaveLength(2);
    });

    expect(screen.getByText('https://example.com/hook1')).toBeInTheDocument();
    expect(screen.getByText('https://example.com/hook2')).toBeInTheDocument();
  });

  it('renders status overview cards', async () => {
    vi.mocked(apiClient.get)
      .mockResolvedValueOnce(mockStatus)
      .mockResolvedValueOnce(mockWebhooks)
      .mockResolvedValueOnce(mockDeliveries);

    render(<WebhookManagementSection />);

    await waitFor(() => {
      expect(screen.getByText('2')).toBeInTheDocument(); // Total
      expect(screen.getByText('Total')).toBeInTheDocument();
    });
  });

  it('renders delivery log', async () => {
    vi.mocked(apiClient.get)
      .mockResolvedValueOnce(mockStatus)
      .mockResolvedValueOnce(mockWebhooks)
      .mockResolvedValueOnce(mockDeliveries);

    render(<WebhookManagementSection />);

    await waitFor(() => {
      const deliveryItems = screen.getAllByTestId('delivery-item');
      expect(deliveryItems).toHaveLength(2);
    });
  });

  it('shows add webhook form when button is clicked', async () => {
    vi.mocked(apiClient.get)
      .mockResolvedValueOnce(mockStatus)
      .mockResolvedValueOnce(mockWebhooks)
      .mockResolvedValueOnce(mockDeliveries);

    render(<WebhookManagementSection />);

    await waitFor(() => {
      expect(screen.getByTestId('webhook-add-btn')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('webhook-add-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('webhook-create-form')).toBeInTheDocument();
      expect(screen.getByTestId('webhook-url-input')).toBeInTheDocument();
    });
  });

  it('shows retry button when failed deliveries exist', async () => {
    vi.mocked(apiClient.get)
      .mockResolvedValueOnce(mockStatus)
      .mockResolvedValueOnce(mockWebhooks)
      .mockResolvedValueOnce(mockDeliveries);

    render(<WebhookManagementSection />);

    await waitFor(() => {
      expect(screen.getByTestId('webhook-retry-btn')).toBeInTheDocument();
    });
  });

  it('renders error state on failure', async () => {
    vi.mocked(apiClient.get).mockRejectedValue(new Error('Connection refused'));

    render(<WebhookManagementSection />);

    await waitFor(() => {
      expect(screen.getByTestId('webhook-error')).toBeInTheDocument();
      expect(screen.getByText('Connection refused')).toBeInTheDocument();
    });
  });
});

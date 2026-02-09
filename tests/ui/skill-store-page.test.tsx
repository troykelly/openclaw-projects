/**
 * @vitest-environment jsdom
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/** Click a Radix UI trigger with full pointer event sequence and act wrapping. */
function clickRadixTrigger(element: HTMLElement) {
  act(() => {
    fireEvent.pointerDown(element, { button: 0, pointerId: 1 });
    fireEvent.mouseDown(element, { button: 0 });
    fireEvent.pointerUp(element, { button: 0, pointerId: 1 });
    fireEvent.mouseUp(element, { button: 0 });
    fireEvent.click(element, { button: 0 });
  });
}

// ---------------------------------------------------------------------------
// Mock API hooks
// ---------------------------------------------------------------------------

const mockSkills = {
  skills: [{ skill_id: 'test-skill', item_count: 10, collection_count: 2, last_activity: new Date().toISOString() }],
};

const mockCollections = {
  collections: [
    { collection: 'notes', count: 5, latest_at: new Date().toISOString() },
    { collection: 'tasks', count: 3, latest_at: new Date().toISOString() },
  ],
};

const mockItems = {
  items: [
    {
      id: 'item-1',
      skill_id: 'test-skill',
      collection: 'notes',
      key: 'note-1',
      title: 'Test Note',
      summary: 'A test note summary',
      content: 'Content here',
      data: null,
      tags: ['tag1'],
      status: 'active',
      priority: 0,
      pinned: false,
      media_url: null,
      media_type: null,
      source_url: null,
      user_email: null,
      created_by: null,
      embedding_status: null,
      expires_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ],
  total: 1,
  has_more: false,
};

const mockSchedules = {
  schedules: [
    {
      id: 'sched-1',
      skill_id: 'test-skill',
      collection: null,
      cron_expression: '*/5 * * * *',
      timezone: 'UTC',
      webhook_url: 'https://example.com/hook',
      webhook_headers: {
        Authorization: 'Bearer secret-token-123',
        'Content-Type': 'application/json',
        'X-Api-Key': 'sk-my-secret-key',
      },
      payload_template: {},
      enabled: true,
      max_retries: 5,
      last_run_status: 'success',
      last_run_at: new Date().toISOString(),
      next_run_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ],
};

const mockDeleteMutateAsync = vi.fn().mockResolvedValue({});
const mockTriggerMutateAsync = vi.fn().mockResolvedValue({});
const mockPauseMutateAsync = vi.fn().mockResolvedValue({});
const mockResumeMutateAsync = vi.fn().mockResolvedValue({});
const mockSearchMutate = vi.fn();

vi.mock('@/ui/hooks/queries/use-skill-store', () => ({
  useSkillStoreSkills: () => ({
    data: mockSkills,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useSkillStoreCollections: () => ({
    data: mockCollections,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useSkillStoreItems: () => ({
    data: mockItems,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useSkillStoreSchedules: () => ({
    data: mockSchedules,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useDeleteSkillStoreItem: () => ({
    mutateAsync: mockDeleteMutateAsync,
    isPending: false,
  }),
  useTriggerSchedule: () => ({
    mutateAsync: mockTriggerMutateAsync,
    isPending: false,
  }),
  usePauseSchedule: () => ({
    mutateAsync: mockPauseMutateAsync,
    isPending: false,
  }),
  useResumeSchedule: () => ({
    mutateAsync: mockResumeMutateAsync,
    isPending: false,
  }),
  useSkillStoreSearch: () => ({
    mutate: mockSearchMutate,
    data: null,
    isPending: false,
  }),
}));

// ---------------------------------------------------------------------------
// Import component after mocks
// ---------------------------------------------------------------------------

import { SkillStorePage } from '@/ui/pages/SkillStorePage';

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  let result: ReturnType<typeof render>;
  act(() => {
    result = render(
      <QueryClientProvider client={queryClient}>
        <SkillStorePage />
      </QueryClientProvider>,
    );
  });
  return result!;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SkillStorePage — Issue #828 fixes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // 1. Webhook header redaction
  // =========================================================================
  describe('webhook header redaction', () => {
    it('masks sensitive header values by default', () => {
      renderPage();

      // Switch to schedules tab
      clickRadixTrigger(screen.getByTestId('tab-schedules'));

      // Expand the schedule to show details
      const scheduleCard = screen.getByTestId('schedule-card');
      fireEvent.click(within(scheduleCard).getByRole('button', { name: /expand schedule details/i }));

      // Authorization value should be masked
      expect(screen.queryByText('Bearer secret-token-123')).not.toBeInTheDocument();
      expect(screen.queryByText('sk-my-secret-key')).not.toBeInTheDocument();
      // Mask character should be displayed
      expect(screen.getAllByText('••••••••').length).toBeGreaterThanOrEqual(2);
      // Non-sensitive header value should be visible
      expect(screen.getByText('application/json')).toBeInTheDocument();
    });

    it('reveals sensitive values when show button is clicked', () => {
      renderPage();

      // Switch to schedules tab
      clickRadixTrigger(screen.getByTestId('tab-schedules'));

      // Expand schedule
      const scheduleCard = screen.getByTestId('schedule-card');
      fireEvent.click(within(scheduleCard).getByRole('button', { name: /expand schedule details/i }));

      // Click the reveal button
      fireEvent.click(screen.getByLabelText('Reveal sensitive header values'));

      // Now values should be visible
      expect(screen.getByText('Bearer secret-token-123')).toBeInTheDocument();
      expect(screen.getByText('sk-my-secret-key')).toBeInTheDocument();
    });
  });

  // =========================================================================
  // 2. Controlled Tabs (no DOM manipulation)
  // =========================================================================
  describe('controlled Tabs', () => {
    it('switches to items tab when clicking a collection', () => {
      renderPage();

      // Switch to collections tab
      clickRadixTrigger(screen.getByTestId('tab-collections'));
      expect(screen.getByTestId('collections-grid')).toBeInTheDocument();

      // Click a collection card
      const collectionCards = screen.getAllByTestId('collection-card');
      fireEvent.click(collectionCards[0]);

      // Should switch back to items tab (tab value = "items")
      expect(screen.getByTestId('tab-items').getAttribute('aria-selected')).toBe('true');
    });
  });

  // =========================================================================
  // 3. Accessibility (ARIA labels)
  // =========================================================================
  describe('accessibility', () => {
    it('item cards have role=button and aria-label', () => {
      renderPage();

      const itemCard = screen.getByTestId('skill-store-item-card');
      expect(itemCard).toHaveAttribute('role', 'button');
      expect(itemCard).toHaveAttribute('aria-label', 'View item: Test Note');
      expect(itemCard).toHaveAttribute('tabindex', '0');
    });

    it('item cards respond to Enter key', () => {
      renderPage();

      const itemCard = screen.getByTestId('skill-store-item-card');
      fireEvent.keyDown(itemCard, { key: 'Enter' });

      // Should open detail dialog
      expect(screen.getByTestId('item-detail-dialog')).toBeInTheDocument();
    });

    it('collection cards have role=button and aria-label', () => {
      renderPage();

      // Switch to collections tab
      clickRadixTrigger(screen.getByTestId('tab-collections'));

      const collectionCards = screen.getAllByTestId('collection-card');
      expect(collectionCards[0]).toHaveAttribute('role', 'button');
      expect(collectionCards[0]).toHaveAttribute('aria-label', 'View collection: notes (5 items)');
      expect(collectionCards[0]).toHaveAttribute('tabindex', '0');
    });

    it('schedule expand/collapse has aria-expanded', () => {
      renderPage();

      // Switch to schedules tab
      clickRadixTrigger(screen.getByTestId('tab-schedules'));

      const scheduleCard = screen.getByTestId('schedule-card');
      // Target the chevron button specifically (not the clickable div)
      const expandButton = within(scheduleCard).getByRole('button', { name: /expand schedule details/i });
      expect(expandButton).toHaveAttribute('aria-expanded', 'false');

      fireEvent.click(expandButton);
      expect(expandButton).toHaveAttribute('aria-expanded', 'true');
    });
  });

  // =========================================================================
  // 5. Mutation error feedback
  // =========================================================================
  describe('mutation error feedback', () => {
    it('shows error banner when delete fails', async () => {
      mockDeleteMutateAsync.mockRejectedValueOnce(new Error('Network error'));
      renderPage();

      // Click delete on the item
      const deleteButton = screen.getByTestId('item-delete-button');
      fireEvent.click(deleteButton);

      // Confirm delete
      const confirmButton = screen.getByTestId('confirm-delete-button');
      fireEvent.click(confirmButton);

      // Wait for the error banner to appear
      const banner = await screen.findByTestId('mutation-error-banner');
      expect(banner).toHaveTextContent('Failed to delete item: Network error');
    });

    it('error banner is dismissible', async () => {
      mockDeleteMutateAsync.mockRejectedValueOnce(new Error('Oops'));
      renderPage();

      // Trigger a delete failure
      fireEvent.click(screen.getByTestId('item-delete-button'));
      fireEvent.click(screen.getByTestId('confirm-delete-button'));

      const banner = await screen.findByTestId('mutation-error-banner');
      expect(banner).toBeInTheDocument();

      // Dismiss the error
      fireEvent.click(within(banner).getByLabelText('Dismiss error'));
      expect(screen.queryByTestId('mutation-error-banner')).not.toBeInTheDocument();
    });

    it('error banner has role=alert for screen readers', async () => {
      mockDeleteMutateAsync.mockRejectedValueOnce(new Error('Test'));
      renderPage();

      fireEvent.click(screen.getByTestId('item-delete-button'));
      fireEvent.click(screen.getByTestId('confirm-delete-button'));

      const banner = await screen.findByTestId('mutation-error-banner');
      expect(banner).toHaveAttribute('role', 'alert');
    });
  });

  // =========================================================================
  // 7. Type assertions removed
  // =========================================================================
  describe('type safety', () => {
    it('renders without type assertion errors', () => {
      // If the component renders without errors, the type assertions are working
      const { container } = renderPage();
      expect(container.querySelector('[data-testid="page-skill-store"]')).toBeInTheDocument();
    });
  });
});

/**
 * @vitest-environment jsdom
 */
/**
 * Tests for the NotificationBell component (#1727).
 *
 * Verifies: unread badge rendering, dropdown open/close, mark-read,
 * mark-all-read, dismiss, and empty state.
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock the query hooks
vi.mock('@/ui/hooks/queries/use-notifications', () => ({
  notificationKeys: {
    all: ['notifications'],
    list: () => ['notifications', 'list'],
    unread_count: () => ['notifications', 'unread-count'],
  },
  useNotifications: vi.fn(),
  useUnreadNotificationCount: vi.fn(),
}));

// Mock the mutation hooks
vi.mock('@/ui/hooks/mutations/use-notifications', () => ({
  useMarkNotificationRead: vi.fn(),
  useMarkAllNotificationsRead: vi.fn(),
  useDismissNotification: vi.fn(),
}));

import { NotificationBell } from '@/ui/components/notifications/notification-bell';
import { useNotifications, useUnreadNotificationCount } from '@/ui/hooks/queries/use-notifications';
import {
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
  useDismissNotification,
} from '@/ui/hooks/mutations/use-notifications';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

const mockNotifications = [
  { id: '1', type: 'assigned', title: 'New assignment', message: 'You were assigned to task X', read: false, created_at: new Date().toISOString() },
  { id: '2', type: 'comment', title: 'New comment', message: 'Someone commented', read: true, created_at: new Date(Date.now() - 3600000).toISOString() },
  { id: '3', type: 'due_soon', title: 'Task due soon', message: null, read: false, created_at: new Date(Date.now() - 7200000).toISOString() },
];

describe('NotificationBell', () => {
  const mockMarkRead = { mutate: vi.fn() };
  const mockMarkAllRead = { mutate: vi.fn() };
  const mockDismiss = { mutate: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useMarkNotificationRead).mockReturnValue(mockMarkRead as unknown as ReturnType<typeof useMarkNotificationRead>);
    vi.mocked(useMarkAllNotificationsRead).mockReturnValue(mockMarkAllRead as unknown as ReturnType<typeof useMarkAllNotificationsRead>);
    vi.mocked(useDismissNotification).mockReturnValue(mockDismiss as unknown as ReturnType<typeof useDismissNotification>);
  });

  it('renders the bell button', () => {
    vi.mocked(useNotifications).mockReturnValue({ data: { notifications: [], total: 0 }, isLoading: false } as unknown as ReturnType<typeof useNotifications>);
    vi.mocked(useUnreadNotificationCount).mockReturnValue({ data: { count: 0 } } as unknown as ReturnType<typeof useUnreadNotificationCount>);

    render(<NotificationBell />, { wrapper: createWrapper() });
    expect(screen.getByTestId('notification-bell')).toBeInTheDocument();
  });

  it('shows unread badge when count > 0', () => {
    vi.mocked(useNotifications).mockReturnValue({ data: { notifications: mockNotifications, total: 3 }, isLoading: false } as unknown as ReturnType<typeof useNotifications>);
    vi.mocked(useUnreadNotificationCount).mockReturnValue({ data: { count: 5 } } as unknown as ReturnType<typeof useUnreadNotificationCount>);

    render(<NotificationBell />, { wrapper: createWrapper() });
    const badge = screen.getByTestId('notification-badge');
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).toBe('5');
  });

  it('shows 99+ for counts over 99', () => {
    vi.mocked(useNotifications).mockReturnValue({ data: { notifications: [], total: 0 }, isLoading: false } as unknown as ReturnType<typeof useNotifications>);
    vi.mocked(useUnreadNotificationCount).mockReturnValue({ data: { count: 150 } } as unknown as ReturnType<typeof useUnreadNotificationCount>);

    render(<NotificationBell />, { wrapper: createWrapper() });
    expect(screen.getByTestId('notification-badge').textContent).toBe('99+');
  });

  it('hides badge when count is 0', () => {
    vi.mocked(useNotifications).mockReturnValue({ data: { notifications: [], total: 0 }, isLoading: false } as unknown as ReturnType<typeof useNotifications>);
    vi.mocked(useUnreadNotificationCount).mockReturnValue({ data: { count: 0 } } as unknown as ReturnType<typeof useUnreadNotificationCount>);

    render(<NotificationBell />, { wrapper: createWrapper() });
    expect(screen.queryByTestId('notification-badge')).not.toBeInTheDocument();
  });

  it('opens dropdown and shows notifications when bell is clicked', async () => {
    vi.mocked(useNotifications).mockReturnValue({ data: { notifications: mockNotifications, total: 3 }, isLoading: false } as unknown as ReturnType<typeof useNotifications>);
    vi.mocked(useUnreadNotificationCount).mockReturnValue({ data: { count: 2 } } as unknown as ReturnType<typeof useUnreadNotificationCount>);

    render(<NotificationBell />, { wrapper: createWrapper() });

    fireEvent.click(screen.getByTestId('notification-bell'));
    await waitFor(() => {
      expect(screen.getByTestId('notification-dropdown')).toBeInTheDocument();
    });

    const items = screen.getAllByTestId('notification-item');
    expect(items).toHaveLength(3);
  });

  it('shows empty state when no notifications', async () => {
    vi.mocked(useNotifications).mockReturnValue({ data: { notifications: [], total: 0 }, isLoading: false } as unknown as ReturnType<typeof useNotifications>);
    vi.mocked(useUnreadNotificationCount).mockReturnValue({ data: { count: 0 } } as unknown as ReturnType<typeof useUnreadNotificationCount>);

    render(<NotificationBell />, { wrapper: createWrapper() });

    fireEvent.click(screen.getByTestId('notification-bell'));
    await waitFor(() => {
      expect(screen.getByText('No notifications')).toBeInTheDocument();
    });
  });

  it('calls markRead when clicking an unread notification', async () => {
    const clickHandler = vi.fn();
    vi.mocked(useNotifications).mockReturnValue({ data: { notifications: mockNotifications, total: 3 }, isLoading: false } as unknown as ReturnType<typeof useNotifications>);
    vi.mocked(useUnreadNotificationCount).mockReturnValue({ data: { count: 2 } } as unknown as ReturnType<typeof useUnreadNotificationCount>);

    render(<NotificationBell onNotificationClick={clickHandler} />, { wrapper: createWrapper() });

    fireEvent.click(screen.getByTestId('notification-bell'));
    await waitFor(() => {
      expect(screen.getAllByTestId('notification-item')).toHaveLength(3);
    });

    fireEvent.click(screen.getAllByTestId('notification-item')[0]);
    expect(mockMarkRead.mutate).toHaveBeenCalledWith('1');
    expect(clickHandler).toHaveBeenCalled();
  });

  it('shows mark all read button when unread notifications exist', async () => {
    vi.mocked(useNotifications).mockReturnValue({ data: { notifications: mockNotifications, total: 3 }, isLoading: false } as unknown as ReturnType<typeof useNotifications>);
    vi.mocked(useUnreadNotificationCount).mockReturnValue({ data: { count: 2 } } as unknown as ReturnType<typeof useUnreadNotificationCount>);

    render(<NotificationBell />, { wrapper: createWrapper() });

    fireEvent.click(screen.getByTestId('notification-bell'));
    await waitFor(() => {
      const markAllBtn = screen.getByText('Mark all read');
      expect(markAllBtn).toBeInTheDocument();

      fireEvent.click(markAllBtn);
      expect(mockMarkAllRead.mutate).toHaveBeenCalled();
    });
  });

  it('does not call markRead when clicking a read notification', async () => {
    vi.mocked(useNotifications).mockReturnValue({ data: { notifications: mockNotifications, total: 3 }, isLoading: false } as unknown as ReturnType<typeof useNotifications>);
    vi.mocked(useUnreadNotificationCount).mockReturnValue({ data: { count: 2 } } as unknown as ReturnType<typeof useUnreadNotificationCount>);

    render(<NotificationBell />, { wrapper: createWrapper() });

    fireEvent.click(screen.getByTestId('notification-bell'));
    await waitFor(() => {
      expect(screen.getAllByTestId('notification-item')).toHaveLength(3);
    });

    // Click second notification (read)
    fireEvent.click(screen.getAllByTestId('notification-item')[1]);
    expect(mockMarkRead.mutate).not.toHaveBeenCalled();
  });
});

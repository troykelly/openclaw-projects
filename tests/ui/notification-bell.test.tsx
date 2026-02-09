/**
 * @vitest-environment jsdom
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NotificationBell, type Notification } from '@/ui/components/notifications';

describe('NotificationBell', () => {
  const mockUserEmail = 'test@example.com';

  const mockNotifications: Notification[] = [
    {
      id: '1',
      notificationType: 'assigned',
      title: 'Assigned to you',
      message: 'Task A was assigned to you',
      createdAt: new Date().toISOString(),
    },
    {
      id: '2',
      notificationType: 'mentioned',
      title: 'You were mentioned',
      message: 'John mentioned you in a comment',
      readAt: new Date().toISOString(),
      createdAt: new Date(Date.now() - 3600000).toISOString(),
    },
  ];

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the bell icon', () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ unreadCount: 0 }),
    });

    render(<NotificationBell userEmail={mockUserEmail} />);

    expect(screen.getByTestId('notification-bell')).toBeInTheDocument();
  });

  it('shows badge with unread count', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ unreadCount: 5 }),
    });

    render(<NotificationBell userEmail={mockUserEmail} />);

    await waitFor(() => {
      expect(screen.getByTestId('notification-badge')).toHaveTextContent('5');
    });
  });

  it('shows 99+ when unread count exceeds 99', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ unreadCount: 150 }),
    });

    render(<NotificationBell userEmail={mockUserEmail} />);

    await waitFor(() => {
      expect(screen.getByTestId('notification-badge')).toHaveTextContent('99+');
    });
  });

  it('hides badge when no unread notifications', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ unreadCount: 0 }),
    });

    render(<NotificationBell userEmail={mockUserEmail} />);

    await waitFor(() => {
      expect(screen.queryByTestId('notification-badge')).not.toBeInTheDocument();
    });
  });

  it('opens dropdown when clicked', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ notifications: mockNotifications, unreadCount: 1 }),
    });

    render(<NotificationBell userEmail={mockUserEmail} />);

    fireEvent.click(screen.getByTestId('notification-bell'));

    await waitFor(() => {
      expect(screen.getByTestId('notification-dropdown')).toBeInTheDocument();
    });
  });

  it('shows notifications in dropdown', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ notifications: mockNotifications, unreadCount: 1 }),
    });

    render(<NotificationBell userEmail={mockUserEmail} />);

    fireEvent.click(screen.getByTestId('notification-bell'));

    await waitFor(() => {
      expect(screen.getByText('Assigned to you')).toBeInTheDocument();
      expect(screen.getByText('You were mentioned')).toBeInTheDocument();
    });
  });

  it('shows empty state when no notifications', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ notifications: [], unreadCount: 0 }),
    });

    render(<NotificationBell userEmail={mockUserEmail} />);

    fireEvent.click(screen.getByTestId('notification-bell'));

    await waitFor(() => {
      expect(screen.getByText('No notifications')).toBeInTheDocument();
    });
  });

  it('calls mark as read API when clicking unread notification', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ unreadCount: 1 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ notifications: [mockNotifications[0]], unreadCount: 1 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });
    vi.stubGlobal('fetch', fetchMock);

    render(<NotificationBell userEmail={mockUserEmail} />);

    fireEvent.click(screen.getByTestId('notification-bell'));

    await waitFor(() => {
      expect(screen.getByText('Assigned to you')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('notification-item'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/notifications/1/read'), expect.objectContaining({ method: 'POST' }));
    });
  });

  it('calls mark all read API when button is clicked', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ unreadCount: 2 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ notifications: mockNotifications, unreadCount: 2 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ markedCount: 2 }),
      });
    vi.stubGlobal('fetch', fetchMock);

    render(<NotificationBell userEmail={mockUserEmail} />);

    // Wait for initial unread count fetch
    await waitFor(() => {
      expect(screen.getByTestId('notification-badge')).toHaveTextContent('2');
    });

    fireEvent.click(screen.getByTestId('notification-bell'));

    await waitFor(() => {
      expect(screen.getByText('Mark all read')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Mark all read'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/notifications/read-all'), expect.objectContaining({ method: 'POST' }));
    });
  });

  it('calls onNotificationClick when notification is clicked', async () => {
    const onNotificationClick = vi.fn();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ notifications: mockNotifications, unreadCount: 1 }),
    });

    render(<NotificationBell userEmail={mockUserEmail} onNotificationClick={onNotificationClick} />);

    fireEvent.click(screen.getByTestId('notification-bell'));

    await waitFor(() => {
      expect(screen.getByText('Assigned to you')).toBeInTheDocument();
    });

    // Click the first notification item
    const notificationItems = screen.getAllByTestId('notification-item');
    fireEvent.click(notificationItems[0]);

    await waitFor(() => {
      expect(onNotificationClick).toHaveBeenCalledWith(mockNotifications[0]);
    });
  });
});

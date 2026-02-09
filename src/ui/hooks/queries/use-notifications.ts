/**
 * TanStack Query hooks for notifications.
 *
 * Fetches notification lists and unread counts.
 */
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import type { NotificationsResponse, UnreadCountResponse } from '@/ui/lib/api-types.ts';

/** Query key factory for notifications. */
export const notificationKeys = {
  all: ['notifications'] as const,
  list: () => [...notificationKeys.all, 'list'] as const,
  unreadCount: () => [...notificationKeys.all, 'unread-count'] as const,
};

/**
 * Fetch the notifications list.
 *
 * @returns TanStack Query result with `NotificationsResponse`
 */
export function useNotifications() {
  return useQuery({
    queryKey: notificationKeys.list(),
    queryFn: ({ signal }) => apiClient.get<NotificationsResponse>('/api/notifications', { signal }),
  });
}

/**
 * Fetch the unread notification count.
 *
 * Polls more frequently (every 30s) to keep the badge current.
 *
 * @returns TanStack Query result with `UnreadCountResponse`
 */
export function useUnreadNotificationCount() {
  return useQuery({
    queryKey: notificationKeys.unreadCount(),
    queryFn: ({ signal }) => apiClient.get<UnreadCountResponse>('/api/notifications/unread-count', { signal }),
    refetchInterval: 30_000,
  });
}

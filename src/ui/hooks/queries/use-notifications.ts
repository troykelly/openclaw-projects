/**
 * TanStack Query hooks for notifications.
 *
 * Fetches notification lists and unread counts.
 */
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import { notificationsResponseSchema, unreadCountResponseSchema } from '@/ui/lib/api-schemas.ts';
import type { NotificationsResponse, UnreadCountResponse } from '@/ui/lib/api-types.ts';

/** Query key factory for notifications. */
export const notificationKeys = {
  all: ['notifications'] as const,
  list: () => [...notificationKeys.all, 'list'] as const,
  unread_count: () => [...notificationKeys.all, 'unread-count'] as const,
};

/**
 * Fetch the notifications list.
 *
 * @returns TanStack Query result with `NotificationsResponse`
 */
export function useNotifications() {
  return useQuery({
    queryKey: notificationKeys.list(),
    queryFn: ({ signal }) => apiClient.get<NotificationsResponse>('/api/notifications', { signal, schema: notificationsResponseSchema }),
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
    queryKey: notificationKeys.unread_count(),
    queryFn: ({ signal }) => apiClient.get<UnreadCountResponse>('/api/notifications/unread-count', { signal, schema: unreadCountResponseSchema }),
    refetchInterval: 30_000,
  });
}

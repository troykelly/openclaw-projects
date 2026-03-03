/**
 * TanStack Query hooks for notifications.
 *
 * Issue #2080: Uses WebSocket push (notification:created) for real-time
 * cache invalidation instead of aggressive polling.
 */
import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import { notificationsResponseSchema, unreadCountResponseSchema } from '@/ui/lib/api-schemas.ts';
import type { NotificationsResponse, UnreadCountResponse } from '@/ui/lib/api-types.ts';
import { useRealtimeOptional } from '@/ui/components/realtime/realtime-context.tsx';

/** Query key factory for notifications. */
export const notificationKeys = {
  all: ['notifications'] as const,
  list: () => [...notificationKeys.all, 'list'] as const,
  unread_count: () => [...notificationKeys.all, 'unread-count'] as const,
};

/**
 * Subscribes to WebSocket `notification:created` events and invalidates
 * the notification query cache when one arrives.
 *
 * Issue #2080: Replaces 30-second polling with push-based invalidation.
 */
export function useRealtimeNotificationInvalidation(): void {
  const realtime = useRealtimeOptional();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!realtime) return;

    const cleanup = realtime.addEventHandler('notification:created', () => {
      void queryClient.invalidateQueries({ queryKey: notificationKeys.all });
    });

    return cleanup;
  }, [realtime, queryClient]);
}

/**
 * Fetch the notifications list.
 *
 * @returns TanStack Query result with `NotificationsResponse`
 */
export function useNotifications() {
  return useQuery({
    queryKey: notificationKeys.list(),
    queryFn: ({ signal }) => apiClient.get<NotificationsResponse>('/notifications', { signal, schema: notificationsResponseSchema }),
  });
}

/**
 * Fetch the unread notification count.
 *
 * Issue #2080: Polling reduced to 5-minute fallback. Primary updates
 * arrive via WebSocket `notification:created` events (see
 * useRealtimeNotificationInvalidation).
 *
 * @returns TanStack Query result with `UnreadCountResponse`
 */
export function useUnreadNotificationCount() {
  return useQuery({
    queryKey: notificationKeys.unread_count(),
    queryFn: ({ signal }) => apiClient.get<UnreadCountResponse>('/notifications/unread-count', { signal, schema: unreadCountResponseSchema }),
    refetchInterval: 300_000,
  });
}

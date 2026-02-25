/**
 * TanStack Query mutation hooks for notification actions.
 *
 * Provides mark-read, mark-all-read, and dismiss mutations with
 * optimistic cache updates for instant UI feedback.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import type { NotificationsResponse, UnreadCountResponse } from '@/ui/lib/api-types.ts';
import { notificationKeys } from '@/ui/hooks/queries/use-notifications.ts';

/**
 * Mark a single notification as read.
 *
 * Optimistically updates the notifications list and decrements the unread
 * count. On error, rolls back to previous cache state.
 */
export function useMarkNotificationRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiClient.post<void>(`/api/notifications/${id}/read`, {}),

    onMutate: async (id: string) => {
      await queryClient.cancelQueries({ queryKey: notificationKeys.list() });
      await queryClient.cancelQueries({ queryKey: notificationKeys.unread_count() });

      const previousList = queryClient.getQueryData<NotificationsResponse>(notificationKeys.list());
      const previousCount = queryClient.getQueryData<UnreadCountResponse>(notificationKeys.unread_count());

      if (previousList) {
        queryClient.setQueryData<NotificationsResponse>(notificationKeys.list(), {
          ...previousList,
          notifications: previousList.notifications.map((n) => (n.id === id ? { ...n, read: true } : n)),
        });
      }

      if (previousCount) {
        queryClient.setQueryData<UnreadCountResponse>(notificationKeys.unread_count(), {
          count: Math.max(0, previousCount.count - 1),
        });
      }

      return { previousList, previousCount };
    },

    onError: (_error, _id, context) => {
      if (context?.previousList) {
        queryClient.setQueryData(notificationKeys.list(), context.previousList);
      }
      if (context?.previousCount) {
        queryClient.setQueryData(notificationKeys.unread_count(), context.previousCount);
      }
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: notificationKeys.list() });
      queryClient.invalidateQueries({ queryKey: notificationKeys.unread_count() });
    },
  });
}

/**
 * Mark all notifications as read.
 *
 * Optimistically marks every notification in the cache as read and
 * sets the unread count to zero.
 */
export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => apiClient.post<void>('/api/notifications/read-all', {}),

    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: notificationKeys.list() });
      await queryClient.cancelQueries({ queryKey: notificationKeys.unread_count() });

      const previousList = queryClient.getQueryData<NotificationsResponse>(notificationKeys.list());
      const previousCount = queryClient.getQueryData<UnreadCountResponse>(notificationKeys.unread_count());

      if (previousList) {
        queryClient.setQueryData<NotificationsResponse>(notificationKeys.list(), {
          ...previousList,
          notifications: previousList.notifications.map((n) => ({ ...n, read: true })),
        });
      }

      queryClient.setQueryData<UnreadCountResponse>(notificationKeys.unread_count(), { count: 0 });

      return { previousList, previousCount };
    },

    onError: (_error, _vars, context) => {
      if (context?.previousList) {
        queryClient.setQueryData(notificationKeys.list(), context.previousList);
      }
      if (context?.previousCount) {
        queryClient.setQueryData(notificationKeys.unread_count(), context.previousCount);
      }
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: notificationKeys.list() });
      queryClient.invalidateQueries({ queryKey: notificationKeys.unread_count() });
    },
  });
}

/**
 * Dismiss (delete) a notification.
 *
 * Optimistically removes the notification from the list and decrements
 * the unread count if it was unread.
 */
export function useDismissNotification() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/api/notifications/${id}`),

    onMutate: async (id: string) => {
      await queryClient.cancelQueries({ queryKey: notificationKeys.list() });
      await queryClient.cancelQueries({ queryKey: notificationKeys.unread_count() });

      const previousList = queryClient.getQueryData<NotificationsResponse>(notificationKeys.list());
      const previousCount = queryClient.getQueryData<UnreadCountResponse>(notificationKeys.unread_count());

      const targetNotification = previousList?.notifications.find((n) => n.id === id);

      if (previousList) {
        queryClient.setQueryData<NotificationsResponse>(notificationKeys.list(), {
          ...previousList,
          notifications: previousList.notifications.filter((n) => n.id !== id),
          total: Math.max(0, previousList.total - 1),
        });
      }

      if (previousCount && targetNotification && !targetNotification.read) {
        queryClient.setQueryData<UnreadCountResponse>(notificationKeys.unread_count(), {
          count: Math.max(0, previousCount.count - 1),
        });
      }

      return { previousList, previousCount };
    },

    onError: (_error, _id, context) => {
      if (context?.previousList) {
        queryClient.setQueryData(notificationKeys.list(), context.previousList);
      }
      if (context?.previousCount) {
        queryClient.setQueryData(notificationKeys.unread_count(), context.previousCount);
      }
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: notificationKeys.list() });
      queryClient.invalidateQueries({ queryKey: notificationKeys.unread_count() });
    },
  });
}

/**
 * Notification bell with unread badge, dropdown list, mark-read, and dismiss.
 *
 * Uses TanStack Query hooks for data fetching and mutations, providing
 * optimistic updates and automatic cache invalidation.
 */
import * as React from 'react';
import { useState } from 'react';
import { Bell, Check, X, User, MessageSquare, AlertTriangle, Clock, CheckCircle2 } from 'lucide-react';
import { Button } from '@/ui/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/components/ui/popover';
import { ScrollArea } from '@/ui/components/ui/scroll-area';
import { cn } from '@/ui/lib/utils';
import { useNotifications, useUnreadNotificationCount } from '@/ui/hooks/queries/use-notifications';
import { useMarkNotificationRead, useMarkAllNotificationsRead, useDismissNotification } from '@/ui/hooks/mutations/use-notifications';
import type { Notification as ApiNotification } from '@/ui/lib/api-types';

export interface NotificationBellProps {
  onNotificationClick?: (notification: ApiNotification) => void;
}

/** Map notification type to an appropriate icon. */
function getNotificationIcon(type: string): React.JSX.Element {
  switch (type) {
    case 'assigned':
      return <User className="size-4 text-blue-500" />;
    case 'mentioned':
    case 'comment':
      return <MessageSquare className="size-4 text-purple-500" />;
    case 'status_change':
      return <CheckCircle2 className="size-4 text-green-500" />;
    case 'unblocked':
      return <Check className="size-4 text-emerald-500" />;
    case 'due_soon':
      return <Clock className="size-4 text-amber-500" />;
    case 'warning':
      return <AlertTriangle className="size-4 text-orange-500" />;
    default:
      return <Bell className="size-4" />;
  }
}

/** Format a timestamp into a human-readable relative string. */
function formatTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export function NotificationBell({ onNotificationClick }: NotificationBellProps): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false);

  const notificationsQuery = useNotifications();
  const unreadCountQuery = useUnreadNotificationCount();
  const markReadMutation = useMarkNotificationRead();
  const markAllReadMutation = useMarkAllNotificationsRead();
  const dismissMutation = useDismissNotification();

  const notifications = notificationsQuery.data?.notifications ?? [];
  const unreadCount = unreadCountQuery.data?.count ?? 0;
  const isLoading = isOpen && notificationsQuery.isLoading;

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="relative"
          aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
          data-testid="notification-bell"
        >
          <Bell className="size-5" />
          {unreadCount > 0 && (
            <span
              className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-destructive text-[10px] font-medium text-destructive-foreground"
              data-testid="notification-badge"
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end" data-testid="notification-dropdown">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="font-semibold">Notifications</h3>
          {unreadCount > 0 && (
            <Button variant="ghost" size="sm" className="text-xs" onClick={() => markAllReadMutation.mutate()}>
              Mark all read
            </Button>
          )}
        </div>
        <ScrollArea className="h-[400px]">
          {isLoading ? (
            <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">Loading...</div>
          ) : notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-sm text-muted-foreground">
              <Bell className="mb-2 size-8 opacity-50" />
              <p>No notifications</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {notifications.map((notification) => (
                <div
                  key={notification.id}
                  className={cn('group relative px-4 py-3 hover:bg-muted/50 cursor-pointer', !notification.read && 'bg-muted/30')}
                  onClick={() => {
                    if (!notification.read) {
                      markReadMutation.mutate(notification.id);
                    }
                    onNotificationClick?.(notification);
                  }}
                  data-testid="notification-item"
                >
                  <div className="flex gap-3">
                    <div className="mt-0.5">{getNotificationIcon(notification.type)}</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium leading-tight">{notification.title}</p>
                      {notification.message && <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{notification.message}</p>}
                      <p className="mt-1 text-[10px] text-muted-foreground">{formatTime(notification.created_at)}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="size-6 p-0 opacity-0 group-hover:opacity-100"
                      onClick={(e) => {
                        e.stopPropagation();
                        dismissMutation.mutate(notification.id);
                      }}
                      aria-label="Dismiss notification"
                    >
                      <X className="size-3" />
                    </Button>
                  </div>
                  {!notification.read && <div className="absolute left-1.5 top-1/2 -translate-y-1/2 size-2 rounded-full bg-blue-500" />}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

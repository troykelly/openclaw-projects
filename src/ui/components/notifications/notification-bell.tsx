import * as React from 'react';
import { useState, useEffect, useCallback } from 'react';
import { Bell, Check, X, User, MessageSquare, AlertTriangle, Clock, CheckCircle2 } from 'lucide-react';
import { Button } from '@/ui/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/components/ui/popover';
import { ScrollArea } from '@/ui/components/ui/scroll-area';
import { cn } from '@/ui/lib/utils';
import { apiClient } from '@/ui/lib/api-client';

export interface Notification {
  id: string;
  notification_type: 'assigned' | 'mentioned' | 'status_change' | 'unblocked' | 'due_soon' | 'comment';
  title: string;
  message: string;
  work_item_id?: string;
  actor_email?: string;
  readAt?: string;
  created_at: string;
}

interface NotificationBellProps {
  user_email: string;
  onNotificationClick?: (notification: Notification) => void;
}

export function NotificationBell({ user_email, onNotificationClick }: NotificationBellProps) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unread_count, setUnreadCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const fetchNotifications = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await apiClient.get<{ notifications: Notification[]; unread_count: number }>(`/api/notifications?user_email=${encodeURIComponent(user_email)}&limit=20`);
      setNotifications(data.notifications);
      setUnreadCount(data.unread_count);
    } catch (error) {
      console.error('Failed to fetch notifications:', error);
    } finally {
      setIsLoading(false);
    }
  }, [user_email]);

  const fetchUnreadCount = useCallback(async () => {
    try {
      const data = await apiClient.get<{ unread_count: number }>(`/api/notifications/unread-count?user_email=${encodeURIComponent(user_email)}`);
      setUnreadCount(data.unread_count);
    } catch (error) {
      console.error('Failed to fetch unread count:', error);
    }
  }, [user_email]);

  useEffect(() => {
    fetchUnreadCount();
    // Poll for unread count every 30 seconds
    const interval = setInterval(fetchUnreadCount, 30000);
    return () => clearInterval(interval);
  }, [fetchUnreadCount]);

  useEffect(() => {
    if (isOpen) {
      fetchNotifications();
    }
  }, [isOpen, fetchNotifications]);

  const markAsRead = async (id: string) => {
    try {
      await apiClient.post(`/api/notifications/${id}/read?user_email=${encodeURIComponent(user_email)}`, {});
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)));
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch (error) {
      console.error('Failed to mark notification as read:', error);
    }
  };

  const markAllAsRead = async () => {
    try {
      await apiClient.post(`/api/notifications/read-all?user_email=${encodeURIComponent(user_email)}`, {});
      setNotifications((prev) => prev.map((n) => ({ ...n, readAt: n.readAt || new Date().toISOString() })));
      setUnreadCount(0);
    } catch (error) {
      console.error('Failed to mark all as read:', error);
    }
  };

  const dismissNotification = async (id: string) => {
    try {
      await apiClient.delete(`/api/notifications/${id}?user_email=${encodeURIComponent(user_email)}`);
      setNotifications((prev) => prev.filter((n) => n.id !== id));
      const notification = notifications.find((n) => n.id === id);
      if (notification && !notification.readAt) {
        setUnreadCount((prev) => Math.max(0, prev - 1));
      }
    } catch (error) {
      console.error('Failed to dismiss notification:', error);
    }
  };

  const getNotificationIcon = (type: Notification['notification_type']) => {
    switch (type) {
      case 'assigned':
        return <User className="size-4 text-blue-500" />;
      case 'mentioned':
        return <MessageSquare className="size-4 text-purple-500" />;
      case 'status_change':
        return <CheckCircle2 className="size-4 text-green-500" />;
      case 'unblocked':
        return <Check className="size-4 text-emerald-500" />;
      case 'due_soon':
        return <Clock className="size-4 text-amber-500" />;
      case 'comment':
        return <MessageSquare className="size-4 text-gray-500" />;
      default:
        return <Bell className="size-4" />;
    }
  };

  const formatTime = (dateString: string) => {
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
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="relative"
          aria-label={`Notifications${unread_count > 0 ? ` (${unread_count} unread)` : ''}`}
          data-testid="notification-bell"
        >
          <Bell className="size-5" />
          {unread_count > 0 && (
            <span
              className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-destructive text-[10px] font-medium text-destructive-foreground"
              data-testid="notification-badge"
            >
              {unread_count > 99 ? '99+' : unread_count}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end" data-testid="notification-dropdown">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="font-semibold">Notifications</h3>
          {unread_count > 0 && (
            <Button variant="ghost" size="sm" className="text-xs" onClick={markAllAsRead}>
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
                  className={cn('group relative px-4 py-3 hover:bg-muted/50 cursor-pointer', !notification.readAt && 'bg-muted/30')}
                  onClick={() => {
                    if (!notification.readAt) {
                      markAsRead(notification.id);
                    }
                    onNotificationClick?.(notification);
                  }}
                  data-testid="notification-item"
                >
                  <div className="flex gap-3">
                    <div className="mt-0.5">{getNotificationIcon(notification.notification_type)}</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium leading-tight">{notification.title}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{notification.message}</p>
                      <p className="mt-1 text-[10px] text-muted-foreground">{formatTime(notification.created_at)}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="size-6 p-0 opacity-0 group-hover:opacity-100"
                      onClick={(e) => {
                        e.stopPropagation();
                        dismissNotification(notification.id);
                      }}
                      aria-label="Dismiss notification"
                    >
                      <X className="size-3" />
                    </Button>
                  </div>
                  {!notification.readAt && <div className="absolute left-1.5 top-1/2 -translate-y-1/2 size-2 rounded-full bg-blue-500" />}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Types for watchers/followers on work items
 * Issue #401: Implement watchers/followers on work items
 */

export type NotificationLevel = 'all' | 'mentions' | 'status_changes';

export interface Watcher {
  id: string;
  user_id: string;
  name: string;
  avatar?: string;
  notificationLevel: NotificationLevel;
  addedAt: string;
}

export interface WatchedItem {
  id: string;
  title: string;
  type: 'project' | 'epic' | 'initiative' | 'issue' | 'task';
  status: string;
  notificationLevel: NotificationLevel;
  lastActivity: string;
  unread_count: number;
}

export interface AutoWatchSettings {
  autoWatchCreated: boolean;
  autoWatchAssigned: boolean;
  autoWatchCommented: boolean;
  defaultNotificationLevel: NotificationLevel;
}

export interface WatcherUser {
  id: string;
  name: string;
  avatar?: string;
}

export const NOTIFICATION_LEVELS: { value: NotificationLevel; label: string }[] = [
  { value: 'all', label: 'All activity' },
  { value: 'mentions', label: 'Mentions only' },
  { value: 'status_changes', label: 'Status changes only' },
];

export function getNotificationLevelLabel(level: NotificationLevel): string {
  return NOTIFICATION_LEVELS.find((l) => l.value === level)?.label ?? level;
}

export function getInitials(name: string): string {
  const parts = name.split(' ').filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

/**
 * Watchers components
 * Issue #401: Implement watchers/followers on work items
 */
export { WatchButton } from './watch-button';
export type { WatchButtonProps } from './watch-button';
export { WatcherList } from './watcher-list';
export type { WatcherListProps } from './watcher-list';
export { AddWatcherDialog } from './add-watcher-dialog';
export type { AddWatcherDialogProps } from './add-watcher-dialog';
export { WatchedItemsList } from './watched-items-list';
export type { WatchedItemsListProps } from './watched-items-list';
export { WatcherSettings } from './watcher-settings';
export type { WatcherSettingsProps } from './watcher-settings';
export type {
  Watcher,
  WatchedItem,
  WatcherUser,
  NotificationLevel,
  AutoWatchSettings,
} from './types';
export { NOTIFICATION_LEVELS, getNotificationLevelLabel, getInitials } from './types';

/**
 * Utility functions for activity timeline
 * Issue #396: Implement contact activity timeline
 */
import type { Activity, ActivityGroup, ActivityType, ActivityStatistics } from './types';

/** Activity type labels */
const ACTIVITY_LABELS: Record<ActivityType, string> = {
  work_item_assignment: 'Assignment',
  work_item_mention: 'Mention',
  email_sent: 'Email Sent',
  email_received: 'Email Received',
  calendar_event: 'Calendar Event',
  relationship_added: 'Relationship Added',
  relationship_removed: 'Relationship Removed',
  contact_updated: 'Contact Updated',
  note_added: 'Note Added',
};

/** Activity type icons (Lucide icon names) */
const ACTIVITY_ICONS: Record<ActivityType, string> = {
  work_item_assignment: 'CheckSquare',
  work_item_mention: 'AtSign',
  email_sent: 'Mail',
  email_received: 'MailOpen',
  calendar_event: 'Calendar',
  relationship_added: 'Users',
  relationship_removed: 'UserMinus',
  contact_updated: 'UserCog',
  note_added: 'FileText',
};

/** Filter category labels */
export const FILTER_CATEGORIES: { label: string; types: ActivityType[] }[] = [
  { label: 'Assignments', types: ['work_item_assignment', 'work_item_mention'] },
  { label: 'Emails', types: ['email_sent', 'email_received'] },
  { label: 'Calendar', types: ['calendar_event'] },
  { label: 'Relationships', types: ['relationship_added', 'relationship_removed'] },
  { label: 'Updates', types: ['contact_updated', 'note_added'] },
];

/** Get human-readable label for activity type */
export function getActivityLabel(type: ActivityType): string {
  return ACTIVITY_LABELS[type] || type;
}

/** Get icon name for activity type */
export function getActivityIcon(type: ActivityType): string {
  return ACTIVITY_ICONS[type] || 'Activity';
}

/** Get date label for grouping */
function getDateLabel(date: Date): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const weekAgo = new Date(today.getTime() - 86400000 * 7);
  const monthAgo = new Date(today.getTime() - 86400000 * 30);

  const activityDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (activityDate.getTime() === today.getTime()) {
    return 'Today';
  }
  if (activityDate.getTime() === yesterday.getTime()) {
    return 'Yesterday';
  }
  if (activityDate >= weekAgo) {
    return 'This Week';
  }
  if (activityDate >= monthAgo) {
    return 'This Month';
  }
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

/** Group activities by date */
export function groupActivitiesByDate(activities: Activity[]): ActivityGroup[] {
  if (activities.length === 0) return [];

  // Sort by timestamp descending
  const sorted = [...activities].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  const groups: Map<string, ActivityGroup> = new Map();

  for (const activity of sorted) {
    const date = new Date(activity.timestamp);
    const label = getDateLabel(date);

    if (!groups.has(label)) {
      groups.set(label, {
        label,
        date: new Date(date.getFullYear(), date.getMonth(), date.getDate()),
        activities: [],
      });
    }

    groups.get(label)!.activities.push(activity);
  }

  return Array.from(groups.values());
}

/** Calculate activity statistics */
export function calculateStats(activities: Activity[]): ActivityStatistics {
  const typeCounts: Record<string, number> = {};
  let lastInteraction: Date | null = null;

  for (const activity of activities) {
    typeCounts[activity.type] = (typeCounts[activity.type] || 0) + 1;

    const actDate = new Date(activity.timestamp);
    if (!lastInteraction || actDate > lastInteraction) {
      lastInteraction = actDate;
    }
  }

  let mostCommonType: ActivityType | null = null;
  let maxCount = 0;

  for (const [type, count] of Object.entries(typeCounts)) {
    if (count > maxCount) {
      maxCount = count;
      mostCommonType = type as ActivityType;
    }
  }

  return {
    total: activities.length,
    mostCommonType,
    lastInteraction,
    typeCounts: typeCounts as Record<ActivityType, number>,
  };
}

/** Format timestamp for display */
export function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

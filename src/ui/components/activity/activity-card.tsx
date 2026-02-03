/**
 * Card for displaying a single activity
 * Issue #396: Implement contact activity timeline
 */
import * as React from 'react';
import {
  Mail,
  MailOpen,
  CheckSquare,
  AtSign,
  Calendar,
  Users,
  UserMinus,
  UserCog,
  FileText,
  Activity as ActivityIcon,
} from 'lucide-react';
import { cn } from '@/ui/lib/utils';
import type { Activity, ActivityType, ActivitySourceType } from './types';
import { formatTimestamp } from './activity-utils';

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  Mail,
  MailOpen,
  CheckSquare,
  AtSign,
  Calendar,
  Users,
  UserMinus,
  UserCog,
  FileText,
  Activity: ActivityIcon,
};

const typeToIcon: Record<ActivityType, string> = {
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

export interface ActivityCardProps {
  activity: Activity;
  onClick?: (activityId: string, sourceType: ActivitySourceType, sourceId: string) => void;
  className?: string;
}

export function ActivityCard({ activity, onClick, className }: ActivityCardProps) {
  const iconName = typeToIcon[activity.type] || 'Activity';
  const Icon = iconMap[iconName] || ActivityIcon;

  const handleClick = () => {
    onClick?.(activity.id, activity.sourceType, activity.sourceId);
  };

  return (
    <div
      className={cn(
        'flex items-start gap-3 p-3 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer',
        className
      )}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick();
        }
      }}
    >
      {/* Icon */}
      <div
        data-testid="activity-icon"
        className="shrink-0 w-8 h-8 rounded-full bg-muted flex items-center justify-center"
      >
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium text-sm truncate">{activity.title}</span>
          <span className="text-xs text-muted-foreground shrink-0">
            {formatTimestamp(activity.timestamp)}
          </span>
        </div>

        {activity.description && (
          <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">
            {activity.description}
          </p>
        )}

        {activity.metadata && Object.keys(activity.metadata).length > 0 && (
          <div className="flex gap-2 mt-1">
            {Object.entries(activity.metadata).map(([key, value]) => (
              <span
                key={key}
                className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
              >
                {value}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

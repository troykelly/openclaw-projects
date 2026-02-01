import * as React from 'react';
import {
  Folder,
  FileText,
  User,
  Bot,
  CheckCircle,
  Plus,
  Pencil,
  Trash2,
  MessageSquare,
  ArrowRight,
  UserPlus,
} from 'lucide-react';
import { cn } from '@/ui/lib/utils';
import { Card } from '@/ui/components/ui/card';
import type { ActivityItem, ActorType, ActionType, EntityType } from './types';

function getActorIcon(actorType: ActorType) {
  return actorType === 'agent' ? (
    <Bot className="size-5 text-primary" />
  ) : (
    <User className="size-5 text-muted-foreground" />
  );
}

function getActionIcon(action: ActionType) {
  switch (action) {
    case 'created':
      return <Plus className="size-4" />;
    case 'updated':
      return <Pencil className="size-4" />;
    case 'deleted':
      return <Trash2 className="size-4" />;
    case 'status_changed':
      return <ArrowRight className="size-4" />;
    case 'commented':
      return <MessageSquare className="size-4" />;
    case 'assigned':
      return <UserPlus className="size-4" />;
    case 'completed':
      return <CheckCircle className="size-4" />;
    case 'moved':
      return <ArrowRight className="size-4" />;
    default:
      return <FileText className="size-4" />;
  }
}

function getEntityIcon(entityType: EntityType) {
  switch (entityType) {
    case 'project':
    case 'initiative':
    case 'epic':
      return <Folder className="size-4" />;
    case 'issue':
      return <FileText className="size-4" />;
    case 'contact':
      return <User className="size-4" />;
    case 'memory':
      return <FileText className="size-4" />;
    default:
      return <FileText className="size-4" />;
  }
}

function getActionLabel(action: ActionType): string {
  switch (action) {
    case 'created':
      return 'created';
    case 'updated':
      return 'updated';
    case 'deleted':
      return 'deleted';
    case 'status_changed':
      return 'changed status of';
    case 'commented':
      return 'commented on';
    case 'assigned':
      return 'assigned';
    case 'completed':
      return 'completed';
    case 'moved':
      return 'moved';
    default:
      return action;
  }
}

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins} minute${diffMins !== 1 ? 's' : ''} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;

  return date.toLocaleDateString();
}

export interface ActivityCardProps {
  item: ActivityItem;
  onClick?: (item: ActivityItem) => void;
  className?: string;
}

export function ActivityCard({ item, onClick, className }: ActivityCardProps) {
  const handleClick = () => {
    onClick?.(item);
  };

  return (
    <Card
      data-testid="activity-card"
      className={cn(
        'cursor-pointer p-4 transition-colors hover:bg-muted/50',
        !item.read && 'border-l-2 border-l-primary',
        className
      )}
      onClick={handleClick}
      role="article"
      aria-label={`${item.actorName} ${getActionLabel(item.action)} ${item.entityTitle}`}
    >
      <div className="flex items-start gap-3">
        {/* Actor Icon */}
        <div className="mt-0.5 shrink-0">
          {getActorIcon(item.actorType)}
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          {/* Main text */}
          <p className="text-sm">
            <span className="font-medium">{item.actorName}</span>
            <span className="text-muted-foreground"> {getActionLabel(item.action)} </span>
            <span className="font-medium">{item.entityTitle}</span>
          </p>

          {/* Parent context */}
          {item.parentEntityTitle && (
            <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
              in {item.parentEntityTitle}
            </p>
          )}

          {/* Detail if any */}
          {item.detail && (
            <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
              "{item.detail}"
            </p>
          )}

          {/* Timestamp */}
          <p className="mt-2 text-xs text-muted-foreground">
            {formatRelativeTime(item.timestamp)}
          </p>
        </div>

        {/* Entity type icon */}
        <div className="shrink-0 text-muted-foreground">
          {getEntityIcon(item.entityType)}
        </div>
      </div>
    </Card>
  );
}

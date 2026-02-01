import * as React from 'react';
import {
  Calendar,
  Clock,
  MapPin,
  Users,
  Video,
  MoreVertical,
  Unlink,
} from 'lucide-react';
import { cn } from '@/ui/lib/utils';
import { Button } from '@/ui/components/ui/button';
import { Badge } from '@/ui/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/components/ui/dropdown-menu';
import type { LinkedCalendarEvent } from './types';

export interface CalendarEventCardProps {
  event: LinkedCalendarEvent;
  onClick?: (event: LinkedCalendarEvent) => void;
  onUnlink?: (event: LinkedCalendarEvent) => void;
  className?: string;
}

export function CalendarEventCard({
  event,
  onClick,
  onUnlink,
  className,
}: CalendarEventCardProps) {
  const isPast = event.endTime < new Date();
  const isToday = isSameDay(event.startTime, new Date());

  return (
    <div
      data-testid="calendar-event-card"
      className={cn(
        'group flex items-start gap-3 rounded-lg border bg-card p-3 transition-colors hover:bg-accent/50',
        onClick && 'cursor-pointer',
        isPast && 'opacity-60',
        className
      )}
      onClick={() => onClick?.(event)}
    >
      {/* Date box */}
      <div
        className={cn(
          'flex size-12 shrink-0 flex-col items-center justify-center rounded-lg',
          isToday ? 'bg-primary text-primary-foreground' : 'bg-muted'
        )}
      >
        <span className="text-[10px] font-medium uppercase">
          {event.startTime.toLocaleDateString([], { weekday: 'short' })}
        </span>
        <span className="text-lg font-bold">{event.startTime.getDate()}</span>
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <h4 className="font-medium leading-tight">{event.title}</h4>

          {onUnlink && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6 opacity-0 group-hover:opacity-100"
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreVertical className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    onUnlink(event);
                  }}
                >
                  <Unlink className="mr-2 size-4" />
                  Unlink
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {/* Time */}
        <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
          <Clock className="size-3" />
          <span>
            {event.isAllDay
              ? 'All day'
              : `${formatTime(event.startTime)} - ${formatTime(event.endTime)}`}
          </span>
        </div>

        {/* Location */}
        {event.location && (
          <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
            <MapPin className="size-3" />
            <span className="truncate">{event.location}</span>
          </div>
        )}

        {/* Meeting link */}
        {event.meetingLink && (
          <div className="mt-1 flex items-center gap-1 text-xs text-primary">
            <Video className="size-3" />
            <span>Video meeting</span>
          </div>
        )}

        {/* Attendees */}
        {event.attendees.length > 0 && (
          <div className="mt-2 flex items-center gap-2">
            <Users className="size-3 text-muted-foreground" />
            <div className="flex items-center gap-1">
              {event.attendees.slice(0, 3).map((attendee, i) => (
                <Badge
                  key={attendee.email}
                  variant={
                    attendee.status === 'accepted'
                      ? 'default'
                      : attendee.status === 'declined'
                        ? 'destructive'
                        : 'secondary'
                  }
                  className="text-[10px] px-1.5 py-0"
                >
                  {attendee.name.split(' ')[0]}
                </Badge>
              ))}
              {event.attendees.length > 3 && (
                <span className="text-xs text-muted-foreground">
                  +{event.attendees.length - 3}
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function isSameDay(d1: Date, d2: Date): boolean {
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

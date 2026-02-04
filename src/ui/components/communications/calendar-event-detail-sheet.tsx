import * as React from 'react';
import {
  Calendar,
  Clock,
  MapPin,
  Users,
  Video,
  User,
  Unlink,
  FileText,
  Check,
  X,
  HelpCircle,
} from 'lucide-react';
import { cn } from '@/ui/lib/utils';
import { Button } from '@/ui/components/ui/button';
import { Badge } from '@/ui/components/ui/badge';
import { ScrollArea } from '@/ui/components/ui/scroll-area';
import { Separator } from '@/ui/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/ui/components/ui/sheet';
import type { LinkedCalendarEvent, CalendarAttendee } from './types';

function getStatusIcon(status: CalendarAttendee['status']) {
  switch (status) {
    case 'accepted':
      return <Check className="size-3 text-green-600" />;
    case 'declined':
      return <X className="size-3 text-red-600" />;
    case 'tentative':
      return <HelpCircle className="size-3 text-yellow-600" />;
    default:
      return null;
  }
}

export interface CalendarEventDetailSheetProps {
  event: LinkedCalendarEvent | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUnlink?: (event: LinkedCalendarEvent) => void;
  onJoinMeeting?: (event: LinkedCalendarEvent) => void;
}

export function CalendarEventDetailSheet({
  event,
  open,
  onOpenChange,
  onUnlink,
  onJoinMeeting,
}: CalendarEventDetailSheetProps) {
  if (!event) return null;

  const isPast = event.endTime < new Date();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[500px] sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="sr-only">Event Details</SheetTitle>
          <SheetDescription className="sr-only">View event time, attendees, and details</SheetDescription>
        </SheetHeader>

        <ScrollArea className="h-full">
          <div className="space-y-4 pb-6">
            {/* Title */}
            <div>
              <h2 className="text-xl font-semibold">{event.title}</h2>
              {isPast && (
                <Badge variant="secondary" className="mt-1">
                  Past event
                </Badge>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              {event.meetingLink && onJoinMeeting && !isPast && (
                <Button size="sm" onClick={() => onJoinMeeting(event)}>
                  <Video className="mr-1 size-3" />
                  Join meeting
                </Button>
              )}
              {onUnlink && (
                <Button
                  variant="outline"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => onUnlink(event)}
                >
                  <Unlink className="mr-1 size-3" />
                  Unlink
                </Button>
              )}
            </div>

            <Separator />

            {/* When */}
            <div className="space-y-3 text-sm">
              <div className="flex items-center gap-2">
                <Calendar className="size-4 text-muted-foreground" />
                <span>
                  {event.startTime.toLocaleDateString([], {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <Clock className="size-4 text-muted-foreground" />
                <span>
                  {event.isAllDay
                    ? 'All day'
                    : `${formatTime(event.startTime)} - ${formatTime(event.endTime)}`}
                </span>
              </div>

              {/* Location */}
              {event.location && (
                <div className="flex items-center gap-2">
                  <MapPin className="size-4 text-muted-foreground" />
                  <span>{event.location}</span>
                </div>
              )}

              {/* Meeting link */}
              {event.meetingLink && (
                <div className="flex items-center gap-2 text-primary">
                  <Video className="size-4" />
                  <a
                    href={event.meetingLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    Join video call
                  </a>
                </div>
              )}

              {/* Organizer */}
              {event.organizer && (
                <div className="flex items-center gap-2">
                  <User className="size-4 text-muted-foreground" />
                  <span>Organized by {event.organizer.name || event.organizer.email}</span>
                </div>
              )}
            </div>

            {/* Attendees */}
            {event.attendees.length > 0 && (
              <>
                <Separator />

                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Users className="size-4" />
                    Attendees ({event.attendees.length})
                  </div>

                  <div className="space-y-2">
                    {event.attendees.map((attendee) => (
                      <div
                        key={attendee.email}
                        className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2"
                      >
                        <div>
                          <p className="text-sm font-medium">{attendee.name}</p>
                          <p className="text-xs text-muted-foreground">{attendee.email}</p>
                        </div>
                        <div className="flex items-center gap-1">
                          {getStatusIcon(attendee.status)}
                          <span className="text-xs capitalize text-muted-foreground">
                            {attendee.status}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Description */}
            {event.description && (
              <>
                <Separator />

                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <FileText className="size-4" />
                    Description
                  </div>
                  <div className="prose prose-sm dark:prose-invert max-w-none">
                    <div className="whitespace-pre-wrap">{event.description}</div>
                  </div>
                </div>
              </>
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

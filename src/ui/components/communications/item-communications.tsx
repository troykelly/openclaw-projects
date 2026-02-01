import * as React from 'react';
import { useState } from 'react';
import { Mail, Calendar, Plus, Link2 } from 'lucide-react';
import { cn } from '@/ui/lib/utils';
import { Button } from '@/ui/components/ui/button';
import { Badge } from '@/ui/components/ui/badge';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/ui/components/ui/tabs';
import { EmailCard } from './email-card';
import { CalendarEventCard } from './calendar-event-card';
import type { LinkedEmail, LinkedCalendarEvent } from './types';

export interface ItemCommunicationsProps {
  emails: LinkedEmail[];
  calendarEvents: LinkedCalendarEvent[];
  onEmailClick?: (email: LinkedEmail) => void;
  onEventClick?: (event: LinkedCalendarEvent) => void;
  onUnlinkEmail?: (email: LinkedEmail) => void;
  onUnlinkEvent?: (event: LinkedCalendarEvent) => void;
  onLinkEmail?: () => void;
  onLinkEvent?: () => void;
  className?: string;
}

export function ItemCommunications({
  emails,
  calendarEvents,
  onEmailClick,
  onEventClick,
  onUnlinkEmail,
  onUnlinkEvent,
  onLinkEmail,
  onLinkEvent,
  className,
}: ItemCommunicationsProps) {
  const [activeTab, setActiveTab] = useState<'emails' | 'calendar'>('emails');

  const totalCount = emails.length + calendarEvents.length;

  return (
    <div className={cn('space-y-4', className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium">Communications</h3>
          <Badge variant="secondary" className="text-xs">
            {totalCount}
          </Badge>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'emails' | 'calendar')}>
        <div className="flex items-center justify-between">
          <TabsList>
            <TabsTrigger value="emails" className="gap-1">
              <Mail className="size-3" />
              Emails
              {emails.length > 0 && (
                <Badge variant="secondary" className="ml-1 text-[10px] px-1">
                  {emails.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="calendar" className="gap-1">
              <Calendar className="size-3" />
              Calendar
              {calendarEvents.length > 0 && (
                <Badge variant="secondary" className="ml-1 text-[10px] px-1">
                  {calendarEvents.length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {activeTab === 'emails' && onLinkEmail && (
            <Button variant="ghost" size="sm" onClick={onLinkEmail}>
              <Link2 className="mr-1 size-3" />
              Link Email
            </Button>
          )}
          {activeTab === 'calendar' && onLinkEvent && (
            <Button variant="ghost" size="sm" onClick={onLinkEvent}>
              <Link2 className="mr-1 size-3" />
              Link Event
            </Button>
          )}
        </div>

        <TabsContent value="emails" className="mt-4">
          {emails.length > 0 ? (
            <div className="space-y-2">
              {emails.map((email) => (
                <EmailCard
                  key={email.id}
                  email={email}
                  onClick={onEmailClick}
                  onUnlink={onUnlinkEmail}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<Mail className="size-8" />}
              message="No linked emails"
              action={
                onLinkEmail && (
                  <Button variant="outline" size="sm" onClick={onLinkEmail}>
                    <Link2 className="mr-1 size-3" />
                    Link an email
                  </Button>
                )
              }
            />
          )}
        </TabsContent>

        <TabsContent value="calendar" className="mt-4">
          {calendarEvents.length > 0 ? (
            <div className="space-y-2">
              {calendarEvents.map((event) => (
                <CalendarEventCard
                  key={event.id}
                  event={event}
                  onClick={onEventClick}
                  onUnlink={onUnlinkEvent}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<Calendar className="size-8" />}
              message="No linked calendar events"
              action={
                onLinkEvent && (
                  <Button variant="outline" size="sm" onClick={onLinkEvent}>
                    <Link2 className="mr-1 size-3" />
                    Link an event
                  </Button>
                )
              }
            />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function EmptyState({
  icon,
  message,
  action,
}: {
  icon: React.ReactNode;
  message: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-dashed p-6 text-center">
      <div className="mx-auto text-muted-foreground/50">{icon}</div>
      <p className="mt-2 text-sm text-muted-foreground">{message}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

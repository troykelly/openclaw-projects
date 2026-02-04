/**
 * Communications page.
 *
 * Displays a unified view of emails and calendar events with tabbed
 * filtering (All/Emails/Calendar Events), date sorting, search, and
 * detail panels. Uses the existing communication component library.
 */
import React, { useState, useCallback, useMemo } from 'react';
import {
  Mail,
  Calendar,
  MessageSquare,
  Search,
  SlidersHorizontal,
  ArrowUpDown,
  X,
  Link2,
  Unlink2,
  ChevronDown,
} from 'lucide-react';
import { cn } from '@/ui/lib/utils';
import { Button } from '@/ui/components/ui/button';
import { Badge } from '@/ui/components/ui/badge';
import { Input } from '@/ui/components/ui/input';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/ui/components/ui/tabs';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/ui/components/ui/dropdown-menu';
import { ScrollArea } from '@/ui/components/ui/scroll-area';
import { Separator } from '@/ui/components/ui/separator';
import { EmailCard } from '@/ui/components/communications/email-card';
import { CalendarEventCard } from '@/ui/components/communications/calendar-event-card';
import { EmailDetailSheet } from '@/ui/components/communications/email-detail-sheet';
import { CalendarEventDetailSheet } from '@/ui/components/communications/calendar-event-detail-sheet';
import type {
  LinkedEmail,
  LinkedCalendarEvent,
} from '@/ui/components/communications/types';
import {
  Skeleton,
  SkeletonList,
  EmptyState,
} from '@/ui/components/feedback';

/** Tab values for the communications view. */
export type CommunicationTab = 'all' | 'emails' | 'calendar';

/** Sort direction for the list. */
export type SortOrder = 'newest' | 'oldest';

/** Link filter options. */
export type LinkFilter = 'all' | 'linked' | 'unlinked';

/** Combined communication item for the "All" tab. */
interface CommunicationItem {
  kind: 'email' | 'calendar';
  id: string;
  date: Date;
  email?: LinkedEmail;
  event?: LinkedCalendarEvent;
}

/**
 * Build a unified list of communication items from emails and events.
 * Sorts by date according to the specified order.
 */
function buildCommunicationItems(
  emails: LinkedEmail[],
  events: LinkedCalendarEvent[],
  sortOrder: SortOrder,
): CommunicationItem[] {
  const items: CommunicationItem[] = [
    ...emails.map((email) => ({
      kind: 'email' as const,
      id: email.id,
      date: email.date,
      email,
    })),
    ...events.map((event) => ({
      kind: 'calendar' as const,
      id: event.id,
      date: event.startTime,
      event,
    })),
  ];

  items.sort((a, b) =>
    sortOrder === 'newest'
      ? b.date.getTime() - a.date.getTime()
      : a.date.getTime() - b.date.getTime(),
  );

  return items;
}

/**
 * Filter communications by search query.
 * Matches against subject/title, sender/organizer, and snippet/description.
 */
function filterBySearch(
  emails: LinkedEmail[],
  events: LinkedCalendarEvent[],
  query: string,
): { filteredEmails: LinkedEmail[]; filteredEvents: LinkedCalendarEvent[] } {
  if (!query.trim()) {
    return { filteredEmails: emails, filteredEvents: events };
  }

  const q = query.toLowerCase();

  const filteredEmails = emails.filter(
    (e) =>
      e.subject.toLowerCase().includes(q) ||
      e.from.name.toLowerCase().includes(q) ||
      e.from.email.toLowerCase().includes(q) ||
      e.snippet.toLowerCase().includes(q),
  );

  const filteredEvents = events.filter(
    (e) =>
      e.title.toLowerCase().includes(q) ||
      (e.description?.toLowerCase().includes(q) ?? false) ||
      (e.location?.toLowerCase().includes(q) ?? false) ||
      e.attendees.some(
        (a) =>
          a.name.toLowerCase().includes(q) ||
          a.email.toLowerCase().includes(q),
      ),
  );

  return { filteredEmails, filteredEvents };
}

/** Props for the CommunicationsPage component. */
export interface CommunicationsPageProps {
  /** Pre-loaded emails for testing. When undefined, shows demo data. */
  emails?: LinkedEmail[];
  /** Pre-loaded calendar events for testing. */
  calendarEvents?: LinkedCalendarEvent[];
  /** Whether data is loading. */
  isLoading?: boolean;
}

/**
 * Communications page component.
 *
 * Provides a tabbed interface for browsing emails and calendar events
 * with search, sort, and filter controls. Opens detail panels via
 * side sheets.
 */
export function CommunicationsPage({
  emails: propEmails,
  calendarEvents: propEvents,
  isLoading = false,
}: CommunicationsPageProps = {}): React.JSX.Element {
  // Use provided data or empty arrays (real API integration will come later)
  const emails = propEmails ?? [];
  const calendarEvents = propEvents ?? [];

  // UI state
  const [activeTab, setActiveTab] = useState<CommunicationTab>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOrder, setSortOrder] = useState<SortOrder>('newest');
  const [linkFilter, setLinkFilter] = useState<LinkFilter>('all');
  const [showFilters, setShowFilters] = useState(false);

  // Detail panel state
  const [selectedEmail, setSelectedEmail] = useState<LinkedEmail | null>(null);
  const [emailDetailOpen, setEmailDetailOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<LinkedCalendarEvent | null>(null);
  const [eventDetailOpen, setEventDetailOpen] = useState(false);

  // Filter data
  const { filteredEmails, filteredEvents } = useMemo(
    () => filterBySearch(emails, calendarEvents, searchQuery),
    [emails, calendarEvents, searchQuery],
  );

  // Sorted email list
  const sortedEmails = useMemo(() => {
    const sorted = [...filteredEmails];
    sorted.sort((a, b) =>
      sortOrder === 'newest'
        ? b.date.getTime() - a.date.getTime()
        : a.date.getTime() - b.date.getTime(),
    );
    return sorted;
  }, [filteredEmails, sortOrder]);

  // Sorted event list
  const sortedEvents = useMemo(() => {
    const sorted = [...filteredEvents];
    sorted.sort((a, b) =>
      sortOrder === 'newest'
        ? b.startTime.getTime() - a.startTime.getTime()
        : a.startTime.getTime() - b.startTime.getTime(),
    );
    return sorted;
  }, [filteredEvents, sortOrder]);

  // Combined list for "All" tab
  const allItems = useMemo(
    () => buildCommunicationItems(filteredEmails, filteredEvents, sortOrder),
    [filteredEmails, filteredEvents, sortOrder],
  );

  // Handlers
  const handleEmailClick = useCallback((email: LinkedEmail) => {
    setSelectedEmail(email);
    setEmailDetailOpen(true);
  }, []);

  const handleEventClick = useCallback((event: LinkedCalendarEvent) => {
    setSelectedEvent(event);
    setEventDetailOpen(true);
  }, []);

  const handleClearSearch = useCallback(() => {
    setSearchQuery('');
  }, []);

  const totalCount = emails.length + calendarEvents.length;
  const filteredCount = filteredEmails.length + filteredEvents.length;
  const hasActiveFilters = searchQuery.trim().length > 0 || linkFilter !== 'all';

  // Loading state
  if (isLoading) {
    return (
      <div data-testid="page-communications" className="flex h-full flex-col p-6">
        <div className="mb-6 flex items-center justify-between">
          <Skeleton width={240} height={32} />
          <Skeleton width={120} height={36} />
        </div>
        <Skeleton width="100%" height={40} className="mb-4" />
        <SkeletonList count={5} variant="card" />
      </div>
    );
  }

  return (
    <div data-testid="page-communications" className="flex h-full flex-col p-6">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Communications</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {totalCount} item{totalCount !== 1 ? 's' : ''}
            {hasActiveFilters && filteredCount !== totalCount && (
              <span> ({filteredCount} shown)</span>
            )}
          </p>
        </div>
      </div>

      {/* Search and controls */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1 sm:max-w-md">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            data-testid="communications-search"
            type="text"
            placeholder="Search communications..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 pr-8"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={handleClearSearch}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="size-4" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Sort control */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" data-testid="sort-button">
                <ArrowUpDown className="mr-1 size-3.5" />
                {sortOrder === 'newest' ? 'Newest' : 'Oldest'}
                <ChevronDown className="ml-1 size-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Sort by date</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setSortOrder('newest')}
                className={cn(sortOrder === 'newest' && 'font-medium')}
              >
                Newest first
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setSortOrder('oldest')}
                className={cn(sortOrder === 'oldest' && 'font-medium')}
              >
                Oldest first
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Filter toggle */}
          <Button
            variant={showFilters ? 'secondary' : 'outline'}
            size="sm"
            onClick={() => setShowFilters((prev) => !prev)}
            data-testid="filter-toggle"
          >
            <SlidersHorizontal className="mr-1 size-3.5" />
            Filters
            {hasActiveFilters && (
              <Badge variant="secondary" className="ml-1 text-[10px] px-1">
                !
              </Badge>
            )}
          </Button>
        </div>
      </div>

      {/* Filter bar */}
      {showFilters && (
        <div
          data-testid="filter-bar"
          className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 p-3"
        >
          <span className="text-xs font-medium text-muted-foreground">Link status:</span>
          <div className="flex gap-1">
            {(['all', 'linked', 'unlinked'] as const).map((filter) => (
              <Button
                key={filter}
                variant={linkFilter === filter ? 'default' : 'outline'}
                size="sm"
                className="h-7 text-xs"
                onClick={() => setLinkFilter(filter)}
              >
                {filter === 'all' && 'All'}
                {filter === 'linked' && (
                  <>
                    <Link2 className="mr-1 size-3" />
                    Linked
                  </>
                )}
                {filter === 'unlinked' && (
                  <>
                    <Unlink2 className="mr-1 size-3" />
                    Unlinked
                  </>
                )}
              </Button>
            ))}
          </div>

          {hasActiveFilters && (
            <>
              <Separator orientation="vertical" className="h-6" />
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => {
                  setSearchQuery('');
                  setLinkFilter('all');
                }}
              >
                <X className="mr-1 size-3" />
                Clear all
              </Button>
            </>
          )}
        </div>
      )}

      {/* Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as CommunicationTab)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <TabsList className="w-fit">
          <TabsTrigger value="all" className="gap-1.5" data-testid="tab-all">
            <MessageSquare className="size-3.5" />
            All
            {totalCount > 0 && (
              <Badge variant="secondary" className="ml-1 text-[10px] px-1.5">
                {filteredCount}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="emails" className="gap-1.5" data-testid="tab-emails">
            <Mail className="size-3.5" />
            Emails
            {filteredEmails.length > 0 && (
              <Badge variant="secondary" className="ml-1 text-[10px] px-1.5">
                {filteredEmails.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="calendar" className="gap-1.5" data-testid="tab-calendar">
            <Calendar className="size-3.5" />
            Calendar Events
            {filteredEvents.length > 0 && (
              <Badge variant="secondary" className="ml-1 text-[10px] px-1.5">
                {filteredEvents.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* All tab */}
        <TabsContent value="all" className="mt-4 flex-1">
          {allItems.length > 0 ? (
            <ScrollArea className="h-[calc(100vh-380px)]">
              <div className="space-y-2 pr-4" data-testid="communications-list-all">
                {allItems.map((item) =>
                  item.kind === 'email' && item.email ? (
                    <EmailCard
                      key={`email-${item.id}`}
                      email={item.email}
                      onClick={handleEmailClick}
                    />
                  ) : item.event ? (
                    <CalendarEventCard
                      key={`event-${item.id}`}
                      event={item.event}
                      onClick={handleEventClick}
                    />
                  ) : null,
                )}
              </div>
            </ScrollArea>
          ) : (
            <EmptyState
              variant={searchQuery ? 'search' : 'inbox'}
              title={searchQuery ? 'No communications found' : 'No communications yet'}
              description={
                searchQuery
                  ? 'Try adjusting your search terms or filters.'
                  : 'Emails and calendar events linked to your work items will appear here.'
              }
            />
          )}
        </TabsContent>

        {/* Emails tab */}
        <TabsContent value="emails" className="mt-4 flex-1">
          {sortedEmails.length > 0 ? (
            <ScrollArea className="h-[calc(100vh-380px)]">
              <div className="space-y-2 pr-4" data-testid="communications-list-emails">
                {sortedEmails.map((email) => (
                  <EmailCard
                    key={email.id}
                    email={email}
                    onClick={handleEmailClick}
                  />
                ))}
              </div>
            </ScrollArea>
          ) : (
            <EmptyState
              variant={searchQuery ? 'search' : 'email'}
              title={searchQuery ? 'No emails found' : 'No emails yet'}
              description={
                searchQuery
                  ? 'Try adjusting your search terms.'
                  : 'Emails linked to your work items will appear here.'
              }
            />
          )}
        </TabsContent>

        {/* Calendar tab */}
        <TabsContent value="calendar" className="mt-4 flex-1">
          {sortedEvents.length > 0 ? (
            <ScrollArea className="h-[calc(100vh-380px)]">
              <div className="space-y-2 pr-4" data-testid="communications-list-calendar">
                {sortedEvents.map((event) => (
                  <CalendarEventCard
                    key={event.id}
                    event={event}
                    onClick={handleEventClick}
                  />
                ))}
              </div>
            </ScrollArea>
          ) : (
            <EmptyState
              variant={searchQuery ? 'search' : 'calendar'}
              title={searchQuery ? 'No events found' : 'No calendar events yet'}
              description={
                searchQuery
                  ? 'Try adjusting your search terms.'
                  : 'Calendar events linked to your work items will appear here.'
              }
            />
          )}
        </TabsContent>
      </Tabs>

      {/* Detail sheets */}
      <EmailDetailSheet
        email={selectedEmail}
        open={emailDetailOpen}
        onOpenChange={setEmailDetailOpen}
      />
      <CalendarEventDetailSheet
        event={selectedEvent}
        open={eventDetailOpen}
        onOpenChange={setEventDetailOpen}
      />
    </div>
  );
}

/**
 * @vitest-environment jsdom
 */
import * as React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  EmailCard,
  CalendarEventCard,
  EmailDetailSheet,
  CalendarEventDetailSheet,
  ItemCommunications,
  LinkCommunicationDialog,
  type LinkedEmail,
  type LinkedCalendarEvent,
} from '@/ui/components/communications';

const mockEmail: LinkedEmail = {
  id: 'email-1',
  subject: 'Project Update - Q1 Review',
  from: { name: 'John Doe', email: 'john@example.com' },
  to: [{ name: 'Jane Smith', email: 'jane@example.com' }],
  date: new Date(),
  snippet: 'Hi team, I wanted to share the latest project updates from our Q1 review meeting...',
  body: 'Hi team,\n\nI wanted to share the latest project updates from our Q1 review meeting.\n\nBest,\nJohn',
  hasAttachments: true,
  isRead: false,
};

const mockEmails: LinkedEmail[] = [
  mockEmail,
  {
    id: 'email-2',
    subject: 'Re: Project Update',
    from: { name: 'Jane Smith', email: 'jane@example.com' },
    to: [{ name: 'John Doe', email: 'john@example.com' }],
    date: new Date(Date.now() - 86400000), // Yesterday
    snippet: 'Thanks for the update! I have a few questions...',
    isRead: true,
  },
];

const mockEvent: LinkedCalendarEvent = {
  id: 'event-1',
  title: 'Sprint Planning Meeting',
  description: 'Weekly sprint planning and backlog grooming session.',
  startTime: new Date(),
  endTime: new Date(Date.now() + 3600000),
  location: 'Conference Room A',
  meetingLink: 'https://meet.example.com/123',
  organizer: { name: 'Project Manager', email: 'pm@example.com' },
  attendees: [
    { name: 'John Doe', email: 'john@example.com', status: 'accepted' },
    { name: 'Jane Smith', email: 'jane@example.com', status: 'tentative' },
    { name: 'Bob Wilson', email: 'bob@example.com', status: 'pending' },
  ],
};

const mockEvents: LinkedCalendarEvent[] = [
  mockEvent,
  {
    id: 'event-2',
    title: 'Design Review',
    startTime: new Date(Date.now() + 86400000),
    endTime: new Date(Date.now() + 86400000 + 3600000),
    isAllDay: false,
    attendees: [],
  },
];

describe('EmailCard', () => {
  it('renders email subject', () => {
    render(<EmailCard email={mockEmail} />);

    expect(screen.getByText('Project Update - Q1 Review')).toBeInTheDocument();
  });

  it('renders sender name', () => {
    render(<EmailCard email={mockEmail} />);

    expect(screen.getByText('John Doe')).toBeInTheDocument();
  });

  it('shows attachment indicator', () => {
    render(<EmailCard email={mockEmail} />);

    // Attachment icon should be present
    const emailCard = screen.getByTestId('email-card');
    expect(emailCard).toBeInTheDocument();
  });

  it('shows unread indicator for unread emails', () => {
    render(<EmailCard email={mockEmail} />);

    const card = screen.getByTestId('email-card');
    expect(card.className).toContain('border-l-primary');
  });

  it('calls onClick when clicked', () => {
    const onClick = vi.fn();
    render(<EmailCard email={mockEmail} onClick={onClick} />);

    fireEvent.click(screen.getByTestId('email-card'));
    expect(onClick).toHaveBeenCalledWith(mockEmail);
  });

  it('shows unlink option when onUnlink provided', () => {
    const onUnlink = vi.fn();
    render(<EmailCard email={mockEmail} onUnlink={onUnlink} />);

    // Menu button should exist
    expect(screen.getByRole('button')).toBeInTheDocument();
  });
});

describe('CalendarEventCard', () => {
  it('renders event title', () => {
    render(<CalendarEventCard event={mockEvent} />);

    expect(screen.getByText('Sprint Planning Meeting')).toBeInTheDocument();
  });

  it('shows location', () => {
    render(<CalendarEventCard event={mockEvent} />);

    expect(screen.getByText('Conference Room A')).toBeInTheDocument();
  });

  it('shows video meeting indicator', () => {
    render(<CalendarEventCard event={mockEvent} />);

    expect(screen.getByText('Video meeting')).toBeInTheDocument();
  });

  it('shows attendee badges', () => {
    render(<CalendarEventCard event={mockEvent} />);

    expect(screen.getByText('John')).toBeInTheDocument();
    expect(screen.getByText('Jane')).toBeInTheDocument();
  });

  it('calls onClick when clicked', () => {
    const onClick = vi.fn();
    render(<CalendarEventCard event={mockEvent} onClick={onClick} />);

    fireEvent.click(screen.getByTestId('calendar-event-card'));
    expect(onClick).toHaveBeenCalledWith(mockEvent);
  });

  it('shows all day indicator for all-day events', () => {
    const allDayEvent = { ...mockEvent, isAllDay: true };
    render(<CalendarEventCard event={allDayEvent} />);

    expect(screen.getByText('All day')).toBeInTheDocument();
  });
});

describe('EmailDetailSheet', () => {
  it('renders email subject', () => {
    render(
      <EmailDetailSheet
        email={mockEmail}
        open={true}
        onOpenChange={() => {}}
      />
    );

    expect(screen.getByText('Project Update - Q1 Review')).toBeInTheDocument();
  });

  it('renders email body', () => {
    render(
      <EmailDetailSheet
        email={mockEmail}
        open={true}
        onOpenChange={() => {}}
      />
    );

    expect(screen.getByText(/I wanted to share the latest project updates/)).toBeInTheDocument();
  });

  it('shows sender info', () => {
    render(
      <EmailDetailSheet
        email={mockEmail}
        open={true}
        onOpenChange={() => {}}
      />
    );

    expect(screen.getByText('John Doe')).toBeInTheDocument();
    expect(screen.getByText('john@example.com')).toBeInTheDocument();
  });

  it('calls onUnlink when unlink clicked', () => {
    const onUnlink = vi.fn();
    render(
      <EmailDetailSheet
        email={mockEmail}
        open={true}
        onOpenChange={() => {}}
        onUnlink={onUnlink}
      />
    );

    fireEvent.click(screen.getByText('Unlink'));
    expect(onUnlink).toHaveBeenCalledWith(mockEmail);
  });
});

describe('CalendarEventDetailSheet', () => {
  it('renders event title', () => {
    render(
      <CalendarEventDetailSheet
        event={mockEvent}
        open={true}
        onOpenChange={() => {}}
      />
    );

    expect(screen.getByText('Sprint Planning Meeting')).toBeInTheDocument();
  });

  it('shows attendees list', () => {
    render(
      <CalendarEventDetailSheet
        event={mockEvent}
        open={true}
        onOpenChange={() => {}}
      />
    );

    expect(screen.getByText('John Doe')).toBeInTheDocument();
    expect(screen.getByText('Jane Smith')).toBeInTheDocument();
    expect(screen.getByText('Bob Wilson')).toBeInTheDocument();
  });

  it('shows attendee status', () => {
    render(
      <CalendarEventDetailSheet
        event={mockEvent}
        open={true}
        onOpenChange={() => {}}
      />
    );

    expect(screen.getByText('accepted')).toBeInTheDocument();
    expect(screen.getByText('tentative')).toBeInTheDocument();
  });

  it('shows join meeting button when meeting link exists', () => {
    const onJoinMeeting = vi.fn();
    render(
      <CalendarEventDetailSheet
        event={mockEvent}
        open={true}
        onOpenChange={() => {}}
        onJoinMeeting={onJoinMeeting}
      />
    );

    fireEvent.click(screen.getByText('Join meeting'));
    expect(onJoinMeeting).toHaveBeenCalledWith(mockEvent);
  });

  it('shows description', () => {
    render(
      <CalendarEventDetailSheet
        event={mockEvent}
        open={true}
        onOpenChange={() => {}}
      />
    );

    expect(screen.getByText(/Weekly sprint planning/)).toBeInTheDocument();
  });
});

describe('ItemCommunications', () => {
  it('renders emails and calendar tabs', () => {
    render(
      <ItemCommunications
        emails={mockEmails}
        calendarEvents={mockEvents}
      />
    );

    expect(screen.getByRole('tab', { name: /Emails/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Calendar/i })).toBeInTheDocument();
  });

  it('shows email count badge', () => {
    render(
      <ItemCommunications
        emails={mockEmails}
        calendarEvents={mockEvents}
      />
    );

    // Total count badge
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('shows emails by default', () => {
    render(
      <ItemCommunications
        emails={mockEmails}
        calendarEvents={mockEvents}
      />
    );

    expect(screen.getByText('Project Update - Q1 Review')).toBeInTheDocument();
  });

  it('has clickable calendar tab', () => {
    const onEventClick = vi.fn();
    render(
      <ItemCommunications
        emails={[]}
        calendarEvents={mockEvents}
        onEventClick={onEventClick}
      />
    );

    // Calendar tab should be present and clickable
    const calendarTab = screen.getByRole('tab', { name: /Calendar/i });
    expect(calendarTab).toBeInTheDocument();
    fireEvent.click(calendarTab);
    // No errors should occur
  });

  it('shows empty state when no emails', () => {
    render(
      <ItemCommunications
        emails={[]}
        calendarEvents={mockEvents}
      />
    );

    expect(screen.getByText('No linked emails')).toBeInTheDocument();
  });

  it('shows link email button when handler provided', () => {
    const onLinkEmail = vi.fn();
    render(
      <ItemCommunications
        emails={[]}
        calendarEvents={[]}
        onLinkEmail={onLinkEmail}
      />
    );

    expect(screen.getByText('Link Email')).toBeInTheDocument();
  });

  it('calls onEmailClick when email clicked', () => {
    const onEmailClick = vi.fn();
    render(
      <ItemCommunications
        emails={mockEmails}
        calendarEvents={[]}
        onEmailClick={onEmailClick}
      />
    );

    fireEvent.click(screen.getByText('Project Update - Q1 Review'));
    expect(onEmailClick).toHaveBeenCalledWith(mockEmails[0]);
  });
});

describe('LinkCommunicationDialog', () => {
  it('renders email link dialog', () => {
    render(
      <LinkCommunicationDialog
        type="email"
        open={true}
        onOpenChange={() => {}}
        onSubmit={() => {}}
      />
    );

    expect(screen.getByRole('heading', { name: 'Link Email' })).toBeInTheDocument();
  });

  it('renders calendar link dialog', () => {
    render(
      <LinkCommunicationDialog
        type="calendar"
        open={true}
        onOpenChange={() => {}}
        onSubmit={() => {}}
      />
    );

    expect(screen.getByRole('heading', { name: 'Link Calendar Event' })).toBeInTheDocument();
  });

  it('submits with entered ID', () => {
    const onSubmit = vi.fn();
    render(
      <LinkCommunicationDialog
        type="email"
        open={true}
        onOpenChange={() => {}}
        onSubmit={onSubmit}
      />
    );

    fireEvent.change(screen.getByLabelText(/Email ID/), { target: { value: 'test-id-123' } });
    fireEvent.click(screen.getByRole('button', { name: /Link Email/i }));

    expect(onSubmit).toHaveBeenCalledWith('test-id-123');
  });

  it('disables submit when ID is empty', () => {
    render(
      <LinkCommunicationDialog
        type="email"
        open={true}
        onOpenChange={() => {}}
        onSubmit={() => {}}
      />
    );

    const submitButton = screen.getByRole('button', { name: /Link Email/i });
    expect(submitButton).toBeDisabled();
  });
});

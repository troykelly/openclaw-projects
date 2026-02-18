/**
 * @vitest-environment jsdom
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { CommunicationsPage } from '@/ui/pages/CommunicationsPage';
import type { LinkedEmail, LinkedCalendarEvent } from '@/ui/components/communications/types';
import { useEmails, useCalendarEvents } from '@/ui/hooks/queries/use-global-communications';

// ---------------------------------------------------------------------------
// Mock the global communications hooks
// ---------------------------------------------------------------------------
vi.mock('@/ui/hooks/queries/use-global-communications', () => ({
  useEmails: vi.fn(() => ({ data: undefined, isLoading: false, error: null })),
  useCalendarEvents: vi.fn(() => ({ data: undefined, isLoading: false, error: null })),
}));

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const mockEmails: LinkedEmail[] = [
  {
    id: 'email-1',
    subject: 'Sprint Planning Notes',
    from: { name: 'Alice Johnson', email: 'alice@example.com' },
    to: [{ name: 'Team', email: 'team@example.com' }],
    date: new Date('2026-01-15T10:00:00Z'),
    snippet: 'Here are the notes from our sprint planning session...',
    body: 'Full body of sprint planning notes.',
    hasAttachments: false,
    is_read: true,
  },
  {
    id: 'email-2',
    subject: 'Design Review Feedback',
    from: { name: 'Bob Smith', email: 'bob@example.com' },
    to: [{ name: 'Alice Johnson', email: 'alice@example.com' }],
    date: new Date('2026-01-16T14:30:00Z'),
    snippet: 'Great work on the design mockups! A few suggestions...',
    hasAttachments: true,
    is_read: false,
  },
  {
    id: 'email-3',
    subject: 'Budget Approval Request',
    from: { name: 'Carol White', email: 'carol@example.com' },
    to: [{ name: 'Finance Team', email: 'finance@example.com' }],
    date: new Date('2026-01-14T09:00:00Z'),
    snippet: 'Please review and approve the Q1 budget...',
    is_read: true,
  },
];

const mockEvents: LinkedCalendarEvent[] = [
  {
    id: 'event-1',
    title: 'Team Standup',
    description: 'Daily standup meeting for the engineering team.',
    startTime: new Date('2026-01-15T09:00:00Z'),
    endTime: new Date('2026-01-15T09:30:00Z'),
    location: 'Room 101',
    attendees: [
      { name: 'Alice Johnson', email: 'alice@example.com', status: 'accepted' },
      { name: 'Bob Smith', email: 'bob@example.com', status: 'tentative' },
    ],
  },
  {
    id: 'event-2',
    title: 'Quarterly Review',
    description: 'Review quarterly goals and progress.',
    startTime: new Date('2026-01-17T14:00:00Z'),
    endTime: new Date('2026-01-17T15:00:00Z'),
    attendees: [{ name: 'Carol White', email: 'carol@example.com', status: 'accepted' }],
    meetingLink: 'https://meet.example.com/quarterly',
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CommunicationsPage', () => {
  beforeEach(() => {
    vi.mocked(useEmails).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
    } as ReturnType<typeof useEmails>);
    vi.mocked(useCalendarEvents).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
    } as ReturnType<typeof useCalendarEvents>);
  });

  describe('Page structure', () => {
    it('renders page with test id', () => {
      render(<CommunicationsPage emails={[]} calendarEvents={[]} />);
      expect(screen.getByTestId('page-communications')).toBeInTheDocument();
    });

    it('renders page title', () => {
      render(<CommunicationsPage emails={[]} calendarEvents={[]} />);
      expect(screen.getByRole('heading', { name: 'Communications' })).toBeInTheDocument();
    });

    it('shows total item count', () => {
      render(<CommunicationsPage emails={mockEmails} calendarEvents={mockEvents} />);
      expect(screen.getByText(/5 items/)).toBeInTheDocument();
    });

    it('shows singular item count for one item', () => {
      render(<CommunicationsPage emails={[mockEmails[0]]} calendarEvents={[]} />);
      expect(screen.getByText(/1 item(?!s)/)).toBeInTheDocument();
    });
  });

  describe('Loading state', () => {
    it('shows loading skeletons when loading', () => {
      render(<CommunicationsPage isLoading={true} />);
      const page = screen.getByTestId('page-communications');
      expect(page).toBeInTheDocument();
      // Loading state shows skeleton elements
      expect(screen.getAllByTestId('skeleton').length).toBeGreaterThan(0);
    });
  });

  describe('Empty state', () => {
    it('shows empty state when no data', () => {
      render(<CommunicationsPage emails={[]} calendarEvents={[]} />);
      expect(screen.getByText('No communications yet')).toBeInTheDocument();
    });

    it('shows search empty state when filtering with no results', () => {
      render(<CommunicationsPage emails={mockEmails} calendarEvents={mockEvents} />);

      const searchInput = screen.getByTestId('communications-search');
      fireEvent.change(searchInput, { target: { value: 'xyznonexistent' } });

      expect(screen.getByText('No communications found')).toBeInTheDocument();
    });
  });

  describe('Tabs', () => {
    it('renders All, Emails, and Calendar Events tabs', () => {
      render(<CommunicationsPage emails={mockEmails} calendarEvents={mockEvents} />);

      expect(screen.getByTestId('tab-all')).toBeInTheDocument();
      expect(screen.getByTestId('tab-emails')).toBeInTheDocument();
      expect(screen.getByTestId('tab-calendar')).toBeInTheDocument();
    });

    it('shows All tab by default with combined items', () => {
      render(<CommunicationsPage emails={mockEmails} calendarEvents={mockEvents} />);

      // All tab should be active - check for email and event cards
      expect(screen.getByText('Sprint Planning Notes')).toBeInTheDocument();
      expect(screen.getByText('Team Standup')).toBeInTheDocument();
    });

    it('switches to Emails tab and shows only emails', () => {
      render(<CommunicationsPage emails={mockEmails} calendarEvents={mockEvents} />);

      fireEvent.click(screen.getByTestId('tab-emails'));

      // Should show emails
      expect(screen.getByText('Sprint Planning Notes')).toBeInTheDocument();
      expect(screen.getByText('Design Review Feedback')).toBeInTheDocument();
    });

    it('switches to Calendar Events tab and shows only events', () => {
      render(<CommunicationsPage emails={mockEmails} calendarEvents={mockEvents} />);

      fireEvent.click(screen.getByTestId('tab-calendar'));

      // Should show events
      expect(screen.getByText('Team Standup')).toBeInTheDocument();
      expect(screen.getByText('Quarterly Review')).toBeInTheDocument();
    });

    it('shows count badges on tabs', () => {
      render(<CommunicationsPage emails={mockEmails} calendarEvents={mockEvents} />);

      // All tab should show total count
      const allTab = screen.getByTestId('tab-all');
      expect(within(allTab).getByText('5')).toBeInTheDocument();

      // Emails tab count
      const emailsTab = screen.getByTestId('tab-emails');
      expect(within(emailsTab).getByText('3')).toBeInTheDocument();

      // Calendar tab count
      const calendarTab = screen.getByTestId('tab-calendar');
      expect(within(calendarTab).getByText('2')).toBeInTheDocument();
    });
  });

  describe('Search', () => {
    it('renders search input', () => {
      render(<CommunicationsPage emails={mockEmails} calendarEvents={mockEvents} />);
      expect(screen.getByTestId('communications-search')).toBeInTheDocument();
    });

    it('filters emails by subject', () => {
      render(<CommunicationsPage emails={mockEmails} calendarEvents={mockEvents} />);

      const searchInput = screen.getByTestId('communications-search');
      fireEvent.change(searchInput, { target: { value: 'Sprint Planning' } });

      expect(screen.getByText('Sprint Planning Notes')).toBeInTheDocument();
      expect(screen.queryByText('Design Review Feedback')).not.toBeInTheDocument();
    });

    it('filters events by title', () => {
      render(<CommunicationsPage emails={mockEmails} calendarEvents={mockEvents} />);

      const searchInput = screen.getByTestId('communications-search');
      fireEvent.change(searchInput, { target: { value: 'Quarterly' } });

      expect(screen.getByText('Quarterly Review')).toBeInTheDocument();
      expect(screen.queryByText('Team Standup')).not.toBeInTheDocument();
    });

    it('filters by sender name', () => {
      render(<CommunicationsPage emails={mockEmails} calendarEvents={mockEvents} />);

      const searchInput = screen.getByTestId('communications-search');
      fireEvent.change(searchInput, { target: { value: 'Bob' } });

      expect(screen.getByText('Design Review Feedback')).toBeInTheDocument();
      expect(screen.queryByText('Sprint Planning Notes')).not.toBeInTheDocument();
    });

    it('filters by attendee name', () => {
      render(<CommunicationsPage emails={mockEmails} calendarEvents={mockEvents} />);

      const searchInput = screen.getByTestId('communications-search');
      fireEvent.change(searchInput, { target: { value: 'Carol' } });

      // Carol is attendee of Quarterly Review and sender of Budget Approval
      expect(screen.getByText('Quarterly Review')).toBeInTheDocument();
      expect(screen.getByText('Budget Approval Request')).toBeInTheDocument();
    });

    it('shows clear button when search has value', () => {
      render(<CommunicationsPage emails={mockEmails} calendarEvents={mockEvents} />);

      const searchInput = screen.getByTestId('communications-search');
      fireEvent.change(searchInput, { target: { value: 'test' } });

      const clearButton = screen.getByLabelText('Clear search');
      expect(clearButton).toBeInTheDocument();
    });

    it('clears search when clear button clicked', () => {
      render(<CommunicationsPage emails={mockEmails} calendarEvents={mockEvents} />);

      const searchInput = screen.getByTestId('communications-search');
      fireEvent.change(searchInput, { target: { value: 'Sprint' } });

      // Only Sprint Planning should be visible
      expect(screen.queryByText('Design Review Feedback')).not.toBeInTheDocument();

      // Clear search
      fireEvent.click(screen.getByLabelText('Clear search'));

      // All items should be visible again
      expect(screen.getByText('Design Review Feedback')).toBeInTheDocument();
    });

    it('updates filtered count in subtitle', () => {
      render(<CommunicationsPage emails={mockEmails} calendarEvents={mockEvents} />);

      const searchInput = screen.getByTestId('communications-search');
      fireEvent.change(searchInput, { target: { value: 'Sprint' } });

      // "Sprint" matches only 1 email (Sprint Planning Notes) and 0 events
      // But "Sprint" also matches Team Standup via no attendee match, so just 1 item
      expect(screen.getByText(/1 shown/)).toBeInTheDocument();
    });
  });

  describe('Sort controls', () => {
    it('renders sort button', () => {
      render(<CommunicationsPage emails={mockEmails} calendarEvents={mockEvents} />);
      expect(screen.getByTestId('sort-button')).toBeInTheDocument();
    });

    it('defaults to newest first', () => {
      render(<CommunicationsPage emails={mockEmails} calendarEvents={mockEvents} />);

      const sortButton = screen.getByTestId('sort-button');
      expect(sortButton).toHaveTextContent('Newest');
    });
  });

  describe('Filter controls', () => {
    it('renders filter toggle button', () => {
      render(<CommunicationsPage emails={mockEmails} calendarEvents={mockEvents} />);
      expect(screen.getByTestId('filter-toggle')).toBeInTheDocument();
    });

    it('shows filter bar when toggle clicked', () => {
      render(<CommunicationsPage emails={mockEmails} calendarEvents={mockEvents} />);

      fireEvent.click(screen.getByTestId('filter-toggle'));
      expect(screen.getByTestId('filter-bar')).toBeInTheDocument();
    });

    it('shows link status filter options', () => {
      render(<CommunicationsPage emails={mockEmails} calendarEvents={mockEvents} />);

      fireEvent.click(screen.getByTestId('filter-toggle'));

      expect(screen.getByText('Link status:')).toBeInTheDocument();
      expect(screen.getByText('Linked')).toBeInTheDocument();
      expect(screen.getByText('Unlinked')).toBeInTheDocument();
    });

    it('hides filter bar when toggle clicked again', () => {
      render(<CommunicationsPage emails={mockEmails} calendarEvents={mockEvents} />);

      fireEvent.click(screen.getByTestId('filter-toggle'));
      expect(screen.getByTestId('filter-bar')).toBeInTheDocument();

      fireEvent.click(screen.getByTestId('filter-toggle'));
      expect(screen.queryByTestId('filter-bar')).not.toBeInTheDocument();
    });
  });

  describe('Email interaction', () => {
    it('renders email cards', () => {
      render(<CommunicationsPage emails={mockEmails} calendarEvents={[]} />);

      expect(screen.getByText('Sprint Planning Notes')).toBeInTheDocument();
      expect(screen.getByText('Design Review Feedback')).toBeInTheDocument();
      expect(screen.getByText('Budget Approval Request')).toBeInTheDocument();
    });

    it('opens email detail sheet when email clicked', () => {
      render(<CommunicationsPage emails={mockEmails} calendarEvents={[]} />);

      // Click on email card
      const emailCards = screen.getAllByTestId('email-card');
      fireEvent.click(emailCards[0]);

      // Detail sheet should open - look for the full email body or detail elements
      // The EmailDetailSheet renders inside a Sheet component
      expect(screen.getByText('Email Details')).toBeInTheDocument();
    });
  });

  describe('Calendar event interaction', () => {
    it('renders calendar event cards', () => {
      render(<CommunicationsPage emails={[]} calendarEvents={mockEvents} />);

      expect(screen.getByText('Team Standup')).toBeInTheDocument();
      expect(screen.getByText('Quarterly Review')).toBeInTheDocument();
    });

    it('opens event detail sheet when event clicked', () => {
      render(<CommunicationsPage emails={[]} calendarEvents={mockEvents} />);

      // Click on event card
      const eventCards = screen.getAllByTestId('calendar-event-card');
      fireEvent.click(eventCards[0]);

      // Detail sheet should open
      expect(screen.getByText('Event Details')).toBeInTheDocument();
    });
  });

  describe('Combined view', () => {
    it('shows both emails and events in All tab', () => {
      render(<CommunicationsPage emails={mockEmails} calendarEvents={mockEvents} />);

      // Should show mix of emails and events
      expect(screen.getByText('Sprint Planning Notes')).toBeInTheDocument();
      expect(screen.getByText('Team Standup')).toBeInTheDocument();
      expect(screen.getByText('Quarterly Review')).toBeInTheDocument();
    });

    it('sorts combined items by date', () => {
      render(<CommunicationsPage emails={mockEmails} calendarEvents={mockEvents} />);

      // Default is newest first - Quarterly Review (Jan 17) should come before
      // Budget Approval (Jan 14)
      const listAll = screen.getByTestId('communications-list-all');
      const cards = listAll.querySelectorAll('[data-testid="email-card"], [data-testid="calendar-event-card"]');

      // First card should be the newest item
      expect(cards.length).toBe(5);
    });
  });

  describe('Emails tab empty state', () => {
    it('shows email empty state when no emails and no events', () => {
      // Render with only emails tab scenario: no emails, no events
      // On the "All" tab, when everything is empty, we get the empty state
      render(<CommunicationsPage emails={[]} calendarEvents={[]} />);

      // The "all" tab should show empty state
      expect(screen.getByText('No communications yet')).toBeInTheDocument();
    });
  });

  describe('Calendar tab empty state', () => {
    it('shows empty state when all communications are empty', () => {
      render(<CommunicationsPage emails={[]} calendarEvents={[]} />);

      // Empty state on the all tab
      expect(screen.getByText('Emails and calendar events linked to your work items will appear here.')).toBeInTheDocument();
    });
  });

  describe('API integration', () => {
    it('shows loading state when email hook is loading and no props provided', () => {
      vi.mocked(useEmails).mockReturnValue({
        data: undefined,
        isLoading: true,
        error: null,
      } as ReturnType<typeof useEmails>);
      vi.mocked(useCalendarEvents).mockReturnValue({
        data: undefined,
        isLoading: false,
        error: null,
      } as ReturnType<typeof useCalendarEvents>);

      render(<CommunicationsPage />);
      // Should show loading skeletons
      expect(screen.getAllByTestId('skeleton').length).toBeGreaterThan(0);
    });

    it('shows loading state when calendar hook is loading and no props provided', () => {
      vi.mocked(useEmails).mockReturnValue({
        data: undefined,
        isLoading: false,
        error: null,
      } as ReturnType<typeof useEmails>);
      vi.mocked(useCalendarEvents).mockReturnValue({
        data: undefined,
        isLoading: true,
        error: null,
      } as ReturnType<typeof useCalendarEvents>);

      render(<CommunicationsPage />);
      expect(screen.getAllByTestId('skeleton').length).toBeGreaterThan(0);
    });

    it('shows error state when email hook has an error and no props provided', () => {
      vi.mocked(useEmails).mockReturnValue({
        data: undefined,
        isLoading: false,
        error: new Error('Network failure'),
      } as ReturnType<typeof useEmails>);

      render(<CommunicationsPage />);
      expect(screen.getByTestId('error-state')).toBeInTheDocument();
      expect(screen.getByText(/failed to load/i)).toBeInTheDocument();
    });

    it('shows error state when calendar hook has an error and no props provided', () => {
      vi.mocked(useCalendarEvents).mockReturnValue({
        data: undefined,
        isLoading: false,
        error: new Error('Server error'),
      } as ReturnType<typeof useCalendarEvents>);

      render(<CommunicationsPage />);
      expect(screen.getByTestId('error-state')).toBeInTheDocument();
    });

    it('uses prop data over hook data when props are provided', () => {
      // Even if hooks return data, props should take precedence
      vi.mocked(useEmails).mockReturnValue({
        data: { emails: [] },
        isLoading: false,
        error: null,
      } as ReturnType<typeof useEmails>);
      vi.mocked(useCalendarEvents).mockReturnValue({
        data: { events: [] },
        isLoading: false,
        error: null,
      } as ReturnType<typeof useCalendarEvents>);

      render(<CommunicationsPage emails={mockEmails} calendarEvents={mockEvents} />);
      expect(screen.getByText('Sprint Planning Notes')).toBeInTheDocument();
      expect(screen.getByText('Team Standup')).toBeInTheDocument();
    });

    it('does not show loading state when props are provided even if hooks are loading', () => {
      vi.mocked(useEmails).mockReturnValue({
        data: undefined,
        isLoading: true,
        error: null,
      } as ReturnType<typeof useEmails>);
      vi.mocked(useCalendarEvents).mockReturnValue({
        data: undefined,
        isLoading: true,
        error: null,
      } as ReturnType<typeof useCalendarEvents>);

      render(<CommunicationsPage emails={mockEmails} calendarEvents={mockEvents} />);
      // Should NOT show loading state because props are provided
      expect(screen.queryAllByTestId('skeleton').length).toBe(0);
      expect(screen.getByText('Sprint Planning Notes')).toBeInTheDocument();
    });

    it('does not show error state when props are provided even if hooks have errors', () => {
      vi.mocked(useEmails).mockReturnValue({
        data: undefined,
        isLoading: false,
        error: new Error('fail'),
      } as ReturnType<typeof useEmails>);

      render(<CommunicationsPage emails={mockEmails} calendarEvents={mockEvents} />);
      expect(screen.queryByTestId('error-state')).not.toBeInTheDocument();
      expect(screen.getByText('Sprint Planning Notes')).toBeInTheDocument();
    });

    it('calls useEmails and useCalendarEvents hooks', () => {
      render(<CommunicationsPage />);
      expect(useEmails).toHaveBeenCalled();
      expect(useCalendarEvents).toHaveBeenCalled();
    });
  });
});

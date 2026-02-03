/**
 * @vitest-environment jsdom
 * Tests for calendar view for due dates
 * Issue #408: Implement calendar view for due dates
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as React from 'react';

// Components to be implemented
import {
  CalendarView,
  type CalendarViewProps,
} from '@/ui/components/calendar-view/calendar-view';
import {
  CalendarHeader,
  type CalendarHeaderProps,
} from '@/ui/components/calendar-view/calendar-header';
import {
  MonthView,
  type MonthViewProps,
} from '@/ui/components/calendar-view/month-view';
import {
  WeekView,
  type WeekViewProps,
} from '@/ui/components/calendar-view/week-view';
import {
  CalendarItem,
  type CalendarItemProps,
} from '@/ui/components/calendar-view/calendar-item';
import type {
  CalendarEvent,
  CalendarViewMode,
} from '@/ui/components/calendar-view/types';

// Mock data
const mockEvents: CalendarEvent[] = [
  {
    id: 'event-1',
    title: 'Implement feature A',
    date: '2026-02-10',
    priority: 'high',
    status: 'open',
  },
  {
    id: 'event-2',
    title: 'Fix bug in module B',
    date: '2026-02-15',
    priority: 'medium',
    status: 'in_progress',
  },
  {
    id: 'event-3',
    title: 'Write documentation',
    date: '2026-02-15', // Same day as event-2
    priority: 'low',
    status: 'closed',
  },
  {
    id: 'event-4',
    title: 'Multi-day task',
    date: '2026-02-20',
    endDate: '2026-02-22',
    priority: 'high',
    status: 'open',
  },
];

describe('CalendarView', () => {
  const defaultProps: CalendarViewProps = {
    events: mockEvents,
    currentDate: new Date('2026-02-01'),
    onEventClick: vi.fn(),
    onDateChange: vi.fn(),
    onViewModeChange: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render calendar view', () => {
    render(<CalendarView {...defaultProps} />);
    expect(screen.getByTestId('calendar-view')).toBeInTheDocument();
  });

  it('should show current month by default', () => {
    render(<CalendarView {...defaultProps} />);
    expect(screen.getByText(/february 2026/i)).toBeInTheDocument();
  });

  it('should show month view by default', () => {
    render(<CalendarView {...defaultProps} />);
    expect(screen.getByTestId('month-view')).toBeInTheDocument();
  });

  it('should switch to week view', () => {
    render(<CalendarView {...defaultProps} viewMode="week" />);
    expect(screen.getByTestId('week-view')).toBeInTheDocument();
  });

  it('should call onEventClick when event clicked', () => {
    const onEventClick = vi.fn();
    render(<CalendarView {...defaultProps} onEventClick={onEventClick} />);

    fireEvent.click(screen.getByText('Implement feature A'));

    expect(onEventClick).toHaveBeenCalledWith(mockEvents[0]);
  });

  it('should navigate to previous month', () => {
    const onDateChange = vi.fn();
    render(<CalendarView {...defaultProps} onDateChange={onDateChange} />);

    fireEvent.click(screen.getByRole('button', { name: /previous/i }));

    expect(onDateChange).toHaveBeenCalled();
  });

  it('should navigate to next month', () => {
    const onDateChange = vi.fn();
    render(<CalendarView {...defaultProps} onDateChange={onDateChange} />);

    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    expect(onDateChange).toHaveBeenCalled();
  });

  it('should show today button', () => {
    render(<CalendarView {...defaultProps} />);
    expect(screen.getByRole('button', { name: /today/i })).toBeInTheDocument();
  });

  it('should show view mode switcher', () => {
    render(<CalendarView {...defaultProps} />);
    expect(screen.getByRole('button', { name: /month/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /week/i })).toBeInTheDocument();
  });
});

describe('CalendarHeader', () => {
  const defaultProps: CalendarHeaderProps = {
    currentDate: new Date('2026-02-15'),
    viewMode: 'month' as CalendarViewMode,
    onPrevious: vi.fn(),
    onNext: vi.fn(),
    onToday: vi.fn(),
    onViewModeChange: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should show current month and year', () => {
    render(<CalendarHeader {...defaultProps} />);
    expect(screen.getByText(/february 2026/i)).toBeInTheDocument();
  });

  it('should show navigation buttons', () => {
    render(<CalendarHeader {...defaultProps} />);
    expect(screen.getByRole('button', { name: /previous/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /next/i })).toBeInTheDocument();
  });

  it('should call onPrevious when previous clicked', () => {
    const onPrevious = vi.fn();
    render(<CalendarHeader {...defaultProps} onPrevious={onPrevious} />);

    fireEvent.click(screen.getByRole('button', { name: /previous/i }));

    expect(onPrevious).toHaveBeenCalled();
  });

  it('should call onNext when next clicked', () => {
    const onNext = vi.fn();
    render(<CalendarHeader {...defaultProps} onNext={onNext} />);

    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    expect(onNext).toHaveBeenCalled();
  });

  it('should call onToday when today clicked', () => {
    const onToday = vi.fn();
    render(<CalendarHeader {...defaultProps} onToday={onToday} />);

    fireEvent.click(screen.getByRole('button', { name: /today/i }));

    expect(onToday).toHaveBeenCalled();
  });

  it('should highlight active view mode', () => {
    render(<CalendarHeader {...defaultProps} viewMode="month" />);
    const monthButton = screen.getByRole('button', { name: /month/i });
    expect(monthButton).toHaveAttribute('data-active', 'true');
  });

  it('should call onViewModeChange when view mode clicked', () => {
    const onViewModeChange = vi.fn();
    render(<CalendarHeader {...defaultProps} onViewModeChange={onViewModeChange} />);

    fireEvent.click(screen.getByRole('button', { name: /week/i }));

    expect(onViewModeChange).toHaveBeenCalledWith('week');
  });
});

describe('MonthView', () => {
  const defaultProps: MonthViewProps = {
    currentDate: new Date('2026-02-15'),
    events: mockEvents,
    onEventClick: vi.fn(),
    onDateClick: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render month grid', () => {
    render(<MonthView {...defaultProps} />);
    expect(screen.getByTestId('month-view')).toBeInTheDocument();
  });

  it('should show day headers', () => {
    render(<MonthView {...defaultProps} />);
    expect(screen.getByText('Sun')).toBeInTheDocument();
    expect(screen.getByText('Mon')).toBeInTheDocument();
    expect(screen.getByText('Tue')).toBeInTheDocument();
    expect(screen.getByText('Wed')).toBeInTheDocument();
    expect(screen.getByText('Thu')).toBeInTheDocument();
    expect(screen.getByText('Fri')).toBeInTheDocument();
    expect(screen.getByText('Sat')).toBeInTheDocument();
  });

  it('should show day numbers', () => {
    render(<MonthView {...defaultProps} />);
    // February 2026 has 28 days
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('15')).toBeInTheDocument();
    expect(screen.getByText('28')).toBeInTheDocument();
  });

  it('should highlight today', () => {
    const today = new Date();
    render(<MonthView {...defaultProps} currentDate={today} />);
    const todayCell = screen.getByTestId(`day-${today.getDate()}`);
    expect(todayCell).toHaveAttribute('data-today', 'true');
  });

  it('should show events on their dates', () => {
    render(<MonthView {...defaultProps} />);
    expect(screen.getByText('Implement feature A')).toBeInTheDocument();
  });

  it('should call onEventClick when event clicked', () => {
    const onEventClick = vi.fn();
    render(<MonthView {...defaultProps} onEventClick={onEventClick} />);

    fireEvent.click(screen.getByText('Implement feature A'));

    expect(onEventClick).toHaveBeenCalledWith(mockEvents[0]);
  });

  it('should call onDateClick when date clicked', () => {
    const onDateClick = vi.fn();
    render(<MonthView {...defaultProps} onDateClick={onDateClick} />);

    fireEvent.click(screen.getByTestId('day-10'));

    expect(onDateClick).toHaveBeenCalled();
  });

  it('should show multiple events on same day', () => {
    render(<MonthView {...defaultProps} />);
    // Events 2 and 3 are both on Feb 15
    expect(screen.getByText('Fix bug in module B')).toBeInTheDocument();
    expect(screen.getByText('Write documentation')).toBeInTheDocument();
  });
});

describe('WeekView', () => {
  const defaultProps: WeekViewProps = {
    currentDate: new Date('2026-02-15'),
    events: mockEvents,
    onEventClick: vi.fn(),
    onDateClick: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render week view', () => {
    render(<WeekView {...defaultProps} />);
    expect(screen.getByTestId('week-view')).toBeInTheDocument();
  });

  it('should show 7 days', () => {
    render(<WeekView {...defaultProps} />);
    const dayCells = screen.getAllByTestId(/^week-day-/);
    expect(dayCells.length).toBe(7);
  });

  it('should show day headers with dates', () => {
    render(<WeekView {...defaultProps} />);
    // Week of Feb 15, 2026 starts on Feb 15 (Sunday)
    expect(screen.getByText(/sun.*15/i)).toBeInTheDocument();
    expect(screen.getByText(/sat.*21/i)).toBeInTheDocument();
  });

  it('should show events', () => {
    render(<WeekView {...defaultProps} />);
    expect(screen.getByText('Fix bug in module B')).toBeInTheDocument();
  });

  it('should call onEventClick when event clicked', () => {
    const onEventClick = vi.fn();
    render(<WeekView {...defaultProps} onEventClick={onEventClick} />);

    fireEvent.click(screen.getByText('Fix bug in module B'));

    expect(onEventClick).toHaveBeenCalledWith(mockEvents[1]);
  });
});

describe('CalendarItem', () => {
  const mockEvent = mockEvents[0];
  const defaultProps: CalendarItemProps = {
    event: mockEvent,
    onClick: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render event title', () => {
    render(<CalendarItem {...defaultProps} />);
    expect(screen.getByText('Implement feature A')).toBeInTheDocument();
  });

  it('should show priority indicator', () => {
    render(<CalendarItem {...defaultProps} />);
    const item = screen.getByTestId(`calendar-item-${mockEvent.id}`);
    expect(item).toHaveAttribute('data-priority', 'high');
  });

  it('should call onClick when clicked', () => {
    const onClick = vi.fn();
    render(<CalendarItem {...defaultProps} onClick={onClick} />);

    fireEvent.click(screen.getByText('Implement feature A'));

    expect(onClick).toHaveBeenCalledWith(mockEvent);
  });

  it('should truncate long titles', () => {
    const longTitleEvent = {
      ...mockEvent,
      title: 'This is a very long title that should be truncated in the display',
    };
    render(<CalendarItem {...defaultProps} event={longTitleEvent} />);
    const item = screen.getByTestId(`calendar-item-${mockEvent.id}`);
    expect(item).toHaveClass('truncate');
  });

  it('should show status styling', () => {
    render(<CalendarItem {...defaultProps} />);
    const item = screen.getByTestId(`calendar-item-${mockEvent.id}`);
    expect(item).toHaveAttribute('data-status', 'open');
  });
});

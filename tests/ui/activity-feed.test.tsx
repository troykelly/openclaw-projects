/**
 * @vitest-environment jsdom
 * Tests for activity components
 * Issue #396: Implement contact activity timeline
 */
import * as React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ActivityCard, ActivityTimeline, ActivityFilter, ActivityStats, type Activity, type ActivityType } from '@/ui/components/activity';

const mockActivity: Activity = {
  id: '1',
  type: 'work_item_assignment',
  title: 'Fix login bug assigned to you',
  description: 'High priority fix needed',
  timestamp: new Date().toISOString(),
  sourceType: 'work_item',
  sourceId: 'issue-1',
};

const mockActivities: Activity[] = [
  mockActivity,
  {
    id: '2',
    type: 'email_received',
    title: 'New email from Alice',
    timestamp: new Date(Date.now() - 86400000).toISOString(), // yesterday
    sourceType: 'email',
    sourceId: 'email-1',
  },
  {
    id: '3',
    type: 'note_added',
    title: 'Note added to project',
    timestamp: new Date(Date.now() - 86400000 * 3).toISOString(), // 3 days ago
    sourceType: 'note',
    sourceId: 'note-1',
  },
];

describe('ActivityCard', () => {
  it('renders activity title', () => {
    render(<ActivityCard activity={mockActivity} />);
    expect(screen.getByText('Fix login bug assigned to you')).toBeInTheDocument();
  });

  it('renders activity description when provided', () => {
    render(<ActivityCard activity={mockActivity} />);
    expect(screen.getByText('High priority fix needed')).toBeInTheDocument();
  });

  it('calls onClick when clicked', () => {
    const onClick = vi.fn();
    render(<ActivityCard activity={mockActivity} onClick={onClick} />);

    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledWith(mockActivity.id, mockActivity.sourceType, mockActivity.sourceId);
  });

  it('renders icon based on activity type', () => {
    render(<ActivityCard activity={mockActivity} />);
    expect(screen.getByTestId('activity-icon')).toBeInTheDocument();
  });

  it('handles keyboard navigation', () => {
    const onClick = vi.fn();
    render(<ActivityCard activity={mockActivity} onClick={onClick} />);

    const button = screen.getByRole('button');
    fireEvent.keyDown(button, { key: 'Enter' });
    expect(onClick).toHaveBeenCalled();
  });
});

describe('ActivityTimeline', () => {
  it('renders activities', () => {
    render(<ActivityTimeline activities={mockActivities} />);

    expect(screen.getByText('Fix login bug assigned to you')).toBeInTheDocument();
    expect(screen.getByText('New email from Alice')).toBeInTheDocument();
  });

  it('groups activities by date', () => {
    render(<ActivityTimeline activities={mockActivities} />);

    // Activities should be grouped by date
    expect(screen.getByText('Today')).toBeInTheDocument();
  });

  it('shows empty state when no activities', () => {
    render(<ActivityTimeline activities={[]} />);
    expect(screen.getByText('No activity yet')).toBeInTheDocument();
  });

  it('shows load more button when hasMore is true', () => {
    render(<ActivityTimeline activities={mockActivities} hasMore onLoadMore={vi.fn()} />);
    expect(screen.getByText('Load More')).toBeInTheDocument();
  });

  it('calls onActivityClick when activity is clicked', () => {
    const onActivityClick = vi.fn();
    render(<ActivityTimeline activities={mockActivities} onActivityClick={onActivityClick} />);

    fireEvent.click(screen.getByText('Fix login bug assigned to you').closest('[role="button"]')!);
    expect(onActivityClick).toHaveBeenCalled();
  });
});

describe('ActivityFilter', () => {
  const defaultProps = {
    selectedTypes: [] as ActivityType[],
    dateRange: null,
    searchQuery: '',
    onTypeChange: vi.fn(),
    onDateRangeChange: vi.fn(),
    onSearchChange: vi.fn(),
  };

  it('renders search input', () => {
    render(<ActivityFilter {...defaultProps} />);
    expect(screen.getByPlaceholderText('Search activities...')).toBeInTheDocument();
  });

  it('renders activity type filter buttons', () => {
    render(<ActivityFilter {...defaultProps} />);
    expect(screen.getByText('Activity Type')).toBeInTheDocument();
  });

  it('renders date range filter buttons', () => {
    render(<ActivityFilter {...defaultProps} />);
    expect(screen.getByText('Date Range')).toBeInTheDocument();
    expect(screen.getByText('All Time')).toBeInTheDocument();
    expect(screen.getByText('Today')).toBeInTheDocument();
  });

  it('calls onSearchChange when search input changes', () => {
    const onSearchChange = vi.fn();
    render(<ActivityFilter {...defaultProps} onSearchChange={onSearchChange} />);

    fireEvent.change(screen.getByPlaceholderText('Search activities...'), {
      target: { value: 'test' },
    });
    expect(onSearchChange).toHaveBeenCalledWith('test');
  });

  it('shows clear button when filters are active', () => {
    render(<ActivityFilter {...defaultProps} searchQuery="test" />);
    expect(screen.getByText('Clear')).toBeInTheDocument();
  });
});

describe('ActivityStats', () => {
  it('renders total count', () => {
    render(<ActivityStats activities={mockActivities} />);
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('renders most common type label', () => {
    // All activities have different types so none is most common
    const sameTypeActivities: Activity[] = [
      { ...mockActivity, id: '1' },
      { ...mockActivity, id: '2' },
    ];
    render(<ActivityStats activities={sameTypeActivities} />);
    // Should show Assignments category since work_item_assignment is most common
    expect(screen.getByText(/Assignments/i)).toBeInTheDocument();
  });

  it('renders last interaction section', () => {
    render(<ActivityStats activities={mockActivities} />);
    expect(screen.getByText('Last Interaction')).toBeInTheDocument();
  });

  it('handles empty activities gracefully', () => {
    render(<ActivityStats activities={[]} />);
    expect(screen.getByText('0')).toBeInTheDocument();
  });
});

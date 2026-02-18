/**
 * @vitest-environment jsdom
 * Tests for contact activity timeline components
 * Issue #396: Implement contact activity timeline
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as React from 'react';

// Components to be implemented
import { ActivityCard, type ActivityCardProps } from '@/ui/components/activity/activity-card';
import { ActivityTimeline, type ActivityTimelineProps } from '@/ui/components/activity/activity-timeline';
import { ActivityFilter, type ActivityFilterProps } from '@/ui/components/activity/activity-filter';
import { ContactActivitySection, type ContactActivitySectionProps } from '@/ui/components/activity/contact-activity-section';
import { ActivityStats, type ActivityStatsProps } from '@/ui/components/activity/activity-stats';
import type { Activity, ActivityType } from '@/ui/components/activity/types';
import { groupActivitiesByDate, getActivityIcon, getActivityLabel, calculateStats } from '@/ui/components/activity/activity-utils';

describe('ActivityCard', () => {
  const defaultProps: ActivityCardProps = {
    activity: {
      id: 'act-1',
      type: 'work_item_assignment',
      title: 'Assigned to Project Alpha',
      description: 'You were assigned as owner',
      timestamp: '2024-01-15T10:30:00Z',
      sourceType: 'work_item',
      sourceId: 'wi-123',
    },
    onClick: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render activity title', () => {
    render(<ActivityCard {...defaultProps} />);
    expect(screen.getByText('Assigned to Project Alpha')).toBeInTheDocument();
  });

  it('should render activity description', () => {
    render(<ActivityCard {...defaultProps} />);
    expect(screen.getByText('You were assigned as owner')).toBeInTheDocument();
  });

  it('should show formatted timestamp', () => {
    render(<ActivityCard {...defaultProps} />);
    expect(screen.getByText(/Jan 15/)).toBeInTheDocument();
  });

  it('should show activity type icon', () => {
    render(<ActivityCard {...defaultProps} />);
    expect(screen.getByTestId('activity-icon')).toBeInTheDocument();
  });

  it('should call onClick when clicked', () => {
    const onClick = vi.fn();
    render(<ActivityCard {...defaultProps} onClick={onClick} />);

    fireEvent.click(screen.getByText('Assigned to Project Alpha'));

    expect(onClick).toHaveBeenCalledWith('act-1', 'work_item', 'wi-123');
  });

  it('should render different icons for different activity types', () => {
    const emailActivity = {
      ...defaultProps.activity,
      type: 'email_received' as ActivityType,
    };
    render(<ActivityCard {...defaultProps} activity={emailActivity} />);
    expect(screen.getByTestId('activity-icon')).toBeInTheDocument();
  });

  it('should show metadata when provided', () => {
    const activityWithMeta = {
      ...defaultProps.activity,
      metadata: { priority: 'high' },
    };
    render(<ActivityCard {...defaultProps} activity={activityWithMeta} />);
    expect(screen.getByText('high')).toBeInTheDocument();
  });
});

describe('ActivityTimeline', () => {
  const mockActivities: Activity[] = [
    {
      id: 'act-1',
      type: 'work_item_assignment',
      title: 'Assigned to Project Alpha',
      timestamp: new Date().toISOString(),
      sourceType: 'work_item',
      sourceId: 'wi-1',
    },
    {
      id: 'act-2',
      type: 'email_sent',
      title: 'Email sent to Alice',
      timestamp: new Date(Date.now() - 86400000).toISOString(), // Yesterday
      sourceType: 'email',
      sourceId: 'email-1',
    },
    {
      id: 'act-3',
      type: 'relationship_added',
      title: 'Added as colleague',
      timestamp: new Date(Date.now() - 86400000 * 7).toISOString(), // Week ago
      sourceType: 'relationship',
      sourceId: 'rel-1',
    },
  ];

  const defaultProps: ActivityTimelineProps = {
    activities: mockActivities,
    onActivityClick: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render all activities', () => {
    render(<ActivityTimeline {...defaultProps} />);
    expect(screen.getByText('Assigned to Project Alpha')).toBeInTheDocument();
    expect(screen.getByText('Email sent to Alice')).toBeInTheDocument();
    expect(screen.getByText('Added as colleague')).toBeInTheDocument();
  });

  it('should group activities by date', () => {
    render(<ActivityTimeline {...defaultProps} />);
    expect(screen.getByText('Today')).toBeInTheDocument();
    expect(screen.getByText('Yesterday')).toBeInTheDocument();
  });

  it('should show empty state when no activities', () => {
    render(<ActivityTimeline {...defaultProps} activities={[]} />);
    expect(screen.getByText(/no activity/i)).toBeInTheDocument();
  });

  it('should call onActivityClick when activity clicked', () => {
    const onActivityClick = vi.fn();
    render(<ActivityTimeline {...defaultProps} onActivityClick={onActivityClick} />);

    fireEvent.click(screen.getByText('Assigned to Project Alpha'));

    expect(onActivityClick).toHaveBeenCalled();
  });

  it('should show timeline connector between activities', () => {
    render(<ActivityTimeline {...defaultProps} />);
    expect(screen.getAllByTestId('timeline-connector').length).toBeGreaterThan(0);
  });

  it('should show load more button when has_more', () => {
    render(<ActivityTimeline {...defaultProps} has_more onLoadMore={vi.fn()} />);
    expect(screen.getByRole('button', { name: /load more/i })).toBeInTheDocument();
  });

  it('should call onLoadMore when load more clicked', () => {
    const onLoadMore = vi.fn();
    render(<ActivityTimeline {...defaultProps} has_more onLoadMore={onLoadMore} />);

    fireEvent.click(screen.getByRole('button', { name: /load more/i }));

    expect(onLoadMore).toHaveBeenCalled();
  });
});

describe('ActivityFilter', () => {
  const defaultProps: ActivityFilterProps = {
    selectedTypes: [],
    dateRange: null,
    searchQuery: '',
    onTypeChange: vi.fn(),
    onDateRangeChange: vi.fn(),
    onSearchChange: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render activity type filters', () => {
    render(<ActivityFilter {...defaultProps} />);
    expect(screen.getByText(/activity type/i)).toBeInTheDocument();
  });

  it('should show all activity types', () => {
    render(<ActivityFilter {...defaultProps} />);
    expect(screen.getByText('Assignments')).toBeInTheDocument();
    expect(screen.getByText('Emails')).toBeInTheDocument();
  });

  it('should call onTypeChange when type toggled', () => {
    const onTypeChange = vi.fn();
    render(<ActivityFilter {...defaultProps} onTypeChange={onTypeChange} />);

    fireEvent.click(screen.getByText('Assignments'));

    // Assignments category includes both work_item_assignment and work_item_mention
    expect(onTypeChange).toHaveBeenCalledWith(['work_item_assignment', 'work_item_mention']);
  });

  it('should highlight selected types', () => {
    // Need all types in the category to be selected
    render(<ActivityFilter {...defaultProps} selectedTypes={['work_item_assignment', 'work_item_mention']} />);
    const btn = screen.getByText('Assignments').closest('button');
    expect(btn).toHaveAttribute('data-selected', 'true');
  });

  it('should render search input', () => {
    render(<ActivityFilter {...defaultProps} />);
    expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument();
  });

  it('should call onSearchChange when search input changes', () => {
    const onSearchChange = vi.fn();
    render(<ActivityFilter {...defaultProps} onSearchChange={onSearchChange} />);

    fireEvent.change(screen.getByPlaceholderText(/search/i), {
      target: { value: 'project' },
    });

    expect(onSearchChange).toHaveBeenCalledWith('project');
  });

  it('should show date range selector', () => {
    render(<ActivityFilter {...defaultProps} />);
    expect(screen.getByText(/date range/i)).toBeInTheDocument();
  });

  it('should show clear button when filters active', () => {
    render(<ActivityFilter {...defaultProps} selectedTypes={['email_sent']} />);
    expect(screen.getByRole('button', { name: /clear/i })).toBeInTheDocument();
  });
});

describe('ActivityStats', () => {
  const mockActivities: Activity[] = [
    { id: '1', type: 'email_sent', title: 'Email 1', timestamp: new Date().toISOString(), sourceType: 'email', sourceId: 'e1' },
    { id: '2', type: 'email_sent', title: 'Email 2', timestamp: new Date().toISOString(), sourceType: 'email', sourceId: 'e2' },
    { id: '3', type: 'work_item_assignment', title: 'Assignment', timestamp: new Date().toISOString(), sourceType: 'work_item', sourceId: 'w1' },
  ];

  const defaultProps: ActivityStatsProps = {
    activities: mockActivities,
  };

  it('should show total interactions count', () => {
    render(<ActivityStats {...defaultProps} />);
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText(/total/i)).toBeInTheDocument();
  });

  it('should show most common activity type', () => {
    render(<ActivityStats {...defaultProps} />);
    expect(screen.getByText(/emails/i)).toBeInTheDocument();
  });

  it('should show last interaction date', () => {
    render(<ActivityStats {...defaultProps} />);
    expect(screen.getByText(/last interaction/i)).toBeInTheDocument();
  });

  it('should handle empty activities', () => {
    render(<ActivityStats activities={[]} />);
    expect(screen.getByText('0')).toBeInTheDocument();
  });
});

describe('ContactActivitySection', () => {
  const mockActivities: Activity[] = [
    {
      id: 'act-1',
      type: 'work_item_assignment',
      title: 'Assigned to Project Alpha',
      timestamp: new Date().toISOString(),
      sourceType: 'work_item',
      sourceId: 'wi-1',
    },
    {
      id: 'act-2',
      type: 'email_sent',
      title: 'Email sent',
      timestamp: new Date().toISOString(),
      sourceType: 'email',
      sourceId: 'email-1',
    },
  ];

  const defaultProps: ContactActivitySectionProps = {
    contact_id: 'contact-1',
    activities: mockActivities,
    loading: false,
    onActivityClick: vi.fn(),
    onLoadMore: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render section title', () => {
    render(<ContactActivitySection {...defaultProps} />);
    expect(screen.getByText(/activity/i)).toBeInTheDocument();
  });

  it('should show activity count', () => {
    render(<ContactActivitySection {...defaultProps} />);
    // The count appears in header badge
    const badge = screen.getByText('2', { selector: '.bg-muted' });
    expect(badge).toBeInTheDocument();
  });

  it('should render timeline', () => {
    render(<ContactActivitySection {...defaultProps} />);
    expect(screen.getByText('Assigned to Project Alpha')).toBeInTheDocument();
  });

  it('should show stats section', () => {
    render(<ContactActivitySection {...defaultProps} />);
    expect(screen.getByText(/total/i)).toBeInTheDocument();
  });

  it('should show filter toggle', () => {
    render(<ContactActivitySection {...defaultProps} />);
    expect(screen.getByRole('button', { name: /filter/i })).toBeInTheDocument();
  });

  it('should toggle filter panel when clicked', () => {
    render(<ContactActivitySection {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: /filter/i }));

    expect(screen.getByText(/activity type/i)).toBeInTheDocument();
  });

  it('should show loading state', () => {
    // Loading only shows when activities is empty
    render(<ContactActivitySection {...defaultProps} activities={[]} loading />);
    expect(screen.getByTestId('activity-loading')).toBeInTheDocument();
  });

  it('should filter activities when type selected', async () => {
    render(<ContactActivitySection {...defaultProps} />);

    // Open filter
    fireEvent.click(screen.getByRole('button', { name: /filter/i }));

    // Select only emails
    fireEvent.click(screen.getByText('Emails'));

    await waitFor(() => {
      expect(screen.getByText('Email sent')).toBeInTheDocument();
      expect(screen.queryByText('Assigned to Project Alpha')).not.toBeInTheDocument();
    });
  });
});

describe('activity-utils', () => {
  describe('groupActivitiesByDate', () => {
    it('should group activities into date buckets', () => {
      const activities: Activity[] = [
        { id: '1', type: 'email_sent', title: 'Today', timestamp: new Date().toISOString(), sourceType: 'email', sourceId: 'e1' },
        { id: '2', type: 'email_sent', title: 'Yesterday', timestamp: new Date(Date.now() - 86400000).toISOString(), sourceType: 'email', sourceId: 'e2' },
      ];

      const groups = groupActivitiesByDate(activities);

      expect(groups.length).toBe(2);
      expect(groups[0].label).toBe('Today');
      expect(groups[1].label).toBe('Yesterday');
    });

    it('should handle empty activities', () => {
      const groups = groupActivitiesByDate([]);
      expect(groups).toEqual([]);
    });

    it('should sort activities within groups by timestamp desc', () => {
      const now = new Date();
      const earlier = new Date(now.getTime() - 3600000);

      const activities: Activity[] = [
        { id: '1', type: 'email_sent', title: 'Earlier', timestamp: earlier.toISOString(), sourceType: 'email', sourceId: 'e1' },
        { id: '2', type: 'email_sent', title: 'Now', timestamp: now.toISOString(), sourceType: 'email', sourceId: 'e2' },
      ];

      const groups = groupActivitiesByDate(activities);

      expect(groups[0].activities[0].title).toBe('Now');
    });
  });

  describe('getActivityIcon', () => {
    it('should return icon name for activity type', () => {
      expect(getActivityIcon('email_sent')).toBe('Mail');
      expect(getActivityIcon('work_item_assignment')).toBe('CheckSquare');
      expect(getActivityIcon('relationship_added')).toBe('Users');
    });
  });

  describe('getActivityLabel', () => {
    it('should return human-readable label', () => {
      expect(getActivityLabel('email_sent')).toBe('Email Sent');
      expect(getActivityLabel('work_item_assignment')).toBe('Assignment');
    });
  });

  describe('calculateStats', () => {
    it('should calculate activity statistics', () => {
      const activities: Activity[] = [
        { id: '1', type: 'email_sent', title: 'E1', timestamp: new Date().toISOString(), sourceType: 'email', sourceId: 'e1' },
        { id: '2', type: 'email_sent', title: 'E2', timestamp: new Date().toISOString(), sourceType: 'email', sourceId: 'e2' },
        { id: '3', type: 'work_item_assignment', title: 'W1', timestamp: new Date().toISOString(), sourceType: 'work_item', sourceId: 'w1' },
      ];

      const stats = calculateStats(activities);

      expect(stats.total).toBe(3);
      expect(stats.mostCommonType).toBe('email_sent');
      expect(stats.lastInteraction).toBeDefined();
    });

    it('should handle empty activities', () => {
      const stats = calculateStats([]);

      expect(stats.total).toBe(0);
      expect(stats.mostCommonType).toBeNull();
      expect(stats.lastInteraction).toBeNull();
    });
  });
});

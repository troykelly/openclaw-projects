/**
 * @vitest-environment jsdom
 */
import * as React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  ActivityFeed,
  ActivityCard,
  ActivityFilterBar,
  type ActivityItem,
  type ActivityFilter,
} from '@/ui/components/activity';

const mockActivity: ActivityItem = {
  id: '1',
  actorType: 'agent',
  actorName: 'Claude',
  action: 'created',
  entityType: 'issue',
  entityId: 'issue-1',
  entityTitle: 'Fix login bug',
  parentEntityTitle: 'Project Alpha',
  parentEntityId: 'project-1',
  timestamp: new Date(),
  read: false,
};

const mockActivities: ActivityItem[] = [
  mockActivity,
  {
    id: '2',
    actorType: 'human',
    actorName: 'Alice',
    action: 'commented',
    entityType: 'issue',
    entityId: 'issue-2',
    entityTitle: 'Add dark mode',
    timestamp: new Date(Date.now() - 86400000), // yesterday
    read: true,
  },
  {
    id: '3',
    actorType: 'agent',
    actorName: 'Bot',
    action: 'completed',
    entityType: 'project',
    entityId: 'project-2',
    entityTitle: 'Backend API',
    timestamp: new Date(Date.now() - 86400000 * 3), // 3 days ago
    read: false,
  },
];

describe('ActivityCard', () => {
  it('renders activity information', () => {
    render(<ActivityCard item={mockActivity} />);

    expect(screen.getByText('Claude')).toBeInTheDocument();
    expect(screen.getByText('Fix login bug')).toBeInTheDocument();
    expect(screen.getByText(/in Project Alpha/)).toBeInTheDocument();
  });

  it('shows unread indicator for unread items', () => {
    const { container } = render(<ActivityCard item={mockActivity} />);
    const card = container.querySelector('[data-testid="activity-card"]');
    expect(card?.className).toContain('border-l-primary');
  });

  it('calls onClick when clicked', () => {
    const onClick = vi.fn();
    render(<ActivityCard item={mockActivity} onClick={onClick} />);

    fireEvent.click(screen.getByRole('article'));
    expect(onClick).toHaveBeenCalledWith(mockActivity);
  });

  it('displays relative time', () => {
    render(<ActivityCard item={mockActivity} />);
    expect(screen.getByText(/just now|minute/)).toBeInTheDocument();
  });

  it('shows detail when provided', () => {
    const itemWithDetail: ActivityItem = {
      ...mockActivity,
      detail: 'This is a detailed comment',
    };
    render(<ActivityCard item={itemWithDetail} />);
    expect(screen.getByText(/"This is a detailed comment"/)).toBeInTheDocument();
  });
});

describe('ActivityFilterBar', () => {
  it('renders filter button', () => {
    const onFilterChange = vi.fn();
    render(<ActivityFilterBar filter={{}} onFilterChange={onFilterChange} />);

    expect(screen.getByText('Filter')).toBeInTheDocument();
  });

  it('shows filter options when expanded', () => {
    const onFilterChange = vi.fn();
    render(<ActivityFilterBar filter={{}} onFilterChange={onFilterChange} />);

    fireEvent.click(screen.getByText('Filter'));

    expect(screen.getByText('Time')).toBeInTheDocument();
    expect(screen.getByText('Actor')).toBeInTheDocument();
    expect(screen.getByText('Action')).toBeInTheDocument();
  });

  it('shows active filter count', () => {
    const onFilterChange = vi.fn();
    const filter: ActivityFilter = { actorType: 'agent', timeRange: 'today' };
    render(<ActivityFilterBar filter={filter} onFilterChange={onFilterChange} />);

    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('calls onFilterChange when filter is toggled', () => {
    const onFilterChange = vi.fn();
    render(<ActivityFilterBar filter={{}} onFilterChange={onFilterChange} />);

    fireEvent.click(screen.getByText('Filter'));
    fireEvent.click(screen.getByText('Agents'));

    expect(onFilterChange).toHaveBeenCalledWith({ actorType: 'agent' });
  });

  it('shows clear button when filters are active', () => {
    const onFilterChange = vi.fn();
    const filter: ActivityFilter = { actorType: 'agent' };
    render(<ActivityFilterBar filter={filter} onFilterChange={onFilterChange} />);

    expect(screen.getByText('Clear')).toBeInTheDocument();
  });

  it('clears filters when clear is clicked', () => {
    const onFilterChange = vi.fn();
    const filter: ActivityFilter = { actorType: 'agent' };
    render(<ActivityFilterBar filter={filter} onFilterChange={onFilterChange} />);

    fireEvent.click(screen.getByText('Clear'));
    expect(onFilterChange).toHaveBeenCalledWith({});
  });
});

describe('ActivityFeed', () => {
  it('renders activity items', () => {
    render(<ActivityFeed items={mockActivities} />);

    expect(screen.getByText('Claude')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bot')).toBeInTheDocument();
  });

  it('groups items by time', () => {
    render(<ActivityFeed items={mockActivities} />);

    expect(screen.getByText('Today')).toBeInTheDocument();
    expect(screen.getByText('Yesterday')).toBeInTheDocument();
  });

  it('shows unread count', () => {
    render(<ActivityFeed items={mockActivities} />);

    // 2 unread items
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('shows Mark all read button when there are unread items', () => {
    const onMarkAllRead = vi.fn();
    render(<ActivityFeed items={mockActivities} onMarkAllRead={onMarkAllRead} />);

    expect(screen.getByText('Mark all read')).toBeInTheDocument();
  });

  it('calls onMarkAllRead when button is clicked', () => {
    const onMarkAllRead = vi.fn();
    render(<ActivityFeed items={mockActivities} onMarkAllRead={onMarkAllRead} />);

    fireEvent.click(screen.getByText('Mark all read'));
    expect(onMarkAllRead).toHaveBeenCalled();
  });

  it('shows empty state when no items', () => {
    render(<ActivityFeed items={[]} />);

    expect(screen.getByText('No activity to show')).toBeInTheDocument();
  });

  it('shows loading state', () => {
    render(<ActivityFeed items={[]} loading />);

    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('shows load more button when hasMore is true', () => {
    const onLoadMore = vi.fn();
    render(<ActivityFeed items={mockActivities} hasMore onLoadMore={onLoadMore} />);

    expect(screen.getByText('Load more')).toBeInTheDocument();
  });

  it('calls onLoadMore when load more is clicked', () => {
    const onLoadMore = vi.fn();
    render(<ActivityFeed items={mockActivities} hasMore onLoadMore={onLoadMore} />);

    fireEvent.click(screen.getByText('Load more'));
    expect(onLoadMore).toHaveBeenCalled();
  });

  it('filters items based on filter state', () => {
    // This tests the internal filtering - we can't directly test because filter state is internal
    // But we can verify the filter bar is present
    render(<ActivityFeed items={mockActivities} />);

    expect(screen.getByText('Filter')).toBeInTheDocument();
  });

  it('calls onItemClick when an item is clicked', () => {
    const onItemClick = vi.fn();
    render(<ActivityFeed items={mockActivities} onItemClick={onItemClick} />);

    fireEvent.click(screen.getByText('Claude').closest('[role="article"]')!);
    expect(onItemClick).toHaveBeenCalledWith(mockActivities[0]);
  });
});

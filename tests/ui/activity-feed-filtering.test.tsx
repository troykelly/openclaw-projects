/**
 * @vitest-environment jsdom
 * Tests for activity feed filtering and personalization
 * Issue #403: Implement activity feed filtering and personalization
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as React from 'react';

// Components to be implemented
import { ActivityFeedFilters, type ActivityFeedFiltersProps } from '@/ui/components/activity-feed/activity-feed-filters';
import { ActivityDetailCard, type ActivityDetailCardProps } from '@/ui/components/activity-feed/activity-detail-card';
import { CollapsedActivityGroup, type CollapsedActivityGroupProps } from '@/ui/components/activity-feed/collapsed-activity-group';
import { ActivityFeedPersonalization, type ActivityFeedPersonalizationProps } from '@/ui/components/activity-feed/activity-feed-personalization';
import { ActivityQuickFilters, type ActivityQuickFiltersProps } from '@/ui/components/activity-feed/activity-quick-filters';
import type { ActivityFilters, ActivityItem, QuickFilterPreset, ActivityPersonalizationSettings } from '@/ui/components/activity-feed/types';

describe('ActivityFeedFilters', () => {
  const defaultProps: ActivityFeedFiltersProps = {
    filters: {},
    onChange: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render actor type filter', () => {
    render(<ActivityFeedFilters {...defaultProps} />);
    expect(screen.getByText(/actor/i)).toBeInTheDocument();
  });

  it('should show actor type options', () => {
    render(<ActivityFeedFilters {...defaultProps} />);

    fireEvent.click(screen.getByText(/actor/i));

    expect(screen.getByText(/all/i)).toBeInTheDocument();
    expect(screen.getByText(/agent/i)).toBeInTheDocument();
    expect(screen.getByText(/human/i)).toBeInTheDocument();
  });

  it('should render action type filter', () => {
    render(<ActivityFeedFilters {...defaultProps} />);
    expect(screen.getByText(/action/i)).toBeInTheDocument();
  });

  it('should show action type options', () => {
    render(<ActivityFeedFilters {...defaultProps} />);

    fireEvent.click(screen.getByText(/action/i));

    expect(screen.getByText(/created/i)).toBeInTheDocument();
    expect(screen.getByText(/updated/i)).toBeInTheDocument();
    expect(screen.getByText(/commented/i)).toBeInTheDocument();
  });

  it('should render entity type filter', () => {
    render(<ActivityFeedFilters {...defaultProps} />);
    expect(screen.getByText(/entity/i)).toBeInTheDocument();
  });

  it('should show entity type options', () => {
    render(<ActivityFeedFilters {...defaultProps} />);

    fireEvent.click(screen.getByText(/entity/i));

    expect(screen.getByText(/project/i)).toBeInTheDocument();
    expect(screen.getByText(/issue/i)).toBeInTheDocument();
    expect(screen.getByText(/contact/i)).toBeInTheDocument();
  });

  it('should render time range filter', () => {
    render(<ActivityFeedFilters {...defaultProps} />);
    expect(screen.getByText(/time/i)).toBeInTheDocument();
  });

  it('should show time range options', () => {
    render(<ActivityFeedFilters {...defaultProps} />);

    fireEvent.click(screen.getByText(/time/i));

    expect(screen.getByText(/today/i)).toBeInTheDocument();
    expect(screen.getByText(/this week/i)).toBeInTheDocument();
    expect(screen.getByText(/this month/i)).toBeInTheDocument();
  });

  it('should call onChange when filter selected', () => {
    const onChange = vi.fn();
    render(<ActivityFeedFilters {...defaultProps} onChange={onChange} />);

    fireEvent.click(screen.getByText(/actor/i));
    fireEvent.click(screen.getByText(/human/i));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        actor_type: 'human',
      }),
    );
  });

  it('should show my activity toggle', () => {
    render(<ActivityFeedFilters {...defaultProps} currentUserId="user-1" />);
    expect(screen.getByText(/my activity/i)).toBeInTheDocument();
  });

  it('should call onChange when my activity toggled', () => {
    const onChange = vi.fn();
    render(<ActivityFeedFilters {...defaultProps} currentUserId="user-1" onChange={onChange} />);

    fireEvent.click(screen.getByText(/my activity/i));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        myActivityOnly: true,
      }),
    );
  });

  it('should show clear filters button when filters active', () => {
    render(<ActivityFeedFilters {...defaultProps} filters={{ actor_type: 'human' }} />);
    expect(screen.getByRole('button', { name: /clear/i })).toBeInTheDocument();
  });

  it('should call onChange with empty filters on clear', () => {
    const onChange = vi.fn();
    render(<ActivityFeedFilters {...defaultProps} filters={{ actor_type: 'human' }} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: /clear/i }));

    expect(onChange).toHaveBeenCalledWith({});
  });

  it('should show active filter count', () => {
    render(<ActivityFeedFilters {...defaultProps} filters={{ actor_type: 'human', actionType: ['created'] }} />);
    expect(screen.getByText('2')).toBeInTheDocument();
  });
});

describe('ActivityDetailCard', () => {
  const mockActivity: ActivityItem = {
    id: 'activity-1',
    action: 'updated',
    entity_type: 'issue',
    entity_id: 'issue-1',
    entityTitle: 'Fix login bug',
    actor_id: 'user-1',
    actorName: 'Alice Smith',
    actor_type: 'human',
    timestamp: new Date().toISOString(),
    changes: [
      { field: 'status', from: 'open', to: 'in_progress' },
      { field: 'assignee', from: null, to: 'Bob Jones' },
    ],
  };

  const defaultProps: ActivityDetailCardProps = {
    activity: mockActivity,
    expanded: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render activity summary', () => {
    render(<ActivityDetailCard {...defaultProps} />);
    expect(screen.getByText(/alice smith/i)).toBeInTheDocument();
    expect(screen.getByText(/updated/i)).toBeInTheDocument();
    expect(screen.getByText(/fix login bug/i)).toBeInTheDocument();
  });

  it('should show changes when expanded', () => {
    render(<ActivityDetailCard {...defaultProps} expanded />);
    expect(screen.getByText(/status/i)).toBeInTheDocument();
    expect(screen.getByText(/open/i)).toBeInTheDocument();
    expect(screen.getByText(/in_progress/i)).toBeInTheDocument();
  });

  it('should not show changes when collapsed', () => {
    render(<ActivityDetailCard {...defaultProps} expanded={false} />);
    expect(screen.queryByText(/status changed/i)).not.toBeInTheDocument();
  });

  it('should show expand button when collapsible', () => {
    render(<ActivityDetailCard {...defaultProps} expanded={false} onToggle={vi.fn()} />);
    expect(screen.getByRole('button', { name: /expand|show|details/i })).toBeInTheDocument();
  });

  it('should call onToggle when clicked', () => {
    const onToggle = vi.fn();
    render(<ActivityDetailCard {...defaultProps} expanded={false} onToggle={onToggle} />);

    fireEvent.click(screen.getByRole('button', { name: /expand|show|details/i }));

    expect(onToggle).toHaveBeenCalled();
  });

  it('should show link to entity', () => {
    render(<ActivityDetailCard {...defaultProps} />);
    const link = screen.getByRole('link', { name: /fix login bug/i });
    expect(link).toBeInTheDocument();
  });

  it('should show timestamp', () => {
    render(<ActivityDetailCard {...defaultProps} />);
    expect(screen.getByTestId('activity-timestamp')).toBeInTheDocument();
  });

  it('should show actor avatar', () => {
    const activityWithAvatar = {
      ...mockActivity,
      actorAvatar: 'https://example.com/alice.png',
    };
    render(<ActivityDetailCard {...defaultProps} activity={activityWithAvatar} />);
    const avatar = screen.getByRole('img');
    expect(avatar).toHaveAttribute('src', 'https://example.com/alice.png');
  });
});

describe('CollapsedActivityGroup', () => {
  const mockActivities: ActivityItem[] = [
    {
      id: 'activity-1',
      action: 'updated',
      entity_type: 'issue',
      entity_id: 'issue-1',
      entityTitle: 'Issue 1',
      actor_id: 'user-1',
      actorName: 'Alice',
      actor_type: 'human',
      timestamp: new Date().toISOString(),
    },
    {
      id: 'activity-2',
      action: 'updated',
      entity_type: 'issue',
      entity_id: 'issue-2',
      entityTitle: 'Issue 2',
      actor_id: 'user-1',
      actorName: 'Alice',
      actor_type: 'human',
      timestamp: new Date().toISOString(),
    },
    {
      id: 'activity-3',
      action: 'updated',
      entity_type: 'issue',
      entity_id: 'issue-3',
      entityTitle: 'Issue 3',
      actor_id: 'user-1',
      actorName: 'Alice',
      actor_type: 'human',
      timestamp: new Date().toISOString(),
    },
  ];

  const defaultProps: CollapsedActivityGroupProps = {
    activities: mockActivities,
    groupLabel: '3 items updated',
    collapsed: true,
    onToggle: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should show group label when collapsed', () => {
    render(<CollapsedActivityGroup {...defaultProps} />);
    expect(screen.getByText('3 items updated')).toBeInTheDocument();
  });

  it('should show expand button when collapsed', () => {
    render(<CollapsedActivityGroup {...defaultProps} />);
    expect(screen.getByRole('button', { name: /expand|show/i })).toBeInTheDocument();
  });

  it('should show all activities when expanded', () => {
    render(<CollapsedActivityGroup {...defaultProps} collapsed={false} />);
    expect(screen.getByText(/issue 1/i)).toBeInTheDocument();
    expect(screen.getByText(/issue 2/i)).toBeInTheDocument();
    expect(screen.getByText(/issue 3/i)).toBeInTheDocument();
  });

  it('should call onToggle when expand clicked', () => {
    const onToggle = vi.fn();
    render(<CollapsedActivityGroup {...defaultProps} onToggle={onToggle} />);

    fireEvent.click(screen.getByRole('button', { name: /expand|show/i }));

    expect(onToggle).toHaveBeenCalled();
  });

  it('should show collapse button when expanded', () => {
    render(<CollapsedActivityGroup {...defaultProps} collapsed={false} />);
    expect(screen.getByRole('button', { name: /collapse|hide/i })).toBeInTheDocument();
  });

  it('should show activity count badge', () => {
    render(<CollapsedActivityGroup {...defaultProps} />);
    expect(screen.getByText('3')).toBeInTheDocument();
  });
});

describe('ActivityQuickFilters', () => {
  const mockPresets: QuickFilterPreset[] = [
    {
      id: 'preset-1',
      name: 'My Team',
      filters: { actor_type: 'human' },
    },
    {
      id: 'preset-2',
      name: 'Recent Changes',
      filters: { timeRange: 'today', actionType: ['updated', 'created'] },
    },
  ];

  const defaultProps: ActivityQuickFiltersProps = {
    presets: mockPresets,
    activePresetId: null,
    onSelectPreset: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render preset buttons', () => {
    render(<ActivityQuickFilters {...defaultProps} />);
    expect(screen.getByText('My Team')).toBeInTheDocument();
    expect(screen.getByText('Recent Changes')).toBeInTheDocument();
  });

  it('should highlight active preset', () => {
    render(<ActivityQuickFilters {...defaultProps} activePresetId="preset-1" />);
    const preset1 = screen.getByText('My Team').closest('button');
    expect(preset1).toHaveAttribute('data-active', 'true');
  });

  it('should call onSelectPreset when preset clicked', () => {
    const onSelectPreset = vi.fn();
    render(<ActivityQuickFilters {...defaultProps} onSelectPreset={onSelectPreset} />);

    fireEvent.click(screen.getByText('My Team'));

    expect(onSelectPreset).toHaveBeenCalledWith('preset-1', mockPresets[0].filters);
  });

  it('should deselect when active preset clicked again', () => {
    const onSelectPreset = vi.fn();
    render(<ActivityQuickFilters {...defaultProps} activePresetId="preset-1" onSelectPreset={onSelectPreset} />);

    fireEvent.click(screen.getByText('My Team'));

    expect(onSelectPreset).toHaveBeenCalledWith(null, {});
  });

  it('should show empty state when no presets', () => {
    render(<ActivityQuickFilters presets={[]} activePresetId={null} onSelectPreset={vi.fn()} />);
    expect(screen.getByText(/no presets/i)).toBeInTheDocument();
  });
});

describe('ActivityFeedPersonalization', () => {
  const mockSettings: ActivityPersonalizationSettings = {
    defaultFilters: {
      actor_type: 'human',
    },
    showMyActivityFirst: true,
    collapseThreshold: 5,
    autoRefresh: true,
    refreshInterval: 30,
  };

  const defaultProps: ActivityFeedPersonalizationProps = {
    settings: mockSettings,
    onChange: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render default filters section', () => {
    render(<ActivityFeedPersonalization {...defaultProps} />);
    expect(screen.getByText(/default filters/i)).toBeInTheDocument();
  });

  it('should show show my activity first toggle', () => {
    render(<ActivityFeedPersonalization {...defaultProps} />);
    expect(screen.getByText(/my activity first/i)).toBeInTheDocument();
  });

  it('should show current toggle state', () => {
    render(<ActivityFeedPersonalization {...defaultProps} />);
    const toggle = screen.getByRole('switch', { name: /my activity first/i });
    expect(toggle).toHaveAttribute('data-state', 'checked');
  });

  it('should show collapse threshold setting', () => {
    render(<ActivityFeedPersonalization {...defaultProps} />);
    expect(screen.getByText(/collapse threshold/i)).toBeInTheDocument();
  });

  it('should show auto refresh toggle', () => {
    render(<ActivityFeedPersonalization {...defaultProps} />);
    expect(screen.getByText(/auto refresh/i)).toBeInTheDocument();
  });

  it('should show refresh interval when auto refresh enabled', () => {
    render(<ActivityFeedPersonalization {...defaultProps} />);
    expect(screen.getByText(/30/)).toBeInTheDocument();
  });

  it('should call onChange when setting changed', () => {
    const onChange = vi.fn();
    render(<ActivityFeedPersonalization {...defaultProps} onChange={onChange} />);

    const toggle = screen.getByRole('switch', { name: /my activity first/i });
    fireEvent.click(toggle);

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        showMyActivityFirst: false,
      }),
    );
  });

  it('should hide refresh interval when auto refresh disabled', () => {
    const settingsNoRefresh = { ...mockSettings, autoRefresh: false };
    render(<ActivityFeedPersonalization {...defaultProps} settings={settingsNoRefresh} />);
    expect(screen.queryByText(/refresh interval/i)).not.toBeInTheDocument();
  });

  it('should show save defaults button', () => {
    render(<ActivityFeedPersonalization {...defaultProps} onSaveDefaults={vi.fn()} />);
    expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument();
  });

  it('should call onSaveDefaults when save clicked', () => {
    const onSaveDefaults = vi.fn();
    render(<ActivityFeedPersonalization {...defaultProps} onSaveDefaults={onSaveDefaults} />);

    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    expect(onSaveDefaults).toHaveBeenCalledWith(mockSettings);
  });
});

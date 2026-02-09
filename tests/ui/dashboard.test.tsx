/**
 * @vitest-environment jsdom
 * Tests for custom dashboard builder
 * Issue #405: Implement custom dashboard builder
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as React from 'react';

// Components to be implemented
import { DashboardGrid, type DashboardGridProps } from '@/ui/components/dashboard/dashboard-grid';
import { DashboardWidget, type DashboardWidgetProps } from '@/ui/components/dashboard/dashboard-widget';
import { WidgetPicker, type WidgetPickerProps } from '@/ui/components/dashboard/widget-picker';
import { MyTasksWidget, type MyTasksWidgetProps } from '@/ui/components/dashboard/widgets/my-tasks-widget';
import { UpcomingDueWidget, type UpcomingDueWidgetProps } from '@/ui/components/dashboard/widgets/upcoming-due-widget';
import { ActivityWidget, type ActivityWidgetProps } from '@/ui/components/dashboard/widgets/activity-widget';
import { StatsWidget, type StatsWidgetProps } from '@/ui/components/dashboard/widgets/stats-widget';
import type { Widget, WidgetType, DashboardLayout, WidgetConfig } from '@/ui/components/dashboard/types';

describe('DashboardGrid', () => {
  const mockWidgets: Widget[] = [
    { id: 'widget-1', type: 'my-tasks', x: 0, y: 0, w: 2, h: 2 },
    { id: 'widget-2', type: 'upcoming-due', x: 2, y: 0, w: 2, h: 2 },
  ];

  const defaultProps: DashboardGridProps = {
    widgets: mockWidgets,
    onLayoutChange: vi.fn(),
    onRemoveWidget: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render all widgets', () => {
    render(<DashboardGrid {...defaultProps} />);
    // Check that both widgets are rendered in grid cells
    expect(screen.getByTestId('grid-cell-widget-1')).toBeInTheDocument();
    expect(screen.getByTestId('grid-cell-widget-2')).toBeInTheDocument();
  });

  it('should show add widget button', () => {
    render(<DashboardGrid {...defaultProps} editable onAddWidget={vi.fn()} />);
    expect(screen.getByRole('button', { name: /add widget/i })).toBeInTheDocument();
  });

  it('should call onAddWidget when add button clicked', () => {
    const onAddWidget = vi.fn();
    render(<DashboardGrid {...defaultProps} editable onAddWidget={onAddWidget} />);

    fireEvent.click(screen.getByRole('button', { name: /add widget/i }));

    expect(onAddWidget).toHaveBeenCalled();
  });

  it('should show empty state when no widgets', () => {
    render(<DashboardGrid widgets={[]} onLayoutChange={vi.fn()} onRemoveWidget={vi.fn()} />);
    expect(screen.getByText(/no widgets/i)).toBeInTheDocument();
  });

  it('should show edit mode toggle', () => {
    render(<DashboardGrid {...defaultProps} editable onEditModeChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: /edit|customize/i })).toBeInTheDocument();
  });

  it('should show remove button on widgets in edit mode', () => {
    render(<DashboardGrid {...defaultProps} editable isEditing />);
    const removeButtons = screen.getAllByRole('button', { name: /remove|delete/i });
    expect(removeButtons.length).toBe(2);
  });

  it('should call onRemoveWidget when remove clicked', () => {
    const onRemoveWidget = vi.fn();
    render(<DashboardGrid {...defaultProps} editable isEditing onRemoveWidget={onRemoveWidget} />);

    const removeButtons = screen.getAllByRole('button', { name: /remove|delete/i });
    fireEvent.click(removeButtons[0]);

    expect(onRemoveWidget).toHaveBeenCalledWith('widget-1');
  });
});

describe('DashboardWidget', () => {
  const defaultProps: DashboardWidgetProps = {
    id: 'widget-1',
    title: 'My Tasks',
    children: <div>Widget content</div>,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render title', () => {
    render(<DashboardWidget {...defaultProps} />);
    expect(screen.getByText('My Tasks')).toBeInTheDocument();
  });

  it('should render children', () => {
    render(<DashboardWidget {...defaultProps} />);
    expect(screen.getByText('Widget content')).toBeInTheDocument();
  });

  it('should show settings button when configurable', () => {
    render(<DashboardWidget {...defaultProps} onConfigure={vi.fn()} />);
    expect(screen.getByRole('button', { name: /settings|configure/i })).toBeInTheDocument();
  });

  it('should call onConfigure when settings clicked', () => {
    const onConfigure = vi.fn();
    render(<DashboardWidget {...defaultProps} onConfigure={onConfigure} />);

    fireEvent.click(screen.getByRole('button', { name: /settings|configure/i }));

    expect(onConfigure).toHaveBeenCalled();
  });

  it('should show remove button when onRemove provided', () => {
    render(<DashboardWidget {...defaultProps} onRemove={vi.fn()} />);
    expect(screen.getByRole('button', { name: /remove|delete/i })).toBeInTheDocument();
  });

  it('should call onRemove when clicked', () => {
    const onRemove = vi.fn();
    render(<DashboardWidget {...defaultProps} onRemove={onRemove} />);

    fireEvent.click(screen.getByRole('button', { name: /remove|delete/i }));

    expect(onRemove).toHaveBeenCalled();
  });

  it('should show loading state', () => {
    render(<DashboardWidget {...defaultProps} loading />);
    expect(screen.getByTestId('widget-loading')).toBeInTheDocument();
  });

  it('should show error state', () => {
    render(<DashboardWidget {...defaultProps} error="Failed to load" />);
    expect(screen.getByText(/failed to load/i)).toBeInTheDocument();
  });
});

describe('WidgetPicker', () => {
  const defaultProps: WidgetPickerProps = {
    open: true,
    onOpenChange: vi.fn(),
    onSelect: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render dialog when open', () => {
    render(<WidgetPicker {...defaultProps} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('should show available widget types', () => {
    render(<WidgetPicker {...defaultProps} />);
    expect(screen.getByText('My Tasks')).toBeInTheDocument();
    expect(screen.getByText('Upcoming Due')).toBeInTheDocument();
    expect(screen.getByText('Activity')).toBeInTheDocument();
  });

  it('should show widget descriptions', () => {
    render(<WidgetPicker {...defaultProps} />);
    expect(screen.getByText(/assigned/i)).toBeInTheDocument();
  });

  it('should call onSelect when widget clicked', () => {
    const onSelect = vi.fn();
    render(<WidgetPicker {...defaultProps} onSelect={onSelect} />);

    fireEvent.click(screen.getByText(/my tasks/i));

    expect(onSelect).toHaveBeenCalledWith('my-tasks');
  });

  it('should close dialog when cancel clicked', () => {
    const onOpenChange = vi.fn();
    render(<WidgetPicker {...defaultProps} onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('should support search', () => {
    render(<WidgetPicker {...defaultProps} />);

    const searchInput = screen.getByPlaceholderText(/search/i);
    fireEvent.change(searchInput, { target: { value: 'task' } });

    expect(screen.getByText(/my tasks/i)).toBeInTheDocument();
    // Upcoming Due should be filtered out
  });
});

describe('MyTasksWidget', () => {
  const mockTasks = [
    { id: 'task-1', title: 'Fix login bug', status: 'in_progress', priority: 'high' },
    { id: 'task-2', title: 'Add tests', status: 'open', priority: 'medium' },
  ];

  const defaultProps: MyTasksWidgetProps = {
    tasks: mockTasks,
    onTaskClick: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render all tasks', () => {
    render(<MyTasksWidget {...defaultProps} />);
    expect(screen.getByText('Fix login bug')).toBeInTheDocument();
    expect(screen.getByText('Add tests')).toBeInTheDocument();
  });

  it('should show task count', () => {
    render(<MyTasksWidget {...defaultProps} />);
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('should show status badge', () => {
    render(<MyTasksWidget {...defaultProps} />);
    expect(screen.getByText(/in progress/i)).toBeInTheDocument();
  });

  it('should call onTaskClick when task clicked', () => {
    const onTaskClick = vi.fn();
    render(<MyTasksWidget {...defaultProps} onTaskClick={onTaskClick} />);

    fireEvent.click(screen.getByText('Fix login bug'));

    expect(onTaskClick).toHaveBeenCalledWith('task-1');
  });

  it('should show empty state when no tasks', () => {
    render(<MyTasksWidget tasks={[]} onTaskClick={vi.fn()} />);
    expect(screen.getByText(/no tasks/i)).toBeInTheDocument();
  });

  it('should support limit prop', () => {
    const manyTasks = Array.from({ length: 10 }, (_, i) => ({
      id: `task-${i}`,
      title: `Task ${i}`,
      status: 'open',
      priority: 'medium',
    }));
    render(<MyTasksWidget tasks={manyTasks} limit={5} onTaskClick={vi.fn()} />);

    // Should show "5 more" or similar
    expect(screen.getByText(/5 more/i)).toBeInTheDocument();
  });
});

describe('UpcomingDueWidget', () => {
  const mockItems = [
    {
      id: 'item-1',
      title: 'Review PR',
      dueDate: new Date(Date.now() + 86400000).toISOString(), // Tomorrow
    },
    {
      id: 'item-2',
      title: 'Sprint planning',
      dueDate: new Date(Date.now() - 86400000).toISOString(), // Yesterday (overdue)
    },
  ];

  const defaultProps: UpcomingDueWidgetProps = {
    items: mockItems,
    onItemClick: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render all items', () => {
    render(<UpcomingDueWidget {...defaultProps} />);
    expect(screen.getByText('Review PR')).toBeInTheDocument();
    expect(screen.getByText('Sprint planning')).toBeInTheDocument();
  });

  it('should highlight overdue items', () => {
    render(<UpcomingDueWidget {...defaultProps} />);
    expect(screen.getByTestId('overdue-item-2')).toBeInTheDocument();
  });

  it('should call onItemClick when clicked', () => {
    const onItemClick = vi.fn();
    render(<UpcomingDueWidget {...defaultProps} onItemClick={onItemClick} />);

    fireEvent.click(screen.getByText('Review PR'));

    expect(onItemClick).toHaveBeenCalledWith('item-1');
  });

  it('should show empty state when no items', () => {
    render(<UpcomingDueWidget items={[]} onItemClick={vi.fn()} />);
    expect(screen.getByText(/no upcoming/i)).toBeInTheDocument();
  });

  it('should group by urgency', () => {
    render(<UpcomingDueWidget {...defaultProps} groupByUrgency />);
    expect(screen.getByText('Overdue')).toBeInTheDocument();
    expect(screen.getByText('Upcoming')).toBeInTheDocument();
  });
});

describe('ActivityWidget', () => {
  const mockActivities = [
    {
      id: 'activity-1',
      description: 'Alice updated Issue #123',
      timestamp: new Date().toISOString(),
    },
    {
      id: 'activity-2',
      description: 'Bob commented on Task #456',
      timestamp: new Date(Date.now() - 3600000).toISOString(),
    },
  ];

  const defaultProps: ActivityWidgetProps = {
    activities: mockActivities,
    onActivityClick: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render all activities', () => {
    render(<ActivityWidget {...defaultProps} />);
    expect(screen.getByText(/alice updated/i)).toBeInTheDocument();
    expect(screen.getByText(/bob commented/i)).toBeInTheDocument();
  });

  it('should show relative timestamps', () => {
    render(<ActivityWidget {...defaultProps} />);
    expect(screen.getByText(/just now|minute/i)).toBeInTheDocument();
  });

  it('should call onActivityClick when clicked', () => {
    const onActivityClick = vi.fn();
    render(<ActivityWidget {...defaultProps} onActivityClick={onActivityClick} />);

    fireEvent.click(screen.getByText(/alice updated/i));

    expect(onActivityClick).toHaveBeenCalledWith('activity-1');
  });

  it('should show empty state when no activities', () => {
    render(<ActivityWidget activities={[]} onActivityClick={vi.fn()} />);
    expect(screen.getByText(/no recent activity/i)).toBeInTheDocument();
  });
});

describe('StatsWidget', () => {
  const mockStats = {
    completedThisWeek: 12,
    inProgress: 5,
    overdue: 2,
    total: 45,
  };

  const defaultProps: StatsWidgetProps = {
    stats: mockStats,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render completed count', () => {
    render(<StatsWidget {...defaultProps} />);
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText(/completed/i)).toBeInTheDocument();
  });

  it('should render in progress count', () => {
    render(<StatsWidget {...defaultProps} />);
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText(/in progress/i)).toBeInTheDocument();
  });

  it('should render overdue count', () => {
    render(<StatsWidget {...defaultProps} />);
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText(/overdue/i)).toBeInTheDocument();
  });

  it('should highlight overdue in red', () => {
    render(<StatsWidget {...defaultProps} />);
    const overdueSection = screen.getByTestId('stat-overdue');
    expect(overdueSection).toHaveClass('text-red-500');
  });
});

/**
 * @vitest-environment jsdom
 */
import * as React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GanttChart, TimelineBar, TimelineRowLabel, type TimelineItem } from '@/ui/components/timeline';

const today = new Date();
const mockItems: TimelineItem[] = [
  {
    id: '1',
    title: 'Project Alpha',
    kind: 'project',
    status: 'in_progress',
    startDate: new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000),
    endDate: new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000),
    progress: 30,
  },
  {
    id: '2',
    title: 'Initiative One',
    kind: 'initiative',
    status: 'in_progress',
    startDate: new Date(today.getTime() - 5 * 24 * 60 * 60 * 1000),
    endDate: new Date(today.getTime() + 20 * 24 * 60 * 60 * 1000),
    parentId: '1',
    progress: 50,
  },
  {
    id: '3',
    title: 'Epic Task',
    kind: 'epic',
    status: 'not_started',
    startDate: new Date(today.getTime() + 5 * 24 * 60 * 60 * 1000),
    endDate: new Date(today.getTime() + 15 * 24 * 60 * 60 * 1000),
    parentId: '2',
  },
  {
    id: '4',
    title: 'Overdue Item',
    kind: 'issue',
    status: 'blocked',
    startDate: new Date(today.getTime() - 14 * 24 * 60 * 60 * 1000),
    endDate: new Date(today.getTime() - 3 * 24 * 60 * 60 * 1000),
  },
];

describe('TimelineBar', () => {
  const item: TimelineItem = mockItems[0];

  it('renders bar with correct position', () => {
    const { container } = render(<TimelineBar item={item} left={100} width={200} />);
    const bar = container.querySelector('[data-testid="timeline-bar"]');

    expect(bar).toHaveStyle({ left: '100px', width: '200px' });
  });

  it('calls onClick when clicked', () => {
    const onClick = vi.fn();
    render(<TimelineBar item={item} left={0} width={100} onClick={onClick} />);

    fireEvent.click(screen.getByTestId('timeline-bar'));
    expect(onClick).toHaveBeenCalledWith(item);
  });

  it('shows title when bar is wide enough', () => {
    render(<TimelineBar item={item} left={0} width={100} />);
    expect(screen.getByText('Project Alpha')).toBeInTheDocument();
  });

  it('hides title when bar is too narrow', () => {
    render(<TimelineBar item={item} left={0} width={40} />);
    expect(screen.queryByText('Project Alpha')).not.toBeInTheDocument();
  });

  it('applies critical path styling', () => {
    const { container } = render(<TimelineBar item={item} left={0} width={100} isCriticalPath />);
    const bar = container.querySelector('[data-testid="timeline-bar"]');
    expect(bar?.className).toContain('ring-amber-500');
  });

  it('has accessible label', () => {
    render(<TimelineBar item={item} left={0} width={100} />);
    const bar = screen.getByRole('button');
    expect(bar).toHaveAttribute('aria-label');
  });
});

describe('TimelineRowLabel', () => {
  const item: TimelineItem = mockItems[0];

  it('renders item title', () => {
    render(<TimelineRowLabel item={item} depth={0} />);
    expect(screen.getByText('Project Alpha')).toBeInTheDocument();
  });

  it('indents based on depth', () => {
    const { container } = render(<TimelineRowLabel item={item} depth={2} />);
    const label = container.querySelector('[data-testid="timeline-row-label"]');
    expect(label).toHaveStyle({ paddingLeft: '40px' }); // 2 * 16 + 8
  });

  it('shows expand button when hasChildren', () => {
    render(<TimelineRowLabel item={item} depth={0} hasChildren onToggle={() => {}} />);
    expect(screen.getByLabelText('Expand')).toBeInTheDocument();
  });

  it('rotates chevron when expanded', () => {
    const { container } = render(<TimelineRowLabel item={item} depth={0} hasChildren isExpanded onToggle={() => {}} />);
    const chevron = container.querySelector('.rotate-90');
    expect(chevron).toBeTruthy();
  });

  it('calls onToggle when expand clicked', () => {
    const onToggle = vi.fn();
    render(<TimelineRowLabel item={item} depth={0} hasChildren onToggle={onToggle} />);

    fireEvent.click(screen.getByLabelText('Expand'));
    expect(onToggle).toHaveBeenCalledWith('1');
  });

  it('calls onClick when title clicked', () => {
    const onClick = vi.fn();
    render(<TimelineRowLabel item={item} depth={0} onClick={onClick} />);

    fireEvent.click(screen.getByText('Project Alpha'));
    expect(onClick).toHaveBeenCalledWith(item);
  });
});

describe('GanttChart', () => {
  it('renders toolbar with zoom controls', () => {
    render(<GanttChart items={mockItems} />);

    expect(screen.getByText('Zoom In')).toBeInTheDocument();
    expect(screen.getByText('Zoom Out')).toBeInTheDocument();
  });

  it('shows current zoom level', () => {
    render(<GanttChart items={mockItems} initialZoom="week" />);
    expect(screen.getByText('Week view')).toBeInTheDocument();
  });

  it('changes zoom level when buttons clicked', () => {
    render(<GanttChart items={mockItems} initialZoom="week" />);

    fireEvent.click(screen.getByText('Zoom In'));
    expect(screen.getByText('Day view')).toBeInTheDocument();
  });

  it('disables zoom in at day level', () => {
    render(<GanttChart items={mockItems} initialZoom="day" />);
    expect(screen.getByText('Zoom In').closest('button')).toBeDisabled();
  });

  it('disables zoom out at quarter level', () => {
    render(<GanttChart items={mockItems} initialZoom="quarter" />);
    expect(screen.getByText('Zoom Out').closest('button')).toBeDisabled();
  });

  it('renders all top-level items', () => {
    render(<GanttChart items={mockItems} />);

    // Items appear in both row label and bar, so use getAllByText
    expect(screen.getAllByText('Project Alpha').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Overdue Item').length).toBeGreaterThan(0);
  });

  it('expands to show children when toggle clicked', () => {
    render(<GanttChart items={mockItems} />);

    // Initially child is not visible
    expect(screen.queryAllByText('Initiative One')).toHaveLength(0);

    // Click expand on first expandable item
    const expandButtons = screen.getAllByLabelText('Expand');
    fireEvent.click(expandButtons[0]);

    // Now child is visible (may appear in label and bar)
    expect(screen.getAllByText('Initiative One').length).toBeGreaterThan(0);
  });

  it('shows Dependencies toggle', () => {
    render(<GanttChart items={mockItems} />);
    expect(screen.getByText('Dependencies')).toBeInTheDocument();
  });

  it('shows Critical Path toggle', () => {
    render(<GanttChart items={mockItems} />);
    expect(screen.getByText('Critical Path')).toBeInTheDocument();
  });

  it('calls onItemClick when bar is clicked', () => {
    const onItemClick = vi.fn();
    render(<GanttChart items={mockItems} onItemClick={onItemClick} />);

    const bars = screen.getAllByTestId('timeline-bar');
    fireEvent.click(bars[0]);

    expect(onItemClick).toHaveBeenCalled();
  });

  it('shows empty state when no items', () => {
    render(<GanttChart items={[]} />);
    expect(screen.getByText('No items to display on timeline')).toBeInTheDocument();
  });
});

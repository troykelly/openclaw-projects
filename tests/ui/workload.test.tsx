/**
 * @vitest-environment jsdom
 * Tests for resource allocation and workload components
 * Issue #392: Implement resource allocation and workload view
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as React from 'react';

// Components to be implemented
import { TeamMemberCard, type TeamMemberCardProps } from '@/ui/components/workload/team-member-card';
import { WorkloadBar, type WorkloadBarProps } from '@/ui/components/workload/workload-bar';
import { CapacityIndicator, type CapacityIndicatorProps } from '@/ui/components/workload/capacity-indicator';
import {
  calculateUtilization,
  calculateWorkload,
  detectOverallocation,
  formatHours,
  type TeamMember,
  type WorkAssignment,
  type WorkloadSummary,
} from '@/ui/components/workload/workload-utils';

describe('Workload Utils', () => {
  describe('calculateUtilization', () => {
    it('should return 0 for zero assigned hours', () => {
      expect(calculateUtilization(0, 40)).toBe(0);
    });

    it('should return 100 for fully utilized capacity', () => {
      expect(calculateUtilization(40, 40)).toBe(100);
    });

    it('should return percentage for partial utilization', () => {
      expect(calculateUtilization(20, 40)).toBe(50);
    });

    it('should return over 100 for over-allocated', () => {
      expect(calculateUtilization(50, 40)).toBe(125);
    });

    it('should handle zero capacity gracefully', () => {
      expect(calculateUtilization(10, 0)).toBe(Infinity);
    });
  });

  describe('calculateWorkload', () => {
    const assignments: WorkAssignment[] = [
      { id: '1', title: 'Task A', memberId: 'member-1', hours: 8 },
      { id: '2', title: 'Task B', memberId: 'member-1', hours: 12 },
      { id: '3', title: 'Task C', memberId: 'member-2', hours: 20 },
    ];

    it('should sum hours per member', () => {
      const result = calculateWorkload(assignments);
      expect(result.get('member-1')).toBe(20);
      expect(result.get('member-2')).toBe(20);
    });

    it('should return empty map for no assignments', () => {
      const result = calculateWorkload([]);
      expect(result.size).toBe(0);
    });

    it('should handle single assignment', () => {
      const result = calculateWorkload([{ id: '1', title: 'Task', memberId: 'member-1', hours: 5 }]);
      expect(result.get('member-1')).toBe(5);
    });
  });

  describe('detectOverallocation', () => {
    const members: TeamMember[] = [
      { id: 'member-1', name: 'Alice', hoursPerWeek: 40 },
      { id: 'member-2', name: 'Bob', hoursPerWeek: 30 },
    ];

    it('should detect over-allocated members', () => {
      const workload = new Map([
        ['member-1', 50], // 50 hours, 40 capacity - over-allocated
        ['member-2', 20], // 20 hours, 30 capacity - ok
      ]);

      const result = detectOverallocation(members, workload);

      expect(result).toContain('member-1');
      expect(result).not.toContain('member-2');
    });

    it('should return empty array when no over-allocation', () => {
      const workload = new Map([
        ['member-1', 35],
        ['member-2', 25],
      ]);

      const result = detectOverallocation(members, workload);

      expect(result).toHaveLength(0);
    });

    it('should handle members with no assignments', () => {
      const workload = new Map<string, number>();
      const result = detectOverallocation(members, workload);
      expect(result).toHaveLength(0);
    });
  });

  describe('formatHours', () => {
    it('should format whole hours', () => {
      expect(formatHours(8)).toBe('8h');
    });

    it('should format fractional hours', () => {
      expect(formatHours(8.5)).toBe('8.5h');
    });

    it('should format zero hours', () => {
      expect(formatHours(0)).toBe('0h');
    });

    it('should round to one decimal', () => {
      expect(formatHours(8.333)).toBe('8.3h');
    });
  });
});

describe('TeamMemberCard', () => {
  const defaultProps: TeamMemberCardProps = {
    member: {
      id: 'member-1',
      name: 'Alice Johnson',
      hoursPerWeek: 40,
      avatar: undefined,
    },
    assignedHours: 32,
    assignments: [
      { id: '1', title: 'Task A', hours: 16 },
      { id: '2', title: 'Task B', hours: 16 },
    ],
    onAssignmentClick: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render member name', () => {
    render(<TeamMemberCard {...defaultProps} />);
    expect(screen.getByText('Alice Johnson')).toBeInTheDocument();
  });

  it('should show capacity info', () => {
    render(<TeamMemberCard {...defaultProps} />);
    expect(screen.getByText(/40h/i)).toBeInTheDocument();
  });

  it('should show assigned hours', () => {
    render(<TeamMemberCard {...defaultProps} />);
    expect(screen.getByText(/32h/i)).toBeInTheDocument();
  });

  it('should show utilization percentage', () => {
    render(<TeamMemberCard {...defaultProps} />);
    expect(screen.getByText(/80%/)).toBeInTheDocument();
  });

  it('should show assignments list', () => {
    render(<TeamMemberCard {...defaultProps} />);
    expect(screen.getByText('Task A')).toBeInTheDocument();
    expect(screen.getByText('Task B')).toBeInTheDocument();
  });

  it('should highlight over-allocation in red', () => {
    render(<TeamMemberCard {...defaultProps} assignedHours={50} />);
    const utilization = screen.getByText(/125%/);
    expect(utilization).toHaveClass('text-destructive');
  });

  it('should call onAssignmentClick when assignment is clicked', () => {
    const onAssignmentClick = vi.fn();
    render(<TeamMemberCard {...defaultProps} onAssignmentClick={onAssignmentClick} />);

    const taskA = screen.getByText('Task A');
    fireEvent.click(taskA);

    expect(onAssignmentClick).toHaveBeenCalledWith('1');
  });

  it('should show available hours when under capacity', () => {
    render(<TeamMemberCard {...defaultProps} />);
    // 40 - 32 = 8 hours available
    expect(screen.getByText(/8h.*available/i)).toBeInTheDocument();
  });
});

describe('WorkloadBar', () => {
  const defaultProps: WorkloadBarProps = {
    assignedHours: 32,
    capacityHours: 40,
    segments: [
      { id: '1', title: 'Task A', hours: 16, color: '#4f46e5' },
      { id: '2', title: 'Task B', hours: 16, color: '#10b981' },
    ],
  };

  it('should render workload bar', () => {
    render(<WorkloadBar {...defaultProps} />);
    expect(screen.getByTestId('workload-bar')).toBeInTheDocument();
  });

  it('should show segments with correct widths', () => {
    render(<WorkloadBar {...defaultProps} />);
    const segments = screen.getAllByTestId('workload-segment');
    expect(segments).toHaveLength(2);
  });

  it('should show capacity line at 100%', () => {
    render(<WorkloadBar {...defaultProps} />);
    expect(screen.getByTestId('capacity-line')).toBeInTheDocument();
  });

  it('should show over-allocation when exceeds capacity', () => {
    render(<WorkloadBar {...defaultProps} assignedHours={50} />);
    const bar = screen.getByTestId('workload-bar');
    expect(bar).toHaveAttribute('data-overallocated', 'true');
  });

  it('should render segments with data for tooltips', () => {
    render(<WorkloadBar {...defaultProps} />);
    const segments = screen.getAllByTestId('workload-segment');
    // Each segment should be rendered and interactive
    expect(segments).toHaveLength(2);
    // Segments should have correct widths based on hours
    // First segment: 16h / 40h (capacity) = 40%
    expect(segments[0]).toHaveStyle({ width: '40%' });
  });
});

describe('CapacityIndicator', () => {
  const defaultProps: CapacityIndicatorProps = {
    assignedHours: 32,
    capacityHours: 40,
    showDetails: true,
  };

  it('should render utilization percentage', () => {
    render(<CapacityIndicator {...defaultProps} />);
    expect(screen.getByText(/80%/)).toBeInTheDocument();
  });

  it('should show green when under 80% utilized', () => {
    render(<CapacityIndicator {...defaultProps} assignedHours={30} />);
    const indicator = screen.getByTestId('capacity-indicator');
    expect(indicator).toHaveAttribute('data-status', 'low');
  });

  it('should show amber when 80-100% utilized', () => {
    render(<CapacityIndicator {...defaultProps} />);
    const indicator = screen.getByTestId('capacity-indicator');
    expect(indicator).toHaveAttribute('data-status', 'medium');
  });

  it('should show red when over 100% utilized', () => {
    render(<CapacityIndicator {...defaultProps} assignedHours={50} />);
    const indicator = screen.getByTestId('capacity-indicator');
    expect(indicator).toHaveAttribute('data-status', 'high');
  });

  it('should show hours breakdown when showDetails is true', () => {
    render(<CapacityIndicator {...defaultProps} showDetails={true} />);
    expect(screen.getByText(/32h.*40h/)).toBeInTheDocument();
  });

  it('should hide hours breakdown when showDetails is false', () => {
    render(<CapacityIndicator {...defaultProps} showDetails={false} />);
    expect(screen.queryByText(/32h.*40h/)).not.toBeInTheDocument();
  });
});

describe('Integration', () => {
  it('should correctly identify bottlenecks', () => {
    const members: TeamMember[] = [
      { id: '1', name: 'Alice', hoursPerWeek: 40 },
      { id: '2', name: 'Bob', hoursPerWeek: 40 },
      { id: '3', name: 'Charlie', hoursPerWeek: 40 },
    ];

    const assignments: WorkAssignment[] = [
      { id: 'a', title: 'Task A', memberId: '1', hours: 45 }, // Over
      { id: 'b', title: 'Task B', memberId: '2', hours: 50 }, // Over
      { id: 'c', title: 'Task C', memberId: '3', hours: 30 }, // OK
    ];

    const workload = calculateWorkload(assignments);
    const overallocated = detectOverallocation(members, workload);

    expect(overallocated).toContain('1');
    expect(overallocated).toContain('2');
    expect(overallocated).not.toContain('3');
  });
});

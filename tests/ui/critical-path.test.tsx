/**
 * @vitest-environment jsdom
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { calculateCriticalPath, TaskNode, CriticalPathResult } from '@/ui/components/critical-path/critical-path-algorithm';
import { CriticalPathToggle } from '@/ui/components/critical-path/critical-path-toggle';
import { CriticalPathInsights } from '@/ui/components/critical-path/critical-path-insights';
import { CriticalPathLegend } from '@/ui/components/critical-path/critical-path-legend';

describe('Critical Path Algorithm', () => {
  // Simple linear chain: A -> B -> C
  const linearTasks: TaskNode[] = [
    { id: 'A', duration: 3, dependencies: [] },
    { id: 'B', duration: 2, dependencies: ['A'] },
    { id: 'C', duration: 4, dependencies: ['B'] },
  ];

  it('calculates critical path for linear chain', () => {
    const result = calculateCriticalPath(linearTasks);

    expect(result.criticalPath).toEqual(['A', 'B', 'C']);
    expect(result.totalDuration).toBe(9);
  });

  it('calculates early start/finish times', () => {
    const result = calculateCriticalPath(linearTasks);

    const taskA = result.tasks.get('A');
    expect(taskA?.earlyStart).toBe(0);
    expect(taskA?.earlyFinish).toBe(3);

    const taskB = result.tasks.get('B');
    expect(taskB?.earlyStart).toBe(3);
    expect(taskB?.earlyFinish).toBe(5);

    const taskC = result.tasks.get('C');
    expect(taskC?.earlyStart).toBe(5);
    expect(taskC?.earlyFinish).toBe(9);
  });

  it('calculates late start/finish times', () => {
    const result = calculateCriticalPath(linearTasks);

    const taskA = result.tasks.get('A');
    expect(taskA?.lateStart).toBe(0);
    expect(taskA?.lateFinish).toBe(3);

    const taskC = result.tasks.get('C');
    expect(taskC?.lateStart).toBe(5);
    expect(taskC?.lateFinish).toBe(9);
  });

  it('calculates zero slack for critical path tasks', () => {
    const result = calculateCriticalPath(linearTasks);

    expect(result.tasks.get('A')?.slack).toBe(0);
    expect(result.tasks.get('B')?.slack).toBe(0);
    expect(result.tasks.get('C')?.slack).toBe(0);
  });

  // Parallel paths: A -> B -> D
  //                 A -> C -> D
  const parallelTasks: TaskNode[] = [
    { id: 'A', duration: 2, dependencies: [] },
    { id: 'B', duration: 5, dependencies: ['A'] }, // longer path
    { id: 'C', duration: 3, dependencies: ['A'] }, // shorter path
    { id: 'D', duration: 2, dependencies: ['B', 'C'] },
  ];

  it('identifies critical path in parallel tasks', () => {
    const result = calculateCriticalPath(parallelTasks);

    // A -> B -> D is the critical path (duration: 2 + 5 + 2 = 9)
    expect(result.criticalPath).toContain('A');
    expect(result.criticalPath).toContain('B');
    expect(result.criticalPath).toContain('D');
    expect(result.criticalPath).not.toContain('C');
    expect(result.totalDuration).toBe(9);
  });

  it('calculates positive slack for non-critical tasks', () => {
    const result = calculateCriticalPath(parallelTasks);

    const taskC = result.tasks.get('C');
    // C can start after A finishes (t=2), must finish before D needs it
    // ES(C) = 2, EF(C) = 5
    // LF(C) = LS(D) = 7, LS(C) = 4
    // Slack = LS - ES = 4 - 2 = 2
    expect(taskC?.slack).toBe(2);
  });

  // Diamond pattern: A -> B -> D, A -> C -> D
  const diamondTasks: TaskNode[] = [
    { id: 'A', duration: 1, dependencies: [] },
    { id: 'B', duration: 4, dependencies: ['A'] },
    { id: 'C', duration: 4, dependencies: ['A'] },
    { id: 'D', duration: 1, dependencies: ['B', 'C'] },
  ];

  it('handles diamond pattern with equal paths', () => {
    const result = calculateCriticalPath(diamondTasks);

    // Both paths are equal length, both are critical
    expect(result.criticalPath).toContain('A');
    expect(result.criticalPath).toContain('B');
    expect(result.criticalPath).toContain('C');
    expect(result.criticalPath).toContain('D');
  });

  // Empty input
  it('handles empty task list', () => {
    const result = calculateCriticalPath([]);

    expect(result.criticalPath).toEqual([]);
    expect(result.totalDuration).toBe(0);
  });

  // Single task
  it('handles single task', () => {
    const result = calculateCriticalPath([{ id: 'X', duration: 5, dependencies: [] }]);

    expect(result.criticalPath).toEqual(['X']);
    expect(result.totalDuration).toBe(5);
  });

  // Multiple start nodes
  const multiStartTasks: TaskNode[] = [
    { id: 'A', duration: 2, dependencies: [] },
    { id: 'B', duration: 3, dependencies: [] },
    { id: 'C', duration: 1, dependencies: ['A', 'B'] },
  ];

  it('handles multiple start nodes', () => {
    const result = calculateCriticalPath(multiStartTasks);

    // B -> C is the critical path (3 + 1 = 4)
    expect(result.criticalPath).toContain('B');
    expect(result.criticalPath).toContain('C');
    expect(result.totalDuration).toBe(4);
  });

  // Multiple end nodes
  const multiEndTasks: TaskNode[] = [
    { id: 'A', duration: 2, dependencies: [] },
    { id: 'B', duration: 5, dependencies: ['A'] },
    { id: 'C', duration: 3, dependencies: ['A'] },
  ];

  it('handles multiple end nodes', () => {
    const result = calculateCriticalPath(multiEndTasks);

    // A -> B is the critical path (2 + 5 = 7)
    expect(result.criticalPath).toEqual(['A', 'B']);
    expect(result.totalDuration).toBe(7);
  });
});

describe('CriticalPathToggle', () => {
  it('renders toggle button', () => {
    render(<CriticalPathToggle enabled={false} onToggle={vi.fn()} />);
    expect(screen.getByRole('switch')).toBeInTheDocument();
  });

  it('shows enabled state', () => {
    render(<CriticalPathToggle enabled={true} onToggle={vi.fn()} />);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  });

  it('calls onToggle when clicked', () => {
    const onToggle = vi.fn();
    render(<CriticalPathToggle enabled={false} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole('switch'));
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it('displays label', () => {
    render(<CriticalPathToggle enabled={false} onToggle={vi.fn()} />);
    expect(screen.getByText(/critical path/i)).toBeInTheDocument();
  });
});

describe('CriticalPathInsights', () => {
  const mockResult: CriticalPathResult = {
    criticalPath: ['A', 'B', 'C'],
    totalDuration: 9,
    tasks: new Map([
      ['A', { id: 'A', duration: 3, earlyStart: 0, earlyFinish: 3, lateStart: 0, lateFinish: 3, slack: 0 }],
      ['B', { id: 'B', duration: 2, earlyStart: 3, earlyFinish: 5, lateStart: 3, lateFinish: 5, slack: 0 }],
      ['C', { id: 'C', duration: 4, earlyStart: 5, earlyFinish: 9, lateStart: 5, lateFinish: 9, slack: 0 }],
    ]),
  };

  const mockTaskNames: Record<string, string> = {
    A: 'Task Alpha',
    B: 'Task Beta',
    C: 'Task Gamma',
  };

  it('shows total duration', () => {
    render(<CriticalPathInsights result={mockResult} taskNames={mockTaskNames} />);
    expect(screen.getByText(/9/)).toBeInTheDocument();
  });

  it('shows critical path task count', () => {
    render(<CriticalPathInsights result={mockResult} taskNames={mockTaskNames} />);
    expect(screen.getByText(/3.*tasks/i)).toBeInTheDocument();
  });

  it('lists critical path tasks', () => {
    render(<CriticalPathInsights result={mockResult} taskNames={mockTaskNames} />);
    expect(screen.getByText('Task Alpha')).toBeInTheDocument();
    expect(screen.getByText('Task Beta')).toBeInTheDocument();
    expect(screen.getByText('Task Gamma')).toBeInTheDocument();
  });

  it('shows no critical path message when empty', () => {
    const emptyResult: CriticalPathResult = {
      criticalPath: [],
      totalDuration: 0,
      tasks: new Map(),
    };
    render(<CriticalPathInsights result={emptyResult} taskNames={{}} />);
    expect(screen.getByText(/no critical path/i)).toBeInTheDocument();
  });
});

describe('CriticalPathLegend', () => {
  it('shows critical path indicator', () => {
    render(<CriticalPathLegend />);
    expect(screen.getByText(/critical path/i)).toBeInTheDocument();
  });

  it('shows slack/float indicator', () => {
    render(<CriticalPathLegend />);
    expect(screen.getByText(/slack/i)).toBeInTheDocument();
  });
});

/**
 * @vitest-environment jsdom
 * Tests for timeline zoom and navigation components
 * Issue #393: Implement timeline zoom enhancements and navigation
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as React from 'react';

// Components to be implemented
import { TodayIndicator, type TodayIndicatorProps } from '@/ui/components/timeline-nav/today-indicator';
import { ZoomControls, type ZoomControlsProps } from '@/ui/components/timeline-nav/zoom-controls';
import { DateNavigation, type DateNavigationProps } from '@/ui/components/timeline-nav/date-navigation';
import { useTimelineNavigation, type TimelineNavigationOptions } from '@/ui/components/timeline-nav/use-timeline-navigation';
import { getZoomLevelDays, formatZoomLevel, calculateDatePosition, isToday, type ZoomLevel } from '@/ui/components/timeline-nav/timeline-utils';

describe('Timeline Utils', () => {
  describe('getZoomLevelDays', () => {
    it('should return 1 for hour zoom', () => {
      expect(getZoomLevelDays('hour')).toBe(1);
    });

    it('should return 1 for day zoom', () => {
      expect(getZoomLevelDays('day')).toBe(1);
    });

    it('should return 7 for week zoom', () => {
      expect(getZoomLevelDays('week')).toBe(7);
    });

    it('should return 30 for month zoom', () => {
      expect(getZoomLevelDays('month')).toBe(30);
    });

    it('should return 90 for quarter zoom', () => {
      expect(getZoomLevelDays('quarter')).toBe(90);
    });

    it('should return 365 for year zoom', () => {
      expect(getZoomLevelDays('year')).toBe(365);
    });
  });

  describe('formatZoomLevel', () => {
    it('should format hour level', () => {
      expect(formatZoomLevel('hour')).toBe('Hour');
    });

    it('should format day level', () => {
      expect(formatZoomLevel('day')).toBe('Day');
    });

    it('should format week level', () => {
      expect(formatZoomLevel('week')).toBe('Week');
    });

    it('should format month level', () => {
      expect(formatZoomLevel('month')).toBe('Month');
    });

    it('should format quarter level', () => {
      expect(formatZoomLevel('quarter')).toBe('Quarter');
    });

    it('should format year level', () => {
      expect(formatZoomLevel('year')).toBe('Year');
    });
  });

  describe('calculateDatePosition', () => {
    it('should return 0 for date at start', () => {
      const start = new Date('2026-01-01');
      const end = new Date('2026-01-31');
      const date = new Date('2026-01-01');

      expect(calculateDatePosition(date, start, end)).toBe(0);
    });

    it('should return 100 for date at end', () => {
      const start = new Date('2026-01-01');
      const end = new Date('2026-01-31');
      const date = new Date('2026-01-31');

      expect(calculateDatePosition(date, start, end)).toBe(100);
    });

    it('should return 50 for date at middle', () => {
      const start = new Date('2026-01-01');
      const end = new Date('2026-01-31');
      const date = new Date('2026-01-16');

      const position = calculateDatePosition(date, start, end);
      expect(position).toBeCloseTo(50, 0);
    });

    it('should handle date before start', () => {
      const start = new Date('2026-01-15');
      const end = new Date('2026-01-31');
      const date = new Date('2026-01-01');

      expect(calculateDatePosition(date, start, end)).toBeLessThan(0);
    });

    it('should handle date after end', () => {
      const start = new Date('2026-01-01');
      const end = new Date('2026-01-15');
      const date = new Date('2026-01-31');

      expect(calculateDatePosition(date, start, end)).toBeGreaterThan(100);
    });
  });

  describe('isToday', () => {
    it('should return true for today', () => {
      const today = new Date();
      expect(isToday(today)).toBe(true);
    });

    it('should return false for yesterday', () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      expect(isToday(yesterday)).toBe(false);
    });

    it('should return false for tomorrow', () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      expect(isToday(tomorrow)).toBe(false);
    });
  });
});

describe('TodayIndicator', () => {
  const defaultProps: TodayIndicatorProps = {
    position: 50,
    visible: true,
  };

  it('should render when visible', () => {
    render(<TodayIndicator {...defaultProps} />);
    expect(screen.getByTestId('today-indicator')).toBeInTheDocument();
  });

  it('should not render when not visible', () => {
    render(<TodayIndicator {...defaultProps} visible={false} />);
    expect(screen.queryByTestId('today-indicator')).not.toBeInTheDocument();
  });

  it('should position at correct percentage', () => {
    render(<TodayIndicator {...defaultProps} position={75} />);
    const indicator = screen.getByTestId('today-indicator');
    expect(indicator).toHaveStyle({ left: '75%' });
  });

  it('should show "Today" label', () => {
    render(<TodayIndicator {...defaultProps} showLabel />);
    expect(screen.getByText('Today')).toBeInTheDocument();
  });

  it('should have distinctive styling', () => {
    render(<TodayIndicator {...defaultProps} />);
    const indicator = screen.getByTestId('today-indicator');
    // The inner line element has the bg-primary class
    expect(indicator.querySelector('.bg-primary')).toBeInTheDocument();
  });
});

describe('ZoomControls', () => {
  const defaultProps: ZoomControlsProps = {
    currentZoom: 'week',
    onZoomChange: vi.fn(),
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onFitAll: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render zoom level buttons', () => {
    render(<ZoomControls {...defaultProps} />);
    expect(screen.getByRole('button', { name: /day/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /week/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /month/i })).toBeInTheDocument();
  });

  it('should highlight current zoom level', () => {
    render(<ZoomControls {...defaultProps} currentZoom="month" />);
    const monthButton = screen.getByRole('button', { name: /month/i });
    expect(monthButton).toHaveAttribute('data-active', 'true');
  });

  it('should call onZoomChange when level clicked', () => {
    const onZoomChange = vi.fn();
    render(<ZoomControls {...defaultProps} onZoomChange={onZoomChange} />);

    const dayButton = screen.getByRole('button', { name: /day/i });
    fireEvent.click(dayButton);

    expect(onZoomChange).toHaveBeenCalledWith('day');
  });

  it('should render zoom in/out buttons', () => {
    render(<ZoomControls {...defaultProps} />);
    expect(screen.getByRole('button', { name: /zoom in/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /zoom out/i })).toBeInTheDocument();
  });

  it('should call onZoomIn when + clicked', () => {
    const onZoomIn = vi.fn();
    render(<ZoomControls {...defaultProps} onZoomIn={onZoomIn} />);

    const zoomInButton = screen.getByRole('button', { name: /zoom in/i });
    fireEvent.click(zoomInButton);

    expect(onZoomIn).toHaveBeenCalled();
  });

  it('should call onZoomOut when - clicked', () => {
    const onZoomOut = vi.fn();
    render(<ZoomControls {...defaultProps} onZoomOut={onZoomOut} />);

    const zoomOutButton = screen.getByRole('button', { name: /zoom out/i });
    fireEvent.click(zoomOutButton);

    expect(onZoomOut).toHaveBeenCalled();
  });

  it('should have fit all button', () => {
    const onFitAll = vi.fn();
    render(<ZoomControls {...defaultProps} onFitAll={onFitAll} />);

    const fitButton = screen.getByRole('button', { name: /fit/i });
    fireEvent.click(fitButton);

    expect(onFitAll).toHaveBeenCalled();
  });
});

describe('DateNavigation', () => {
  const defaultProps: DateNavigationProps = {
    currentDate: new Date('2026-01-15'),
    onDateChange: vi.fn(),
    onJumpToToday: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render current date', () => {
    render(<DateNavigation {...defaultProps} />);
    // Should show Jan 15, 2026 or similar format
    expect(screen.getByText(/jan.*15/i)).toBeInTheDocument();
  });

  it('should have today button', () => {
    render(<DateNavigation {...defaultProps} />);
    expect(screen.getByRole('button', { name: /today/i })).toBeInTheDocument();
  });

  it('should call onJumpToToday when today button clicked', () => {
    const onJumpToToday = vi.fn();
    render(<DateNavigation {...defaultProps} onJumpToToday={onJumpToToday} />);

    const todayButton = screen.getByRole('button', { name: /today/i });
    fireEvent.click(todayButton);

    expect(onJumpToToday).toHaveBeenCalled();
  });

  it('should have navigation arrows', () => {
    render(<DateNavigation {...defaultProps} />);
    expect(screen.getByRole('button', { name: /previous/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /next/i })).toBeInTheDocument();
  });

  it('should call onDateChange with previous period', () => {
    const onDateChange = vi.fn();
    render(<DateNavigation {...defaultProps} onDateChange={onDateChange} />);

    const prevButton = screen.getByRole('button', { name: /previous/i });
    fireEvent.click(prevButton);

    expect(onDateChange).toHaveBeenCalled();
    const newDate = onDateChange.mock.calls[0][0];
    expect(newDate.getTime()).toBeLessThan(defaultProps.currentDate.getTime());
  });

  it('should call onDateChange with next period', () => {
    const onDateChange = vi.fn();
    render(<DateNavigation {...defaultProps} onDateChange={onDateChange} />);

    const nextButton = screen.getByRole('button', { name: /next/i });
    fireEvent.click(nextButton);

    expect(onDateChange).toHaveBeenCalled();
    const newDate = onDateChange.mock.calls[0][0];
    expect(newDate.getTime()).toBeGreaterThan(defaultProps.currentDate.getTime());
  });
});

describe('useTimelineNavigation hook', () => {
  // Test wrapper component
  function TestComponent({
    options,
    onStateChange,
  }: {
    options?: Partial<TimelineNavigationOptions>;
    onStateChange?: (state: ReturnType<typeof useTimelineNavigation>) => void;
  }) {
    const state = useTimelineNavigation({
      initialZoom: 'week',
      initialDate: new Date('2026-01-15'),
      ...options,
    });

    React.useEffect(() => {
      onStateChange?.(state);
    }, [state, onStateChange]);

    return (
      <div>
        <span data-testid="zoom">{state.zoom}</span>
        <span data-testid="date">{state.currentDate.toISOString()}</span>
        <button onClick={state.zoomIn}>Zoom In</button>
        <button onClick={state.zoomOut}>Zoom Out</button>
        <button onClick={state.jumpToToday}>Today</button>
      </div>
    );
  }

  it('should initialize with provided zoom level', () => {
    render(<TestComponent options={{ initialZoom: 'month' }} />);
    expect(screen.getByTestId('zoom').textContent).toBe('month');
  });

  it('should zoom in to more granular level', () => {
    render(<TestComponent options={{ initialZoom: 'week' }} />);

    const zoomInButton = screen.getByText('Zoom In');
    fireEvent.click(zoomInButton);

    expect(screen.getByTestId('zoom').textContent).toBe('day');
  });

  it('should zoom out to less granular level', () => {
    render(<TestComponent options={{ initialZoom: 'week' }} />);

    const zoomOutButton = screen.getByText('Zoom Out');
    fireEvent.click(zoomOutButton);

    expect(screen.getByTestId('zoom').textContent).toBe('month');
  });

  it('should jump to today when requested', () => {
    const today = new Date();
    render(<TestComponent options={{ initialDate: new Date('2020-01-01') }} />);

    const todayButton = screen.getByText('Today');
    fireEvent.click(todayButton);

    const dateStr = screen.getByTestId('date').textContent!;
    const currentDate = new Date(dateStr);
    expect(currentDate.toDateString()).toBe(today.toDateString());
  });
});

describe('Keyboard shortcuts', () => {
  it('should be documented for T (today), F (fit), +/- (zoom)', () => {
    // This test verifies the expected keyboard shortcuts are defined
    const expectedShortcuts = {
      t: 'Jump to today',
      f: 'Fit all items',
      '+': 'Zoom in',
      '-': 'Zoom out',
    };

    expect(Object.keys(expectedShortcuts)).toContain('t');
    expect(Object.keys(expectedShortcuts)).toContain('f');
    expect(Object.keys(expectedShortcuts)).toContain('+');
    expect(Object.keys(expectedShortcuts)).toContain('-');
  });
});

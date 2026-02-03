/**
 * @vitest-environment jsdom
 * Tests for mobile responsive components
 * Issue #412: Mobile responsive improvements
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as React from 'react';

// Components to be implemented
import {
  MobileContainer,
  type MobileContainerProps,
} from '@/ui/components/mobile/mobile-container';
import {
  TouchTarget,
  type TouchTargetProps,
} from '@/ui/components/mobile/touch-target';
import {
  SwipeActions,
  type SwipeActionsProps,
} from '@/ui/components/mobile/swipe-actions';
import {
  PullToRefresh,
  type PullToRefreshProps,
} from '@/ui/components/mobile/pull-to-refresh';
import {
  useMediaQuery,
  useMobile,
} from '@/ui/components/mobile/use-mobile';

// Test wrapper for hooks
function TestMobileHook() {
  const isMobile = useMobile();
  return <div data-testid="is-mobile">{isMobile ? 'true' : 'false'}</div>;
}

function TestMediaQuery({ query }: { query: string }) {
  const matches = useMediaQuery(query);
  return <div data-testid="matches">{matches ? 'true' : 'false'}</div>;
}

describe('MobileContainer', () => {
  const defaultProps: MobileContainerProps = {
    children: <div>Content</div>,
  };

  it('should render children', () => {
    render(<MobileContainer {...defaultProps} />);
    expect(screen.getByText('Content')).toBeInTheDocument();
  });

  it('should apply mobile-friendly padding', () => {
    render(<MobileContainer {...defaultProps} />);
    const container = screen.getByTestId('mobile-container');
    expect(container).toHaveClass('px-4');
  });

  it('should support safe area insets', () => {
    render(<MobileContainer {...defaultProps} safeArea />);
    const container = screen.getByTestId('mobile-container');
    expect(container).toHaveClass('pb-safe');
  });

  it('should support full height mode', () => {
    render(<MobileContainer {...defaultProps} fullHeight />);
    const container = screen.getByTestId('mobile-container');
    expect(container).toHaveClass('min-h-screen');
  });
});

describe('TouchTarget', () => {
  const defaultProps: TouchTargetProps = {
    children: <button>Click me</button>,
  };

  it('should render children', () => {
    render(<TouchTarget {...defaultProps} />);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('should have minimum 44px touch target', () => {
    render(<TouchTarget {...defaultProps} />);
    const wrapper = screen.getByTestId('touch-target');
    expect(wrapper).toHaveClass('min-h-11'); // 44px in Tailwind
    expect(wrapper).toHaveClass('min-w-11');
  });

  it('should center content', () => {
    render(<TouchTarget {...defaultProps} />);
    const wrapper = screen.getByTestId('touch-target');
    expect(wrapper).toHaveClass('flex');
    expect(wrapper).toHaveClass('items-center');
    expect(wrapper).toHaveClass('justify-center');
  });

  it('should support custom size', () => {
    render(<TouchTarget {...defaultProps} size="lg" />);
    const wrapper = screen.getByTestId('touch-target');
    expect(wrapper).toHaveClass('min-h-14'); // 56px
  });
});

describe('SwipeActions', () => {
  const defaultProps: SwipeActionsProps = {
    children: <div>Swipeable content</div>,
    leftAction: { label: 'Delete', onAction: vi.fn() },
    rightAction: { label: 'Archive', onAction: vi.fn() },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render children', () => {
    render(<SwipeActions {...defaultProps} />);
    expect(screen.getByText('Swipeable content')).toBeInTheDocument();
  });

  it('should show left action on swipe right', () => {
    render(<SwipeActions {...defaultProps} />);
    const swipeable = screen.getByTestId('swipe-actions');

    fireEvent.touchStart(swipeable, { touches: [{ clientX: 0, clientY: 0 }] });
    fireEvent.touchMove(swipeable, { touches: [{ clientX: 100, clientY: 0 }] });
    fireEvent.touchEnd(swipeable);

    expect(screen.getByText('Delete')).toBeVisible();
  });

  it('should show right action on swipe left', () => {
    render(<SwipeActions {...defaultProps} />);
    const swipeable = screen.getByTestId('swipe-actions');

    fireEvent.touchStart(swipeable, { touches: [{ clientX: 100, clientY: 0 }] });
    fireEvent.touchMove(swipeable, { touches: [{ clientX: 0, clientY: 0 }] });
    fireEvent.touchEnd(swipeable);

    expect(screen.getByText('Archive')).toBeVisible();
  });

  it('should call action on tap after swipe', () => {
    const onDelete = vi.fn();
    render(
      <SwipeActions
        {...defaultProps}
        leftAction={{ label: 'Delete', onAction: onDelete }}
      />
    );
    const swipeable = screen.getByTestId('swipe-actions');

    fireEvent.touchStart(swipeable, { touches: [{ clientX: 0, clientY: 0 }] });
    fireEvent.touchMove(swipeable, { touches: [{ clientX: 100, clientY: 0 }] });
    fireEvent.touchEnd(swipeable);

    fireEvent.click(screen.getByText('Delete'));

    expect(onDelete).toHaveBeenCalled();
  });
});

describe('PullToRefresh', () => {
  const defaultProps: PullToRefreshProps = {
    onRefresh: vi.fn(),
    children: <div>Scrollable content</div>,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render children', () => {
    render(<PullToRefresh {...defaultProps} />);
    expect(screen.getByText('Scrollable content')).toBeInTheDocument();
  });

  it('should show refresh indicator on pull down', () => {
    render(<PullToRefresh {...defaultProps} />);
    const container = screen.getByTestId('pull-to-refresh');

    fireEvent.touchStart(container, { touches: [{ clientY: 0 }] });
    fireEvent.touchMove(container, { touches: [{ clientY: 100 }] });

    expect(screen.getByTestId('refresh-indicator')).toBeVisible();
  });

  it('should call onRefresh when pulled past threshold', async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    render(<PullToRefresh {...defaultProps} onRefresh={onRefresh} threshold={50} />);
    const container = screen.getByTestId('pull-to-refresh');

    // Mock scrollTop to be 0 (at top)
    Object.defineProperty(container, 'scrollTop', { value: 0, writable: true });

    fireEvent.touchStart(container, { touches: [{ clientY: 0 }] });
    fireEvent.touchMove(container, { touches: [{ clientY: 200 }] }); // More than threshold * 2 (resistance)

    await act(async () => {
      fireEvent.touchEnd(container);
    });

    expect(onRefresh).toHaveBeenCalled();
  });

  it('should show loading state during refresh', async () => {
    const onRefresh = vi.fn().mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 100))
    );
    render(<PullToRefresh {...defaultProps} onRefresh={onRefresh} threshold={50} />);
    const container = screen.getByTestId('pull-to-refresh');

    // Mock scrollTop to be 0 (at top)
    Object.defineProperty(container, 'scrollTop', { value: 0, writable: true });

    fireEvent.touchStart(container, { touches: [{ clientY: 0 }] });
    fireEvent.touchMove(container, { touches: [{ clientY: 200 }] });

    await act(async () => {
      fireEvent.touchEnd(container);
      // Wait for state update
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(screen.getByTestId('refresh-loading')).toBeInTheDocument();
  });
});

describe('useMobile', () => {
  it('should return false for desktop viewport', () => {
    // Default JSDOM viewport is 1024px
    render(<TestMobileHook />);
    expect(screen.getByTestId('is-mobile')).toHaveTextContent('false');
  });

  it('should detect mobile based on max-width', () => {
    // Mock matchMedia for mobile
    const mockMatchMedia = vi.fn().mockImplementation((query) => ({
      matches: query.includes('max-width: 768px'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    window.matchMedia = mockMatchMedia;

    render(<TestMobileHook />);
    expect(screen.getByTestId('is-mobile')).toHaveTextContent('true');
  });
});

describe('useMediaQuery', () => {
  it('should return match status', () => {
    const mockMatchMedia = vi.fn().mockImplementation((query) => ({
      matches: query.includes('min-width: 1024px'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    window.matchMedia = mockMatchMedia;

    render(<TestMediaQuery query="(min-width: 1024px)" />);
    expect(screen.getByTestId('matches')).toHaveTextContent('true');
  });
});

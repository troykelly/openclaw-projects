/**
 * @vitest-environment jsdom
 * Tests for performance optimization components
 * Issue #413: Performance optimization
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as React from 'react';

// Components to be implemented
import {
  VirtualList,
  type VirtualListProps,
} from '@/ui/components/performance/virtual-list';
import {
  LazyLoad,
  type LazyLoadProps,
} from '@/ui/components/performance/lazy-load';
import {
  InfiniteScroll,
  type InfiniteScrollProps,
} from '@/ui/components/performance/infinite-scroll';
import {
  useDebounce,
  useThrottle,
} from '@/ui/components/performance/use-performance';

// Mock IntersectionObserver globally
class MockIntersectionObserver {
  callback: IntersectionObserverCallback;
  elements: Element[] = [];

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
  }

  observe(element: Element) {
    this.elements.push(element);
    // Simulate immediate intersection
    this.callback(
      [{ isIntersecting: true, target: element } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver
    );
  }

  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  window.IntersectionObserver = MockIntersectionObserver as unknown as typeof IntersectionObserver;
});

describe('VirtualList', () => {
  const items = Array.from({ length: 1000 }, (_, i) => ({
    id: `item-${i}`,
    label: `Item ${i}`,
  }));

  const defaultProps: VirtualListProps<{ id: string; label: string }> = {
    items,
    itemHeight: 40,
    height: 400,
    renderItem: (item) => <div key={item.id}>{item.label}</div>,
  };

  it('should render visible items only', () => {
    render(<VirtualList {...defaultProps} />);
    const container = screen.getByTestId('virtual-list');
    const itemCount = container.querySelectorAll('[data-virtual-item]').length;
    expect(itemCount).toBeLessThan(50);
  });

  it('should update visible items on scroll', async () => {
    render(<VirtualList {...defaultProps} />);
    const container = screen.getByTestId('virtual-list');

    fireEvent.scroll(container, { target: { scrollTop: 1000 } });

    await waitFor(() => {
      expect(screen.queryByText('Item 0')).not.toBeInTheDocument();
    });
  });

  it('should render correct total height', () => {
    render(<VirtualList {...defaultProps} />);
    const inner = screen.getByTestId('virtual-list-inner');
    expect(inner.style.height).toBe('40000px');
  });

  it('should handle empty items', () => {
    render(<VirtualList {...defaultProps} items={[]} />);
    expect(screen.getByTestId('virtual-list')).toBeInTheDocument();
  });

  it('should support overscan', () => {
    render(<VirtualList {...defaultProps} overscan={5} />);
    const container = screen.getByTestId('virtual-list');
    const itemCount = container.querySelectorAll('[data-virtual-item]').length;
    expect(itemCount).toBeGreaterThan(10);
  });
});

describe('LazyLoad', () => {
  const defaultProps: LazyLoadProps = {
    children: <div data-testid="lazy-content">Lazy loaded content</div>,
  };

  it('should render content (with mock intersection)', () => {
    render(<LazyLoad {...defaultProps} />);
    // With our mock, it immediately intersects
    expect(screen.getByTestId('lazy-content')).toBeInTheDocument();
  });

  it('should support custom placeholder rendering', () => {
    // Test that the component accepts a placeholder prop
    const placeholder = <div data-testid="custom-placeholder">Loading...</div>;
    render(<LazyLoad placeholder={placeholder}>{<div>Content</div>}</LazyLoad>);
    // With our mock, it immediately loads the content
    expect(screen.getByText('Content')).toBeInTheDocument();
  });
});

describe('InfiniteScroll', () => {
  const defaultProps: InfiniteScrollProps = {
    onLoadMore: vi.fn(),
    hasMore: true,
    children: <div>Content</div>,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render children', () => {
    render(<InfiniteScroll {...defaultProps} />);
    expect(screen.getByText('Content')).toBeInTheDocument();
  });

  it('should show loader when loading', () => {
    render(<InfiniteScroll {...defaultProps} loading />);
    expect(screen.getByTestId('infinite-scroll-loader')).toBeInTheDocument();
  });

  it('should show end message when no more items', () => {
    render(<InfiniteScroll {...defaultProps} hasMore={false} />);
    expect(screen.getByText(/no more items/i)).toBeInTheDocument();
  });

  it('should call onLoadMore when hasMore is true', () => {
    const onLoadMore = vi.fn();
    render(<InfiniteScroll {...defaultProps} onLoadMore={onLoadMore} />);
    // With our mock, it immediately triggers
    expect(onLoadMore).toHaveBeenCalled();
  });
});

describe('useDebounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function TestDebounce({ value, delay }: { value: string; delay: number }) {
    const debouncedValue = useDebounce(value, delay);
    return <div data-testid="debounced">{debouncedValue}</div>;
  }

  it('should return initial value immediately', () => {
    render(<TestDebounce value="initial" delay={500} />);
    expect(screen.getByTestId('debounced')).toHaveTextContent('initial');
  });

  it('should debounce value changes', () => {
    const { rerender } = render(<TestDebounce value="initial" delay={500} />);

    rerender(<TestDebounce value="updated" delay={500} />);

    expect(screen.getByTestId('debounced')).toHaveTextContent('initial');

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(screen.getByTestId('debounced')).toHaveTextContent('updated');
  });
});

describe('useThrottle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function TestThrottle({ value, delay }: { value: string; delay: number }) {
    const throttledValue = useThrottle(value, delay);
    return <div data-testid="throttled">{throttledValue}</div>;
  }

  it('should return initial value immediately', () => {
    render(<TestThrottle value="initial" delay={500} />);
    expect(screen.getByTestId('throttled')).toHaveTextContent('initial');
  });

  it('should update after delay', () => {
    const { rerender } = render(<TestThrottle value="initial" delay={500} />);

    rerender(<TestThrottle value="updated" delay={500} />);

    // After delay, value should update
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(screen.getByTestId('throttled')).toHaveTextContent('updated');
  });
});

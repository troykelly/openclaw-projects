/**
 * Performance hooks
 * Issue #413: Performance optimization
 */
import * as React from 'react';

/**
 * Debounce a value - waits for specified delay before updating
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = React.useState(value);

  React.useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}

/**
 * Throttle a value - limits updates to at most once per specified delay
 */
export function useThrottle<T>(value: T, delay: number): T {
  const [throttledValue, setThrottledValue] = React.useState(value);
  const lastUpdated = React.useRef(Date.now());

  React.useEffect(() => {
    const now = Date.now();
    const timeElapsed = now - lastUpdated.current;

    if (timeElapsed >= delay) {
      lastUpdated.current = now;
      setThrottledValue(value);
    } else {
      const timer = setTimeout(() => {
        lastUpdated.current = Date.now();
        setThrottledValue(value);
      }, delay - timeElapsed);

      return () => clearTimeout(timer);
    }
  }, [value, delay]);

  return throttledValue;
}

/**
 * Defer a value - similar to React 18's useDeferredValue
 */
export function useDeferredValue<T>(value: T): T {
  const [deferredValue, setDeferredValue] = React.useState(value);

  React.useEffect(() => {
    // Use requestIdleCallback if available, otherwise use setTimeout
    if ('requestIdleCallback' in window) {
      const id = window.requestIdleCallback(() => {
        setDeferredValue(value);
      });
      return () => window.cancelIdleCallback(id);
    } else {
      const id = setTimeout(() => {
        setDeferredValue(value);
      }, 0);
      return () => clearTimeout(id);
    }
  }, [value]);

  return deferredValue;
}

/**
 * Track scroll position with throttling
 */
export function useScrollPosition(throttleMs = 100): number {
  const [scrollY, setScrollY] = React.useState(0);

  React.useEffect(() => {
    let lastUpdate = 0;
    let rafId: number | null = null;

    const handleScroll = () => {
      const now = Date.now();
      if (now - lastUpdate >= throttleMs) {
        lastUpdate = now;
        if (rafId) {
          cancelAnimationFrame(rafId);
        }
        rafId = requestAnimationFrame(() => {
          setScrollY(window.scrollY);
        });
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [throttleMs]);

  return scrollY;
}

/**
 * Intersection observer hook
 */
export function useIntersectionObserver(
  ref: React.RefObject<Element>,
  options?: IntersectionObserverInit
): boolean {
  const [isIntersecting, setIsIntersecting] = React.useState(false);

  React.useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const observer = new IntersectionObserver(([entry]) => {
      setIsIntersecting(entry.isIntersecting);
    }, options);

    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, options?.root, options?.rootMargin, options?.threshold]);

  return isIntersecting;
}

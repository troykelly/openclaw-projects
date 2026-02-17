import * as React from 'react';
import { useEffect, useRef, useState, useCallback } from 'react';
import { cn } from '@/ui/lib/utils';

/**
 * Hook for managing focus trapping within a container (for modals/dialogs)
 */
export function useFocusTrap(is_active: boolean = true) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!is_active || !containerRef.current) return;

    const container = containerRef.current;
    const focusableElements = container.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');

    if (focusableElements.length === 0) return;

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    // Focus first element on mount
    firstElement.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;

      if (e.shiftKey) {
        if (document.activeElement === firstElement) {
          e.preventDefault();
          lastElement.focus();
        }
      } else {
        if (document.activeElement === lastElement) {
          e.preventDefault();
          firstElement.focus();
        }
      }
    };

    container.addEventListener('keydown', handleKeyDown);
    return () => container.removeEventListener('keydown', handleKeyDown);
  }, [is_active]);

  return containerRef;
}

/**
 * Hook for keyboard navigation in lists/grids
 */
export function useRovingFocus<T extends HTMLElement>(
  itemCount: number,
  options: {
    orientation?: 'horizontal' | 'vertical' | 'both';
    loop?: boolean;
    onSelect?: (index: number) => void;
  } = {},
) {
  const { orientation = 'vertical', loop = true, onSelect } = options;
  const [focusedIndex, setFocusedIndex] = useState(0);
  const itemsRef = useRef<(T | null)[]>([]);

  const setItemRef = useCallback(
    (index: number) => (el: T | null) => {
      itemsRef.current[index] = el;
    },
    [],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      let newIndex = focusedIndex;
      const isHorizontal = orientation === 'horizontal' || orientation === 'both';
      const isVertical = orientation === 'vertical' || orientation === 'both';

      switch (e.key) {
        case 'ArrowDown':
          if (isVertical) {
            e.preventDefault();
            newIndex = loop ? (focusedIndex + 1) % itemCount : Math.min(focusedIndex + 1, itemCount - 1);
          }
          break;
        case 'ArrowUp':
          if (isVertical) {
            e.preventDefault();
            newIndex = loop ? (focusedIndex - 1 + itemCount) % itemCount : Math.max(focusedIndex - 1, 0);
          }
          break;
        case 'ArrowRight':
          if (isHorizontal) {
            e.preventDefault();
            newIndex = loop ? (focusedIndex + 1) % itemCount : Math.min(focusedIndex + 1, itemCount - 1);
          }
          break;
        case 'ArrowLeft':
          if (isHorizontal) {
            e.preventDefault();
            newIndex = loop ? (focusedIndex - 1 + itemCount) % itemCount : Math.max(focusedIndex - 1, 0);
          }
          break;
        case 'Home':
          e.preventDefault();
          newIndex = 0;
          break;
        case 'End':
          e.preventDefault();
          newIndex = itemCount - 1;
          break;
        case 'Enter':
        case ' ':
          e.preventDefault();
          onSelect?.(focusedIndex);
          return;
      }

      if (newIndex !== focusedIndex) {
        setFocusedIndex(newIndex);
        itemsRef.current[newIndex]?.focus();
      }
    },
    [focusedIndex, itemCount, loop, orientation, onSelect],
  );

  return {
    focusedIndex,
    setFocusedIndex,
    setItemRef,
    handleKeyDown,
    getItemProps: (index: number) => ({
      ref: setItemRef(index),
      tabIndex: index === focusedIndex ? 0 : -1,
      'aria-selected': index === focusedIndex,
      onKeyDown: handleKeyDown,
      onFocus: () => setFocusedIndex(index),
    }),
  };
}

/**
 * Skip link for keyboard users to bypass navigation
 */
export interface SkipLinkProps {
  targetId: string;
  label?: string;
  className?: string;
}

export function SkipLink({ targetId, label = 'Skip to main content', className }: SkipLinkProps) {
  return (
    <a
      href={`#${targetId}`}
      className={cn(
        'sr-only focus:not-sr-only',
        'fixed top-4 left-4 z-50',
        'rounded-md bg-primary px-4 py-2 text-primary-foreground',
        'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
        className,
      )}
    >
      {label}
    </a>
  );
}

/**
 * Live region for announcing dynamic content to screen readers
 */
export interface LiveRegionProps {
  children?: React.ReactNode;
  politeness?: 'polite' | 'assertive' | 'off';
  atomic?: boolean;
  className?: string;
}

export function LiveRegion({ children, politeness = 'polite', atomic = true, className }: LiveRegionProps) {
  return (
    <div role="status" aria-live={politeness} aria-atomic={atomic} className={cn('sr-only', className)}>
      {children}
    </div>
  );
}

/**
 * Hook for announcing messages to screen readers
 */
export function useAnnounce() {
  const [message, setMessage] = useState('');

  const announce = useCallback((text: string, delay = 100) => {
    // Clear first to ensure re-announcement of same message
    setMessage('');
    setTimeout(() => setMessage(text), delay);
  }, []);

  return { message, announce, LiveRegion: () => <LiveRegion>{message}</LiveRegion> };
}

/**
 * Visually hidden content (still accessible to screen readers)
 */
export interface VisuallyHiddenProps {
  children: React.ReactNode;
  as?: keyof JSX.IntrinsicElements;
}

export function VisuallyHidden({ children, as: Component = 'span' }: VisuallyHiddenProps) {
  return <Component className="sr-only">{children}</Component>;
}

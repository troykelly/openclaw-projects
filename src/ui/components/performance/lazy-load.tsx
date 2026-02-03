/**
 * Lazy Load component
 * Issue #413: Performance optimization
 */
import * as React from 'react';

export interface LazyLoadProps {
  children: React.ReactNode;
  placeholder?: React.ReactNode;
  rootMargin?: string;
  threshold?: number;
}

export function LazyLoad({
  children,
  placeholder,
  rootMargin = '100px',
  threshold = 0,
}: LazyLoadProps) {
  const [isLoaded, setIsLoaded] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const element = ref.current;
    if (!element || isLoaded) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsLoaded(true);
          observer.disconnect();
        }
      },
      { rootMargin, threshold }
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [isLoaded, rootMargin, threshold]);

  if (isLoaded) {
    return <>{children}</>;
  }

  return (
    <div ref={ref} data-testid="lazy-placeholder">
      {placeholder || <div className="h-20 bg-muted animate-pulse rounded" />}
    </div>
  );
}

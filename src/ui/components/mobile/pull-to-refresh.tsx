/**
 * Pull to Refresh component
 * Issue #412: Mobile responsive improvements
 */
import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/ui/lib/utils';

export interface PullToRefreshProps {
  onRefresh: () => Promise<void>;
  children: React.ReactNode;
  threshold?: number;
  className?: string;
}

export function PullToRefresh({ onRefresh, children, threshold = 100, className }: PullToRefreshProps) {
  const [pullDistance, setPullDistance] = React.useState(0);
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const [startY, setStartY] = React.useState(0);
  const [isPulling, setIsPulling] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    // Only enable pull-to-refresh when scrolled to top
    if (containerRef.current && containerRef.current.scrollTop === 0) {
      setStartY(e.touches[0].clientY);
      setIsPulling(true);
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isPulling || isRefreshing) return;

    const currentY = e.touches[0].clientY;
    const diff = currentY - startY;

    if (diff > 0) {
      // Apply resistance
      const resistance = 0.5;
      setPullDistance(diff * resistance);
    }
  };

  const handleTouchEnd = async () => {
    if (!isPulling) return;
    setIsPulling(false);

    if (pullDistance >= threshold && !isRefreshing) {
      setIsRefreshing(true);
      try {
        await onRefresh();
      } finally {
        setIsRefreshing(false);
        setPullDistance(0);
      }
    } else {
      setPullDistance(0);
    }
  };

  const showIndicator = pullDistance > 0 || isRefreshing;

  return (
    <div
      ref={containerRef}
      data-testid="pull-to-refresh"
      className={cn('relative overflow-auto', className)}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Refresh indicator */}
      <div
        data-testid="refresh-indicator"
        className={cn('absolute top-0 left-0 right-0 flex items-center justify-center transition-all', showIndicator ? 'visible' : 'invisible')}
        style={{
          height: isRefreshing ? 48 : pullDistance,
          visibility: showIndicator ? 'visible' : 'hidden',
        }}
      >
        {isRefreshing ? (
          <Loader2 data-testid="refresh-loading" className="h-6 w-6 animate-spin text-primary" />
        ) : (
          <div
            className="h-6 w-6 rounded-full border-2 border-primary transition-transform"
            style={{
              transform: `rotate(${(pullDistance / threshold) * 360}deg)`,
            }}
          />
        )}
      </div>

      {/* Content */}
      <div
        className="transition-transform"
        style={{
          transform: `translateY(${isRefreshing ? 48 : pullDistance}px)`,
          transition: isPulling ? 'none' : 'transform 0.2s ease-out',
        }}
      >
        {children}
      </div>
    </div>
  );
}

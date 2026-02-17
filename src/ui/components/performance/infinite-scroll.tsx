/**
 * Infinite Scroll component
 * Issue #413: Performance optimization
 */
import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/ui/lib/utils';

export interface InfiniteScrollProps {
  children: React.ReactNode;
  onLoadMore: () => void;
  has_more: boolean;
  loading?: boolean;
  rootMargin?: string;
  loader?: React.ReactNode;
  className?: string;
}

export function InfiniteScroll({ children, onLoadMore, has_more, loading = false, rootMargin = '100px', loader, className }: InfiniteScrollProps) {
  const sentinelRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !has_more || loading) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && has_more && !loading) {
          onLoadMore();
        }
      },
      { rootMargin },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [has_more, loading, onLoadMore, rootMargin]);

  return (
    <div className={cn(className)}>
      {children}

      {/* Sentinel element for triggering load more */}
      <div ref={sentinelRef} className="h-px" />

      {/* Loading indicator */}
      {loading && (
        <div data-testid="infinite-scroll-loader" className="flex items-center justify-center py-4">
          {loader || <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />}
        </div>
      )}

      {/* End of list indicator */}
      {!has_more && !loading && <div className="text-center py-4 text-sm text-muted-foreground">No more items</div>}
    </div>
  );
}

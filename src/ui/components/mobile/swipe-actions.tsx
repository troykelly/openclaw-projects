/**
 * Swipe Actions component
 * Issue #412: Mobile responsive improvements
 */
import * as React from 'react';
import { cn } from '@/ui/lib/utils';

export interface SwipeAction {
  label: string;
  onAction: () => void;
  color?: 'default' | 'destructive';
}

export interface SwipeActionsProps {
  children: React.ReactNode;
  leftAction?: SwipeAction;
  rightAction?: SwipeAction;
  threshold?: number;
  className?: string;
}

export function SwipeActions({
  children,
  leftAction,
  rightAction,
  threshold = 50,
  className,
}: SwipeActionsProps) {
  const [swipeOffset, setSwipeOffset] = React.useState(0);
  const [startX, setStartX] = React.useState(0);
  const [isSwiping, setIsSwiping] = React.useState(false);

  const handleTouchStart = (e: React.TouchEvent) => {
    setStartX(e.touches[0].clientX);
    setIsSwiping(true);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isSwiping) return;

    const currentX = e.touches[0].clientX;
    const diff = currentX - startX;

    // Limit swipe distance
    const maxSwipe = 100;
    const clampedDiff = Math.max(-maxSwipe, Math.min(maxSwipe, diff));

    // Only allow swipe if corresponding action exists
    if (diff > 0 && !leftAction) return;
    if (diff < 0 && !rightAction) return;

    setSwipeOffset(clampedDiff);
  };

  const handleTouchEnd = () => {
    setIsSwiping(false);

    // Snap to action position or reset
    if (Math.abs(swipeOffset) > threshold) {
      setSwipeOffset(swipeOffset > 0 ? 80 : -80);
    } else {
      setSwipeOffset(0);
    }
  };

  const resetSwipe = () => {
    setSwipeOffset(0);
  };

  const handleLeftAction = () => {
    leftAction?.onAction();
    resetSwipe();
  };

  const handleRightAction = () => {
    rightAction?.onAction();
    resetSwipe();
  };

  return (
    <div
      data-testid="swipe-actions"
      className={cn('relative overflow-hidden', className)}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Left action (revealed on swipe right) */}
      {leftAction && (
        <button
          type="button"
          onClick={handleLeftAction}
          className={cn(
            'absolute left-0 top-0 bottom-0 w-20 flex items-center justify-center',
            leftAction.color === 'destructive'
              ? 'bg-destructive text-destructive-foreground'
              : 'bg-primary text-primary-foreground',
            swipeOffset > threshold ? 'visible' : 'invisible'
          )}
          style={{ visibility: swipeOffset > 0 ? 'visible' : 'hidden' }}
        >
          {leftAction.label}
        </button>
      )}

      {/* Right action (revealed on swipe left) */}
      {rightAction && (
        <button
          type="button"
          onClick={handleRightAction}
          className={cn(
            'absolute right-0 top-0 bottom-0 w-20 flex items-center justify-center',
            rightAction.color === 'destructive'
              ? 'bg-destructive text-destructive-foreground'
              : 'bg-primary text-primary-foreground',
            swipeOffset < -threshold ? 'visible' : 'invisible'
          )}
          style={{ visibility: swipeOffset < 0 ? 'visible' : 'hidden' }}
        >
          {rightAction.label}
        </button>
      )}

      {/* Main content */}
      <div
        className="relative bg-background transition-transform"
        style={{
          transform: `translateX(${swipeOffset}px)`,
          transition: isSwiping ? 'none' : 'transform 0.2s ease-out',
        }}
      >
        {children}
      </div>
    </div>
  );
}

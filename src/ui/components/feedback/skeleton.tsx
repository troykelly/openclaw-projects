import * as React from 'react';
import { cn } from '@/ui/lib/utils';

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Width of the skeleton (CSS value or number in px) */
  width?: string | number;
  /** Height of the skeleton (CSS value or number in px) */
  height?: string | number;
  /** Rounded corners variant */
  variant?: 'default' | 'circular' | 'rectangular';
  /** Animation style */
  animation?: 'pulse' | 'wave' | 'none';
}

export function Skeleton({ width, height, variant = 'default', animation = 'pulse', className, style, ...props }: SkeletonProps) {
  return (
    <div
      data-testid="skeleton"
      className={cn(
        'bg-muted',
        animation === 'pulse' && 'animate-pulse',
        animation === 'wave' && 'skeleton-wave',
        variant === 'default' && 'rounded-md',
        variant === 'circular' && 'rounded-full',
        variant === 'rectangular' && 'rounded-none',
        className,
      )}
      style={{
        width: typeof width === 'number' ? `${width}px` : width,
        height: typeof height === 'number' ? `${height}px` : height,
        ...style,
      }}
      {...props}
    />
  );
}

// Preset skeleton components for common use cases
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} height={16} width={i === lines - 1 ? '70%' : '100%'} />
      ))}
    </div>
  );
}

export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div data-testid="skeleton-card" className={cn('rounded-lg border bg-card p-4 space-y-3', className)}>
      <div className="flex items-center gap-3">
        <Skeleton variant="circular" width={40} height={40} />
        <div className="flex-1 space-y-2">
          <Skeleton height={16} width="60%" />
          <Skeleton height={12} width="40%" />
        </div>
      </div>
      <SkeletonText lines={2} />
    </div>
  );
}

export function SkeletonList({ count = 5, variant = 'card', className }: { count?: number; variant?: 'card' | 'row'; className?: string }) {
  if (variant === 'row') {
    return (
      <div className={cn('space-y-2', className)}>
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 p-2">
            <Skeleton variant="circular" width={32} height={32} />
            <div className="flex-1 space-y-1">
              <Skeleton height={14} width={`${60 + Math.random() * 30}%`} />
              <Skeleton height={10} width={`${40 + Math.random() * 20}%`} />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={cn('grid gap-4 sm:grid-cols-2 lg:grid-cols-3', className)}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

export function SkeletonTable({ rows = 5, columns = 4, className }: { rows?: number; columns?: number; className?: string }) {
  return (
    <div className={cn('space-y-3', className)}>
      {/* Header */}
      <div className="flex gap-4 border-b pb-2">
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} height={14} className="flex-1" />
        ))}
      </div>
      {/* Rows */}
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="flex gap-4">
          {Array.from({ length: columns }).map((_, colIndex) => (
            <Skeleton key={colIndex} height={12} className="flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

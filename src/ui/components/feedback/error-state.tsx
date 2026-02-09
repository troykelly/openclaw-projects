import * as React from 'react';
import { AlertCircle, RefreshCw, WifiOff, ServerCrash, ShieldAlert } from 'lucide-react';
import { cn } from '@/ui/lib/utils';
import { Button } from '@/ui/components/ui/button';

export type ErrorType = 'generic' | 'network' | 'server' | 'unauthorized' | 'not-found';

function getErrorIcon(type: ErrorType) {
  switch (type) {
    case 'network':
      return <WifiOff className="size-12" />;
    case 'server':
      return <ServerCrash className="size-12" />;
    case 'unauthorized':
      return <ShieldAlert className="size-12" />;
    default:
      return <AlertCircle className="size-12" />;
  }
}

function getDefaultMessage(type: ErrorType): { title: string; description: string } {
  switch (type) {
    case 'network':
      return {
        title: 'Connection problem',
        description: "We couldn't reach the server. Check your internet connection and try again.",
      };
    case 'server':
      return {
        title: 'Server error',
        description: 'Something went wrong on our end. Our team has been notified.',
      };
    case 'unauthorized':
      return {
        title: 'Access denied',
        description: "You don't have permission to view this content. Please sign in or contact support.",
      };
    case 'not-found':
      return {
        title: 'Not found',
        description: "The item you're looking for doesn't exist or has been removed.",
      };
    default:
      return {
        title: 'Something went wrong',
        description: 'An unexpected error occurred. Please try again.',
      };
  }
}

export interface ErrorStateProps {
  type?: ErrorType;
  title?: string;
  description?: string;
  onRetry?: () => void;
  retryLabel?: string;
  isRetrying?: boolean;
  action?: React.ReactNode;
  className?: string;
}

export function ErrorState({
  type = 'generic',
  title,
  description,
  onRetry,
  retryLabel = 'Try again',
  isRetrying = false,
  action,
  className,
}: ErrorStateProps) {
  const defaults = getDefaultMessage(type);

  return (
    <div data-testid="error-state" role="alert" className={cn('flex flex-col items-center justify-center py-12 text-center', className)}>
      <div className="text-muted-foreground/50">{getErrorIcon(type)}</div>

      <h3 className="mt-4 text-lg font-semibold">{title ?? defaults.title}</h3>

      <p className="mt-2 max-w-sm text-sm text-muted-foreground">{description ?? defaults.description}</p>

      {(onRetry || action) && (
        <div className="mt-6 flex gap-3">
          {onRetry && (
            <Button onClick={onRetry} disabled={isRetrying}>
              <RefreshCw className={cn('mr-2 size-4', isRetrying && 'animate-spin')} />
              {retryLabel}
            </Button>
          )}
          {action}
        </div>
      )}
    </div>
  );
}

// Inline error for form fields and small areas
export interface InlineErrorProps {
  message: string;
  className?: string;
}

export function InlineError({ message, className }: InlineErrorProps) {
  return (
    <p data-testid="inline-error" role="alert" className={cn('text-sm text-destructive flex items-center gap-1', className)}>
      <AlertCircle className="size-3" />
      {message}
    </p>
  );
}

// Banner error for page-level alerts
export interface ErrorBannerProps {
  message: string;
  onDismiss?: () => void;
  onRetry?: () => void;
  className?: string;
}

export function ErrorBanner({ message, onDismiss, onRetry, className }: ErrorBannerProps) {
  return (
    <div data-testid="error-banner" role="alert" className={cn('flex items-center gap-3 rounded-lg bg-destructive/10 p-3 text-destructive', className)}>
      <AlertCircle className="size-5 shrink-0" />
      <p className="flex-1 text-sm">{message}</p>
      {onRetry && (
        <Button variant="ghost" size="sm" onClick={onRetry}>
          Retry
        </Button>
      )}
      {onDismiss && (
        <Button variant="ghost" size="sm" onClick={onDismiss}>
          Dismiss
        </Button>
      )}
    </div>
  );
}

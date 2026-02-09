/**
 * React Error Boundary component for graceful error handling.
 * Part of Epic #338, Issue #664.
 *
 * Catches JavaScript errors anywhere in the child component tree,
 * logs those errors, and displays a fallback UI.
 */

import { Component, type ReactNode, type ErrorInfo } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/ui/components/ui/button';
import { Card, CardContent } from '@/ui/components/ui/card';

interface ErrorBoundaryProps {
  /** Child components to render */
  children: ReactNode;
  /** Optional fallback component to render on error */
  fallback?: ReactNode;
  /** Callback when an error is caught */
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  /** Optional title for the error state */
  title?: string;
  /** Optional description for the error state */
  description?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Error Boundary component that catches errors in child components.
 * Required to be a class component per React documentation.
 *
 * @example
 * ```tsx
 * <ErrorBoundary
 *   title="Something went wrong"
 *   description="Please try refreshing the page."
 *   onError={(error) => logError(error)}
 * >
 *   <SomeComponent />
 * </ErrorBoundary>
 * ```
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    // Update state so the next render shows the fallback UI
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Log in development only to avoid information leakage in production (#693)
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.error('[ErrorBoundary] Error caught:', error, errorInfo);
    }

    // Call optional error callback
    this.props.onError?.(error, errorInfo);
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    const { hasError, error } = this.state;
    const { children, fallback, title, description } = this.props;

    if (hasError) {
      // Use custom fallback if provided
      if (fallback) {
        return fallback;
      }

      // Default error UI
      return (
        <div className="flex h-full min-h-[200px] items-center justify-center p-6" data-testid="error-boundary-fallback">
          <Card className="max-w-md">
            <CardContent className="p-6">
              <div className="flex flex-col items-center text-center">
                <div className="mb-4 rounded-full bg-destructive/10 p-3">
                  <AlertCircle className="size-6 text-destructive" aria-hidden="true" />
                </div>
                <h2 className="mb-2 text-lg font-semibold">{title ?? 'Something went wrong'}</h2>
                <p className="mb-4 text-sm text-muted-foreground">{description ?? 'An unexpected error occurred. Please try refreshing the page.'}</p>
                {import.meta.env.DEV && error && (
                  <details className="mb-4 w-full text-left">
                    <summary className="cursor-pointer text-xs text-muted-foreground">Error details</summary>
                    <pre className="mt-2 max-h-32 overflow-auto rounded bg-muted p-2 text-xs">
                      {error.message}
                      {'\n'}
                      {error.stack}
                    </pre>
                  </details>
                )}
                <div className="flex gap-2">
                  <Button variant="outline" onClick={this.handleReset} aria-label="Try again">
                    <RefreshCw className="mr-2 size-4" aria-hidden="true" />
                    Try Again
                  </Button>
                  <Button variant="default" onClick={() => window.location.reload()} aria-label="Refresh page">
                    Refresh Page
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      );
    }

    return children;
  }
}

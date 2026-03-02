/**
 * React Error Boundary component for graceful error handling.
 * Part of Epic #338, Issue #664. Extended with Sentry in Issue #2002.
 *
 * Catches JavaScript errors anywhere in the child component tree,
 * logs those errors, reports to Sentry when initialized, and displays
 * a fallback UI with optional user feedback reporting.
 */

import { Component, type ReactNode, type ErrorInfo } from 'react';
import * as Sentry from '@sentry/react';
import { AlertCircle, RefreshCw, MessageSquare, Send, X } from 'lucide-react';
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
  showFeedbackModal: boolean;
  feedbackText: string;
  feedbackSubmitted: boolean;
}

/**
 * Error Boundary component that catches errors in child components.
 * Required to be a class component per React documentation.
 *
 * When Sentry is initialized, captured errors are reported to Sentry
 * with React component stack context. A "Report Issue" button allows
 * users to submit additional feedback.
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
    this.state = {
      hasError: false,
      error: null,
      showFeedbackModal: false,
      feedbackText: '',
      feedbackSubmitted: false,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    // Update state so the next render shows the fallback UI
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Log in development only to avoid information leakage in production (#693)
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.error('[ErrorBoundary] Error caught:', error, errorInfo);
    }

    // Report to Sentry when initialized (#2002)
    if (Sentry.isInitialized()) {
      Sentry.captureException(error, {
        contexts: {
          react: {
            componentStack: errorInfo.componentStack ?? undefined,
          },
        },
      });
    }

    // Call optional error callback
    this.props.onError?.(error, errorInfo);
  }

  handleReset = (): void => {
    this.setState({
      hasError: false,
      error: null,
      showFeedbackModal: false,
      feedbackText: '',
      feedbackSubmitted: false,
    });
  };

  handleOpenFeedback = (): void => {
    this.setState({ showFeedbackModal: true });
  };

  handleCloseFeedback = (): void => {
    this.setState({ showFeedbackModal: false });
  };

  handleFeedbackChange = (event: React.ChangeEvent<HTMLTextAreaElement>): void => {
    this.setState({ feedbackText: event.target.value });
  };

  handleSubmitFeedback = (): void => {
    const { feedbackText, error } = this.state;
    if (!feedbackText.trim()) return;

    Sentry.captureMessage('User Feedback', {
      level: 'info',
      contexts: {
        feedback: {
          message: feedbackText,
          errorMessage: error?.message,
        },
      },
    });

    this.setState({ feedbackSubmitted: true, showFeedbackModal: false });
  };

  render(): ReactNode {
    const { hasError, error, showFeedbackModal, feedbackText, feedbackSubmitted } = this.state;
    const { children, fallback, title, description } = this.props;

    if (hasError) {
      // Use custom fallback if provided
      if (fallback) {
        return fallback;
      }

      const sentryActive = Sentry.isInitialized();

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
                {feedbackSubmitted && (
                  <p className="mb-4 text-sm text-green-600">Thank you for your report.</p>
                )}
                <div className="flex gap-2">
                  <Button variant="outline" onClick={this.handleReset} aria-label="Try again">
                    <RefreshCw className="mr-2 size-4" aria-hidden="true" />
                    Try Again
                  </Button>
                  <Button variant="default" onClick={() => window.location.reload()} aria-label="Refresh page">
                    Refresh Page
                  </Button>
                  {sentryActive && !feedbackSubmitted && (
                    <Button variant="outline" onClick={this.handleOpenFeedback} aria-label="Report issue">
                      <MessageSquare className="mr-2 size-4" aria-hidden="true" />
                      Report Issue
                    </Button>
                  )}
                </div>

                {/* Feedback modal */}
                {showFeedbackModal && (
                  <div className="mt-4 w-full rounded border bg-card p-4 text-left">
                    <div className="mb-2 flex items-center justify-between">
                      <h3 className="text-sm font-medium">Report this issue</h3>
                      <Button variant="ghost" size="icon" onClick={this.handleCloseFeedback} aria-label="Close feedback">
                        <X className="size-4" aria-hidden="true" />
                      </Button>
                    </div>
                    <textarea
                      className="mb-2 w-full rounded border bg-background p-2 text-sm"
                      rows={3}
                      placeholder="Describe what you were doing when this error occurred..."
                      value={feedbackText}
                      onChange={this.handleFeedbackChange}
                    />
                    <Button
                      variant="default"
                      size="sm"
                      onClick={this.handleSubmitFeedback}
                      disabled={!feedbackText.trim()}
                    >
                      <Send className="mr-2 size-3" aria-hidden="true" />
                      Submit Report
                    </Button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      );
    }

    return children;
  }
}

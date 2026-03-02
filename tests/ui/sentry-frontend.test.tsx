/**
 * @vitest-environment jsdom
 *
 * Tests for frontend Sentry instrumentation (Issue #2002).
 * Verifies:
 * - Sentry init is called when VITE_SENTRY_DSN is set
 * - Sentry init is NOT called when VITE_SENTRY_DSN is unset
 * - ErrorBoundary calls Sentry.captureException on error
 * - ErrorBoundary feedback modal renders when Sentry is active
 * - ErrorBoundary preserves existing behavior
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Mock @sentry/react at the top level
vi.mock('@sentry/react', () => {
  const mockInit = vi.fn();
  const mockCaptureException = vi.fn();
  const mockCaptureMessage = vi.fn();
  const mockBrowserTracingIntegration = vi.fn(() => ({ name: 'BrowserTracing' }));
  const mockIsInitialized = vi.fn(() => false);
  return {
    init: mockInit,
    captureException: mockCaptureException,
    captureMessage: mockCaptureMessage,
    browserTracingIntegration: mockBrowserTracingIntegration,
    isInitialized: mockIsInitialized,
  };
});

import * as Sentry from '@sentry/react';
import { initSentry } from '@/ui/lib/sentry';
import { ErrorBoundary } from '@/ui/components/error-boundary';

/** Component that throws an error on render for testing ErrorBoundary */
function ThrowingComponent({ message }: { message: string }): React.ReactNode {
  throw new Error(message);
}

describe('Sentry frontend initialization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('initSentry calls Sentry.init when DSN is provided', () => {
    initSentry({
      dsn: 'https://examplePublicKey@o0.ingest.sentry.io/0',
      environment: 'test',
      release: '1.0.0',
      tracesSampleRate: 0.5,
    });
    expect(Sentry.init).toHaveBeenCalledTimes(1);
    const callArgs = vi.mocked(Sentry.init).mock.calls[0]?.[0];
    expect(callArgs).toBeDefined();
    expect(callArgs!.dsn).toBe('https://examplePublicKey@o0.ingest.sentry.io/0');
    expect(callArgs!.environment).toBe('test');
    expect(callArgs!.release).toBe('1.0.0');
    expect(callArgs!.tracesSampleRate).toBe(0.5);
    // Verify browserTracingIntegration is included
    expect(Sentry.browserTracingIntegration).toHaveBeenCalled();
  });

  it('initSentry does NOT call Sentry.init when DSN is empty', () => {
    initSentry({ dsn: '' });
    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it('initSentry does NOT call Sentry.init when DSN is undefined', () => {
    initSentry({ dsn: undefined });
    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it('initSentry uses correct defaults', () => {
    initSentry({
      dsn: 'https://examplePublicKey@o0.ingest.sentry.io/0',
    });
    const callArgs = vi.mocked(Sentry.init).mock.calls[0]?.[0];
    expect(callArgs).toBeDefined();
    expect(callArgs!.environment).toBe('development');
    expect(callArgs!.tracesSampleRate).toBe(0.1);
  });
});

describe('ErrorBoundary with Sentry integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends error to Sentry via captureException when Sentry is initialized', () => {
    vi.mocked(Sentry.isInitialized).mockReturnValue(true);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <ThrowingComponent message="test sentry error" />
      </ErrorBoundary>,
    );

    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    const [capturedError, capturedHint] = vi.mocked(Sentry.captureException).mock.calls[0]!;
    expect(capturedError).toBeInstanceOf(Error);
    expect((capturedError as Error).message).toBe('test sentry error');
    // Verify component stack is passed in contexts
    expect(capturedHint).toHaveProperty('contexts');

    consoleSpy.mockRestore();
  });

  it('does NOT call captureException when Sentry is not initialized', () => {
    vi.mocked(Sentry.isInitialized).mockReturnValue(false);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <ThrowingComponent message="no sentry error" />
      </ErrorBoundary>,
    );

    expect(Sentry.captureException).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('preserves existing fallback UI behavior', () => {
    vi.mocked(Sentry.isInitialized).mockReturnValue(false);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary title="Custom Error" description="Custom description">
        <ThrowingComponent message="fallback test" />
      </ErrorBoundary>,
    );

    expect(screen.getByTestId('error-boundary-fallback')).toBeInTheDocument();
    expect(screen.getByText('Custom Error')).toBeInTheDocument();
    expect(screen.getByText('Custom description')).toBeInTheDocument();
    expect(screen.getByText('Try Again')).toBeInTheDocument();
    expect(screen.getByText('Refresh Page')).toBeInTheDocument();

    consoleSpy.mockRestore();
  });

  it('shows "Report Issue" button when Sentry is initialized', () => {
    vi.mocked(Sentry.isInitialized).mockReturnValue(true);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <ThrowingComponent message="feedback test" />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Report Issue')).toBeInTheDocument();

    consoleSpy.mockRestore();
  });

  it('does NOT show "Report Issue" button when Sentry is not initialized', () => {
    vi.mocked(Sentry.isInitialized).mockReturnValue(false);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <ThrowingComponent message="no feedback test" />
      </ErrorBoundary>,
    );

    expect(screen.queryByText('Report Issue')).not.toBeInTheDocument();

    consoleSpy.mockRestore();
  });

  it('opens feedback modal when "Report Issue" is clicked', () => {
    vi.mocked(Sentry.isInitialized).mockReturnValue(true);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <ThrowingComponent message="modal test" />
      </ErrorBoundary>,
    );

    fireEvent.click(screen.getByText('Report Issue'));

    // Modal should show textarea and submit button
    expect(screen.getByPlaceholderText(/describe what you were doing/i)).toBeInTheDocument();
    expect(screen.getByText('Submit Report')).toBeInTheDocument();

    consoleSpy.mockRestore();
  });

  it('submits feedback via Sentry.captureMessage', () => {
    vi.mocked(Sentry.isInitialized).mockReturnValue(true);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <ThrowingComponent message="submit feedback test" />
      </ErrorBoundary>,
    );

    fireEvent.click(screen.getByText('Report Issue'));

    const textarea = screen.getByPlaceholderText(/describe what you were doing/i);
    fireEvent.change(textarea, { target: { value: 'I was clicking the save button' } });
    fireEvent.click(screen.getByText('Submit Report'));

    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      'User Feedback',
      expect.objectContaining({
        contexts: expect.objectContaining({
          feedback: expect.objectContaining({
            message: 'I was clicking the save button',
          }),
        }),
      }),
    );

    consoleSpy.mockRestore();
  });

  it('uses custom fallback if provided', () => {
    vi.mocked(Sentry.isInitialized).mockReturnValue(true);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary fallback={<div data-testid="custom-fallback">Custom fallback</div>}>
        <ThrowingComponent message="custom fallback test" />
      </ErrorBoundary>,
    );

    expect(screen.getByTestId('custom-fallback')).toBeInTheDocument();
    // Sentry should still capture the error
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);

    consoleSpy.mockRestore();
  });

  it('calls onError callback when provided', () => {
    vi.mocked(Sentry.isInitialized).mockReturnValue(false);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onError = vi.fn();

    render(
      <ErrorBoundary onError={onError}>
        <ThrowingComponent message="callback test" />
      </ErrorBoundary>,
    );

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'callback test' }),
      expect.objectContaining({ componentStack: expect.any(String) }),
    );

    consoleSpy.mockRestore();
  });
});

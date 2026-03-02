/**
 * Frontend Sentry initialization module.
 * Issue #2002 — Instrument frontend with Sentry React SDK.
 *
 * Initializes @sentry/react with browser tracing when a DSN is provided.
 * Completely no-op when DSN is unset, ensuring zero impact on builds
 * without Sentry configured.
 *
 * GlitchTip compatibility: replayIntegration and feedbackIntegration
 * are explicitly excluded (not supported by GlitchTip).
 */
import * as Sentry from '@sentry/react';

interface SentryInitOptions {
  /** Sentry/GlitchTip DSN. No-op when empty or undefined. */
  dsn: string | undefined;
  /** Environment tag (default: 'development'). */
  environment?: string;
  /** Release version for source map matching. */
  release?: string;
  /** Fraction of transactions to trace (0.0-1.0, default: 0.1). */
  tracesSampleRate?: number;
}

/**
 * Initialize Sentry for the frontend application.
 * Safe to call unconditionally — returns immediately when DSN is falsy.
 */
export function initSentry(options: SentryInitOptions): void {
  if (!options.dsn?.trim()) return;

  Sentry.init({
    dsn: options.dsn,
    environment: options.environment ?? 'development',
    release: options.release,
    tracesSampleRate: options.tracesSampleRate ?? 0.1,
    integrations: [
      Sentry.browserTracingIntegration(),
    ],
  });
}

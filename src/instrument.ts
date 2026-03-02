/**
 * Sentry SDK preload module for ESM applications (#1999).
 *
 * This module is loaded via Node's `--import` flag BEFORE any application code,
 * enabling OpenTelemetry auto-instrumentation of pg, fastify, undici, etc.
 *
 * Usage in Dockerfile CMD:
 *   node --import ./src/instrument.ts src/api/run.ts
 *
 * Requires SENTRY_DSN to be set — otherwise this module is a no-op.
 *
 * Epic #1998 — GlitchTip/Sentry Error Tracking Integration
 */

import * as Sentry from '@sentry/node';
import type { Event, ErrorEvent } from '@sentry/node';
import { createRequire } from 'node:module';

/** Sentry TransactionEvent — imported from core types. */
interface TransactionEvent extends Event {
  type: 'transaction';
}

/** Sensitive header names to strip (matched case-insensitively). */
const SENSITIVE_HEADERS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
]);

/** Query parameter names that indicate sensitive values. */
const SENSITIVE_QUERY_PARAMS = new Set([
  'token',
  'key',
  'secret',
  'code',
]);

/** Request body field names to strip. */
const SENSITIVE_BODY_FIELDS = new Set([
  'password',
  'token',
  'secret',
  'refresh_token',
]);

/** Breadcrumb categories that contain message bodies to redact. */
const MESSAGE_CATEGORIES = new Set([
  'email',
  'sms',
  'message',
]);

const FILTERED = '[Filtered]';

/** Guard against double-initialization. */
let initialized = false;

/**
 * Parse a float from an env var, returning the fallback on NaN or out-of-range.
 */
function parseSampleRate(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = parseFloat(value);
  if (Number.isNaN(parsed) || parsed < 0 || parsed > 1) return fallback;
  return parsed;
}

/**
 * Read the version from package.json at startup.
 * Uses createRequire for CJS-style synchronous resolution in ESM context.
 */
function getPackageVersion(): string | undefined {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require('../package.json') as { version?: string };
    return pkg.version;
  } catch {
    return undefined;
  }
}

/**
 * Scrub PII from a Sentry event's request data.
 *
 * Strips:
 * - Authorization, Cookie, Set-Cookie header values
 * - Query parameters containing token, key, secret, code
 * - Request body fields named password, token, secret, refresh_token
 */
export function scrubPii<T extends Event>(event: T | null): T | null {
  if (!event) return null;
  if (!event.request) return event;

  const request = { ...event.request };

  // Scrub headers
  if (request.headers) {
    const headers = { ...request.headers };
    for (const key of Object.keys(headers)) {
      if (SENSITIVE_HEADERS.has(key.toLowerCase())) {
        headers[key] = FILTERED;
      }
    }
    request.headers = headers;
  }

  // Scrub query string parameters whose names contain sensitive words
  if (typeof request.query_string === 'string' && request.query_string) {
    const parts = request.query_string.split('&');
    const scrubbed = parts.map((part) => {
      const eqIdx = part.indexOf('=');
      if (eqIdx === -1) return part;
      const key = part.substring(0, eqIdx).toLowerCase();
      for (const sensitive of SENSITIVE_QUERY_PARAMS) {
        if (key.includes(sensitive)) {
          return `${part.substring(0, eqIdx)}=${FILTERED}`;
        }
      }
      return part;
    });
    request.query_string = scrubbed.join('&');
  }

  // Scrub request body fields
  if (request.data && typeof request.data === 'object') {
    const data = { ...(request.data as Record<string, unknown>) };
    for (const key of Object.keys(data)) {
      if (SENSITIVE_BODY_FIELDS.has(key.toLowerCase())) {
        data[key] = FILTERED;
      }
    }
    request.data = data;
  }

  return { ...event, request } as T;
}

/**
 * Scrub email/SMS message bodies from breadcrumbs.
 *
 * Redacts the `message` and `data.body` fields for breadcrumbs with
 * categories: email, sms, message.
 */
export function scrubBreadcrumbs<T extends Event>(event: T | null): T | null {
  if (!event) return null;
  if (!event.breadcrumbs || event.breadcrumbs.length === 0) return event;

  const breadcrumbs = event.breadcrumbs.map((crumb) => {
    if (!crumb.category || !MESSAGE_CATEGORIES.has(crumb.category)) {
      return crumb;
    }

    const scrubbed = { ...crumb };
    if (scrubbed.message) {
      scrubbed.message = FILTERED;
    }
    if (scrubbed.data) {
      const data = { ...scrubbed.data };
      if (data.body) {
        data.body = FILTERED;
      }
      scrubbed.data = data;
    }
    return scrubbed;
  });

  return { ...event, breadcrumbs } as T;
}

/**
 * Combined PII scrubbing: request data + breadcrumbs.
 * Used as both `beforeSend` and `beforeSendTransaction` hooks.
 */
function scrubEvent<T extends Event>(event: T): T | null {
  let result: T | null = event;
  result = scrubPii(result);
  result = scrubBreadcrumbs(result);
  return result;
}

/**
 * Initialize Sentry if SENTRY_DSN is set.
 * No-op otherwise — safe to call unconditionally.
 *
 * Exported for testability; the module also calls this at import time
 * when used via --import.
 */
export function initSentry(): void {
  if (initialized) return;

  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  initialized = true;

  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || 'development',
    release: process.env.SENTRY_RELEASE || getPackageVersion(),
    tracesSampleRate: parseSampleRate(
      process.env.SENTRY_TRACES_SAMPLE_RATE,
      0.1,
    ),
    sampleRate: parseSampleRate(process.env.SENTRY_SAMPLE_RATE, 1.0),
    debug: process.env.SENTRY_DEBUG === 'true',
    serverName: process.env.SENTRY_SERVER_NAME,
    sendDefaultPii: false,
    beforeSend(event) {
      return scrubEvent(event);
    },
    beforeSendTransaction(event) {
      return scrubEvent(event);
    },
  });
}

/**
 * Reset initialization state — for testing only.
 * @internal
 */
export function _resetForTesting(): void {
  initialized = false;
}

/**
 * Gracefully close the Sentry client, flushing pending events.
 * Call from shutdown handlers before process.exit().
 */
export async function closeSentry(): Promise<boolean> {
  return Sentry.close(5000);
}

// Auto-initialize when loaded as a preload module via --import
initSentry();

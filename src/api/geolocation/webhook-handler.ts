/**
 * Webhook handler logic for geolocation webhook provider.
 * Handles authentication, validation, and payload parsing.
 * Route registration happens in server.ts (Issue #1249).
 * Issue #1248.
 */

import {
  timingSafeTokenCompare,
  parseWebhookPayload,
} from './providers/webhook-provider.ts';
import type { LocationUpdate } from './types.ts';

// ---------- constants ----------

/** Maximum allowed payload size in bytes (10KB). */
export const MAX_PAYLOAD_SIZE = 10 * 1024;

/** Required content type for webhook requests. */
const REQUIRED_CONTENT_TYPE = 'application/json';

// ---------- result types ----------

export interface WebhookSuccess {
  ok: true;
  update: LocationUpdate;
}

export interface WebhookError {
  ok: false;
  status: number;
  message: string;
}

export type WebhookResult = WebhookSuccess | WebhookError;

// ---------- auth ----------

/**
 * Extract Bearer token from Authorization header.
 * Returns null if the header is missing, empty, or not a Bearer token.
 */
export function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') return null;
  const token = parts[1];
  if (!token || token.length === 0) return null;
  return token;
}

// ---------- handler ----------

export interface WebhookHandlerOptions {
  /** The expected token (plaintext) to compare against. */
  expectedToken: string;
  /** The Authorization header value from the request. */
  authHeader: string | undefined;
  /** The Content-Type header value from the request. */
  contentType: string | undefined;
  /** The raw body as a string. */
  body: string;
}

/**
 * Process an incoming webhook request.
 *
 * This function handles:
 * 1. Bearer token authentication (timing-safe comparison)
 * 2. Content-Type validation (must be application/json)
 * 3. Payload size validation (max 10KB)
 * 4. JSON parsing
 * 5. Location payload parsing (standard + OwnTracks auto-detection)
 *
 * Returns `{ ok: true }` response shape only — no internal state is leaked.
 */
export function handleWebhookRequest(options: WebhookHandlerOptions): WebhookResult {
  const { expectedToken, authHeader, contentType, body } = options;

  // 1. Authenticate — extract and compare Bearer token
  const providedToken = extractBearerToken(authHeader);
  if (!providedToken) {
    return { ok: false, status: 401, message: 'Missing or invalid Authorization header' };
  }

  if (!timingSafeTokenCompare(providedToken, expectedToken)) {
    return { ok: false, status: 401, message: 'Invalid token' };
  }

  // 2. Validate Content-Type
  const ct = contentType?.toLowerCase().split(';')[0]?.trim();
  if (ct !== REQUIRED_CONTENT_TYPE) {
    return { ok: false, status: 415, message: 'Content-Type must be application/json' };
  }

  // 3. Validate payload size
  const bodySize = Buffer.byteLength(body, 'utf8');
  if (bodySize > MAX_PAYLOAD_SIZE) {
    return {
      ok: false,
      status: 413,
      message: 'Payload too large',
    };
  }

  // 4. Parse JSON
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return { ok: false, status: 400, message: 'Invalid JSON payload' };
  }

  // 5. Parse location update (auto-detects OwnTracks vs standard format)
  const update = parseWebhookPayload(payload);
  if (!update) {
    return { ok: false, status: 422, message: 'Payload does not contain valid location data' };
  }

  return { ok: true, update };
}

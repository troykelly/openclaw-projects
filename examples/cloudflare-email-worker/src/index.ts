/**
 * Cloudflare Email Worker — Inbound Email Forwarder for openclaw-projects
 *
 * This Worker receives inbound emails via Cloudflare Email Routing and
 * forwards the parsed content to the openclaw-projects webhook endpoint
 * at POST /api/cloudflare/email.
 *
 * Architecture:
 *   Inbound email → Cloudflare Email Routing → This Worker → openclaw-projects API
 *
 * The Worker:
 *   1. Receives the raw MIME email via the email() handler
 *   2. Parses MIME using postal-mime (zero-dependency, RFC 5322 compliant)
 *   3. Extracts headers, body (plain + HTML), and envelope addresses
 *   4. Constructs a CloudflareEmailPayload matching the API contract
 *   5. Authenticates via X-Cloudflare-Email-Secret header (shared secret)
 *   6. POSTs to the webhook endpoint with retry on transient failures
 *   7. Optionally forwards original email to a fallback address
 *
 * Security:
 *   - Shared secret authenticates the Worker to the API (timing-safe comparison on server)
 *   - Timestamp field enables replay protection (server rejects payloads >5 min old)
 *   - Size limits prevent abuse (configurable MAX_RAW_BYTES)
 *   - No secrets are logged; only structured metadata for observability
 *
 * Setup:
 *   See wrangler.jsonc for configuration and the README for deployment.
 *
 * @see https://developers.cloudflare.com/email-routing/email-workers/
 * @see https://developers.cloudflare.com/email-routing/email-workers/runtime-api/
 * @see https://github.com/postalsys/postal-mime
 */

import PostalMime from "postal-mime";
import type { Email } from "postal-mime";

// ---------------------------------------------------------------------------
// Environment bindings (from wrangler.toml [vars] and secrets)
// ---------------------------------------------------------------------------

interface Env {
  /** Shared secret for authenticating with the openclaw-projects API. */
  CLOUDFLARE_EMAIL_SECRET: string;

  /**
   * Base URL of the openclaw-projects API.
   * Examples:
   *   - https://projects.example.com/api
   *   - https://api.openclaw.example.com
   */
  OPENCLAW_PROJECTS_API_URL: string;

  /**
   * Optional fallback address to forward the original email to.
   * Must be a verified Email Routing destination address.
   * If unset, emails are only delivered to the API (no SMTP forward).
   */
  FALLBACK_FORWARD_ADDRESS?: string;

  /**
   * Maximum raw email size in bytes. Emails exceeding this are rejected.
   * Default: 25 MiB (26_214_400). Cloudflare's own limit is 25 MiB.
   */
  MAX_RAW_BYTES?: string;

  /**
   * Whether to include the full raw MIME in the webhook payload.
   * Set to "true" to enable. Default: "false".
   * Useful for debugging but increases payload size significantly.
   */
  INCLUDE_RAW_MIME?: string;
}

// ---------------------------------------------------------------------------
// Webhook payload — matches CloudflareEmailPayload in openclaw-projects
// src/api/cloudflare-email/types.ts
// ---------------------------------------------------------------------------

export interface CloudflareEmailPayload {
  from: string;
  to: string;
  subject: string;
  text_body?: string;
  html_body?: string;
  headers: Record<string, string | undefined>;
  raw?: string;
  timestamp: string;
}

interface WebhookSuccessResponse {
  receipt_id?: string;
  contact_id: string;
  thread_id: string;
  message_id: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DEFAULT_MAX_RAW_BYTES = 26_214_400; // 25 MiB
export const WEBHOOK_PATH = "/cloudflare/email";
export const MAX_RETRIES = 2;
export const RETRY_DELAYS_MS = [500, 1500] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Collect a ReadableStream into a single Uint8Array.
 */
export async function streamToUint8Array(
  stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let totalLength = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    totalLength += value.byteLength;
  }

  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

/**
 * Extract threading-related headers into a flat record.
 * Only includes headers that are present; omits undefined values.
 */
export function extractHeaders(parsed: Email): Record<string, string | undefined> {
  const record: Record<string, string | undefined> = {};

  // Priority headers for email threading
  const threadingHeaders = [
    "message-id",
    "in-reply-to",
    "references",
    "date",
    "list-id",
    "list-unsubscribe",
  ];

  for (const header of parsed.headers) {
    const key = header.key.toLowerCase();
    if (threadingHeaders.includes(key)) {
      record[key] = header.value;
    }
  }

  // Ensure message-id from parsed top-level field (postal-mime normalises it)
  if (parsed.messageId && !record["message-id"]) {
    record["message-id"] = parsed.messageId;
  }
  if (parsed.inReplyTo && !record["in-reply-to"]) {
    record["in-reply-to"] = parsed.inReplyTo;
  }
  if (parsed.references && !record["references"]) {
    record["references"] = parsed.references;
  }

  return record;
}

/**
 * Build the webhook payload from the parsed email and envelope addresses.
 */
export function buildPayload(
  envelopeFrom: string,
  envelopeTo: string,
  parsed: Email,
  rawMime: string | undefined,
): CloudflareEmailPayload {
  // Use the parsed From header address if available, fall back to envelope
  const fromAddress =
    parsed.from?.address ?? envelopeFrom;

  return {
    from: fromAddress,
    to: envelopeTo,
    subject: parsed.subject ?? "(no subject)",
    text_body: parsed.text ?? undefined,
    html_body: parsed.html ?? undefined,
    headers: extractHeaders(parsed),
    raw: rawMime,
    timestamp: new Date().toISOString(),
  };
}

/**
 * POST the payload to the openclaw-projects webhook with retry.
 *
 * Retries only on network errors and 5xx responses. 4xx responses indicate
 * a client error (bad payload, auth failure) and are not retried.
 */
export async function postWebhook(
  url: string,
  secret: string,
  payload: CloudflareEmailPayload,
): Promise<Response> {
  let lastError: Error | undefined;
  const maxAttempts = 1 + MAX_RETRIES;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      const delay = RETRY_DELAYS_MS[attempt - 1] ?? 1500;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Cloudflare-Email-Secret": secret,
        },
        body: JSON.stringify(payload),
      });

      // 2xx — success
      if (response.ok) {
        return response;
      }

      // 4xx — client error, do not retry (auth failure, bad payload, etc.)
      if (response.status >= 400 && response.status < 500) {
        const body = await response.text().catch(() => "");
        throw new Error(
          `Webhook returned ${response.status}: ${body.slice(0, 500)}`,
        );
      }

      // 5xx — server error, retry
      lastError = new Error(`Webhook returned ${response.status}`);
      console.warn(
        `[email-worker] Attempt ${attempt + 1}/${maxAttempts} failed: ${response.status}`,
      );
    } catch (err) {
      if (
        err instanceof Error &&
        err.message.startsWith("Webhook returned 4")
      ) {
        // Re-throw 4xx errors immediately — not retryable
        throw err;
      }
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(
        `[email-worker] Attempt ${attempt + 1}/${maxAttempts} error: ${lastError.message}`,
      );
    }
  }

  throw lastError ?? new Error("Webhook delivery failed after retries");
}

// ---------------------------------------------------------------------------
// Email Worker entry point
// ---------------------------------------------------------------------------

export default {
  /**
   * Cloudflare Email Workers handler.
   *
   * Invoked for every email that matches the configured Email Routing rule.
   * The email is parsed, transformed, and forwarded to the openclaw-projects
   * webhook. Failures are logged; the email is optionally forwarded to a
   * fallback address regardless of webhook success.
   */
  async email(
    message: ForwardableEmailMessage,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    const startTime = Date.now();
    const logPrefix = `[email-worker] from=${message.from} to=${message.to}`;

    // -----------------------------------------------------------------------
    // 1. Validate configuration
    // -----------------------------------------------------------------------
    if (!env.CLOUDFLARE_EMAIL_SECRET) {
      console.error(`${logPrefix} CLOUDFLARE_EMAIL_SECRET is not configured`);
      message.setReject("Internal configuration error");
      return;
    }

    if (!env.OPENCLAW_PROJECTS_API_URL) {
      console.error(`${logPrefix} OPENCLAW_PROJECTS_API_URL is not configured`);
      message.setReject("Internal configuration error");
      return;
    }

    // -----------------------------------------------------------------------
    // 2. Size guard
    // -----------------------------------------------------------------------
    const maxBytes = env.MAX_RAW_BYTES
      ? parseInt(env.MAX_RAW_BYTES, 10)
      : DEFAULT_MAX_RAW_BYTES;

    if (message.rawSize > maxBytes) {
      console.warn(
        `${logPrefix} Rejected: size ${message.rawSize} exceeds limit ${maxBytes}`,
      );
      message.setReject(
        `Message too large (${message.rawSize} bytes, limit ${maxBytes})`,
      );
      return;
    }

    // -----------------------------------------------------------------------
    // 3. Read and parse the raw MIME message
    // -----------------------------------------------------------------------
    let rawBytes: Uint8Array;
    try {
      rawBytes = await streamToUint8Array(message.raw);
    } catch (err) {
      console.error(`${logPrefix} Failed to read raw stream: ${err}`);
      message.setReject("Failed to read message");
      return;
    }

    let parsed: Email;
    try {
      parsed = await PostalMime.parse(rawBytes);
    } catch (err) {
      console.error(`${logPrefix} MIME parse failed: ${err}`);
      message.setReject("Failed to parse message");
      return;
    }

    console.log(
      `${logPrefix} subject="${parsed.subject}" size=${rawBytes.byteLength}`,
    );

    // -----------------------------------------------------------------------
    // 4. Build the webhook payload
    // -----------------------------------------------------------------------
    const includeRaw = env.INCLUDE_RAW_MIME === "true";
    const rawMime = includeRaw
      ? new TextDecoder().decode(rawBytes)
      : undefined;

    const payload = buildPayload(message.from, message.to, parsed, rawMime);

    // -----------------------------------------------------------------------
    // 5. Deliver to the openclaw-projects API
    // -----------------------------------------------------------------------
    const webhookUrl = `${env.OPENCLAW_PROJECTS_API_URL.replace(/\/+$/, "")}${WEBHOOK_PATH}`;

    try {
      const response = await postWebhook(
        webhookUrl,
        env.CLOUDFLARE_EMAIL_SECRET,
        payload,
      );

      const result: WebhookSuccessResponse = await response.json();
      const elapsed = Date.now() - startTime;

      console.log(
        `${logPrefix} Delivered in ${elapsed}ms — ` +
          `message_id=${result.message_id} thread_id=${result.thread_id} ` +
          `contact_id=${result.contact_id}`,
      );
    } catch (err) {
      const elapsed = Date.now() - startTime;
      console.error(
        `${logPrefix} Webhook delivery failed after ${elapsed}ms: ${err}`,
      );
      // Do NOT reject the email — it's already accepted by Cloudflare.
      // The fallback forward below ensures the email isn't lost.
    }

    // -----------------------------------------------------------------------
    // 6. Optional: forward original to a fallback address
    // -----------------------------------------------------------------------
    if (env.FALLBACK_FORWARD_ADDRESS) {
      ctx.waitUntil(
        message
          .forward(env.FALLBACK_FORWARD_ADDRESS)
          .then(() => {
            console.log(
              `${logPrefix} Forwarded to ${env.FALLBACK_FORWARD_ADDRESS}`,
            );
          })
          .catch((err: unknown) => {
            console.error(
              `${logPrefix} Forward failed: ${err}`,
            );
          }),
      );
    }
  },
} satisfies ExportedHandler<Env>;

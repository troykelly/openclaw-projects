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
 *   5. Authenticates via X-Cloudflare-Email-Signature HMAC-SHA256 header (preferred)
 *      and X-Cloudflare-Email-Secret header (deprecated, backward compat)
 *   6. POSTs to the webhook endpoint with retry on transient failures
 *   7. Optionally forwards original email to a fallback address
 *
 * Security:
 *   - HMAC-SHA256 signature over request body authenticates the Worker to the API
 *   - Deprecated shared-secret header kept for backward compat during migration
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

/**
 * Response from the openclaw-projects webhook.
 * Matches CloudflareEmailWebhookResponse in src/api/cloudflare-email/types.ts.
 */
interface WebhookResponse {
  success: boolean;
  /** Triage decision — "accept" or "reject". */
  action: "accept" | "reject";
  /** Reason for rejection (present when action is "reject"). */
  reject_reason?: string;
  receipt_id?: string;
  contact_id?: string;
  thread_id?: string;
  message_id?: string;
  /** Optional auto-reply for the Worker to send to the sender. */
  auto_reply?: {
    subject: string;
    text_body: string;
    html_body?: string;
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DEFAULT_MAX_RAW_BYTES = 26_214_400; // 25 MiB
export const WEBHOOK_PATH = "/cloudflare/email";
export const MAX_RETRIES = 2;
export const RETRY_DELAYS_MS = [500, 1500] as const;

// ---------------------------------------------------------------------------
// HMAC-SHA256 signing (Web Crypto API for Cloudflare Workers)
// ---------------------------------------------------------------------------

/**
 * Compute an HMAC-SHA256 hex digest over the given body using the Web Crypto API.
 * Returns "sha256=<hex>" format matching the X-Cloudflare-Email-Signature header contract.
 */
export async function computeHmacSignature(secret: string, body: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  const hex = Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `sha256=${hex}`;
}

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
      const jsonBody = JSON.stringify(payload);
      const hmacSignature = await computeHmacSignature(secret, jsonBody);

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Cloudflare-Email-Signature": hmacSignature,
          "X-Cloudflare-Email-Secret": secret, // Deprecated: kept for backward compat
        },
        body: jsonBody,
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

/**
 * Strip CR and LF characters from a header value to prevent MIME header injection.
 * A malicious subject like "Foo\r\nBcc: evil@attacker.com" would otherwise inject headers.
 */
export function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n]/g, "");
}

/**
 * Check whether an email address belongs to an automated sender.
 * Auto-replies to these addresses risk creating infinite mail loops.
 */
export function isAutomatedSender(address: string): boolean {
  const lower = address.toLowerCase();
  const automatedPrefixes = [
    "noreply@",
    "no-reply@",
    "mailer-daemon@",
    "postmaster@",
    "auto-",
    "bounce",
  ];
  return automatedPrefixes.some((prefix) => lower.startsWith(prefix));
}

/**
 * Check whether an email's headers indicate it is an automated message.
 * RFC 3834 Auto-Submitted header and Precedence header are checked.
 */
export function hasAutoSubmittedHeader(
  headers: ForwardableEmailMessage["headers"],
): boolean {
  const autoSubmitted = headers.get("Auto-Submitted");
  if (autoSubmitted && autoSubmitted.toLowerCase() !== "no") {
    return true;
  }
  const precedence = headers.get("Precedence");
  if (
    precedence &&
    ["bulk", "junk", "list", "auto_reply"].includes(precedence.toLowerCase())
  ) {
    return true;
  }
  return false;
}

/**
 * Build a minimal RFC 5322 MIME message for use with message.reply().
 *
 * The reply includes In-Reply-To and References headers for proper threading,
 * plus Auto-Submitted and Precedence headers to prevent mail loops (RFC 3834).
 *
 * All header values are sanitized to prevent MIME header injection.
 */
export function buildReplyMime(
  from: string,
  to: string,
  subject: string,
  textBody: string,
  htmlBody: string | undefined,
  inReplyToMessageId: string | undefined,
): ReadableStream<Uint8Array> {
  const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const hasHtml = htmlBody !== undefined && htmlBody !== "";
  const contentType = hasHtml
    ? `multipart/alternative; boundary="${boundary}"`
    : "text/plain; charset=utf-8";

  const lines: string[] = [
    `From: ${sanitizeHeaderValue(from)}`,
    `To: ${sanitizeHeaderValue(to)}`,
    `Subject: ${sanitizeHeaderValue(subject)}`,
    `MIME-Version: 1.0`,
    `Date: ${new Date().toUTCString()}`,
    `Auto-Submitted: auto-replied`,
    `Precedence: bulk`,
  ];

  if (inReplyToMessageId) {
    const safeMessageId = sanitizeHeaderValue(inReplyToMessageId);
    lines.push(`In-Reply-To: ${safeMessageId}`);
    lines.push(`References: ${safeMessageId}`);
  }

  lines.push(`Content-Type: ${contentType}`);
  lines.push(""); // End of headers

  if (hasHtml) {
    lines.push(`--${boundary}`);
    lines.push("Content-Type: text/plain; charset=utf-8");
    lines.push("");
    lines.push(textBody);
    lines.push(`--${boundary}`);
    lines.push("Content-Type: text/html; charset=utf-8");
    lines.push("");
    lines.push(htmlBody!);
    lines.push(`--${boundary}--`);
  } else {
    lines.push(textBody);
  }

  const raw = new TextEncoder().encode(lines.join("\r\n"));
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(raw);
      controller.close();
    },
  });
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

    let webhookResult: WebhookResponse | undefined;
    try {
      const response = await postWebhook(
        webhookUrl,
        env.CLOUDFLARE_EMAIL_SECRET,
        payload,
      );

      webhookResult = await response.json() as WebhookResponse;
      const elapsed = Date.now() - startTime;

      console.log(
        `${logPrefix} Delivered in ${elapsed}ms — ` +
          `action=${webhookResult.action} ` +
          `message_id=${webhookResult.message_id} thread_id=${webhookResult.thread_id} ` +
          `contact_id=${webhookResult.contact_id}`,
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
    // 6. Triage: reject if the API says so (#2061)
    // -----------------------------------------------------------------------
    if (webhookResult?.action === "reject") {
      const reason = webhookResult.reject_reason ?? "Rejected by server";
      console.log(`${logPrefix} Rejecting: ${reason}`);
      message.setReject(reason);
      return; // No forwarding for rejected emails
    }

    // -----------------------------------------------------------------------
    // 7. Auto-reply if the API included one (#2062)
    //    Skip for automated senders to prevent mail loops (RFC 3834, #2065)
    // -----------------------------------------------------------------------
    if (webhookResult?.auto_reply) {
      const skipAutoReply =
        isAutomatedSender(message.from) ||
        hasAutoSubmittedHeader(message.headers);

      if (skipAutoReply) {
        console.log(
          `${logPrefix} Skipping auto-reply: sender is automated`,
        );
      } else {
        try {
          const { auto_reply } = webhookResult;
          const replyMime = buildReplyMime(
            message.to,     // Reply from the receiving address
            message.from,   // Reply to the original sender
            auto_reply.subject,
            auto_reply.text_body,
            auto_reply.html_body,
            message.headers.get("Message-ID") ?? undefined,
          );
          // EmailMessage is a Workers-only runtime class from cloudflare:email
          const { EmailMessage } = await import("cloudflare:email");
          const replyMessage = new EmailMessage(message.to, message.from, replyMime);
          await message.reply(replyMessage);
          console.log(`${logPrefix} Auto-reply sent`);
        } catch (replyErr) {
          // Reply failures are non-fatal (DMARC check may fail, etc.)
          console.warn(`${logPrefix} Auto-reply failed: ${replyErr}`);
        }
      }
    }

    // -----------------------------------------------------------------------
    // 8. Optional: forward original to a fallback address
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

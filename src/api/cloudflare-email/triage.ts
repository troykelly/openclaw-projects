/**
 * Synchronous email triage via gateway WebSocket.
 * Issue #2179 — Agent-driven email triage.
 *
 * Consults an OpenClaw agent (e.g. email-triage) for a triage decision
 * (accept/reject/discard) before responding to the Cloudflare Email Worker.
 * Falls back gracefully when the gateway is unavailable or the agent errors.
 */

import type { GatewayConnectionService } from '../gateway/connection.ts';

// ── Types ────────────────────────────────────────────────────────────────

export interface TriageDecision {
  action: 'accept' | 'reject';
  reject_reason?: string;
}

export interface TriageEmailMetadata {
  from: string;
  to: string;
  subject: string;
  body: string;
  timestamp: string;
  messageId: string;
}

export interface TriageParams {
  threadId: string;
  agentId: string;
  promptContent: string | null;
  email: TriageEmailMetadata;
}

// ── Constants ────────────────────────────────────────────────────────────

const LOG_PREFIX = '[EmailTriage]';
const DEFAULT_TIMEOUT_MS = 25_000;
const DEFAULT_REJECT_REASON = 'Rejected by email triage';
const MAX_BODY_LENGTH = 2000;

// ── Response Parsing ─────────────────────────────────────────────────────

/**
 * Parse the agent's triage response text into a decision.
 *
 * | Agent Response        | Decision                                    |
 * |-----------------------|---------------------------------------------|
 * | Starts with `REJECT:` | reject with extracted reason                |
 * | Equals `NO_REPLY`     | accept (silent discard)                    |
 * | Anything else          | accept (agent escalated or processed it)  |
 */
export function parseTriageResponse(responseText: string): TriageDecision {
  // Use only the first line for parsing
  const firstLine = responseText.split('\n')[0].trim();

  if (firstLine.startsWith('REJECT:')) {
    const reason = firstLine.slice('REJECT:'.length).trim();
    return {
      action: 'reject',
      reject_reason: reason || DEFAULT_REJECT_REASON,
    };
  }

  // NO_REPLY and everything else → accept
  return { action: 'accept' };
}

// ── Prompt Building ──────────────────────────────────────────────────────

/**
 * Build a structured triage prompt from email metadata.
 *
 * When promptContent is provided (from route's prompt_template), it is
 * prepended as a custom preamble, allowing per-destination triage rules.
 */
export function buildTriagePrompt(
  email: TriageEmailMetadata,
  promptContent: string | null,
): string {
  const truncatedBody = email.body.slice(0, MAX_BODY_LENGTH);

  const emailSection = [
    'Inbound email received for triage.',
    '',
    `To: ${email.to}`,
    `From: ${email.from}`,
    `Subject: ${email.subject}`,
    `Date: ${email.timestamp}`,
    `Message-ID: ${email.messageId}`,
    '',
    'Body:',
    truncatedBody,
    '---',
    'Evaluate this email and respond with one of:',
    '- REJECT: <reason> — to bounce at SMTP level',
    '- NO_REPLY — to silently discard',
    '- Or escalate by forwarding to the appropriate agent',
  ].join('\n');

  if (promptContent) {
    return `${promptContent}\n\n${emailSection}`;
  }

  return emailSection;
}

// ── Triage Dispatch ──────────────────────────────────────────────────────

/** Resolve the triage timeout from env or default. */
function resolveTriageTimeoutMs(): number {
  const raw = process.env.OPENCLAW_EMAIL_TRIAGE_TIMEOUT_MS;
  if (!raw) return DEFAULT_TIMEOUT_MS;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

/** Check if synchronous email triage is enabled. */
function isTriageSyncEnabled(): boolean {
  const value = process.env.OPENCLAW_EMAIL_TRIAGE_SYNC;
  // Default to true when not set; only disable on explicit 'false'
  return value !== 'false';
}

/**
 * Attempt synchronous email triage via the gateway WebSocket.
 *
 * Returns a TriageDecision if the agent responds within the timeout,
 * or null if triage is disabled, the gateway is disconnected, or
 * the agent errors/times out (fail-open).
 *
 * @param params - Triage parameters (thread, agent, email metadata)
 * @param gateway - GatewayConnectionService instance (injected for testability)
 */
export async function triageEmailViaGateway(
  params: TriageParams,
  gateway: Pick<GatewayConnectionService, 'getStatus' | 'request'>,
): Promise<TriageDecision | null> {
  if (!isTriageSyncEnabled()) {
    return null;
  }

  const status = gateway.getStatus();
  if (!status.connected) {
    return null;
  }

  const timeoutMs = resolveTriageTimeoutMs();
  const sessionKey = `agent:${params.agentId}:email_triage:${params.threadId}`;
  const message = buildTriagePrompt(params.email, params.promptContent);

  try {
    const response = await gateway.request<{ message: string }>(
      'chat.send',
      {
        sessionKey,
        message,
        idempotencyKey: params.email.messageId,
        deliver: true,
      },
      { timeoutMs },
    );

    const decision = parseTriageResponse(response.message);
    console.log(
      `${LOG_PREFIX} triage decision=${decision.action} agent=${params.agentId} thread=${params.threadId}`,
    );
    return decision;
  } catch (err) {
    console.warn(
      `${LOG_PREFIX} triage failed, failing open: agent=${params.agentId} thread=${params.threadId}`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

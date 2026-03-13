/**
 * Chat message dispatch via gateway WebSocket with HTTP fallback.
 * Issue #2155 — Chat dispatch via WS.
 * Issue #2163 — Chat abort via WS.
 *
 * Primary path: dispatches user messages to agents via the gateway WebSocket
 * connection (chat.send). If the WS connection is unavailable or the request
 * fails, falls back to the existing HTTP webhook path (enqueueWebhook).
 *
 * No double-processing: The gateway uses the idempotencyKey (message UUID)
 * to deduplicate on its side. On our side, the external_message table's
 * external_message_key unique constraint prevents duplicate inserts if the
 * HTTP fallback fires after a WS dispatch already triggered an agent response.
 */

import type { Pool } from 'pg';
import { getGatewayConnection } from './index.ts';
import { enqueueWebhook } from '../webhooks/dispatcher.ts';
import { gwChatDispatchWs, gwChatDispatchHttp } from './metrics.ts';

// ── Types ──────────────────────────────────────────────────────────

/** Minimal session fields needed for dispatch. */
export interface ChatSession {
  id: string;
  agent_id: string;
  thread_id: string;
  stream_secret: string;
}

/** Minimal message fields needed for dispatch. */
export interface ChatMessageRecord {
  id: string;
  body: string;
  content_type: string;
}

export interface DispatchResult {
  /** Whether the message was dispatched (via WS or HTTP). */
  dispatched: boolean;
  /** Which method was used: 'ws', 'http', or undefined if failed. */
  method?: 'ws' | 'http';
  /** Error message if dispatch failed entirely. */
  error?: string;
}

// ── Constants ──────────────────────────────────────────────────────

const LOG_PREFIX = '[ChatDispatch]';
const DEFAULT_TIMEOUT_MS = 120_000;

// ── Helpers ────────────────────────────────────────────────────────

/** Build the deterministic sessionKey for the gateway protocol. */
function buildSessionKey(session: ChatSession): string {
  return `agent:${session.agent_id}:agent_chat:${session.thread_id}`;
}

/** Resolve timeoutMs from OPENCLAW_TIMEOUT_SECONDS env var. */
function resolveTimeoutMs(): number {
  const raw = process.env.OPENCLAW_TIMEOUT_SECONDS;
  if (!raw) return DEFAULT_TIMEOUT_MS;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed * 1000 : DEFAULT_TIMEOUT_MS;
}

/**
 * Build an absolute streaming callback URL for the given session (#2493).
 *
 * Uses PUBLIC_BASE_URL to derive the API host. In production the API lives
 * at api.{hostname}; in local dev the API is same-origin.
 */
function buildStreamCallbackUrl(sessionId: string): string {
  const publicBase = process.env.PUBLIC_BASE_URL || 'http://localhost:3000';
  let apiBase: string;
  try {
    const parsed = new URL(publicBase);
    if (parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
      parsed.hostname = `api.${parsed.hostname}`;
    }
    apiBase = parsed.toString().replace(/\/$/, '');
  } catch {
    apiBase = publicBase;
  }
  return `${apiBase}/chat/sessions/${sessionId}/stream`;
}

// ── Public API ─────────────────────────────────────────────────────

/**
 * Dispatch a chat message to the agent via the gateway WebSocket (primary)
 * or HTTP webhook (fallback).
 *
 * Never throws — catches all dispatch errors and returns a result object.
 */
export async function dispatchChatMessage(
  pool: Pool,
  session: ChatSession,
  message: ChatMessageRecord,
  userEmail: string,
): Promise<DispatchResult> {
  const gw = getGatewayConnection();
  const status = gw.getStatus();
  const sessionKey = buildSessionKey(session);

  // ── Try WS dispatch ──────────────────────────────────────────
  if (status.connected) {
    try {
      await gw.request('chat.send', {
        sessionKey,
        message: message.body,
        idempotencyKey: message.id,
        deliver: true,
        timeoutMs: resolveTimeoutMs(),
      });

      gwChatDispatchWs.inc();
      console.log(`${LOG_PREFIX} dispatched via WS session=${session.id}`);
      return { dispatched: true, method: 'ws' };
    } catch (err) {
      console.warn(
        `${LOG_PREFIX} WS dispatch failed for session=${session.id}, falling back to HTTP:`,
        err instanceof Error ? err.message : err,
      );
      // Fall through to HTTP fallback
    }
  }

  // ── HTTP webhook fallback ────────────────────────────────────
  const webhookDestination = process.env.OPENCLAW_GATEWAY_URL || process.env.WEBHOOK_DESTINATION_URL;
  if (!webhookDestination) {
    // No gateway configured at all — message is already persisted in DB.
    // This is not an error: the system can operate without a gateway
    // (e.g. in test environments or before gateway is provisioned).
    // The message is stored but not dispatched to any agent.
    console.log(`${LOG_PREFIX} no gateway configured, message stored without dispatch session=${session.id}`);
    return { dispatched: true, method: undefined };
  }

  try {
    await enqueueWebhook(pool, 'chat_message_received', webhookDestination, {
      kind: 'chat_message_received',
      session_key: sessionKey,
      payload: {
        session_id: session.id,
        message_id: message.id,
        content: message.body,
        content_type: message.content_type,
        user_email: userEmail,
        streaming_callback_url: buildStreamCallbackUrl(session.id),
        stream_secret: session.stream_secret,
      },
    });

    gwChatDispatchHttp.inc();
    console.log(`${LOG_PREFIX} dispatched via HTTP webhook session=${session.id}`);
    return { dispatched: true, method: 'http' };
  } catch (err) {
    const error = `Both WS and HTTP dispatch failed for session=${session.id}`;
    console.error(`${LOG_PREFIX} ${error}:`, err instanceof Error ? err.message : err);
    return { dispatched: false, error };
  }
}

/**
 * Abort an in-flight agent run via the gateway WebSocket.
 *
 * Fire-and-forget: does not throw on errors.
 * No-op if the WebSocket is not connected (HTTP abort is handled
 * by existing mechanisms in the stream manager).
 */
export async function abortChatRun(
  session: ChatSession,
  runId?: string,
): Promise<void> {
  const gw = getGatewayConnection();
  const status = gw.getStatus();

  if (!status.connected) {
    return;
  }

  const sessionKey = buildSessionKey(session);
  const params: Record<string, unknown> = { sessionKey };
  if (runId !== undefined) {
    params.runId = runId;
  }

  try {
    await gw.request('chat.abort', params);
    console.log(`${LOG_PREFIX} abort sent via WS session=${session.id} runId=${runId ?? 'any'}`);
  } catch (err) {
    console.warn(
      `${LOG_PREFIX} abort failed for session=${session.id}:`,
      err instanceof Error ? err.message : err,
    );
  }
}

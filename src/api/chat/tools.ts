/**
 * OpenClaw plugin tools for agent chat (#1954).
 *
 * Two tools:
 * - chat_send_message: agent sends message to user in active session
 * - chat_attract_attention: agent sends notification with urgency escalation
 *
 * These are tool definitions + execute functions.
 * They call the M2M backend endpoints defined in routes.ts.
 *
 * Epic #1940 — Agent Chat.
 */

import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { escalateNotification, type Urgency } from './notification-escalation.ts';
import { emitNotificationCreated } from '../realtime/emitter.ts';

// ── Tool metadata ─────────────────────────────────────────────────

export const CHAT_SEND_MESSAGE_TOOL = {
  name: 'chat_send_message',
  description:
    'Send a message to the user in an active chat session. ' +
    'Use this to proactively communicate with the user during a conversation. ' +
    'The message will appear in their chat interface. ' +
    'Set urgency to control notification escalation if the user is not actively viewing the chat.',
  parameters: {
    type: 'object' as const,
    required: ['session_id', 'content'],
    properties: {
      session_id: {
        type: 'string',
        description: 'UUID of the active chat session to send the message to',
      },
      content: {
        type: 'string',
        description: 'Message content to send (max 64KB)',
      },
      content_type: {
        type: 'string',
        enum: ['text/plain', 'text/markdown', 'application/vnd.openclaw.rich-card'],
        description: 'Content type of the message (default: text/markdown)',
      },
      urgency: {
        type: 'string',
        enum: ['low', 'normal', 'high', 'urgent'],
        description: 'Notification urgency if user is not viewing session (default: normal)',
      },
    },
  },
};

export const CHAT_ATTRACT_ATTENTION_TOOL = {
  name: 'chat_attract_attention',
  description:
    'Send a notification to attract the user\'s attention outside of chat context. ' +
    'Use this for important updates, reminders, or alerts that need the user\'s attention. ' +
    'Urgency controls the escalation chain: low=in-app, normal=+push, high=+SMS, urgent=+email. ' +
    'Use reason_key to prevent duplicate notifications (15-minute dedup window).',
  parameters: {
    type: 'object' as const,
    required: ['message', 'urgency', 'reason_key'],
    properties: {
      message: {
        type: 'string',
        description: 'Notification message (max 500 chars)',
      },
      urgency: {
        type: 'string',
        enum: ['low', 'normal', 'high', 'urgent'],
        description: 'Urgency level controlling notification channels',
      },
      reason_key: {
        type: 'string',
        description: 'Dedup key to prevent duplicate notifications (max 100 chars, e.g. "reminder:daily-standup")',
      },
      session_id: {
        type: 'string',
        description: 'Optional: link notification to a chat session',
      },
      action_url: {
        type: 'string',
        description: 'Optional: URL to open when notification is clicked',
      },
    },
  },
};

// ── Tool parameter types ──────────────────────────────────────────

export interface ChatSendMessageParams {
  session_id: string;
  content: string;
  content_type?: string;
  urgency?: Urgency;
}

export interface ChatAttractAttentionParams {
  message: string;
  urgency: Urgency;
  reason_key: string;
  session_id?: string;
  action_url?: string;
}

// ── Tool execute functions ────────────────────────────────────────

/** Maximum content size (64KB). */
const MAX_CONTENT_BYTES = 65536;
/** Maximum attention message length. */
const MAX_ATTENTION_MESSAGE_LENGTH = 500;
/** Maximum reason key length. */
const MAX_REASON_KEY_LENGTH = 100;

/**
 * Execute chat_send_message tool.
 *
 * Inserts a message into the session's thread (direction=inbound from agent).
 * Optionally triggers notification escalation based on urgency.
 */
export async function executeChatSendMessage(
  pool: Pool,
  params: ChatSendMessageParams,
  agentId: string,
  userEmail: string,
  namespace: string,
): Promise<{ ok: boolean; message_id?: string; error?: string }> {
  // Validate content size
  const contentBytes = Buffer.byteLength(params.content, 'utf8');
  if (contentBytes > MAX_CONTENT_BYTES) {
    return { ok: false, error: 'Content exceeds 64KB limit' };
  }

  // Validate session exists and is active
  const sessionResult = await pool.query(
    `SELECT cs.id, cs.thread_id, cs.user_email, cs.agent_id, cs.status
     FROM chat_session cs
     WHERE cs.id = $1 AND cs.namespace = $2`,
    [params.session_id, namespace],
  );

  if (sessionResult.rows.length === 0) {
    return { ok: false, error: 'Session not found' };
  }

  const session = sessionResult.rows[0] as {
    id: string;
    thread_id: string;
    user_email: string;
    agent_id: string;
    status: string;
  };

  if (session.status !== 'active') {
    return { ok: false, error: 'Session is not active' };
  }

  // Validate agent matches session
  if (session.agent_id !== agentId) {
    return { ok: false, error: 'Agent does not own this session' };
  }

  // Insert message
  const messageId = randomUUID();
  const contentType = params.content_type ?? 'text/markdown';

  await pool.query(
    `INSERT INTO external_message (id, thread_id, direction, body, status, content_type, agent_run_id)
     VALUES ($1, $2, 'inbound', $3, 'delivered', $4, $5)`,
    [messageId, session.thread_id, params.content, contentType, agentId],
  );

  // Update session activity
  await pool.query(
    `UPDATE chat_session SET last_activity_at = NOW() WHERE id = $1`,
    [params.session_id],
  );

  // Emit realtime event
  await emitNotificationCreated({
    id: messageId,
    type: 'agent_message',
    title: 'New message from agent',
    entity_type: 'chat_session',
    entity_id: params.session_id,
  }, userEmail).catch((err: unknown) => {
    console.error('[Chat] Failed to emit message event:', err instanceof Error ? err.message : err);
  });

  // If urgency specified and > low, trigger escalation
  const urgency = params.urgency ?? 'normal';
  if (urgency !== 'low') {
    await escalateNotification(pool, {
      userEmail,
      message: params.content.slice(0, 200),
      urgency,
      reasonKey: `chat_msg:${params.session_id}:${messageId}`,
      title: 'New agent message',
      sessionId: params.session_id,
      agentId,
      namespace,
    }).catch((err: unknown) => {
      console.error('[Chat] Escalation failed:', err instanceof Error ? err.message : err);
    });
  }

  return { ok: true, message_id: messageId };
}

/**
 * Execute chat_attract_attention tool.
 *
 * Creates a notification with escalation based on urgency.
 * Deduplicates by (user_email, reason_key) within 15-minute window.
 */
export async function executeChatAttractAttention(
  pool: Pool,
  params: ChatAttractAttentionParams,
  agentId: string,
  userEmail: string,
  namespace: string,
): Promise<{ ok: boolean; notification_id?: string; deduplicated?: boolean; error?: string }> {
  // Validate message length
  if (params.message.length > MAX_ATTENTION_MESSAGE_LENGTH) {
    return { ok: false, error: `Message exceeds ${MAX_ATTENTION_MESSAGE_LENGTH} char limit` };
  }

  // Validate reason_key length
  if (params.reason_key.length > MAX_REASON_KEY_LENGTH) {
    return { ok: false, error: `reason_key exceeds ${MAX_REASON_KEY_LENGTH} char limit` };
  }

  // Escalate
  const result = await escalateNotification(pool, {
    userEmail,
    message: params.message,
    urgency: params.urgency,
    reasonKey: params.reason_key,
    title: 'Agent attention request',
    sessionId: params.session_id,
    actionUrl: params.action_url,
    agentId,
    namespace,
  });

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  return {
    ok: true,
    notification_id: result.notificationId,
    deduplicated: result.deduplicated,
  };
}

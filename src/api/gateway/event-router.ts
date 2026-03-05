/**
 * GatewayEventRouter — routes ChatEvent frames from the gateway WS to users.
 *
 * Issue #2156: Receives events from GatewayConnectionService, validates sessionKey
 * against the DB, and dispatches to users via RealtimeHub.
 *
 * Security: user_email is ALWAYS sourced from the DB, never from the event payload.
 * Dedup: final events use ON CONFLICT DO NOTHING on external_message_key_unique.
 * Bounded: per-session delta trackers are cleaned on terminal states or 10-min TTL.
 */

import type { Pool } from 'pg';
import type { GatewayEventFrame } from './connection.ts';
import { getGatewayConnection } from './index.ts';
import { getRealtimeHub } from '../realtime/hub.ts';
import type { RealtimeEvent, GatewayStreamEventType, ChatEventType } from '../realtime/types.ts';
import { gwChatEventsRouted, gwDuplicateEventsSuppressed } from './metrics.ts';

// ── Types ────────────────────────────────────────────────────────────

interface ChatEventPayload {
  runId: string;
  sessionKey: string;
  seq: number;
  state: 'delta' | 'final' | 'aborted' | 'error';
  message?: unknown;
  errorMessage?: string;
  stopReason?: string;
}

interface SessionInfo {
  id: string;
  thread_id: string;
  user_email: string;
  agent_id: string;
  status: string;
}

/** Per-session/runId delta sequence tracker for dedup. */
interface DeltaTracker {
  seenSeqs: Set<number>;
  lastSeq: number;
  ttlTimer: ReturnType<typeof setTimeout>;
}

// ── Constants ────────────────────────────────────────────────────────

const LOG_PREFIX = '[EventRouter]';
const TRACKER_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_SANITIZED_ERROR_LENGTH = 200;

// ── Implementation ───────────────────────────────────────────────────

export class GatewayEventRouter {
  private pool: Pool | null = null;
  private initialized = false;
  /** Keyed by `${sessionId}:${runId}` for per-stream tracking. */
  private trackers = new Map<string, DeltaTracker>();
  /** Recently-terminated runIds to prevent late deltas after terminal state. */
  private terminatedRuns = new Map<string, number>();

  /** Register the event handler on the gateway connection. Idempotent. */
  initialize(pool: Pool): void {
    if (this.initialized) return;
    this.initialized = true;
    this.pool = pool;
    getGatewayConnection().onEvent((frame) => this.handleFrame(frame));
  }

  /** Clean up all trackers and timers. */
  shutdown(): void {
    for (const [, tracker] of this.trackers) {
      clearTimeout(tracker.ttlTimer);
    }
    this.trackers.clear();
    this.terminatedRuns.clear();
    this.pool = null;
    this.initialized = false;
  }

  /** Exposed for testing: number of active delta trackers. */
  getActiveTrackerCount(): number {
    return this.trackers.size;
  }

  // ── Private ────────────────────────────────────────────────────────

  private handleFrame(frame: GatewayEventFrame): void {
    if (frame.event !== 'chat') return;

    const event = this.validatePayload(frame.payload);
    if (!event) return;

    // Fire-and-forget: errors are logged, never propagated
    this.processEvent(event).catch((err: unknown) => {
      console.error(`${LOG_PREFIX} unhandled error:`, err instanceof Error ? err.message : err);
    });
  }

  /** Runtime validation of gateway payload shape. Returns null if invalid. */
  private validatePayload(payload: unknown): ChatEventPayload | null {
    if (!payload || typeof payload !== 'object') {
      console.warn(`${LOG_PREFIX} invalid payload: not an object`);
      return null;
    }

    const p = payload as Record<string, unknown>;

    if (typeof p.runId !== 'string' || !p.runId) {
      console.warn(`${LOG_PREFIX} invalid payload: missing or invalid runId`);
      return null;
    }
    if (typeof p.sessionKey !== 'string' || !p.sessionKey) {
      console.warn(`${LOG_PREFIX} invalid payload: missing or invalid sessionKey`);
      return null;
    }
    if (typeof p.seq !== 'number' || !Number.isFinite(p.seq)) {
      console.warn(`${LOG_PREFIX} invalid payload: missing or invalid seq`);
      return null;
    }
    const validStates = new Set(['delta', 'final', 'aborted', 'error']);
    if (typeof p.state !== 'string' || !validStates.has(p.state)) {
      console.warn(`${LOG_PREFIX} invalid payload: unknown state '${p.state}'`);
      return null;
    }

    return p as unknown as ChatEventPayload;
  }

  private async processEvent(event: ChatEventPayload): Promise<void> {
    // Parse sessionKey: "agent:{agentId}:agent_chat:{threadId}"
    const parsed = this.parseSessionKey(event.sessionKey);
    if (!parsed) {
      console.warn(`${LOG_PREFIX} invalid sessionKey format: ${event.sessionKey}`);
      return;
    }

    const { agentId, threadId } = parsed;

    // Look up session in DB
    const session = await this.lookupSession(threadId);
    if (!session) {
      console.warn(`${LOG_PREFIX} no session found for thread_id=${threadId}`);
      return;
    }

    // Verify agent_id matches
    if (session.agent_id !== agentId) {
      console.warn(`${LOG_PREFIX} agent_id mismatch: event=${agentId}, db=${session.agent_id}`);
      return;
    }

    // Verify session is active
    if (session.status !== 'active') {
      console.warn(`${LOG_PREFIX} session ${session.id} is ${session.status}, discarding event`);
      return;
    }

    // Route by state
    gwChatEventsRouted.inc();
    switch (event.state) {
      case 'delta':
        this.handleDelta(session, event);
        break;
      case 'final':
        await this.handleFinal(session, event);
        break;
      case 'aborted':
        this.handleAborted(session, event);
        break;
      case 'error':
        this.handleError(session, event);
        break;
      default:
        console.warn(`${LOG_PREFIX} unknown event state: ${event.state}`);
    }
  }

  private parseSessionKey(sessionKey: string): { agentId: string; threadId: string } | null {
    if (!sessionKey || typeof sessionKey !== 'string') return null;

    const parts = sessionKey.split(':');
    // Expected: ["agent", agentId, "agent_chat", threadId]
    if (parts.length !== 4 || parts[0] !== 'agent' || parts[2] !== 'agent_chat') {
      return null;
    }

    const agentId = parts[1];
    const threadId = parts[3];
    if (!agentId || !threadId) return null;

    return { agentId, threadId };
  }

  private async lookupSession(threadId: string): Promise<SessionInfo | null> {
    if (!this.pool) return null;

    const result = await this.pool.query(
      `SELECT id, thread_id, user_email, agent_id, status
       FROM chat_session WHERE thread_id = $1`,
      [threadId],
    );

    if (result.rows.length === 0) return null;
    return result.rows[0] as SessionInfo;
  }

  // ── Delta handling ─────────────────────────────────────────────────

  private handleDelta(session: SessionInfo, event: ChatEventPayload): void {
    const trackerKey = `${session.id}:${event.runId}`;

    // Reject late deltas after terminal state
    if (this.terminatedRuns.has(trackerKey)) return;

    let tracker = this.trackers.get(trackerKey);

    if (!tracker) {
      tracker = this.createTracker(trackerKey);
    }

    // Duplicate seq detection
    if (tracker.seenSeqs.has(event.seq)) {
      gwDuplicateEventsSuppressed.inc();
      return; // Skip duplicate
    }

    // Sequence gap detection
    if (tracker.lastSeq >= 0 && event.seq !== tracker.lastSeq + 1) {
      console.warn(
        `${LOG_PREFIX} seq gap: expected ${tracker.lastSeq + 1}, got ${event.seq} ` +
        `(session=${session.id}, runId=${event.runId})`,
      );
    }

    tracker.seenSeqs.add(event.seq);
    tracker.lastSeq = event.seq;

    // Emit to user via RealtimeHub
    const content = typeof event.message === 'string' ? event.message : JSON.stringify(event.message);

    const realtimeEvent: RealtimeEvent = {
      event: 'stream:chunk' as GatewayStreamEventType,
      data: {
        session_id: session.id,
        seq: event.seq,
        content,
      },
      timestamp: new Date().toISOString(),
    };

    getRealtimeHub().sendToUser(session.user_email, realtimeEvent);
  }

  // ── Final handling ─────────────────────────────────────────────────

  private async handleFinal(session: SessionInfo, event: ChatEventPayload): Promise<void> {
    const content = typeof event.message === 'string' ? event.message : JSON.stringify(event.message);
    const messageKey = `agent:${session.agent_id}:${event.runId}`;

    try {
      // Insert with ON CONFLICT DO NOTHING for dedup with HTTP fallback
      const insertResult = await this.pool!.query(
        `INSERT INTO external_message
         (thread_id, external_message_key, direction, body, status, agent_run_id, content_type)
         VALUES ($1, $2, 'inbound', $3, 'delivered', $4, 'text/plain')
         ON CONFLICT ON CONSTRAINT external_message_key_unique DO NOTHING
         RETURNING id`,
        [session.thread_id, messageKey, content, event.runId],
      );

      // ON CONFLICT DO NOTHING returns no rows if duplicate — skip emit to avoid duplicate notifications
      if (insertResult.rows.length === 0) {
        // Duplicate final event (already persisted via HTTP fallback or prior WS event)
        return;
      }

      const messageId = (insertResult.rows[0] as { id: string }).id;

      // Update session activity
      await this.pool!.query(
        `UPDATE chat_session SET last_activity_at = NOW() WHERE id = $1`,
        [session.id],
      );

      // Emit chat:message_received to RealtimeHub
      getRealtimeHub().emit(
        'chat:message_received' as ChatEventType,
        { session_id: session.id, message_id: messageId },
        session.user_email,
      ).catch((err: unknown) => {
        console.error(`${LOG_PREFIX} emit error:`, err instanceof Error ? err.message : err);
      });
    } catch (err: unknown) {
      console.error(
        `${LOG_PREFIX} DB error in final handler:`,
        err instanceof Error ? err.message : err,
      );
    }

    // Clean up tracker and mark as terminated
    this.terminateRun(`${session.id}:${event.runId}`);
  }

  // ── Aborted handling ───────────────────────────────────────────────

  private handleAborted(session: SessionInfo, event: ChatEventPayload): void {
    const realtimeEvent: RealtimeEvent = {
      event: 'stream:aborted' as GatewayStreamEventType,
      data: {
        session_id: session.id,
        run_id: event.runId,
      },
      timestamp: new Date().toISOString(),
    };

    getRealtimeHub().sendToUser(session.user_email, realtimeEvent);

    // Clean up tracker and mark as terminated
    this.terminateRun(`${session.id}:${event.runId}`);
  }

  // ── Error handling ─────────────────────────────────────────────────

  private handleError(session: SessionInfo, event: ChatEventPayload): void {
    const rawError = event.errorMessage ?? 'Agent error';
    const sanitizedError = rawError.slice(0, MAX_SANITIZED_ERROR_LENGTH);

    const realtimeEvent: RealtimeEvent = {
      event: 'stream:failed' as GatewayStreamEventType,
      data: {
        session_id: session.id,
        run_id: event.runId,
        error: sanitizedError,
      },
      timestamp: new Date().toISOString(),
    };

    getRealtimeHub().sendToUser(session.user_email, realtimeEvent);

    // Clean up tracker and mark as terminated
    this.terminateRun(`${session.id}:${event.runId}`);
  }

  // ── Tracker management ─────────────────────────────────────────────

  private createTracker(key: string): DeltaTracker {
    const tracker: DeltaTracker = {
      seenSeqs: new Set(),
      lastSeq: -1,
      ttlTimer: setTimeout(() => {
        this.trackers.delete(key);
      }, TRACKER_TTL_MS),
    };
    this.trackers.set(key, tracker);
    return tracker;
  }

  private removeTracker(key: string): void {
    const tracker = this.trackers.get(key);
    if (tracker) {
      clearTimeout(tracker.ttlTimer);
      this.trackers.delete(key);
    }
  }

  /** Remove tracker and record termination so late deltas are rejected. */
  private terminateRun(key: string): void {
    this.removeTracker(key);
    this.terminatedRuns.set(key, Date.now());

    // Auto-clean terminated entry after TTL to prevent unbounded growth
    setTimeout(() => {
      this.terminatedRuns.delete(key);
    }, TRACKER_TTL_MS);
  }
}

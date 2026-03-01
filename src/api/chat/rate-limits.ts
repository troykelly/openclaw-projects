/**
 * Chat-specific rate limiting (#1960).
 *
 * Provides per-user and per-session rate limits for chat operations.
 * Supplements the global @fastify/rate-limit with chat-specific logic.
 *
 * Rate limit matrix:
 * - Session creation: 5/min per user
 * - Messages: 10/min per user
 * - WS connections: 5 concurrent per user
 * - Stream chunks: 100/sec + 256KB total per session
 * - Typing: 2/sec per connection
 * - attract_attention: 3/hour + 10/day per user
 * - SMS/email escalation: 5/hour per user (handled in notification-escalation.ts)
 *
 * Epic #1940 — Agent Chat.
 */

/** A sliding-window counter for simple rate limits. */
interface SlidingCounter {
  count: number;
  windowStart: number;
}

/** Dual-window counter for hourly + daily limits. */
interface DualCounter {
  hourly: SlidingCounter;
  daily: SlidingCounter;
}

/** Stream rate limit state per session. */
interface StreamRateState {
  chunkCount: number;
  chunkWindowStart: number;
  totalBytes: number;
}

// ── Configurable limits via environment variables ────────────────

function envInt(key: string, fallback: number): number {
  const v = process.env[key];
  return v ? parseInt(v, 10) : fallback;
}

/** Chat rate limit configuration (all values configurable via env). */
export const CHAT_LIMITS = {
  /** Max session creations per minute per user. */
  sessionCreation: { max: envInt('CHAT_RL_SESSION_CREATE_MAX', 5), windowMs: 60_000 },
  /** Max messages per minute per user. */
  messageSend: { max: envInt('CHAT_RL_MESSAGE_SEND_MAX', 10), windowMs: 60_000 },
  /** Max concurrent WS connections per user. */
  wsConnections: { max: envInt('CHAT_RL_WS_MAX_CONCURRENT', 5) },
  /** Max stream chunks per second per session. */
  streamChunks: { max: envInt('CHAT_RL_STREAM_CHUNKS_SEC', 100), windowMs: 1_000 },
  /** Max stream total bytes per session. */
  streamTotalBytes: envInt('CHAT_RL_STREAM_TOTAL_BYTES', 256 * 1024),
  /** Max typing events per second per connection. */
  typing: { max: envInt('CHAT_RL_TYPING_SEC', 2), windowMs: 1_000 },
  /** Max attract_attention per hour per user. */
  attractHourly: { max: envInt('CHAT_RL_ATTRACT_HOUR', 3), windowMs: 3_600_000 },
  /** Max attract_attention per day per user. */
  attractDaily: { max: envInt('CHAT_RL_ATTRACT_DAY', 10), windowMs: 86_400_000 },
} as const;

// ── In-memory stores ─────────────────────────────────────────────

const sessionCreationLimits = new Map<string, SlidingCounter>();
const messageSendLimits = new Map<string, SlidingCounter>();
const wsConnectionCounts = new Map<string, number>();
const streamRateLimits = new Map<string, StreamRateState>();
const typingLimits = new Map<string, SlidingCounter>();
const attractLimits = new Map<string, DualCounter>();

// ── Rate limit result ────────────────────────────────────────────

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the limit resets (for Retry-After header). */
  retryAfterSec?: number;
}

// ── Helpers ──────────────────────────────────────────────────────

function checkSlidingWindow(
  store: Map<string, SlidingCounter>,
  key: string,
  max: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  let counter = store.get(key);
  if (!counter || now - counter.windowStart >= windowMs) {
    counter = { count: 0, windowStart: now };
    store.set(key, counter);
  }
  if (counter.count >= max) {
    const retryAfterSec = Math.ceil((counter.windowStart + windowMs - now) / 1000);
    return { allowed: false, retryAfterSec: Math.max(1, retryAfterSec) };
  }
  counter.count++;
  return { allowed: true };
}

// ── Public API ───────────────────────────────────────────────────

/** Check and charge session creation rate limit. */
export function checkSessionCreation(userEmail: string): RateLimitResult {
  return checkSlidingWindow(
    sessionCreationLimits,
    userEmail,
    CHAT_LIMITS.sessionCreation.max,
    CHAT_LIMITS.sessionCreation.windowMs,
  );
}

/** Check and charge message send rate limit. */
export function checkMessageSend(userEmail: string): RateLimitResult {
  return checkSlidingWindow(
    messageSendLimits,
    userEmail,
    CHAT_LIMITS.messageSend.max,
    CHAT_LIMITS.messageSend.windowMs,
  );
}

/** Check and charge agent message send rate limit (per session). */
export function checkAgentMessageSend(sessionId: string): RateLimitResult {
  return checkSlidingWindow(
    messageSendLimits,
    `agent:${sessionId}`,
    CHAT_LIMITS.messageSend.max,
    CHAT_LIMITS.messageSend.windowMs,
  );
}

/**
 * Track WS connection opened. Returns false if limit exceeded.
 */
export function wsConnectionOpened(userEmail: string): RateLimitResult {
  const current = wsConnectionCounts.get(userEmail) ?? 0;
  if (current >= CHAT_LIMITS.wsConnections.max) {
    return { allowed: false };
  }
  wsConnectionCounts.set(userEmail, current + 1);
  return { allowed: true };
}

/** Track WS connection closed. */
export function wsConnectionClosed(userEmail: string): void {
  const current = wsConnectionCounts.get(userEmail) ?? 0;
  if (current > 0) {
    wsConnectionCounts.set(userEmail, current - 1);
  }
}

/** Check and charge stream chunk rate limit. */
export function checkStreamChunk(sessionId: string, chunkBytes: number): RateLimitResult {
  const now = Date.now();
  let state = streamRateLimits.get(sessionId);
  if (!state) {
    state = { chunkCount: 0, chunkWindowStart: now, totalBytes: 0 };
    streamRateLimits.set(sessionId, state);
  }

  // Reset per-second window
  if (now - state.chunkWindowStart >= CHAT_LIMITS.streamChunks.windowMs) {
    state.chunkCount = 0;
    state.chunkWindowStart = now;
  }

  // Check per-second limit
  if (state.chunkCount >= CHAT_LIMITS.streamChunks.max) {
    return { allowed: false, retryAfterSec: 1 };
  }

  // Check total bytes limit
  if (state.totalBytes + chunkBytes > CHAT_LIMITS.streamTotalBytes) {
    return { allowed: false };
  }

  state.chunkCount++;
  state.totalBytes += chunkBytes;
  return { allowed: true };
}

/** Clear stream rate limit state for a session (on stream complete/fail). */
export function clearStreamState(sessionId: string): void {
  streamRateLimits.delete(sessionId);
}

/** Check and charge typing rate limit. */
export function checkTyping(connectionKey: string): RateLimitResult {
  return checkSlidingWindow(
    typingLimits,
    connectionKey,
    CHAT_LIMITS.typing.max,
    CHAT_LIMITS.typing.windowMs,
  );
}

/**
 * Check attract_attention rate limit (dual hourly + daily windows).
 * Does NOT charge on success — call chargeAttractAttention() after execution.
 */
export function checkAttractAttention(userEmail: string): RateLimitResult {
  const now = Date.now();
  let rl = attractLimits.get(userEmail);
  if (!rl) {
    rl = {
      hourly: { count: 0, windowStart: now },
      daily: { count: 0, windowStart: now },
    };
    attractLimits.set(userEmail, rl);
  }

  // Reset expired windows
  if (now - rl.hourly.windowStart >= CHAT_LIMITS.attractHourly.windowMs) {
    rl.hourly = { count: 0, windowStart: now };
  }
  if (now - rl.daily.windowStart >= CHAT_LIMITS.attractDaily.windowMs) {
    rl.daily = { count: 0, windowStart: now };
  }

  if (rl.hourly.count >= CHAT_LIMITS.attractHourly.max) {
    const retryAfterSec = Math.ceil((rl.hourly.windowStart + CHAT_LIMITS.attractHourly.windowMs - now) / 1000);
    return { allowed: false, retryAfterSec: Math.max(1, retryAfterSec) };
  }
  if (rl.daily.count >= CHAT_LIMITS.attractDaily.max) {
    const retryAfterSec = Math.ceil((rl.daily.windowStart + CHAT_LIMITS.attractDaily.windowMs - now) / 1000);
    return { allowed: false, retryAfterSec: Math.max(1, retryAfterSec) };
  }

  return { allowed: true };
}

/** Charge attract_attention rate limit after successful non-deduplicated delivery. */
export function chargeAttractAttention(userEmail: string): void {
  const rl = attractLimits.get(userEmail);
  if (rl) {
    rl.hourly.count++;
    rl.daily.count++;
  }
}

// ── Extend per-user.ts categories ────────────────────────────────

/**
 * Chat-specific rate limit categories for use with per-user.ts pattern.
 * These supplement the existing RateLimitCategory type.
 */
export type ChatRateLimitCategory =
  | 'chat_session_create'
  | 'chat_message_send'
  | 'chat_stream'
  | 'chat_attract';

/**
 * Notification escalation service for agent chat (#1955).
 *
 * Routes agent notifications through channels based on urgency:
 * - low: in-app only
 * - normal: in-app + push
 * - high: in-app + push + SMS
 * - urgent: in-app + push + SMS + email
 *
 * Respects user preferences (quiet hours, channel overrides).
 * Deduplicates by (user_email, reason_key) within 15-minute window.
 * Rate-limits SMS/email escalation.
 *
 * Epic #1940 — Agent Chat.
 */

import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { emitNotificationCreated } from '../realtime/emitter.ts';

/** Urgency levels, from least to most urgent. */
export type Urgency = 'low' | 'normal' | 'high' | 'urgent';

/** Escalation channels. */
export type EscalationChannel = 'in_app' | 'push' | 'sms' | 'email';

/** Default escalation chain per urgency. */
const DEFAULT_ESCALATION: Record<Urgency, EscalationChannel[]> = {
  low: ['in_app'],
  normal: ['in_app', 'push'],
  high: ['in_app', 'push', 'sms'],
  urgent: ['in_app', 'push', 'sms', 'email'],
};

/** Dedup window in milliseconds (15 minutes). */
const DEDUP_WINDOW_MS = 15 * 60 * 1000;

/** Rate limits per channel per user. */
const RATE_LIMITS: Record<string, { max: number; windowMs: number }> = {
  sms_hour: { max: 5, windowMs: 60 * 60 * 1000 },
  email_hour: { max: 5, windowMs: 60 * 60 * 1000 },
  total_day: { max: 10, windowMs: 24 * 60 * 60 * 1000 },
};

/** Request to escalate a notification. */
export interface EscalateRequest {
  userEmail: string;
  message: string;
  urgency: Urgency;
  reasonKey: string;
  title?: string;
  sessionId?: string;
  actionUrl?: string;
  agentId?: string;
  namespace?: string;
}

/** Result of escalation attempt. */
export interface EscalateResult {
  ok: boolean;
  notificationId?: string;
  channels: EscalationChannel[];
  deduplicated?: boolean;
  rateLimited?: string[];
  error?: string;
}

/** User notification preferences (stored in chat_notification_prefs jsonb). */
interface ChatNotificationPrefs {
  quiet_hours?: {
    start: string;  // HH:MM
    end: string;    // HH:MM
    timezone: string;
  };
  escalation?: Partial<Record<Urgency, EscalationChannel[]>>;
  sound_enabled?: boolean;
  auto_open_on_message?: boolean;
}

/**
 * Check if current time is within quiet hours for the given timezone.
 */
export function isInQuietHours(prefs: ChatNotificationPrefs): boolean {
  if (!prefs.quiet_hours) return false;

  const { start, end, timezone } = prefs.quiet_hours;
  if (!start || !end || !timezone) return false;

  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(now);
    const hourPart = parts.find(p => p.type === 'hour');
    const minutePart = parts.find(p => p.type === 'minute');
    if (!hourPart || !minutePart) return false;

    const currentMinutes = parseInt(hourPart.value, 10) * 60 + parseInt(minutePart.value, 10);
    const [startH, startM] = start.split(':').map(Number);
    const [endH, endM] = end.split(':').map(Number);
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;

    if (startMinutes <= endMinutes) {
      // Same day range (e.g., 09:00 - 17:00)
      return currentMinutes >= startMinutes && currentMinutes < endMinutes;
    }
    // Overnight range (e.g., 22:00 - 07:00)
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  } catch {
    return false;
  }
}

/**
 * Determine which channels to use for a notification.
 */
export function resolveChannels(
  urgency: Urgency,
  prefs: ChatNotificationPrefs,
  quietHours: boolean,
): EscalationChannel[] {
  // Start with user preference or default escalation
  const channels = prefs.escalation?.[urgency] ?? DEFAULT_ESCALATION[urgency];

  if (!quietHours) return channels;

  // During quiet hours: suppress push/SMS/email EXCEPT for urgent
  if (urgency === 'urgent') return channels;

  return channels.filter(ch => ch === 'in_app');
}

/**
 * Check deduplication for a (user_email, reason_key) pair.
 * Returns true if a notification with the same reason_key was sent
 * within the last 15 minutes.
 */
async function isDuplicate(pool: Pool, userEmail: string, reasonKey: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - DEDUP_WINDOW_MS).toISOString();
  const result = await pool.query(
    `SELECT 1 FROM notification_dedup
     WHERE user_email = $1 AND reason_key = $2 AND created_at > $3
     LIMIT 1`,
    [userEmail, reasonKey, cutoff],
  );
  return result.rows.length > 0;
}

/**
 * Record a dedup entry.
 */
async function recordDedup(pool: Pool, userEmail: string, reasonKey: string, notificationId: string): Promise<void> {
  await pool.query(
    `INSERT INTO notification_dedup (user_email, reason_key, notification_id)
     VALUES ($1, $2, $3)`,
    [userEmail, reasonKey, notificationId],
  );
}

/**
 * Check channel rate limit. Returns true if rate limit is exceeded.
 */
async function isRateLimited(pool: Pool, userEmail: string, channel: string, limitKey: string): Promise<boolean> {
  const limit = RATE_LIMITS[limitKey];
  if (!limit) return false;

  const cutoff = new Date(Date.now() - limit.windowMs).toISOString();
  const result = await pool.query(
    `SELECT COUNT(*)::int as count FROM notification_rate
     WHERE user_email = $1 AND channel = $2 AND created_at > $3`,
    [userEmail, channel, cutoff],
  );
  return (result.rows[0] as { count: number }).count >= limit.max;
}

/**
 * Check total daily rate limit across all escalation channels.
 */
async function isTotalRateLimited(pool: Pool, userEmail: string): Promise<boolean> {
  const limit = RATE_LIMITS.total_day;
  const cutoff = new Date(Date.now() - limit.windowMs).toISOString();
  const result = await pool.query(
    `SELECT COUNT(*)::int as count FROM notification_rate
     WHERE user_email = $1 AND created_at > $2`,
    [userEmail, cutoff],
  );
  return (result.rows[0] as { count: number }).count >= limit.max;
}

/**
 * Record a rate limit entry.
 */
async function recordRate(pool: Pool, userEmail: string, channel: string): Promise<void> {
  await pool.query(
    `INSERT INTO notification_rate (user_email, channel) VALUES ($1, $2)`,
    [userEmail, channel],
  );
}

/**
 * Create the in-app notification record.
 */
async function createNotification(
  pool: Pool,
  req: EscalateRequest,
): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO notification (id, user_email, notification_type, title, message, metadata, namespace)
     VALUES ($1, $2, 'agent_message', $3, $4, $5::jsonb, $6)`,
    [
      id,
      req.userEmail,
      req.title ?? 'Agent notification',
      req.message,
      JSON.stringify({
        urgency: req.urgency,
        session_id: req.sessionId,
        action_url: req.actionUrl,
        agent_id: req.agentId,
        reason_key: req.reasonKey,
      }),
      req.namespace ?? 'default',
    ],
  );
  return id;
}

/**
 * Main escalation function.
 *
 * 1. Check dedup
 * 2. Load user prefs
 * 3. Resolve channels (respecting quiet hours)
 * 4. Create in-app notification
 * 5. Dispatch to external channels (push, SMS, email) with rate limiting
 * 6. Emit realtime event
 */
export async function escalateNotification(
  pool: Pool,
  req: EscalateRequest,
): Promise<EscalateResult> {
  // Step 1: Dedup check
  if (await isDuplicate(pool, req.userEmail, req.reasonKey)) {
    return { ok: true, channels: [], deduplicated: true };
  }

  // Step 2: Load user preferences
  const prefsResult = await pool.query(
    `SELECT chat_notification_prefs FROM user_setting WHERE email = $1`,
    [req.userEmail],
  );
  const prefs: ChatNotificationPrefs = prefsResult.rows.length > 0
    ? (prefsResult.rows[0] as { chat_notification_prefs: ChatNotificationPrefs }).chat_notification_prefs
    : {};

  // Step 3: Resolve channels
  const quietHours = isInQuietHours(prefs);
  const channels = resolveChannels(req.urgency, prefs, quietHours);

  // Step 4: Create in-app notification
  const notificationId = await createNotification(pool, req);

  // Record dedup
  await recordDedup(pool, req.userEmail, req.reasonKey, notificationId);

  // Step 5: Dispatch to external channels
  const rateLimited: string[] = [];
  const deliveredChannels: EscalationChannel[] = ['in_app'];

  // Check total daily rate limit first
  const totalLimited = await isTotalRateLimited(pool, req.userEmail);

  for (const channel of channels) {
    if (channel === 'in_app') continue; // Already handled

    if (totalLimited) {
      rateLimited.push(channel);
      continue;
    }

    if (channel === 'sms') {
      if (await isRateLimited(pool, req.userEmail, 'sms', 'sms_hour')) {
        rateLimited.push('sms');
        continue;
      }
      await recordRate(pool, req.userEmail, 'sms');
      deliveredChannels.push('sms');
      // SMS dispatch is handled by the caller via enqueueSmsMessage
    }

    if (channel === 'email') {
      if (await isRateLimited(pool, req.userEmail, 'email', 'email_hour')) {
        rateLimited.push('email');
        continue;
      }
      await recordRate(pool, req.userEmail, 'email');
      deliveredChannels.push('email');
      // Email dispatch is handled by the caller via enqueueEmailMessage
    }

    if (channel === 'push') {
      await recordRate(pool, req.userEmail, 'push');
      deliveredChannels.push('push');
      // Push dispatch is handled by the caller
    }
  }

  // Step 6: Emit realtime event
  await emitNotificationCreated({
    id: notificationId,
    type: 'agent_message',
    title: req.title ?? 'Agent notification',
    entity_type: 'chat_session',
    entity_id: req.sessionId,
  }, req.userEmail).catch((err: unknown) => {
    console.error('[Chat] Failed to emit notification event:', err instanceof Error ? err.message : err);
  });

  return {
    ok: true,
    notificationId,
    channels: deliveredChannels,
    rateLimited: rateLimited.length > 0 ? rateLimited : undefined,
  };
}

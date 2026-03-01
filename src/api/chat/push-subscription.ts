/**
 * Web Push subscription management (#1956).
 *
 * Stores push subscriptions in user_setting.push_subscriptions jsonb array.
 * Each subscription has endpoint, keys (p256dh, auth), and creation timestamp.
 * Max 5 subscriptions per user (one per device).
 *
 * Epic #1940 — Agent Chat.
 */

import type { Pool } from 'pg';

/** Maximum subscriptions per user (one per device). */
const MAX_SUBSCRIPTIONS = 5;

/** A Web Push subscription from the browser. */
export interface PushSubscription {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  created_at?: string;
}

/** Validate a push subscription object. */
export function validatePushSubscription(sub: unknown): sub is PushSubscription {
  if (!sub || typeof sub !== 'object') return false;
  const s = sub as Record<string, unknown>;

  if (!s.endpoint || typeof s.endpoint !== 'string') return false;
  if (!s.endpoint.startsWith('https://')) return false;

  if (!s.keys || typeof s.keys !== 'object') return false;
  const keys = s.keys as Record<string, unknown>;
  if (!keys.p256dh || typeof keys.p256dh !== 'string') return false;
  if (!keys.auth || typeof keys.auth !== 'string') return false;

  return true;
}

/**
 * Add a push subscription for a user.
 * Replaces existing subscription with the same endpoint.
 * Enforces max 5 subscriptions per user.
 */
export async function addPushSubscription(
  pool: Pool,
  userEmail: string,
  subscription: PushSubscription,
): Promise<{ ok: boolean; error?: string }> {
  const result = await pool.query(
    `SELECT push_subscriptions FROM user_setting WHERE email = $1`,
    [userEmail],
  );

  if (result.rows.length === 0) {
    return { ok: false, error: 'User not found' };
  }

  const existing = (result.rows[0] as { push_subscriptions: PushSubscription[] }).push_subscriptions;

  // Remove any existing subscription with the same endpoint
  const filtered = existing.filter(s => s.endpoint !== subscription.endpoint);

  // Check max limit
  if (filtered.length >= MAX_SUBSCRIPTIONS) {
    // Remove oldest
    filtered.sort((a, b) => {
      const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
      const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
      return aTime - bTime;
    });
    filtered.shift();
  }

  // Add new subscription with timestamp
  const newSub: PushSubscription = {
    ...subscription,
    created_at: new Date().toISOString(),
  };
  filtered.push(newSub);

  await pool.query(
    `UPDATE user_setting SET push_subscriptions = $2::jsonb WHERE email = $1`,
    [userEmail, JSON.stringify(filtered)],
  );

  return { ok: true };
}

/**
 * Remove a push subscription by endpoint.
 */
export async function removePushSubscription(
  pool: Pool,
  userEmail: string,
  endpoint: string,
): Promise<{ ok: boolean }> {
  const result = await pool.query(
    `SELECT push_subscriptions FROM user_setting WHERE email = $1`,
    [userEmail],
  );

  if (result.rows.length === 0) {
    return { ok: false };
  }

  const existing = (result.rows[0] as { push_subscriptions: PushSubscription[] }).push_subscriptions;
  const filtered = existing.filter(s => s.endpoint !== endpoint);

  await pool.query(
    `UPDATE user_setting SET push_subscriptions = $2::jsonb WHERE email = $1`,
    [userEmail, JSON.stringify(filtered)],
  );

  return { ok: true };
}

/**
 * Get all push subscriptions for a user.
 */
export async function getPushSubscriptions(
  pool: Pool,
  userEmail: string,
): Promise<PushSubscription[]> {
  const result = await pool.query(
    `SELECT push_subscriptions FROM user_setting WHERE email = $1`,
    [userEmail],
  );

  if (result.rows.length === 0) return [];

  return (result.rows[0] as { push_subscriptions: PushSubscription[] }).push_subscriptions;
}

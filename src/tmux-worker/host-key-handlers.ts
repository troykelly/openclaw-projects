/**
 * Host key verification handlers for gRPC RPCs.
 * Issue #1854 — Host key verification RPCs.
 *
 * Implements: ApproveHostKey, RejectHostKey.
 *
 * ApproveHostKey stores the key in terminal_known_host and resumes sessions
 * stuck in 'pending_host_verification' status.
 *
 * RejectHostKey terminates sessions waiting for host key approval.
 */

import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type {
  ApproveHostKeyRequest,
  RejectHostKeyRequest,
} from './types.ts';

/** Database row shape for terminal_session (minimal). */
interface SessionRow {
  id: string;
  namespace: string;
  connection_id: string;
  status: string;
}

/**
 * Approve a host key and resume the blocked session.
 *
 * Flow:
 * 1. Validate the session exists and is in pending_host_verification
 * 2. Upsert the key into terminal_known_host
 * 3. Update session status to 'active'
 */
export async function handleApproveHostKey(
  req: ApproveHostKeyRequest,
  pool: pg.Pool,
): Promise<void> {
  // Fetch session
  const sessionResult = await pool.query<SessionRow>(
    `SELECT id, namespace, connection_id, status
     FROM terminal_session WHERE id = $1`,
    [req.session_id],
  );

  if (sessionResult.rows.length === 0) {
    throw new Error(`Session not found: ${req.session_id}`);
  }

  const session = sessionResult.rows[0];

  if (session.status !== 'pending_host_verification') {
    throw new Error(
      `Session ${req.session_id} is not pending host verification (status: ${session.status})`,
    );
  }

  // Upsert the host key into known hosts
  const knownHostId = randomUUID();
  await pool.query(
    `INSERT INTO terminal_known_host
       (id, namespace, connection_id, host, port, key_type, key_fingerprint, public_key, trusted_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'user')
     ON CONFLICT (namespace, host, port, key_type)
     DO UPDATE SET key_fingerprint = EXCLUDED.key_fingerprint,
                   public_key = EXCLUDED.public_key,
                   trusted_at = NOW(),
                   trusted_by = 'user'`,
    [
      knownHostId,
      session.namespace,
      session.connection_id,
      req.host,
      req.port,
      req.key_type,
      req.fingerprint,
      req.public_key,
    ],
  );

  // Resume the session
  await pool.query(
    `UPDATE terminal_session
     SET status = 'active', updated_at = NOW()
     WHERE id = $1`,
    [req.session_id],
  );
}

/**
 * Reject a host key and terminate the blocked session.
 *
 * Flow:
 * 1. Validate the session exists and is in pending_host_verification
 * 2. Update session status to 'error' with a descriptive message
 */
export async function handleRejectHostKey(
  req: RejectHostKeyRequest,
  pool: pg.Pool,
): Promise<void> {
  // Fetch session
  const sessionResult = await pool.query<SessionRow>(
    `SELECT id, namespace, connection_id, status
     FROM terminal_session WHERE id = $1`,
    [req.session_id],
  );

  if (sessionResult.rows.length === 0) {
    throw new Error(`Session not found: ${req.session_id}`);
  }

  const session = sessionResult.rows[0];

  if (session.status !== 'pending_host_verification') {
    throw new Error(
      `Session ${req.session_id} is not pending host verification (status: ${session.status})`,
    );
  }

  // Terminate the session with an error
  const now = new Date().toISOString();
  await pool.query(
    `UPDATE terminal_session
     SET status = 'error',
         error_message = 'Host key rejected by user',
         terminated_at = $1,
         updated_at = $1
     WHERE id = $2`,
    [now, req.session_id],
  );
}

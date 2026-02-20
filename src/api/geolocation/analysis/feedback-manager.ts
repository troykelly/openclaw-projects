/**
 * Feedback manager for Home Assistant routine feedback loop.
 *
 * Records user/agent feedback on routines and adjusts confidence scores
 * accordingly. Provides an audit trail of all feedback actions.
 *
 * Confidence adjustments:
 * - confirmed:            +0.1  (cap at 1.0)
 * - rejected:             set to 0, status → rejected
 * - modified:             reset to 0.5, status → tentative
 * - automation_accepted:  +0.15 (cap at 1.0)
 * - automation_rejected:  -0.1  (floor at 0.0)
 *
 * Issue #1466, Epic #1440.
 */

import type { Pool } from 'pg';

// ---------- types ----------

/** Valid feedback actions. */
export type FeedbackAction =
  | 'confirmed'
  | 'rejected'
  | 'modified'
  | 'automation_accepted'
  | 'automation_rejected';

/** Result of recording feedback. */
export interface FeedbackResult {
  /** ID of the feedback record. */
  feedback_id: string;
  /** Updated confidence after adjustment. */
  new_confidence: number;
  /** Updated status after adjustment. */
  new_status: string;
  /** Human-readable summary of the adjustment. */
  summary: string;
}

// ---------- constants ----------

const VALID_ACTIONS: ReadonlySet<string> = new Set([
  'confirmed',
  'rejected',
  'modified',
  'automation_accepted',
  'automation_rejected',
]);

// ---------- FeedbackManager ----------

export class FeedbackManager {
  constructor(private readonly pool: Pool) {}

  /**
   * Record feedback for a routine and apply the corresponding confidence adjustment.
   *
   * @param routineId - UUID of the routine
   * @param action - Feedback action to record
   * @param source - Source of the feedback ('agent', 'user', 'system')
   * @param namespace - Tenant namespace (TEXT, not UUID)
   * @param notes - Optional notes about the feedback
   * @returns Feedback result with new confidence and status
   * @throws Error if the routine is not found or action is invalid
   */
  async recordFeedback(
    routineId: string,
    action: FeedbackAction,
    source: string,
    namespace: string,
    notes?: string,
  ): Promise<FeedbackResult> {
    if (!VALID_ACTIONS.has(action)) {
      throw new Error(`Invalid feedback action: ${action}`);
    }

    // Use a dedicated client with a transaction to ensure atomicity
    // of the read → insert → update sequence and prevent race conditions.
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Verify the routine exists and lock the row for update
      const routineResult = await client.query<{
        id: string;
        confidence: number;
        status: string;
      }>(
        'SELECT id, confidence, status FROM ha_routines WHERE id = $1 AND namespace = $2 FOR UPDATE',
        [routineId, namespace],
      );

      if (routineResult.rows.length === 0) {
        throw new Error(`Routine ${routineId} not found in namespace ${namespace}`);
      }

      const routine = routineResult.rows[0];

      // Record the feedback
      const feedbackResult = await client.query<{ id: string }>(
        `INSERT INTO ha_routine_feedback (namespace, routine_id, action, source, notes)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [namespace, routineId, action, source, notes ?? null],
      );

      const feedbackId = feedbackResult.rows[0].id;

      // Apply confidence adjustment
      const { confidence, status } = this.calculateAdjustment(
        routine.confidence,
        routine.status,
        action,
      );

      // Update the routine
      await client.query(
        `UPDATE ha_routines
         SET confidence = $1, status = $2, updated_at = NOW()
         WHERE id = $3 AND namespace = $4`,
        [confidence, status, routineId, namespace],
      );

      await client.query('COMMIT');

      return {
        feedback_id: feedbackId,
        new_confidence: confidence,
        new_status: status,
        summary: this.buildSummary(action, routine.confidence, confidence, routine.status, status),
      };
    } catch (err: unknown) {
      await client.query('ROLLBACK').catch(() => {
        // Ignore rollback errors — the connection may already be in a failed state
      });
      throw err;
    } finally {
      client.release();
    }
  }

  // ---------- private ----------

  /**
   * Calculate the new confidence and status based on the feedback action.
   */
  private calculateAdjustment(
    currentConfidence: number,
    currentStatus: string,
    action: FeedbackAction,
  ): { confidence: number; status: string } {
    switch (action) {
      case 'confirmed':
        return {
          confidence: Math.min(1.0, currentConfidence + 0.1),
          status: currentStatus === 'rejected' ? 'tentative' : currentStatus,
        };

      case 'rejected':
        return {
          confidence: 0,
          status: 'rejected',
        };

      case 'modified':
        return {
          confidence: 0.5,
          status: 'tentative',
        };

      case 'automation_accepted':
        return {
          confidence: Math.min(1.0, currentConfidence + 0.15),
          status: currentStatus,
        };

      case 'automation_rejected':
        return {
          confidence: Math.max(0.0, currentConfidence - 0.1),
          status: currentStatus,
        };
    }
  }

  /**
   * Build a human-readable summary of the feedback action.
   */
  private buildSummary(
    action: FeedbackAction,
    oldConfidence: number,
    newConfidence: number,
    oldStatus: string,
    newStatus: string,
  ): string {
    const confChange =
      oldConfidence === newConfidence
        ? `confidence unchanged at ${fmtConf(newConfidence)}`
        : `confidence ${fmtConf(oldConfidence)} -> ${fmtConf(newConfidence)}`;

    const statusChange =
      oldStatus === newStatus
        ? ''
        : `, status ${oldStatus} -> ${newStatus}`;

    return `Feedback "${action}": ${confChange}${statusChange}`;
  }
}

// TODO: The routine API confirm/reject endpoints (#1460) should call
// FeedbackManager.recordFeedback() to create an audit trail when users
// confirm or reject routines via the REST API.

// TODO: The routine detector (#1456) should apply organic growth (+0.02
// per occurrence) to routine confidence on each detection pass, in addition
// to the feedback-driven adjustments managed here.

// ---------- helpers ----------

function fmtConf(c: number): string {
  return (Math.round(c * 100) / 100).toFixed(2);
}

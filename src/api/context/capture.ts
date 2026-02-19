/**
 * Context capture service for the auto-capture feature.
 * Part of Epic #310 - Issue #317.
 *
 * This service captures conversation context and stores it as a memory
 * when an agent session ends.
 */

import type { Pool } from 'pg';

/** Input for context capture */
export interface ContextCaptureInput {
  /** The conversation summary to capture */
  conversation: string;
  /** Number of messages in the conversation */
  message_count: number;
  /** User identifier for scoping the memory */
  user_id?: string;
}

/** Result of context capture */
export interface ContextCaptureResult {
  /** Number of memories captured (0 or 1) */
  captured: number;
  /** ID of the captured memory, if any */
  memory_id?: string;
  /** Reason if capture was skipped */
  reason?: string;
  /** Error message if capture failed */
  error?: string;
}

/** Minimum message count to consider capturing */
const MIN_MESSAGE_COUNT = 2;

/** Minimum content length to consider capturing */
const MIN_CONTENT_LENGTH = 100;

/** Maximum content length to store */
const MAX_CONTENT_LENGTH = 2000;

/**
 * Validates input parameters for context capture.
 * Returns an error message if invalid, null if valid.
 */
export function validateCaptureInput(input: ContextCaptureInput): string | null {
  // Conversation validation
  if (input.conversation === undefined || input.conversation === null || typeof input.conversation !== 'string') {
    return 'conversation is required';
  }
  if (input.conversation.trim().length === 0) {
    return 'conversation cannot be empty';
  }

  // message_count validation
  if (input.message_count === undefined || input.message_count === null) {
    return 'message_count is required';
  }
  if (typeof input.message_count !== 'number' || input.message_count < 1 || !Number.isInteger(input.message_count)) {
    return 'message_count must be a positive integer';
  }

  return null;
}

/**
 * Captures conversation context as a memory.
 *
 * This function is called when an agent session ends to persist
 * relevant context for future recall.
 *
 * Skips capture if:
 * - Message count is less than 2
 * - Conversation content is less than 100 characters
 */
export async function captureContext(pool: Pool, input: ContextCaptureInput): Promise<ContextCaptureResult> {
  const { conversation, message_count, user_id: _user_id } = input;

  // Skip if conversation is too short
  if (message_count < MIN_MESSAGE_COUNT) {
    return {
      captured: 0,
      reason: 'conversation too short',
    };
  }

  // Skip if content is too short
  if (conversation.trim().length < MIN_CONTENT_LENGTH) {
    return {
      captured: 0,
      reason: 'content too short',
    };
  }

  // Truncate content if necessary
  const content = conversation.substring(0, MAX_CONTENT_LENGTH);

  // Generate a title based on the first line or first 50 chars
  const firstLine = conversation.split('\n')[0].trim();
  const title = firstLine.length > 50 ? firstLine.substring(0, 47) + '...' : firstLine || 'Conversation Context';

  try {
    // Epic #1418 Phase 4: user_email column dropped from memory table.
    const result = await pool.query(
      `INSERT INTO memory (
        title,
        content,
        memory_type,
        created_by_agent,
        created_by_human,
        importance,
        confidence
      ) VALUES ($1, $2, $3::memory_type, $4, $5, $6, $7)
      RETURNING
        id::text,
        title,
        content,
        memory_type::text,
        importance,
        created_at,
        updated_at`,
      [
        title,
        content,
        'context',
        'auto-capture',
        false,
        5, // Default importance
        1.0, // High confidence for auto-captured context
      ],
    );

    if (result.rows.length === 0) {
      return {
        captured: 0,
        reason: 'insertion returned no rows',
      };
    }

    const row = result.rows[0] as { id: string };

    return {
      captured: 1,
      memory_id: row.id,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Context Capture] Database error:', errorMessage);

    return {
      captured: 0,
      error: `Database error: ${errorMessage}`,
    };
  }
}

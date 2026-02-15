/**
 * Database test helpers for isolation and cleanup.
 * @module tests/helpers/db
 */

import { Pool, type PoolConfig } from 'pg';
import { existsSync } from 'fs';

/**
 * Default PostgreSQL pool configuration for tests.
 * Uses environment variables with sensible local dev defaults.
 */
export function getPoolConfig(): PoolConfig {
  const defaultHost = existsSync('/.dockerenv') ? 'postgres' : 'localhost';

  return {
    host: process.env.PGHOST || defaultHost,
    port: parseInt(process.env.PGPORT || '5432', 10),
    user: process.env.PGUSER || 'openclaw',
    password: process.env.PGPASSWORD || 'openclaw',
    database: process.env.PGDATABASE || 'openclaw',
    max: 3,
  };
}

/**
 * Creates a new Pool instance with the default test configuration.
 * @returns A new Pool instance
 */
export function createTestPool(): Pool {
  return new Pool(getPoolConfig());
}

/**
 * Tables to truncate in correct order to respect foreign key constraints.
 * Listed in dependency order (children first, parents last).
 */
const APPLICATION_TABLES = [
  // FK children first
  'list_item',
  'list',
  'context_link',
  'context',
  'relationship',
  'work_item_label',
  'label',
  'memory_contact',
  'memory_relationship',
  'work_item_external_link',
  'work_item_communication',
  'work_item_contact',
  'work_item_attachment',
  'message_attachment',
  'memory_attachment',
  'external_message',
  'external_thread',
  'contact_endpoint',
  'work_item_dependency',
  'work_item_participant',
  'notification',
  'notification_preference',
  'work_item_comment_reaction',
  'work_item_comment',
  'user_presence',
  'calendar_event',
  'oauth_state',
  'oauth_connection',
  // Note/notebook tables (Epic #337)
  'note_work_item_reference',
  'note_version',
  'note_collaborator',
  'note_share',
  'notebook_share',
  'note',
  'notebook',
  // Skill Store (Epic #794)
  'skill_store_activity',
  'skill_store_schedule',
  'skill_store_item',
  // Agent identity (Issue #1287)
  'agent_identity_history',
  'agent_identity',
  // Entity links (no FKs, polymorphic references)
  'entity_link',
  // Dev sessions (Issue #1285)
  'dev_session',
  // Recipes (Issue #1278)
  'recipe_image',
  'recipe_step',
  'recipe_ingredient',
  'recipe',
  // Async/queue tables (no FKs today, but still want consistent cleanup)
  'webhook_outbox',
  'internal_job',
  // File storage
  'file_share',
  'file_attachment',
  // Embedding settings
  'embedding_usage',
  // Parents
  'memory',
  'work_item_memory',
  'work_item',
  'contact',
  'auth_magic_link',
  'auth_session',
] as const;

/**
 * Truncates all application tables to reset test state.
 * Uses TRUNCATE ... CASCADE to handle foreign keys properly.
 * Preserves schema_migrations and system tables.
 *
 * @param pool - The PostgreSQL pool to use for the truncation
 * @throws Error if truncation fails
 *
 * @example
 * ```ts
 * beforeEach(async () => {
 *   await truncateAllTables(pool);
 * });
 * ```
 */
/**
 * PostgreSQL SQLSTATE code for deadlock_detected.
 * @see https://www.postgresql.org/docs/current/errcodes-appendix.html
 */
const PG_DEADLOCK_DETECTED = '40P01';

export async function truncateAllTables(pool: Pool): Promise<void> {
  // Build a single TRUNCATE statement for efficiency
  // Filter to tables that actually exist to avoid errors on partial migrations
  const existingTables = await pool.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables
     WHERE schemaname = 'public'
     AND tablename = ANY($1::text[])`,
    [APPLICATION_TABLES],
  );

  const tablesToTruncate = existingTables.rows.map((r) => r.tablename);

  if (tablesToTruncate.length === 0) {
    return;
  }

  // TRUNCATE with CASCADE handles FK constraints
  // RESTART IDENTITY resets sequences (auto-increment counters)
  //
  // Retry with exponential backoff on deadlock: when running the full test
  // suite, server-side pools from app.inject() may still hold ACCESS SHARE
  // locks while TRUNCATE needs ACCESS EXCLUSIVE, causing transient deadlocks.
  const tableList = tablesToTruncate.map((t) => `"${t}"`).join(', ');
  const maxRetries = 3;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      await pool.query(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`);
      return;
    } catch (err: unknown) {
      const pgCode =
        err instanceof Error && 'code' in err
          ? (err as { code: string }).code
          : undefined;
      if (pgCode === PG_DEADLOCK_DETECTED && attempt < maxRetries - 1) {
        // Exponential backoff with jitter to avoid thundering herd
        const baseDelay = 100 * 2 ** attempt;
        const jitter = baseDelay * (0.75 + Math.random() * 0.5);
        await new Promise((r) => setTimeout(r, jitter));
        continue;
      }
      const context = `truncateAllTables failed after ${attempt + 1}/${maxRetries} attempt(s)`;
      throw new Error(context, { cause: err });
    }
  }
}

/**
 * Integration tests for Symphony seed data migration 144.
 * Epic #2186, Issue #2194 — Database Seeding (Tool Configs & System Prompts).
 *
 * Verifies:
 * - Tool configs are seeded into symphony_tool_config
 * - Symphony prompt templates are seeded into dev_prompt
 * - Seeding is idempotent (re-running does not duplicate or overwrite)
 * - Down migration removes seed data cleanly
 */
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestPool } from './helpers/db.ts';
import { runMigrate } from './helpers/migrate.ts';

describe('Symphony Seed Data Migration 144 (#2194)', () => {
  let pool: Pool;

  beforeAll(async () => {
    await runMigrate('up');
    pool = createTestPool();

    // Re-seed data in case previous test suites truncated the tables.
    // The seed migration (144) is already recorded in schema_migrations,
    // so runMigrate('up') is a no-op. We must re-apply the INSERT statements
    // directly to ensure the seed data exists for testing.
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const seedSql = readFileSync(
      resolve(import.meta.dirname ?? '.', '..', 'migrations', '144_symphony_seed_data.up.sql'),
      'utf-8',
    );
    await pool.query(seedSql);
  });

  afterAll(async () => {
    await pool.end();
  });

  // ─────────────────────────────────────────────────────────────
  // Tool configs
  // ─────────────────────────────────────────────────────────────
  describe('symphony_tool_config seeds', () => {
    it('seeds claude_code tool config', async () => {
      const res = await pool.query(
        `SELECT tool_name, command, verify_command, timeout_seconds
         FROM symphony_tool_config
         WHERE namespace = 'default' AND tool_name = 'claude_code'`,
      );
      expect(res.rows).toHaveLength(1);
      const row = res.rows[0] as {
        tool_name: string;
        command: string;
        verify_command: string;
        timeout_seconds: number;
      };
      expect(row.command).toBe('claude');
      expect(row.verify_command).toBe('claude --version');
      expect(row.timeout_seconds).toBe(1800);
    });

    it('seeds codex tool config', async () => {
      const res = await pool.query(
        `SELECT tool_name, command, verify_command, timeout_seconds
         FROM symphony_tool_config
         WHERE namespace = 'default' AND tool_name = 'codex'`,
      );
      expect(res.rows).toHaveLength(1);
      const row = res.rows[0] as {
        tool_name: string;
        command: string;
        verify_command: string;
        timeout_seconds: number;
      };
      expect(row.command).toBe('codex');
      expect(row.verify_command).toBe('codex --version');
      expect(row.timeout_seconds).toBe(600);
    });

    it('uses snake_case for tool_name identifiers', async () => {
      const res = await pool.query(
        `SELECT tool_name FROM symphony_tool_config
         WHERE namespace = 'default'
         ORDER BY tool_name`,
      );
      const names = res.rows.map((r) => (r as { tool_name: string }).tool_name);
      // Verify snake_case naming convention (no hyphens, no camelCase)
      for (const name of names) {
        expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Symphony prompt templates
  // ─────────────────────────────────────────────────────────────
  describe('dev_prompt Symphony template seeds', () => {
    const symphonyKeys = [
      'symphony_work_on_issue',
      'symphony_review_pr',
      'symphony_fix_ci',
      'symphony_rebase_and_retry',
    ];

    it('seeds all four Symphony prompt templates', async () => {
      const res = await pool.query(
        `SELECT prompt_key FROM dev_prompt
         WHERE namespace = 'default' AND is_system = true
           AND prompt_key LIKE 'symphony_%'
         ORDER BY prompt_key`,
      );
      const keys = res.rows.map((r) => (r as { prompt_key: string }).prompt_key);
      expect(keys).toEqual(symphonyKeys.sort());
    });

    it('marks all Symphony templates as system prompts', async () => {
      for (const key of symphonyKeys) {
        const res = await pool.query(
          `SELECT is_system, category FROM dev_prompt
           WHERE namespace = 'default' AND prompt_key = $1 AND deleted_at IS NULL`,
          [key],
        );
        expect(res.rows).toHaveLength(1);
        const row = res.rows[0] as { is_system: boolean; category: string };
        expect(row.is_system).toBe(true);
        expect(row.category).toBe('shipping');
      }
    });

    it('templates contain Symphony Handlebars variables', async () => {
      const res = await pool.query(
        `SELECT prompt_key, body FROM dev_prompt
         WHERE namespace = 'default' AND prompt_key = 'symphony_work_on_issue'`,
      );
      expect(res.rows).toHaveLength(1);
      const body = (res.rows[0] as { body: string }).body;
      // Verify key Symphony template variables are present
      expect(body).toContain('{{ issue_title }}');
      expect(body).toContain('{{ issue_body }}');
      expect(body).toContain('{{ branch_name }}');
      expect(body).toContain('{{ workspace_path }}');
      expect(body).toContain('{{ issue_acceptance_criteria }}');
    });

    it('body and default_body are identical for new seeds', async () => {
      for (const key of symphonyKeys) {
        const res = await pool.query(
          `SELECT body, default_body FROM dev_prompt
           WHERE namespace = 'default' AND prompt_key = $1`,
          [key],
        );
        expect(res.rows).toHaveLength(1);
        const row = res.rows[0] as { body: string; default_body: string };
        expect(row.body).toBe(row.default_body);
      }
    });

    it('uses snake_case for prompt_key identifiers', async () => {
      for (const key of symphonyKeys) {
        expect(key).toMatch(/^[a-z0-9][a-z0-9_]*$/);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Idempotency
  // ─────────────────────────────────────────────────────────────
  describe('idempotency', () => {
    it('re-running up migration does not create duplicates', async () => {
      // Count before
      const toolsBefore = await pool.query(
        `SELECT COUNT(*)::int as cnt FROM symphony_tool_config
         WHERE namespace = 'default' AND tool_name IN ('claude_code', 'codex')`,
      );
      const promptsBefore = await pool.query(
        `SELECT COUNT(*)::int as cnt FROM dev_prompt
         WHERE namespace = 'default' AND prompt_key LIKE 'symphony_%'`,
      );

      // Re-run migration (should be a no-op due to ON CONFLICT DO NOTHING)
      await runMigrate('up');

      // Count after
      const toolsAfter = await pool.query(
        `SELECT COUNT(*)::int as cnt FROM symphony_tool_config
         WHERE namespace = 'default' AND tool_name IN ('claude_code', 'codex')`,
      );
      const promptsAfter = await pool.query(
        `SELECT COUNT(*)::int as cnt FROM dev_prompt
         WHERE namespace = 'default' AND prompt_key LIKE 'symphony_%'`,
      );

      expect((toolsAfter.rows[0] as { cnt: number }).cnt).toBe(
        (toolsBefore.rows[0] as { cnt: number }).cnt,
      );
      expect((promptsAfter.rows[0] as { cnt: number }).cnt).toBe(
        (promptsBefore.rows[0] as { cnt: number }).cnt,
      );
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Down migration
  // ─────────────────────────────────────────────────────────────
  describe('down migration', () => {
    it('removes seed data when rolling back migration 144', async () => {
      // Roll back from the highest migration down through 144.
      // With migrations 145-147 present, we need to roll back more than 1.
      const highestRow = await pool.query<{ version: number }>(
        `SELECT version::int as version FROM schema_migrations ORDER BY version DESC LIMIT 1`,
      );
      const highest = highestRow.rows[0]?.version ?? 144;
      const stepsToRollback = highest - 144 + 1;
      await runMigrate('down', stepsToRollback);

      // Verify tool configs are removed
      const tools = await pool.query(
        `SELECT COUNT(*)::int as cnt FROM symphony_tool_config
         WHERE namespace = 'default' AND tool_name IN ('claude_code', 'codex')`,
      );
      expect((tools.rows[0] as { cnt: number }).cnt).toBe(0);

      // Verify prompt templates are removed
      const prompts = await pool.query(
        `SELECT COUNT(*)::int as cnt FROM dev_prompt
         WHERE namespace = 'default' AND prompt_key LIKE 'symphony_%'`,
      );
      expect((prompts.rows[0] as { cnt: number }).cnt).toBe(0);

      // Re-apply so other tests are not affected
      await runMigrate('up');
    });
  });
});

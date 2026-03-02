/**
 * Dev Prompt CRUD service (Epic #2011, Issue #2014).
 *
 * Provides database operations for the dev_prompt table.
 */
import type { Pool } from 'pg';

/** A dev prompt row returned from queries. */
export interface DevPrompt {
  id: string;
  namespace: string;
  prompt_key: string;
  category: string;
  is_system: boolean;
  title: string;
  description: string;
  body: string;
  default_body: string;
  sort_order: number;
  is_active: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Input for creating a new dev prompt. */
export interface DevPromptCreateInput {
  namespace: string;
  prompt_key: string;
  category?: string;
  title: string;
  description?: string;
  body: string;
}

/** Input for updating an existing dev prompt. */
export interface DevPromptUpdateInput {
  title?: string;
  description?: string;
  body?: string;
  category?: string;
  is_active?: boolean;
  sort_order?: number;
}

/** Filter options for listing dev prompts. */
export interface DevPromptListOptions {
  queryNamespaces?: string[];
  category?: string;
  is_system?: boolean;
  search?: string;
  include_inactive?: boolean;
  limit: number;
  offset: number;
}

/** Paginated list result. */
export interface DevPromptListResult {
  total: number;
  limit: number;
  offset: number;
  items: DevPrompt[];
}

const VALID_CATEGORIES = ['identification', 'creation', 'triage', 'shipping', 'general', 'custom'] as const;
const PROMPT_KEY_PATTERN = /^[a-z0-9][a-z0-9_]*$/;

const COLUMNS = `id::text as id, namespace, prompt_key, category, is_system, title, description, body, default_body, sort_order, is_active, deleted_at, created_at, updated_at`;

/** Check if a category value is valid. */
export function isValidCategory(category: string): boolean {
  return (VALID_CATEGORIES as readonly string[]).includes(category);
}

/** Check if a prompt_key is valid (snake_case, starts with alphanumeric, max 100 chars). */
export function isValidPromptKey(key: string): boolean {
  return PROMPT_KEY_PATTERN.test(key) && key.length <= 100;
}

/** Create a new user-defined dev prompt. */
export async function createDevPrompt(
  pool: Pool,
  input: DevPromptCreateInput,
): Promise<DevPrompt> {
  const { namespace, prompt_key, category, title, description, body } = input;

  const result = await pool.query(
    `INSERT INTO dev_prompt (namespace, prompt_key, category, is_system, title, description, body, default_body)
     VALUES ($1, $2, $3, false, $4, $5, $6, '')
     RETURNING ${COLUMNS}`,
    [
      namespace,
      prompt_key,
      category ?? 'custom',
      title.trim(),
      description ?? '',
      body,
    ],
  );

  return result.rows[0] as DevPrompt;
}

/** List dev prompts with optional filtering and pagination. */
export async function listDevPrompts(
  pool: Pool,
  options: DevPromptListOptions,
): Promise<DevPromptListResult> {
  const conditions: string[] = [];
  const params: (string | number | boolean | string[])[] = [];
  let paramIndex = 1;

  // Namespace scoping: show prompts in user's namespaces + system prompts in 'default'
  if (options.queryNamespaces) {
    conditions.push(
      `(namespace = ANY($${paramIndex}::text[]) OR (namespace = 'default' AND is_system = true))`,
    );
    params.push(options.queryNamespaces);
    paramIndex++;
  }

  if (!options.include_inactive) {
    conditions.push('is_active = true AND deleted_at IS NULL');
  }

  if (options.category) {
    conditions.push(`category = $${paramIndex}`);
    params.push(options.category);
    paramIndex++;
  }

  if (options.is_system !== undefined) {
    conditions.push(`is_system = $${paramIndex}`);
    params.push(options.is_system);
    paramIndex++;
  }

  if (options.search) {
    conditions.push(
      `(title ILIKE $${paramIndex} OR description ILIKE $${paramIndex} OR prompt_key ILIKE $${paramIndex})`,
    );
    params.push(`%${options.search}%`);
    paramIndex++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countResult = await pool.query(
    `SELECT COUNT(*) as total FROM dev_prompt ${whereClause}`,
    params,
  );
  const total = parseInt((countResult.rows[0] as { total: string }).total, 10);

  params.push(options.limit);
  const limitIdx = paramIndex++;
  params.push(options.offset);
  const offsetIdx = paramIndex++;

  const result = await pool.query(
    `SELECT ${COLUMNS}
     FROM dev_prompt ${whereClause}
     ORDER BY sort_order ASC, created_at DESC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    params,
  );

  return {
    total,
    limit: options.limit,
    offset: options.offset,
    items: result.rows as DevPrompt[],
  };
}

/** Get a single dev prompt by ID, optionally scoped to namespaces. */
export async function getDevPrompt(
  pool: Pool,
  id: string,
  queryNamespaces?: string[],
): Promise<DevPrompt | null> {
  if (queryNamespaces) {
    const result = await pool.query(
      `SELECT ${COLUMNS} FROM dev_prompt
       WHERE id = $1 AND (namespace = ANY($2::text[]) OR (namespace = 'default' AND is_system = true))`,
      [id, queryNamespaces],
    );
    return (result.rows[0] as DevPrompt) ?? null;
  }
  const result = await pool.query(
    `SELECT ${COLUMNS} FROM dev_prompt WHERE id = $1`,
    [id],
  );
  return (result.rows[0] as DevPrompt) ?? null;
}

/** Get a dev prompt by key within a namespace, or fall back to default namespace system prompts. */
export async function getDevPromptByKey(
  pool: Pool,
  key: string,
  queryNamespaces?: string[],
): Promise<DevPrompt | null> {
  if (queryNamespaces) {
    // First try the user's namespaces, then fall back to default namespace system prompts
    const result = await pool.query(
      `SELECT ${COLUMNS} FROM dev_prompt
       WHERE prompt_key = $1 AND deleted_at IS NULL AND is_active = true
         AND (namespace = ANY($2::text[]) OR (namespace = 'default' AND is_system = true))
       ORDER BY CASE WHEN namespace = ANY($2::text[]) THEN 0 ELSE 1 END
       LIMIT 1`,
      [key, queryNamespaces],
    );
    return (result.rows[0] as DevPrompt) ?? null;
  }
  const result = await pool.query(
    `SELECT ${COLUMNS} FROM dev_prompt
     WHERE prompt_key = $1 AND deleted_at IS NULL AND is_active = true
     LIMIT 1`,
    [key],
  );
  return (result.rows[0] as DevPrompt) ?? null;
}

/**
 * Update a dev prompt. For system prompts, only body and is_active can be changed.
 * Returns null if not found or access denied.
 */
export async function updateDevPrompt(
  pool: Pool,
  id: string,
  input: DevPromptUpdateInput,
  queryNamespaces?: string[],
): Promise<DevPrompt | null> {
  // Check existence and get current state
  const existing = queryNamespaces
    ? await pool.query(
        `SELECT id, namespace, is_system FROM dev_prompt
         WHERE id = $1 AND deleted_at IS NULL
           AND (namespace = ANY($2::text[]) OR (namespace = 'default' AND is_system = true))`,
        [id, queryNamespaces],
      )
    : await pool.query(
        'SELECT id, namespace, is_system FROM dev_prompt WHERE id = $1 AND deleted_at IS NULL',
        [id],
      );

  if (existing.rows.length === 0) return null;
  const row = existing.rows[0] as { id: string; namespace: string; is_system: boolean };

  const updates: string[] = [];
  const values: (string | boolean | number)[] = [];
  let paramIndex = 1;

  // System prompts: only body and is_active can be changed
  if (row.is_system) {
    if (input.body !== undefined) {
      updates.push(`body = $${paramIndex}`);
      values.push(input.body);
      paramIndex++;
    }
    if (input.is_active !== undefined) {
      updates.push(`is_active = $${paramIndex}`);
      values.push(input.is_active);
      paramIndex++;
    }
    // Ignore other fields silently for system prompts
  } else {
    // User prompts: all fields editable
    if (input.title !== undefined) {
      updates.push(`title = $${paramIndex}`);
      values.push(input.title.trim());
      paramIndex++;
    }
    if (input.description !== undefined) {
      updates.push(`description = $${paramIndex}`);
      values.push(input.description);
      paramIndex++;
    }
    if (input.body !== undefined) {
      updates.push(`body = $${paramIndex}`);
      values.push(input.body);
      paramIndex++;
    }
    if (input.category !== undefined) {
      updates.push(`category = $${paramIndex}`);
      values.push(input.category);
      paramIndex++;
    }
    if (input.is_active !== undefined) {
      updates.push(`is_active = $${paramIndex}`);
      values.push(input.is_active);
      paramIndex++;
    }
    if (input.sort_order !== undefined) {
      updates.push(`sort_order = $${paramIndex}`);
      values.push(input.sort_order);
      paramIndex++;
    }
  }

  if (updates.length === 0) return null;

  values.push(id);
  const result = await pool.query(
    `UPDATE dev_prompt SET ${updates.join(', ')} WHERE id = $${paramIndex}
     RETURNING ${COLUMNS}`,
    values,
  );

  return (result.rows[0] as DevPrompt) ?? null;
}

/**
 * Soft-delete a dev prompt. System prompts cannot be deleted (returns false).
 */
export async function deleteDevPrompt(
  pool: Pool,
  id: string,
  queryNamespaces?: string[],
): Promise<{ deleted: boolean; isSystem?: boolean }> {
  // Check if it's a system prompt
  const check = queryNamespaces
    ? await pool.query(
        `SELECT is_system FROM dev_prompt
         WHERE id = $1 AND deleted_at IS NULL
           AND (namespace = ANY($2::text[]) OR (namespace = 'default' AND is_system = true))`,
        [id, queryNamespaces],
      )
    : await pool.query(
        'SELECT is_system FROM dev_prompt WHERE id = $1 AND deleted_at IS NULL',
        [id],
      );

  if (check.rows.length === 0) return { deleted: false };

  const isSystem = (check.rows[0] as { is_system: boolean }).is_system;
  if (isSystem) return { deleted: false, isSystem: true };

  const result = queryNamespaces
    ? await pool.query(
        `UPDATE dev_prompt SET deleted_at = now(), is_active = false
         WHERE id = $1 AND deleted_at IS NULL AND namespace = ANY($2::text[])
         RETURNING id`,
        [id, queryNamespaces],
      )
    : await pool.query(
        `UPDATE dev_prompt SET deleted_at = now(), is_active = false
         WHERE id = $1 AND deleted_at IS NULL
         RETURNING id`,
        [id],
      );

  return { deleted: result.rows.length > 0 };
}

/**
 * Reset a system prompt's body to its default_body.
 * Returns null if not found or not a system prompt.
 */
export async function resetDevPrompt(
  pool: Pool,
  id: string,
  queryNamespaces?: string[],
): Promise<DevPrompt | null> {
  const check = queryNamespaces
    ? await pool.query(
        `SELECT id, is_system FROM dev_prompt
         WHERE id = $1 AND deleted_at IS NULL
           AND (namespace = ANY($2::text[]) OR (namespace = 'default' AND is_system = true))`,
        [id, queryNamespaces],
      )
    : await pool.query(
        'SELECT id, is_system FROM dev_prompt WHERE id = $1 AND deleted_at IS NULL',
        [id],
      );

  if (check.rows.length === 0) return null;
  if (!(check.rows[0] as { is_system: boolean }).is_system) return null;

  const result = await pool.query(
    `UPDATE dev_prompt SET body = default_body WHERE id = $1
     RETURNING ${COLUMNS}`,
    [id],
  );

  return (result.rows[0] as DevPrompt) ?? null;
}

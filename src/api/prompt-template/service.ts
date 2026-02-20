import type { Pool } from 'pg';

export interface PromptTemplate {
  id: string;
  namespace: string;
  label: string;
  content: string;
  channel_type: string;
  is_default: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PromptTemplateCreateInput {
  label: string;
  content: string;
  channel_type: string;
  is_default?: boolean;
  namespace: string;
}

export interface PromptTemplateUpdateInput {
  label?: string;
  content?: string;
  channel_type?: string;
  is_default?: boolean;
  is_active?: boolean;
}

export interface PromptTemplateListOptions {
  channel_type?: string;
  include_inactive?: boolean;
  search?: string;
  limit: number;
  offset: number;
  queryNamespaces?: string[];
}

export interface PromptTemplateListResult {
  total: number;
  limit: number;
  offset: number;
  items: PromptTemplate[];
}

const VALID_CHANNEL_TYPES = ['sms', 'email', 'ha_observation', 'general'];

const COLUMNS = `id::text as id, namespace, label, content, channel_type, is_default, is_active, created_at, updated_at`;

export function isValidChannelType(type: string): boolean {
  return VALID_CHANNEL_TYPES.includes(type);
}

/**
 * Create a prompt template. When is_default is true, unsets any existing
 * active default for the same (namespace, channel_type).
 */
export async function createPromptTemplate(
  pool: Pool,
  input: PromptTemplateCreateInput,
): Promise<PromptTemplate> {
  const { label, content, channel_type, is_default, namespace } = input;

  if (is_default) {
    await pool.query(
      `UPDATE prompt_template SET is_default = false
       WHERE namespace = $1 AND channel_type = $2 AND is_default = true AND is_active = true`,
      [namespace, channel_type],
    );
  }

  const result = await pool.query(
    `INSERT INTO prompt_template (label, content, channel_type, is_default, namespace)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ${COLUMNS}`,
    [label.trim(), content, channel_type, is_default ?? false, namespace],
  );

  return result.rows[0] as PromptTemplate;
}

/**
 * List prompt templates with optional filtering.
 */
export async function listPromptTemplates(
  pool: Pool,
  options: PromptTemplateListOptions,
): Promise<PromptTemplateListResult> {
  const conditions: string[] = [];
  const params: (string | number | string[])[] = [];
  let paramIndex = 1;

  if (options.queryNamespaces) {
    conditions.push(`namespace = ANY($${paramIndex}::text[])`);
    params.push(options.queryNamespaces);
    paramIndex++;
  }

  if (!options.include_inactive) {
    conditions.push('is_active = true');
  }

  if (options.channel_type) {
    conditions.push(`channel_type = $${paramIndex}`);
    params.push(options.channel_type);
    paramIndex++;
  }

  if (options.search) {
    conditions.push(`(label ILIKE $${paramIndex} OR content ILIKE $${paramIndex})`);
    params.push(`%${options.search}%`);
    paramIndex++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countResult = await pool.query(
    `SELECT COUNT(*) as total FROM prompt_template ${whereClause}`,
    params,
  );
  const total = parseInt((countResult.rows[0] as { total: string }).total, 10);

  params.push(options.limit);
  const limitIdx = paramIndex++;
  params.push(options.offset);
  const offsetIdx = paramIndex++;

  const result = await pool.query(
    `SELECT ${COLUMNS}
     FROM prompt_template ${whereClause}
     ORDER BY created_at DESC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    params,
  );

  return {
    total,
    limit: options.limit,
    offset: options.offset,
    items: result.rows as PromptTemplate[],
  };
}

/**
 * Get a single prompt template by ID, optionally scoped to namespaces.
 */
export async function getPromptTemplate(
  pool: Pool,
  id: string,
  queryNamespaces?: string[],
): Promise<PromptTemplate | null> {
  if (queryNamespaces) {
    const result = await pool.query(
      `SELECT ${COLUMNS} FROM prompt_template WHERE id = $1 AND namespace = ANY($2::text[])`,
      [id, queryNamespaces],
    );
    return (result.rows[0] as PromptTemplate) ?? null;
  }
  const result = await pool.query(
    `SELECT ${COLUMNS} FROM prompt_template WHERE id = $1`,
    [id],
  );
  return (result.rows[0] as PromptTemplate) ?? null;
}

/**
 * Update a prompt template. When is_default is set to true, unsets any
 * existing active default for the same (namespace, channel_type).
 */
export async function updatePromptTemplate(
  pool: Pool,
  id: string,
  input: PromptTemplateUpdateInput,
  queryNamespaces?: string[],
): Promise<PromptTemplate | null> {
  // Check existence (with optional namespace scoping)
  const existing = queryNamespaces
    ? await pool.query(
        'SELECT id, namespace, channel_type FROM prompt_template WHERE id = $1 AND namespace = ANY($2::text[])',
        [id, queryNamespaces],
      )
    : await pool.query(
        'SELECT id, namespace, channel_type FROM prompt_template WHERE id = $1',
        [id],
      );
  if (existing.rows.length === 0) return null;

  const row = existing.rows[0] as { id: string; namespace: string; channel_type: string };

  const updates: string[] = [];
  const values: (string | boolean)[] = [];
  let paramIndex = 1;

  if (input.label !== undefined) {
    updates.push(`label = $${paramIndex}`);
    values.push(input.label.trim());
    paramIndex++;
  }
  if (input.content !== undefined) {
    updates.push(`content = $${paramIndex}`);
    values.push(input.content);
    paramIndex++;
  }
  if (input.channel_type !== undefined) {
    updates.push(`channel_type = $${paramIndex}`);
    values.push(input.channel_type);
    paramIndex++;
  }
  if (input.is_active !== undefined) {
    updates.push(`is_active = $${paramIndex}`);
    values.push(input.is_active);
    paramIndex++;
  }
  if (input.is_default !== undefined) {
    updates.push(`is_default = $${paramIndex}`);
    values.push(input.is_default);
    paramIndex++;

    // If setting as default, unset existing default
    if (input.is_default) {
      const effectiveChannel = input.channel_type ?? row.channel_type;
      await pool.query(
        `UPDATE prompt_template SET is_default = false
         WHERE namespace = $1 AND channel_type = $2 AND is_default = true AND is_active = true AND id != $3`,
        [row.namespace, effectiveChannel, id],
      );
    }
  }

  if (updates.length === 0) return null;

  values.push(id);
  const result = await pool.query(
    `UPDATE prompt_template SET ${updates.join(', ')} WHERE id = $${paramIndex}
     RETURNING ${COLUMNS}`,
    values,
  );

  return (result.rows[0] as PromptTemplate) ?? null;
}

/**
 * Soft-delete a prompt template by setting is_active = false.
 */
export async function deletePromptTemplate(
  pool: Pool,
  id: string,
  queryNamespaces?: string[],
): Promise<boolean> {
  const result = queryNamespaces
    ? await pool.query(
        `UPDATE prompt_template SET is_active = false WHERE id = $1 AND is_active = true AND namespace = ANY($2::text[]) RETURNING id`,
        [id, queryNamespaces],
      )
    : await pool.query(
        `UPDATE prompt_template SET is_active = false WHERE id = $1 AND is_active = true RETURNING id`,
        [id],
      );
  return result.rows.length > 0;
}

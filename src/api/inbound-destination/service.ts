import type { Pool } from 'pg';

export interface InboundDestination {
  id: string;
  namespace: string;
  address: string;
  channel_type: string;
  display_name: string | null;
  agent_id: string | null;
  prompt_template_id: string | null;
  context_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface UpsertInboundDestinationInput {
  address: string;
  channelType: 'sms' | 'email';
  displayName?: string;
  namespace?: string;
}

export interface InboundDestinationUpdateInput {
  display_name?: string;
  agent_id?: string | null;
  prompt_template_id?: string | null;
  context_id?: string | null;
  is_active?: boolean;
}

export interface InboundDestinationListOptions {
  channel_type?: string;
  search?: string;
  include_inactive?: boolean;
  limit: number;
  offset: number;
  queryNamespaces?: string[];
}

export interface InboundDestinationListResult {
  total: number;
  limit: number;
  offset: number;
  items: InboundDestination[];
}

const COLUMNS = `id::text as id, namespace, address, channel_type, display_name, agent_id, prompt_template_id::text as prompt_template_id, context_id::text as context_id, is_active, created_at, updated_at`;

/**
 * Upsert an inbound destination on message receipt.
 * Uses INSERT ... ON CONFLICT DO NOTHING so the first message creates the row
 * and subsequent messages are no-ops.
 */
export async function upsertInboundDestination(
  pool: Pool,
  input: UpsertInboundDestinationInput,
): Promise<InboundDestination | null> {
  const address = normalizeAddress(input.address, input.channelType);
  const namespace = input.namespace ?? 'default';

  const result = await pool.query(
    `INSERT INTO inbound_destination (address, channel_type, display_name, namespace)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (address, channel_type) DO NOTHING
     RETURNING ${COLUMNS}`,
    [address, input.channelType, input.displayName ?? null, namespace],
  );

  return (result.rows[0] as InboundDestination) ?? null;
}

/**
 * List inbound destinations with optional filtering.
 */
export async function listInboundDestinations(
  pool: Pool,
  options: InboundDestinationListOptions,
): Promise<InboundDestinationListResult> {
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
    conditions.push(`(address ILIKE $${paramIndex} OR display_name ILIKE $${paramIndex})`);
    params.push(`%${options.search}%`);
    paramIndex++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countResult = await pool.query(
    `SELECT COUNT(*) as total FROM inbound_destination ${whereClause}`,
    params,
  );
  const total = parseInt((countResult.rows[0] as { total: string }).total, 10);

  params.push(options.limit);
  const limitIdx = paramIndex++;
  params.push(options.offset);
  const offsetIdx = paramIndex++;

  const result = await pool.query(
    `SELECT ${COLUMNS}
     FROM inbound_destination ${whereClause}
     ORDER BY created_at DESC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    params,
  );

  return {
    total,
    limit: options.limit,
    offset: options.offset,
    items: result.rows as InboundDestination[],
  };
}

/**
 * Get a single inbound destination by ID, optionally scoped to namespaces.
 */
export async function getInboundDestination(
  pool: Pool,
  id: string,
  queryNamespaces?: string[],
): Promise<InboundDestination | null> {
  if (queryNamespaces) {
    const result = await pool.query(
      `SELECT ${COLUMNS} FROM inbound_destination WHERE id = $1 AND namespace = ANY($2::text[])`,
      [id, queryNamespaces],
    );
    return (result.rows[0] as InboundDestination) ?? null;
  }
  const result = await pool.query(
    `SELECT ${COLUMNS} FROM inbound_destination WHERE id = $1`,
    [id],
  );
  return (result.rows[0] as InboundDestination) ?? null;
}

/**
 * Update routing overrides for an inbound destination.
 */
export async function updateInboundDestination(
  pool: Pool,
  id: string,
  input: InboundDestinationUpdateInput,
  queryNamespaces?: string[],
): Promise<InboundDestination | null> {
  const existing = queryNamespaces
    ? await pool.query(
        'SELECT id FROM inbound_destination WHERE id = $1 AND namespace = ANY($2::text[])',
        [id, queryNamespaces],
      )
    : await pool.query(
        'SELECT id FROM inbound_destination WHERE id = $1',
        [id],
      );
  if (existing.rows.length === 0) return null;

  const updates: string[] = [];
  const values: (string | boolean | null)[] = [];
  let paramIndex = 1;

  if (input.display_name !== undefined) {
    updates.push(`display_name = $${paramIndex}`);
    values.push(input.display_name);
    paramIndex++;
  }
  if (input.agent_id !== undefined) {
    updates.push(`agent_id = $${paramIndex}`);
    values.push(input.agent_id);
    paramIndex++;
  }
  if (input.prompt_template_id !== undefined) {
    updates.push(`prompt_template_id = $${paramIndex}`);
    values.push(input.prompt_template_id);
    paramIndex++;
  }
  if (input.context_id !== undefined) {
    updates.push(`context_id = $${paramIndex}`);
    values.push(input.context_id);
    paramIndex++;
  }
  if (input.is_active !== undefined) {
    updates.push(`is_active = $${paramIndex}`);
    values.push(input.is_active);
    paramIndex++;
  }

  if (updates.length === 0) return null;

  values.push(id);
  const result = await pool.query(
    `UPDATE inbound_destination SET ${updates.join(', ')} WHERE id = $${paramIndex}
     RETURNING ${COLUMNS}`,
    values,
  );

  return (result.rows[0] as InboundDestination) ?? null;
}

/**
 * Soft-delete an inbound destination by setting is_active = false.
 */
export async function deleteInboundDestination(
  pool: Pool,
  id: string,
  queryNamespaces?: string[],
): Promise<boolean> {
  const result = queryNamespaces
    ? await pool.query(
        `UPDATE inbound_destination SET is_active = false WHERE id = $1 AND is_active = true AND namespace = ANY($2::text[]) RETURNING id`,
        [id, queryNamespaces],
      )
    : await pool.query(
        `UPDATE inbound_destination SET is_active = false WHERE id = $1 AND is_active = true RETURNING id`,
        [id],
      );
  return result.rows.length > 0;
}

/**
 * Normalize an address based on channel type.
 * - SMS: expect E.164 format (pass through as-is, callers should normalize)
 * - Email: lowercase
 */
function normalizeAddress(address: string, channelType: string): string {
  if (channelType === 'email') {
    return address.toLowerCase().trim();
  }
  return address.trim();
}

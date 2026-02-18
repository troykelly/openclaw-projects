/**
 * Notebook sharing service.
 * Part of Epic #337, Issue #348
 *
 * [#1412] All interface properties and JSON-serialised keys use snake_case
 * to match the project-wide API convention.
 */

import type { Pool } from 'pg';

/** Share permission level */
export type SharePermission = 'read' | 'read_write';

/** User share record */
export interface NotebookUserShare {
  id: string;
  notebook_id: string;
  type: 'user';
  shared_with_email: string;
  permission: SharePermission;
  expires_at: Date | null;
  created_by_email: string;
  created_at: Date;
  last_accessed_at: Date | null;
}

/** Link share record */
export interface NotebookLinkShare {
  id: string;
  notebook_id: string;
  type: 'link';
  token: string;
  permission: SharePermission;
  expires_at: Date | null;
  created_by_email: string;
  created_at: Date;
  last_accessed_at: Date | null;
}

/** Union of share types */
export type NotebookShare = NotebookUserShare | NotebookLinkShare;

/** Input for creating a user share */
export interface CreateUserShareInput {
  email: string;
  permission?: SharePermission;
  expires_at?: Date | string | null;
}

/** Input for creating a link share */
export interface CreateLinkShareInput {
  permission?: SharePermission;
  expires_at?: Date | string | null;
}

/** Input for updating a share */
export interface UpdateShareInput {
  permission?: SharePermission;
  expires_at?: Date | string | null;
}

/** Result of listing shares */
export interface ListSharesResult {
  notebook_id: string;
  shares: NotebookShare[];
}

/** Result of accessing via share link */
export interface SharedNotebookAccess {
  notebook: {
    id: string;
    name: string;
    description: string | null;
    updated_at: Date;
  };
  notes: Array<{
    id: string;
    title: string;
    updated_at: Date;
  }>;
  permission: SharePermission;
  shared_by: string;
}

/** Shared with me entry */
export interface SharedWithMeEntry {
  id: string;
  name: string;
  shared_by_email: string;
  permission: SharePermission;
  shared_at: Date;
}

/**
 * Check if user owns notebook
 */
async function userOwnsNotebook(pool: Pool, notebook_id: string, user_email: string): Promise<boolean> {
  const result = await pool.query('SELECT user_email FROM notebook WHERE id = $1 AND deleted_at IS NULL', [notebook_id]);
  return result.rows[0]?.user_email === user_email;
}

/**
 * Maps database row to NotebookUserShare
 */
function mapRowToUserShare(row: Record<string, unknown>): NotebookUserShare {
  return {
    id: row.id as string,
    notebook_id: row.notebook_id as string,
    type: 'user',
    shared_with_email: row.shared_with_email as string,
    permission: row.permission as SharePermission,
    expires_at: row.expires_at ? new Date(row.expires_at as string) : null,
    created_by_email: row.created_by_email as string,
    created_at: new Date(row.created_at as string),
    last_accessed_at: row.last_accessed_at ? new Date(row.last_accessed_at as string) : null,
  };
}

/**
 * Maps database row to NotebookLinkShare
 */
function mapRowToLinkShare(row: Record<string, unknown>): NotebookLinkShare {
  return {
    id: row.id as string,
    notebook_id: row.notebook_id as string,
    type: 'link',
    token: row.share_link_token as string,
    permission: row.permission as SharePermission,
    expires_at: row.expires_at ? new Date(row.expires_at as string) : null,
    created_by_email: row.created_by_email as string,
    created_at: new Date(row.created_at as string),
    last_accessed_at: row.last_accessed_at ? new Date(row.last_accessed_at as string) : null,
  };
}

/**
 * Maps database row to NotebookShare (determines type)
 */
function mapRowToShare(row: Record<string, unknown>): NotebookShare {
  if (row.shared_with_email) {
    return mapRowToUserShare(row);
  }
  return mapRowToLinkShare(row);
}

/**
 * Creates a share with a specific user
 */
export async function createUserShare(pool: Pool, notebook_id: string, input: CreateUserShareInput, user_email: string): Promise<NotebookUserShare | null> {
  // Check ownership
  const isOwner = await userOwnsNotebook(pool, notebook_id, user_email);
  if (!isOwner) {
    const exists = await pool.query('SELECT id FROM notebook WHERE id = $1 AND deleted_at IS NULL', [notebook_id]);
    if (exists.rows.length === 0) {
      return null; // 404
    }
    throw new Error('FORBIDDEN');
  }

  // Check if already shared with this user
  const existingShare = await pool.query('SELECT id FROM notebook_share WHERE notebook_id = $1 AND shared_with_email = $2', [notebook_id, input.email]);
  if (existingShare.rows.length > 0) {
    throw new Error('ALREADY_SHARED');
  }

  // Parse expires_at
  const expires_at = input.expires_at ? (typeof input.expires_at === 'string' ? new Date(input.expires_at) : input.expires_at) : null;

  const result = await pool.query(
    `INSERT INTO notebook_share (
      notebook_id, shared_with_email, permission, expires_at, created_by_email
    ) VALUES ($1, $2, $3, $4, $5)
    RETURNING
      id::text, notebook_id::text, shared_with_email, permission,
      expires_at, created_by_email, created_at, last_accessed_at`,
    [notebook_id, input.email, input.permission ?? 'read', expires_at, user_email],
  );

  return mapRowToUserShare(result.rows[0]);
}

/**
 * Creates a share link for a notebook
 */
export async function createLinkShare(
  pool: Pool,
  notebook_id: string,
  input: CreateLinkShareInput,
  user_email: string,
): Promise<(NotebookLinkShare & { url: string }) | null> {
  // Check ownership
  const isOwner = await userOwnsNotebook(pool, notebook_id, user_email);
  if (!isOwner) {
    const exists = await pool.query('SELECT id FROM notebook WHERE id = $1 AND deleted_at IS NULL', [notebook_id]);
    if (exists.rows.length === 0) {
      return null; // 404
    }
    throw new Error('FORBIDDEN');
  }

  // Parse expires_at
  const expires_at = input.expires_at ? (typeof input.expires_at === 'string' ? new Date(input.expires_at) : input.expires_at) : null;

  // Generate token
  const tokenResult = await pool.query('SELECT generate_share_token() as token');
  const token = tokenResult.rows[0].token as string;

  const result = await pool.query(
    `INSERT INTO notebook_share (
      notebook_id, share_link_token, permission, expires_at, created_by_email
    ) VALUES ($1, $2, $3, $4, $5)
    RETURNING
      id::text, notebook_id::text, share_link_token, permission,
      expires_at, created_by_email, created_at, last_accessed_at`,
    [notebook_id, token, input.permission ?? 'read', expires_at, user_email],
  );

  const share = mapRowToLinkShare(result.rows[0]);
  const baseUrl = process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000';

  return {
    ...share,
    url: `${baseUrl}/shared/notebooks/${token}`,
  };
}

/**
 * Lists all shares for a notebook
 */
export async function listShares(pool: Pool, notebook_id: string, user_email: string): Promise<ListSharesResult | null> {
  // Check ownership
  const isOwner = await userOwnsNotebook(pool, notebook_id, user_email);
  if (!isOwner) {
    const exists = await pool.query('SELECT id FROM notebook WHERE id = $1 AND deleted_at IS NULL', [notebook_id]);
    if (exists.rows.length === 0) {
      return null; // 404
    }
    throw new Error('FORBIDDEN');
  }

  const result = await pool.query(
    `SELECT
      id::text, notebook_id::text, shared_with_email, share_link_token, permission,
      expires_at, created_by_email, created_at, last_accessed_at
    FROM notebook_share
    WHERE notebook_id = $1
    ORDER BY created_at DESC`,
    [notebook_id],
  );

  return {
    notebook_id: notebook_id,
    shares: result.rows.map(mapRowToShare),
  };
}

/**
 * Updates a share's permission or expiration
 */
export async function updateShare(pool: Pool, notebook_id: string, shareId: string, input: UpdateShareInput, user_email: string): Promise<NotebookShare | null> {
  // Check ownership
  const isOwner = await userOwnsNotebook(pool, notebook_id, user_email);
  if (!isOwner) {
    const exists = await pool.query('SELECT id FROM notebook WHERE id = $1 AND deleted_at IS NULL', [notebook_id]);
    if (exists.rows.length === 0) {
      return null; // 404
    }
    throw new Error('FORBIDDEN');
  }

  // Check share exists for this notebook
  const existingShare = await pool.query('SELECT id FROM notebook_share WHERE id = $1 AND notebook_id = $2', [shareId, notebook_id]);
  if (existingShare.rows.length === 0) {
    throw new Error('SHARE_NOT_FOUND');
  }

  // Build update
  const updates: string[] = [];
  const params: (string | Date | null)[] = [];
  let paramIndex = 1;

  if (input.permission !== undefined) {
    updates.push(`permission = $${paramIndex}`);
    params.push(input.permission);
    paramIndex++;
  }

  if (input.expires_at !== undefined) {
    updates.push(`expires_at = $${paramIndex}`);
    const expires_at = input.expires_at ? (typeof input.expires_at === 'string' ? new Date(input.expires_at) : input.expires_at) : null;
    params.push(expires_at);
    paramIndex++;
  }

  if (updates.length === 0) {
    // Nothing to update, return existing share
    const result = await pool.query(
      `SELECT
        id::text, notebook_id::text, shared_with_email, share_link_token, permission,
        expires_at, created_by_email, created_at, last_accessed_at
      FROM notebook_share WHERE id = $1`,
      [shareId],
    );
    return mapRowToShare(result.rows[0]);
  }

  params.push(shareId);

  const result = await pool.query(
    `UPDATE notebook_share
     SET ${updates.join(', ')}
     WHERE id = $${paramIndex}
     RETURNING
       id::text, notebook_id::text, shared_with_email, share_link_token, permission,
       expires_at, created_by_email, created_at, last_accessed_at`,
    params,
  );

  return mapRowToShare(result.rows[0]);
}

/**
 * Revokes a share
 */
export async function revokeShare(pool: Pool, notebook_id: string, shareId: string, user_email: string): Promise<boolean> {
  // Check ownership
  const isOwner = await userOwnsNotebook(pool, notebook_id, user_email);
  if (!isOwner) {
    const exists = await pool.query('SELECT id FROM notebook WHERE id = $1 AND deleted_at IS NULL', [notebook_id]);
    if (exists.rows.length === 0) {
      throw new Error('NOTEBOOK_NOT_FOUND');
    }
    throw new Error('FORBIDDEN');
  }

  const result = await pool.query('DELETE FROM notebook_share WHERE id = $1 AND notebook_id = $2 RETURNING id', [shareId, notebook_id]);

  if (result.rows.length === 0) {
    throw new Error('SHARE_NOT_FOUND');
  }

  return true;
}

/**
 * Accesses a notebook via share link token
 */
export async function accessSharedNotebook(pool: Pool, token: string): Promise<SharedNotebookAccess | null> {
  // Find the share
  const shareResult = await pool.query(
    `SELECT nbs.notebook_id, nbs.permission, nbs.expires_at
     FROM notebook_share nbs
     WHERE nbs.share_link_token = $1`,
    [token],
  );

  if (shareResult.rows.length === 0) {
    return null; // 404
  }

  const share = shareResult.rows[0];

  // Check expiration
  if (share.expires_at && new Date(share.expires_at) < new Date()) {
    throw new Error('Link has expired');
  }

  // Update last accessed
  await pool.query('UPDATE notebook_share SET last_accessed_at = NOW() WHERE share_link_token = $1', [token]);

  // Get the notebook
  const notebookResult = await pool.query(
    `SELECT nb.id::text, nb.name, nb.description, nb.updated_at, nb.user_email
     FROM notebook nb
     WHERE nb.id = $1 AND nb.deleted_at IS NULL`,
    [share.notebook_id],
  );

  if (notebookResult.rows.length === 0) {
    return null;
  }

  const notebook = notebookResult.rows[0];

  // Get notes in notebook
  const notesResult = await pool.query(
    `SELECT n.id::text, n.title, n.updated_at
     FROM note n
     WHERE n.notebook_id = $1 AND n.deleted_at IS NULL
     ORDER BY n.updated_at DESC`,
    [share.notebook_id],
  );

  return {
    notebook: {
      id: notebook.id,
      name: notebook.name,
      description: notebook.description,
      updated_at: new Date(notebook.updated_at),
    },
    notes: notesResult.rows.map((row) => ({
      id: row.id,
      title: row.title,
      updated_at: new Date(row.updated_at),
    })),
    permission: share.permission as SharePermission,
    shared_by: notebook.user_email,
  };
}

/**
 * Lists notebooks shared with the current user
 */
export async function listSharedWithMe(pool: Pool, user_email: string): Promise<SharedWithMeEntry[]> {
  const result = await pool.query(
    `SELECT
      nb.id::text, nb.name, nbs.created_by_email as shared_by_email,
      nbs.permission, nbs.created_at as shared_at
    FROM notebook_share nbs
    JOIN notebook nb ON nbs.notebook_id = nb.id AND nb.deleted_at IS NULL
    WHERE nbs.shared_with_email = $1
      AND (nbs.expires_at IS NULL OR nbs.expires_at > NOW())
    ORDER BY nbs.created_at DESC`,
    [user_email],
  );

  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    shared_by_email: row.shared_by_email,
    permission: row.permission as SharePermission,
    shared_at: new Date(row.shared_at),
  }));
}

/**
 * Notebook sharing service.
 * Part of Epic #337, Issue #348
 */

import type { Pool } from 'pg';

/** Share permission level */
export type SharePermission = 'read' | 'read_write';

/** User share record */
export interface NotebookUserShare {
  id: string;
  notebookId: string;
  type: 'user';
  sharedWithEmail: string;
  permission: SharePermission;
  expiresAt: Date | null;
  createdByEmail: string;
  createdAt: Date;
  lastAccessedAt: Date | null;
}

/** Link share record */
export interface NotebookLinkShare {
  id: string;
  notebookId: string;
  type: 'link';
  token: string;
  permission: SharePermission;
  expiresAt: Date | null;
  createdByEmail: string;
  createdAt: Date;
  lastAccessedAt: Date | null;
}

/** Union of share types */
export type NotebookShare = NotebookUserShare | NotebookLinkShare;

/** Input for creating a user share */
export interface CreateUserShareInput {
  email: string;
  permission?: SharePermission;
  expiresAt?: Date | string | null;
}

/** Input for creating a link share */
export interface CreateLinkShareInput {
  permission?: SharePermission;
  expiresAt?: Date | string | null;
}

/** Input for updating a share */
export interface UpdateShareInput {
  permission?: SharePermission;
  expiresAt?: Date | string | null;
}

/** Result of listing shares */
export interface ListSharesResult {
  notebookId: string;
  shares: NotebookShare[];
}

/** Result of accessing via share link */
export interface SharedNotebookAccess {
  notebook: {
    id: string;
    name: string;
    description: string | null;
    updatedAt: Date;
  };
  notes: Array<{
    id: string;
    title: string;
    updatedAt: Date;
  }>;
  permission: SharePermission;
  sharedBy: string;
}

/** Shared with me entry */
export interface SharedWithMeEntry {
  id: string;
  name: string;
  sharedByEmail: string;
  permission: SharePermission;
  sharedAt: Date;
}

/**
 * Check if user owns notebook
 */
async function userOwnsNotebook(pool: Pool, notebookId: string, userEmail: string): Promise<boolean> {
  const result = await pool.query('SELECT user_email FROM notebook WHERE id = $1 AND deleted_at IS NULL', [notebookId]);
  return result.rows[0]?.user_email === userEmail;
}

/**
 * Maps database row to NotebookUserShare
 */
function mapRowToUserShare(row: Record<string, unknown>): NotebookUserShare {
  return {
    id: row.id as string,
    notebookId: row.notebook_id as string,
    type: 'user',
    sharedWithEmail: row.shared_with_email as string,
    permission: row.permission as SharePermission,
    expiresAt: row.expires_at ? new Date(row.expires_at as string) : null,
    createdByEmail: row.created_by_email as string,
    createdAt: new Date(row.created_at as string),
    lastAccessedAt: row.last_accessed_at ? new Date(row.last_accessed_at as string) : null,
  };
}

/**
 * Maps database row to NotebookLinkShare
 */
function mapRowToLinkShare(row: Record<string, unknown>): NotebookLinkShare {
  return {
    id: row.id as string,
    notebookId: row.notebook_id as string,
    type: 'link',
    token: row.share_link_token as string,
    permission: row.permission as SharePermission,
    expiresAt: row.expires_at ? new Date(row.expires_at as string) : null,
    createdByEmail: row.created_by_email as string,
    createdAt: new Date(row.created_at as string),
    lastAccessedAt: row.last_accessed_at ? new Date(row.last_accessed_at as string) : null,
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
export async function createUserShare(pool: Pool, notebookId: string, input: CreateUserShareInput, userEmail: string): Promise<NotebookUserShare | null> {
  // Check ownership
  const isOwner = await userOwnsNotebook(pool, notebookId, userEmail);
  if (!isOwner) {
    const exists = await pool.query('SELECT id FROM notebook WHERE id = $1 AND deleted_at IS NULL', [notebookId]);
    if (exists.rows.length === 0) {
      return null; // 404
    }
    throw new Error('FORBIDDEN');
  }

  // Check if already shared with this user
  const existingShare = await pool.query('SELECT id FROM notebook_share WHERE notebook_id = $1 AND shared_with_email = $2', [notebookId, input.email]);
  if (existingShare.rows.length > 0) {
    throw new Error('ALREADY_SHARED');
  }

  // Parse expires_at
  const expiresAt = input.expiresAt ? (typeof input.expiresAt === 'string' ? new Date(input.expiresAt) : input.expiresAt) : null;

  const result = await pool.query(
    `INSERT INTO notebook_share (
      notebook_id, shared_with_email, permission, expires_at, created_by_email
    ) VALUES ($1, $2, $3, $4, $5)
    RETURNING
      id::text, notebook_id::text, shared_with_email, permission,
      expires_at, created_by_email, created_at, last_accessed_at`,
    [notebookId, input.email, input.permission ?? 'read', expiresAt, userEmail],
  );

  return mapRowToUserShare(result.rows[0]);
}

/**
 * Creates a share link for a notebook
 */
export async function createLinkShare(
  pool: Pool,
  notebookId: string,
  input: CreateLinkShareInput,
  userEmail: string,
): Promise<(NotebookLinkShare & { url: string }) | null> {
  // Check ownership
  const isOwner = await userOwnsNotebook(pool, notebookId, userEmail);
  if (!isOwner) {
    const exists = await pool.query('SELECT id FROM notebook WHERE id = $1 AND deleted_at IS NULL', [notebookId]);
    if (exists.rows.length === 0) {
      return null; // 404
    }
    throw new Error('FORBIDDEN');
  }

  // Parse expires_at
  const expiresAt = input.expiresAt ? (typeof input.expiresAt === 'string' ? new Date(input.expiresAt) : input.expiresAt) : null;

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
    [notebookId, token, input.permission ?? 'read', expiresAt, userEmail],
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
export async function listShares(pool: Pool, notebookId: string, userEmail: string): Promise<ListSharesResult | null> {
  // Check ownership
  const isOwner = await userOwnsNotebook(pool, notebookId, userEmail);
  if (!isOwner) {
    const exists = await pool.query('SELECT id FROM notebook WHERE id = $1 AND deleted_at IS NULL', [notebookId]);
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
    [notebookId],
  );

  return {
    notebookId,
    shares: result.rows.map(mapRowToShare),
  };
}

/**
 * Updates a share's permission or expiration
 */
export async function updateShare(pool: Pool, notebookId: string, shareId: string, input: UpdateShareInput, userEmail: string): Promise<NotebookShare | null> {
  // Check ownership
  const isOwner = await userOwnsNotebook(pool, notebookId, userEmail);
  if (!isOwner) {
    const exists = await pool.query('SELECT id FROM notebook WHERE id = $1 AND deleted_at IS NULL', [notebookId]);
    if (exists.rows.length === 0) {
      return null; // 404
    }
    throw new Error('FORBIDDEN');
  }

  // Check share exists for this notebook
  const existingShare = await pool.query('SELECT id FROM notebook_share WHERE id = $1 AND notebook_id = $2', [shareId, notebookId]);
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

  if (input.expiresAt !== undefined) {
    updates.push(`expires_at = $${paramIndex}`);
    const expiresAt = input.expiresAt ? (typeof input.expiresAt === 'string' ? new Date(input.expiresAt) : input.expiresAt) : null;
    params.push(expiresAt);
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
export async function revokeShare(pool: Pool, notebookId: string, shareId: string, userEmail: string): Promise<boolean> {
  // Check ownership
  const isOwner = await userOwnsNotebook(pool, notebookId, userEmail);
  if (!isOwner) {
    const exists = await pool.query('SELECT id FROM notebook WHERE id = $1 AND deleted_at IS NULL', [notebookId]);
    if (exists.rows.length === 0) {
      throw new Error('NOTEBOOK_NOT_FOUND');
    }
    throw new Error('FORBIDDEN');
  }

  const result = await pool.query('DELETE FROM notebook_share WHERE id = $1 AND notebook_id = $2 RETURNING id', [shareId, notebookId]);

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
      updatedAt: new Date(notebook.updated_at),
    },
    notes: notesResult.rows.map((row) => ({
      id: row.id,
      title: row.title,
      updatedAt: new Date(row.updated_at),
    })),
    permission: share.permission as SharePermission,
    sharedBy: notebook.user_email,
  };
}

/**
 * Lists notebooks shared with the current user
 */
export async function listSharedWithMe(pool: Pool, userEmail: string): Promise<SharedWithMeEntry[]> {
  const result = await pool.query(
    `SELECT
      nb.id::text, nb.name, nbs.created_by_email as shared_by_email,
      nbs.permission, nbs.created_at as shared_at
    FROM notebook_share nbs
    JOIN notebook nb ON nbs.notebook_id = nb.id AND nb.deleted_at IS NULL
    WHERE nbs.shared_with_email = $1
      AND (nbs.expires_at IS NULL OR nbs.expires_at > NOW())
    ORDER BY nbs.created_at DESC`,
    [userEmail],
  );

  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    sharedByEmail: row.shared_by_email,
    permission: row.permission as SharePermission,
    sharedAt: new Date(row.shared_at),
  }));
}

/**
 * Note sharing service.
 * Part of Epic #337, Issue #348
 */

import type { Pool } from 'pg';
import { userOwnsNote } from './service.ts';

/** Share permission level */
export type SharePermission = 'read' | 'read_write';

/** User share record */
export interface NoteUserShare {
  id: string;
  noteId: string;
  type: 'user';
  sharedWithEmail: string;
  permission: SharePermission;
  expiresAt: Date | null;
  createdByEmail: string;
  createdAt: Date;
  lastAccessedAt: Date | null;
}

/** Link share record */
export interface NoteLinkShare {
  id: string;
  noteId: string;
  type: 'link';
  token: string;
  permission: SharePermission;
  isSingleView: boolean;
  viewCount: number;
  maxViews: number | null;
  expiresAt: Date | null;
  createdByEmail: string;
  createdAt: Date;
  lastAccessedAt: Date | null;
}

/** Union of share types */
export type NoteShare = NoteUserShare | NoteLinkShare;

/** Input for creating a user share */
export interface CreateUserShareInput {
  email: string;
  permission?: SharePermission;
  expiresAt?: Date | string | null;
}

/** Input for creating a link share */
export interface CreateLinkShareInput {
  permission?: SharePermission;
  isSingleView?: boolean;
  maxViews?: number | null;
  expiresAt?: Date | string | null;
}

/** Input for updating a share */
export interface UpdateShareInput {
  permission?: SharePermission;
  expiresAt?: Date | string | null;
}

/** Result of listing shares */
export interface ListSharesResult {
  noteId: string;
  shares: NoteShare[];
}

/** Result of accessing via share link */
export interface SharedNoteAccess {
  note: {
    id: string;
    title: string;
    content: string;
    updatedAt: Date;
  };
  permission: SharePermission;
  sharedBy: string;
}

/** Shared with me entry */
export interface SharedWithMeEntry {
  id: string;
  title: string;
  sharedByEmail: string;
  permission: SharePermission;
  sharedAt: Date;
}

/**
 * Maps database row to NoteUserShare
 */
function mapRowToUserShare(row: Record<string, unknown>): NoteUserShare {
  return {
    id: row.id as string,
    noteId: row.note_id as string,
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
 * Maps database row to NoteLinkShare
 */
function mapRowToLinkShare(row: Record<string, unknown>): NoteLinkShare {
  return {
    id: row.id as string,
    noteId: row.note_id as string,
    type: 'link',
    token: row.share_link_token as string,
    permission: row.permission as SharePermission,
    isSingleView: (row.is_single_view as boolean) ?? false,
    viewCount: (row.view_count as number) ?? 0,
    maxViews: row.max_views as number | null,
    expiresAt: row.expires_at ? new Date(row.expires_at as string) : null,
    createdByEmail: row.created_by_email as string,
    createdAt: new Date(row.created_at as string),
    lastAccessedAt: row.last_accessed_at ? new Date(row.last_accessed_at as string) : null,
  };
}

/**
 * Maps database row to NoteShare (determines type)
 */
function mapRowToShare(row: Record<string, unknown>): NoteShare {
  if (row.shared_with_email) {
    return mapRowToUserShare(row);
  }
  return mapRowToLinkShare(row);
}

/**
 * Creates a share with a specific user
 */
export async function createUserShare(pool: Pool, noteId: string, input: CreateUserShareInput, userEmail: string): Promise<NoteUserShare | null> {
  // Check ownership
  const isOwner = await userOwnsNote(pool, noteId, userEmail);
  if (!isOwner) {
    // Check if note exists
    const exists = await pool.query('SELECT id FROM note WHERE id = $1 AND deleted_at IS NULL', [noteId]);
    if (exists.rows.length === 0) {
      return null; // 404
    }
    throw new Error('FORBIDDEN');
  }

  // Check if already shared with this user
  const existingShare = await pool.query(`SELECT id FROM note_share WHERE note_id = $1 AND shared_with_email = $2`, [noteId, input.email]);
  if (existingShare.rows.length > 0) {
    throw new Error('ALREADY_SHARED');
  }

  // Get note title for snapshot
  const noteResult = await pool.query('SELECT title FROM note WHERE id = $1', [noteId]);
  const noteTitle = noteResult.rows[0]?.title ?? '';

  // Parse expires_at
  const expiresAt = input.expiresAt ? (typeof input.expiresAt === 'string' ? new Date(input.expiresAt) : input.expiresAt) : null;

  const result = await pool.query(
    `INSERT INTO note_share (
      note_id, shared_with_email, permission, expires_at,
      created_by_email, note_title_snapshot
    ) VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING
      id::text, note_id::text, shared_with_email, permission,
      expires_at, created_by_email, created_at, last_accessed_at`,
    [noteId, input.email, input.permission ?? 'read', expiresAt, userEmail, noteTitle],
  );

  return mapRowToUserShare(result.rows[0]);
}

/**
 * Creates a share link
 */
export async function createLinkShare(
  pool: Pool,
  noteId: string,
  input: CreateLinkShareInput,
  userEmail: string,
): Promise<(NoteLinkShare & { url: string }) | null> {
  // Check ownership
  const isOwner = await userOwnsNote(pool, noteId, userEmail);
  if (!isOwner) {
    const exists = await pool.query('SELECT id FROM note WHERE id = $1 AND deleted_at IS NULL', [noteId]);
    if (exists.rows.length === 0) {
      return null; // 404
    }
    throw new Error('FORBIDDEN');
  }

  // Get note title for snapshot
  const noteResult = await pool.query('SELECT title FROM note WHERE id = $1', [noteId]);
  const noteTitle = noteResult.rows[0]?.title ?? '';

  // Parse expires_at
  const expiresAt = input.expiresAt ? (typeof input.expiresAt === 'string' ? new Date(input.expiresAt) : input.expiresAt) : null;

  // Generate token
  const tokenResult = await pool.query('SELECT generate_share_token() as token');
  const token = tokenResult.rows[0].token as string;

  const result = await pool.query(
    `INSERT INTO note_share (
      note_id, share_link_token, permission, is_single_view,
      max_views, expires_at, created_by_email, note_title_snapshot
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING
      id::text, note_id::text, share_link_token, permission, is_single_view,
      view_count, max_views, expires_at, created_by_email, created_at, last_accessed_at`,
    [noteId, token, input.permission ?? 'read', input.isSingleView ?? false, input.maxViews ?? null, expiresAt, userEmail, noteTitle],
  );

  const share = mapRowToLinkShare(result.rows[0]);
  const baseUrl = process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000';

  return {
    ...share,
    url: `${baseUrl}/shared/notes/${token}`,
  };
}

/**
 * Lists all shares for a note
 */
export async function listShares(pool: Pool, noteId: string, userEmail: string): Promise<ListSharesResult | null> {
  // Check ownership
  const isOwner = await userOwnsNote(pool, noteId, userEmail);
  if (!isOwner) {
    const exists = await pool.query('SELECT id FROM note WHERE id = $1 AND deleted_at IS NULL', [noteId]);
    if (exists.rows.length === 0) {
      return null; // 404
    }
    throw new Error('FORBIDDEN');
  }

  const result = await pool.query(
    `SELECT
      id::text, note_id::text, shared_with_email, share_link_token, permission,
      is_single_view, view_count, max_views, expires_at,
      created_by_email, created_at, last_accessed_at
    FROM note_share
    WHERE note_id = $1
    ORDER BY created_at DESC`,
    [noteId],
  );

  return {
    noteId,
    shares: result.rows.map(mapRowToShare),
  };
}

/**
 * Updates a share's permission or expiration
 */
export async function updateShare(pool: Pool, noteId: string, shareId: string, input: UpdateShareInput, userEmail: string): Promise<NoteShare | null> {
  // Check ownership
  const isOwner = await userOwnsNote(pool, noteId, userEmail);
  if (!isOwner) {
    const exists = await pool.query('SELECT id FROM note WHERE id = $1 AND deleted_at IS NULL', [noteId]);
    if (exists.rows.length === 0) {
      return null; // 404
    }
    throw new Error('FORBIDDEN');
  }

  // Check share exists for this note
  const existingShare = await pool.query('SELECT id FROM note_share WHERE id = $1 AND note_id = $2', [shareId, noteId]);
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
        id::text, note_id::text, shared_with_email, share_link_token, permission,
        is_single_view, view_count, max_views, expires_at,
        created_by_email, created_at, last_accessed_at
      FROM note_share WHERE id = $1`,
      [shareId],
    );
    return mapRowToShare(result.rows[0]);
  }

  params.push(shareId);

  const result = await pool.query(
    `UPDATE note_share
     SET ${updates.join(', ')}
     WHERE id = $${paramIndex}
     RETURNING
       id::text, note_id::text, shared_with_email, share_link_token, permission,
       is_single_view, view_count, max_views, expires_at,
       created_by_email, created_at, last_accessed_at`,
    params,
  );

  return mapRowToShare(result.rows[0]);
}

/**
 * Revokes a share
 */
export async function revokeShare(pool: Pool, noteId: string, shareId: string, userEmail: string): Promise<boolean> {
  // Check ownership
  const isOwner = await userOwnsNote(pool, noteId, userEmail);
  if (!isOwner) {
    const exists = await pool.query('SELECT id FROM note WHERE id = $1 AND deleted_at IS NULL', [noteId]);
    if (exists.rows.length === 0) {
      throw new Error('NOTE_NOT_FOUND');
    }
    throw new Error('FORBIDDEN');
  }

  const result = await pool.query('DELETE FROM note_share WHERE id = $1 AND note_id = $2 RETURNING id', [shareId, noteId]);

  if (result.rows.length === 0) {
    throw new Error('SHARE_NOT_FOUND');
  }

  return true;
}

/**
 * Accesses a note via share link token
 */
export async function accessSharedNote(pool: Pool, token: string): Promise<SharedNoteAccess | null> {
  // Use the database function to validate and consume
  const validationResult = await pool.query('SELECT * FROM validate_share_link($1, true)', [token]);

  const validation = validationResult.rows[0];
  if (!validation.is_valid) {
    if (validation.error_message === 'Invalid or expired link') {
      return null; // 404
    }
    throw new Error(validation.error_message ?? 'INVALID_LINK');
  }

  // Get the note
  const noteResult = await pool.query(
    `SELECT n.id::text, n.title, n.content, n.updated_at, n.user_email
     FROM note n
     WHERE n.id = $1 AND n.deleted_at IS NULL`,
    [validation.note_id],
  );

  if (noteResult.rows.length === 0) {
    return null;
  }

  const note = noteResult.rows[0];

  return {
    note: {
      id: note.id,
      title: note.title,
      content: note.content,
      updatedAt: new Date(note.updated_at),
    },
    permission: validation.permission as SharePermission,
    sharedBy: note.user_email,
  };
}

/**
 * Lists notes shared with the current user
 */
export async function listSharedWithMe(pool: Pool, userEmail: string): Promise<SharedWithMeEntry[]> {
  const result = await pool.query(
    `SELECT
      n.id::text, n.title, ns.created_by_email as shared_by_email,
      ns.permission, ns.created_at as shared_at
    FROM note_share ns
    JOIN note n ON ns.note_id = n.id AND n.deleted_at IS NULL
    WHERE ns.shared_with_email = $1
      AND (ns.expires_at IS NULL OR ns.expires_at > NOW())
    ORDER BY ns.created_at DESC`,
    [userEmail],
  );

  return result.rows.map((row) => ({
    id: row.id,
    title: row.title,
    sharedByEmail: row.shared_by_email,
    permission: row.permission as SharePermission,
    sharedAt: new Date(row.shared_at),
  }));
}

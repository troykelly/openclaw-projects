/**
 * Note service for the notes API.
 * Part of Epic #337, Issue #344
 */

import type { Pool } from 'pg';
import type {
  Note,
  NoteVisibility,
  EmbeddingStatus,
  CreateNoteInput,
  UpdateNoteInput,
  ListNotesOptions,
  ListNotesResult,
  GetNoteOptions,
} from './types.ts';

/** Valid visibility values */
const VALID_VISIBILITY: NoteVisibility[] = ['private', 'shared', 'public'];

/**
 * Maps database row to Note
 */
function mapRowToNote(row: Record<string, unknown>): Note {
  return {
    id: row.id as string,
    notebookId: row.notebook_id as string | null,
    userEmail: row.user_email as string,
    title: row.title as string,
    content: row.content as string,
    summary: row.summary as string | null,
    tags: (row.tags as string[]) ?? [],
    isPinned: (row.is_pinned as boolean) ?? false,
    sortOrder: (row.sort_order as number) ?? 0,
    visibility: row.visibility as NoteVisibility,
    hideFromAgents: (row.hide_from_agents as boolean) ?? false,
    embeddingStatus: row.embedding_status as EmbeddingStatus,
    deletedAt: row.deleted_at ? new Date(row.deleted_at as string) : null,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
    // Optional notebook expand
    notebook: row.notebook_name
      ? { id: row.notebook_id as string, name: row.notebook_name as string }
      : null,
    versionCount: row.version_count !== undefined ? Number(row.version_count) : undefined,
  };
}

/**
 * Validates visibility value
 */
export function isValidVisibility(value: string): value is NoteVisibility {
  return VALID_VISIBILITY.includes(value as NoteVisibility);
}

/**
 * Checks if user can access a note (read permission)
 */
export async function userCanAccessNote(
  pool: Pool,
  noteId: string,
  userEmail: string,
  requiredPermission: 'read' | 'read_write' = 'read'
): Promise<boolean> {
  const result = await pool.query(
    'SELECT user_can_access_note($1, $2, $3) as can_access',
    [noteId, userEmail, requiredPermission]
  );
  return result.rows[0]?.can_access ?? false;
}

/**
 * Checks if user owns a note
 */
export async function userOwnsNote(
  pool: Pool,
  noteId: string,
  userEmail: string
): Promise<boolean> {
  const result = await pool.query(
    'SELECT user_email FROM note WHERE id = $1 AND deleted_at IS NULL',
    [noteId]
  );
  return result.rows[0]?.user_email === userEmail;
}

/**
 * Creates a new note
 */
export async function createNote(
  pool: Pool,
  input: CreateNoteInput,
  userEmail: string
): Promise<Note> {
  // Import embedding integration lazily to avoid circular deps
  const { triggerNoteEmbedding } = await import('../embeddings/note-integration.ts');

  const visibility = input.visibility ?? 'private';

  if (!isValidVisibility(visibility)) {
    throw new Error(`Invalid visibility: ${visibility}. Valid values are: ${VALID_VISIBILITY.join(', ')}`);
  }

  // Validate notebook exists and belongs to user if provided
  if (input.notebookId) {
    const nbResult = await pool.query(
      'SELECT user_email FROM notebook WHERE id = $1 AND deleted_at IS NULL',
      [input.notebookId]
    );
    if (nbResult.rows.length === 0) {
      throw new Error('Notebook not found');
    }
    if (nbResult.rows[0].user_email !== userEmail) {
      throw new Error('Cannot add note to notebook you do not own');
    }
  }

  const result = await pool.query(
    `INSERT INTO note (
      user_email, title, content, notebook_id,
      tags, visibility, hide_from_agents, summary, is_pinned
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING
      id::text, notebook_id::text, user_email, title, content,
      summary, tags, is_pinned, sort_order, visibility,
      hide_from_agents, embedding_status, deleted_at,
      created_at, updated_at`,
    [
      userEmail,
      input.title,
      input.content ?? '',
      input.notebookId ?? null,
      input.tags ?? [],
      visibility,
      input.hideFromAgents ?? false,
      input.summary ?? null,
      input.isPinned ?? false,
    ]
  );

  const note = mapRowToNote(result.rows[0]);

  // Queue embedding generation (async, non-blocking)
  triggerNoteEmbedding(pool, note.id);

  return note;
}

/**
 * Gets a note by ID with access check
 */
export async function getNote(
  pool: Pool,
  noteId: string,
  userEmail: string,
  options: GetNoteOptions = {}
): Promise<Note | null> {
  // Check access
  const canAccess = await userCanAccessNote(pool, noteId, userEmail, 'read');
  if (!canAccess) {
    return null;
  }

  // Get note with optional notebook expansion
  const result = await pool.query(
    `SELECT
      n.id::text, n.notebook_id::text, n.user_email, n.title, n.content,
      n.summary, n.tags, n.is_pinned, n.sort_order, n.visibility,
      n.hide_from_agents, n.embedding_status, n.deleted_at,
      n.created_at, n.updated_at,
      nb.name as notebook_name,
      (SELECT COUNT(*) FROM note_version WHERE note_id = n.id) as version_count
    FROM note n
    LEFT JOIN notebook nb ON n.notebook_id = nb.id
    WHERE n.id = $1 AND n.deleted_at IS NULL`,
    [noteId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const note = mapRowToNote(result.rows[0]);

  // Include versions if requested
  if (options.includeVersions) {
    const versionsResult = await pool.query(
      `SELECT version_number, title, changed_by_email, change_type, created_at
       FROM note_version
       WHERE note_id = $1
       ORDER BY version_number DESC
       LIMIT 50`,
      [noteId]
    );
    (note as Note & { versions: unknown[] }).versions = versionsResult.rows.map((v) => ({
      versionNumber: v.version_number,
      title: v.title,
      changedByEmail: v.changed_by_email,
      changeType: v.change_type,
      createdAt: v.created_at,
    }));
  }

  // Include references if requested
  if (options.includeReferences) {
    const refsResult = await pool.query(
      `SELECT r.id::text, r.work_item_id::text, r.reference_type, r.created_at,
              w.title as work_item_title, w.work_item_kind, w.status
       FROM note_work_item_reference r
       JOIN work_item w ON r.work_item_id = w.id AND w.deleted_at IS NULL
       WHERE r.note_id = $1`,
      [noteId]
    );
    (note as Note & { references: unknown[] }).references = refsResult.rows.map((r) => ({
      id: r.id,
      workItemId: r.work_item_id,
      referenceType: r.reference_type,
      createdAt: r.created_at,
      workItem: {
        id: r.work_item_id,
        title: r.work_item_title,
        kind: r.work_item_kind,
        status: r.status,
      },
    }));
  }

  return note;
}

/**
 * Lists notes with filters and pagination
 */
export async function listNotes(
  pool: Pool,
  userEmail: string,
  options: ListNotesOptions = {}
): Promise<ListNotesResult> {
  const limit = Math.min(options.limit ?? 50, 100);
  const offset = options.offset ?? 0;
  const sortBy = options.sortBy ?? 'updatedAt';
  const sortOrder = options.sortOrder ?? 'desc';

  // Map sort field to column
  const sortColumn = {
    createdAt: 'n.created_at',
    updatedAt: 'n.updated_at',
    title: 'n.title',
  }[sortBy];

  // Build dynamic WHERE clause
  const conditions: string[] = ['n.deleted_at IS NULL'];
  const params: (string | string[] | boolean | number)[] = [];
  let paramIndex = 1;

  // User can see: own notes OR shared with them OR public
  conditions.push(`(
    n.user_email = $${paramIndex}
    OR n.visibility = 'public'
    OR EXISTS (SELECT 1 FROM note_share ns WHERE ns.note_id = n.id AND ns.shared_with_email = $${paramIndex} AND (ns.expires_at IS NULL OR ns.expires_at > NOW()))
    OR EXISTS (SELECT 1 FROM notebook_share nbs WHERE nbs.notebook_id = n.notebook_id AND nbs.shared_with_email = $${paramIndex} AND (nbs.expires_at IS NULL OR nbs.expires_at > NOW()))
  )`);
  params.push(userEmail);
  paramIndex++;

  if (options.notebookId) {
    conditions.push(`n.notebook_id = $${paramIndex}`);
    params.push(options.notebookId);
    paramIndex++;
  }

  if (options.visibility) {
    conditions.push(`n.visibility = $${paramIndex}`);
    params.push(options.visibility);
    paramIndex++;
  }

  if (options.tags && options.tags.length > 0) {
    conditions.push(`n.tags @> $${paramIndex}`);
    params.push(options.tags);
    paramIndex++;
  }

  if (options.isPinned !== undefined) {
    conditions.push(`n.is_pinned = $${paramIndex}`);
    params.push(options.isPinned);
    paramIndex++;
  }

  if (options.search) {
    conditions.push(`n.search_vector @@ plainto_tsquery('english', $${paramIndex})`);
    params.push(options.search);
    paramIndex++;
  }

  const whereClause = `WHERE ${conditions.join(' AND ')}`;

  // Get total count
  const countResult = await pool.query(
    `SELECT COUNT(*) as total FROM note n ${whereClause}`,
    params
  );
  const total = parseInt((countResult.rows[0] as { total: string }).total, 10);

  // Get notes
  const notesResult = await pool.query(
    `SELECT
      n.id::text, n.notebook_id::text, n.user_email, n.title, n.content,
      n.summary, n.tags, n.is_pinned, n.sort_order, n.visibility,
      n.hide_from_agents, n.embedding_status, n.deleted_at,
      n.created_at, n.updated_at,
      nb.name as notebook_name
    FROM note n
    LEFT JOIN notebook nb ON n.notebook_id = nb.id
    ${whereClause}
    ORDER BY ${sortColumn} ${sortOrder === 'asc' ? 'ASC' : 'DESC'}
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    [...params, limit, offset]
  );

  return {
    notes: notesResult.rows.map(mapRowToNote),
    total,
    limit,
    offset,
  };
}

/**
 * Updates a note with write permission check
 */
export async function updateNote(
  pool: Pool,
  noteId: string,
  input: UpdateNoteInput,
  userEmail: string
): Promise<Note | null> {
  // Check write access
  const canWrite = await userCanAccessNote(pool, noteId, userEmail, 'read_write');
  if (!canWrite) {
    // Check if note exists but user lacks permission (403) vs not found (404)
    const exists = await pool.query(
      'SELECT id FROM note WHERE id = $1 AND deleted_at IS NULL',
      [noteId]
    );
    if (exists.rows.length === 0) {
      return null; // 404
    }
    throw new Error('FORBIDDEN'); // 403
  }

  // Validate visibility if provided
  if (input.visibility && !isValidVisibility(input.visibility)) {
    throw new Error(`Invalid visibility: ${input.visibility}`);
  }

  // Validate notebook if provided
  if (input.notebookId) {
    const nbResult = await pool.query(
      'SELECT user_email FROM notebook WHERE id = $1 AND deleted_at IS NULL',
      [input.notebookId]
    );
    if (nbResult.rows.length === 0) {
      throw new Error('Notebook not found');
    }
    // Note: only owner can change notebook
    const isOwner = await userOwnsNote(pool, noteId, userEmail);
    if (!isOwner && nbResult.rows[0].user_email !== userEmail) {
      throw new Error('Only note owner can change notebook');
    }
  }

  // Set session user for version tracking
  await pool.query(`SELECT set_config('app.current_user_email', $1, true)`, [userEmail]);

  // Build UPDATE query dynamically
  const updates: string[] = [];
  const params: (string | string[] | boolean | number | null)[] = [];
  let paramIndex = 1;

  if (input.title !== undefined) {
    updates.push(`title = $${paramIndex}`);
    params.push(input.title);
    paramIndex++;
  }
  if (input.content !== undefined) {
    updates.push(`content = $${paramIndex}`);
    params.push(input.content);
    paramIndex++;
  }
  if (input.notebookId !== undefined) {
    updates.push(`notebook_id = $${paramIndex}`);
    params.push(input.notebookId);
    paramIndex++;
  }
  if (input.tags !== undefined) {
    updates.push(`tags = $${paramIndex}`);
    params.push(input.tags);
    paramIndex++;
  }
  if (input.visibility !== undefined) {
    updates.push(`visibility = $${paramIndex}`);
    params.push(input.visibility);
    paramIndex++;
  }
  if (input.hideFromAgents !== undefined) {
    updates.push(`hide_from_agents = $${paramIndex}`);
    params.push(input.hideFromAgents);
    paramIndex++;
  }
  if (input.summary !== undefined) {
    updates.push(`summary = $${paramIndex}`);
    params.push(input.summary);
    paramIndex++;
  }
  if (input.isPinned !== undefined) {
    updates.push(`is_pinned = $${paramIndex}`);
    params.push(input.isPinned);
    paramIndex++;
  }
  if (input.sortOrder !== undefined) {
    updates.push(`sort_order = $${paramIndex}`);
    params.push(input.sortOrder);
    paramIndex++;
  }

  if (updates.length === 0) {
    // Nothing to update, just return current note
    return getNote(pool, noteId, userEmail);
  }

  params.push(noteId);

  const result = await pool.query(
    `UPDATE note
     SET ${updates.join(', ')}
     WHERE id = $${paramIndex} AND deleted_at IS NULL
     RETURNING
       id::text, notebook_id::text, user_email, title, content,
       summary, tags, is_pinned, sort_order, visibility,
       hide_from_agents, embedding_status, deleted_at,
       created_at, updated_at`,
    params
  );

  if (result.rows.length === 0) {
    return null;
  }

  const note = mapRowToNote(result.rows[0]);

  // Re-embed if content, title, or visibility changed
  if (
    input.title !== undefined ||
    input.content !== undefined ||
    input.visibility !== undefined ||
    input.hideFromAgents !== undefined
  ) {
    // Import embedding integration lazily
    import('../embeddings/note-integration.ts')
      .then(({ triggerNoteEmbedding }) => triggerNoteEmbedding(pool, note.id))
      .catch((err) =>
        console.error(`[Embeddings] Failed to import embedding module:`, err)
      );
  }

  return note;
}

/**
 * Soft deletes a note (only owner can delete)
 */
export async function deleteNote(
  pool: Pool,
  noteId: string,
  userEmail: string
): Promise<boolean> {
  // Only owner can delete
  const isOwner = await userOwnsNote(pool, noteId, userEmail);
  if (!isOwner) {
    const exists = await pool.query(
      'SELECT id FROM note WHERE id = $1 AND deleted_at IS NULL',
      [noteId]
    );
    if (exists.rows.length === 0) {
      throw new Error('NOT_FOUND');
    }
    throw new Error('FORBIDDEN');
  }

  const result = await pool.query(
    `UPDATE note SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL`,
    [noteId]
  );

  return (result.rowCount ?? 0) > 0;
}

/**
 * Restores a soft-deleted note (only owner can restore)
 */
export async function restoreNote(
  pool: Pool,
  noteId: string,
  userEmail: string
): Promise<Note | null> {
  // Check if note exists (even if deleted) and user owns it
  const noteResult = await pool.query(
    'SELECT user_email FROM note WHERE id = $1',
    [noteId]
  );

  if (noteResult.rows.length === 0) {
    return null; // 404
  }

  if (noteResult.rows[0].user_email !== userEmail) {
    throw new Error('FORBIDDEN');
  }

  const result = await pool.query(
    `UPDATE note
     SET deleted_at = NULL
     WHERE id = $1 AND deleted_at IS NOT NULL
     RETURNING
       id::text, notebook_id::text, user_email, title, content,
       summary, tags, is_pinned, sort_order, visibility,
       hide_from_agents, embedding_status, deleted_at,
       created_at, updated_at`,
    [noteId]
  );

  if (result.rows.length === 0) {
    return null; // Already restored or never deleted
  }

  return mapRowToNote(result.rows[0]);
}

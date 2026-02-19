/**
 * Note service for the notes API.
 * Part of Epic #337, Issue #344
 *
 * All property names use snake_case to match the project-wide convention (Issue #1412).
 */

import type { Pool } from 'pg';
import type { Note, NoteVisibility, EmbeddingStatus, CreateNoteInput, UpdateNoteInput, ListNotesOptions, ListNotesResult, GetNoteOptions } from './types.ts';

/** Valid visibility values */
const VALID_VISIBILITY: NoteVisibility[] = ['private', 'shared', 'public'];

/**
 * Maps database row to Note
 */
function mapRowToNote(row: Record<string, unknown>): Note {
  return {
    id: row.id as string,
    notebook_id: row.notebook_id as string | null,
    title: row.title as string,
    content: row.content as string,
    summary: row.summary as string | null,
    tags: (row.tags as string[]) ?? [],
    is_pinned: (row.is_pinned as boolean) ?? false,
    sort_order: (row.sort_order as number) ?? 0,
    visibility: row.visibility as NoteVisibility,
    hide_from_agents: (row.hide_from_agents as boolean) ?? false,
    embedding_status: row.embedding_status as EmbeddingStatus,
    deleted_at: row.deleted_at ? new Date(row.deleted_at as string) : null,
    created_at: new Date(row.created_at as string),
    updated_at: new Date(row.updated_at as string),
    // Optional notebook expand
    notebook: row.notebook_name ? { id: row.notebook_id as string, name: row.notebook_name as string } : null,
    version_count: row.version_count !== undefined ? Number(row.version_count) : undefined,
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
export async function userCanAccessNote(pool: Pool, noteId: string, user_email: string, requiredPermission: 'read' | 'read_write' = 'read'): Promise<boolean> {
  const result = await pool.query('SELECT user_can_access_note($1, $2, $3) as can_access', [noteId, user_email, requiredPermission]);
  return result.rows[0]?.can_access ?? false;
}

/**
 * Checks if user owns a note via namespace membership.
 * Phase 4 (Epic #1418): user_email column dropped from note table.
 * Ownership is inferred by having a namespace_grant for the note's namespace.
 */
export async function userOwnsNote(pool: Pool, noteId: string, user_email: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT n.id FROM note n
     JOIN namespace_grant ng ON ng.namespace = n.namespace AND ng.email = $2
     WHERE n.id = $1 AND n.deleted_at IS NULL`,
    [noteId, user_email],
  );
  return result.rows.length > 0;
}

/**
 * Creates a new note
 */
export async function createNote(pool: Pool, input: CreateNoteInput, user_email: string, namespace?: string): Promise<Note> {
  // Import embedding integration lazily to avoid circular deps
  const { triggerNoteEmbedding } = await import('../embeddings/note-integration.ts');

  const visibility = input.visibility ?? 'private';

  if (!isValidVisibility(visibility)) {
    throw new Error(`Invalid visibility: ${visibility}. Valid values are: ${VALID_VISIBILITY.join(', ')}`);
  }

  // Validate notebook exists and user owns it (Phase 4: ownership via namespace_grant)
  if (input.notebook_id) {
    const nbResult = await pool.query(
      `SELECT nb.id FROM notebook nb
       JOIN namespace_grant ng ON ng.namespace = nb.namespace AND ng.email = $2
       WHERE nb.id = $1 AND nb.deleted_at IS NULL`,
      [input.notebook_id, user_email],
    );
    if (nbResult.rows.length === 0) {
      const exists = await pool.query('SELECT id FROM notebook WHERE id = $1 AND deleted_at IS NULL', [input.notebook_id]);
      if (exists.rows.length === 0) {
        throw new Error('Notebook not found');
      }
      throw new Error('You do not own this notebook');
    }
  }

  const result = await pool.query(
    `INSERT INTO note (
      title, content, notebook_id,
      tags, visibility, hide_from_agents, summary, is_pinned, namespace
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING
      id::text, notebook_id::text, title, content,
      summary, tags, is_pinned, sort_order, visibility,
      hide_from_agents, embedding_status, deleted_at,
      created_at, updated_at`,
    [
      input.title,
      input.content ?? '',
      input.notebook_id ?? null,
      input.tags ?? [],
      visibility,
      input.hide_from_agents ?? false,
      input.summary ?? null,
      input.is_pinned ?? false,
      namespace ?? 'default',
    ],
  );

  const note = mapRowToNote(result.rows[0]);

  // Queue embedding generation (async, non-blocking)
  triggerNoteEmbedding(pool, note.id);

  return note;
}

/**
 * Gets a note by ID with access check
 */
export async function getNote(pool: Pool, noteId: string, user_email: string, options: GetNoteOptions = {}): Promise<Note | null> {
  // Check access
  const canAccess = await userCanAccessNote(pool, noteId, user_email, 'read');
  if (!canAccess) {
    return null;
  }

  // Get note with optional notebook expansion
  const result = await pool.query(
    `SELECT
      n.id::text, n.notebook_id::text, n.title, n.content,
      n.summary, n.tags, n.is_pinned, n.sort_order, n.visibility,
      n.hide_from_agents, n.embedding_status, n.deleted_at,
      n.created_at, n.updated_at,
      nb.name as notebook_name,
      (SELECT COUNT(*) FROM note_version WHERE note_id = n.id) as version_count
    FROM note n
    LEFT JOIN notebook nb ON n.notebook_id = nb.id
    WHERE n.id = $1 AND n.deleted_at IS NULL`,
    [noteId],
  );

  if (result.rows.length === 0) {
    return null;
  }

  const note = mapRowToNote(result.rows[0]);

  // Include versions if requested
  if (options.include_versions) {
    const versionsResult = await pool.query(
      `SELECT version_number, title, changed_by_email, change_type, created_at
       FROM note_version
       WHERE note_id = $1
       ORDER BY version_number DESC
       LIMIT 50`,
      [noteId],
    );
    (note as Note & { versions: unknown[] }).versions = versionsResult.rows.map((v) => ({
      version_number: v.version_number,
      title: v.title,
      changed_by_email: v.changed_by_email,
      change_type: v.change_type,
      created_at: v.created_at,
    }));
  }

  // Include references if requested
  if (options.include_references) {
    const refsResult = await pool.query(
      `SELECT r.id::text, r.work_item_id::text, r.reference_type, r.created_at,
              w.title as work_item_title, w.work_item_kind, w.status
       FROM note_work_item_reference r
       JOIN work_item w ON r.work_item_id = w.id AND w.deleted_at IS NULL
       WHERE r.note_id = $1`,
      [noteId],
    );
    (note as Note & { references: unknown[] }).references = refsResult.rows.map((r) => ({
      id: r.id,
      work_item_id: r.work_item_id,
      reference_type: r.reference_type,
      created_at: r.created_at,
      work_item: {
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
export async function listNotes(pool: Pool, user_email: string, options: ListNotesOptions = {}): Promise<ListNotesResult> {
  const limit = Math.min(options.limit ?? 50, 100);
  const offset = options.offset ?? 0;
  const sortBy = options.sort_by ?? 'updated_at';
  const sortOrder = options.sort_order ?? 'desc';

  // Map sort field to column
  const sortColumn = {
    created_at: 'n.created_at',
    updated_at: 'n.updated_at',
    title: 'n.title',
  }[sortBy];

  // Build dynamic WHERE clause
  const conditions: string[] = ['n.deleted_at IS NULL'];
  const params: unknown[] = [];
  let paramIndex = 1;

  // Epic #1418 Phase 4: Access control via namespace + sharing.
  // Notes visible if: in caller's namespaces, or explicitly shared with caller.
  const queryNs = options.queryNamespaces ?? ['default'];
  conditions.push(`(
    n.namespace = ANY($${paramIndex}::text[])
    OR EXISTS (SELECT 1 FROM note_share ns WHERE ns.note_id = n.id AND ns.shared_with_email = $${paramIndex + 1} AND (ns.expires_at IS NULL OR ns.expires_at > NOW()))
    OR EXISTS (SELECT 1 FROM notebook_share nbs WHERE nbs.notebook_id = n.notebook_id AND nbs.shared_with_email = $${paramIndex + 1} AND (nbs.expires_at IS NULL OR nbs.expires_at > NOW()))
  )`);
  params.push(queryNs, user_email);
  paramIndex += 2;

  if (options.notebook_id) {
    conditions.push(`n.notebook_id = $${paramIndex}`);
    params.push(options.notebook_id);
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

  if (options.is_pinned !== undefined) {
    conditions.push(`n.is_pinned = $${paramIndex}`);
    params.push(options.is_pinned);
    paramIndex++;
  }

  if (options.search) {
    conditions.push(`n.search_vector @@ plainto_tsquery('english', $${paramIndex})`);
    params.push(options.search);
    paramIndex++;
  }

  const whereClause = `WHERE ${conditions.join(' AND ')}`;

  // Get total count
  const countResult = await pool.query(`SELECT COUNT(*) as total FROM note n ${whereClause}`, params);
  const total = parseInt((countResult.rows[0] as { total: string }).total, 10);

  // Get notes
  const notesResult = await pool.query(
    `SELECT
      n.id::text, n.notebook_id::text, n.title, n.content,
      n.summary, n.tags, n.is_pinned, n.sort_order, n.visibility,
      n.hide_from_agents, n.embedding_status, n.deleted_at,
      n.created_at, n.updated_at,
      nb.name as notebook_name
    FROM note n
    LEFT JOIN notebook nb ON n.notebook_id = nb.id
    ${whereClause}
    ORDER BY ${sortColumn} ${sortOrder === 'asc' ? 'ASC' : 'DESC'}
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    [...params, limit, offset],
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
export async function updateNote(pool: Pool, noteId: string, input: UpdateNoteInput, user_email: string): Promise<Note | null> {
  // Check write access
  const canWrite = await userCanAccessNote(pool, noteId, user_email, 'read_write');
  if (!canWrite) {
    // Check if note exists but user lacks permission (403) vs not found (404)
    const exists = await pool.query('SELECT id FROM note WHERE id = $1 AND deleted_at IS NULL', [noteId]);
    if (exists.rows.length === 0) {
      return null; // 404
    }
    throw new Error('FORBIDDEN'); // 403
  }

  // Validate visibility if provided
  if (input.visibility && !isValidVisibility(input.visibility)) {
    throw new Error(`Invalid visibility: ${input.visibility}`);
  }

  // Validate notebook if provided (Phase 4: user_email column dropped)
  if (input.notebook_id) {
    const nbResult = await pool.query('SELECT id FROM notebook WHERE id = $1 AND deleted_at IS NULL', [input.notebook_id]);
    if (nbResult.rows.length === 0) {
      throw new Error('Notebook not found');
    }
  }

  // Set session user for version tracking
  await pool.query(`SELECT set_config('app.current_user_email', $1, true)`, [user_email]);

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
  if (input.notebook_id !== undefined) {
    updates.push(`notebook_id = $${paramIndex}`);
    params.push(input.notebook_id);
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
  if (input.hide_from_agents !== undefined) {
    updates.push(`hide_from_agents = $${paramIndex}`);
    params.push(input.hide_from_agents);
    paramIndex++;
  }
  if (input.summary !== undefined) {
    updates.push(`summary = $${paramIndex}`);
    params.push(input.summary);
    paramIndex++;
  }
  if (input.is_pinned !== undefined) {
    updates.push(`is_pinned = $${paramIndex}`);
    params.push(input.is_pinned);
    paramIndex++;
  }
  if (input.sort_order !== undefined) {
    updates.push(`sort_order = $${paramIndex}`);
    params.push(input.sort_order);
    paramIndex++;
  }

  if (updates.length === 0) {
    // Nothing to update, just return current note
    return getNote(pool, noteId, user_email);
  }

  params.push(noteId);

  const result = await pool.query(
    `UPDATE note
     SET ${updates.join(', ')}
     WHERE id = $${paramIndex} AND deleted_at IS NULL
     RETURNING
       id::text, notebook_id::text, title, content,
       summary, tags, is_pinned, sort_order, visibility,
       hide_from_agents, embedding_status, deleted_at,
       created_at, updated_at`,
    params,
  );

  if (result.rows.length === 0) {
    return null;
  }

  const note = mapRowToNote(result.rows[0]);

  // Re-embed if content, title, or visibility changed
  if (input.title !== undefined || input.content !== undefined || input.visibility !== undefined || input.hide_from_agents !== undefined) {
    // Import embedding integration lazily
    import('../embeddings/note-integration.ts')
      .then(({ triggerNoteEmbedding }) => triggerNoteEmbedding(pool, note.id))
      .catch((err) => console.error(`[Embeddings] Failed to import embedding module:`, err));
  }

  return note;
}

/**
 * Soft deletes a note (only namespace member can delete)
 */
export async function deleteNote(pool: Pool, noteId: string, user_email: string): Promise<boolean> {
  // Phase 4 (Epic #1418): check namespace membership for ownership
  const isOwner = await userOwnsNote(pool, noteId, user_email);
  if (!isOwner) {
    const exists = await pool.query('SELECT id FROM note WHERE id = $1 AND deleted_at IS NULL', [noteId]);
    if (exists.rows.length === 0) {
      throw new Error('NOT_FOUND');
    }
    throw new Error('FORBIDDEN');
  }

  const result = await pool.query(`UPDATE note SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL`, [noteId]);

  return (result.rowCount ?? 0) > 0;
}

/**
 * Restores a soft-deleted note (only namespace member can restore)
 */
export async function restoreNote(pool: Pool, noteId: string, user_email: string): Promise<Note | null> {
  // Phase 4 (Epic #1418): check namespace membership for ownership.
  // Note: can't use userOwnsNote here because it filters deleted_at IS NULL,
  // and we're restoring a deleted note. Check namespace membership directly.
  const accessCheck = await pool.query(
    `SELECT n.id FROM note n
     JOIN namespace_grant ng ON ng.namespace = n.namespace AND ng.email = $2
     WHERE n.id = $1`,
    [noteId, user_email],
  );
  if (accessCheck.rows.length === 0) {
    const exists = await pool.query('SELECT id FROM note WHERE id = $1', [noteId]);
    if (exists.rows.length === 0) {
      return null; // 404
    }
    throw new Error('FORBIDDEN');
  }

  const noteResult = await pool.query('SELECT id FROM note WHERE id = $1', [noteId]);

  if (noteResult.rows.length === 0) {
    return null; // 404
  }

  const result = await pool.query(
    `UPDATE note
     SET deleted_at = NULL
     WHERE id = $1 AND deleted_at IS NOT NULL
     RETURNING
       id::text, notebook_id::text, title, content,
       summary, tags, is_pinned, sort_order, visibility,
       hide_from_agents, embedding_status, deleted_at,
       created_at, updated_at`,
    [noteId],
  );

  if (result.rows.length === 0) {
    return null; // Already restored or never deleted
  }

  return mapRowToNote(result.rows[0]);
}

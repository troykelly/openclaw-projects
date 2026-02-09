/**
 * Notebook service for the notebooks API.
 * Part of Epic #337, Issue #345
 */

import type { Pool } from 'pg';
import type {
  Notebook,
  NotebookNote,
  CreateNotebookInput,
  UpdateNotebookInput,
  ListNotebooksOptions,
  ListNotebooksResult,
  GetNotebookOptions,
  NotebookTreeNode,
  MoveNotesInput,
  MoveNotesResult,
} from './types.ts';

/**
 * Maps database row to Notebook
 */
function mapRowToNotebook(row: Record<string, unknown>): Notebook {
  return {
    id: row.id as string,
    userEmail: row.user_email as string,
    name: row.name as string,
    description: row.description as string | null,
    icon: row.icon as string | null,
    color: row.color as string | null,
    parentNotebookId: row.parent_notebook_id as string | null,
    sortOrder: (row.sort_order as number) ?? 0,
    isArchived: (row.is_archived as boolean) ?? false,
    deletedAt: row.deleted_at ? new Date(row.deleted_at as string) : null,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
    // Optional fields
    noteCount: row.note_count !== undefined ? Number(row.note_count) : undefined,
    childCount: row.child_count !== undefined ? Number(row.child_count) : undefined,
    parent: row.parent_name ? { id: row.parent_notebook_id as string, name: row.parent_name as string } : null,
  };
}

/**
 * Checks if user owns a notebook
 */
export async function userOwnsNotebook(pool: Pool, notebookId: string, userEmail: string): Promise<boolean> {
  const result = await pool.query('SELECT user_email FROM notebook WHERE id = $1 AND deleted_at IS NULL', [notebookId]);
  return result.rows[0]?.user_email === userEmail;
}

/**
 * Checks if a notebook would create a circular reference
 */
async function wouldCreateCircularReference(pool: Pool, notebookId: string, newParentId: string): Promise<boolean> {
  // Check if newParentId is the notebook itself
  if (notebookId === newParentId) {
    return true;
  }

  // Check if newParentId is a descendant of notebookId
  const result = await pool.query(
    `WITH RECURSIVE ancestors AS (
      SELECT id, parent_notebook_id FROM notebook WHERE id = $1
      UNION ALL
      SELECT n.id, n.parent_notebook_id
      FROM notebook n
      JOIN ancestors a ON n.id = a.parent_notebook_id
    )
    SELECT 1 FROM ancestors WHERE id = $2 LIMIT 1`,
    [newParentId, notebookId],
  );

  return result.rows.length > 0;
}

/**
 * Creates a new notebook
 */
export async function createNotebook(pool: Pool, input: CreateNotebookInput, userEmail: string): Promise<Notebook> {
  // Validate parent notebook exists and belongs to user if provided
  if (input.parentNotebookId) {
    const parentResult = await pool.query('SELECT user_email FROM notebook WHERE id = $1 AND deleted_at IS NULL', [input.parentNotebookId]);
    if (parentResult.rows.length === 0) {
      throw new Error('Parent notebook not found');
    }
    if (parentResult.rows[0].user_email !== userEmail) {
      throw new Error('Cannot create notebook under a notebook you do not own');
    }
  }

  const result = await pool.query(
    `INSERT INTO notebook (
      user_email, name, description, icon, color, parent_notebook_id
    ) VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING
      id::text, user_email, name, description, icon, color,
      parent_notebook_id::text, sort_order, is_archived, deleted_at,
      created_at, updated_at`,
    [userEmail, input.name, input.description ?? null, input.icon ?? null, input.color ?? null, input.parentNotebookId ?? null],
  );

  const notebook = mapRowToNotebook(result.rows[0]);
  notebook.noteCount = 0;
  notebook.childCount = 0;
  return notebook;
}

/**
 * Gets a notebook by ID
 */
export async function getNotebook(pool: Pool, notebookId: string, userEmail: string, options: GetNotebookOptions = {}): Promise<Notebook | null> {
  // Get notebook with optional note count
  const result = await pool.query(
    `SELECT
      nb.id::text, nb.user_email, nb.name, nb.description, nb.icon, nb.color,
      nb.parent_notebook_id::text, nb.sort_order, nb.is_archived, nb.deleted_at,
      nb.created_at, nb.updated_at,
      pnb.name as parent_name,
      (SELECT COUNT(*) FROM note WHERE notebook_id = nb.id AND deleted_at IS NULL) as note_count,
      (SELECT COUNT(*) FROM notebook WHERE parent_notebook_id = nb.id AND deleted_at IS NULL) as child_count
    FROM notebook nb
    LEFT JOIN notebook pnb ON nb.parent_notebook_id = pnb.id
    WHERE nb.id = $1 AND nb.deleted_at IS NULL AND nb.user_email = $2`,
    [notebookId, userEmail],
  );

  if (result.rows.length === 0) {
    return null;
  }

  const notebook = mapRowToNotebook(result.rows[0]);

  // Include notes if requested
  if (options.includeNotes) {
    const notesResult = await pool.query(
      `SELECT id::text, title, updated_at
       FROM note
       WHERE notebook_id = $1 AND deleted_at IS NULL
       ORDER BY sort_order ASC, updated_at DESC
       LIMIT 100`,
      [notebookId],
    );
    notebook.notes = notesResult.rows.map((n) => ({
      id: n.id as string,
      title: n.title as string,
      updatedAt: new Date(n.updated_at as string),
    }));
  }

  // Include children if requested
  if (options.includeChildren) {
    const childrenResult = await pool.query(
      `SELECT
        nb.id::text, nb.user_email, nb.name, nb.description, nb.icon, nb.color,
        nb.parent_notebook_id::text, nb.sort_order, nb.is_archived, nb.deleted_at,
        nb.created_at, nb.updated_at,
        (SELECT COUNT(*) FROM note WHERE notebook_id = nb.id AND deleted_at IS NULL) as note_count,
        (SELECT COUNT(*) FROM notebook WHERE parent_notebook_id = nb.id AND deleted_at IS NULL) as child_count
      FROM notebook nb
      WHERE nb.parent_notebook_id = $1 AND nb.deleted_at IS NULL
      ORDER BY nb.sort_order ASC, nb.name ASC`,
      [notebookId],
    );
    notebook.children = childrenResult.rows.map(mapRowToNotebook);
  }

  return notebook;
}

/**
 * Lists notebooks with filters and pagination
 */
export async function listNotebooks(pool: Pool, userEmail: string, options: ListNotebooksOptions = {}): Promise<ListNotebooksResult> {
  const limit = Math.min(options.limit ?? 100, 200);
  const offset = options.offset ?? 0;

  // Build WHERE clause
  const conditions: string[] = ['nb.deleted_at IS NULL', 'nb.user_email = $1'];
  const params: (string | boolean | number)[] = [userEmail];
  let paramIndex = 2;

  // Filter by parent (null means root notebooks)
  if (options.parentId === null) {
    conditions.push('nb.parent_notebook_id IS NULL');
  } else if (options.parentId) {
    conditions.push(`nb.parent_notebook_id = $${paramIndex}`);
    params.push(options.parentId);
    paramIndex++;
  }

  // Include archived notebooks
  if (!options.includeArchived) {
    conditions.push('nb.is_archived = false');
  }

  const whereClause = `WHERE ${conditions.join(' AND ')}`;

  // Get total count
  const countResult = await pool.query(`SELECT COUNT(*) as total FROM notebook nb ${whereClause}`, params);
  const total = parseInt((countResult.rows[0] as { total: string }).total, 10);

  // Build select with optional counts
  let selectCounts = '';
  if (options.includeNoteCounts !== false) {
    selectCounts += ', (SELECT COUNT(*) FROM note WHERE notebook_id = nb.id AND deleted_at IS NULL) as note_count';
  }
  if (options.includeChildCounts !== false) {
    selectCounts += ', (SELECT COUNT(*) FROM notebook WHERE parent_notebook_id = nb.id AND deleted_at IS NULL) as child_count';
  }

  // Get notebooks
  params.push(limit);
  params.push(offset);

  const notebooksResult = await pool.query(
    `SELECT
      nb.id::text, nb.user_email, nb.name, nb.description, nb.icon, nb.color,
      nb.parent_notebook_id::text, nb.sort_order, nb.is_archived, nb.deleted_at,
      nb.created_at, nb.updated_at
      ${selectCounts}
    FROM notebook nb
    ${whereClause}
    ORDER BY nb.sort_order ASC, nb.name ASC
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    params,
  );

  return {
    notebooks: notebooksResult.rows.map(mapRowToNotebook),
    total,
  };
}

/**
 * Gets notebooks as a tree structure
 */
export async function getNotebooksTree(pool: Pool, userEmail: string, includeNoteCounts = false): Promise<NotebookTreeNode[]> {
  // Get all notebooks for the user
  let selectCounts = '';
  if (includeNoteCounts) {
    selectCounts = ', (SELECT COUNT(*) FROM note WHERE notebook_id = nb.id AND deleted_at IS NULL) as note_count';
  }

  const result = await pool.query(
    `SELECT
      nb.id::text, nb.name, nb.icon, nb.color, nb.parent_notebook_id::text, nb.sort_order
      ${selectCounts}
    FROM notebook nb
    WHERE nb.user_email = $1 AND nb.deleted_at IS NULL AND nb.is_archived = false
    ORDER BY nb.sort_order ASC, nb.name ASC`,
    [userEmail],
  );

  // Build tree structure
  const notebooksById = new Map<string, NotebookTreeNode & { parentId: string | null }>();
  const rootNodes: NotebookTreeNode[] = [];

  // First pass: create all nodes
  for (const row of result.rows) {
    notebooksById.set(row.id as string, {
      id: row.id as string,
      name: row.name as string,
      icon: row.icon as string | null,
      color: row.color as string | null,
      noteCount: row.note_count !== undefined ? Number(row.note_count) : undefined,
      children: [],
      parentId: row.parent_notebook_id as string | null,
    });
  }

  // Second pass: build tree
  for (const node of notebooksById.values()) {
    if (node.parentId === null) {
      rootNodes.push(node);
    } else {
      const parent = notebooksById.get(node.parentId);
      if (parent) {
        parent.children.push(node);
      } else {
        // Parent not found (maybe deleted), treat as root
        rootNodes.push(node);
      }
    }
  }

  // Remove parentId from result
  const cleanNode = (node: NotebookTreeNode & { parentId?: string | null }): NotebookTreeNode => {
    const { parentId: _, ...clean } = node;
    return {
      ...clean,
      children: node.children.map(cleanNode),
    };
  };

  return rootNodes.map(cleanNode);
}

/**
 * Updates a notebook
 */
export async function updateNotebook(pool: Pool, notebookId: string, input: UpdateNotebookInput, userEmail: string): Promise<Notebook | null> {
  // Check ownership
  const isOwner = await userOwnsNotebook(pool, notebookId, userEmail);
  if (!isOwner) {
    const exists = await pool.query('SELECT id FROM notebook WHERE id = $1 AND deleted_at IS NULL', [notebookId]);
    if (exists.rows.length === 0) {
      return null; // 404
    }
    throw new Error('FORBIDDEN');
  }

  // Validate new parent if provided
  if (input.parentNotebookId !== undefined && input.parentNotebookId !== null) {
    // Check parent exists and belongs to user
    const parentResult = await pool.query('SELECT user_email FROM notebook WHERE id = $1 AND deleted_at IS NULL', [input.parentNotebookId]);
    if (parentResult.rows.length === 0) {
      throw new Error('Parent notebook not found');
    }
    if (parentResult.rows[0].user_email !== userEmail) {
      throw new Error('Cannot move notebook under a notebook you do not own');
    }

    // Check for circular reference
    const wouldBeCircular = await wouldCreateCircularReference(pool, notebookId, input.parentNotebookId);
    if (wouldBeCircular) {
      throw new Error('Cannot create circular notebook hierarchy');
    }
  }

  // Build UPDATE query dynamically
  const updates: string[] = [];
  const params: (string | number | null)[] = [];
  let paramIndex = 1;

  if (input.name !== undefined) {
    updates.push(`name = $${paramIndex}`);
    params.push(input.name);
    paramIndex++;
  }
  if (input.description !== undefined) {
    updates.push(`description = $${paramIndex}`);
    params.push(input.description);
    paramIndex++;
  }
  if (input.icon !== undefined) {
    updates.push(`icon = $${paramIndex}`);
    params.push(input.icon);
    paramIndex++;
  }
  if (input.color !== undefined) {
    updates.push(`color = $${paramIndex}`);
    params.push(input.color);
    paramIndex++;
  }
  if (input.parentNotebookId !== undefined) {
    updates.push(`parent_notebook_id = $${paramIndex}`);
    params.push(input.parentNotebookId);
    paramIndex++;
  }
  if (input.sortOrder !== undefined) {
    updates.push(`sort_order = $${paramIndex}`);
    params.push(input.sortOrder);
    paramIndex++;
  }

  if (updates.length === 0) {
    // Nothing to update, just return current notebook
    return getNotebook(pool, notebookId, userEmail);
  }

  params.push(notebookId);

  const result = await pool.query(
    `UPDATE notebook
     SET ${updates.join(', ')}
     WHERE id = $${paramIndex} AND deleted_at IS NULL
     RETURNING
       id::text, user_email, name, description, icon, color,
       parent_notebook_id::text, sort_order, is_archived, deleted_at,
       created_at, updated_at`,
    params,
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapRowToNotebook(result.rows[0]);
}

/**
 * Archives a notebook
 */
export async function archiveNotebook(pool: Pool, notebookId: string, userEmail: string): Promise<Notebook | null> {
  const isOwner = await userOwnsNotebook(pool, notebookId, userEmail);
  if (!isOwner) {
    const exists = await pool.query('SELECT id FROM notebook WHERE id = $1 AND deleted_at IS NULL', [notebookId]);
    if (exists.rows.length === 0) {
      return null;
    }
    throw new Error('FORBIDDEN');
  }

  const result = await pool.query(
    `UPDATE notebook
     SET is_archived = true
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING
       id::text, user_email, name, description, icon, color,
       parent_notebook_id::text, sort_order, is_archived, deleted_at,
       created_at, updated_at`,
    [notebookId],
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapRowToNotebook(result.rows[0]);
}

/**
 * Unarchives a notebook
 */
export async function unarchiveNotebook(pool: Pool, notebookId: string, userEmail: string): Promise<Notebook | null> {
  const isOwner = await userOwnsNotebook(pool, notebookId, userEmail);
  if (!isOwner) {
    const exists = await pool.query('SELECT id FROM notebook WHERE id = $1 AND deleted_at IS NULL', [notebookId]);
    if (exists.rows.length === 0) {
      return null;
    }
    throw new Error('FORBIDDEN');
  }

  const result = await pool.query(
    `UPDATE notebook
     SET is_archived = false
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING
       id::text, user_email, name, description, icon, color,
       parent_notebook_id::text, sort_order, is_archived, deleted_at,
       created_at, updated_at`,
    [notebookId],
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapRowToNotebook(result.rows[0]);
}

/**
 * Soft deletes a notebook
 */
export async function deleteNotebook(pool: Pool, notebookId: string, userEmail: string, deleteNotes = false): Promise<boolean> {
  const isOwner = await userOwnsNotebook(pool, notebookId, userEmail);
  if (!isOwner) {
    const exists = await pool.query('SELECT id FROM notebook WHERE id = $1 AND deleted_at IS NULL', [notebookId]);
    if (exists.rows.length === 0) {
      throw new Error('NOT_FOUND');
    }
    throw new Error('FORBIDDEN');
  }

  // Handle notes in the notebook
  if (deleteNotes) {
    // Soft delete all notes in the notebook
    await pool.query(`UPDATE note SET deleted_at = NOW() WHERE notebook_id = $1 AND deleted_at IS NULL`, [notebookId]);
  } else {
    // Move notes to root (null notebook)
    await pool.query(`UPDATE note SET notebook_id = NULL WHERE notebook_id = $1 AND deleted_at IS NULL`, [notebookId]);
  }

  // Move child notebooks to parent of deleted notebook (or root)
  const notebookResult = await pool.query('SELECT parent_notebook_id FROM notebook WHERE id = $1', [notebookId]);
  const parentId = notebookResult.rows[0]?.parent_notebook_id ?? null;

  await pool.query(`UPDATE notebook SET parent_notebook_id = $1 WHERE parent_notebook_id = $2 AND deleted_at IS NULL`, [parentId, notebookId]);

  // Soft delete the notebook
  const result = await pool.query(`UPDATE notebook SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL`, [notebookId]);

  return (result.rowCount ?? 0) > 0;
}

/**
 * Moves or copies notes to a notebook
 */
export async function moveNotesToNotebook(pool: Pool, notebookId: string, input: MoveNotesInput, userEmail: string): Promise<MoveNotesResult> {
  // Verify user owns target notebook
  const isOwner = await userOwnsNotebook(pool, notebookId, userEmail);
  if (!isOwner) {
    const exists = await pool.query('SELECT id FROM notebook WHERE id = $1 AND deleted_at IS NULL', [notebookId]);
    if (exists.rows.length === 0) {
      throw new Error('NOT_FOUND');
    }
    throw new Error('FORBIDDEN');
  }

  const moved: string[] = [];
  const failed: string[] = [];

  for (const noteId of input.noteIds) {
    try {
      // Check if user owns the note
      const noteResult = await pool.query(
        'SELECT user_email, title, content, tags, visibility, hide_from_agents, summary, is_pinned FROM note WHERE id = $1 AND deleted_at IS NULL',
        [noteId],
      );

      if (noteResult.rows.length === 0) {
        failed.push(noteId);
        continue;
      }

      if (noteResult.rows[0].user_email !== userEmail) {
        failed.push(noteId);
        continue;
      }

      if (input.action === 'move') {
        // Move: update notebook_id
        await pool.query(`UPDATE note SET notebook_id = $1 WHERE id = $2`, [notebookId, noteId]);
        moved.push(noteId);
      } else {
        // Copy: insert new note
        const note = noteResult.rows[0];
        const copyResult = await pool.query(
          `INSERT INTO note (user_email, notebook_id, title, content, tags, visibility, hide_from_agents, summary, is_pinned)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING id::text`,
          [userEmail, notebookId, note.title, note.content, note.tags, note.visibility, note.hide_from_agents, note.summary, note.is_pinned],
        );
        moved.push(copyResult.rows[0].id);
      }
    } catch {
      failed.push(noteId);
    }
  }

  return { moved, failed };
}

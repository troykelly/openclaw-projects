/**
 * Note versions API service.
 * Part of Epic #337, Issue #347
 */

import type { Pool } from 'pg';
import { userCanAccessNote } from './service.ts';

/** A note version from the database */
export interface NoteVersion {
  id: string;
  noteId: string;
  versionNumber: number;
  title: string;
  content: string;
  summary: string | null;
  changedByEmail: string | null;
  changeType: string;
  contentLength: number;
  createdAt: Date;
}

/** Brief version info for listings */
export interface NoteVersionSummary {
  id: string;
  versionNumber: number;
  title: string;
  changedByEmail: string | null;
  changeType: string;
  contentLength: number;
  createdAt: Date;
}

/** Diff result between versions */
export interface DiffResult {
  titleChanged: boolean;
  titleDiff: string | null;
  contentChanged: boolean;
  contentDiff: string;
  stats: {
    additions: number;
    deletions: number;
    changes: number;
  };
}

/** Options for listing versions */
export interface ListVersionsOptions {
  limit?: number;
  offset?: number;
}

/** Result of listing versions */
export interface ListVersionsResult {
  noteId: string;
  currentVersion: number;
  versions: NoteVersionSummary[];
  total: number;
}

/** Result of comparing versions */
export interface CompareVersionsResult {
  noteId: string;
  from: {
    versionNumber: number;
    title: string;
    createdAt: Date;
  };
  to: {
    versionNumber: number;
    title: string;
    createdAt: Date;
  };
  diff: DiffResult;
}

/** Result of restoring a version */
export interface RestoreVersionResult {
  noteId: string;
  restoredFromVersion: number;
  newVersion: number;
  title: string;
  message: string;
}

/**
 * Maps database row to NoteVersion
 */
function mapRowToVersion(row: Record<string, unknown>): NoteVersion {
  return {
    id: row.id as string,
    noteId: row.note_id as string,
    versionNumber: row.version_number as number,
    title: row.title as string,
    content: row.content as string,
    summary: row.summary as string | null,
    changedByEmail: row.changed_by_email as string | null,
    changeType: row.change_type as string,
    contentLength: (row.content as string)?.length ?? 0,
    createdAt: new Date(row.created_at as string),
  };
}

/**
 * Maps database row to NoteVersionSummary (without content)
 */
function mapRowToVersionSummary(row: Record<string, unknown>): NoteVersionSummary {
  return {
    id: row.id as string,
    versionNumber: row.version_number as number,
    title: row.title as string,
    changedByEmail: row.changed_by_email as string | null,
    changeType: row.change_type as string,
    contentLength: row.content_length !== undefined ? Number(row.content_length) : ((row.content as string)?.length ?? 0),
    createdAt: new Date(row.created_at as string),
  };
}

/**
 * Gets the current version number for a note
 */
async function getCurrentVersionNumber(pool: Pool, noteId: string): Promise<number> {
  const result = await pool.query(`SELECT MAX(version_number) as version FROM note_version WHERE note_id = $1`, [noteId]);
  return result.rows[0]?.version ?? 0;
}

/**
 * Lists versions for a note with pagination
 */
export async function listVersions(pool: Pool, noteId: string, userEmail: string, options: ListVersionsOptions = {}): Promise<ListVersionsResult | null> {
  // Check access
  const canAccess = await userCanAccessNote(pool, noteId, userEmail, 'read');
  if (!canAccess) {
    return null;
  }

  const limit = Math.min(options.limit ?? 50, 100);
  const offset = options.offset ?? 0;

  // Get current version number
  const currentVersion = await getCurrentVersionNumber(pool, noteId);

  // Get total count
  const countResult = await pool.query(`SELECT COUNT(*) as total FROM note_version WHERE note_id = $1`, [noteId]);
  const total = parseInt((countResult.rows[0] as { total: string }).total, 10);

  // Get versions
  const result = await pool.query(
    `SELECT
      id::text, note_id::text, version_number, title,
      changed_by_email, change_type, LENGTH(content) as content_length, created_at
    FROM note_version
    WHERE note_id = $1
    ORDER BY version_number DESC
    LIMIT $2 OFFSET $3`,
    [noteId, limit, offset],
  );

  return {
    noteId,
    currentVersion,
    versions: result.rows.map(mapRowToVersionSummary),
    total,
  };
}

/**
 * Gets a specific version with full content
 */
export async function getVersion(pool: Pool, noteId: string, versionNumber: number, userEmail: string): Promise<NoteVersion | null> {
  // Check access
  const canAccess = await userCanAccessNote(pool, noteId, userEmail, 'read');
  if (!canAccess) {
    return null;
  }

  const result = await pool.query(
    `SELECT
      id::text, note_id::text, version_number, title, content, summary,
      changed_by_email, change_type, created_at
    FROM note_version
    WHERE note_id = $1 AND version_number = $2`,
    [noteId, versionNumber],
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapRowToVersion(result.rows[0]);
}

/**
 * Generates a unified diff between two strings
 * Simple implementation without external dependency
 */
function generateUnifiedDiff(fromContent: string, toContent: string, fromLabel: string, toLabel: string): string {
  const fromLines = fromContent.split('\n');
  const toLines = toContent.split('\n');

  const diff: string[] = [];
  diff.push(`--- ${fromLabel}`);
  diff.push(`+++ ${toLabel}`);

  // Simple line-by-line diff (Myers algorithm would be better for production)
  const maxLen = Math.max(fromLines.length, toLines.length);
  let hunkStart = -1;
  let hunkLines: string[] = [];

  const flushHunk = () => {
    if (hunkLines.length > 0) {
      diff.push(`@@ -${hunkStart + 1},${fromLines.length} +${hunkStart + 1},${toLines.length} @@`);
      diff.push(...hunkLines);
      hunkLines = [];
    }
  };

  for (let i = 0; i < maxLen; i++) {
    const fromLine = i < fromLines.length ? fromLines[i] : null;
    const toLine = i < toLines.length ? toLines[i] : null;

    if (fromLine === toLine) {
      if (hunkLines.length > 0) {
        hunkLines.push(` ${fromLine ?? ''}`);
        if (hunkLines.filter((l) => l.startsWith('+') || l.startsWith('-')).length === 0) {
          hunkLines = [];
        }
      }
    } else {
      if (hunkStart === -1) {
        hunkStart = Math.max(0, i - 3);
        // Add context lines before
        for (let j = hunkStart; j < i; j++) {
          if (j < fromLines.length) {
            hunkLines.push(` ${fromLines[j]}`);
          }
        }
      }

      if (fromLine !== null && (toLine === null || fromLine !== toLine)) {
        hunkLines.push(`-${fromLine}`);
      }
      if (toLine !== null && (fromLine === null || fromLine !== toLine)) {
        hunkLines.push(`+${toLine}`);
      }
    }
  }

  flushHunk();

  return diff.join('\n');
}

/**
 * Calculates diff statistics
 */
function calculateDiffStats(fromContent: string, toContent: string): { additions: number; deletions: number; changes: number } {
  const fromLines = new Set(fromContent.split('\n'));
  const toLines = new Set(toContent.split('\n'));

  let additions = 0;
  let deletions = 0;

  for (const line of fromLines) {
    if (!toLines.has(line)) {
      deletions++;
    }
  }

  for (const line of toLines) {
    if (!fromLines.has(line)) {
      additions++;
    }
  }

  const changes = Math.min(additions, deletions);

  return {
    additions: additions - changes,
    deletions: deletions - changes,
    changes,
  };
}

/**
 * Compares two versions and returns a diff
 */
export async function compareVersions(
  pool: Pool,
  noteId: string,
  fromVersionNum: number,
  toVersionNum: number,
  userEmail: string,
): Promise<CompareVersionsResult | null> {
  // Check access
  const canAccess = await userCanAccessNote(pool, noteId, userEmail, 'read');
  if (!canAccess) {
    return null;
  }

  // Get both versions
  const result = await pool.query(
    `SELECT
      id::text, note_id::text, version_number, title, content, summary,
      changed_by_email, change_type, created_at
    FROM note_version
    WHERE note_id = $1 AND version_number IN ($2, $3)
    ORDER BY version_number`,
    [noteId, fromVersionNum, toVersionNum],
  );

  if (result.rows.length !== 2) {
    return null; // One or both versions not found
  }

  const [fromRow, toRow] = fromVersionNum < toVersionNum ? [result.rows[0], result.rows[1]] : [result.rows[1], result.rows[0]];

  const fromVersion = mapRowToVersion(fromRow);
  const toVersion = mapRowToVersion(toRow);

  const titleChanged = fromVersion.title !== toVersion.title;
  const contentChanged = fromVersion.content !== toVersion.content;

  const titleDiff = titleChanged ? generateUnifiedDiff(fromVersion.title, toVersion.title, 'from', 'to') : null;

  const contentDiff = generateUnifiedDiff(fromVersion.content, toVersion.content, `v${fromVersion.versionNumber}`, `v${toVersion.versionNumber}`);

  const stats = calculateDiffStats(fromVersion.content, toVersion.content);

  return {
    noteId,
    from: {
      versionNumber: fromVersion.versionNumber,
      title: fromVersion.title,
      createdAt: fromVersion.createdAt,
    },
    to: {
      versionNumber: toVersion.versionNumber,
      title: toVersion.title,
      createdAt: toVersion.createdAt,
    },
    diff: {
      titleChanged,
      titleDiff,
      contentChanged,
      contentDiff,
      stats,
    },
  };
}

/**
 * Restores a note to a previous version
 * This creates a new version with the old content (non-destructive)
 */
export async function restoreVersion(pool: Pool, noteId: string, versionNumber: number, userEmail: string): Promise<RestoreVersionResult | null> {
  // Check write access
  const canWrite = await userCanAccessNote(pool, noteId, userEmail, 'read_write');
  if (!canWrite) {
    // Check if note exists
    const exists = await pool.query('SELECT id FROM note WHERE id = $1 AND deleted_at IS NULL', [noteId]);
    if (exists.rows.length === 0) {
      return null; // 404
    }
    throw new Error('FORBIDDEN');
  }

  // Get the version to restore
  const versionResult = await pool.query(`SELECT title, content, summary FROM note_version WHERE note_id = $1 AND version_number = $2`, [
    noteId,
    versionNumber,
  ]);

  if (versionResult.rows.length === 0) {
    throw new Error('VERSION_NOT_FOUND');
  }

  const version = versionResult.rows[0];

  // Set session user for version tracking
  await pool.query(`SELECT set_config('app.current_user_email', $1, true)`, [userEmail]);

  // Update the note with version content
  // This will trigger the version creation trigger automatically
  await pool.query(`UPDATE note SET title = $1, content = $2, summary = $3 WHERE id = $4`, [version.title, version.content, version.summary, noteId]);

  // Get the new version number
  const newVersion = await getCurrentVersionNumber(pool, noteId);

  // Update the new version's metadata to indicate restore
  await pool.query(`UPDATE note_version SET change_type = 'restore' WHERE note_id = $1 AND version_number = $2`, [noteId, newVersion]);

  return {
    noteId,
    restoredFromVersion: versionNumber,
    newVersion,
    title: version.title,
    message: `Note restored to version ${versionNumber}`,
  };
}

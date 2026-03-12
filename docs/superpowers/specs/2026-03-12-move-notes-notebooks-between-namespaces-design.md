# Design: Move Notes / Notebooks Between Namespaces

**Date:** 2026-03-12
**Feature:** Move notebooks and notes between namespaces
**Approach:** Dedicated move services (Approach B)

---

## Overview

Users (via the UI) and agents (via plugin functions) need to move notes and notebooks from one namespace to another. The backend already exposes `PATCH /notes/:id/namespace` and `PATCH /notebooks/:id/namespace` routes backed by a generic `moveEntityNamespace()` handler. This epic enhances both routes with dedicated service functions, adds a bulk move endpoint, builds the frontend UI, adds agent plugin tools, and ensures comprehensive test coverage.

**Key invariants enforced by this feature:**

- Moving a **note** requires a `target_notebook_id` (required, never null). Notes are never detached from a notebook by a move.
- Moving a **notebook** recursively moves all descendant notebooks and all their notes. Moved notebooks land at the **root level** of the target namespace (no `target_parent_notebook_id`; the hierarchy is preserved internally but the top-most moved notebook becomes a root notebook in the target).
- Moving any note or notebook **permanently deletes all sharing settings** (`note_share`, `notebook_share`, `note_collaborator`). This is intentional, non-configurable, and must be surfaced prominently in every user-facing and developer-facing surface.
- All active Yjs collaboration sessions are invalidated on move; `note_yjs_state` rows are deleted. Clients must reload to resume editing.

---

## Architecture

### Service Delegation

The existing generic `moveEntityNamespace()` handler in `server.ts` gains a delegation path: when the entity type is `note` or `notebook`, it calls a dedicated service function instead of the generic SQL path.

```
PATCH /notes/:id/namespace       →  moveEntityNamespace() → moveNote()
PATCH /notebooks/:id/namespace   →  moveEntityNamespace() → moveNotebook()
POST  /notes/bulk-move-namespace →  bulkMoveNotes()  (new endpoint)
```

### New Service Functions

**`src/api/notes/service.ts`**
```typescript
moveNote(
  pool: Pool,
  noteId: string,
  targetNamespace: string,
  targetNotebookId: string,   // required, never null
  actorNamespaces: string[],
  actorEmail: string
): Promise<MoveNoteResult>
```

**`src/api/notebooks/service.ts`**
```typescript
moveNotebook(
  pool: Pool,
  notebookId: string,
  targetNamespace: string,    // moved notebook becomes root-level in target namespace
  actorNamespaces: string[],
  actorEmail: string
): Promise<MoveNotebookResult>
```

---

## Database Schema Changes

**Migration: `094_note_namespace_move.up.sql`**

### 1. Add `namespace_move` to `audit_action_type` enum
```sql
ALTER TYPE audit_action_type ADD VALUE IF NOT EXISTS 'namespace_move';
```

### 2. Fix `note_version.change_type` CHECK constraint

The `change_type` column is a `text` with a CHECK constraint (not a PostgreSQL enum type). Add `'namespace_move'` by replacing the constraint:

```sql
ALTER TABLE note_version
  DROP CONSTRAINT note_version_change_type_check;

ALTER TABLE note_version
  ADD CONSTRAINT note_version_change_type_check
    CHECK (change_type IN ('create', 'edit', 'restore', 'auto_save', 'namespace_move'));
```

### 3. New database function `move_notebook_recursive()`

```sql
CREATE OR REPLACE FUNCTION move_notebook_recursive(
  p_notebook_id  uuid,
  p_target_ns    text,
  p_actor_email  text
) RETURNS TABLE(moved_notebook_ids uuid[], moved_note_ids uuid[], share_delete_count int)
LANGUAGE plpgsql AS $$
DECLARE
  v_max_depth CONSTANT int := 100;
  v_notebook_ids uuid[];
  v_note_ids uuid[];
  v_depth_exceeded boolean;
BEGIN
  -- Collect all descendant notebooks (depth-limited)
  WITH RECURSIVE descendants AS (
    SELECT id, 0 AS depth FROM notebook WHERE id = p_notebook_id
    UNION ALL
    SELECT n.id, d.depth + 1
    FROM notebook n
    JOIN descendants d ON n.parent_notebook_id = d.id
    WHERE d.depth < v_max_depth
  )
  SELECT array_agg(id) INTO v_notebook_ids FROM descendants;

  -- Error if any notebook exists beyond the depth limit
  SELECT EXISTS (
    WITH RECURSIVE full_tree AS (
      SELECT id, 0 AS depth FROM notebook WHERE id = p_notebook_id
      UNION ALL
      SELECT n.id, ft.depth + 1
      FROM notebook n JOIN full_tree ft ON n.parent_notebook_id = ft.id
      WHERE ft.depth < v_max_depth + 1
    )
    SELECT 1 FROM full_tree WHERE depth >= v_max_depth
  ) INTO v_depth_exceeded;

  IF v_depth_exceeded THEN
    RAISE EXCEPTION 'notebook_hierarchy_too_deep: hierarchy exceeds maximum depth of %', v_max_depth;
  END IF;

  -- Move all notebooks to target namespace; top-level notebook becomes root (null parent)
  UPDATE notebook
  SET namespace = p_target_ns,
      parent_notebook_id = CASE WHEN id = p_notebook_id THEN NULL ELSE parent_notebook_id END
  WHERE id = ANY(v_notebook_ids);

  -- Collect and move all notes
  SELECT array_agg(id) INTO v_note_ids
  FROM note WHERE notebook_id = ANY(v_notebook_ids) AND deleted_at IS NULL;

  UPDATE note SET namespace = p_target_ns WHERE id = ANY(v_note_ids);

  -- Delete shares (note_share + notebook_share only; collaborators handled separately)
  DELETE FROM note_share WHERE note_id = ANY(v_note_ids);
  DELETE FROM notebook_share WHERE notebook_id = ANY(v_notebook_ids);

  -- Clear Yjs collaboration state for all moved notes
  DELETE FROM note_yjs_state WHERE note_id = ANY(v_note_ids);

  -- Return result (collaborator rows deleted in application layer for count accuracy)
  RETURN QUERY SELECT v_notebook_ids, v_note_ids,
    (SELECT count(*)::int FROM note_share WHERE note_id = ANY(v_note_ids))
    + (SELECT count(*)::int FROM notebook_share WHERE notebook_id = ANY(v_notebook_ids));
END;
$$;
```

**No new tables.** No RLS changes (access control is application-layer via `namespace_grant`).

### 4. `shares_deleted` count definition

`shares_deleted` in all responses counts **`note_share` + `notebook_share` rows deleted only**. `note_collaborator` rows are presence markers; they are cleared but counted separately in `collaborators_cleared` (a separate response field). This avoids misleading counts.

---

## Transaction Sequences

### `moveNote` Transaction

1. Validate `targetNotebookId` is not null/empty — return 400 otherwise
2. `SELECT ... FOR UPDATE` — lock note
3. Validate actor has write access to source namespace (via `namespace_grant`)
4. Validate actor has write access to target namespace
5. Validate target notebook:
   ```sql
   SELECT id FROM notebook
   WHERE id = $targetNotebookId
     AND namespace = $targetNamespace
     AND deleted_at IS NULL
   FOR UPDATE;
   -- If not found: 404 "Target notebook not found in target namespace"
   -- Then: verify namespace_grant(actor, targetNamespace, 'write') — already done in step 4
   ```
6. `UPDATE note SET namespace = $target, notebook_id = $targetNotebook WHERE id = $id`
7. `DELETE FROM note_share WHERE note_id = $id` → capture count
8. `DELETE FROM note_collaborator WHERE note_id = $id` → capture count for `collaborators_cleared`
9. `DELETE FROM note_yjs_state WHERE note_id = $id`
10. `INSERT INTO note_version (note_id, change_type, ...) VALUES (..., 'namespace_move', ...)`
11. `INSERT INTO audit_log (action = 'namespace_move', ...)`
12. COMMIT

### `moveNotebook` Transaction

1. `SELECT ... FOR UPDATE` — lock notebook
2. Validate actor write access on source + target namespaces
3. Call `move_notebook_recursive(notebookId, targetNamespace, actorEmail)` in same transaction
4. If function raises `notebook_hierarchy_too_deep` → rollback, return 422 with clear message
5. Receive `moved_notebook_ids`, `moved_note_ids`, `shares_deleted`
6. `DELETE FROM note_collaborator WHERE note_id = ANY(moved_note_ids)` → capture `collaborators_cleared`
7. Batch insert audit log rows (action = `'namespace_move'`) for all moved notebooks + notes
8. COMMIT

### `bulkMoveNotes` — Best-Effort (loop, not single transaction)

Each note is moved in its own mini-transaction using `moveNote()`. This avoids ACID single-transaction contradiction:

1. Validate request: `note_ids` not empty, `target_namespace` + `target_notebook_id` provided
2. Deduplicate `note_ids` — if duplicates found, return 400 with list of duplicate IDs
3. If `note_ids.length > 500` return 400 "Maximum 500 notes per bulk move"
4. For each note_id: call `moveNote()` in its own transaction
5. Collect successes and per-note errors
6. Return `{ moved: N, shares_deleted: N, collaborators_cleared: N, errors: [{id, reason}] }`

Notes that succeed are committed immediately; failures do not roll back other notes.

---

## API Changes

### Breaking Change Notice

`PATCH /notes/:id/namespace` now **requires** `target_notebook_id`. Requests without it return:
```json
{ "error": "target_notebook_id is required when moving a note" }
```
HTTP 400. There is no versioning; existing callers must be updated. The plugin tools and frontend are updated as part of this epic. The OpenAPI spec documents this as a required field.

### `PATCH /notes/:id/namespace` — body extended

```json
{
  "target_namespace": "work-projects",
  "target_notebook_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6"
}
```

Response:
```json
{
  "id": "...",
  "namespace": "work-projects",
  "previous_namespace": "personal",
  "previous_notebook_id": "...",
  "shares_deleted": 3,
  "collaborators_cleared": 1
}
```

### `PATCH /notebooks/:id/namespace` — body unchanged, response extended

```json
{
  "id": "...",
  "namespace": "work-projects",
  "previous_namespace": "personal",
  "moved_notebook_count": 4,
  "moved_note_count": 12,
  "shares_deleted": 7,
  "collaborators_cleared": 2
}
```

### `POST /notes/bulk-move-namespace` — new endpoint

```json
// Request
{
  "note_ids": ["uuid1", "uuid2"],        // max 500; duplicates rejected with 400
  "target_namespace": "work-projects",
  "target_notebook_id": "uuid"
}

// Response
{
  "moved": 2,
  "shares_deleted": 5,
  "collaborators_cleared": 1,
  "errors": []
}
```

### OpenAPI Documentation

All three move endpoints get a prominent destructive warning:

> ⚠️ **DESTRUCTIVE — SHARES AND COLLABORATION STATE ARE PERMANENTLY DELETED**
> Moving a note or notebook permanently deletes all `note_share`, `notebook_share`, and `note_collaborator` rows, and clears all Yjs collaboration state (`note_yjs_state`). This cannot be undone. Active collaborators will be disconnected and must reload. Callers must inform users before invoking this endpoint.

---

## Agent Plugin Tools

Three new tools added to `packages/openclaw-plugin/`:

### `note_move_namespace`
```typescript
{
  name: "note_move_namespace",
  description: `Move a note to a different namespace.

⚠️ DESTRUCTIVE — SHARES PERMANENTLY DELETED:
All sharing links, collaborator access, and active editing sessions for this
note are permanently deleted when it is moved. This cannot be undone.

Required: target_notebook_id must exist and be undeleted in the target namespace.
The note cannot be moved without specifying a target notebook.`,
  parameters: {
    note_id: string,
    target_namespace: string,
    target_notebook_id: string  // required, never null
  }
}
```

### `notebook_move_namespace`
```typescript
{
  name: "notebook_move_namespace",
  description: `Move a notebook (and ALL its descendant notebooks and notes) to a different namespace.

⚠️ DESTRUCTIVE — ALL SHARES PERMANENTLY DELETED:
ALL sharing links, collaborator access, and active editing sessions for the
notebook AND every note and nested notebook inside it are permanently deleted.
This cannot be undone.

The notebook becomes a root-level notebook in the target namespace (its
internal hierarchy is preserved, but it has no parent in the target).
Maximum hierarchy depth: 100 levels.`,
  parameters: {
    notebook_id: string,
    target_namespace: string
  }
}
```

### `note_bulk_move_namespace`
```typescript
{
  name: "note_bulk_move_namespace",
  description: `Move multiple notes to a different namespace in one operation (best-effort).

⚠️ DESTRUCTIVE — ALL SHARES PERMANENTLY DELETED:
All sharing links for all successfully moved notes are permanently deleted.

Notes are moved one at a time; partial failures return per-note errors.
Successfully moved notes are NOT rolled back if later notes fail.
Maximum 500 notes per call. Duplicate note_ids are rejected.`,
  parameters: {
    note_ids: string[],         // max 500, no duplicates
    target_namespace: string,
    target_notebook_id: string  // required
  }
}
```

---

## Frontend UI

### Entry Points

| Surface | Action |
|---------|--------|
| Note detail view (`note-detail.tsx`) | Overflow/kebab menu → "Move to namespace…" |
| Note card (`note-card.tsx`) | Right-click context menu + overflow menu |
| Notebook sidebar (`notebooks-sidebar.tsx`) | Right-click / overflow menu on notebook row |
| Notes list bulk selection bar | "Move selected to namespace…" (max 500 selected) |

### `MoveToNamespaceDialog` Component

**Location:** `src/ui/components/notes/move/MoveToNamespaceDialog.tsx`

**Two-step flow:**

**Step 1 — Namespace selection:**
- Uses existing `namespace-picker.tsx`
- Shows only namespaces the user has write access to
- Excludes the current namespace
- For notebook moves: shows impact preview before the user advances:
  ```
  This will move "Project Notes" and:
    • 3 child notebooks
    • 47 notes
    • Delete 12 sharing links and 2 active collaborator sessions
  ```

**Step 2 — Target notebook selection:**
- Searchable list of notebooks in the selected target namespace
- Shows note counts per notebook
- Required — confirm button disabled until a notebook is selected

**Destructive warning (non-dismissable until acknowledged):**
```
⚠️  Moving will permanently delete all sharing links and
    collaborator access. Active collaborators will be disconnected.
    This cannot be undone.
    [ ] I understand that all sharing will be permanently removed
```
Confirm button disabled until checkbox is ticked (in addition to notebook selection requirement).

**Bulk move UI limits:**
- Maximum 500 notes selectable for bulk move; UI disables "Move selected" if count exceeds 500 and shows: "Select 500 or fewer notes to bulk move"
- After bulk move, a toast shows: "X of Y notes moved successfully" with a "See details" link if any errors occurred

**Reuses:** `namespace-picker.tsx`, `Dialog`, `Button`, `Checkbox` from shadcn/ui.

### i18n

Check `src/ui/locales/` for all locale files present. Add `notes.move.*` and `notebooks.move.*` keys to **every locale file** found. The `en.json` keys serve as the canonical reference; other locales use the same English strings as placeholders if machine translation is not available, with a TODO comment.

All new strings added under:
- `notes.move.*`
- `notebooks.move.*`

---

## TDD Plan — Backend (Integration Tests, Real Postgres)

1. `moveNote` — note moves to correct namespace + notebook; `note_share` rows deleted; `note_collaborator` rows deleted; `note_yjs_state` rows deleted; `note_version` row created with `change_type = 'namespace_move'`; audit log row inserted
2. `moveNote` — rejects with 400 when `targetNotebookId` is null or missing
3. `moveNote` — rejects with 403 when actor lacks write access to source namespace
4. `moveNote` — rejects with 403 when actor lacks write access to target namespace
5. `moveNote` — rejects with 404 when `targetNotebookId` does not exist in target namespace
6. `moveNote` — rejects with 404 when `targetNotebookId` exists but is in wrong namespace
7. `moveNote` — rejects with 404 when `targetNotebookId` exists but is soft-deleted
8. `moveNotebook` — moves notebook + all descendant notebooks recursively; moves all notes; deletes all shares + Yjs state; audit row count matches moved entity count; moved notebook has `parent_notebook_id = NULL` in target
9. `moveNotebook` — depth limit: hierarchy at exactly 100 levels succeeds; hierarchy at 101 levels returns 422 with `notebook_hierarchy_too_deep`
10. `moveNotebook` — locked notebook returns conflict error; transaction rolls back cleanly
11. Bulk move — 2 notes moved successfully in best-effort mode; per-note error returned for a locked note without rolling back other successes
12. Bulk move — duplicate `note_ids` returns 400 listing duplicates
13. Bulk move — 501 note IDs returns 400 "Maximum 500 notes per bulk move"
14. Share reset verified: after any move, `note_share` + `notebook_share` count for all moved entities = 0
15. Yjs state cleared: after any move, `note_yjs_state` count for all moved notes = 0

---

## TDD Plan — Frontend (Vitest + Testing Library)

1. `MoveToNamespaceDialog` — Step 1 shows only writable namespaces, excludes current namespace
2. `MoveToNamespaceDialog` — Step 2 loads notebooks for the selected target namespace
3. `MoveToNamespaceDialog` — confirm button disabled until warning checkbox is ticked
4. `MoveToNamespaceDialog` — confirm button disabled until a target notebook is selected
5. `MoveToNamespaceDialog` — notebook move shows correct preview counts (child notebooks, notes, shares to delete, collaborators to clear)
6. `MoveToNamespaceDialog` — on confirm: submits correct payload, shows success toast, closes dialog
7. `MoveToNamespaceDialog` — API error renders inline error message, does not close dialog
8. Note card overflow menu — "Move to namespace" item present and opens dialog
9. Bulk action bar — "Move selected" disabled when selection > 500; enabled and calls bulk endpoint when ≤ 500
10. Bulk action bar — after partial failure, toast shows "X of Y moved; see details"
11. i18n — all `notes.move.*` and `notebooks.move.*` keys present in `en.json`

---

## Database Seeding Requirements

The existing namespace seeder gains a fixture:
- Two namespaces, each with ≥1 notebook and ≥3 notes (some nested)
- At least one `note_share` and one `notebook_share` present in the source namespace
- At least one `note_collaborator` row in the source namespace
- At least one `note_yjs_state` row for a note in the source namespace
- Used to verify share deletion, collaborator clearing, and Yjs state deletion in integration tests

---

## Technical Debt Addressed

1. **Generic handler complexity:** The generic `moveEntityNamespace()` handler was accumulating per-entity edge cases. Extracting dedicated note/notebook services gives proper business-rule enforcement and independent testability.
2. **Shallow notebook cascade:** The current implementation only moves direct child notes — child notebooks are not moved. `move_notebook_recursive()` corrects this correctness gap.
3. **Invisible moves in version history:** `note_change_type` lacked `namespace_move`, making moves invisible in note history. Fixed by the CHECK constraint update.
4. **Missing `namespace_move` in audit enum:** Moves were previously recorded as `'update'` actions with no semantic distinction. Fixed by adding the enum value.
5. **Yjs state orphaning:** Moved notes retained stale Yjs state causing potential sync errors for collaborators. Fixed by clearing state on move.

---

## Out of Scope

- Moving notes/notebooks across different users (cross-user transfer)
- Restoring shares after a move — shares are intentionally reset
- Archiving/backing up shares before deletion
- Migrating active Yjs sessions gracefully (clients disconnect and rejoin)

---

## Omnibus PR Strategy

Per the user's instruction, this epic ships via omnibus PRs — the one issue, one PR requirement is suspended. Each phase must be merged to `main` before the next phase begins (integration tests in later phases depend on earlier phases being live).

| Phase | Issues | PR | Depends On |
|-------|--------|----|------------|
| 1 — DB + Backend services | Schema migration, `moveNote`, `moveNotebook`, bulk endpoint, backend tests | PR-A | — |
| 2 — Plugin tools | Three new agent tools + tool tests | PR-B | PR-A merged |
| 3 — Frontend UI | `MoveToNamespaceDialog`, entry points, i18n, frontend tests | PR-C | PR-A merged |
| 4 — Docs + Review | OpenAPI doc updates, CHANGELOG, Codex review fixes | PR-D | PR-B + PR-C merged |

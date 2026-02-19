/**
 * End-to-End Integration Tests for Notes Feature
 * Part of Epic #338, Issue #627
 *
 * Tests the complete notes workflow including:
 * - Navigation and routing
 * - CRUD operations (notes and notebooks)
 * - Editor features (via API content types)
 * - Search and filtering
 * - Sharing (user and link)
 * - Version history
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { Pool } from 'pg';
import { buildServer } from '../src/api/server.ts';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';
import { getAuthHeaders } from './helpers/auth.ts';

// ---------------------------------------------------------------------------
// Response Type Definitions for E2E Tests (Issue #707)
// ---------------------------------------------------------------------------

/** Note visibility levels */
type NoteVisibility = 'private' | 'shared' | 'public';

/** Share permission level */
type SharePermission = 'read' | 'read_write';

/** Note response from API */
interface NoteResponse {
  id: string;
  notebook_id: string | null;
  user_email: string;
  title: string;
  content: string;
  summary: string | null;
  tags: string[];
  is_pinned: boolean;
  sort_order: number;
  visibility: NoteVisibility;
  hide_from_agents: boolean;
  embedding_status: string;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  notebook?: { id: string; name: string } | null;
  version_count?: number;
}

/** Notebook response from API */
interface NotebookResponse {
  id: string;
  user_email: string;
  name: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  parent_notebook_id: string | null;
  sort_order: number;
  is_archived: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  note_count?: number;
  child_count?: number;
  parent?: { id: string; name: string } | null;
  children?: NotebookResponse[];
  notes?: Array<{ id: string; title: string; updated_at: string }>;
}

/** Note share response (user share) */
interface NoteShareResponse {
  id: string;
  note_id: string;
  type: 'user';
  shared_with_email: string;
  permission: SharePermission;
  expires_at: string | null;
  created_by_email: string;
  created_at: string;
  last_accessed_at: string | null;
}

/** Link share response */
interface LinkShareResponse {
  id: string;
  note_id: string;
  type: 'link';
  token: string;
  permission: SharePermission;
  is_single_view: boolean;
  view_count: number;
  max_views: number | null;
  expires_at: string | null;
  created_by_email: string;
  created_at: string;
  last_accessed_at: string | null;
  url: string;
}

/** Note version response */
interface NoteVersionResponse {
  id: string;
  note_id: string;
  version_number: number;
  title: string;
  content: string;
  summary: string | null;
  changed_by_email: string | null;
  change_type: string;
  content_length: number;
  created_at: string;
}

/** Version comparison diff result */
interface VersionCompareResponse {
  note_id: string;
  from: {
    version_number: number;
    title: string;
    created_at: string;
  };
  to: {
    version_number: number;
    title: string;
    created_at: string;
  };
  diff: {
    title_changed: boolean;
    title_diff: string | null;
    content_changed: boolean;
    content_diff: string;
    stats: {
      additions: number;
      deletions: number;
      changes: number;
    };
  };
}

/** Notes list response */
interface NotesListResponse {
  notes: NoteResponse[];
  total: number;
  limit: number;
  offset: number;
}

/** Notebooks list response */
interface NotebooksListResponse {
  notebooks: NotebookResponse[];
  total: number;
}

/** Notebook tree node */
interface NotebookTreeNode {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  note_count?: number;
  children: NotebookTreeNode[];
}

/** Notebook tree response */
interface NotebookTreeResponse {
  notebooks: NotebookTreeNode[];
}

/** Search result item */
interface SearchResultItem {
  id: string;
  title: string;
  content?: string;
  snippet?: string;
  score?: number;
}

/** Search response */
interface SearchResponse {
  results: SearchResultItem[];
  total?: number;
}

/** Error response */
interface ErrorResponse {
  error: string;
  message?: string;
  status_code?: number;
}

/** Move/copy notes response */
interface MoveNotesResponse {
  moved: string[];
  failed: string[];
}

/** Shared note access response */
interface SharedNoteAccessResponse {
  note: {
    id: string;
    title: string;
    content: string;
    updated_at: string;
  };
  permission: SharePermission;
  shared_by: string;
}

/** Shared with me response (notes) */
interface SharedWithMeNotesResponse {
  notes: Array<{
    id: string;
    title: string;
    shared_by_email: string;
    permission: SharePermission;
    shared_at: string;
  }>;
}

/** Shared with me response (notebooks) */
interface SharedWithMeNotebooksResponse {
  notebooks: Array<{
    id: string;
    name: string;
    shared_by_email: string;
    permission: SharePermission;
    shared_at: string;
  }>;
}

/** Notebook share response */
interface NotebookShareResponse {
  id: string;
  notebook_id: string;
  type: 'user';
  shared_with_email: string;
  permission: SharePermission;
  expires_at: string | null;
  created_by_email: string;
  created_at: string;
  last_accessed_at: string | null;
}

/** Note versions list response */
interface NoteVersionsListResponse {
  note_id: string;
  current_version: number;
  versions: Array<{
    id: string;
    version_number: number;
    title: string;
    changed_by_email: string | null;
    change_type: string;
    content_length: number;
    created_at: string;
  }>;
  total: number;
}

/** Restore version response */
interface RestoreVersionResponse {
  note_id: string;
  restored_from_version: number;
  new_version: number;
  title: string;
  message: string;
}

/**
 * E2E test timeout configuration.
 * E2E tests involve database operations and HTTP requests which can be slow,
 * especially on CI runners. Set explicit timeouts to prevent flaky test failures.
 */
const E2E_TEST_TIMEOUT = 30_000; // 30 seconds per test
const E2E_HOOK_TIMEOUT = 60_000; // 60 seconds for setup/teardown hooks

describe('Notes E2E Integration (Epic #338, Issue #627)', () => {
  // Configure timeout for this test suite
  vi.setConfig({ testTimeout: E2E_TEST_TIMEOUT, hookTimeout: E2E_HOOK_TIMEOUT });

  const app = buildServer();
  let pool: Pool;

  const primaryUser = 'e2e-primary@example.com';
  const secondaryUser = 'e2e-secondary@example.com';
  const tertiaryUser = 'e2e-tertiary@example.com';

  beforeAll(async () => {
    await runMigrate('up');
    pool = createTestPool();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  beforeEach(async () => {
    await truncateAllTables(pool);
    // Epic #1418: recreate user_setting + namespace_grant after truncation
    // (truncateAllTables CASCADE removes namespace_grant via user_setting FK)
    // Tests create notes without x-namespace header → notes go to 'default' namespace
    for (const email of [primaryUser, secondaryUser, tertiaryUser]) {
      await pool.query('INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email', [email]);
      await pool.query('DELETE FROM namespace_grant WHERE email = $1', [email]);
      await pool.query(`INSERT INTO namespace_grant (email, namespace, role, is_default) VALUES ($1, 'default', 'owner', true)`, [email]);
    }
  });

  // Auth helper removed — use getAuthHeaders() from helpers/auth.ts instead

  // ============================================
  // Navigation Tests
  // ============================================

  describe('Navigation', () => {
    it('serves app shell for /app/notes when authenticated', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/app/notes',
        headers: await getAuthHeaders(primaryUser),
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/html/);
      expect(res.body).toContain('data-testid="app-frontend-shell"');
      expect(res.body).toContain('id="root"');
    });

    it('serves app shell for specific note URL when authenticated', async () => {
      // Create a note first
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/notes',
        payload: { user_email: primaryUser, title: 'Navigation Test' },
      });
      const noteId = createRes.json<NoteResponse>().id;

      const res = await app.inject({
        method: 'GET',
        url: `/app/notes/${noteId}`,
        headers: await getAuthHeaders(primaryUser),
      });

      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('data-testid="app-frontend-shell"');
    });

    it('redirects to login when not authenticated', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/app/notes',
      });

      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('Sign in');
    });

    it('serves app shell for notebook-filtered view', async () => {
      // Create a notebook
      const nbRes = await app.inject({
        method: 'POST',
        url: '/api/notebooks',
        payload: { user_email: primaryUser, name: 'Test Notebook' },
      });
      const notebook_id = nbRes.json<NotebookResponse>().id;

      const res = await app.inject({
        method: 'GET',
        url: `/app/notes?notebook=${notebook_id}`,
        headers: await getAuthHeaders(primaryUser),
      });

      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('data-testid="app-frontend-shell"');
    });
  });

  // ============================================
  // Complete CRUD Workflow
  // ============================================

  describe('Complete CRUD Workflow', () => {
    it('creates and manages a complete notebook workflow', async () => {
      // 1. Create a notebook
      const nbRes = await app.inject({
        method: 'POST',
        url: '/api/notebooks',
        payload: {
          user_email: primaryUser,
          name: 'Project Notes',
          description: 'Notes for my project',
          icon: '📁',
          color: '#3b82f6',
        },
      });

      expect(nbRes.statusCode).toBe(201);
      const notebook = nbRes.json<NotebookResponse>();
      expect(notebook.name).toBe('Project Notes');
      expect(notebook.note_count).toBe(0);

      // 2. Create notes in the notebook
      const note1Res = await app.inject({
        method: 'POST',
        url: '/api/notes',
        payload: {
          user_email: primaryUser,
          title: 'Meeting Notes',
          content: '# Meeting Agenda\n\n- Item 1\n- Item 2',
          notebook_id: notebook.id,
          tags: ['meetings', 'work'],
        },
      });

      expect(note1Res.statusCode).toBe(201);
      const note1 = note1Res.json<NoteResponse>();
      expect(note1.notebook_id).toBe(notebook.id);

      const note2Res = await app.inject({
        method: 'POST',
        url: '/api/notes',
        payload: {
          user_email: primaryUser,
          title: 'Action Items',
          content: '## TODO\n\n- [ ] Task 1\n- [ ] Task 2',
          notebook_id: notebook.id,
          tags: ['tasks'],
        },
      });

      expect(note2Res.statusCode).toBe(201);

      // 3. Verify notebook now has 2 notes
      const nbGetRes = await app.inject({
        method: 'GET',
        url: `/api/notebooks/${notebook.id}`,
        query: { user_email: primaryUser, include_notes: 'true' },
      });

      expect(nbGetRes.statusCode).toBe(200);
      expect(nbGetRes.json<NotebookResponse>().notes).toHaveLength(2);

      // 4. Update a note
      const updateRes = await app.inject({
        method: 'PUT',
        url: `/api/notes/${note1.id}`,
        payload: {
          user_email: primaryUser,
          title: 'Updated Meeting Notes',
          content: '# Meeting Agenda (Updated)\n\n- Item 1\n- Item 2\n- Item 3',
        },
      });

      expect(updateRes.statusCode).toBe(200);
      expect(updateRes.json<NoteResponse>().title).toBe('Updated Meeting Notes');

      // 5. Delete a note
      const deleteRes = await app.inject({
        method: 'DELETE',
        url: `/api/notes/${note2Res.json<NoteResponse>().id}`,
        query: { user_email: primaryUser },
      });

      expect(deleteRes.statusCode).toBe(204);

      // 6. Verify soft delete
      const listRes = await app.inject({
        method: 'GET',
        url: '/api/notes',
        query: { user_email: primaryUser, notebook_id: notebook.id },
      });

      expect(listRes.json<NotesListResponse>().notes).toHaveLength(1);

      // 7. Restore the deleted note
      const restoreRes = await app.inject({
        method: 'POST',
        url: `/api/notes/${note2Res.json<NoteResponse>().id}/restore`,
        payload: { user_email: primaryUser },
      });

      expect(restoreRes.statusCode).toBe(200);

      // 8. Verify restore
      const listRes2 = await app.inject({
        method: 'GET',
        url: '/api/notes',
        query: { user_email: primaryUser, notebook_id: notebook.id },
      });

      expect(listRes2.json<NotesListResponse>().notes).toHaveLength(2);

      // 9. Delete the notebook (moves notes to root)
      const nbDeleteRes = await app.inject({
        method: 'DELETE',
        url: `/api/notebooks/${notebook.id}`,
        query: { user_email: primaryUser },
      });

      expect(nbDeleteRes.statusCode).toBe(204);

      // 10. Verify notes are now at root
      const finalListRes = await app.inject({
        method: 'GET',
        url: '/api/notes',
        query: { user_email: primaryUser },
      });

      const notes = finalListRes.json<NotesListResponse>().notes;
      expect(notes).toHaveLength(2);
      expect(notes.every((n) => n.notebook_id === null)).toBe(true);
    });

    it('creates nested notebook hierarchy', async () => {
      // 1. Create root notebook
      const rootRes = await app.inject({
        method: 'POST',
        url: '/api/notebooks',
        payload: { user_email: primaryUser, name: 'Root' },
      });
      const rootId = rootRes.json<NotebookResponse>().id;

      // 2. Create child notebook
      const childRes = await app.inject({
        method: 'POST',
        url: '/api/notebooks',
        payload: {
          user_email: primaryUser,
          name: 'Child',
          parent_notebook_id: rootId,
        },
      });
      const child = childRes.json<NotebookResponse>();
      const childId = child.id;
      expect(child.parent_notebook_id).toBe(rootId);

      // 3. Create grandchild notebook
      const grandchildRes = await app.inject({
        method: 'POST',
        url: '/api/notebooks',
        payload: {
          user_email: primaryUser,
          name: 'Grandchild',
          parent_notebook_id: childId,
        },
      });
      expect(grandchildRes.json<NotebookResponse>().parent_notebook_id).toBe(childId);

      // 4. Get tree view
      const treeRes = await app.inject({
        method: 'GET',
        url: '/api/notebooks/tree',
        query: { user_email: primaryUser },
      });

      expect(treeRes.statusCode).toBe(200);
      const tree = treeRes.json<NotebookTreeResponse>();
      expect(tree.notebooks).toHaveLength(1);
      expect(tree.notebooks[0].name).toBe('Root');
      expect(tree.notebooks[0].children).toHaveLength(1);
      expect(tree.notebooks[0].children[0].name).toBe('Child');
      expect(tree.notebooks[0].children[0].children).toHaveLength(1);
    });

    it('handles note pinning workflow', async () => {
      // Create notes
      const note1Res = await app.inject({
        method: 'POST',
        url: '/api/notes',
        payload: { user_email: primaryUser, title: 'Note 1' },
      });
      const note1 = note1Res.json<NoteResponse>();
      const note1Id = note1.id;

      const note2Res = await app.inject({
        method: 'POST',
        url: '/api/notes',
        payload: { user_email: primaryUser, title: 'Note 2', is_pinned: true },
      });
      const note2 = note2Res.json<NoteResponse>();

      // Verify initial state
      expect(note1.is_pinned).toBe(false);
      expect(note2.is_pinned).toBe(true);

      // Pin note 1
      const pinRes = await app.inject({
        method: 'PUT',
        url: `/api/notes/${note1Id}`,
        payload: { user_email: primaryUser, is_pinned: true },
      });
      expect(pinRes.json<NoteResponse>().is_pinned).toBe(true);

      // List pinned notes
      const pinnedRes = await app.inject({
        method: 'GET',
        url: '/api/notes',
        query: { user_email: primaryUser, is_pinned: 'true' },
      });
      expect(pinnedRes.json<NotesListResponse>().notes).toHaveLength(2);
    });
  });

  // ============================================
  // Editor Content Types
  // ============================================

  describe('Editor Content Types', () => {
    it('handles markdown content correctly', async () => {
      const markdownContent = `# Heading 1

## Heading 2

This is a **bold** and *italic* text.

- List item 1
- List item 2

1. Numbered item 1
2. Numbered item 2

> Blockquote text

\`inline code\`
`;

      const res = await app.inject({
        method: 'POST',
        url: '/api/notes',
        payload: {
          user_email: primaryUser,
          title: 'Markdown Test',
          content: markdownContent,
        },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json<NoteResponse>().content).toBe(markdownContent);
    });

    it('handles code blocks correctly', async () => {
      const codeContent = `# Code Examples

\`\`\`typescript
function hello(name: string): string {
  return \`Hello, \${name}!\`;
}
\`\`\`

\`\`\`python
def hello(name: str) -> str:
    return f"Hello, {name}!"
\`\`\`
`;

      const res = await app.inject({
        method: 'POST',
        url: '/api/notes',
        payload: {
          user_email: primaryUser,
          title: 'Code Block Test',
          content: codeContent,
        },
      });

      expect(res.statusCode).toBe(201);
      const note = res.json<NoteResponse>();
      expect(note.content).toContain('```typescript');
      expect(note.content).toContain('```python');
    });

    it('handles tables correctly', async () => {
      const tableContent = `# Table Example

| Column 1 | Column 2 | Column 3 |
|----------|----------|----------|
| Cell 1   | Cell 2   | Cell 3   |
| Cell 4   | Cell 5   | Cell 6   |
`;

      const res = await app.inject({
        method: 'POST',
        url: '/api/notes',
        payload: {
          user_email: primaryUser,
          title: 'Table Test',
          content: tableContent,
        },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json<NoteResponse>().content).toContain('| Column 1 |');
    });

    it('handles links correctly', async () => {
      const linkContent = `# Links Test

[Example Link](https://example.com)
[Internal Link](/app/notes)

![Image Alt](https://example.com/image.png)
`;

      const res = await app.inject({
        method: 'POST',
        url: '/api/notes',
        payload: {
          user_email: primaryUser,
          title: 'Links Test',
          content: linkContent,
        },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json<NoteResponse>().content).toContain('[Example Link]');
    });

    it('handles mermaid diagrams in content', async () => {
      const mermaidContent = `# Diagram Test

\`\`\`mermaid
graph TD
    A[Start] --> B{Decision}
    B -->|Yes| C[Action 1]
    B -->|No| D[Action 2]
\`\`\`
`;

      const res = await app.inject({
        method: 'POST',
        url: '/api/notes',
        payload: {
          user_email: primaryUser,
          title: 'Mermaid Test',
          content: mermaidContent,
        },
      });

      expect(res.statusCode).toBe(201);
      const mermaidNote = res.json<NoteResponse>();
      expect(mermaidNote.content).toContain('```mermaid');
      expect(mermaidNote.content).toContain('graph TD');
    });

    it('handles LaTeX math in content', async () => {
      const mathContent = `# Math Test

Inline math: $E = mc^2$

Block math:

$$
\\int_{0}^{\\infty} e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}
$$
`;

      const res = await app.inject({
        method: 'POST',
        url: '/api/notes',
        payload: {
          user_email: primaryUser,
          title: 'Math Test',
          content: mathContent,
        },
      });

      expect(res.statusCode).toBe(201);
      const mathNote = res.json<NoteResponse>();
      expect(mathNote.content).toContain('$E = mc^2$');
      expect(mathNote.content).toContain('\\int_{0}');
    });
  });

  // ============================================
  // Search and Filter Workflow
  // ============================================

  describe('Search and Filter Workflow', () => {
    beforeEach(async () => {
      // Create test notes for search
      await app.inject({
        method: 'POST',
        url: '/api/notes',
        payload: {
          user_email: primaryUser,
          title: 'TypeScript Guide',
          content: 'Learn TypeScript programming with examples',
          tags: ['programming', 'typescript'],
          visibility: 'public',
        },
      });

      await app.inject({
        method: 'POST',
        url: '/api/notes',
        payload: {
          user_email: primaryUser,
          title: 'Python Tutorial',
          content: 'Python programming for data science',
          tags: ['programming', 'python'],
          visibility: 'public',
        },
      });

      await app.inject({
        method: 'POST',
        url: '/api/notes',
        payload: {
          user_email: primaryUser,
          title: 'Private Journal',
          content: 'My personal thoughts',
          tags: ['personal'],
          visibility: 'private',
        },
      });
    });

    it('searches notes by content using text search', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/notes/search',
        query: {
          user_email: primaryUser,
          q: 'TypeScript',
          search_type: 'text',
        },
      });

      expect(res.statusCode).toBe(200);
      const result = res.json<SearchResponse>();
      expect(result.results.length).toBeGreaterThan(0);

      const titles = result.results.map((r) => r.title);
      expect(titles).toContain('TypeScript Guide');
    });

    it('filters notes by tags', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/notes',
        query: {
          user_email: primaryUser,
          tags: 'programming',
        },
      });

      expect(res.statusCode).toBe(200);
      const notes = res.json<NotesListResponse>().notes;
      expect(notes).toHaveLength(2);
      expect(notes.every((n) => n.tags.includes('programming'))).toBe(true);
    });

    it('filters notes by visibility', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/notes',
        query: {
          user_email: primaryUser,
          visibility: 'private',
        },
      });

      expect(res.statusCode).toBe(200);
      const visibilityNotes = res.json<NotesListResponse>().notes;
      expect(visibilityNotes).toHaveLength(1);
      expect(visibilityNotes[0].title).toBe('Private Journal');
    });

    it('supports sorting options', async () => {
      const ascRes = await app.inject({
        method: 'GET',
        url: '/api/notes',
        query: {
          user_email: primaryUser,
          sort_by: 'title',
          sort_order: 'asc',
        },
      });

      const descRes = await app.inject({
        method: 'GET',
        url: '/api/notes',
        query: {
          user_email: primaryUser,
          sort_by: 'title',
          sort_order: 'desc',
        },
      });

      expect(ascRes.statusCode).toBe(200);
      expect(descRes.statusCode).toBe(200);

      const ascNotes = ascRes.json<NotesListResponse>().notes;
      const descNotes = descRes.json<NotesListResponse>().notes;

      expect(ascNotes[0].title).toBe(descNotes[descNotes.length - 1].title);
    });

    it('supports pagination', async () => {
      const page1Res = await app.inject({
        method: 'GET',
        url: '/api/notes',
        query: {
          user_email: primaryUser,
          limit: '2',
          offset: '0',
        },
      });

      const page2Res = await app.inject({
        method: 'GET',
        url: '/api/notes',
        query: {
          user_email: primaryUser,
          limit: '2',
          offset: '2',
        },
      });

      expect(page1Res.statusCode).toBe(200);
      expect(page2Res.statusCode).toBe(200);

      const page1 = page1Res.json<NotesListResponse>();
      const page2 = page2Res.json<NotesListResponse>();

      expect(page1.notes).toHaveLength(2);
      expect(page1.total).toBe(3);

      // Page 2 should have remaining notes
      expect(page2.notes.length).toBeLessThanOrEqual(1);

      // No overlap between pages
      const page1Ids = page1.notes.map((n) => n.id);
      const page2Ids = page2.notes.map((n) => n.id);
      const overlap = page1Ids.filter((id) => page2Ids.includes(id));
      expect(overlap).toHaveLength(0);
    });
  });

  // ============================================
  // Complete Sharing Workflow
  // ============================================

  describe('Complete Sharing Workflow', () => {
    it('shares note with another user and verifies access', async () => {
      // 1. Create a note as primary user
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/notes',
        payload: {
          user_email: primaryUser,
          title: 'Shared Document',
          content: 'This is shared content',
          visibility: 'shared',
        },
      });

      const noteId = createRes.json<NoteResponse>().id;

      // 2. Secondary user cannot access yet
      const beforeShareRes = await app.inject({
        method: 'GET',
        url: `/api/notes/${noteId}`,
        query: { user_email: secondaryUser },
      });
      expect(beforeShareRes.statusCode).toBe(404);

      // 3. Share with secondary user
      const shareRes = await app.inject({
        method: 'POST',
        url: `/api/notes/${noteId}/share`,
        payload: {
          user_email: primaryUser,
          email: secondaryUser,
          permission: 'read',
        },
      });

      expect(shareRes.statusCode).toBe(201);
      const share = shareRes.json<NoteShareResponse>();
      expect(share.shared_with_email).toBe(secondaryUser);

      // 4. Secondary user can now access
      const afterShareRes = await app.inject({
        method: 'GET',
        url: `/api/notes/${noteId}`,
        query: { user_email: secondaryUser },
      });
      expect(afterShareRes.statusCode).toBe(200);
      expect(afterShareRes.json<NoteResponse>().title).toBe('Shared Document');

      // 5. Verify in shared-with-me list
      const sharedListRes = await app.inject({
        method: 'GET',
        url: '/api/notes/shared-with-me',
        query: { user_email: secondaryUser },
      });
      expect(sharedListRes.statusCode).toBe(200);
      expect(sharedListRes.json<SharedWithMeNotesResponse>().notes).toHaveLength(1);

      // 6. Secondary user cannot edit with read permission
      const editRes = await app.inject({
        method: 'PUT',
        url: `/api/notes/${noteId}`,
        payload: {
          user_email: secondaryUser,
          title: 'Hacked Title',
        },
      });
      expect(editRes.statusCode).toBe(403);

      // 7. Upgrade to read_write
      const updateShareRes = await app.inject({
        method: 'PUT',
        url: `/api/notes/${noteId}/shares/${share.id}`,
        payload: {
          user_email: primaryUser,
          permission: 'read_write',
        },
      });
      expect(updateShareRes.statusCode).toBe(200);

      // 8. Secondary user can now edit
      const editRes2 = await app.inject({
        method: 'PUT',
        url: `/api/notes/${noteId}`,
        payload: {
          user_email: secondaryUser,
          title: 'Updated by Collaborator',
        },
      });
      expect(editRes2.statusCode).toBe(200);

      // 9. Revoke share
      const revokeRes = await app.inject({
        method: 'DELETE',
        url: `/api/notes/${noteId}/shares/${share.id}`,
        query: { user_email: primaryUser },
      });
      expect(revokeRes.statusCode).toBe(204);

      // 10. Secondary user cannot access anymore
      const afterRevokeRes = await app.inject({
        method: 'GET',
        url: `/api/notes/${noteId}`,
        query: { user_email: secondaryUser },
      });
      expect(afterRevokeRes.statusCode).toBe(404);
    });

    it('creates and accesses share link', async () => {
      // 1. Create a note
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/notes',
        payload: {
          user_email: primaryUser,
          title: 'Link Shared Note',
          content: 'Content accessible via link',
        },
      });
      const noteId = createRes.json<NoteResponse>().id;

      // 2. Create share link
      const linkRes = await app.inject({
        method: 'POST',
        url: `/api/notes/${noteId}/share/link`,
        payload: { user_email: primaryUser },
      });

      expect(linkRes.statusCode).toBe(201);
      const link = linkRes.json<LinkShareResponse>();
      expect(link.token).toBeDefined();
      expect(link.url).toContain(link.token);

      // 3. Access note via link (no authentication needed)
      const accessRes = await app.inject({
        method: 'GET',
        url: `/api/shared/notes/${link.token}`,
      });

      expect(accessRes.statusCode).toBe(200);
      const sharedNote = accessRes.json<SharedNoteAccessResponse>();
      expect(sharedNote.note.title).toBe('Link Shared Note');
      expect(sharedNote.permission).toBe('read');
    });

    it('handles single-view share link', async () => {
      // 1. Create a note
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/notes',
        payload: {
          user_email: primaryUser,
          title: 'One Time Note',
          content: 'View once',
        },
      });
      const noteId = createRes.json<NoteResponse>().id;

      // 2. Create single-view link
      const linkRes = await app.inject({
        method: 'POST',
        url: `/api/notes/${noteId}/share/link`,
        payload: {
          user_email: primaryUser,
          is_single_view: true,
        },
      });
      const token = linkRes.json<LinkShareResponse>().token;

      // 3. First access works
      const access1Res = await app.inject({
        method: 'GET',
        url: `/api/shared/notes/${token}`,
      });
      expect(access1Res.statusCode).toBe(200);

      // 4. Second access fails
      const access2Res = await app.inject({
        method: 'GET',
        url: `/api/shared/notes/${token}`,
      });
      expect(access2Res.statusCode).toBe(410); // Gone
    });

    it('shares notebook and contents', async () => {
      // 1. Create notebook with notes
      const nbRes = await app.inject({
        method: 'POST',
        url: '/api/notebooks',
        payload: { user_email: primaryUser, name: 'Shared Notebook' },
      });
      const notebook_id = nbRes.json<NotebookResponse>().id;

      await app.inject({
        method: 'POST',
        url: '/api/notes',
        payload: {
          user_email: primaryUser,
          title: 'Note in Shared Notebook',
          notebook_id: notebook_id,
        },
      });

      // 2. Share notebook
      const shareRes = await app.inject({
        method: 'POST',
        url: `/api/notebooks/${notebook_id}/share`,
        payload: {
          user_email: primaryUser,
          email: secondaryUser,
          permission: 'read',
        },
      });
      expect(shareRes.statusCode).toBe(201);

      // 3. Check shared-with-me for notebooks
      const sharedNbRes = await app.inject({
        method: 'GET',
        url: '/api/notebooks/shared-with-me',
        query: { user_email: secondaryUser },
      });
      expect(sharedNbRes.statusCode).toBe(200);
      expect(sharedNbRes.json<SharedWithMeNotebooksResponse>().notebooks).toHaveLength(1);
    });

    it('handles multi-party sharing with three users', async () => {
      // This test verifies complex sharing scenarios with three users:
      // - Primary user creates and owns the note
      // - Secondary user gets read access
      // - Tertiary user gets read_write access
      // - Verify access isolation between shared users

      // 1. Create a note as primary user
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/notes',
        payload: {
          user_email: primaryUser,
          title: 'Multi-Party Document',
          content: 'Original content for sharing',
          visibility: 'shared',
        },
      });
      expect(createRes.statusCode).toBe(201);
      const noteId = createRes.json<NoteResponse>().id;

      // 2. Share with secondary user (read only)
      const share1Res = await app.inject({
        method: 'POST',
        url: `/api/notes/${noteId}/share`,
        payload: {
          user_email: primaryUser,
          email: secondaryUser,
          permission: 'read',
        },
      });
      expect(share1Res.statusCode).toBe(201);

      // 3. Share with tertiary user (read_write)
      const share2Res = await app.inject({
        method: 'POST',
        url: `/api/notes/${noteId}/share`,
        payload: {
          user_email: primaryUser,
          email: tertiaryUser,
          permission: 'read_write',
        },
      });
      expect(share2Res.statusCode).toBe(201);

      // 4. Both shared users can read
      const secondaryReadRes = await app.inject({
        method: 'GET',
        url: `/api/notes/${noteId}`,
        query: { user_email: secondaryUser },
      });
      expect(secondaryReadRes.statusCode).toBe(200);
      expect(secondaryReadRes.json<NoteResponse>().title).toBe('Multi-Party Document');

      const tertiaryReadRes = await app.inject({
        method: 'GET',
        url: `/api/notes/${noteId}`,
        query: { user_email: tertiaryUser },
      });
      expect(tertiaryReadRes.statusCode).toBe(200);

      // 5. Secondary user cannot edit (read only)
      const secondaryEditRes = await app.inject({
        method: 'PUT',
        url: `/api/notes/${noteId}`,
        payload: {
          user_email: secondaryUser,
          content: 'Attempted edit by secondary user',
        },
      });
      expect(secondaryEditRes.statusCode).toBe(403);

      // 6. Tertiary user can edit (read_write)
      const tertiaryEditRes = await app.inject({
        method: 'PUT',
        url: `/api/notes/${noteId}`,
        payload: {
          user_email: tertiaryUser,
          content: 'Content updated by tertiary user',
        },
      });
      expect(tertiaryEditRes.statusCode).toBe(200);

      // 7. Verify the edit persists
      const verifyRes = await app.inject({
        method: 'GET',
        url: `/api/notes/${noteId}`,
        query: { user_email: primaryUser },
      });
      expect(verifyRes.json<NoteResponse>().content).toBe('Content updated by tertiary user');

      // 8. Secondary user still sees updated content (via tertiary's edit)
      const secondaryVerifyRes = await app.inject({
        method: 'GET',
        url: `/api/notes/${noteId}`,
        query: { user_email: secondaryUser },
      });
      expect(secondaryVerifyRes.json<NoteResponse>().content).toBe('Content updated by tertiary user');

      // 9. Secondary user cannot manage shares (not owner)
      const secondaryShareAttempt = await app.inject({
        method: 'POST',
        url: `/api/notes/${noteId}/share`,
        payload: {
          user_email: secondaryUser,
          email: 'another@example.com',
          permission: 'read',
        },
      });
      expect(secondaryShareAttempt.statusCode).toBe(403);

      // 10. Tertiary user also cannot manage shares (not owner, only read_write)
      const tertiaryShareAttempt = await app.inject({
        method: 'POST',
        url: `/api/notes/${noteId}/share`,
        payload: {
          user_email: tertiaryUser,
          email: 'another@example.com',
          permission: 'read',
        },
      });
      expect(tertiaryShareAttempt.statusCode).toBe(403);

      // 11. Only owner can delete
      const tertiaryDeleteAttempt = await app.inject({
        method: 'DELETE',
        url: `/api/notes/${noteId}`,
        query: { user_email: tertiaryUser },
      });
      expect(tertiaryDeleteAttempt.statusCode).toBe(403);

      // 12. Owner can delete
      const ownerDeleteRes = await app.inject({
        method: 'DELETE',
        url: `/api/notes/${noteId}`,
        query: { user_email: primaryUser },
      });
      expect(ownerDeleteRes.statusCode).toBe(204);
    });
  });

  // ============================================
  // Version History Workflow
  // ============================================

  describe('Version History Workflow', () => {
    it('creates versions on edit and supports restore', async () => {
      // 1. Create a note
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/notes',
        payload: {
          user_email: primaryUser,
          title: 'Version Test',
          content: 'Original content v1',
        },
      });
      const noteId = createRes.json<NoteResponse>().id;

      // 2. Edit the note multiple times
      await app.inject({
        method: 'PUT',
        url: `/api/notes/${noteId}`,
        payload: {
          user_email: primaryUser,
          title: 'Version Test v2',
          content: 'Updated content v2',
        },
      });

      await app.inject({
        method: 'PUT',
        url: `/api/notes/${noteId}`,
        payload: {
          user_email: primaryUser,
          title: 'Version Test v3',
          content: 'Final content v3',
        },
      });

      // 3. List versions
      const versionsRes = await app.inject({
        method: 'GET',
        url: `/api/notes/${noteId}/versions`,
        query: { user_email: primaryUser },
      });

      expect(versionsRes.statusCode).toBe(200);
      const versions = versionsRes.json<NoteVersionsListResponse>();
      expect(versions.versions.length).toBeGreaterThanOrEqual(2);

      // 4. Get specific version
      const v1Res = await app.inject({
        method: 'GET',
        url: `/api/notes/${noteId}/versions/1`,
        query: { user_email: primaryUser },
      });

      expect(v1Res.statusCode).toBe(200);
      const v1 = v1Res.json<NoteVersionResponse>();
      expect(v1.version_number).toBe(1);
      expect(v1.title).toBe('Version Test');
      expect(v1.content).toBe('Original content v1');

      // 5. Compare versions
      const compareRes = await app.inject({
        method: 'GET',
        url: `/api/notes/${noteId}/versions/compare`,
        query: {
          user_email: primaryUser,
          from: '1',
          to: '2',
        },
      });

      expect(compareRes.statusCode).toBe(200);
      const diff = compareRes.json<VersionCompareResponse>();
      expect(diff.diff.title_changed).toBe(true);
      expect(diff.diff.content_changed).toBe(true);

      // 6. Restore to version 1
      const restoreRes = await app.inject({
        method: 'POST',
        url: `/api/notes/${noteId}/versions/1/restore`,
        query: { user_email: primaryUser },
      });

      expect(restoreRes.statusCode).toBe(200);
      expect(restoreRes.json<RestoreVersionResponse>().title).toBe('Version Test');

      // 7. Verify note content was restored
      const noteRes = await app.inject({
        method: 'GET',
        url: `/api/notes/${noteId}`,
        query: { user_email: primaryUser },
      });

      const restoredNote = noteRes.json<NoteResponse>();
      expect(restoredNote.title).toBe('Version Test');
      expect(restoredNote.content).toBe('Original content v1');

      // 8. Verify new version was created (non-destructive restore)
      const finalVersionsRes = await app.inject({
        method: 'GET',
        url: `/api/notes/${noteId}/versions`,
        query: { user_email: primaryUser },
      });

      // Should have more versions now (restore creates a new version)
      expect(finalVersionsRes.json<NoteVersionsListResponse>().versions.length).toBeGreaterThan(versions.versions.length);
    });
  });

  // ============================================
  // Note Presence Tracking
  // ============================================

  describe('Note Presence Tracking', () => {
    it('tracks user joining and leaving a note', async () => {
      // 1. Create a note
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/notes',
        payload: {
          user_email: primaryUser,
          title: 'Presence Test Note',
          content: 'Testing presence tracking',
        },
      });
      expect(createRes.statusCode).toBe(201);
      const noteId = createRes.json().id;

      // 2. User joins presence
      const joinRes = await app.inject({
        method: 'POST',
        url: `/api/notes/${noteId}/presence`,
        payload: { user_email: primaryUser },
      });
      expect(joinRes.statusCode).toBe(200);
      const joinData = joinRes.json();
      expect(joinData.collaborators).toBeInstanceOf(Array);
      expect(joinData.collaborators.some((u: { email: string }) => u.email === primaryUser)).toBe(true);

      // 3. Get current viewers
      const getRes = await app.inject({
        method: 'GET',
        url: `/api/notes/${noteId}/presence`,
        headers: { 'x-user-email': primaryUser },
      });
      expect(getRes.statusCode).toBe(200);
      expect(getRes.json().collaborators).toBeInstanceOf(Array);

      // 4. User leaves presence
      const leaveRes = await app.inject({
        method: 'DELETE',
        url: `/api/notes/${noteId}/presence`,
        headers: { 'x-user-email': primaryUser },
      });
      expect(leaveRes.statusCode).toBe(204);
    });

    it('updates cursor position', async () => {
      // 1. Create a note
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/notes',
        payload: {
          user_email: primaryUser,
          title: 'Cursor Test Note',
          content: 'Testing cursor tracking',
        },
      });
      const noteId = createRes.json().id;

      // 2. Join presence
      await app.inject({
        method: 'POST',
        url: `/api/notes/${noteId}/presence`,
        payload: { user_email: primaryUser },
      });

      // 3. Update cursor position
      const cursorRes = await app.inject({
        method: 'PUT',
        url: `/api/notes/${noteId}/presence/cursor`,
        payload: {
          user_email: primaryUser,
          cursor_position: { line: 5, column: 10 },
        },
      });
      expect(cursorRes.statusCode).toBe(204);
    });

    it('returns 403 when user lacks access to note', async () => {
      // 1. Create a private note as primary user
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/notes',
        payload: {
          user_email: primaryUser,
          title: 'Private Presence Note',
          content: 'Private content',
          visibility: 'private',
        },
      });
      const noteId = createRes.json().id;

      // 2. Secondary user tries to join presence - should fail
      const joinRes = await app.inject({
        method: 'POST',
        url: `/api/notes/${noteId}/presence`,
        payload: { user_email: secondaryUser },
      });
      expect(joinRes.statusCode).toBe(403);

      // 3. Secondary user tries to get presence - should fail
      const getRes = await app.inject({
        method: 'GET',
        url: `/api/notes/${noteId}/presence`,
        headers: { 'x-user-email': secondaryUser },
      });
      expect(getRes.statusCode).toBe(403);
    });

    it('allows shared users to join presence', async () => {
      // 1. Create a note as primary user
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/notes',
        payload: {
          user_email: primaryUser,
          title: 'Shared Presence Note',
          content: 'Shared content',
          visibility: 'shared',
        },
      });
      const noteId = createRes.json().id;

      // 2. Share with secondary user
      await app.inject({
        method: 'POST',
        url: `/api/notes/${noteId}/share`,
        payload: {
          user_email: primaryUser,
          email: secondaryUser,
          permission: 'read',
        },
      });

      // 3. Secondary user can now join presence
      const joinRes = await app.inject({
        method: 'POST',
        url: `/api/notes/${noteId}/presence`,
        payload: { user_email: secondaryUser },
      });
      expect(joinRes.statusCode).toBe(200);

      // 4. Both users should appear in presence list
      const getRes = await app.inject({
        method: 'GET',
        url: `/api/notes/${noteId}/presence`,
        headers: { 'x-user-email': primaryUser },
      });
      expect(getRes.statusCode).toBe(200);
      const collaborators = getRes.json().collaborators;
      expect(collaborators.some((u: { email: string }) => u.email === secondaryUser)).toBe(true);
    });

    it('handles joining presence with initial cursor position', async () => {
      // 1. Create a note
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/notes',
        payload: {
          user_email: primaryUser,
          title: 'Initial Cursor Note',
          content: 'Testing initial cursor',
        },
      });
      const noteId = createRes.json().id;

      // 2. Join with cursor position
      const joinRes = await app.inject({
        method: 'POST',
        url: `/api/notes/${noteId}/presence`,
        payload: {
          user_email: primaryUser,
          cursor_position: { line: 1, column: 0 },
        },
      });
      expect(joinRes.statusCode).toBe(200);
      const collaborators = joinRes.json().collaborators;
      const currentUser = collaborators.find((u: { email: string }) => u.email === primaryUser);
      expect(currentUser).toBeDefined();
      expect(currentUser.cursor_position).toBeDefined();
    });

    it('handles non-existent note for presence operations', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';

      // Try to join presence for non-existent note
      const joinRes = await app.inject({
        method: 'POST',
        url: `/api/notes/${fakeId}/presence`,
        payload: { user_email: primaryUser },
      });
      // Should return 403 or 404 depending on implementation
      expect([403, 404]).toContain(joinRes.statusCode);
    });
  });

  // ============================================
  // Privacy and Access Control
  // ============================================

  describe('Privacy and Access Control', () => {
    it('enforces private visibility', async () => {
      // Create private note
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/notes',
        payload: {
          user_email: primaryUser,
          title: 'Private Note',
          content: 'Secret content',
          visibility: 'private',
        },
      });
      const noteId = createRes.json<NoteResponse>().id;

      // Other user cannot access
      const otherRes = await app.inject({
        method: 'GET',
        url: `/api/notes/${noteId}`,
        query: { user_email: secondaryUser },
      });
      expect(otherRes.statusCode).toBe(404);

      // Owner can access
      const ownerRes = await app.inject({
        method: 'GET',
        url: `/api/notes/${noteId}`,
        query: { user_email: primaryUser },
      });
      expect(ownerRes.statusCode).toBe(200);
    });

    it('enforces public visibility', async () => {
      // Create public note
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/notes',
        payload: {
          user_email: primaryUser,
          title: 'Public Note',
          content: 'Open content',
          visibility: 'public',
        },
      });
      const noteId = createRes.json<NoteResponse>().id;

      // Any user can access
      const otherRes = await app.inject({
        method: 'GET',
        url: `/api/notes/${noteId}`,
        query: { user_email: secondaryUser },
      });
      expect(otherRes.statusCode).toBe(200);

      // But only owner can edit
      const editRes = await app.inject({
        method: 'PUT',
        url: `/api/notes/${noteId}`,
        payload: {
          user_email: secondaryUser,
          title: 'Hacked',
        },
      });
      expect(editRes.statusCode).toBe(403);
    });

    it('hides notes from agents when hide_from_agents is set', async () => {
      // Create note hidden from agents
      await app.inject({
        method: 'POST',
        url: '/api/notes',
        payload: {
          user_email: primaryUser,
          title: 'Agent Hidden Note',
          content: 'Private from AI',
          hide_from_agents: true,
          visibility: 'public',
        },
      });

      // Search as agent
      const agentSearchRes = await app.inject({
        method: 'GET',
        url: '/api/notes/search',
        query: {
          user_email: primaryUser,
          q: 'Agent Hidden',
          search_type: 'text',
        },
        headers: {
          'X-OpenClaw-Agent': 'test-agent',
        },
      });

      expect(agentSearchRes.statusCode).toBe(200);
      const titles = agentSearchRes.json<SearchResponse>().results.map((r) => r.title);
      expect(titles).not.toContain('Agent Hidden Note');

      // Search as user (should find it)
      const userSearchRes = await app.inject({
        method: 'GET',
        url: '/api/notes/search',
        query: {
          user_email: primaryUser,
          q: 'Agent Hidden',
          search_type: 'text',
        },
      });

      expect(userSearchRes.statusCode).toBe(200);
      const userTitles = userSearchRes.json<SearchResponse>().results.map((r) => r.title);
      expect(userTitles).toContain('Agent Hidden Note');
    });
  });

  // ============================================
  // XSS Prevention Tests
  // ============================================

  describe('XSS Prevention', () => {
    it('stores content with script tags without executing them', async () => {
      const maliciousContent = '<script>alert("xss")</script>Normal text';

      const createRes = await app.inject({
        method: 'POST',
        url: '/api/notes',
        payload: {
          user_email: primaryUser,
          title: 'XSS Test Note',
          content: maliciousContent,
        },
      });

      expect(createRes.statusCode).toBe(201);
      const note = createRes.json<NoteResponse>();

      // Content should be stored (the API stores raw content)
      // Sanitization happens on the frontend when rendering
      expect(note.content).toBeDefined();

      // Verify we can retrieve it
      const getRes = await app.inject({
        method: 'GET',
        url: `/api/notes/${note.id}`,
        query: { user_email: primaryUser },
      });

      expect(getRes.statusCode).toBe(200);
      expect(getRes.json<NoteResponse>().content).toBe(maliciousContent);
    });

    it('handles onerror event handlers in content', async () => {
      const maliciousContent = '<img src="invalid" onerror="alert(1)">Text content';

      const createRes = await app.inject({
        method: 'POST',
        url: '/api/notes',
        payload: {
          user_email: primaryUser,
          title: 'Onerror XSS Test',
          content: maliciousContent,
        },
      });

      expect(createRes.statusCode).toBe(201);

      // The API should accept and store the content
      // Frontend sanitization (DOMPurify) handles the onerror stripping
      const onerrorGetRes = await app.inject({
        method: 'GET',
        url: `/api/notes/${createRes.json<NoteResponse>().id}`,
        query: { user_email: primaryUser },
      });

      expect(onerrorGetRes.statusCode).toBe(200);
    });

    it('handles javascript: URLs in content', async () => {
      const maliciousContent = '[Click me](javascript:alert(1))';

      const createRes = await app.inject({
        method: 'POST',
        url: '/api/notes',
        payload: {
          user_email: primaryUser,
          title: 'JavaScript URL Test',
          content: maliciousContent,
        },
      });

      expect(createRes.statusCode).toBe(201);

      // Content stored - frontend handles sanitization
      const jsUrlGetRes = await app.inject({
        method: 'GET',
        url: `/api/notes/${createRes.json<NoteResponse>().id}`,
        query: { user_email: primaryUser },
      });

      expect(jsUrlGetRes.statusCode).toBe(200);
    });

    it('handles data: URLs with script content', async () => {
      const maliciousContent = '<a href="data:text/html,<script>alert(1)</script>">Click</a>';

      const createRes = await app.inject({
        method: 'POST',
        url: '/api/notes',
        payload: {
          user_email: primaryUser,
          title: 'Data URL Test',
          content: maliciousContent,
        },
      });

      expect(createRes.statusCode).toBe(201);
    });

    it('handles SVG with embedded script in content', async () => {
      const maliciousContent = '<svg><script>alert(1)</script></svg>';

      const createRes = await app.inject({
        method: 'POST',
        url: '/api/notes',
        payload: {
          user_email: primaryUser,
          title: 'SVG XSS Test',
          content: maliciousContent,
        },
      });

      expect(createRes.statusCode).toBe(201);
    });

    it('handles iframe injection attempts in content', async () => {
      const maliciousContent = '<iframe src="https://evil.com"></iframe>Text';

      const createRes = await app.inject({
        method: 'POST',
        url: '/api/notes',
        payload: {
          user_email: primaryUser,
          title: 'Iframe Test',
          content: maliciousContent,
        },
      });

      expect(createRes.statusCode).toBe(201);
    });

    it('sanitizes title with HTML tags', async () => {
      // Note: Titles should be treated as plain text, not HTML
      const maliciousTitle = '<script>alert("title xss")</script>Real Title';

      const createRes = await app.inject({
        method: 'POST',
        url: '/api/notes',
        payload: {
          user_email: primaryUser,
          title: maliciousTitle,
          content: 'Safe content',
        },
      });

      expect(createRes.statusCode).toBe(201);
      // Title is stored as-is (displayed as text, not HTML)
      expect(createRes.json<NoteResponse>().title).toBe(maliciousTitle);
    });

    it('handles style-based XSS attempts', async () => {
      const maliciousContent = '<div style="background:url(javascript:alert(1))">Styled</div>';

      const createRes = await app.inject({
        method: 'POST',
        url: '/api/notes',
        payload: {
          user_email: primaryUser,
          title: 'Style XSS Test',
          content: maliciousContent,
        },
      });

      expect(createRes.statusCode).toBe(201);
    });

    it('handles form injection attempts', async () => {
      const maliciousContent = '<form action="https://evil.com"><input name="data"></form>';

      const createRes = await app.inject({
        method: 'POST',
        url: '/api/notes',
        payload: {
          user_email: primaryUser,
          title: 'Form Injection Test',
          content: maliciousContent,
        },
      });

      expect(createRes.statusCode).toBe(201);
    });

    it('handles base tag injection attempts', async () => {
      const maliciousContent = '<base href="https://evil.com">Normal content';

      const createRes = await app.inject({
        method: 'POST',
        url: '/api/notes',
        payload: {
          user_email: primaryUser,
          title: 'Base Tag Test',
          content: maliciousContent,
        },
      });

      expect(createRes.statusCode).toBe(201);
    });

    it('search does not execute malicious content in results', async () => {
      // Create note with XSS payload
      await app.inject({
        method: 'POST',
        url: '/api/notes',
        payload: {
          user_email: primaryUser,
          title: 'Searchable XSS Note',
          content: '<script>alert("search xss")</script>Unique searchable content xyz123',
        },
      });

      // Search for the note
      const searchRes = await app.inject({
        method: 'GET',
        url: '/api/notes/search',
        query: {
          user_email: primaryUser,
          q: 'xyz123',
          search_type: 'text',
        },
      });

      expect(searchRes.statusCode).toBe(200);
      const searchResults = searchRes.json<SearchResponse>();

      // Should return results without executing scripts
      // Actual sanitization happens on frontend
      expect(searchResults.results.length).toBeGreaterThan(0);
    });
  });

  // ============================================
  // Error Handling
  // ============================================

  describe('Error Handling', () => {
    it('returns 400 for missing required fields', async () => {
      // Missing user_email
      const res1 = await app.inject({
        method: 'POST',
        url: '/api/notes',
        payload: { title: 'Test' },
      });
      expect(res1.statusCode).toBe(400);
      expect(res1.json<ErrorResponse>().error).toContain('user_email');

      // Missing title
      const res2 = await app.inject({
        method: 'POST',
        url: '/api/notes',
        payload: { user_email: primaryUser },
      });
      expect(res2.statusCode).toBe(400);
      expect(res2.json<ErrorResponse>().error).toContain('title');
    });

    it('returns 400 for invalid visibility', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/notes',
        payload: {
          user_email: primaryUser,
          title: 'Test',
          visibility: 'invalid',
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json<ErrorResponse>().error).toContain('visibility');
    });

    it('returns 404 for non-existent resources', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';

      // Non-existent note
      const noteRes = await app.inject({
        method: 'GET',
        url: `/api/notes/${fakeId}`,
        query: { user_email: primaryUser },
      });
      expect(noteRes.statusCode).toBe(404);

      // Non-existent notebook
      const nbRes = await app.inject({
        method: 'GET',
        url: `/api/notebooks/${fakeId}`,
        query: { user_email: primaryUser },
      });
      expect(nbRes.statusCode).toBe(404);
    });

    it('returns 403 for unauthorized operations', async () => {
      // Create note as primary user
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/notes',
        payload: {
          user_email: primaryUser,
          title: 'Owned Note',
          visibility: 'private',
        },
      });
      const noteId = createRes.json<NoteResponse>().id;

      // Try to delete as secondary user
      const deleteRes = await app.inject({
        method: 'DELETE',
        url: `/api/notes/${noteId}`,
        query: { user_email: secondaryUser },
      });
      expect(deleteRes.statusCode).toBe(403);
    });

    it('returns 409 for duplicate share', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/notes',
        payload: {
          user_email: primaryUser,
          title: 'Test Note',
        },
      });
      const noteId = createRes.json<NoteResponse>().id;

      // First share
      await app.inject({
        method: 'POST',
        url: `/api/notes/${noteId}/share`,
        payload: {
          user_email: primaryUser,
          email: secondaryUser,
        },
      });

      // Duplicate share
      const dupRes = await app.inject({
        method: 'POST',
        url: `/api/notes/${noteId}/share`,
        payload: {
          user_email: primaryUser,
          email: secondaryUser,
        },
      });
      expect(dupRes.statusCode).toBe(409);
    });
  });

  // ============================================
  // Rate Limiting
  // ============================================
  //
  // NOTE: Fastify's inject() method bypasses the rate limiting middleware,
  // so these tests verify the server handles high request volumes gracefully
  // in the test environment where rate limiting is intentionally disabled
  // (NODE_ENV === 'test'). The actual rate limiting behavior is tested in
  // tests/rate_limiting.test.ts which verifies the configuration is correctly
  // loaded and the rate limit plugin is properly registered.
  //
  // For true rate limiting E2E tests, a real HTTP client would be needed
  // instead of inject(), but that adds complexity and potential for flaky tests.
  // ============================================

  describe('Rate Limiting', () => {
    it('handles rapid note creation without errors in test mode', async () => {
      // In test mode, rate limiting is disabled (NODE_ENV === 'test')
      // This test verifies the server handles high request volumes gracefully
      const numRequests = 50;
      const promises = Array(numRequests)
        .fill(null)
        .map((_, i) =>
          app.inject({
            method: 'POST',
            url: '/api/notes',
            payload: {
              user_email: primaryUser,
              title: `Rate Limit Test Note ${i}`,
            },
          }),
        );

      const responses = await Promise.all(promises);
      const successful = responses.filter((r) => r.statusCode === 201);

      // In test mode, all requests should succeed (rate limiting disabled)
      // This verifies the endpoints work correctly under load
      expect(successful.length).toBe(numRequests);
    });

    it('handles rapid search queries without errors in test mode', async () => {
      // In test mode, rate limiting is disabled
      // This test verifies search endpoints handle concurrent requests
      const numRequests = 20;
      const promises = Array(numRequests)
        .fill(null)
        .map(() =>
          app.inject({
            method: 'GET',
            url: '/api/notes/search',
            query: {
              user_email: primaryUser,
              q: 'test',
              search_type: 'text',
            },
          }),
        );

      const responses = await Promise.all(promises);
      const successful = responses.filter((r) => r.statusCode === 200);

      // All search requests should succeed in test mode
      expect(successful.length).toBe(numRequests);
    });

    it('handles rapid share operations without errors in test mode', async () => {
      // Create a note first
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/notes',
        payload: {
          user_email: primaryUser,
          title: 'Rate Limit Share Test',
        },
      });
      const noteId = createRes.json().id;

      // In test mode, rate limiting is disabled
      // This test verifies share endpoints handle concurrent requests
      const numRequests = 20;
      const promises = Array(numRequests)
        .fill(null)
        .map((_, i) =>
          app.inject({
            method: 'POST',
            url: `/api/notes/${noteId}/share`,
            payload: {
              user_email: primaryUser,
              email: `rate-limit-test-${i}@example.com`,
              permission: 'read',
            },
          }),
        );

      const responses = await Promise.all(promises);
      const successful = responses.filter((r) => r.statusCode === 201);

      // All share requests should succeed in test mode
      expect(successful.length).toBe(numRequests);
    });

    it('maintains endpoint availability under concurrent load', async () => {
      // This test verifies endpoints remain stable under concurrent requests
      // In test mode, rate limiting is disabled but server stability is verified

      // Create several notes in parallel
      const initialPromises = Array(10)
        .fill(null)
        .map((_, i) =>
          app.inject({
            method: 'POST',
            url: '/api/notes',
            payload: {
              user_email: primaryUser,
              title: `Concurrent Load Test Note ${i}`,
            },
          }),
        );
      const createResponses = await Promise.all(initialPromises);
      expect(createResponses.every((r) => r.statusCode === 201)).toBe(true);

      // Immediately follow with another request - should succeed
      const res = await app.inject({
        method: 'POST',
        url: '/api/notes',
        payload: {
          user_email: primaryUser,
          title: 'Post Concurrent Load Test Note',
        },
      });

      // Should succeed (rate limiting disabled in test mode)
      expect(res.statusCode).toBe(201);
    });
  });

  // ============================================
  // Move and Copy Operations
  // ============================================

  describe('Move and Copy Operations', () => {
    it('moves notes between notebooks', async () => {
      // Create two notebooks
      const nb1Res = await app.inject({
        method: 'POST',
        url: '/api/notebooks',
        payload: { user_email: primaryUser, name: 'Source' },
      });
      const nb1Id = nb1Res.json<NotebookResponse>().id;

      const nb2Res = await app.inject({
        method: 'POST',
        url: '/api/notebooks',
        payload: { user_email: primaryUser, name: 'Target' },
      });
      const nb2Id = nb2Res.json<NotebookResponse>().id;

      // Create note in first notebook
      const noteRes = await app.inject({
        method: 'POST',
        url: '/api/notes',
        payload: {
          user_email: primaryUser,
          title: 'Movable Note',
          notebook_id: nb1Id,
        },
      });
      const noteId = noteRes.json<NoteResponse>().id;

      // Move to second notebook
      const moveRes = await app.inject({
        method: 'POST',
        url: `/api/notebooks/${nb2Id}/notes`,
        payload: {
          user_email: primaryUser,
          note_ids: [noteId],
          action: 'move',
        },
      });

      expect(moveRes.statusCode).toBe(200);
      expect(moveRes.json<MoveNotesResponse>().moved).toContain(noteId);

      // Verify note is now in second notebook
      const checkRes = await app.inject({
        method: 'GET',
        url: `/api/notes/${noteId}`,
        query: { user_email: primaryUser },
      });
      expect(checkRes.json<NoteResponse>().notebook_id).toBe(nb2Id);
    });

    it('copies notes to another notebook', async () => {
      // Create notebook
      const nbRes = await app.inject({
        method: 'POST',
        url: '/api/notebooks',
        payload: { user_email: primaryUser, name: 'Target' },
      });
      const nbId = nbRes.json<NotebookResponse>().id;

      // Create note (no notebook)
      const noteRes = await app.inject({
        method: 'POST',
        url: '/api/notes',
        payload: {
          user_email: primaryUser,
          title: 'Original Note',
          content: 'Original content',
        },
      });
      const originalId = noteRes.json<NoteResponse>().id;

      // Copy to notebook
      const copyRes = await app.inject({
        method: 'POST',
        url: `/api/notebooks/${nbId}/notes`,
        payload: {
          user_email: primaryUser,
          note_ids: [originalId],
          action: 'copy',
        },
      });

      expect(copyRes.statusCode).toBe(200);
      const copiedId = copyRes.json<MoveNotesResponse>().moved[0];
      expect(copiedId).not.toBe(originalId); // New ID

      // Verify original unchanged
      const origCheck = await app.inject({
        method: 'GET',
        url: `/api/notes/${originalId}`,
        query: { user_email: primaryUser },
      });
      expect(origCheck.json<NoteResponse>().notebook_id).toBeNull();

      // Verify copy in notebook
      const copyCheck = await app.inject({
        method: 'GET',
        url: `/api/notes/${copiedId}`,
        query: { user_email: primaryUser },
      });
      const copiedNote = copyCheck.json<NoteResponse>();
      expect(copiedNote.notebook_id).toBe(nbId);
      expect(copiedNote.title).toBe('Original Note');
    });
  });
});

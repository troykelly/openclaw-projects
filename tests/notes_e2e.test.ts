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

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { buildServer } from '../src/api/server.ts';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';

// ============================================
// Response Type Definitions for E2E Tests
// ============================================

/** Note visibility options */
type NoteVisibility = 'private' | 'shared' | 'public';

/** Note share permission levels */
type SharePermission = 'read' | 'read_write' | 'admin';

/** Base note response from API */
interface NoteResponse {
  id: string;
  title: string;
  content: string | null;
  notebookId: string | null;
  userEmail: string;
  visibility: NoteVisibility;
  isPinned: boolean;
  hideFromAgents: boolean;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

/** Notebook response from API */
interface NotebookResponse {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  userEmail: string;
  parentNotebookId: string | null;
  noteCount: number;
  createdAt: string;
  updatedAt: string;
  notes?: NoteResponse[];
  children?: NotebookResponse[];
}

/** Note share response from API */
interface NoteShareResponse {
  id: string;
  noteId: string;
  sharedWithEmail: string;
  permission: SharePermission;
  createdAt: string;
}

/** Share link response from API */
interface ShareLinkResponse {
  id: string;
  noteId: string;
  token: string;
  url: string;
  permission: SharePermission;
  expiresAt: string | null;
  isSingleView: boolean;
  createdAt: string;
}

/** Shared note access response */
interface SharedNoteAccessResponse {
  note: NoteResponse;
  permission: SharePermission;
}

/** Note version response from API */
interface NoteVersionResponse {
  id: string;
  noteId: string;
  versionNumber: number;
  title: string;
  content: string | null;
  createdAt: string;
  createdBy: string;
}

/** Version comparison response */
interface VersionCompareResponse {
  from: NoteVersionResponse;
  to: NoteVersionResponse;
  diff: {
    titleChanged: boolean;
    contentChanged: boolean;
    tagsChanged: boolean;
  };
}

/** Notes list response from API */
interface NotesListResponse {
  notes: NoteResponse[];
  total: number;
}

/** Notebooks list response from API */
interface NotebooksListResponse {
  notebooks: NotebookResponse[];
}

/** Notebook tree response from API */
interface NotebookTreeResponse {
  notebooks: (NotebookResponse & { children: NotebookResponse[] })[];
}

/** Note versions list response from API */
interface NoteVersionsListResponse {
  versions: NoteVersionResponse[];
}

/** Search result item */
interface SearchResultItem {
  id: string;
  title: string;
  content: string | null;
  score?: number;
}

/** Search response from API */
interface SearchResponse {
  results: SearchResultItem[];
  total: number;
}

/** API error response */
interface ErrorResponse {
  error: string;
  message?: string;
}

/** Move/copy notes response */
interface MoveNotesResponse {
  moved: string[];
}

describe('Notes E2E Integration (Epic #338, Issue #627)', () => {
  const app = buildServer();
  let pool: Pool;

  const primaryUser = 'e2e-primary@example.com';
  const secondaryUser = 'e2e-secondary@example.com';
  const publicUser = 'e2e-public@example.com';

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
  });

  /**
   * Helper to create a session cookie for authenticated requests
   */
  async function getSessionCookie(email: string): Promise<string> {
    const request = await app.inject({
      method: 'POST',
      url: '/api/auth/request-link',
      payload: { email },
    });
    const { loginUrl } = request.json() as { loginUrl: string };
    const token = new URL(loginUrl).searchParams.get('token');

    const consume = await app.inject({
      method: 'GET',
      url: `/api/auth/consume?token=${token}`,
      headers: { accept: 'application/json' },
    });

    const setCookie = consume.headers['set-cookie'];
    const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    return cookieHeader.split(';')[0];
  }

  // ============================================
  // Navigation Tests
  // ============================================

  describe('Navigation', () => {
    it('serves app shell for /app/notes when authenticated', async () => {
      const sessionCookie = await getSessionCookie(primaryUser);

      const res = await app.inject({
        method: 'GET',
        url: '/app/notes',
        headers: { cookie: sessionCookie },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/html/);
      expect(res.body).toContain('data-testid="app-frontend-shell"');
      expect(res.body).toContain('id="root"');
    });

    it('serves app shell for specific note URL when authenticated', async () => {
      const sessionCookie = await getSessionCookie(primaryUser);

      // Create a note first
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/notes',
        payload: { user_email: primaryUser, title: 'Navigation Test' },
      });
      const note = createRes.json<NoteResponse>();
      const noteId = note.id;

      const res = await app.inject({
        method: 'GET',
        url: `/app/notes/${noteId}`,
        headers: { cookie: sessionCookie },
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
      const sessionCookie = await getSessionCookie(primaryUser);

      // Create a notebook
      const nbRes = await app.inject({
        method: 'POST',
        url: '/api/notebooks',
        payload: { user_email: primaryUser, name: 'Test Notebook' },
      });
      const notebookId = nbRes.json<NotebookResponse>().id;

      const res = await app.inject({
        method: 'GET',
        url: `/app/notes?notebook=${notebookId}`,
        headers: { cookie: sessionCookie },
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
      expect(notebook.noteCount).toBe(0);

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
      expect(note1.notebookId).toBe(notebook.id);

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
        url: `/api/notes/${note2Res.json().id}`,
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
        url: `/api/notes/${note2Res.json().id}/restore`,
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
      expect(notes.every((n: { notebookId: string | null }) => n.notebookId === null)).toBe(true);
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
      const childNotebook = childRes.json<NotebookResponse>();
      const childId = childNotebook.id;
      expect(childNotebook.parentNotebookId).toBe(rootId);

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
      expect(grandchildRes.json<NotebookResponse>().parentNotebookId).toBe(childId);

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
      const note1Id = note1Res.json().id;

      const note2Res = await app.inject({
        method: 'POST',
        url: '/api/notes',
        payload: { user_email: primaryUser, title: 'Note 2', is_pinned: true },
      });

      // Verify initial state
      expect(note1Res.json().isPinned).toBe(false);
      expect(note2Res.json().isPinned).toBe(true);

      // Pin note 1
      const pinRes = await app.inject({
        method: 'PUT',
        url: `/api/notes/${note1Id}`,
        payload: { user_email: primaryUser, is_pinned: true },
      });
      expect(pinRes.json().isPinned).toBe(true);

      // List pinned notes
      const pinnedRes = await app.inject({
        method: 'GET',
        url: '/api/notes',
        query: { user_email: primaryUser, is_pinned: 'true' },
      });
      expect(pinnedRes.json().notes).toHaveLength(2);
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
      expect(res.json().content).toBe(markdownContent);
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
      const note = res.json();
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
      expect(res.json().content).toContain('| Column 1 |');
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
      expect(res.json().content).toContain('[Example Link]');
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
      expect(res.json().content).toContain('```mermaid');
      expect(res.json().content).toContain('graph TD');
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
      expect(res.json().content).toContain('$E = mc^2$');
      expect(res.json().content).toContain('\\int_{0}');
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
          searchType: 'text',
        },
      });

      expect(res.statusCode).toBe(200);
      const result = res.json();
      expect(result.results.length).toBeGreaterThan(0);

      const titles = result.results.map((r: { title: string }) => r.title);
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
      const notes = res.json().notes;
      expect(notes).toHaveLength(2);
      expect(notes.every((n: { tags: string[] }) => n.tags.includes('programming'))).toBe(true);
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
      const notes = res.json().notes;
      expect(notes).toHaveLength(1);
      expect(notes[0].title).toBe('Private Journal');
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

      const ascNotes = ascRes.json().notes;
      const descNotes = descRes.json().notes;

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

      const page1 = page1Res.json();
      const page2 = page2Res.json();

      expect(page1.notes).toHaveLength(2);
      expect(page1.total).toBe(3);

      // Page 2 should have remaining notes
      expect(page2.notes.length).toBeLessThanOrEqual(1);

      // No overlap between pages
      const page1Ids = page1.notes.map((n: { id: string }) => n.id);
      const page2Ids = page2.notes.map((n: { id: string }) => n.id);
      const overlap = page1Ids.filter((id: string) => page2Ids.includes(id));
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

      const noteId = createRes.json().id;

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
      expect(share.sharedWithEmail).toBe(secondaryUser);

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
      expect(sharedListRes.json<NotesListResponse>().notes).toHaveLength(1);

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
      const link = linkRes.json<ShareLinkResponse>();
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
          isSingleView: true,
        },
      });
      const token = linkRes.json<ShareLinkResponse>().token;

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
      const notebookId = nbRes.json<NotebookResponse>().id;

      await app.inject({
        method: 'POST',
        url: '/api/notes',
        payload: {
          user_email: primaryUser,
          title: 'Note in Shared Notebook',
          notebook_id: notebookId,
        },
      });

      // 2. Share notebook
      const shareRes = await app.inject({
        method: 'POST',
        url: `/api/notebooks/${notebookId}/share`,
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
      expect(sharedNbRes.json<NotebooksListResponse>().notebooks).toHaveLength(1);
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
      expect(v1.versionNumber).toBe(1);
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
      expect(diff.diff.titleChanged).toBe(true);
      expect(diff.diff.contentChanged).toBe(true);

      // 6. Restore to version 1
      const restoreRes = await app.inject({
        method: 'POST',
        url: `/api/notes/${noteId}/versions/1/restore`,
        query: { user_email: primaryUser },
      });

      expect(restoreRes.statusCode).toBe(200);
      expect(restoreRes.json<NoteResponse>().title).toBe('Version Test');

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
      const noteId = createRes.json().id;

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
      const noteId = createRes.json().id;

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
          searchType: 'text',
        },
        headers: {
          'X-OpenClaw-Agent': 'test-agent',
        },
      });

      expect(agentSearchRes.statusCode).toBe(200);
      const titles = agentSearchRes.json().results.map((r: { title: string }) => r.title);
      expect(titles).not.toContain('Agent Hidden Note');

      // Search as user (should find it)
      const userSearchRes = await app.inject({
        method: 'GET',
        url: '/api/notes/search',
        query: {
          user_email: primaryUser,
          q: 'Agent Hidden',
          searchType: 'text',
        },
      });

      expect(userSearchRes.statusCode).toBe(200);
      const userTitles = userSearchRes.json().results.map((r: { title: string }) => r.title);
      expect(userTitles).toContain('Agent Hidden Note');
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
      expect(checkRes.json<NoteResponse>().notebookId).toBe(nb2Id);
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
      expect(origCheck.json<NoteResponse>().notebookId).toBeNull();

      // Verify copy in notebook
      const copyCheck = await app.inject({
        method: 'GET',
        url: `/api/notes/${copiedId}`,
        query: { user_email: primaryUser },
      });
      const copiedNote = copyCheck.json<NoteResponse>();
      expect(copiedNote.notebookId).toBe(nbId);
      expect(copiedNote.title).toBe('Original Note');
    });
  });
});

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
  });

  /**
   * Helper to create a session cookie for authenticated requests.
   * Includes validation and clear error messages for debugging test failures.
   *
   * @param email - The email address to authenticate
   * @returns The session cookie string (e.g., "session=abc123")
   * @throws Error if authentication request fails or response is malformed
   */
  async function getSessionCookie(email: string): Promise<string> {
    // Step 1: Request the magic link
    const request = await app.inject({
      method: 'POST',
      url: '/api/auth/request-link',
      payload: { email },
    });

    // Auth endpoint returns 200 (OK) or 201 (Created) depending on implementation
    if (request.statusCode !== 200 && request.statusCode !== 201) {
      throw new Error(
        `Auth request failed for ${email}: status ${request.statusCode}, body: ${request.body}`
      );
    }

    const requestJson = request.json() as { loginUrl?: string };
    if (!requestJson.loginUrl) {
      throw new Error(
        `Auth request for ${email} did not return loginUrl. Response: ${JSON.stringify(requestJson)}`
      );
    }

    const token = new URL(requestJson.loginUrl).searchParams.get('token');
    if (!token) {
      throw new Error(
        `Auth URL for ${email} did not contain token. URL: ${requestJson.loginUrl}`
      );
    }

    // Step 2: Consume the magic link to get a session
    const consume = await app.inject({
      method: 'GET',
      url: `/api/auth/consume?token=${token}`,
      headers: { accept: 'application/json' },
    });

    if (consume.statusCode !== 200) {
      throw new Error(
        `Auth consume failed for ${email}: status ${consume.statusCode}, body: ${consume.body}`
      );
    }

    const setCookie = consume.headers['set-cookie'];
    if (!setCookie) {
      throw new Error(
        `Auth consume for ${email} did not return set-cookie header. Headers: ${JSON.stringify(consume.headers)}`
      );
    }

    const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    if (!cookieHeader) {
      throw new Error(
        `Auth consume for ${email} returned empty set-cookie. Value: ${JSON.stringify(setCookie)}`
      );
    }

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
      const noteId = createRes.json().id;

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
      const notebookId = nbRes.json().id;

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
      const notebook = nbRes.json();
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
      const note1 = note1Res.json();
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
      expect(nbGetRes.json().notes).toHaveLength(2);

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
      expect(updateRes.json().title).toBe('Updated Meeting Notes');

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

      expect(listRes.json().notes).toHaveLength(1);

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

      expect(listRes2.json().notes).toHaveLength(2);

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

      const notes = finalListRes.json().notes;
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
      const rootId = rootRes.json().id;

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
      const childId = childRes.json().id;
      expect(childRes.json().parentNotebookId).toBe(rootId);

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
      expect(grandchildRes.json().parentNotebookId).toBe(childId);

      // 4. Get tree view
      const treeRes = await app.inject({
        method: 'GET',
        url: '/api/notebooks/tree',
        query: { user_email: primaryUser },
      });

      expect(treeRes.statusCode).toBe(200);
      const tree = treeRes.json();
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
      const share = shareRes.json();
      expect(share.sharedWithEmail).toBe(secondaryUser);

      // 4. Secondary user can now access
      const afterShareRes = await app.inject({
        method: 'GET',
        url: `/api/notes/${noteId}`,
        query: { user_email: secondaryUser },
      });
      expect(afterShareRes.statusCode).toBe(200);
      expect(afterShareRes.json().title).toBe('Shared Document');

      // 5. Verify in shared-with-me list
      const sharedListRes = await app.inject({
        method: 'GET',
        url: '/api/notes/shared-with-me',
        query: { user_email: secondaryUser },
      });
      expect(sharedListRes.statusCode).toBe(200);
      expect(sharedListRes.json().notes).toHaveLength(1);

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
      const noteId = createRes.json().id;

      // 2. Create share link
      const linkRes = await app.inject({
        method: 'POST',
        url: `/api/notes/${noteId}/share/link`,
        payload: { user_email: primaryUser },
      });

      expect(linkRes.statusCode).toBe(201);
      const link = linkRes.json();
      expect(link.token).toBeDefined();
      expect(link.url).toContain(link.token);

      // 3. Access note via link (no authentication needed)
      const accessRes = await app.inject({
        method: 'GET',
        url: `/api/shared/notes/${link.token}`,
      });

      expect(accessRes.statusCode).toBe(200);
      const sharedNote = accessRes.json();
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
      const noteId = createRes.json().id;

      // 2. Create single-view link
      const linkRes = await app.inject({
        method: 'POST',
        url: `/api/notes/${noteId}/share/link`,
        payload: {
          user_email: primaryUser,
          isSingleView: true,
        },
      });
      const token = linkRes.json().token;

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
      const notebookId = nbRes.json().id;

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
      expect(sharedNbRes.json().notebooks).toHaveLength(1);
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
      const noteId = createRes.json().id;

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
      expect(secondaryReadRes.json().title).toBe('Multi-Party Document');

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
      expect(verifyRes.json().content).toBe('Content updated by tertiary user');

      // 8. Secondary user still sees updated content (via tertiary's edit)
      const secondaryVerifyRes = await app.inject({
        method: 'GET',
        url: `/api/notes/${noteId}`,
        query: { user_email: secondaryUser },
      });
      expect(secondaryVerifyRes.json().content).toBe('Content updated by tertiary user');

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
      const noteId = createRes.json().id;

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
      const versions = versionsRes.json();
      expect(versions.versions.length).toBeGreaterThanOrEqual(2);

      // 4. Get specific version
      const v1Res = await app.inject({
        method: 'GET',
        url: `/api/notes/${noteId}/versions/1`,
        query: { user_email: primaryUser },
      });

      expect(v1Res.statusCode).toBe(200);
      const v1 = v1Res.json();
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
      const diff = compareRes.json();
      expect(diff.diff.titleChanged).toBe(true);
      expect(diff.diff.contentChanged).toBe(true);

      // 6. Restore to version 1
      const restoreRes = await app.inject({
        method: 'POST',
        url: `/api/notes/${noteId}/versions/1/restore`,
        query: { user_email: primaryUser },
      });

      expect(restoreRes.statusCode).toBe(200);
      expect(restoreRes.json().title).toBe('Version Test');

      // 7. Verify note content was restored
      const noteRes = await app.inject({
        method: 'GET',
        url: `/api/notes/${noteId}`,
        query: { user_email: primaryUser },
      });

      expect(noteRes.json().title).toBe('Version Test');
      expect(noteRes.json().content).toBe('Original content v1');

      // 8. Verify new version was created (non-destructive restore)
      const finalVersionsRes = await app.inject({
        method: 'GET',
        url: `/api/notes/${noteId}/versions`,
        query: { user_email: primaryUser },
      });

      // Should have more versions now (restore creates a new version)
      expect(finalVersionsRes.json().versions.length).toBeGreaterThan(versions.versions.length);
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
      const note = createRes.json();

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
      expect(getRes.json().content).toBe(maliciousContent);
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
      const getRes = await app.inject({
        method: 'GET',
        url: `/api/notes/${createRes.json().id}`,
        query: { user_email: primaryUser },
      });

      expect(getRes.statusCode).toBe(200);
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
      const getRes = await app.inject({
        method: 'GET',
        url: `/api/notes/${createRes.json().id}`,
        query: { user_email: primaryUser },
      });

      expect(getRes.statusCode).toBe(200);
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
      expect(createRes.json().title).toBe(maliciousTitle);
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
          searchType: 'text',
        },
      });

      expect(searchRes.statusCode).toBe(200);
      const results = searchRes.json();

      // Should return results without executing scripts
      // Actual sanitization happens on frontend
      expect(results.results.length).toBeGreaterThan(0);
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
      expect(res1.json().error).toContain('user_email');

      // Missing title
      const res2 = await app.inject({
        method: 'POST',
        url: '/api/notes',
        payload: { user_email: primaryUser },
      });
      expect(res2.statusCode).toBe(400);
      expect(res2.json().error).toContain('title');
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
      expect(res.json().error).toContain('visibility');
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
      const noteId = createRes.json().id;

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
      const noteId = createRes.json().id;

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
      const nb1Id = nb1Res.json().id;

      const nb2Res = await app.inject({
        method: 'POST',
        url: '/api/notebooks',
        payload: { user_email: primaryUser, name: 'Target' },
      });
      const nb2Id = nb2Res.json().id;

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
      const noteId = noteRes.json().id;

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
      expect(moveRes.json().moved).toContain(noteId);

      // Verify note is now in second notebook
      const checkRes = await app.inject({
        method: 'GET',
        url: `/api/notes/${noteId}`,
        query: { user_email: primaryUser },
      });
      expect(checkRes.json().notebookId).toBe(nb2Id);
    });

    it('copies notes to another notebook', async () => {
      // Create notebook
      const nbRes = await app.inject({
        method: 'POST',
        url: '/api/notebooks',
        payload: { user_email: primaryUser, name: 'Target' },
      });
      const nbId = nbRes.json().id;

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
      const originalId = noteRes.json().id;

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
      const copiedId = copyRes.json().moved[0];
      expect(copiedId).not.toBe(originalId); // New ID

      // Verify original unchanged
      const origCheck = await app.inject({
        method: 'GET',
        url: `/api/notes/${originalId}`,
        query: { user_email: primaryUser },
      });
      expect(origCheck.json().notebookId).toBeNull();

      // Verify copy in notebook
      const copyCheck = await app.inject({
        method: 'GET',
        url: `/api/notes/${copiedId}`,
        query: { user_email: primaryUser },
      });
      expect(copyCheck.json().notebookId).toBe(nbId);
      expect(copyCheck.json().title).toBe('Original Note');
    });
  });
});

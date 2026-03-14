import { test, expect } from '@playwright/test';
import { Pool } from 'pg';
import { createTestPool, truncateAllTables } from '../helpers/db.ts';
import { NotesPageObject } from './helpers/notes-page.ts';
import { bypassAuth } from './helpers/auth-bypass.ts';

/**
 * Notes save E2E tests.
 *
 * With Yjs collaborative editing (#2256), content is persisted via WebSocket
 * (YjsDocManager debounced writes), not REST autosave. The "New Note" flow
 * still creates the note row via POST, and metadata saves (title, visibility,
 * etc.) still go through PUT.
 *
 * When ENABLE_YJS_COLLAB=true (default), the save status shows Yjs connection
 * status (connected/synced/disconnected) instead of REST save status.
 *
 * These tests validate the metadata save flow and note creation, which work
 * the same regardless of whether Yjs is enabled.
 */
test.describe('Notes Save E2E (Issues #785, #2256)', () => {
  let pool: Pool;

  test.beforeAll(async () => {
    pool = createTestPool();
  });

  test.beforeEach(async ({ page }) => {
    await truncateAllTables(pool);
    await bypassAuth(page);
  });

  test.afterAll(async () => {
    await pool.end();
  });

  test('creating a new note persists it to the database', async ({ page }) => {
    const notes = new NotesPageObject(page);
    await notes.goto();

    // Click "New Note" — this POSTs to create the note server-side
    await notes.createNewNote();

    // Wait for the POST to create the note
    await notes.waitForNoteSave();

    // URL should include a note ID after creation
    await page.waitForURL(/\/app\/notes\/[a-f0-9-]+/, { timeout: 5_000 });

    // Verify the note exists in the database
    const result = await pool.query(`SELECT id FROM note WHERE namespace = 'default' ORDER BY created_at DESC LIMIT 1`);
    expect(result.rows).toHaveLength(1);
  });

  test('auto-generated titles work for new notes', async ({ page }) => {
    const notes = new NotesPageObject(page);
    await notes.goto();
    await notes.createNewNote();

    // The title input should have a placeholder with auto-generated title
    const placeholder = await notes.titleInput.getAttribute('placeholder');
    expect(placeholder).toBeTruthy();
    // Match date format: abbreviated month, day, comma, 4-digit year
    expect(placeholder).toMatch(/\w{3}\s+\d{1,2},\s+\d{4}/);
  });

  test('metadata save persists title changes', async ({ page }) => {
    const notes = new NotesPageObject(page);
    await notes.goto();
    await notes.createNewNote();

    // Wait for the initial note creation
    await notes.waitForNoteSave();

    // Set a custom title — triggers metadata debounced save (5s)
    await notes.clearAndTypeTitle('Metadata Test Note');

    // Wait for the PUT to save metadata
    const updateResponse = page.waitForResponse(
      (resp) => resp.url().includes('/notes') && resp.request().method() === 'PUT' && resp.ok(),
      { timeout: 15_000 },
    );
    await updateResponse;

    // Verify title persisted to database
    const result = await pool.query(`SELECT title FROM note WHERE namespace = 'default' ORDER BY created_at DESC LIMIT 1`);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].title).toBe('Metadata Test Note');
  });

  test('content persists across page refresh', async ({ page }) => {
    const notes = new NotesPageObject(page);
    await notes.goto();
    await notes.createNewNote();

    // Wait for note creation
    await notes.waitForNoteSave();

    // Set title
    await notes.clearAndTypeTitle('Persistence Test Note');

    // Type content in the editor
    await notes.typeInEditor('This content should persist');

    // Wait for metadata save (title) and give content time to sync
    await page.waitForResponse(
      (resp) => resp.url().includes('/notes') && resp.request().method() === 'PUT' && resp.ok(),
      { timeout: 15_000 },
    );

    // Give Yjs/autosave time to persist content
    await page.waitForTimeout(3_000);

    // URL should include the note ID
    await page.waitForURL(/\/app\/notes\/[a-f0-9-]+/, { timeout: 5_000 });

    // Reload the page
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Click the note in the list to re-open it
    await page.getByRole('heading', { name: 'Persistence Test Note' }).click();

    // Wait for the editor to load
    await notes.editorContentEditable.waitFor({ state: 'visible', timeout: 10_000 });

    // Verify title persisted
    await expect(notes.titleInput).toHaveValue('Persistence Test Note');

    // Verify content persisted
    const editorText = await notes.editorContentEditable.textContent();
    expect(editorText).toContain('This content should persist');
  });

  test('error state shows when note creation fails', async ({ page }) => {
    const notes = new NotesPageObject(page);
    await notes.goto();

    // Intercept POST /notes to simulate server failure
    await page.route('**/notes', (route) => {
      if (route.request().method() === 'POST') {
        return route.fulfill({
          status: 500,
          body: JSON.stringify({ error: 'Internal server error' }),
          content_type: 'application/json',
        });
      }
      return route.continue();
    });

    await notes.createNewNote();

    // Wait for the save attempt — should show error state
    await notes.saveStatusError.waitFor({ state: 'visible', timeout: 10_000 });

    // Remove the route interception to allow retry
    await page.unroute('**/notes');
  });
});

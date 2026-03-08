import { type Page, type Locator, expect } from '@playwright/test';

/**
 * Page Object Model for the Notes page.
 * Encapsulates selectors and interaction helpers for Playwright E2E tests.
 *
 * Updated for Yjs collaborative editing (#2256):
 * - Content is synced via WebSocket (Yjs), not REST autosave
 * - Metadata (title, visibility, etc.) still saves via REST PUT
 * - Save status shows Yjs connection state when collab is enabled
 */
export class NotesPageObject {
  readonly page: Page;

  readonly addNoteButton: Locator;
  readonly titleInput: Locator;
  readonly editorContentEditable: Locator;

  // Save status indicators (metadata + Yjs)
  readonly saveStatusSaving: Locator;
  readonly saveStatusSaved: Locator;
  readonly saveStatusError: Locator;
  readonly saveStatusIdle: Locator;

  // Yjs-specific status indicators (#2256)
  readonly yjsStatusSynced: Locator;
  readonly yjsStatusConnected: Locator;
  readonly yjsStatusConnecting: Locator;
  readonly yjsStatusDisconnected: Locator;

  constructor(page: Page) {
    this.page = page;

    this.addNoteButton = page.getByRole('button', { name: /new note/i }).first();
    this.titleInput = page.locator('input.text-lg');
    this.editorContentEditable = page.locator('[contenteditable="true"]');

    // Metadata save status
    this.saveStatusSaving = page.getByText(/Saving/);
    this.saveStatusSaved = page.getByText('Saved', { exact: true });
    this.saveStatusError = page.getByText('Error saving');
    this.saveStatusIdle = page.getByText('All changes saved');

    // Yjs connection status (#2256)
    this.yjsStatusSynced = page.getByText('All changes synced');
    this.yjsStatusConnected = page.getByText('Syncing...');
    this.yjsStatusConnecting = page.getByText('Connecting...');
    this.yjsStatusDisconnected = page.getByText('Offline');
  }

  async goto(): Promise<void> {
    await this.page.goto('/app/notes');
    await this.page.waitForLoadState('networkidle');
  }

  async createNewNote(): Promise<void> {
    await this.addNoteButton.click();
    await this.editorContentEditable.waitFor({ state: 'visible', timeout: 10_000 });
  }

  async typeInEditor(text: string): Promise<void> {
    await this.editorContentEditable.click();
    await this.editorContentEditable.pressSequentially(text, { delay: 30 });
  }

  async clearAndTypeTitle(text: string): Promise<void> {
    await this.titleInput.click();
    await this.titleInput.clear();
    await this.titleInput.fill(text);
  }

  /** Wait for a note save (POST create or PUT update) via REST */
  async waitForNoteSave(): Promise<void> {
    await this.page.waitForResponse(
      (resp) => resp.url().includes('/notes') && (resp.request().method() === 'POST' || resp.request().method() === 'PUT') && resp.ok(),
      { timeout: 10_000 },
    );
  }

  /** @deprecated Use waitForNoteSave instead */
  async waitForAutosave(): Promise<void> {
    return this.waitForNoteSave();
  }
}

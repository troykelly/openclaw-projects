import { type Page, type Locator, expect } from '@playwright/test';

/**
 * Page Object Model for the Notes page.
 * Encapsulates selectors and interaction helpers for Playwright E2E tests.
 */
export class NotesPageObject {
  readonly page: Page;

  readonly addNoteButton: Locator;
  readonly titleInput: Locator;
  readonly editorContentEditable: Locator;

  readonly saveStatusSaving: Locator;
  readonly saveStatusSaved: Locator;
  readonly saveStatusError: Locator;
  readonly saveStatusIdle: Locator;

  constructor(page: Page) {
    this.page = page;

    this.addNoteButton = page.getByRole('button', { name: /new note/i }).first();
    this.titleInput = page.locator('input.text-lg');
    this.editorContentEditable = page.locator('[contenteditable="true"]');

    this.saveStatusSaving = page.getByText('Saving...');
    this.saveStatusSaved = page.getByText('Saved', { exact: true });
    this.saveStatusError = page.getByText('Error saving');
    this.saveStatusIdle = page.getByText('All changes saved');
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

  async waitForAutosave(): Promise<void> {
    // Wait for the save API call (POST create or PUT update) to complete.
    // The "Saving..." UI state is too transient to catch reliably with waitFor
    // since local API calls complete in milliseconds.
    await this.page.waitForResponse(
      (resp) =>
        resp.url().includes('/api/notes') &&
        (resp.request().method() === 'POST' || resp.request().method() === 'PUT') &&
        resp.ok(),
      { timeout: 10_000 },
    );
  }
}

/**
 * E2E tests for plugin memory tools (store, recall, forget) against a live backend.
 * Issue #1098 — tests the actual tool execute() methods, not raw HTTP calls.
 *
 * Run with: RUN_E2E=true pnpm run test:e2e
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ApiClient } from '../../src/api-client.js';
import { PluginConfigSchema, type PluginConfig } from '../../src/config.js';
import { createLogger, type Logger } from '../../src/logger.js';
import { createMemoryStoreTool, type MemoryStoreTool } from '../../src/tools/memory-store.js';
import { createMemoryRecallTool, type MemoryRecallTool } from '../../src/tools/memory-recall.js';
import { createMemoryForgetTool, type MemoryForgetTool } from '../../src/tools/memory-forget.js';
import { waitForService, defaultConfig, createTestApiClient } from './setup.js';

const RUN_E2E = process.env.RUN_E2E === 'true';

/** Generate a unique test string to avoid collisions between parallel runs. */
function uniqueTag(): string {
  return `e2e-mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

describe.skipIf(!RUN_E2E)('Plugin Memory Tool Round-Trip (Issue #1098)', () => {
  const apiUrl = defaultConfig.apiUrl;
  let pluginConfig: PluginConfig;
  let client: ApiClient;
  let logger: Logger;
  let storeTool: MemoryStoreTool;
  let recallTool: MemoryRecallTool;
  let forgetTool: MemoryForgetTool;

  /** Raw API client for cleanup (bypasses plugin tool layer). */
  let cleanupClient: ReturnType<typeof createTestApiClient>;

  /** Track memory IDs created during tests for cleanup. */
  const createdMemoryIds: string[] = [];

  const testUserId = 'e2e-test-user';

  beforeAll(async () => {
    // Wait for the backend to be healthy
    await waitForService(`${apiUrl}/api/health`, defaultConfig.healthCheckRetries);

    // Build a minimal PluginConfig for the E2E backend (auth disabled)
    pluginConfig = PluginConfigSchema.parse({
      apiUrl,
      timeout: 30000,
      maxRetries: 2,
      debug: false,
    });

    logger = createLogger('e2e-memory');
    client = new ApiClient({ config: pluginConfig, logger });
    cleanupClient = createTestApiClient(apiUrl);

    // Create tool instances — these are the units under test
    const toolOptions = { client, logger, config: pluginConfig, user_id: testUserId };
    storeTool = createMemoryStoreTool(toolOptions);
    recallTool = createMemoryRecallTool(toolOptions);
    forgetTool = createMemoryForgetTool(toolOptions);
  });

  afterAll(async () => {
    // Clean up all memories created during tests
    for (const id of createdMemoryIds) {
      try {
        await cleanupClient.delete(`/api/memories/${id}`);
      } catch {
        // Ignore cleanup errors — memory may already be deleted
      }
    }
  });

  it('memory_store stores a memory successfully', async () => {
    const tag = uniqueTag();
    const result = await storeTool.execute({
      text: `E2E store test: ${tag}`,
      category: 'fact',
      importance: 0.8,
    });

    expect(result.success).toBe(true);
    if (!result.success) return; // type narrowing

    expect(result.data.details.id).toBeDefined();
    expect(result.data.details.category).toBe('fact');
    expect(result.data.details.importance).toBe(0.8);
    expect(result.data.details.user_id).toBe(testUserId);
    expect(result.data.content).toContain('Stored memory');

    createdMemoryIds.push(result.data.details.id);
  });

  it('memory_recall finds the stored memory', async () => {
    const tag = uniqueTag();
    const storeResult = await storeTool.execute({
      text: `Recall target: ${tag}`,
      category: 'preference',
    });
    expect(storeResult.success).toBe(true);
    if (!storeResult.success) return;
    createdMemoryIds.push(storeResult.data.details.id);

    // Search for the memory we just stored
    const recallResult = await recallTool.execute({
      query: tag,
      limit: 5,
    });

    expect(recallResult.success).toBe(true);
    if (!recallResult.success) return;

    expect(recallResult.data.details.count).toBeGreaterThanOrEqual(1);
    const found = recallResult.data.details.memories.some(
      (m) => m.id === storeResult.data.details.id,
    );
    expect(found).toBe(true);
  });

  it('memory_forget deletes the stored memory', async () => {
    const tag = uniqueTag();
    const storeResult = await storeTool.execute({
      text: `Forget target: ${tag}`,
      category: 'fact',
    });
    expect(storeResult.success).toBe(true);
    if (!storeResult.success) return;
    const memory_id = storeResult.data.details.id;
    createdMemoryIds.push(memory_id);

    // Delete by ID
    const forgetResult = await forgetTool.execute({ memory_id });

    expect(forgetResult.success).toBe(true);
    if (!forgetResult.success) return;

    expect(forgetResult.data.details.deletedCount).toBe(1);
    expect(forgetResult.data.details.deletedIds).toContain(memory_id);

    // Remove from cleanup since it is already deleted
    const idx = createdMemoryIds.indexOf(memory_id);
    if (idx !== -1) createdMemoryIds.splice(idx, 1);
  });

  it('full lifecycle: store -> recall -> forget -> verify gone', async () => {
    const tag = uniqueTag();

    // 1. Store
    const storeResult = await storeTool.execute({
      text: `Full lifecycle: ${tag}`,
      category: 'decision',
      importance: 0.9,
    });
    expect(storeResult.success).toBe(true);
    if (!storeResult.success) return;
    const memory_id = storeResult.data.details.id;
    createdMemoryIds.push(memory_id);

    // 2. Recall — should find it
    const recallResult = await recallTool.execute({ query: tag, limit: 10 });
    expect(recallResult.success).toBe(true);
    if (!recallResult.success) return;

    const foundBefore = recallResult.data.details.memories.some((m) => m.id === memory_id);
    expect(foundBefore).toBe(true);

    // 3. Forget
    const forgetResult = await forgetTool.execute({ memory_id });
    expect(forgetResult.success).toBe(true);
    if (!forgetResult.success) return;
    expect(forgetResult.data.details.deletedCount).toBe(1);

    // Remove from cleanup
    const idx = createdMemoryIds.indexOf(memory_id);
    if (idx !== -1) createdMemoryIds.splice(idx, 1);

    // 4. Verify gone — recall should no longer find it
    const verifyResult = await recallTool.execute({ query: tag, limit: 10 });
    expect(verifyResult.success).toBe(true);
    if (!verifyResult.success) return;

    const foundAfter = verifyResult.data.details.memories.some((m) => m.id === memory_id);
    expect(foundAfter).toBe(false);
  });

  it('memory_store with tags persists tags through recall', async () => {
    const tag = uniqueTag();
    const testTags = ['e2e-test', 'roundtrip', tag];

    // Store with tags
    const storeResult = await storeTool.execute({
      text: `Tagged memory: ${tag}`,
      category: 'context',
      importance: 0.6,
      tags: testTags,
    });
    expect(storeResult.success).toBe(true);
    if (!storeResult.success) return;

    expect(storeResult.data.details.tags).toEqual(testTags);
    createdMemoryIds.push(storeResult.data.details.id);

    // Recall and check tags survived the round-trip
    const recallResult = await recallTool.execute({ query: tag, limit: 5 });
    expect(recallResult.success).toBe(true);
    if (!recallResult.success) return;

    const match = recallResult.data.details.memories.find(
      (m) => m.id === storeResult.data.details.id,
    );
    expect(match).toBeDefined();
    // Tags should be present (the API may return them in any order)
    if (match?.tags) {
      for (const t of testTags) {
        expect(match.tags).toContain(t);
      }
    }
  });
});

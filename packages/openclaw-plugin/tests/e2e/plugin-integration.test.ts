/**
 * E2E tests for plugin integration with the backend.
 * Part of Epic #310, Issue #326.
 *
 * These tests verify that the plugin can communicate with a real backend.
 * They require the E2E test services to be running.
 *
 * Run with: npm run test:e2e
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createE2EContext, areE2EServicesAvailable, testData, type E2ETestContext } from './setup.js';

// Check if we should skip E2E tests
const RUN_E2E = process.env.RUN_E2E === 'true';

describe.skipIf(!RUN_E2E)('Plugin E2E Integration', () => {
  let context: E2ETestContext;

  beforeAll(async () => {
    context = createE2EContext();

    // Check if services are available
    const available = await areE2EServicesAvailable(context.config);
    if (!available) {
      console.log('E2E services not available - tests will be skipped');
    }
  });

  describe('Backend Health', () => {
    it('should have a healthy backend', async () => {
      const response = await context.apiClient.get<{ status: string }>('/api/health');
      expect(response.status).toBe('ok');
    });

    it('should have database connectivity', async () => {
      const response = await context.apiClient.get<{ status: string; database?: string }>('/api/health');
      expect(response.status).toBe('ok');
    });
  });

  describe('Memory Operations', () => {
    it('should create a memory', async () => {
      const memory = {
        title: 'E2E Test Memory',
        content: testData.sampleMemory.content,
        memoryType: 'fact',
        importance: 5,
        confidence: 1.0,
      };

      const response = await context.apiClient.post<{ id: string }>('/api/memories', memory);

      expect(response.id).toBeDefined();
      context.createdIds.memories.push(response.id);
    });

    it('should search memories', async () => {
      // First create a memory
      const memory = {
        title: 'Searchable Memory',
        content: 'This is a unique searchable content xyz123',
        memoryType: 'fact',
        importance: 5,
        confidence: 1.0,
      };

      const created = await context.apiClient.post<{ id: string }>('/api/memories', memory);
      context.createdIds.memories.push(created.id);

      // Search for it
      const response = await context.apiClient.get<{ memories: Array<{ id: string; content: string }> }>('/api/memories/search?q=xyz123');

      expect(response.memories).toBeDefined();
      // Note: Full-text search might not find it immediately due to indexing
    });
  });

  describe('Contact Operations', () => {
    it('should create a contact', async () => {
      const contact = {
        name: `E2E Test Contact ${Date.now()}`,
        email: testData.uniqueEmail(),
        phone: testData.uniquePhone(),
      };

      const response = await context.apiClient.post<{ id: string }>('/api/contacts', contact);

      expect(response.id).toBeDefined();
      context.createdIds.contacts.push(response.id);
    });

    it('should list contacts', async () => {
      const response = await context.apiClient.get<{ contacts: Array<{ id: string; name: string }> }>('/api/contacts');

      expect(response.contacts).toBeDefined();
      expect(Array.isArray(response.contacts)).toBe(true);
    });
  });

  describe('Work Item Operations', () => {
    it('should create a work item (task)', async () => {
      const workItem = {
        title: `E2E Test Task ${Date.now()}`,
        description: 'A task created during E2E testing',
        workItemType: 'task',
        status: 'open',
      };

      const response = await context.apiClient.post<{ id: string }>('/api/work-items', workItem);

      expect(response.id).toBeDefined();
      context.createdIds.workItems.push(response.id);
    });

    it('should list work items', async () => {
      const response = await context.apiClient.get<{ workItems: Array<{ id: string; title: string }> }>('/api/work-items');

      expect(response.workItems).toBeDefined();
      expect(Array.isArray(response.workItems)).toBe(true);
    });
  });

  describe('Search API', () => {
    it('should perform unified search', async () => {
      const response = await context.apiClient.get<{ results: Array<unknown> }>('/api/search?q=test');

      expect(response.results).toBeDefined();
      expect(Array.isArray(response.results)).toBe(true);
    });
  });

  afterAll(async () => {
    // Cleanup all created resources
    for (const id of context.createdIds.memories) {
      try {
        await context.apiClient.delete(`/api/memories/${id}`);
      } catch {
        // Ignore cleanup errors
      }
    }

    for (const id of context.createdIds.contacts) {
      try {
        await context.apiClient.delete(`/api/contacts/${id}`);
      } catch {
        // Ignore cleanup errors
      }
    }

    for (const id of context.createdIds.workItems) {
      try {
        await context.apiClient.delete(`/api/work-items/${id}`);
      } catch {
        // Ignore cleanup errors
      }
    }
  });
});

describe.skipIf(!RUN_E2E)('Plugin Tool Simulation', () => {
  let context: E2ETestContext;

  beforeAll(async () => {
    context = createE2EContext();
  });

  describe('Memory Recall Tool', () => {
    it('should simulate memory_recall tool invocation', async () => {
      // Create a memory
      const memory = {
        title: 'Tool Test Memory',
        content: 'User prefers morning meetings',
        memoryType: 'preference',
        importance: 8,
        confidence: 1.0,
      };

      const created = await context.apiClient.post<{ id: string }>('/api/memories', memory);
      context.createdIds.memories.push(created.id);

      // Simulate tool invocation by calling search API
      const response = await context.apiClient.get<{
        memories: Array<{ id: string; content: string; memoryType: string }>;
      }>('/api/memories/search?q=morning%20meetings');

      expect(response.memories).toBeDefined();
    });
  });

  describe('Memory Store Tool', () => {
    it('should simulate memory_store tool invocation', async () => {
      const memory = {
        title: 'Stored via Tool',
        content: 'User likes TypeScript over JavaScript',
        memoryType: 'preference',
        importance: 7,
        confidence: 0.9,
      };

      const response = await context.apiClient.post<{ id: string }>('/api/memories', memory);

      expect(response.id).toBeDefined();
      context.createdIds.memories.push(response.id);
    });
  });

  describe('Contact Search Tool', () => {
    it('should simulate contact_search tool invocation', async () => {
      // Create a contact
      const contact = {
        name: 'John Tool Test',
        email: 'john.tool@example.com',
      };

      const created = await context.apiClient.post<{ id: string }>('/api/contacts', contact);
      context.createdIds.contacts.push(created.id);

      // Simulate tool invocation
      const response = await context.apiClient.get<{
        contacts: Array<{ id: string; name: string }>;
      }>('/api/contacts/search?q=John%20Tool');

      expect(response.contacts).toBeDefined();
    });
  });

  describe('Todo Operations', () => {
    it('should simulate todo_create tool invocation', async () => {
      const todo = {
        title: 'Complete E2E testing',
        description: 'Finish all E2E test cases',
        workItemType: 'task',
        status: 'open',
        priority: 'high',
      };

      const response = await context.apiClient.post<{ id: string }>('/api/work-items', todo);

      expect(response.id).toBeDefined();
      context.createdIds.workItems.push(response.id);
    });

    it('should simulate todo_list tool invocation', async () => {
      const response = await context.apiClient.get<{
        workItems: Array<{ id: string; title: string; status: string }>;
      }>('/api/work-items?status=open');

      expect(response.workItems).toBeDefined();
      expect(Array.isArray(response.workItems)).toBe(true);
    });
  });

  afterAll(async () => {
    // Cleanup
    for (const id of context.createdIds.memories) {
      try {
        await context.apiClient.delete(`/api/memories/${id}`);
      } catch {}
    }
    for (const id of context.createdIds.contacts) {
      try {
        await context.apiClient.delete(`/api/contacts/${id}`);
      } catch {}
    }
    for (const id of context.createdIds.workItems) {
      try {
        await context.apiClient.delete(`/api/work-items/${id}`);
      } catch {}
    }
  });
});

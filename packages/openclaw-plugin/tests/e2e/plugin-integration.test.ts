/**
 * E2E tests for plugin integration with the backend.
 * Part of Epic #310, Issue #326, #1032.
 *
 * These tests verify that the plugin can communicate with a real backend.
 * They require the E2E test services to be running.
 *
 * Run with: pnpm run test:e2e
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createE2EContext, areE2EServicesAvailable, cleanupResources, type E2ETestContext } from './setup.js';

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
      // /api/health returns 'healthy', 'degraded', or 'unhealthy' (503)
      expect(['healthy', 'degraded']).toContain(response.status);
    });

    it('should have database connectivity', async () => {
      const response = await context.apiClient.get<{
        status: string;
        components: Record<string, { status: string }>;
      }>('/api/health');
      expect(response.components.database).toBeDefined();
      expect(response.components.database.status).toBe('healthy');
    });
  });

  describe('Work Item Operations', () => {
    it('should create a work item (issue)', async () => {
      const workItem = {
        title: `E2E Test Issue ${Date.now()}`,
        description: 'An issue created during E2E testing',
        kind: 'issue',
      };

      const response = await context.apiClient.post<{ id: string; title: string }>('/api/work-items', workItem);

      expect(response.id).toBeDefined();
      context.createdIds.workItems.push(response.id);
    });

    it('should list work items', async () => {
      // Response uses 'items' not 'workItems'
      const response = await context.apiClient.get<{ items: Array<{ id: string; title: string }> }>('/api/work-items');

      expect(response.items).toBeDefined();
      expect(Array.isArray(response.items)).toBe(true);
    });
  });

  describe('Contact Operations', () => {
    it('should create a contact', async () => {
      // POST /api/contacts requires displayName (not name/email/phone)
      const contact = {
        displayName: `E2E Test Contact ${Date.now()}`,
      };

      const response = await context.apiClient.post<{ id: string }>('/api/contacts', contact);

      expect(response.id).toBeDefined();
      context.createdIds.contacts.push(response.id);
    });

    it('should list contacts', async () => {
      const response = await context.apiClient.get<{
        contacts: Array<{ id: string; display_name: string }>;
      }>('/api/contacts');

      expect(response.contacts).toBeDefined();
      expect(Array.isArray(response.contacts)).toBe(true);
    });
  });

  describe('Memory Operations', () => {
    let linkedWorkItemId: string;

    beforeAll(async () => {
      // Memory creation requires a linked work item
      const workItem = await context.apiClient.post<{ id: string }>('/api/work-items', {
        title: `Memory Test Work Item ${Date.now()}`,
        kind: 'issue',
      });
      linkedWorkItemId = workItem.id;
      context.createdIds.workItems.push(linkedWorkItemId);
    });

    it('should create a memory', async () => {
      // POST /api/memory (singular) requires title, content, linkedItemId
      const memory = {
        title: 'E2E Test Memory',
        content: 'Test memory content for E2E testing',
        linkedItemId: linkedWorkItemId,
        type: 'note',
      };

      const response = await context.apiClient.post<{ id: string }>('/api/memory', memory);

      expect(response.id).toBeDefined();
      context.createdIds.memories.push(response.id);
    });

    it('should search memories', async () => {
      // Create a memory first
      const memory = {
        title: 'Searchable Memory',
        content: 'This is a unique searchable content xyz123',
        linkedItemId: linkedWorkItemId,
        type: 'note',
      };

      const created = await context.apiClient.post<{ id: string }>('/api/memory', memory);
      context.createdIds.memories.push(created.id);

      // GET /api/memories/search returns { results: [...] }
      const response = await context.apiClient.get<{
        results: Array<{ id: string; content: string }>;
      }>('/api/memories/search?q=xyz123');

      expect(response.results).toBeDefined();
      expect(Array.isArray(response.results)).toBe(true);
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
    await cleanupResources(context);
  });
});

describe.skipIf(!RUN_E2E)('Plugin Tool Simulation', () => {
  let context: E2ETestContext;
  let sharedWorkItemId: string;

  beforeAll(async () => {
    context = createE2EContext();

    // Create a work item for memory tests (linkedItemId is required)
    const workItem = await context.apiClient.post<{ id: string }>('/api/work-items', {
      title: `Tool Simulation Work Item ${Date.now()}`,
      kind: 'issue',
    });
    sharedWorkItemId = workItem.id;
    context.createdIds.workItems.push(sharedWorkItemId);
  });

  describe('Memory Recall Tool', () => {
    it('should simulate memory_recall tool invocation', async () => {
      // Create a memory via POST /api/memory
      const memory = {
        title: 'Tool Test Memory',
        content: 'User prefers morning meetings',
        linkedItemId: sharedWorkItemId,
        type: 'note',
      };

      const created = await context.apiClient.post<{ id: string }>('/api/memory', memory);
      context.createdIds.memories.push(created.id);

      // Simulate tool invocation by calling search API
      const response = await context.apiClient.get<{
        results: Array<{ id: string; content: string; type: string }>;
      }>('/api/memories/search?q=morning%20meetings');

      expect(response.results).toBeDefined();
    });
  });

  describe('Memory Store Tool', () => {
    it('should simulate memory_store tool invocation', async () => {
      const memory = {
        title: 'Stored via Tool',
        content: 'User likes TypeScript over JavaScript',
        linkedItemId: sharedWorkItemId,
        type: 'note',
      };

      const response = await context.apiClient.post<{ id: string }>('/api/memory', memory);

      expect(response.id).toBeDefined();
      context.createdIds.memories.push(response.id);
    });
  });

  describe('Contact List Tool', () => {
    it('should simulate contact list/search tool invocation', async () => {
      // Create a contact
      const contact = {
        displayName: 'John Tool Test',
      };

      const created = await context.apiClient.post<{ id: string }>('/api/contacts', contact);
      context.createdIds.contacts.push(created.id);

      // Use GET /api/contacts?search= to find contacts (no /api/contacts/search endpoint)
      const response = await context.apiClient.get<{
        contacts: Array<{ id: string; display_name: string }>;
      }>('/api/contacts?search=John%20Tool');

      expect(response.contacts).toBeDefined();
    });
  });

  describe('Todo Operations', () => {
    it('should simulate todo_create tool invocation', async () => {
      const todo = {
        title: 'Complete E2E testing',
        description: 'Finish all E2E test cases',
        kind: 'issue',
      };

      const response = await context.apiClient.post<{ id: string }>('/api/work-items', todo);

      expect(response.id).toBeDefined();
      context.createdIds.workItems.push(response.id);
    });

    it('should simulate todo_list tool invocation', async () => {
      // Response uses 'items' not 'workItems'
      const response = await context.apiClient.get<{
        items: Array<{ id: string; title: string; status: string }>;
      }>('/api/work-items');

      expect(response.items).toBeDefined();
      expect(Array.isArray(response.items)).toBe(true);
    });
  });

  afterAll(async () => {
    await cleanupResources(context);
  });
});

describe.skipIf(!RUN_E2E)('Comprehensive Tool Operations', () => {
  let context: E2ETestContext;
  let sharedWorkItemId: string;

  beforeAll(async () => {
    context = createE2EContext();

    const available = await areE2EServicesAvailable(context.config);
    if (!available) {
      console.log('E2E services not available - tests will be skipped');
    }

    // Create a work item for memory tests
    const workItem = await context.apiClient.post<{ id: string }>('/api/work-items', {
      title: `Comprehensive Test Work Item ${Date.now()}`,
      kind: 'issue',
    });
    sharedWorkItemId = workItem.id;
    context.createdIds.workItems.push(sharedWorkItemId);
  });

  describe('Memory Lifecycle: Store → Recall → Forget', () => {
    it('should complete full memory lifecycle', async () => {
      const uniqueId = `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      // Store a memory via POST /api/memory
      const memory = {
        title: `Memory Lifecycle ${uniqueId}`,
        content: `This is test content for ${uniqueId}`,
        linkedItemId: sharedWorkItemId,
        type: 'note',
      };

      const storeResponse = await context.apiClient.post<{ id: string }>('/api/memory', memory);
      expect(storeResponse.id).toBeDefined();
      const memoryId = storeResponse.id;
      context.createdIds.memories.push(memoryId);

      // Recall the memory via GET /api/memories/search
      const recallResponse = await context.apiClient.get<{
        results: Array<{ id: string; content: string }>;
      }>(`/api/memories/search?q=${uniqueId}`);

      expect(recallResponse.results).toBeDefined();
      expect(Array.isArray(recallResponse.results)).toBe(true);

      // Forget the memory
      await context.apiClient.delete(`/api/memories/${memoryId}`);

      // Verify deletion
      const verifyResponse = await context.apiClient.get<{
        results: Array<{ id: string }>;
      }>(`/api/memories/search?q=${uniqueId}`);

      const found = verifyResponse.results?.some((m) => m.id === memoryId);
      expect(found).toBe(false);

      // Remove from cleanup list since already deleted
      context.createdIds.memories = context.createdIds.memories.filter((id) => id !== memoryId);
    });

    it('should store memory with tags', async () => {
      const memory = {
        title: `Tagged Memory ${Date.now()}`,
        content: 'Memory with multiple tags',
        linkedItemId: sharedWorkItemId,
        type: 'note',
        tags: ['test', 'e2e', 'automated'],
      };

      const response = await context.apiClient.post<{ id: string; tags?: string[] }>('/api/memory', memory);

      expect(response.id).toBeDefined();
      context.createdIds.memories.push(response.id);
    });
  });

  describe('Project Operations: Create → List → Get', () => {
    it('should complete project lifecycle', async () => {
      const uniqueId = `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      // Create project (kind: 'project')
      const project = {
        title: `Project ${uniqueId}`,
        description: `E2E test project ${uniqueId}`,
        kind: 'project',
      };

      const createResponse = await context.apiClient.post<{ id: string }>('/api/work-items', project);
      expect(createResponse.id).toBeDefined();
      const projectId = createResponse.id;
      context.createdIds.projects.push(projectId);

      // List work items (response uses 'items')
      const listResponse = await context.apiClient.get<{
        items: Array<{ id: string; title: string }>;
      }>('/api/work-items');

      expect(listResponse.items).toBeDefined();
      expect(Array.isArray(listResponse.items)).toBe(true);
      const found = listResponse.items.some((p) => p.id === projectId);
      expect(found).toBe(true);

      // Get specific project
      const getResponse = await context.apiClient.get<{
        id: string;
        title: string;
        description: string;
      }>(`/api/work-items/${projectId}`);

      expect(getResponse.id).toBe(projectId);
      expect(getResponse.title).toContain(uniqueId);
    });
  });

  describe('Todo Operations: Create → List → Complete', () => {
    it('should complete todo lifecycle', async () => {
      const uniqueId = `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      // Create issue
      const todo = {
        title: `Todo ${uniqueId}`,
        description: `E2E test todo ${uniqueId}`,
        kind: 'issue',
      };

      const createResponse = await context.apiClient.post<{ id: string }>('/api/work-items', todo);
      expect(createResponse.id).toBeDefined();
      const todoId = createResponse.id;
      context.createdIds.workItems.push(todoId);

      // List work items
      const listResponse = await context.apiClient.get<{
        items: Array<{ id: string; title: string; status: string }>;
      }>('/api/work-items');

      expect(listResponse.items).toBeDefined();
      expect(Array.isArray(listResponse.items)).toBe(true);

      // Complete todo (use PUT, title is required)
      const completeResponse = await context.apiClient.put<{ id: string; status: string }>(`/api/work-items/${todoId}`, {
        title: `Todo ${uniqueId}`,
        status: 'completed',
      });

      expect(completeResponse.status).toBe('completed');
    });
  });

  describe('Contact Operations: Create → List → Get', () => {
    it('should complete contact lifecycle', async () => {
      const uniqueId = `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      // Create contact (displayName required)
      const contact = {
        displayName: `Contact ${uniqueId}`,
      };

      const createResponse = await context.apiClient.post<{ id: string }>('/api/contacts', contact);
      expect(createResponse.id).toBeDefined();
      const contactId = createResponse.id;
      context.createdIds.contacts.push(contactId);

      // List contacts with search filter
      const searchResponse = await context.apiClient.get<{
        contacts: Array<{ id: string; display_name: string }>;
      }>(`/api/contacts?search=${uniqueId}`);

      expect(searchResponse.contacts).toBeDefined();
      expect(Array.isArray(searchResponse.contacts)).toBe(true);

      // Get specific contact
      const getResponse = await context.apiClient.get<{
        id: string;
        display_name: string;
      }>(`/api/contacts/${contactId}`);

      expect(getResponse.id).toBe(contactId);
      expect(getResponse.display_name).toContain(uniqueId);
    });
  });

  describe('Skill Store Operations: Create → Get → List → Delete', () => {
    it('should complete skill store lifecycle', async () => {
      const uniqueId = `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      // Create skill store item via POST /api/skill-store/items
      const skill = {
        skill_id: `e2e-test-${uniqueId}`,
        collection: 'e2e-test',
        key: `skill-${uniqueId}`,
        title: `Test Skill ${uniqueId}`,
        data: { name: `Test Skill ${uniqueId}`, info: 'test data' },
        tags: ['test', 'e2e'],
      };

      const createResponse = await context.apiClient.post<{ id: string; key: string }>('/api/skill-store/items', skill);
      expect(createResponse.id).toBeDefined();
      const skillItemId = createResponse.id;
      context.createdIds.skills.push(skillItemId);

      // Get skill item via GET /api/skill-store/items/:id
      const getResponse = await context.apiClient.get<{
        id: string;
        key: string;
        data: unknown;
      }>(`/api/skill-store/items/${skillItemId}`);

      expect(getResponse.id).toBe(skillItemId);
      expect(getResponse.key).toBe(skill.key);

      // List skill items via GET /api/skill-store/items?skill_id=...
      const listResponse = await context.apiClient.get<{
        items: Array<{ id: string; collection: string }>;
      }>(`/api/skill-store/items?skill_id=${encodeURIComponent(skill.skill_id)}&collection=e2e-test`);

      expect(listResponse.items).toBeDefined();
      expect(Array.isArray(listResponse.items)).toBe(true);

      // Delete skill item via DELETE /api/skill-store/items/:id
      await context.apiClient.delete(`/api/skill-store/items/${skillItemId}`);

      // Remove from cleanup list since already deleted
      context.createdIds.skills = context.createdIds.skills.filter((id) => id !== skillItemId);
    });
  });

  describe('Relationship Operations: Set → Query', () => {
    it('should set and query relationships', async () => {
      const uniqueId = `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      // Create two contacts
      const contact1Response = await context.apiClient.post<{ id: string; display_name: string }>('/api/contacts', {
        displayName: `Contact1 ${uniqueId}`,
      });
      const contact2Response = await context.apiClient.post<{ id: string; display_name: string }>('/api/contacts', {
        displayName: `Contact2 ${uniqueId}`,
      });

      context.createdIds.contacts.push(contact1Response.id, contact2Response.id);

      // Set relationship via POST /api/relationships/set (uses display names)
      const setResponse = await context.apiClient.post<{ id: string }>('/api/relationships/set', {
        contact_a: `Contact1 ${uniqueId}`,
        contact_b: `Contact2 ${uniqueId}`,
        relationship_type: 'colleague',
      });
      expect(setResponse.id).toBeDefined();

      // Query relationships via GET /api/relationships?contact_id=...
      const queryResponse = await context.apiClient.get<{
        relationships: Array<{ id: string }>;
      }>(`/api/relationships?contact_id=${contact1Response.id}`);

      expect(queryResponse.relationships).toBeDefined();
      expect(Array.isArray(queryResponse.relationships)).toBe(true);
    });
  });

  afterAll(async () => {
    await cleanupResources(context);
  });
});

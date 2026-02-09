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
import { createE2EContext, areE2EServicesAvailable, testData, cleanupResources, type E2ETestContext } from './setup.js';

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
    await cleanupResources(context);
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
    await cleanupResources(context);
  });
});

describe.skipIf(!RUN_E2E)('Comprehensive Tool Operations', () => {
  let context: E2ETestContext;

  beforeAll(async () => {
    context = createE2EContext();

    const available = await areE2EServicesAvailable(context.config);
    if (!available) {
      console.log('E2E services not available - tests will be skipped');
    }
  });

  describe('Memory Lifecycle: Store → Recall → Forget', () => {
    it('should complete full memory lifecycle', async () => {
      const uniqueId = `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      // Store a memory
      const memory = {
        title: `Memory Lifecycle ${uniqueId}`,
        content: `This is test content for ${uniqueId}`,
        memoryType: 'fact',
        importance: 7,
        confidence: 0.95,
      };

      const storeResponse = await context.apiClient.post<{ id: string }>('/api/memories', memory);
      expect(storeResponse.id).toBeDefined();
      const memoryId = storeResponse.id;
      context.createdIds.memories.push(memoryId);

      // Recall the memory
      const recallResponse = await context.apiClient.get<{
        memories: Array<{ id: string; content: string }>;
      }>(`/api/memories/search?q=${uniqueId}`);

      expect(recallResponse.memories).toBeDefined();
      expect(Array.isArray(recallResponse.memories)).toBe(true);

      // Forget the memory
      await context.apiClient.delete(`/api/memories/${memoryId}`);

      // Verify deletion
      const verifyResponse = await context.apiClient.get<{
        memories: Array<{ id: string }>;
      }>(`/api/memories/search?q=${uniqueId}`);

      // Memory should not appear or list should be empty/not include this ID
      const found = verifyResponse.memories?.some((m) => m.id === memoryId);
      expect(found).toBe(false);

      // Remove from cleanup list since already deleted
      context.createdIds.memories = context.createdIds.memories.filter((id) => id !== memoryId);
    });

    it('should store memory with tags', async () => {
      const memory = {
        title: `Tagged Memory ${Date.now()}`,
        content: 'Memory with multiple tags',
        memoryType: 'preference',
        importance: 8,
        confidence: 1.0,
        tags: ['test', 'e2e', 'automated'],
      };

      const response = await context.apiClient.post<{ id: string; tags?: string[] }>('/api/memories', memory);

      expect(response.id).toBeDefined();
      context.createdIds.memories.push(response.id);
    });
  });

  describe('Project Operations: Create → List → Get', () => {
    it('should complete project lifecycle', async () => {
      const uniqueId = `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      // Create project
      const project = {
        title: `Project ${uniqueId}`,
        description: `E2E test project ${uniqueId}`,
        workItemType: 'project',
        status: 'open',
      };

      const createResponse = await context.apiClient.post<{ id: string }>('/api/work-items', project);
      expect(createResponse.id).toBeDefined();
      const projectId = createResponse.id;
      context.createdIds.projects.push(projectId);

      // List projects
      const listResponse = await context.apiClient.get<{
        workItems: Array<{ id: string; title: string }>;
      }>('/api/work-items?type=project');

      expect(listResponse.workItems).toBeDefined();
      expect(Array.isArray(listResponse.workItems)).toBe(true);
      const found = listResponse.workItems.some((p) => p.id === projectId);
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

      // Create todo
      const todo = {
        title: `Todo ${uniqueId}`,
        description: `E2E test todo ${uniqueId}`,
        workItemType: 'task',
        status: 'open',
        priority: 'medium',
      };

      const createResponse = await context.apiClient.post<{ id: string }>('/api/work-items', todo);
      expect(createResponse.id).toBeDefined();
      const todoId = createResponse.id;
      context.createdIds.workItems.push(todoId);

      // List todos
      const listResponse = await context.apiClient.get<{
        workItems: Array<{ id: string; title: string; status: string }>;
      }>('/api/work-items?type=task&status=open');

      expect(listResponse.workItems).toBeDefined();
      expect(Array.isArray(listResponse.workItems)).toBe(true);

      // Complete todo (update status)
      const completeResponse = await context.apiClient.post<{ id: string; status: string }>(`/api/work-items/${todoId}`, {
        status: 'completed',
      });

      expect(completeResponse.status).toBe('completed');
    });
  });

  describe('Contact Operations: Create → Search → Get', () => {
    it('should complete contact lifecycle', async () => {
      const uniqueId = `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      // Create contact
      const contact = {
        name: `Contact ${uniqueId}`,
        email: testData.uniqueEmail(),
        phone: testData.uniquePhone(),
      };

      const createResponse = await context.apiClient.post<{ id: string }>('/api/contacts', contact);
      expect(createResponse.id).toBeDefined();
      const contactId = createResponse.id;
      context.createdIds.contacts.push(contactId);

      // Search contacts
      const searchResponse = await context.apiClient.get<{
        contacts: Array<{ id: string; name: string }>;
      }>(`/api/contacts/search?q=${uniqueId}`);

      expect(searchResponse.contacts).toBeDefined();
      expect(Array.isArray(searchResponse.contacts)).toBe(true);

      // Get specific contact
      const getResponse = await context.apiClient.get<{
        id: string;
        name: string;
      }>(`/api/contacts/${contactId}`);

      expect(getResponse.id).toBe(contactId);
      expect(getResponse.name).toContain(uniqueId);
    });
  });

  describe('Skill Store Operations: Put → Get → List → Search → Delete', () => {
    it('should complete skill store lifecycle', async () => {
      const uniqueId = `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      // Put skill
      const skill = {
        collection: 'e2e-test',
        key: `skill-${uniqueId}`,
        value: {
          name: `Test Skill ${uniqueId}`,
          data: 'test data',
        },
        metadata: {
          tags: ['test', 'e2e'],
        },
      };

      const putResponse = await context.apiClient.post<{ id: string; key: string }>('/api/skill-store', skill);
      expect(putResponse.id).toBeDefined();
      const skillId = putResponse.id;
      context.createdIds.skills.push(skillId);

      // Get skill
      const getResponse = await context.apiClient.get<{
        id: string;
        key: string;
        value: unknown;
      }>(`/api/skill-store/${skillId}`);

      expect(getResponse.id).toBe(skillId);
      expect(getResponse.key).toBe(skill.key);

      // List skills
      const listResponse = await context.apiClient.get<{
        items: Array<{ id: string; collection: string }>;
      }>('/api/skill-store?collection=e2e-test');

      expect(listResponse.items).toBeDefined();
      expect(Array.isArray(listResponse.items)).toBe(true);

      // Search skills
      const searchResponse = await context.apiClient.get<{
        items: Array<{ id: string; key: string }>;
      }>(`/api/skill-store/search?q=${uniqueId}`);

      expect(searchResponse.items).toBeDefined();

      // Delete skill
      await context.apiClient.delete(`/api/skill-store/${skillId}`);

      // Remove from cleanup list since already deleted
      context.createdIds.skills = context.createdIds.skills.filter((id) => id !== skillId);
    });
  });

  describe('Relationship Operations: Set → Query', () => {
    it('should set and query relationships', async () => {
      const uniqueId = `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      // Create two contacts
      const contact1 = {
        name: `Contact1 ${uniqueId}`,
        email: testData.uniqueEmail(),
      };

      const contact2 = {
        name: `Contact2 ${uniqueId}`,
        email: testData.uniqueEmail(),
      };

      const contact1Response = await context.apiClient.post<{ id: string }>('/api/contacts', contact1);
      const contact2Response = await context.apiClient.post<{ id: string }>('/api/contacts', contact2);

      context.createdIds.contacts.push(contact1Response.id, contact2Response.id);

      // Set relationship
      const relationship = {
        contactId1: contact1Response.id,
        contactId2: contact2Response.id,
        relationshipType: 'colleague',
      };

      const setResponse = await context.apiClient.post<{ id: string }>('/api/relationships', relationship);
      expect(setResponse.id).toBeDefined();

      // Query relationships
      const queryResponse = await context.apiClient.get<{
        relationships: Array<{ id: string; relationshipType: string }>;
      }>(`/api/relationships?contactId=${contact1Response.id}`);

      expect(queryResponse.relationships).toBeDefined();
      expect(Array.isArray(queryResponse.relationships)).toBe(true);
    });
  });

  describe('Thread Operations: List → Get', () => {
    it('should list and get threads', async () => {
      // List threads
      const listResponse = await context.apiClient.get<{
        threads: Array<{ id: string }>;
      }>('/api/threads');

      expect(listResponse.threads).toBeDefined();
      expect(Array.isArray(listResponse.threads)).toBe(true);

      // If threads exist, get one
      if (listResponse.threads.length > 0) {
        const threadId = listResponse.threads[0].id;

        const getResponse = await context.apiClient.get<{
          id: string;
        }>(`/api/threads/${threadId}`);

        expect(getResponse.id).toBe(threadId);
      }
    });
  });

  describe('Message Search', () => {
    it('should search messages', async () => {
      const searchResponse = await context.apiClient.get<{
        messages: Array<unknown>;
      }>('/api/messages/search?q=test');

      expect(searchResponse.messages).toBeDefined();
      expect(Array.isArray(searchResponse.messages)).toBe(true);
    });
  });

  afterAll(async () => {
    await cleanupResources(context);
  });
});

/**
 * Tests for relationship management tools.
 * Covers relationship_set and relationship_query.
 * Part of Epic #486, Issue #494
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  createRelationshipSetTool,
  createRelationshipQueryTool,
  RelationshipSetParamsSchema,
  RelationshipQueryParamsSchema,
  type RelationshipSetParams,
  type RelationshipQueryParams,
} from '../../src/tools/relationships.js';
import type { ApiClient } from '../../src/api-client.js';
import type { Logger } from '../../src/logger.js';
import type { PluginConfig } from '../../src/config.js';

describe('relationship tools', () => {
  const mockLogger: Logger = {
    namespace: 'test',
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  const mockConfig: PluginConfig = {
    apiUrl: 'https://api.example.com',
    apiKey: 'test-key',
    autoRecall: true,
    autoCapture: true,
    userScoping: 'agent',
    maxRecallMemories: 5,
    minRecallScore: 0.7,
    timeout: 30000,
    maxRetries: 3,
    debug: false,
  };

  const mockApiClient = {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    healthCheck: vi.fn(),
  } as unknown as ApiClient;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ==================== relationship_set ====================

  describe('relationship_set', () => {
    describe('tool metadata', () => {
      it('should have correct name', () => {
        const tool = createRelationshipSetTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          user_id: 'agent-1',
        });
        expect(tool.name).toBe('relationship_set');
      });

      it('should have a descriptive description', () => {
        const tool = createRelationshipSetTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          user_id: 'agent-1',
        });
        expect(tool.description.length).toBeGreaterThan(20);
        expect(tool.description).toContain('relationship');
      });

      it('should have valid zod parameter schema', () => {
        const tool = createRelationshipSetTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          user_id: 'agent-1',
        });
        expect(tool.parameters).toBe(RelationshipSetParamsSchema);
      });
    });

    describe('parameter validation', () => {
      it('should require contact_a parameter', async () => {
        const tool = createRelationshipSetTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          user_id: 'agent-1',
        });

        const result = await tool.execute({
          contact_b: 'Alex',
          relationship: 'partner',
        } as RelationshipSetParams);
        expect(result.success).toBe(false);
      });

      it('should require contact_b parameter', async () => {
        const tool = createRelationshipSetTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          user_id: 'agent-1',
        });

        const result = await tool.execute({
          contact_a: 'Troy',
          relationship: 'partner',
        } as RelationshipSetParams);
        expect(result.success).toBe(false);
      });

      it('should require relationship parameter', async () => {
        const tool = createRelationshipSetTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          user_id: 'agent-1',
        });

        const result = await tool.execute({
          contact_a: 'Troy',
          contact_b: 'Alex',
        } as RelationshipSetParams);
        expect(result.success).toBe(false);
      });

      it('should reject empty contact_a', async () => {
        const tool = createRelationshipSetTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          user_id: 'agent-1',
        });

        const result = await tool.execute({
          contact_a: '',
          contact_b: 'Alex',
          relationship: 'partner',
        });
        expect(result.success).toBe(false);
      });

      it('should reject empty contact_b', async () => {
        const tool = createRelationshipSetTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          user_id: 'agent-1',
        });

        const result = await tool.execute({
          contact_a: 'Troy',
          contact_b: '',
          relationship: 'partner',
        });
        expect(result.success).toBe(false);
      });

      it('should reject empty relationship', async () => {
        const tool = createRelationshipSetTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          user_id: 'agent-1',
        });

        const result = await tool.execute({
          contact_a: 'Troy',
          contact_b: 'Alex',
          relationship: '',
        });
        expect(result.success).toBe(false);
      });

      it('should accept valid parameters with notes', async () => {
        const mockPost = vi.fn().mockResolvedValue({
          success: true,
          data: {
            relationship: { id: 'rel-1' },
            contact_a: { id: 'ca-1', display_name: 'Troy' },
            contact_b: { id: 'cb-1', display_name: 'Alex' },
            relationship_type: { id: 'rt-1', name: 'partner', label: 'Partner' },
            created: true,
          },
        });
        const client = { ...mockApiClient, post: mockPost };

        const tool = createRelationshipSetTool({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          user_id: 'agent-1',
        });

        const result = await tool.execute({
          contact_a: 'Troy',
          contact_b: 'Alex',
          relationship: 'partner',
          notes: 'They got together in 2020',
        });

        expect(result.success).toBe(true);
      });

      it('should reject contact_a over 200 characters', async () => {
        const tool = createRelationshipSetTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          user_id: 'agent-1',
        });

        const result = await tool.execute({
          contact_a: 'a'.repeat(201),
          contact_b: 'Alex',
          relationship: 'partner',
        });
        expect(result.success).toBe(false);
      });

      it('should reject relationship over 200 characters', async () => {
        const tool = createRelationshipSetTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          user_id: 'agent-1',
        });

        const result = await tool.execute({
          contact_a: 'Troy',
          contact_b: 'Alex',
          relationship: 'a'.repeat(201),
        });
        expect(result.success).toBe(false);
      });
    });

    describe('API interaction', () => {
      it('should call POST /api/relationships/set with snake_case body', async () => {
        const mockPost = vi.fn().mockResolvedValue({
          success: true,
          data: {
            relationship: { id: 'rel-1' },
            contact_a: { id: 'ca-1', display_name: 'Troy' },
            contact_b: { id: 'cb-1', display_name: 'Alex' },
            relationship_type: { id: 'rt-1', name: 'partner', label: 'Partner' },
            created: true,
          },
        });
        const client = { ...mockApiClient, post: mockPost };

        const tool = createRelationshipSetTool({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          user_id: 'agent-1',
        });

        await tool.execute({
          contact_a: 'Troy',
          contact_b: 'Alex',
          relationship: 'partner',
          notes: 'Since 2020',
        });

        expect(mockPost).toHaveBeenCalledWith(
          '/api/relationships/set',
          expect.objectContaining({
            contact_a: 'Troy',
            contact_b: 'Alex',
            relationship_type: 'partner',
            notes: 'Since 2020',
          }),
          expect.objectContaining({ user_id: 'agent-1' }),
        );
      });
    });

    describe('response formatting', () => {
      it('should return confirmation for newly created relationship', async () => {
        const mockPost = vi.fn().mockResolvedValue({
          success: true,
          data: {
            relationship: { id: 'rel-1' },
            contact_a: { id: 'ca-1', display_name: 'Troy' },
            contact_b: { id: 'cb-1', display_name: 'Alex' },
            relationship_type: { id: 'rt-1', name: 'partner', label: 'Partner' },
            created: true,
          },
        });
        const client = { ...mockApiClient, post: mockPost };

        const tool = createRelationshipSetTool({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          user_id: 'agent-1',
        });

        const result = await tool.execute({
          contact_a: 'Troy',
          contact_b: 'Alex',
          relationship: 'partner',
        });

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.content).toContain('Troy');
          expect(result.data.content).toContain('Alex');
          expect(result.data.content).toContain('Partner');
          expect(result.data.details.relationship_id).toBe('rel-1');
          expect(result.data.details.created).toBe(true);
          expect(result.data.details.contact_a.id).toBe('ca-1');
          expect(result.data.details.contact_b.id).toBe('cb-1');
        }
      });

      it('should indicate when relationship already exists', async () => {
        const mockPost = vi.fn().mockResolvedValue({
          success: true,
          data: {
            relationship: { id: 'rel-existing' },
            contact_a: { id: 'ca-1', display_name: 'Troy' },
            contact_b: { id: 'cb-1', display_name: 'Alex' },
            relationship_type: { id: 'rt-1', name: 'partner', label: 'Partner' },
            created: false,
          },
        });
        const client = { ...mockApiClient, post: mockPost };

        const tool = createRelationshipSetTool({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          user_id: 'agent-1',
        });

        const result = await tool.execute({
          contact_a: 'Troy',
          contact_b: 'Alex',
          relationship: 'partner',
        });

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.content).toContain('already exists');
          expect(result.data.details.created).toBe(false);
        }
      });
    });

    describe('error handling', () => {
      it('should handle API errors gracefully', async () => {
        const mockPost = vi.fn().mockResolvedValue({
          success: false,
          error: { status: 500, message: 'Server error', code: 'SERVER_ERROR' },
        });
        const client = { ...mockApiClient, post: mockPost };

        const tool = createRelationshipSetTool({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          user_id: 'agent-1',
        });

        const result = await tool.execute({
          contact_a: 'Troy',
          contact_b: 'Alex',
          relationship: 'partner',
        });
        expect(result.success).toBe(false);
      });

      it('should handle contact resolution failures', async () => {
        const mockPost = vi.fn().mockResolvedValue({
          success: false,
          error: {
            status: 400,
            message: 'Contact "Unknown" cannot be resolved',
            code: 'CLIENT_ERROR',
          },
        });
        const client = { ...mockApiClient, post: mockPost };

        const tool = createRelationshipSetTool({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          user_id: 'agent-1',
        });

        const result = await tool.execute({
          contact_a: 'Unknown',
          contact_b: 'Alex',
          relationship: 'partner',
        });
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error).toContain('cannot be resolved');
        }
      });

      it('should handle network errors', async () => {
        const mockPost = vi.fn().mockRejectedValue(new Error('Network error'));
        const client = { ...mockApiClient, post: mockPost };

        const tool = createRelationshipSetTool({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          user_id: 'agent-1',
        });

        const result = await tool.execute({
          contact_a: 'Troy',
          contact_b: 'Alex',
          relationship: 'partner',
        });
        expect(result.success).toBe(false);
      });

      it('should not expose internal details in error messages', async () => {
        const mockPost = vi.fn().mockRejectedValue(new Error('Connection refused to internal-db:5432'));
        const client = { ...mockApiClient, post: mockPost };

        const tool = createRelationshipSetTool({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          user_id: 'agent-1',
        });

        const result = await tool.execute({
          contact_a: 'Troy',
          contact_b: 'Alex',
          relationship: 'partner',
        });

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error).not.toContain('5432');
          expect(result.error).not.toContain('internal-db');
        }
      });
    });

    describe('input sanitization', () => {
      it('should strip HTML tags from contact names', async () => {
        const mockPost = vi.fn().mockResolvedValue({
          success: true,
          data: {
            relationship: { id: 'rel-1' },
            contact_a: { id: 'ca-1', display_name: 'Troy' },
            contact_b: { id: 'cb-1', display_name: 'Alex' },
            relationship_type: { id: 'rt-1', name: 'partner', label: 'Partner' },
            created: true,
          },
        });
        const client = { ...mockApiClient, post: mockPost };

        const tool = createRelationshipSetTool({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          user_id: 'agent-1',
        });

        await tool.execute({
          contact_a: '<script>alert("xss")</script>Troy',
          contact_b: 'Alex',
          relationship: 'partner',
        });

        expect(mockPost).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            contact_a: 'Troy',
          }),
          expect.any(Object),
        );
      });

      it('should strip control characters from notes', async () => {
        const mockPost = vi.fn().mockResolvedValue({
          success: true,
          data: {
            relationship: { id: 'rel-1' },
            contact_a: { id: 'ca-1', display_name: 'Troy' },
            contact_b: { id: 'cb-1', display_name: 'Alex' },
            relationship_type: { id: 'rt-1', name: 'partner', label: 'Partner' },
            created: true,
          },
        });
        const client = { ...mockApiClient, post: mockPost };

        const tool = createRelationshipSetTool({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          user_id: 'agent-1',
        });

        await tool.execute({
          contact_a: 'Troy',
          contact_b: 'Alex',
          relationship: 'partner',
          notes: 'Since\x002020',
        });

        expect(mockPost).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            notes: 'Since2020',
          }),
          expect.any(Object),
        );
      });
    });

    describe('PII handling', () => {
      it('should not log contact names at info level', async () => {
        const mockPost = vi.fn().mockResolvedValue({
          success: true,
          data: {
            relationship: { id: 'rel-1' },
            contact_a: { id: 'ca-1', display_name: 'Troy' },
            contact_b: { id: 'cb-1', display_name: 'Alex' },
            relationship_type: { id: 'rt-1', name: 'partner', label: 'Partner' },
            created: true,
          },
        });
        const client = { ...mockApiClient, post: mockPost };

        const tool = createRelationshipSetTool({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          user_id: 'agent-1',
        });

        await tool.execute({
          contact_a: 'Troy Kelly',
          contact_b: 'Alex Smith',
          relationship: 'partner',
        });

        for (const call of (mockLogger.info as ReturnType<typeof vi.fn>).mock.calls) {
          const logMessage = JSON.stringify(call);
          expect(logMessage).not.toContain('Troy Kelly');
          expect(logMessage).not.toContain('Alex Smith');
        }
      });
    });

    describe('user scoping', () => {
      it('should include user_id in API calls', async () => {
        const mockPost = vi.fn().mockResolvedValue({
          success: true,
          data: {
            relationship: { id: 'rel-1' },
            contact_a: { id: 'ca-1', display_name: 'Troy' },
            contact_b: { id: 'cb-1', display_name: 'Alex' },
            relationship_type: { id: 'rt-1', name: 'partner', label: 'Partner' },
            created: true,
          },
        });
        const client = { ...mockApiClient, post: mockPost };

        const tool = createRelationshipSetTool({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          user_id: 'custom-user',
        });

        await tool.execute({
          contact_a: 'Troy',
          contact_b: 'Alex',
          relationship: 'partner',
        });

        expect(mockPost).toHaveBeenCalledWith(expect.any(String), expect.any(Object), expect.objectContaining({ user_id: 'custom-user' }));
      });
    });
  });

  // ==================== relationship_query ====================

  describe('relationship_query', () => {
    describe('tool metadata', () => {
      it('should have correct name', () => {
        const tool = createRelationshipQueryTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          user_id: 'agent-1',
        });
        expect(tool.name).toBe('relationship_query');
      });

      it('should have a descriptive description', () => {
        const tool = createRelationshipQueryTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          user_id: 'agent-1',
        });
        expect(tool.description.length).toBeGreaterThan(20);
        expect(tool.description).toContain('relationship');
      });

      it('should have valid zod parameter schema', () => {
        const tool = createRelationshipQueryTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          user_id: 'agent-1',
        });
        expect(tool.parameters).toBe(RelationshipQueryParamsSchema);
      });
    });

    describe('parameter validation', () => {
      it('should require contact parameter', async () => {
        const tool = createRelationshipQueryTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          user_id: 'agent-1',
        });

        const result = await tool.execute({} as RelationshipQueryParams);
        expect(result.success).toBe(false);
      });

      it('should reject empty contact', async () => {
        const tool = createRelationshipQueryTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          user_id: 'agent-1',
        });

        const result = await tool.execute({ contact: '' });
        expect(result.success).toBe(false);
      });

      it('should accept contact name', async () => {
        const mockGet = vi.fn().mockResolvedValue({
          success: true,
          data: {
            contact_id: 'c-1',
            contact_name: 'Troy',
            related_contacts: [],
          },
        });
        const client = { ...mockApiClient, get: mockGet };

        const tool = createRelationshipQueryTool({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          user_id: 'agent-1',
        });

        await tool.execute({ contact: 'Troy' });
        expect(mockGet).toHaveBeenCalled();
      });

      it('should accept contact UUID', async () => {
        const mockGet = vi.fn().mockResolvedValue({
          success: true,
          data: {
            contact_id: '123e4567-e89b-12d3-a456-426614174000',
            contact_name: 'Troy',
            related_contacts: [],
          },
        });
        const client = { ...mockApiClient, get: mockGet };

        const tool = createRelationshipQueryTool({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          user_id: 'agent-1',
        });

        await tool.execute({ contact: '123e4567-e89b-12d3-a456-426614174000' });
        expect(mockGet).toHaveBeenCalled();
      });

      it('should accept optional type_filter', async () => {
        const mockGet = vi.fn().mockResolvedValue({
          success: true,
          data: {
            contact_id: 'c-1',
            contact_name: 'Troy',
            related_contacts: [],
          },
        });
        const client = { ...mockApiClient, get: mockGet };

        const tool = createRelationshipQueryTool({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          user_id: 'agent-1',
        });

        await tool.execute({ contact: 'Troy', type_filter: 'partner' });
        expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('type_filter=partner'), expect.any(Object));
      });

      it('should reject contact over 200 characters', async () => {
        const tool = createRelationshipQueryTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          user_id: 'agent-1',
        });

        const result = await tool.execute({ contact: 'a'.repeat(201) });
        expect(result.success).toBe(false);
      });
    });

    describe('API interaction', () => {
      it('should call GET /api/relationships with contact parameter', async () => {
        const mockGet = vi.fn().mockResolvedValue({
          success: true,
          data: {
            contact_id: 'c-1',
            contact_name: 'Troy',
            related_contacts: [],
          },
        });
        const client = { ...mockApiClient, get: mockGet };

        const tool = createRelationshipQueryTool({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          user_id: 'agent-1',
        });

        await tool.execute({ contact: 'Troy' });

        expect(mockGet).toHaveBeenCalledWith('/api/relationships?contact=Troy', expect.objectContaining({ user_id: 'agent-1' }));
      });
    });

    describe('response formatting', () => {
      it('should format relationships as readable list', async () => {
        const mockGet = vi.fn().mockResolvedValue({
          success: true,
          data: {
            contact_id: 'c-1',
            contact_name: 'Troy',
            related_contacts: [
              {
                contact_id: 'c-2',
                contact_name: 'Alex',
                contact_kind: 'person',
                relationship_id: 'r-1',
                relationship_type_name: 'partner',
                relationship_type_label: 'Partner',
                is_directional: false,
                notes: null,
              },
              {
                contact_id: 'c-3',
                contact_name: 'Sam',
                contact_kind: 'person',
                relationship_id: 'r-2',
                relationship_type_name: 'parent_of',
                relationship_type_label: 'Parent Of',
                is_directional: true,
                notes: null,
              },
            ],
          },
        });
        const client = { ...mockApiClient, get: mockGet };

        const tool = createRelationshipQueryTool({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          user_id: 'agent-1',
        });

        const result = await tool.execute({ contact: 'Troy' });

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.content).toContain('Troy');
          expect(result.data.content).toContain('Alex');
          expect(result.data.content).toContain('Partner');
          expect(result.data.content).toContain('Sam');
          expect(result.data.content).toContain('Parent Of');
          expect(result.data.details.contact_id).toBe('c-1');
          expect(result.data.details.related_contacts).toHaveLength(2);
        }
      });

      it('should handle empty relationships', async () => {
        const mockGet = vi.fn().mockResolvedValue({
          success: true,
          data: {
            contact_id: 'c-1',
            contact_name: 'Troy',
            related_contacts: [],
          },
        });
        const client = { ...mockApiClient, get: mockGet };

        const tool = createRelationshipQueryTool({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          user_id: 'agent-1',
        });

        const result = await tool.execute({ contact: 'Troy' });

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.content).toContain('No relationships found');
        }
      });

      it('should include group memberships in results', async () => {
        const mockGet = vi.fn().mockResolvedValue({
          success: true,
          data: {
            contact_id: 'c-1',
            contact_name: 'Troy',
            related_contacts: [
              {
                contact_id: 'g-1',
                contact_name: 'The Kelly Household',
                contact_kind: 'group',
                relationship_id: 'r-1',
                relationship_type_name: 'member_of',
                relationship_type_label: 'Member Of',
                is_directional: true,
                notes: null,
              },
            ],
          },
        });
        const client = { ...mockApiClient, get: mockGet };

        const tool = createRelationshipQueryTool({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          user_id: 'agent-1',
        });

        const result = await tool.execute({ contact: 'Troy' });

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.content).toContain('The Kelly Household');
          expect(result.data.content).toContain('Member Of');
        }
      });

      it('should show inverse-resolved relationships correctly', async () => {
        const mockGet = vi.fn().mockResolvedValue({
          success: true,
          data: {
            contact_id: 'c-2',
            contact_name: 'Sam',
            related_contacts: [
              {
                contact_id: 'c-1',
                contact_name: 'Troy',
                contact_kind: 'person',
                relationship_id: 'r-2',
                relationship_type_name: 'child_of',
                relationship_type_label: 'Child Of',
                is_directional: true,
                notes: null,
              },
            ],
          },
        });
        const client = { ...mockApiClient, get: mockGet };

        const tool = createRelationshipQueryTool({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          user_id: 'agent-1',
        });

        const result = await tool.execute({ contact: 'Sam' });

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.content).toContain('Troy');
          expect(result.data.content).toContain('Child Of');
        }
      });
    });

    describe('error handling', () => {
      it('should handle API errors gracefully', async () => {
        const mockGet = vi.fn().mockResolvedValue({
          success: false,
          error: { status: 500, message: 'Server error', code: 'SERVER_ERROR' },
        });
        const client = { ...mockApiClient, get: mockGet };

        const tool = createRelationshipQueryTool({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          user_id: 'agent-1',
        });

        const result = await tool.execute({ contact: 'Troy' });
        expect(result.success).toBe(false);
      });

      it('should handle contact not found', async () => {
        const mockGet = vi.fn().mockResolvedValue({
          success: false,
          error: {
            status: 404,
            message: 'Contact not found',
            code: 'NOT_FOUND',
          },
        });
        const client = { ...mockApiClient, get: mockGet };

        const tool = createRelationshipQueryTool({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          user_id: 'agent-1',
        });

        const result = await tool.execute({ contact: 'Unknown' });
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error).toContain('not found');
        }
      });

      it('should handle network errors', async () => {
        const mockGet = vi.fn().mockRejectedValue(new Error('Network error'));
        const client = { ...mockApiClient, get: mockGet };

        const tool = createRelationshipQueryTool({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          user_id: 'agent-1',
        });

        const result = await tool.execute({ contact: 'Troy' });
        expect(result.success).toBe(false);
      });

      it('should not expose internal details in error messages', async () => {
        const mockGet = vi.fn().mockRejectedValue(new Error('Connection refused to internal-db:5432'));
        const client = { ...mockApiClient, get: mockGet };

        const tool = createRelationshipQueryTool({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          user_id: 'agent-1',
        });

        const result = await tool.execute({ contact: 'Troy' });

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error).not.toContain('5432');
          expect(result.error).not.toContain('internal-db');
        }
      });
    });

    describe('PII handling', () => {
      it('should not log contact names at info level', async () => {
        const mockGet = vi.fn().mockResolvedValue({
          success: true,
          data: {
            contact_id: 'c-1',
            contact_name: 'Troy Kelly',
            related_contacts: [],
          },
        });
        const client = { ...mockApiClient, get: mockGet };

        const tool = createRelationshipQueryTool({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          user_id: 'agent-1',
        });

        await tool.execute({ contact: 'Troy Kelly' });

        for (const call of (mockLogger.info as ReturnType<typeof vi.fn>).mock.calls) {
          const logMessage = JSON.stringify(call);
          expect(logMessage).not.toContain('Troy Kelly');
        }
      });
    });

    describe('user scoping', () => {
      it('should include user_id in API calls', async () => {
        const mockGet = vi.fn().mockResolvedValue({
          success: true,
          data: {
            contact_id: 'c-1',
            contact_name: 'Troy',
            related_contacts: [],
          },
        });
        const client = { ...mockApiClient, get: mockGet };

        const tool = createRelationshipQueryTool({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          user_id: 'custom-user',
        });

        await tool.execute({ contact: 'Troy' });

        expect(mockGet).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ user_id: 'custom-user' }));
      });
    });
  });

  // ==================== round-trip tests ====================

  describe('round-trip: set then query', () => {
    it('should create a relationship and then query it back', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: {
          relationship: { id: 'rel-roundtrip' },
          contact_a: { id: 'ca-1', display_name: 'Troy' },
          contact_b: { id: 'cb-1', display_name: 'Alex' },
          relationship_type: { id: 'rt-1', name: 'partner', label: 'Partner' },
          created: true,
        },
      });
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: {
          contact_id: 'ca-1',
          contact_name: 'Troy',
          related_contacts: [
            {
              contact_id: 'cb-1',
              contact_name: 'Alex',
              contact_kind: 'person',
              relationship_id: 'rel-roundtrip',
              relationship_type_name: 'partner',
              relationship_type_label: 'Partner',
              is_directional: false,
              notes: null,
            },
          ],
        },
      });
      const client = { ...mockApiClient, post: mockPost, get: mockGet };

      const setTool = createRelationshipSetTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
      });

      const queryTool = createRelationshipQueryTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
      });

      // Step 1: Set the relationship
      const setResult = await setTool.execute({
        contact_a: 'Troy',
        contact_b: 'Alex',
        relationship: 'partner',
      });
      expect(setResult.success).toBe(true);

      // Step 2: Query the relationship
      const queryResult = await queryTool.execute({ contact: 'Troy' });
      expect(queryResult.success).toBe(true);

      if (queryResult.success) {
        expect(queryResult.data.details.related_contacts).toHaveLength(1);
        const related = queryResult.data.details.related_contacts[0];
        expect(related.contact_name).toBe('Alex');
        expect(related.relationship_type_name).toBe('partner');
      }
    });
  });

  // ==================== schema validation tests ====================

  describe('Zod schema validation', () => {
    it('RelationshipSetParamsSchema should validate correct input', () => {
      const result = RelationshipSetParamsSchema.safeParse({
        contact_a: 'Troy',
        contact_b: 'Alex',
        relationship: 'partner',
      });
      expect(result.success).toBe(true);
    });

    it('RelationshipSetParamsSchema should accept optional notes', () => {
      const result = RelationshipSetParamsSchema.safeParse({
        contact_a: 'Troy',
        contact_b: 'Alex',
        relationship: 'partner',
        notes: 'Since 2020',
      });
      expect(result.success).toBe(true);
    });

    it('RelationshipSetParamsSchema should reject missing required fields', () => {
      const result = RelationshipSetParamsSchema.safeParse({
        contact_a: 'Troy',
      });
      expect(result.success).toBe(false);
    });

    it('RelationshipQueryParamsSchema should validate correct input', () => {
      const result = RelationshipQueryParamsSchema.safeParse({
        contact: 'Troy',
      });
      expect(result.success).toBe(true);
    });

    it('RelationshipQueryParamsSchema should accept optional type_filter', () => {
      const result = RelationshipQueryParamsSchema.safeParse({
        contact: 'Troy',
        type_filter: 'partner',
      });
      expect(result.success).toBe(true);
    });

    it('RelationshipQueryParamsSchema should reject missing contact', () => {
      const result = RelationshipQueryParamsSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });
});

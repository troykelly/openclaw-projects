/**
 * Contract tests for API onboarding plugin tools.
 * Validates schema definitions and factory functions for all 9 API tools.
 * Part of API Onboarding feature (#1784, #1785).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ApiClient, ApiResponse } from '../../packages/openclaw-plugin/src/api-client.js';
import type { Logger } from '../../packages/openclaw-plugin/src/logger.js';
import type { PluginConfig } from '../../packages/openclaw-plugin/src/config.js';

// Import all tool factories and schemas
import { createApiOnboardTool, ApiOnboardParamsSchema } from '../../packages/openclaw-plugin/src/tools/api-onboard.js';
import { createApiRecallTool, ApiRecallParamsSchema } from '../../packages/openclaw-plugin/src/tools/api-recall.js';
import { createApiGetTool, ApiGetParamsSchema } from '../../packages/openclaw-plugin/src/tools/api-get.js';
import { createApiListTool, ApiListParamsSchema } from '../../packages/openclaw-plugin/src/tools/api-list.js';
import { createApiUpdateTool, ApiUpdateParamsSchema } from '../../packages/openclaw-plugin/src/tools/api-update.js';
import { createApiCredentialManageTool, ApiCredentialManageParamsSchema } from '../../packages/openclaw-plugin/src/tools/api-credential-manage.js';
import { createApiRefreshTool, ApiRefreshParamsSchema } from '../../packages/openclaw-plugin/src/tools/api-refresh.js';
import { createApiRemoveTool, ApiRemoveParamsSchema } from '../../packages/openclaw-plugin/src/tools/api-remove.js';
import { createApiRestoreTool, ApiRestoreParamsSchema } from '../../packages/openclaw-plugin/src/tools/api-restore.js';

// ── Mock helpers ────────────────────────────────────────────────────────────

function createMockLogger(): Logger {
  return {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;
}

function createMockConfig(): PluginConfig {
  return {
    apiUrl: 'http://localhost:3000',
    apiKey: 'test-key',
    timeout: 5000,
    maxRetries: 0,
  } as unknown as PluginConfig;
}

function createMockClient(overrides?: {
  get?: (...args: unknown[]) => Promise<ApiResponse<unknown>>;
  post?: (...args: unknown[]) => Promise<ApiResponse<unknown>>;
  patch?: (...args: unknown[]) => Promise<ApiResponse<unknown>>;
  delete?: (...args: unknown[]) => Promise<ApiResponse<unknown>>;
}): ApiClient {
  return {
    get: overrides?.get ?? vi.fn().mockResolvedValue({ success: true, data: {} }),
    post: overrides?.post ?? vi.fn().mockResolvedValue({ success: true, data: {} }),
    patch: overrides?.patch ?? vi.fn().mockResolvedValue({ success: true, data: {} }),
    put: vi.fn().mockResolvedValue({ success: true, data: {} }),
    delete: overrides?.delete ?? vi.fn().mockResolvedValue({ success: true, data: undefined }),
    healthCheck: vi.fn(),
  } as unknown as ApiClient;
}

const TEST_UUID = '01234567-89ab-cdef-0123-456789abcdef';
const TEST_USER = 'test-agent';

// ── Tests ───────────────────────────────────────────────────────────────────

describe('API Tool Schemas', () => {
  describe('ApiOnboardParamsSchema', () => {
    it('should accept valid params with spec_url', () => {
      const result = ApiOnboardParamsSchema.safeParse({
        spec_url: 'https://example.com/openapi.json',
        name: 'Test API',
      });
      expect(result.success).toBe(true);
    });

    it('should accept valid params with spec_content', () => {
      const result = ApiOnboardParamsSchema.safeParse({
        spec_content: '{"openapi":"3.0.0"}',
      });
      expect(result.success).toBe(true);
    });

    it('should reject when neither spec_url nor spec_content provided', () => {
      const result = ApiOnboardParamsSchema.safeParse({ name: 'Test' });
      expect(result.success).toBe(false);
    });
  });

  describe('ApiRecallParamsSchema', () => {
    it('should accept valid query', () => {
      const result = ApiRecallParamsSchema.safeParse({ query: 'weather forecast' });
      expect(result.success).toBe(true);
    });

    it('should reject empty query', () => {
      const result = ApiRecallParamsSchema.safeParse({ query: '' });
      expect(result.success).toBe(false);
    });

    it('should accept optional filters', () => {
      const result = ApiRecallParamsSchema.safeParse({
        query: 'departures',
        memory_kind: 'operation',
        api_source_id: TEST_UUID,
        limit: 5,
        tags: ['transport'],
      });
      expect(result.success).toBe(true);
    });
  });

  describe('ApiGetParamsSchema', () => {
    it('should accept valid UUID', () => {
      expect(ApiGetParamsSchema.safeParse({ id: TEST_UUID }).success).toBe(true);
    });

    it('should reject invalid UUID', () => {
      expect(ApiGetParamsSchema.safeParse({ id: 'not-a-uuid' }).success).toBe(false);
    });
  });

  describe('ApiListParamsSchema', () => {
    it('should accept empty params', () => {
      expect(ApiListParamsSchema.safeParse({}).success).toBe(true);
    });

    it('should accept status filter', () => {
      expect(ApiListParamsSchema.safeParse({ status: 'active' }).success).toBe(true);
    });

    it('should reject invalid status', () => {
      expect(ApiListParamsSchema.safeParse({ status: 'invalid' }).success).toBe(false);
    });
  });

  describe('ApiUpdateParamsSchema', () => {
    it('should accept id with optional fields', () => {
      const result = ApiUpdateParamsSchema.safeParse({
        id: TEST_UUID,
        name: 'Updated Name',
        tags: ['api', 'transport'],
      });
      expect(result.success).toBe(true);
    });
  });

  describe('ApiCredentialManageParamsSchema', () => {
    it('should accept add action with required fields', () => {
      const result = ApiCredentialManageParamsSchema.safeParse({
        api_source_id: TEST_UUID,
        action: 'add',
        header_name: 'Authorization',
        resolve_strategy: 'literal',
        resolve_reference: 'my-api-key',
      });
      expect(result.success).toBe(true);
    });

    it('should accept remove action with credential_id', () => {
      const result = ApiCredentialManageParamsSchema.safeParse({
        api_source_id: TEST_UUID,
        action: 'remove',
        credential_id: TEST_UUID,
      });
      expect(result.success).toBe(true);
    });

    it('should reject add without required fields', () => {
      const result = ApiCredentialManageParamsSchema.safeParse({
        api_source_id: TEST_UUID,
        action: 'add',
      });
      expect(result.success).toBe(false);
    });

    it('should reject remove without credential_id', () => {
      const result = ApiCredentialManageParamsSchema.safeParse({
        api_source_id: TEST_UUID,
        action: 'remove',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('ApiRefreshParamsSchema', () => {
    it('should accept valid UUID', () => {
      expect(ApiRefreshParamsSchema.safeParse({ id: TEST_UUID }).success).toBe(true);
    });
  });

  describe('ApiRemoveParamsSchema', () => {
    it('should accept valid UUID', () => {
      expect(ApiRemoveParamsSchema.safeParse({ id: TEST_UUID }).success).toBe(true);
    });
  });

  describe('ApiRestoreParamsSchema', () => {
    it('should accept valid UUID', () => {
      expect(ApiRestoreParamsSchema.safeParse({ id: TEST_UUID }).success).toBe(true);
    });
  });
});

describe('API Tool Factories', () => {
  let logger: Logger;
  let config: PluginConfig;

  beforeEach(() => {
    logger = createMockLogger();
    config = createMockConfig();
  });

  describe('createApiOnboardTool', () => {
    it('should create a tool with correct name', () => {
      const tool = createApiOnboardTool({ client: createMockClient(), logger, config, user_id: TEST_USER });
      expect(tool.name).toBe('api_onboard');
    });

    it('should return success on successful onboard', async () => {
      const client = createMockClient({
        post: vi.fn().mockResolvedValue({
          success: true,
          data: {
            data: {
              api_source: { id: TEST_UUID, name: 'Weather API' },
              memories_created: 5,
              memories_updated: 0,
              memories_deleted: 0,
            },
          },
        }),
      });

      const tool = createApiOnboardTool({ client, logger, config, user_id: TEST_USER });
      const result = await tool.execute({
        spec_url: 'https://example.com/openapi.json',
        name: 'Weather API',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.details.memories_created).toBe(5);
        expect(result.data.details.api_source_id).toBe(TEST_UUID);
      }
    });

    it('should return failure on API error', async () => {
      const client = createMockClient({
        post: vi.fn().mockResolvedValue({
          success: false,
          error: { status: 400, message: 'Invalid spec' },
        }),
      });

      const tool = createApiOnboardTool({ client, logger, config, user_id: TEST_USER });
      const result = await tool.execute({
        spec_url: 'https://example.com/bad.json',
      });

      expect(result.success).toBe(false);
    });

    it('should return failure on validation error', async () => {
      const tool = createApiOnboardTool({ client: createMockClient(), logger, config, user_id: TEST_USER });
      // Neither spec_url nor spec_content
      const result = await tool.execute({} as never);
      expect(result.success).toBe(false);
    });
  });

  describe('createApiRecallTool', () => {
    it('should create a tool with correct name', () => {
      const tool = createApiRecallTool({ client: createMockClient(), logger, config, user_id: TEST_USER });
      expect(tool.name).toBe('api_recall');
    });

    it('should return formatted results on success', async () => {
      const client = createMockClient({
        get: vi.fn().mockResolvedValue({
          success: true,
          data: {
            data: [
              {
                id: TEST_UUID,
                api_source_id: TEST_UUID,
                memory_kind: 'operation',
                operation_key: 'GET:/weather',
                title: 'GET /weather',
                content: 'Get current weather',
                metadata: {},
                tags: ['weather'],
                score: 0.85,
              },
            ],
            limit: 10,
            offset: 0,
          },
        }),
      });

      const tool = createApiRecallTool({ client, logger, config, user_id: TEST_USER });
      const result = await tool.execute({ query: 'weather' });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.details.count).toBe(1);
        expect(result.data.content).toContain('1 matching');
      }
    });
  });

  describe('createApiGetTool', () => {
    it('should create a tool with correct name', () => {
      const tool = createApiGetTool({ client: createMockClient(), logger, config, user_id: TEST_USER });
      expect(tool.name).toBe('api_get');
    });

    it('should return source details on success', async () => {
      const client = createMockClient({
        get: vi.fn().mockResolvedValue({
          success: true,
          data: { data: { id: TEST_UUID, name: 'My API', status: 'active', spec_version: '1.0.0' } },
        }),
      });

      const tool = createApiGetTool({ client, logger, config, user_id: TEST_USER });
      const result = await tool.execute({ id: TEST_UUID });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content).toContain('My API');
      }
    });
  });

  describe('createApiListTool', () => {
    it('should create a tool with correct name', () => {
      const tool = createApiListTool({ client: createMockClient(), logger, config, user_id: TEST_USER });
      expect(tool.name).toBe('api_list');
    });

    it('should return list summary on success', async () => {
      const client = createMockClient({
        get: vi.fn().mockResolvedValue({
          success: true,
          data: {
            data: [
              { id: TEST_UUID, name: 'API A', status: 'active' },
              { id: TEST_UUID, name: 'API B', status: 'disabled' },
            ],
            limit: 50,
            offset: 0,
          },
        }),
      });

      const tool = createApiListTool({ client, logger, config, user_id: TEST_USER });
      const result = await tool.execute({});

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.details.count).toBe(2);
      }
    });
  });

  describe('createApiUpdateTool', () => {
    it('should create a tool with correct name', () => {
      const tool = createApiUpdateTool({ client: createMockClient(), logger, config, user_id: TEST_USER });
      expect(tool.name).toBe('api_update');
    });

    it('should return updated source on success', async () => {
      const client = createMockClient({
        patch: vi.fn().mockResolvedValue({
          success: true,
          data: { data: { id: TEST_UUID, name: 'Updated API', status: 'active' } },
        }),
      });

      const tool = createApiUpdateTool({ client, logger, config, user_id: TEST_USER });
      const result = await tool.execute({ id: TEST_UUID, name: 'Updated API' });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content).toContain('Updated API');
      }
    });
  });

  describe('createApiCredentialManageTool', () => {
    it('should create a tool with correct name', () => {
      const tool = createApiCredentialManageTool({ client: createMockClient(), logger, config, user_id: TEST_USER });
      expect(tool.name).toBe('api_credential_manage');
    });

    it('should handle add action', async () => {
      const client = createMockClient({
        post: vi.fn().mockResolvedValue({
          success: true,
          data: { data: { id: TEST_UUID, header_name: 'Authorization' } },
        }),
      });

      const tool = createApiCredentialManageTool({ client, logger, config, user_id: TEST_USER });
      const result = await tool.execute({
        api_source_id: TEST_UUID,
        action: 'add',
        header_name: 'Authorization',
        resolve_strategy: 'literal',
        resolve_reference: 'my-key',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content).toContain('Added');
      }
    });

    it('should handle remove action', async () => {
      const client = createMockClient({
        delete: vi.fn().mockResolvedValue({ success: true, data: undefined }),
      });

      const tool = createApiCredentialManageTool({ client, logger, config, user_id: TEST_USER });
      const result = await tool.execute({
        api_source_id: TEST_UUID,
        action: 'remove',
        credential_id: TEST_UUID,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content).toContain('Removed');
      }
    });
  });

  describe('createApiRefreshTool', () => {
    it('should create a tool with correct name', () => {
      const tool = createApiRefreshTool({ client: createMockClient(), logger, config, user_id: TEST_USER });
      expect(tool.name).toBe('api_refresh');
    });

    it('should return diff summary on success', async () => {
      const client = createMockClient({
        post: vi.fn().mockResolvedValue({
          success: true,
          data: {
            data: {
              api_source: { id: TEST_UUID, name: 'Weather API' },
              spec_changed: true,
              memories_created: 2,
              memories_updated: 1,
              memories_deleted: 0,
            },
          },
        }),
      });

      const tool = createApiRefreshTool({ client, logger, config, user_id: TEST_USER });
      const result = await tool.execute({ id: TEST_UUID });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.details.spec_changed).toBe(true);
        expect(result.data.content).toContain('spec changed');
      }
    });
  });

  describe('createApiRemoveTool', () => {
    it('should create a tool with correct name', () => {
      const tool = createApiRemoveTool({ client: createMockClient(), logger, config, user_id: TEST_USER });
      expect(tool.name).toBe('api_remove');
    });

    it('should return success on remove', async () => {
      const client = createMockClient({
        delete: vi.fn().mockResolvedValue({ success: true, data: undefined }),
      });

      const tool = createApiRemoveTool({ client, logger, config, user_id: TEST_USER });
      const result = await tool.execute({ id: TEST_UUID });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content).toContain('Removed');
      }
    });
  });

  describe('createApiRestoreTool', () => {
    it('should create a tool with correct name', () => {
      const tool = createApiRestoreTool({ client: createMockClient(), logger, config, user_id: TEST_USER });
      expect(tool.name).toBe('api_restore');
    });

    it('should return restored source on success', async () => {
      const client = createMockClient({
        post: vi.fn().mockResolvedValue({
          success: true,
          data: { data: { id: TEST_UUID, name: 'Restored API', status: 'active' } },
        }),
      });

      const tool = createApiRestoreTool({ client, logger, config, user_id: TEST_USER });
      const result = await tool.execute({ id: TEST_UUID });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content).toContain('Restored');
      }
    });
  });
});

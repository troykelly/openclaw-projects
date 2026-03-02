/**
 * Tests for dev prompt tools (Epic #2011, Issue #2015).
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  createDevPromptListTool,
  createDevPromptGetTool,
  createDevPromptCreateTool,
  createDevPromptUpdateTool,
  createDevPromptResetTool,
  DevPromptListParamsSchema,
  DevPromptGetParamsSchema,
  DevPromptCreateParamsSchema,
  DevPromptUpdateParamsSchema,
  DevPromptResetParamsSchema,
  type DevPromptListParams,
  type DevPromptGetParams,
  type DevPromptCreateParams,
  type DevPromptUpdateParams,
  type DevPromptResetParams,
} from '../../src/tools/dev-prompts.js';
import type { ApiClient } from '../../src/api-client.js';
import type { Logger } from '../../src/logger.js';
import type { PluginConfig } from '../../src/config.js';

describe('dev prompt tools (#2015)', () => {
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
    baseUrl: 'https://app.example.com',
  };

  const mockApiClient = {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    healthCheck: vi.fn(),
  } as unknown as ApiClient;

  const toolOpts = {
    client: mockApiClient,
    logger: mockLogger,
    config: mockConfig,
    user_id: 'user@example.com',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Schema validation ─────────────────────────────────────

  describe('DevPromptListParamsSchema', () => {
    it('accepts empty object', () => {
      expect(DevPromptListParamsSchema.safeParse({}).success).toBe(true);
    });

    it('accepts namespace and category', () => {
      const result = DevPromptListParamsSchema.safeParse({
        namespace: 'troy',
        category: 'creation',
      });
      expect(result.success).toBe(true);
    });

    it('rejects invalid category', () => {
      const result = DevPromptListParamsSchema.safeParse({ category: 'invalid' });
      expect(result.success).toBe(false);
    });
  });

  describe('DevPromptGetParamsSchema', () => {
    it('requires key', () => {
      const result = DevPromptGetParamsSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('accepts key with optional params', () => {
      const result = DevPromptGetParamsSchema.safeParse({
        key: 'new_feature_request',
        repo: 'org/repo',
        render: true,
        variables: { extra: 'val' },
      });
      expect(result.success).toBe(true);
    });

    it('defaults render to true', () => {
      const result = DevPromptGetParamsSchema.safeParse({ key: 'test' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.render).toBe(true);
      }
    });
  });

  describe('DevPromptCreateParamsSchema', () => {
    it('requires key', () => {
      const result = DevPromptCreateParamsSchema.safeParse({
        title: 'Test',
        body: 'body',
      });
      expect(result.success).toBe(false);
    });

    it('accepts full create input', () => {
      const result = DevPromptCreateParamsSchema.safeParse({
        key: 'my_prompt',
        title: 'My Prompt',
        body: 'template body',
        category: 'custom',
        namespace: 'troy',
      });
      expect(result.success).toBe(true);
    });

    it('rejects invalid category', () => {
      const result = DevPromptCreateParamsSchema.safeParse({
        key: 'test',
        title: 'T',
        body: 'b',
        category: 'nope',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('DevPromptUpdateParamsSchema', () => {
    it('requires key and body', () => {
      expect(DevPromptUpdateParamsSchema.safeParse({}).success).toBe(false);
      expect(DevPromptUpdateParamsSchema.safeParse({ key: 'test' }).success).toBe(false);
      expect(DevPromptUpdateParamsSchema.safeParse({ body: 'test' }).success).toBe(false);
    });

    it('accepts key and body', () => {
      const result = DevPromptUpdateParamsSchema.safeParse({
        key: 'my_prompt',
        body: 'new body',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('DevPromptResetParamsSchema', () => {
    it('requires key', () => {
      expect(DevPromptResetParamsSchema.safeParse({}).success).toBe(false);
    });

    it('accepts key', () => {
      const result = DevPromptResetParamsSchema.safeParse({ key: 'all_open' });
      expect(result.success).toBe(true);
    });
  });

  // ── dev_prompt_list ───────────────────────────────────────

  describe('dev_prompt_list tool', () => {
    it('has correct name and description', () => {
      const tool = createDevPromptListTool(toolOpts);
      expect(tool.name).toBe('dev_prompt_list');
      expect(tool.description).toBeDefined();
      expect(tool.description.length).toBeGreaterThan(0);
    });

    it('lists prompts grouped by category', async () => {
      (mockApiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: {
          total: 2,
          limit: 100,
          offset: 0,
          items: [
            { prompt_key: 'all_open', title: 'Identify Open Work', category: 'identification', is_system: true },
            { prompt_key: 'new_feature', title: 'New Feature', category: 'creation', is_system: true },
          ],
        },
      });

      const tool = createDevPromptListTool(toolOpts);
      const result = await tool.execute({});

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content).toContain('all_open');
        expect(result.data.content).toContain('new_feature');
        expect(result.data.details.total).toBe(2);
      }
    });

    it('returns empty message when no prompts', async () => {
      (mockApiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: { total: 0, limit: 100, offset: 0, items: [] },
      });

      const tool = createDevPromptListTool(toolOpts);
      const result = await tool.execute({});

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content).toContain('No dev prompts');
      }
    });

    it('passes category filter to API', async () => {
      (mockApiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: { total: 0, limit: 100, offset: 0, items: [] },
      });

      const tool = createDevPromptListTool(toolOpts);
      await tool.execute({ category: 'creation' });

      expect(mockApiClient.get).toHaveBeenCalledWith(
        expect.stringContaining('category=creation'),
        expect.anything(),
      );
    });

    it('handles API errors', async () => {
      (mockApiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: false,
        error: { status: 500, message: 'Server error' },
      });

      const tool = createDevPromptListTool(toolOpts);
      const result = await tool.execute({});

      expect(result.success).toBe(false);
    });
  });

  // ── dev_prompt_get ────────────────────────────────────────

  describe('dev_prompt_get tool', () => {
    it('has correct name', () => {
      const tool = createDevPromptGetTool(toolOpts);
      expect(tool.name).toBe('dev_prompt_get');
    });

    it('requires key parameter', async () => {
      const tool = createDevPromptGetTool(toolOpts);
      const result = await tool.execute({} as DevPromptGetParams);
      expect(result.success).toBe(false);
    });

    it('renders prompt by default', async () => {
      const mockPrompt = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        prompt_key: 'new_feature',
        title: 'New Feature',
        body: 'Template {{ date }}',
        is_system: true,
        category: 'creation',
      };

      (mockApiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: mockPrompt,
      });

      (mockApiClient.post as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: {
          rendered: 'Template 2026-03-02',
          variables_used: ['date'],
          available_variables: [],
        },
      });

      const tool = createDevPromptGetTool(toolOpts);
      const result = await tool.execute({ key: 'new_feature' });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content).toContain('Template 2026-03-02');
      }

      // Should have called render endpoint
      expect(mockApiClient.post).toHaveBeenCalledWith(
        expect.stringContaining('/render'),
        expect.anything(),
        expect.anything(),
      );
    });

    it('returns raw template when render=false', async () => {
      const mockPrompt = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        prompt_key: 'new_feature',
        title: 'New Feature',
        body: 'Template {{ date }}',
        is_system: true,
        category: 'creation',
      };

      (mockApiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: mockPrompt,
      });

      const tool = createDevPromptGetTool(toolOpts);
      const result = await tool.execute({ key: 'new_feature', render: false });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content).toContain('Template {{ date }}');
      }

      // Should NOT have called render endpoint
      expect(mockApiClient.post).not.toHaveBeenCalled();
    });

    it('passes repo variables to render', async () => {
      const mockPrompt = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        prompt_key: 'test',
        title: 'Test',
        body: '{{ repo_full }}',
        is_system: false,
        category: 'custom',
      };

      (mockApiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: mockPrompt,
      });

      (mockApiClient.post as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: { rendered: 'org/repo', variables_used: ['repo_full'], available_variables: [] },
      });

      const tool = createDevPromptGetTool(toolOpts);
      await tool.execute({ key: 'test', repo: 'org/repo' });

      expect(mockApiClient.post).toHaveBeenCalledWith(
        expect.stringContaining('/render'),
        expect.objectContaining({
          variables: expect.objectContaining({
            repo_org: 'org',
            repo_name: 'repo',
          }),
        }),
        expect.anything(),
      );
    });

    it('handles not found', async () => {
      (mockApiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: false,
        error: { status: 404, message: 'Not found', code: 'NOT_FOUND' },
      });

      const tool = createDevPromptGetTool(toolOpts);
      const result = await tool.execute({ key: 'nonexistent' });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('not found');
      }
    });
  });

  // ── dev_prompt_create ─────────────────────────────────────

  describe('dev_prompt_create tool', () => {
    it('has correct name', () => {
      const tool = createDevPromptCreateTool(toolOpts);
      expect(tool.name).toBe('dev_prompt_create');
    });

    it('creates a prompt successfully', async () => {
      const mockPrompt = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        prompt_key: 'my_prompt',
        title: 'My Prompt',
        body: 'template',
        is_system: false,
        category: 'custom',
      };

      (mockApiClient.post as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: mockPrompt,
      });

      const tool = createDevPromptCreateTool(toolOpts);
      const result = await tool.execute({
        key: 'my_prompt',
        title: 'My Prompt',
        body: 'template',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content).toContain('my_prompt');
        expect(result.data.content).toContain('Created');
      }
    });

    it('handles 409 duplicate key', async () => {
      (mockApiClient.post as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: false,
        error: { status: 409, message: 'Conflict', code: 'CONFLICT' },
      });

      const tool = createDevPromptCreateTool(toolOpts);
      const result = await tool.execute({
        key: 'existing',
        title: 'Test',
        body: 'body',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('dev_prompt_update');
      }
    });

    it('requires key', async () => {
      const tool = createDevPromptCreateTool(toolOpts);
      const result = await tool.execute({ title: 'T', body: 'b' } as DevPromptCreateParams);
      expect(result.success).toBe(false);
    });
  });

  // ── dev_prompt_update ─────────────────────────────────────

  describe('dev_prompt_update tool', () => {
    it('has correct name', () => {
      const tool = createDevPromptUpdateTool(toolOpts);
      expect(tool.name).toBe('dev_prompt_update');
    });

    it('looks up by key then patches by ID', async () => {
      // First call: GET by key
      (mockApiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: {
          id: '123e4567-e89b-12d3-a456-426614174000',
          prompt_key: 'my_prompt',
          title: 'Old Title',
          body: 'old body',
        },
      });

      // Second call: PATCH by ID
      (mockApiClient.patch as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: {
          id: '123e4567-e89b-12d3-a456-426614174000',
          prompt_key: 'my_prompt',
          title: 'Old Title',
          body: 'new body',
        },
      });

      const tool = createDevPromptUpdateTool(toolOpts);
      const result = await tool.execute({ key: 'my_prompt', body: 'new body' });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content).toContain('Updated');
        expect(result.data.content).toContain('my_prompt');
      }

      expect(mockApiClient.patch).toHaveBeenCalledWith(
        '/dev-prompts/123e4567-e89b-12d3-a456-426614174000',
        expect.objectContaining({ body: 'new body' }),
        expect.anything(),
      );
    });

    it('handles key not found', async () => {
      (mockApiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: false,
        error: { status: 404, message: 'Not found', code: 'NOT_FOUND' },
      });

      const tool = createDevPromptUpdateTool(toolOpts);
      const result = await tool.execute({ key: 'missing', body: 'test' });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('not found');
      }
    });

    it('requires both key and body', async () => {
      const tool = createDevPromptUpdateTool(toolOpts);
      const result = await tool.execute({ key: 'test' } as DevPromptUpdateParams);
      expect(result.success).toBe(false);
    });
  });

  // ── dev_prompt_reset ──────────────────────────────────────

  describe('dev_prompt_reset tool', () => {
    it('has correct name', () => {
      const tool = createDevPromptResetTool(toolOpts);
      expect(tool.name).toBe('dev_prompt_reset');
    });

    it('looks up by key then resets by ID', async () => {
      (mockApiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: {
          id: '123e4567-e89b-12d3-a456-426614174000',
          prompt_key: 'all_open',
          title: 'Identify Open Work',
          is_system: true,
        },
      });

      (mockApiClient.post as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: {
          id: '123e4567-e89b-12d3-a456-426614174000',
          prompt_key: 'all_open',
          title: 'Identify Open Work',
          body: 'default body',
          default_body: 'default body',
          is_system: true,
        },
      });

      const tool = createDevPromptResetTool(toolOpts);
      const result = await tool.execute({ key: 'all_open' });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content).toContain('Reset');
        expect(result.data.content).toContain('all_open');
      }

      expect(mockApiClient.post).toHaveBeenCalledWith(
        '/dev-prompts/123e4567-e89b-12d3-a456-426614174000/reset',
        expect.anything(),
        expect.anything(),
      );
    });

    it('handles non-system prompt error', async () => {
      (mockApiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: {
          id: '123e4567-e89b-12d3-a456-426614174000',
          prompt_key: 'my_prompt',
          is_system: false,
        },
      });

      (mockApiClient.post as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: false,
        error: { status: 400, message: 'not a system prompt' },
      });

      const tool = createDevPromptResetTool(toolOpts);
      const result = await tool.execute({ key: 'my_prompt' });

      expect(result.success).toBe(false);
    });

    it('handles key not found', async () => {
      (mockApiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: false,
        error: { status: 404, message: 'Not found', code: 'NOT_FOUND' },
      });

      const tool = createDevPromptResetTool(toolOpts);
      const result = await tool.execute({ key: 'nonexistent' });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('not found');
      }
    });
  });
});

/**
 * Tests for terminal connection and credential management tools.
 * Covers all 8 tools: connection list/create/update/delete/test,
 * credential create/list/delete.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  createTerminalConnectionListTool,
  createTerminalConnectionCreateTool,
  createTerminalConnectionUpdateTool,
  createTerminalConnectionDeleteTool,
  createTerminalConnectionTestTool,
  createTerminalCredentialCreateTool,
  createTerminalCredentialListTool,
  createTerminalCredentialDeleteTool,
  type TerminalConnectionListParams,
  type TerminalConnectionCreateParams,
  type TerminalConnectionUpdateParams,
  type TerminalConnectionDeleteParams,
  type TerminalConnectionTestParams,
  type TerminalCredentialCreateParams,
  type TerminalCredentialListParams,
  type TerminalCredentialDeleteParams,
} from '../../src/tools/terminal-connections.js';
import type { ApiClient } from '../../src/api-client.js';
import type { Logger } from '../../src/logger.js';
import type { PluginConfig } from '../../src/config.js';

describe('terminal connection tools', () => {
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

  const options = {
    client: mockApiClient,
    logger: mockLogger,
    config: mockConfig,
    user_id: 'agent-1',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ==================== terminal_connection_list ====================

  describe('terminal_connection_list', () => {
    it('should have correct name and description', () => {
      const tool = createTerminalConnectionListTool(options);
      expect(tool.name).toBe('terminal_connection_list');
      expect(tool.description.length).toBeGreaterThan(10);
    });

    it('should list connections without filters', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: {
          connections: [
            { id: 'c1', name: 'prod-web', host: '10.0.0.1', port: 22, username: 'deploy', tags: ['production'] },
            { id: 'c2', name: 'local-dev', is_local: true },
          ],
          total: 2,
        },
      });
      const client = { ...mockApiClient, get: mockGet };
      const tool = createTerminalConnectionListTool({ ...options, client: client as unknown as ApiClient });

      const result = await tool.execute({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content).toContain('prod-web');
        expect(result.data.content).toContain('local-dev');
        expect(result.data.content).toContain('[local]');
        expect(result.data.content).toContain('[production]');
        expect(result.data.details.total).toBe(2);
      }
    });

    it('should pass filter parameters to API', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: { connections: [], total: 0 },
      });
      const client = { ...mockApiClient, get: mockGet };
      const tool = createTerminalConnectionListTool({ ...options, client: client as unknown as ApiClient });

      await tool.execute({ tags: 'production,staging', search: 'web', is_local: false });

      expect(mockGet).toHaveBeenCalledWith(
        expect.stringContaining('tags=production%2Cstaging'),
        expect.objectContaining({ user_id: 'agent-1' }),
      );
      expect(mockGet).toHaveBeenCalledWith(
        expect.stringContaining('search=web'),
        expect.any(Object),
      );
      expect(mockGet).toHaveBeenCalledWith(
        expect.stringContaining('is_local=false'),
        expect.any(Object),
      );
    });

    it('should handle empty results', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: { connections: [], total: 0 },
      });
      const client = { ...mockApiClient, get: mockGet };
      const tool = createTerminalConnectionListTool({ ...options, client: client as unknown as ApiClient });

      const result = await tool.execute({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content).toContain('No terminal connections found');
      }
    });

    it('should handle API errors', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: false,
        error: { status: 500, message: 'Internal error', code: 'SERVER_ERROR' },
      });
      const client = { ...mockApiClient, get: mockGet };
      const tool = createTerminalConnectionListTool({ ...options, client: client as unknown as ApiClient });

      const result = await tool.execute({});
      expect(result.success).toBe(false);
    });

    it('should handle network errors', async () => {
      const mockGet = vi.fn().mockRejectedValue(new Error('Network error'));
      const client = { ...mockApiClient, get: mockGet };
      const tool = createTerminalConnectionListTool({ ...options, client: client as unknown as ApiClient });

      const result = await tool.execute({});
      expect(result.success).toBe(false);
    });

    it('should format connection with username@host:port', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: {
          connections: [{ id: 'c1', name: 'custom-port', host: 'example.com', port: 2222, username: 'admin' }],
          total: 1,
        },
      });
      const client = { ...mockApiClient, get: mockGet };
      const tool = createTerminalConnectionListTool({ ...options, client: client as unknown as ApiClient });

      const result = await tool.execute({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content).toContain('admin@example.com:2222');
      }
    });
  });

  // ==================== terminal_connection_create ====================

  describe('terminal_connection_create', () => {
    it('should have correct name', () => {
      const tool = createTerminalConnectionCreateTool(options);
      expect(tool.name).toBe('terminal_connection_create');
    });

    it('should require name parameter', async () => {
      const tool = createTerminalConnectionCreateTool(options);
      const result = await tool.execute({} as TerminalConnectionCreateParams);
      expect(result.success).toBe(false);
    });

    it('should reject empty name', async () => {
      const tool = createTerminalConnectionCreateTool(options);
      const result = await tool.execute({ name: '' } as TerminalConnectionCreateParams);
      expect(result.success).toBe(false);
    });

    it('should create connection with all fields', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: { id: 'new-conn-1', name: 'prod-web' },
      });
      const client = { ...mockApiClient, post: mockPost };
      const tool = createTerminalConnectionCreateTool({ ...options, client: client as unknown as ApiClient });

      const result = await tool.execute({
        name: 'prod-web',
        host: '10.0.0.1',
        port: 22,
        username: 'deploy',
        auth_method: 'key',
        credential_id: '123e4567-e89b-12d3-a456-426614174000',
        tags: 'production,web',
        notes: 'Production web server',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content).toContain('Created connection');
        expect(result.data.details.id).toBe('new-conn-1');
      }
      expect(mockPost).toHaveBeenCalledWith(
        '/api/terminal/connections',
        expect.objectContaining({
          name: 'prod-web',
          host: '10.0.0.1',
          port: 22,
          username: 'deploy',
          auth_method: 'key',
          tags: ['production', 'web'],
        }),
        expect.objectContaining({ user_id: 'agent-1' }),
      );
    });

    it('should validate credential_id as UUID', async () => {
      const tool = createTerminalConnectionCreateTool(options);
      const result = await tool.execute({
        name: 'test',
        credential_id: 'not-a-uuid',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('UUID');
      }
    });

    it('should strip HTML from name', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: { id: 'new-1', name: 'clean-name' },
      });
      const client = { ...mockApiClient, post: mockPost };
      const tool = createTerminalConnectionCreateTool({ ...options, client: client as unknown as ApiClient });

      await tool.execute({ name: '<b>bold</b> server' });

      expect(mockPost).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ name: 'bold server' }),
        expect.any(Object),
      );
    });

    it('should reject invalid port range', async () => {
      const tool = createTerminalConnectionCreateTool(options);
      const result = await tool.execute({ name: 'test', port: 99999 });
      expect(result.success).toBe(false);
    });

    it('should validate auth_method enum', async () => {
      const tool = createTerminalConnectionCreateTool(options);
      const result = await tool.execute({ name: 'test', auth_method: 'invalid' as 'key' });
      expect(result.success).toBe(false);
    });
  });

  // ==================== terminal_connection_update ====================

  describe('terminal_connection_update', () => {
    it('should have correct name', () => {
      const tool = createTerminalConnectionUpdateTool(options);
      expect(tool.name).toBe('terminal_connection_update');
    });

    it('should require id parameter', async () => {
      const tool = createTerminalConnectionUpdateTool(options);
      const result = await tool.execute({} as TerminalConnectionUpdateParams);
      expect(result.success).toBe(false);
    });

    it('should validate UUID format', async () => {
      const tool = createTerminalConnectionUpdateTool(options);
      const result = await tool.execute({ id: 'not-uuid' });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('UUID');
      }
    });

    it('should update connection fields via PATCH', async () => {
      const mockPatch = vi.fn().mockResolvedValue({
        success: true,
        data: { id: '123e4567-e89b-12d3-a456-426614174000' },
      });
      const client = { ...mockApiClient, patch: mockPatch };
      const tool = createTerminalConnectionUpdateTool({ ...options, client: client as unknown as ApiClient });

      const result = await tool.execute({
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'updated-name',
        port: 2222,
      });

      expect(result.success).toBe(true);
      expect(mockPatch).toHaveBeenCalledWith(
        '/api/terminal/connections/123e4567-e89b-12d3-a456-426614174000',
        expect.objectContaining({ name: 'updated-name', port: 2222 }),
        expect.any(Object),
      );
    });

    it('should handle not found', async () => {
      const mockPatch = vi.fn().mockResolvedValue({
        success: false,
        error: { status: 404, message: 'Not found', code: 'NOT_FOUND' },
      });
      const client = { ...mockApiClient, patch: mockPatch };
      const tool = createTerminalConnectionUpdateTool({ ...options, client: client as unknown as ApiClient });

      const result = await tool.execute({ id: '123e4567-e89b-12d3-a456-426614174000' });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('not found');
      }
    });
  });

  // ==================== terminal_connection_delete ====================

  describe('terminal_connection_delete', () => {
    it('should have correct name', () => {
      const tool = createTerminalConnectionDeleteTool(options);
      expect(tool.name).toBe('terminal_connection_delete');
    });

    it('should validate UUID format', async () => {
      const tool = createTerminalConnectionDeleteTool(options);
      const result = await tool.execute({ id: 'bad-id' });
      expect(result.success).toBe(false);
    });

    it('should call DELETE endpoint', async () => {
      const mockDelete = vi.fn().mockResolvedValue({ success: true, data: undefined });
      const client = { ...mockApiClient, delete: mockDelete };
      const tool = createTerminalConnectionDeleteTool({ ...options, client: client as unknown as ApiClient });

      const result = await tool.execute({ id: '123e4567-e89b-12d3-a456-426614174000' });
      expect(result.success).toBe(true);
      expect(mockDelete).toHaveBeenCalledWith(
        '/api/terminal/connections/123e4567-e89b-12d3-a456-426614174000',
        expect.objectContaining({ user_id: 'agent-1' }),
      );
    });

    it('should handle not found', async () => {
      const mockDelete = vi.fn().mockResolvedValue({
        success: false,
        error: { status: 404, message: 'Not found', code: 'NOT_FOUND' },
      });
      const client = { ...mockApiClient, delete: mockDelete };
      const tool = createTerminalConnectionDeleteTool({ ...options, client: client as unknown as ApiClient });

      const result = await tool.execute({ id: '123e4567-e89b-12d3-a456-426614174000' });
      expect(result.success).toBe(false);
    });
  });

  // ==================== terminal_connection_test ====================

  describe('terminal_connection_test', () => {
    it('should have correct name', () => {
      const tool = createTerminalConnectionTestTool(options);
      expect(tool.name).toBe('terminal_connection_test');
    });

    it('should validate UUID format', async () => {
      const tool = createTerminalConnectionTestTool(options);
      const result = await tool.execute({ id: 'bad-id' });
      expect(result.success).toBe(false);
    });

    it('should report successful test with latency', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: { success: true, latency_ms: 42, host_key_fingerprint: 'SHA256:abc123' },
      });
      const client = { ...mockApiClient, post: mockPost };
      const tool = createTerminalConnectionTestTool({ ...options, client: client as unknown as ApiClient });

      const result = await tool.execute({ id: '123e4567-e89b-12d3-a456-426614174000' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content).toContain('successful');
        expect(result.data.content).toContain('42ms');
        expect(result.data.content).toContain('SHA256:abc123');
        expect(result.data.details.test_success).toBe(true);
        expect(result.data.details.latency_ms).toBe(42);
      }
    });

    it('should report failed test with error', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: { success: false, error: 'Connection refused' },
      });
      const client = { ...mockApiClient, post: mockPost };
      const tool = createTerminalConnectionTestTool({ ...options, client: client as unknown as ApiClient });

      const result = await tool.execute({ id: '123e4567-e89b-12d3-a456-426614174000' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content).toContain('failed');
        expect(result.data.content).toContain('Connection refused');
        expect(result.data.details.test_success).toBe(false);
      }
    });

    it('should call POST /test endpoint', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: { success: true },
      });
      const client = { ...mockApiClient, post: mockPost };
      const tool = createTerminalConnectionTestTool({ ...options, client: client as unknown as ApiClient });

      await tool.execute({ id: '123e4567-e89b-12d3-a456-426614174000' });
      expect(mockPost).toHaveBeenCalledWith(
        '/api/terminal/connections/123e4567-e89b-12d3-a456-426614174000/test',
        undefined,
        expect.objectContaining({ user_id: 'agent-1' }),
      );
    });
  });

  // ==================== terminal_credential_create ====================

  describe('terminal_credential_create', () => {
    it('should have correct name', () => {
      const tool = createTerminalCredentialCreateTool(options);
      expect(tool.name).toBe('terminal_credential_create');
    });

    it('should require name and kind', async () => {
      const tool = createTerminalCredentialCreateTool(options);
      const result = await tool.execute({} as TerminalCredentialCreateParams);
      expect(result.success).toBe(false);
    });

    it('should validate kind enum', async () => {
      const tool = createTerminalCredentialCreateTool(options);
      const result = await tool.execute({ name: 'test', kind: 'invalid' as 'ssh_key' });
      expect(result.success).toBe(false);
    });

    it('should create ssh_key credential', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: { id: 'cred-1', name: 'my-key', kind: 'ssh_key', fingerprint: 'SHA256:xyz789' },
      });
      const client = { ...mockApiClient, post: mockPost };
      const tool = createTerminalCredentialCreateTool({ ...options, client: client as unknown as ApiClient });

      const result = await tool.execute({
        name: 'my-key',
        kind: 'ssh_key',
        private_key: '-----BEGIN OPENSSH PRIVATE KEY-----\ntest\n-----END OPENSSH PRIVATE KEY-----',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content).toContain('ssh_key');
        expect(result.data.content).toContain('my-key');
        expect(result.data.content).toContain('SHA256:xyz789');
        expect(result.data.details.fingerprint).toBe('SHA256:xyz789');
      }
    });

    it('should create command credential', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: { id: 'cred-2', name: 'op-key', kind: 'command' },
      });
      const client = { ...mockApiClient, post: mockPost };
      const tool = createTerminalCredentialCreateTool({ ...options, client: client as unknown as ApiClient });

      await tool.execute({
        name: 'op-key',
        kind: 'command',
        command: 'op read op://vault/key',
        command_timeout_s: 15,
      });

      expect(mockPost).toHaveBeenCalledWith(
        '/api/terminal/credentials',
        expect.objectContaining({
          name: 'op-key',
          kind: 'command',
          command: 'op read op://vault/key',
          command_timeout_s: 15,
        }),
        expect.any(Object),
      );
    });

    it('should never log credential secrets', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: { id: 'cred-1', name: 'key' },
      });
      const client = { ...mockApiClient, post: mockPost };
      const tool = createTerminalCredentialCreateTool({ ...options, client: client as unknown as ApiClient });

      await tool.execute({
        name: 'key',
        kind: 'ssh_key',
        private_key: 'SECRET_KEY_DATA',
      });

      for (const call of (mockLogger.info as ReturnType<typeof vi.fn>).mock.calls) {
        const logMessage = JSON.stringify(call);
        expect(logMessage).not.toContain('SECRET_KEY_DATA');
      }
    });

    it('should strip HTML from name', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: { id: 'cred-1' },
      });
      const client = { ...mockApiClient, post: mockPost };
      const tool = createTerminalCredentialCreateTool({ ...options, client: client as unknown as ApiClient });

      await tool.execute({ name: '<script>xss</script>clean', kind: 'ssh_key' });

      expect(mockPost).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ name: 'clean' }),
        expect.any(Object),
      );
    });
  });

  // ==================== terminal_credential_list ====================

  describe('terminal_credential_list', () => {
    it('should have correct name', () => {
      const tool = createTerminalCredentialListTool(options);
      expect(tool.name).toBe('terminal_credential_list');
    });

    it('should list credentials without secrets', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: {
          credentials: [
            { id: 'c1', name: 'deploy-key', kind: 'ssh_key', fingerprint: 'SHA256:abc' },
            { id: 'c2', name: 'op-provider', kind: 'command' },
          ],
          total: 2,
        },
      });
      const client = { ...mockApiClient, get: mockGet };
      const tool = createTerminalCredentialListTool({ ...options, client: client as unknown as ApiClient });

      const result = await tool.execute({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content).toContain('deploy-key');
        expect(result.data.content).toContain('ssh_key');
        expect(result.data.content).toContain('SHA256:abc');
        expect(result.data.content).toContain('op-provider');
        expect(result.data.content).toContain('command');
        expect(result.data.details.total).toBe(2);
        // Ensure no secret fields in the result
        const jsonStr = JSON.stringify(result);
        expect(jsonStr).not.toContain('encrypted_value');
        expect(jsonStr).not.toContain('private_key');
      }
    });

    it('should filter by kind', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: { credentials: [], total: 0 },
      });
      const client = { ...mockApiClient, get: mockGet };
      const tool = createTerminalCredentialListTool({ ...options, client: client as unknown as ApiClient });

      await tool.execute({ kind: 'ssh_key' });
      expect(mockGet).toHaveBeenCalledWith(
        expect.stringContaining('kind=ssh_key'),
        expect.any(Object),
      );
    });

    it('should handle empty results', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: { credentials: [], total: 0 },
      });
      const client = { ...mockApiClient, get: mockGet };
      const tool = createTerminalCredentialListTool({ ...options, client: client as unknown as ApiClient });

      const result = await tool.execute({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content).toContain('No terminal credentials found');
      }
    });
  });

  // ==================== terminal_credential_delete ====================

  describe('terminal_credential_delete', () => {
    it('should have correct name', () => {
      const tool = createTerminalCredentialDeleteTool(options);
      expect(tool.name).toBe('terminal_credential_delete');
    });

    it('should validate UUID format', async () => {
      const tool = createTerminalCredentialDeleteTool(options);
      const result = await tool.execute({ id: 'bad-id' });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('UUID');
      }
    });

    it('should call DELETE endpoint', async () => {
      const mockDelete = vi.fn().mockResolvedValue({ success: true, data: undefined });
      const client = { ...mockApiClient, delete: mockDelete };
      const tool = createTerminalCredentialDeleteTool({ ...options, client: client as unknown as ApiClient });

      const result = await tool.execute({ id: '123e4567-e89b-12d3-a456-426614174000' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content).toContain('deleted');
      }
      expect(mockDelete).toHaveBeenCalledWith(
        '/api/terminal/credentials/123e4567-e89b-12d3-a456-426614174000',
        expect.objectContaining({ user_id: 'agent-1' }),
      );
    });

    it('should handle not found', async () => {
      const mockDelete = vi.fn().mockResolvedValue({
        success: false,
        error: { status: 404, message: 'Not found', code: 'NOT_FOUND' },
      });
      const client = { ...mockApiClient, delete: mockDelete };
      const tool = createTerminalCredentialDeleteTool({ ...options, client: client as unknown as ApiClient });

      const result = await tool.execute({ id: '123e4567-e89b-12d3-a456-426614174000' });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('not found');
      }
    });
  });

  // ==================== Shared behaviors ====================

  describe('user scoping', () => {
    it('should include user_id in all API calls', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: { connections: [], total: 0 },
      });
      const client = { ...mockApiClient, get: mockGet };
      const tool = createTerminalConnectionListTool({
        ...options,
        client: client as unknown as ApiClient,
        user_id: 'custom-user',
      });

      await tool.execute({});
      expect(mockGet).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ user_id: 'custom-user' }));
    });
  });

  describe('error sanitization', () => {
    it('should not expose internal details in error messages', async () => {
      const mockPost = vi.fn().mockRejectedValue(new Error('Connection refused to internal-db:5432'));
      const client = { ...mockApiClient, post: mockPost };
      const tool = createTerminalConnectionCreateTool({ ...options, client: client as unknown as ApiClient });

      const result = await tool.execute({ name: 'test-conn' });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).not.toContain('5432');
        expect(result.error).not.toContain('internal-db');
      }
    });
  });
});

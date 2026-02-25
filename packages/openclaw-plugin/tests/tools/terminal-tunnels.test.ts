/**
 * Tests for terminal tunnel management tools.
 * Covers terminal_tunnel_create, terminal_tunnel_list, terminal_tunnel_close.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  createTerminalTunnelCreateTool,
  createTerminalTunnelListTool,
  createTerminalTunnelCloseTool,
  type TerminalTunnelCreateParams,
  type TerminalTunnelCloseParams,
} from '../../src/tools/terminal-tunnels.js';
import type { ApiClient } from '../../src/api-client.js';
import type { Logger } from '../../src/logger.js';
import type { PluginConfig } from '../../src/config.js';

describe('terminal tunnel tools', () => {
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

  // ==================== terminal_tunnel_create ====================

  describe('terminal_tunnel_create', () => {
    it('should have correct name and description', () => {
      const tool = createTerminalTunnelCreateTool(options);
      expect(tool.name).toBe('terminal_tunnel_create');
      expect(tool.description.length).toBeGreaterThan(10);
    });

    it('should require connection_id, direction, and bind_port', async () => {
      const tool = createTerminalTunnelCreateTool(options);
      const result = await tool.execute({} as TerminalTunnelCreateParams);
      expect(result.success).toBe(false);
    });

    it('should validate connection_id UUID', async () => {
      const tool = createTerminalTunnelCreateTool(options);
      const result = await tool.execute({
        connection_id: 'not-uuid',
        direction: 'local',
        bind_port: 8080,
        target_host: 'localhost',
        target_port: 80,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('UUID');
      }
    });

    it('should require target_host/target_port for local tunnel', async () => {
      const tool = createTerminalTunnelCreateTool(options);
      const result = await tool.execute({
        connection_id: '123e4567-e89b-12d3-a456-426614174000',
        direction: 'local',
        bind_port: 8080,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('target_host and target_port are required');
      }
    });

    it('should require target_host/target_port for remote tunnel', async () => {
      const tool = createTerminalTunnelCreateTool(options);
      const result = await tool.execute({
        connection_id: '123e4567-e89b-12d3-a456-426614174000',
        direction: 'remote',
        bind_port: 8080,
      });
      expect(result.success).toBe(false);
    });

    it('should create local tunnel', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: {
          id: 'tun-1',
          connection_id: '123e4567-e89b-12d3-a456-426614174000',
          direction: 'local',
          bind_host: '127.0.0.1',
          bind_port: 8080,
          target_host: 'db.internal',
          target_port: 5432,
          status: 'active',
        },
      });
      const client = { ...mockApiClient, post: mockPost };
      const tool = createTerminalTunnelCreateTool({ ...options, client: client as unknown as ApiClient });

      const result = await tool.execute({
        connection_id: '123e4567-e89b-12d3-a456-426614174000',
        direction: 'local',
        bind_port: 8080,
        target_host: 'db.internal',
        target_port: 5432,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content).toContain('local tunnel');
        expect(result.data.content).toContain('127.0.0.1:8080');
        expect(result.data.content).toContain('db.internal:5432');
        expect(result.data.content).toContain('active');
        expect(result.data.details.tunnel_id).toBe('tun-1');
        expect(result.data.details.direction).toBe('local');
      }
    });

    it('should create dynamic SOCKS tunnel', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: {
          id: 'tun-2',
          connection_id: '123e4567-e89b-12d3-a456-426614174000',
          direction: 'dynamic',
          bind_host: '127.0.0.1',
          bind_port: 1080,
          status: 'active',
        },
      });
      const client = { ...mockApiClient, post: mockPost };
      const tool = createTerminalTunnelCreateTool({ ...options, client: client as unknown as ApiClient });

      const result = await tool.execute({
        connection_id: '123e4567-e89b-12d3-a456-426614174000',
        direction: 'dynamic',
        bind_port: 1080,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content).toContain('dynamic SOCKS tunnel');
        expect(result.data.content).toContain('1080');
      }
    });

    it('should create remote tunnel', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: {
          id: 'tun-3',
          connection_id: '123e4567-e89b-12d3-a456-426614174000',
          direction: 'remote',
          bind_host: '0.0.0.0',
          bind_port: 8080,
          target_host: 'localhost',
          target_port: 3000,
          status: 'active',
        },
      });
      const client = { ...mockApiClient, post: mockPost };
      const tool = createTerminalTunnelCreateTool({ ...options, client: client as unknown as ApiClient });

      const result = await tool.execute({
        connection_id: '123e4567-e89b-12d3-a456-426614174000',
        direction: 'remote',
        bind_port: 8080,
        target_host: 'localhost',
        target_port: 3000,
        bind_host: '0.0.0.0',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content).toContain('remote tunnel');
      }

      expect(mockPost).toHaveBeenCalledWith(
        '/api/terminal/tunnels',
        expect.objectContaining({
          connection_id: '123e4567-e89b-12d3-a456-426614174000',
          direction: 'remote',
          bind_port: 8080,
          target_host: 'localhost',
          target_port: 3000,
          bind_host: '0.0.0.0',
        }),
        expect.any(Object),
      );
    });

    it('should validate port range', async () => {
      const tool = createTerminalTunnelCreateTool(options);
      const result = await tool.execute({
        connection_id: '123e4567-e89b-12d3-a456-426614174000',
        direction: 'dynamic',
        bind_port: 99999,
      });
      expect(result.success).toBe(false);
    });

    it('should validate direction enum', async () => {
      const tool = createTerminalTunnelCreateTool(options);
      const result = await tool.execute({
        connection_id: '123e4567-e89b-12d3-a456-426614174000',
        direction: 'invalid' as 'local',
        bind_port: 8080,
      });
      expect(result.success).toBe(false);
    });
  });

  // ==================== terminal_tunnel_list ====================

  describe('terminal_tunnel_list', () => {
    it('should have correct name', () => {
      const tool = createTerminalTunnelListTool(options);
      expect(tool.name).toBe('terminal_tunnel_list');
    });

    it('should list tunnels', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: {
          tunnels: [
            { id: 't1', connection_id: 'c1', direction: 'local', bind_host: '127.0.0.1', bind_port: 8080, target_host: 'db', target_port: 5432, status: 'active' },
            { id: 't2', connection_id: 'c1', direction: 'dynamic', bind_host: '127.0.0.1', bind_port: 1080, status: 'active' },
          ],
          total: 2,
        },
      });
      const client = { ...mockApiClient, get: mockGet };
      const tool = createTerminalTunnelListTool({ ...options, client: client as unknown as ApiClient });

      const result = await tool.execute({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content).toContain('local');
        expect(result.data.content).toContain('127.0.0.1:8080');
        expect(result.data.content).toContain('db:5432');
        expect(result.data.content).toContain('SOCKS');
        expect(result.data.content).toContain('1080');
        expect(result.data.details.total).toBe(2);
      }
    });

    it('should filter by connection_id', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: { tunnels: [], total: 0 },
      });
      const client = { ...mockApiClient, get: mockGet };
      const tool = createTerminalTunnelListTool({ ...options, client: client as unknown as ApiClient });

      await tool.execute({ connection_id: '123e4567-e89b-12d3-a456-426614174000' });
      expect(mockGet).toHaveBeenCalledWith(
        expect.stringContaining('connection_id=123e4567-e89b-12d3-a456-426614174000'),
        expect.any(Object),
      );
    });

    it('should validate connection_id UUID', async () => {
      const tool = createTerminalTunnelListTool(options);
      const result = await tool.execute({ connection_id: 'not-uuid' });
      expect(result.success).toBe(false);
    });

    it('should handle empty results', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: { tunnels: [], total: 0 },
      });
      const client = { ...mockApiClient, get: mockGet };
      const tool = createTerminalTunnelListTool({ ...options, client: client as unknown as ApiClient });

      const result = await tool.execute({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content).toContain('No active tunnels found');
      }
    });
  });

  // ==================== terminal_tunnel_close ====================

  describe('terminal_tunnel_close', () => {
    it('should have correct name', () => {
      const tool = createTerminalTunnelCloseTool(options);
      expect(tool.name).toBe('terminal_tunnel_close');
    });

    it('should validate UUID format', async () => {
      const tool = createTerminalTunnelCloseTool(options);
      const result = await tool.execute({ id: 'bad-id' });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('UUID');
      }
    });

    it('should call DELETE endpoint', async () => {
      const mockDelete = vi.fn().mockResolvedValue({ success: true, data: undefined });
      const client = { ...mockApiClient, delete: mockDelete };
      const tool = createTerminalTunnelCloseTool({ ...options, client: client as unknown as ApiClient });

      const result = await tool.execute({ id: '123e4567-e89b-12d3-a456-426614174000' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content).toContain('closed');
      }
      expect(mockDelete).toHaveBeenCalledWith(
        '/api/terminal/tunnels/123e4567-e89b-12d3-a456-426614174000',
        expect.objectContaining({ user_id: 'agent-1' }),
      );
    });

    it('should handle not found', async () => {
      const mockDelete = vi.fn().mockResolvedValue({
        success: false,
        error: { status: 404, message: 'Not found', code: 'NOT_FOUND' },
      });
      const client = { ...mockApiClient, delete: mockDelete };
      const tool = createTerminalTunnelCloseTool({ ...options, client: client as unknown as ApiClient });

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
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: {
          id: 'tun-1',
          direction: 'dynamic',
          bind_host: '127.0.0.1',
          bind_port: 1080,
          status: 'active',
        },
      });
      const client = { ...mockApiClient, post: mockPost };
      const tool = createTerminalTunnelCreateTool({
        ...options,
        client: client as unknown as ApiClient,
        user_id: 'custom-user',
      });

      await tool.execute({
        connection_id: '123e4567-e89b-12d3-a456-426614174000',
        direction: 'dynamic',
        bind_port: 1080,
      });
      expect(mockPost).toHaveBeenCalledWith(expect.any(String), expect.any(Object), expect.objectContaining({ user_id: 'custom-user' }));
    });
  });

  describe('error sanitization', () => {
    it('should not expose internal details in error messages', async () => {
      const mockPost = vi.fn().mockRejectedValue(new Error('Connection refused to internal-db:5432'));
      const client = { ...mockApiClient, post: mockPost };
      const tool = createTerminalTunnelCreateTool({ ...options, client: client as unknown as ApiClient });

      const result = await tool.execute({
        connection_id: '123e4567-e89b-12d3-a456-426614174000',
        direction: 'dynamic',
        bind_port: 1080,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).not.toContain('5432');
        expect(result.error).not.toContain('internal-db');
      }
    });
  });
});

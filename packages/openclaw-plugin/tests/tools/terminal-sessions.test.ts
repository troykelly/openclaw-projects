/**
 * Tests for terminal session management and command execution tools.
 * Covers all 7 tools: session start/list/terminate/info,
 * send command, send keys, capture pane.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  createTerminalSessionStartTool,
  createTerminalSessionListTool,
  createTerminalSessionTerminateTool,
  createTerminalSessionInfoTool,
  createTerminalSendCommandTool,
  createTerminalSendKeysTool,
  createTerminalCapturePaneTool,
  type TerminalSessionStartParams,
  type TerminalSessionTerminateParams,
  type TerminalSessionInfoParams,
  type TerminalSendCommandParams,
  type TerminalSendKeysParams,
  type TerminalCapturePaneParams,
} from '../../src/tools/terminal-sessions.js';
import type { ApiClient } from '../../src/api-client.js';
import type { Logger } from '../../src/logger.js';
import type { PluginConfig } from '../../src/config.js';

describe('terminal session tools', () => {
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

  // ==================== terminal_session_start ====================

  describe('terminal_session_start', () => {
    it('should have correct name and description', () => {
      const tool = createTerminalSessionStartTool(options);
      expect(tool.name).toBe('terminal_session_start');
      expect(tool.description.length).toBeGreaterThan(10);
    });

    it('should require connection_id', async () => {
      const tool = createTerminalSessionStartTool(options);
      const result = await tool.execute({} as TerminalSessionStartParams);
      expect(result.success).toBe(false);
    });

    it('should validate connection_id as UUID', async () => {
      const tool = createTerminalSessionStartTool(options);
      const result = await tool.execute({ connection_id: 'not-uuid' });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('UUID');
      }
    });

    it('should start session with all fields', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: { id: 'sess-1', tmux_session_name: 'deploy', status: 'active' },
      });
      const client = { ...mockApiClient, post: mockPost };
      const tool = createTerminalSessionStartTool({ ...options, client: client as unknown as ApiClient });

      const result = await tool.execute({
        connection_id: '123e4567-e89b-12d3-a456-426614174000',
        session_name: 'deploy',
        initial_command: 'cd /app',
        tags: 'production,deploy',
        notes: 'Deployment session',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content).toContain('deploy');
        expect(result.data.content).toContain('sess-1');
        expect(result.data.content).toContain('active');
        expect(result.data.details.session_id).toBe('sess-1');
      }

      expect(mockPost).toHaveBeenCalledWith(
        '/api/terminal/sessions',
        expect.objectContaining({
          connection_id: '123e4567-e89b-12d3-a456-426614174000',
          tmux_session_name: 'deploy',
          initial_command: 'cd /app',
          tags: ['production', 'deploy'],
        }),
        expect.objectContaining({ user_id: 'agent-1' }),
      );
    });

    it('should handle API errors', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: false,
        error: { status: 500, message: 'Worker unavailable', code: 'SERVER_ERROR' },
      });
      const client = { ...mockApiClient, post: mockPost };
      const tool = createTerminalSessionStartTool({ ...options, client: client as unknown as ApiClient });

      const result = await tool.execute({ connection_id: '123e4567-e89b-12d3-a456-426614174000' });
      expect(result.success).toBe(false);
    });
  });

  // ==================== terminal_session_list ====================

  describe('terminal_session_list', () => {
    it('should have correct name', () => {
      const tool = createTerminalSessionListTool(options);
      expect(tool.name).toBe('terminal_session_list');
    });

    it('should list sessions', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: {
          sessions: [
            { id: 's1', tmux_session_name: 'deploy', status: 'active', tags: ['prod'] },
            { id: 's2', tmux_session_name: 'debug', status: 'terminated' },
          ],
          total: 2,
        },
      });
      const client = { ...mockApiClient, get: mockGet };
      const tool = createTerminalSessionListTool({ ...options, client: client as unknown as ApiClient });

      const result = await tool.execute({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content).toContain('deploy');
        expect(result.data.content).toContain('[active]');
        expect(result.data.content).toContain('debug');
        expect(result.data.content).toContain('[terminated]');
        expect(result.data.content).toContain('{prod}');
        expect(result.data.details.total).toBe(2);
      }
    });

    it('should filter by connection_id and status', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: { sessions: [], total: 0 },
      });
      const client = { ...mockApiClient, get: mockGet };
      const tool = createTerminalSessionListTool({ ...options, client: client as unknown as ApiClient });

      await tool.execute({
        connection_id: '123e4567-e89b-12d3-a456-426614174000',
        status: 'active',
        limit: 10,
      });

      expect(mockGet).toHaveBeenCalledWith(
        expect.stringContaining('connection_id=123e4567-e89b-12d3-a456-426614174000'),
        expect.any(Object),
      );
      expect(mockGet).toHaveBeenCalledWith(
        expect.stringContaining('status=active'),
        expect.any(Object),
      );
    });

    it('should validate connection_id UUID', async () => {
      const tool = createTerminalSessionListTool(options);
      const result = await tool.execute({ connection_id: 'not-uuid' });
      expect(result.success).toBe(false);
    });

    it('should handle empty results', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: { sessions: [], total: 0 },
      });
      const client = { ...mockApiClient, get: mockGet };
      const tool = createTerminalSessionListTool({ ...options, client: client as unknown as ApiClient });

      const result = await tool.execute({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content).toContain('No terminal sessions found');
      }
    });
  });

  // ==================== terminal_session_terminate ====================

  describe('terminal_session_terminate', () => {
    it('should have correct name', () => {
      const tool = createTerminalSessionTerminateTool(options);
      expect(tool.name).toBe('terminal_session_terminate');
    });

    it('should validate UUID format', async () => {
      const tool = createTerminalSessionTerminateTool(options);
      const result = await tool.execute({ session_id: 'bad-id' });
      expect(result.success).toBe(false);
    });

    it('should call DELETE endpoint', async () => {
      const mockDelete = vi.fn().mockResolvedValue({ success: true, data: undefined });
      const client = { ...mockApiClient, delete: mockDelete };
      const tool = createTerminalSessionTerminateTool({ ...options, client: client as unknown as ApiClient });

      const result = await tool.execute({ session_id: '123e4567-e89b-12d3-a456-426614174000' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content).toContain('terminated');
      }
      expect(mockDelete).toHaveBeenCalledWith(
        '/api/terminal/sessions/123e4567-e89b-12d3-a456-426614174000',
        expect.objectContaining({ user_id: 'agent-1' }),
      );
    });

    it('should handle not found', async () => {
      const mockDelete = vi.fn().mockResolvedValue({
        success: false,
        error: { status: 404, message: 'Not found', code: 'NOT_FOUND' },
      });
      const client = { ...mockApiClient, delete: mockDelete };
      const tool = createTerminalSessionTerminateTool({ ...options, client: client as unknown as ApiClient });

      const result = await tool.execute({ session_id: '123e4567-e89b-12d3-a456-426614174000' });
      expect(result.success).toBe(false);
    });
  });

  // ==================== terminal_session_info ====================

  describe('terminal_session_info', () => {
    it('should have correct name', () => {
      const tool = createTerminalSessionInfoTool(options);
      expect(tool.name).toBe('terminal_session_info');
    });

    it('should validate UUID format', async () => {
      const tool = createTerminalSessionInfoTool(options);
      const result = await tool.execute({ session_id: 'bad-id' });
      expect(result.success).toBe(false);
    });

    it('should return session details with windows and panes', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: {
          id: 's1',
          tmux_session_name: 'deploy',
          status: 'active',
          connection_id: 'c1',
          connection: { id: 'c1', name: 'prod-web', host: '10.0.0.1' },
          started_at: '2026-02-25T10:00:00Z',
          last_activity_at: '2026-02-25T10:05:00Z',
          windows: [
            {
              id: 'w1',
              window_index: 0,
              window_name: 'main',
              is_active: true,
              panes: [
                { id: 'p1', pane_index: 0, is_active: true, current_command: 'bash' },
              ],
            },
            {
              id: 'w2',
              window_index: 1,
              window_name: 'logs',
              is_active: false,
              panes: [
                { id: 'p2', pane_index: 0, is_active: true },
                { id: 'p3', pane_index: 1, is_active: false },
              ],
            },
          ],
        },
      });
      const client = { ...mockApiClient, get: mockGet };
      const tool = createTerminalSessionInfoTool({ ...options, client: client as unknown as ApiClient });

      const result = await tool.execute({ session_id: '123e4567-e89b-12d3-a456-426614174000' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content).toContain('deploy');
        expect(result.data.content).toContain('[active]');
        expect(result.data.content).toContain('prod-web');
        expect(result.data.content).toContain('10.0.0.1');
        expect(result.data.content).toContain('Windows (2)');
        expect(result.data.content).toContain('0: main');
        expect(result.data.content).toContain('1: logs');
        expect(result.data.content).toContain('2 panes');
        expect(result.data.details.session.windows).toHaveLength(2);
      }
    });

    it('should handle not found', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: false,
        error: { status: 404, message: 'Not found', code: 'NOT_FOUND' },
      });
      const client = { ...mockApiClient, get: mockGet };
      const tool = createTerminalSessionInfoTool({ ...options, client: client as unknown as ApiClient });

      const result = await tool.execute({ session_id: '123e4567-e89b-12d3-a456-426614174000' });
      expect(result.success).toBe(false);
    });
  });

  // ==================== terminal_send_command ====================

  describe('terminal_send_command', () => {
    it('should have correct name', () => {
      const tool = createTerminalSendCommandTool(options);
      expect(tool.name).toBe('terminal_send_command');
    });

    it('should require session_id and command', async () => {
      const tool = createTerminalSendCommandTool(options);
      const result = await tool.execute({} as TerminalSendCommandParams);
      expect(result.success).toBe(false);
    });

    it('should validate session_id UUID', async () => {
      const tool = createTerminalSendCommandTool(options);
      const result = await tool.execute({ session_id: 'bad-id', command: 'ls' });
      expect(result.success).toBe(false);
    });

    it('should reject empty command', async () => {
      const tool = createTerminalSendCommandTool(options);
      const result = await tool.execute({ session_id: '123e4567-e89b-12d3-a456-426614174000', command: '' });
      expect(result.success).toBe(false);
    });

    it('should send command and return output with exit code', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: { output: 'hello world\n', exit_code: 0, timed_out: false, duration_ms: 150 },
      });
      const client = { ...mockApiClient, post: mockPost };
      const tool = createTerminalSendCommandTool({ ...options, client: client as unknown as ApiClient });

      const result = await tool.execute({
        session_id: '123e4567-e89b-12d3-a456-426614174000',
        command: 'echo hello world',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content).toContain('hello world');
        expect(result.data.content).toContain('Exit code: 0');
        expect(result.data.content).toContain('Duration: 150ms');
        expect(result.data.details.output).toBe('hello world\n');
        expect(result.data.details.exit_code).toBe(0);
        expect(result.data.details.timed_out).toBe(false);
        expect(result.data.details.duration_ms).toBe(150);
      }

      expect(mockPost).toHaveBeenCalledWith(
        '/api/terminal/sessions/123e4567-e89b-12d3-a456-426614174000/send-command',
        expect.objectContaining({ command: 'echo hello world', timeout_s: 30 }),
        expect.any(Object),
      );
    });

    it('should pass custom timeout', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: { output: '', exit_code: 0, timed_out: false },
      });
      const client = { ...mockApiClient, post: mockPost };
      const tool = createTerminalSendCommandTool({ ...options, client: client as unknown as ApiClient });

      await tool.execute({
        session_id: '123e4567-e89b-12d3-a456-426614174000',
        command: 'long-running-task',
        timeout_s: 120,
      });

      expect(mockPost).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ timeout_s: 120 }),
        expect.any(Object),
      );
    });

    it('should pass pane_id when specified', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: { output: '', exit_code: 0, timed_out: false },
      });
      const client = { ...mockApiClient, post: mockPost };
      const tool = createTerminalSendCommandTool({ ...options, client: client as unknown as ApiClient });

      await tool.execute({
        session_id: '123e4567-e89b-12d3-a456-426614174000',
        command: 'ls',
        pane_id: '223e4567-e89b-12d3-a456-426614174000',
      });

      expect(mockPost).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ pane_id: '223e4567-e89b-12d3-a456-426614174000' }),
        expect.any(Object),
      );
    });

    it('should report timeout', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: { output: 'partial output', timed_out: true },
      });
      const client = { ...mockApiClient, post: mockPost };
      const tool = createTerminalSendCommandTool({ ...options, client: client as unknown as ApiClient });

      const result = await tool.execute({
        session_id: '123e4567-e89b-12d3-a456-426614174000',
        command: 'sleep 999',
        timeout_s: 5,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content).toContain('TIMED OUT');
        expect(result.data.details.timed_out).toBe(true);
      }
    });

    it('should validate pane_id UUID', async () => {
      const tool = createTerminalSendCommandTool(options);
      const result = await tool.execute({
        session_id: '123e4567-e89b-12d3-a456-426614174000',
        command: 'ls',
        pane_id: 'not-uuid',
      });
      expect(result.success).toBe(false);
    });

    it('should handle not found', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: false,
        error: { status: 404, message: 'Not found', code: 'NOT_FOUND' },
      });
      const client = { ...mockApiClient, post: mockPost };
      const tool = createTerminalSendCommandTool({ ...options, client: client as unknown as ApiClient });

      const result = await tool.execute({
        session_id: '123e4567-e89b-12d3-a456-426614174000',
        command: 'ls',
      });
      expect(result.success).toBe(false);
    });
  });

  // ==================== terminal_send_keys ====================

  describe('terminal_send_keys', () => {
    it('should have correct name', () => {
      const tool = createTerminalSendKeysTool(options);
      expect(tool.name).toBe('terminal_send_keys');
    });

    it('should require session_id and keys', async () => {
      const tool = createTerminalSendKeysTool(options);
      const result = await tool.execute({} as TerminalSendKeysParams);
      expect(result.success).toBe(false);
    });

    it('should send keys to session', async () => {
      const mockPost = vi.fn().mockResolvedValue({ success: true, data: undefined });
      const client = { ...mockApiClient, post: mockPost };
      const tool = createTerminalSendKeysTool({ ...options, client: client as unknown as ApiClient });

      const result = await tool.execute({
        session_id: '123e4567-e89b-12d3-a456-426614174000',
        keys: 'C-c',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content).toContain('Keys sent');
      }

      expect(mockPost).toHaveBeenCalledWith(
        '/api/terminal/sessions/123e4567-e89b-12d3-a456-426614174000/send-keys',
        expect.objectContaining({ keys: 'C-c' }),
        expect.any(Object),
      );
    });

    it('should support special key names', async () => {
      const mockPost = vi.fn().mockResolvedValue({ success: true, data: undefined });
      const client = { ...mockApiClient, post: mockPost };
      const tool = createTerminalSendKeysTool({ ...options, client: client as unknown as ApiClient });

      for (const key of ['Enter', 'Tab', 'Escape', 'C-c', 'C-d', 'Up', 'Down']) {
        await tool.execute({
          session_id: '123e4567-e89b-12d3-a456-426614174000',
          keys: key,
        });
      }

      expect(mockPost).toHaveBeenCalledTimes(7);
    });

    it('should pass pane_id when specified', async () => {
      const mockPost = vi.fn().mockResolvedValue({ success: true, data: undefined });
      const client = { ...mockApiClient, post: mockPost };
      const tool = createTerminalSendKeysTool({ ...options, client: client as unknown as ApiClient });

      await tool.execute({
        session_id: '123e4567-e89b-12d3-a456-426614174000',
        keys: 'Enter',
        pane_id: '223e4567-e89b-12d3-a456-426614174000',
      });

      expect(mockPost).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ pane_id: '223e4567-e89b-12d3-a456-426614174000' }),
        expect.any(Object),
      );
    });

    it('should validate session_id UUID', async () => {
      const tool = createTerminalSendKeysTool(options);
      const result = await tool.execute({ session_id: 'bad', keys: 'Enter' });
      expect(result.success).toBe(false);
    });
  });

  // ==================== terminal_capture_pane ====================

  describe('terminal_capture_pane', () => {
    it('should have correct name', () => {
      const tool = createTerminalCapturePaneTool(options);
      expect(tool.name).toBe('terminal_capture_pane');
    });

    it('should require session_id', async () => {
      const tool = createTerminalCapturePaneTool(options);
      const result = await tool.execute({} as TerminalCapturePaneParams);
      expect(result.success).toBe(false);
    });

    it('should capture pane content', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: { content: 'user@host:~$ ls\nfile1 file2\nuser@host:~$', rows: 40, cols: 120 },
      });
      const client = { ...mockApiClient, get: mockGet };
      const tool = createTerminalCapturePaneTool({ ...options, client: client as unknown as ApiClient });

      const result = await tool.execute({ session_id: '123e4567-e89b-12d3-a456-426614174000' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content).toContain('user@host');
        expect(result.data.content).toContain('file1 file2');
        expect(result.data.details.pane_content).toContain('user@host');
        expect(result.data.details.rows).toBe(40);
        expect(result.data.details.cols).toBe(120);
      }
    });

    it('should pass pane_id and lines parameters', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: { content: 'scrollback content', rows: 100, cols: 120 },
      });
      const client = { ...mockApiClient, get: mockGet };
      const tool = createTerminalCapturePaneTool({ ...options, client: client as unknown as ApiClient });

      await tool.execute({
        session_id: '123e4567-e89b-12d3-a456-426614174000',
        pane_id: '223e4567-e89b-12d3-a456-426614174000',
        lines: 100,
      });

      expect(mockGet).toHaveBeenCalledWith(
        expect.stringContaining('pane_id=223e4567-e89b-12d3-a456-426614174000'),
        expect.any(Object),
      );
      expect(mockGet).toHaveBeenCalledWith(
        expect.stringContaining('lines=100'),
        expect.any(Object),
      );
    });

    it('should validate session_id UUID', async () => {
      const tool = createTerminalCapturePaneTool(options);
      const result = await tool.execute({ session_id: 'bad' });
      expect(result.success).toBe(false);
    });

    it('should handle not found', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: false,
        error: { status: 404, message: 'Not found', code: 'NOT_FOUND' },
      });
      const client = { ...mockApiClient, get: mockGet };
      const tool = createTerminalCapturePaneTool({ ...options, client: client as unknown as ApiClient });

      const result = await tool.execute({ session_id: '123e4567-e89b-12d3-a456-426614174000' });
      expect(result.success).toBe(false);
    });
  });

  // ==================== Shared behaviors ====================

  describe('user scoping', () => {
    it('should include user_id in all API calls', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: { id: 's1', tmux_session_name: 'test', status: 'active' },
      });
      const client = { ...mockApiClient, post: mockPost };
      const tool = createTerminalSessionStartTool({
        ...options,
        client: client as unknown as ApiClient,
        user_id: 'custom-user',
      });

      await tool.execute({ connection_id: '123e4567-e89b-12d3-a456-426614174000' });
      expect(mockPost).toHaveBeenCalledWith(expect.any(String), expect.any(Object), expect.objectContaining({ user_id: 'custom-user' }));
    });
  });

  describe('error sanitization', () => {
    it('should not expose internal details in error messages', async () => {
      const mockPost = vi.fn().mockRejectedValue(new Error('Connection refused to internal-db:5432'));
      const client = { ...mockApiClient, post: mockPost };
      const tool = createTerminalSessionStartTool({ ...options, client: client as unknown as ApiClient });

      const result = await tool.execute({ connection_id: '123e4567-e89b-12d3-a456-426614174000' });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).not.toContain('5432');
        expect(result.error).not.toContain('internal-db');
      }
    });
  });
});

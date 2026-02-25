/**
 * Terminal session management and command execution tools.
 * Provides tools for starting/listing/terminating sessions, sending commands,
 * sending keystrokes, and capturing pane content.
 */

import { z } from 'zod';
import type { ApiClient } from '../api-client.js';
import type { Logger } from '../logger.js';
import type { PluginConfig } from '../config.js';
import { sanitizeErrorMessage } from '../utils/sanitize.js';

/** UUID validation regex */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validate UUID format.
 */
function isValidUuid(id: string): boolean {
  return UUID_REGEX.test(id);
}

/**
 * Strip HTML tags from a string.
 */
function stripHtml(text: string): string {
  return text
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<[^>]*>/g, '')
    .trim();
}

// ==================== Shared Types ====================

/** Tool configuration for terminal session tools */
export interface TerminalSessionToolOptions {
  client: ApiClient;
  logger: Logger;
  config: PluginConfig;
  user_id: string;
}

/** Terminal session from API */
export interface TerminalSession {
  id: string;
  connection_id: string;
  tmux_session_name: string;
  status: string;
  cols?: number;
  rows?: number;
  started_at?: string;
  last_activity_at?: string;
  terminated_at?: string;
  tags?: string[];
  notes?: string;
  created_at?: string;
  updated_at?: string;
}

/** Terminal session with windows/panes detail */
export interface TerminalSessionDetail extends TerminalSession {
  windows?: TerminalWindow[];
  connection?: { id: string; name: string; host?: string };
}

/** Terminal window */
export interface TerminalWindow {
  id: string;
  window_index: number;
  window_name?: string;
  is_active?: boolean;
  panes?: TerminalPane[];
}

/** Terminal pane */
export interface TerminalPane {
  id: string;
  pane_index: number;
  is_active?: boolean;
  current_command?: string;
}

/** Failure result */
export interface TerminalSessionFailure {
  success: false;
  error: string;
}

// ==================== terminal_session_start ====================

/** Parameters for terminal_session_start */
export const TerminalSessionStartParamsSchema = z.object({
  connection_id: z.string().min(1, 'Connection ID is required'),
  session_name: z.string().max(100, 'Session name must be 100 characters or less').optional(),
  initial_command: z.string().max(2000, 'Initial command must be 2000 characters or less').optional(),
  tags: z.string().max(500, 'Tags must be 500 characters or less').optional(),
  notes: z.string().max(2000, 'Notes must be 2000 characters or less').optional(),
});
export type TerminalSessionStartParams = z.infer<typeof TerminalSessionStartParamsSchema>;

/** Successful start result */
export interface TerminalSessionStartSuccess {
  success: true;
  data: {
    content: string;
    details: {
      session_id: string;
      tmux_session_name: string;
      status: string;
      user_id: string;
    };
  };
}

export type TerminalSessionStartResult = TerminalSessionStartSuccess | TerminalSessionFailure;

export interface TerminalSessionStartTool {
  name: string;
  description: string;
  parameters: typeof TerminalSessionStartParamsSchema;
  execute: (params: TerminalSessionStartParams) => Promise<TerminalSessionStartResult>;
}

/**
 * Creates the terminal_session_start tool.
 */
export function createTerminalSessionStartTool(options: TerminalSessionToolOptions): TerminalSessionStartTool {
  const { client, logger, user_id } = options;

  return {
    name: 'terminal_session_start',
    description: 'Start a new tmux session on a connection. Returns session ID for use with send_command and other tools.',
    parameters: TerminalSessionStartParamsSchema,

    async execute(params: TerminalSessionStartParams): Promise<TerminalSessionStartResult> {
      const parseResult = TerminalSessionStartParamsSchema.safeParse(params);
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
        return { success: false, error: errorMessage };
      }

      const { connection_id, session_name, initial_command, tags, notes } = parseResult.data;

      if (!isValidUuid(connection_id)) {
        return { success: false, error: 'Invalid connection_id format. Expected UUID.' };
      }

      logger.info('terminal_session_start invoked', {
        user_id,
        connectionId: connection_id,
        hasInitialCommand: !!initial_command,
      });

      try {
        const body: Record<string, unknown> = { connection_id };
        if (session_name) body.tmux_session_name = session_name;
        if (initial_command) body.initial_command = initial_command;
        if (tags) body.tags = tags.split(',').map((t) => t.trim()).filter(Boolean);
        if (notes) body.notes = stripHtml(notes);

        const response = await client.post<{ id: string; tmux_session_name: string; status: string }>(
          '/api/terminal/sessions',
          body,
          { user_id },
        );

        if (!response.success) {
          logger.error('terminal_session_start API error', {
            user_id,
            connectionId: connection_id,
            status: response.error.status,
            code: response.error.code,
          });
          return { success: false, error: response.error.message || 'Failed to start session' };
        }

        const session = response.data;

        logger.debug('terminal_session_start completed', {
          user_id,
          sessionId: session.id,
          tmuxName: session.tmux_session_name,
        });

        return {
          success: true,
          data: {
            content: `Started session "${session.tmux_session_name}" (ID: ${session.id}) — status: ${session.status}`,
            details: {
              session_id: session.id,
              tmux_session_name: session.tmux_session_name,
              status: session.status,
              user_id,
            },
          },
        };
      } catch (error) {
        logger.error('terminal_session_start failed', {
          user_id,
          connectionId: connection_id,
          error: error instanceof Error ? error.message : String(error),
        });
        return { success: false, error: sanitizeErrorMessage(error) };
      }
    },
  };
}

// ==================== terminal_session_list ====================

/** Parameters for terminal_session_list */
export const TerminalSessionListParamsSchema = z.object({
  connection_id: z.string().optional(),
  status: z.string().max(50).optional(),
  limit: z.number().int().min(1).max(200).optional(),
  offset: z.number().int().min(0).optional(),
});
export type TerminalSessionListParams = z.infer<typeof TerminalSessionListParamsSchema>;

/** Successful list result */
export interface TerminalSessionListSuccess {
  success: true;
  data: {
    content: string;
    details: {
      sessions: TerminalSession[];
      total: number;
      user_id: string;
    };
  };
}

export type TerminalSessionListResult = TerminalSessionListSuccess | TerminalSessionFailure;

export interface TerminalSessionListTool {
  name: string;
  description: string;
  parameters: typeof TerminalSessionListParamsSchema;
  execute: (params: TerminalSessionListParams) => Promise<TerminalSessionListResult>;
}

/**
 * Creates the terminal_session_list tool.
 */
export function createTerminalSessionListTool(options: TerminalSessionToolOptions): TerminalSessionListTool {
  const { client, logger, user_id } = options;

  return {
    name: 'terminal_session_list',
    description: 'List terminal sessions. Optionally filter by connection or status (active, terminated, etc.).',
    parameters: TerminalSessionListParamsSchema,

    async execute(params: TerminalSessionListParams): Promise<TerminalSessionListResult> {
      const parseResult = TerminalSessionListParamsSchema.safeParse(params);
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
        return { success: false, error: errorMessage };
      }

      const { connection_id, status, limit = 50, offset = 0 } = parseResult.data;

      if (connection_id && !isValidUuid(connection_id)) {
        return { success: false, error: 'Invalid connection_id format. Expected UUID.' };
      }

      logger.info('terminal_session_list invoked', { user_id, connection_id, status, limit, offset });

      try {
        const queryParams = new URLSearchParams({
          limit: String(limit),
          offset: String(offset),
        });
        if (connection_id) queryParams.set('connection_id', connection_id);
        if (status) queryParams.set('status', status);

        const response = await client.get<{ sessions?: TerminalSession[]; items?: TerminalSession[]; total?: number }>(
          `/api/terminal/sessions?${queryParams.toString()}`,
          { user_id },
        );

        if (!response.success) {
          logger.error('terminal_session_list API error', {
            user_id,
            status: response.error.status,
            code: response.error.code,
          });
          return { success: false, error: response.error.message || 'Failed to list sessions' };
        }

        const sessions = response.data.sessions ?? response.data.items ?? [];
        const total = response.data.total ?? sessions.length;

        if (sessions.length === 0) {
          return {
            success: true,
            data: {
              content: 'No terminal sessions found.',
              details: { sessions: [], total: 0, user_id },
            },
          };
        }

        const content = sessions
          .map((s) => {
            const parts = [s.tmux_session_name, `[${s.status}]`];
            if (s.tags && s.tags.length > 0) parts.push(`{${s.tags.join(', ')}}`);
            return `- ${parts.join(' ')} (ID: ${s.id})`;
          })
          .join('\n');

        logger.debug('terminal_session_list completed', { user_id, count: sessions.length });

        return {
          success: true,
          data: {
            content,
            details: { sessions, total, user_id },
          },
        };
      } catch (error) {
        logger.error('terminal_session_list failed', {
          user_id,
          error: error instanceof Error ? error.message : String(error),
        });
        return { success: false, error: sanitizeErrorMessage(error) };
      }
    },
  };
}

// ==================== terminal_session_terminate ====================

/** Parameters for terminal_session_terminate */
export const TerminalSessionTerminateParamsSchema = z.object({
  session_id: z.string().min(1, 'Session ID is required'),
});
export type TerminalSessionTerminateParams = z.infer<typeof TerminalSessionTerminateParamsSchema>;

/** Successful terminate result */
export interface TerminalSessionTerminateSuccess {
  success: true;
  data: {
    content: string;
    details: {
      session_id: string;
      user_id: string;
    };
  };
}

export type TerminalSessionTerminateResult = TerminalSessionTerminateSuccess | TerminalSessionFailure;

export interface TerminalSessionTerminateTool {
  name: string;
  description: string;
  parameters: typeof TerminalSessionTerminateParamsSchema;
  execute: (params: TerminalSessionTerminateParams) => Promise<TerminalSessionTerminateResult>;
}

/**
 * Creates the terminal_session_terminate tool.
 */
export function createTerminalSessionTerminateTool(options: TerminalSessionToolOptions): TerminalSessionTerminateTool {
  const { client, logger, user_id } = options;

  return {
    name: 'terminal_session_terminate',
    description: 'Terminate a running terminal session. The session history is preserved.',
    parameters: TerminalSessionTerminateParamsSchema,

    async execute(params: TerminalSessionTerminateParams): Promise<TerminalSessionTerminateResult> {
      const parseResult = TerminalSessionTerminateParamsSchema.safeParse(params);
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
        return { success: false, error: errorMessage };
      }

      const { session_id } = parseResult.data;

      if (!isValidUuid(session_id)) {
        return { success: false, error: 'Invalid session ID format. Expected UUID.' };
      }

      logger.info('terminal_session_terminate invoked', { user_id, sessionId: session_id });

      try {
        const response = await client.delete<void>(`/api/terminal/sessions/${session_id}`, { user_id });

        if (!response.success) {
          if (response.error.code === 'NOT_FOUND') {
            return { success: false, error: 'Session not found.' };
          }
          logger.error('terminal_session_terminate API error', {
            user_id,
            sessionId: session_id,
            status: response.error.status,
          });
          return { success: false, error: response.error.message || 'Failed to terminate session' };
        }

        logger.debug('terminal_session_terminate completed', { user_id, sessionId: session_id });

        return {
          success: true,
          data: {
            content: `Session ${session_id} terminated.`,
            details: { session_id, user_id },
          },
        };
      } catch (error) {
        logger.error('terminal_session_terminate failed', {
          user_id,
          sessionId: session_id,
          error: error instanceof Error ? error.message : String(error),
        });
        return { success: false, error: sanitizeErrorMessage(error) };
      }
    },
  };
}

// ==================== terminal_session_info ====================

/** Parameters for terminal_session_info */
export const TerminalSessionInfoParamsSchema = z.object({
  session_id: z.string().min(1, 'Session ID is required'),
});
export type TerminalSessionInfoParams = z.infer<typeof TerminalSessionInfoParamsSchema>;

/** Successful info result */
export interface TerminalSessionInfoSuccess {
  success: true;
  data: {
    content: string;
    details: {
      session: TerminalSessionDetail;
      user_id: string;
    };
  };
}

export type TerminalSessionInfoResult = TerminalSessionInfoSuccess | TerminalSessionFailure;

export interface TerminalSessionInfoTool {
  name: string;
  description: string;
  parameters: typeof TerminalSessionInfoParamsSchema;
  execute: (params: TerminalSessionInfoParams) => Promise<TerminalSessionInfoResult>;
}

/**
 * Creates the terminal_session_info tool.
 */
export function createTerminalSessionInfoTool(options: TerminalSessionToolOptions): TerminalSessionInfoTool {
  const { client, logger, user_id } = options;

  return {
    name: 'terminal_session_info',
    description: 'Get detailed information about a terminal session including windows, panes, and connection details.',
    parameters: TerminalSessionInfoParamsSchema,

    async execute(params: TerminalSessionInfoParams): Promise<TerminalSessionInfoResult> {
      const parseResult = TerminalSessionInfoParamsSchema.safeParse(params);
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
        return { success: false, error: errorMessage };
      }

      const { session_id } = parseResult.data;

      if (!isValidUuid(session_id)) {
        return { success: false, error: 'Invalid session ID format. Expected UUID.' };
      }

      logger.info('terminal_session_info invoked', { user_id, sessionId: session_id });

      try {
        const response = await client.get<TerminalSessionDetail>(`/api/terminal/sessions/${session_id}`, { user_id });

        if (!response.success) {
          if (response.error.code === 'NOT_FOUND') {
            return { success: false, error: 'Session not found.' };
          }
          logger.error('terminal_session_info API error', {
            user_id,
            sessionId: session_id,
            status: response.error.status,
          });
          return { success: false, error: response.error.message || 'Failed to get session info' };
        }

        const session = response.data;
        const lines = [
          `**${session.tmux_session_name}** [${session.status}]`,
        ];

        if (session.connection) {
          lines.push(`Connection: ${session.connection.name}${session.connection.host ? ` (${session.connection.host})` : ''}`);
        }

        if (session.started_at) lines.push(`Started: ${session.started_at}`);
        if (session.last_activity_at) lines.push(`Last activity: ${session.last_activity_at}`);

        if (session.windows && session.windows.length > 0) {
          lines.push(`\nWindows (${session.windows.length}):`);
          for (const win of session.windows) {
            const winLabel = win.window_name ? `${win.window_index}: ${win.window_name}` : `${win.window_index}`;
            const active = win.is_active ? ' *' : '';
            const paneCount = win.panes ? ` (${win.panes.length} panes)` : '';
            lines.push(`  - ${winLabel}${active}${paneCount}`);
          }
        }

        logger.debug('terminal_session_info completed', { user_id, sessionId: session_id });

        return {
          success: true,
          data: {
            content: lines.join('\n'),
            details: { session, user_id },
          },
        };
      } catch (error) {
        logger.error('terminal_session_info failed', {
          user_id,
          sessionId: session_id,
          error: error instanceof Error ? error.message : String(error),
        });
        return { success: false, error: sanitizeErrorMessage(error) };
      }
    },
  };
}

// ==================== terminal_send_command ====================

/** Parameters for terminal_send_command */
export const TerminalSendCommandParamsSchema = z.object({
  session_id: z.string().min(1, 'Session ID is required'),
  command: z.string().min(1, 'Command is required').max(5000, 'Command must be 5000 characters or less'),
  timeout_s: z.number().int().min(1).max(600).optional(),
  pane_id: z.string().optional(),
});
export type TerminalSendCommandParams = z.infer<typeof TerminalSendCommandParamsSchema>;

/** Command execution response from API */
export interface CommandExecutionResponse {
  output: string;
  exit_code?: number;
  timed_out?: boolean;
  duration_ms?: number;
}

/** Successful command result */
export interface TerminalSendCommandSuccess {
  success: true;
  data: {
    content: string;
    details: {
      session_id: string;
      output: string;
      exit_code?: number;
      timed_out: boolean;
      duration_ms?: number;
      user_id: string;
    };
  };
}

export type TerminalSendCommandResult = TerminalSendCommandSuccess | TerminalSessionFailure;

export interface TerminalSendCommandTool {
  name: string;
  description: string;
  parameters: typeof TerminalSendCommandParamsSchema;
  execute: (params: TerminalSendCommandParams) => Promise<TerminalSendCommandResult>;
}

/**
 * Creates the terminal_send_command tool.
 */
export function createTerminalSendCommandTool(options: TerminalSessionToolOptions): TerminalSendCommandTool {
  const { client, logger, user_id } = options;

  return {
    name: 'terminal_send_command',
    description: 'Send a shell command to a terminal session and wait for output. Returns the command output, exit code, and execution duration.',
    parameters: TerminalSendCommandParamsSchema,

    async execute(params: TerminalSendCommandParams): Promise<TerminalSendCommandResult> {
      const parseResult = TerminalSendCommandParamsSchema.safeParse(params);
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
        return { success: false, error: errorMessage };
      }

      const { session_id, command, timeout_s = 30, pane_id } = parseResult.data;

      if (!isValidUuid(session_id)) {
        return { success: false, error: 'Invalid session ID format. Expected UUID.' };
      }

      if (pane_id && !isValidUuid(pane_id)) {
        return { success: false, error: 'Invalid pane_id format. Expected UUID.' };
      }

      logger.info('terminal_send_command invoked', {
        user_id,
        sessionId: session_id,
        commandLength: command.length,
        timeout_s,
        hasPaneId: !!pane_id,
      });

      try {
        const body: Record<string, unknown> = { command, timeout_s };
        if (pane_id) body.pane_id = pane_id;

        const response = await client.post<CommandExecutionResponse>(
          `/api/terminal/sessions/${session_id}/send-command`,
          body,
          { user_id },
        );

        if (!response.success) {
          if (response.error.code === 'NOT_FOUND') {
            return { success: false, error: 'Session not found.' };
          }
          logger.error('terminal_send_command API error', {
            user_id,
            sessionId: session_id,
            status: response.error.status,
          });
          return { success: false, error: response.error.message || 'Failed to send command' };
        }

        const result = response.data;
        const timedOut = result.timed_out ?? false;

        const lines = [];
        if (timedOut) {
          lines.push(`[TIMED OUT after ${timeout_s}s]`);
        }
        if (result.exit_code !== undefined) {
          lines.push(`Exit code: ${result.exit_code}`);
        }
        if (result.duration_ms !== undefined) {
          lines.push(`Duration: ${result.duration_ms}ms`);
        }
        lines.push('');
        lines.push(result.output);

        logger.debug('terminal_send_command completed', {
          user_id,
          sessionId: session_id,
          exitCode: result.exit_code,
          timedOut,
          outputLength: result.output.length,
        });

        return {
          success: true,
          data: {
            content: lines.join('\n'),
            details: {
              session_id,
              output: result.output,
              exit_code: result.exit_code,
              timed_out: timedOut,
              duration_ms: result.duration_ms,
              user_id,
            },
          },
        };
      } catch (error) {
        logger.error('terminal_send_command failed', {
          user_id,
          sessionId: session_id,
          error: error instanceof Error ? error.message : String(error),
        });
        return { success: false, error: sanitizeErrorMessage(error) };
      }
    },
  };
}

// ==================== terminal_send_keys ====================

/** Parameters for terminal_send_keys */
export const TerminalSendKeysParamsSchema = z.object({
  session_id: z.string().min(1, 'Session ID is required'),
  keys: z.string().min(1, 'Keys are required').max(1000, 'Keys must be 1000 characters or less'),
  pane_id: z.string().optional(),
});
export type TerminalSendKeysParams = z.infer<typeof TerminalSendKeysParamsSchema>;

/** Successful send keys result */
export interface TerminalSendKeysSuccess {
  success: true;
  data: {
    content: string;
    details: {
      session_id: string;
      user_id: string;
    };
  };
}

export type TerminalSendKeysResult = TerminalSendKeysSuccess | TerminalSessionFailure;

export interface TerminalSendKeysTool {
  name: string;
  description: string;
  parameters: typeof TerminalSendKeysParamsSchema;
  execute: (params: TerminalSendKeysParams) => Promise<TerminalSendKeysResult>;
}

/**
 * Creates the terminal_send_keys tool.
 */
export function createTerminalSendKeysTool(options: TerminalSessionToolOptions): TerminalSendKeysTool {
  const { client, logger, user_id } = options;

  return {
    name: 'terminal_send_keys',
    description: 'Send raw keystrokes to a terminal session. Supports special keys: Enter, Tab, Escape, C-c, C-d, C-z, Up, Down, Left, Right.',
    parameters: TerminalSendKeysParamsSchema,

    async execute(params: TerminalSendKeysParams): Promise<TerminalSendKeysResult> {
      const parseResult = TerminalSendKeysParamsSchema.safeParse(params);
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
        return { success: false, error: errorMessage };
      }

      const { session_id, keys, pane_id } = parseResult.data;

      if (!isValidUuid(session_id)) {
        return { success: false, error: 'Invalid session ID format. Expected UUID.' };
      }

      if (pane_id && !isValidUuid(pane_id)) {
        return { success: false, error: 'Invalid pane_id format. Expected UUID.' };
      }

      logger.info('terminal_send_keys invoked', {
        user_id,
        sessionId: session_id,
        keysLength: keys.length,
        hasPaneId: !!pane_id,
      });

      try {
        const body: Record<string, unknown> = { keys };
        if (pane_id) body.pane_id = pane_id;

        const response = await client.post<void>(
          `/api/terminal/sessions/${session_id}/send-keys`,
          body,
          { user_id },
        );

        if (!response.success) {
          if (response.error.code === 'NOT_FOUND') {
            return { success: false, error: 'Session not found.' };
          }
          logger.error('terminal_send_keys API error', {
            user_id,
            sessionId: session_id,
            status: response.error.status,
          });
          return { success: false, error: response.error.message || 'Failed to send keys' };
        }

        logger.debug('terminal_send_keys completed', { user_id, sessionId: session_id });

        return {
          success: true,
          data: {
            content: `Keys sent to session ${session_id}.`,
            details: { session_id, user_id },
          },
        };
      } catch (error) {
        logger.error('terminal_send_keys failed', {
          user_id,
          sessionId: session_id,
          error: error instanceof Error ? error.message : String(error),
        });
        return { success: false, error: sanitizeErrorMessage(error) };
      }
    },
  };
}

// ==================== terminal_capture_pane ====================

/** Parameters for terminal_capture_pane */
export const TerminalCapturePaneParamsSchema = z.object({
  session_id: z.string().min(1, 'Session ID is required'),
  pane_id: z.string().optional(),
  lines: z.number().int().min(1).max(10000).optional(),
});
export type TerminalCapturePaneParams = z.infer<typeof TerminalCapturePaneParamsSchema>;

/** Pane capture response from API */
export interface PaneCaptureResponse {
  content: string;
  rows?: number;
  cols?: number;
}

/** Successful capture result */
export interface TerminalCapturePaneSuccess {
  success: true;
  data: {
    content: string;
    details: {
      session_id: string;
      pane_content: string;
      rows?: number;
      cols?: number;
      user_id: string;
    };
  };
}

export type TerminalCapturePaneResult = TerminalCapturePaneSuccess | TerminalSessionFailure;

export interface TerminalCapturePaneTool {
  name: string;
  description: string;
  parameters: typeof TerminalCapturePaneParamsSchema;
  execute: (params: TerminalCapturePaneParams) => Promise<TerminalCapturePaneResult>;
}

/**
 * Creates the terminal_capture_pane tool.
 */
export function createTerminalCapturePaneTool(options: TerminalSessionToolOptions): TerminalCapturePaneTool {
  const { client, logger, user_id } = options;

  return {
    name: 'terminal_capture_pane',
    description: 'Capture and read the current visible content of a terminal pane. Optionally specify number of scrollback lines.',
    parameters: TerminalCapturePaneParamsSchema,

    async execute(params: TerminalCapturePaneParams): Promise<TerminalCapturePaneResult> {
      const parseResult = TerminalCapturePaneParamsSchema.safeParse(params);
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
        return { success: false, error: errorMessage };
      }

      const { session_id, pane_id, lines } = parseResult.data;

      if (!isValidUuid(session_id)) {
        return { success: false, error: 'Invalid session ID format. Expected UUID.' };
      }

      if (pane_id && !isValidUuid(pane_id)) {
        return { success: false, error: 'Invalid pane_id format. Expected UUID.' };
      }

      logger.info('terminal_capture_pane invoked', {
        user_id,
        sessionId: session_id,
        hasPaneId: !!pane_id,
        lines,
      });

      try {
        const queryParams = new URLSearchParams();
        if (pane_id) queryParams.set('pane_id', pane_id);
        if (lines !== undefined) queryParams.set('lines', String(lines));

        const queryString = queryParams.toString();
        const path = `/api/terminal/sessions/${session_id}/capture${queryString ? `?${queryString}` : ''}`;
        const response = await client.get<PaneCaptureResponse>(path, { user_id });

        if (!response.success) {
          if (response.error.code === 'NOT_FOUND') {
            return { success: false, error: 'Session not found.' };
          }
          logger.error('terminal_capture_pane API error', {
            user_id,
            sessionId: session_id,
            status: response.error.status,
          });
          return { success: false, error: response.error.message || 'Failed to capture pane' };
        }

        const capture = response.data;

        logger.debug('terminal_capture_pane completed', {
          user_id,
          sessionId: session_id,
          contentLength: capture.content.length,
        });

        return {
          success: true,
          data: {
            content: capture.content,
            details: {
              session_id,
              pane_content: capture.content,
              rows: capture.rows,
              cols: capture.cols,
              user_id,
            },
          },
        };
      } catch (error) {
        logger.error('terminal_capture_pane failed', {
          user_id,
          sessionId: session_id,
          error: error instanceof Error ? error.message : String(error),
        });
        return { success: false, error: sanitizeErrorMessage(error) };
      }
    },
  };
}

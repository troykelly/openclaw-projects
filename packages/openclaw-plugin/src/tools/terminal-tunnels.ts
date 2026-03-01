/**
 * Terminal SSH tunnel management tools.
 * Provides tools for creating, listing, and closing SSH tunnels.
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

// ==================== Shared Types ====================

/** Tool configuration */
export interface TerminalTunnelToolOptions {
  client: ApiClient;
  logger: Logger;
  config: PluginConfig;
  user_id: string;
}

/** Tunnel from API */
export interface TerminalTunnel {
  id: string;
  connection_id: string;
  session_id?: string;
  direction: string;
  bind_host: string;
  bind_port: number;
  target_host?: string;
  target_port?: number;
  status: string;
  error_message?: string;
  created_at?: string;
  updated_at?: string;
}

/** Failure result */
export interface TerminalTunnelFailure {
  success: false;
  error: string;
}

// ==================== terminal_tunnel_create ====================

/** Tunnel direction enum */
export const TunnelDirection = z.enum(['local', 'remote', 'dynamic']);

/** Parameters for terminal_tunnel_create */
export const TerminalTunnelCreateParamsSchema = z.object({
  connection_id: z.string().min(1, 'Connection ID is required'),
  direction: TunnelDirection,
  bind_port: z.number().int().min(1).max(65535),
  target_host: z.string().max(253, 'Target host must be 253 characters or less').optional(),
  target_port: z.number().int().min(1).max(65535).optional(),
  bind_host: z.string().max(253, 'Bind host must be 253 characters or less').optional(),
});
export type TerminalTunnelCreateParams = z.infer<typeof TerminalTunnelCreateParamsSchema>;

/** Successful create result */
export interface TerminalTunnelCreateSuccess {
  success: true;
  data: {
    content: string;
    details: {
      tunnel_id: string;
      direction: string;
      bind_host: string;
      bind_port: number;
      target_host?: string;
      target_port?: number;
      status: string;
      user_id: string;
    };
  };
}

export type TerminalTunnelCreateResult = TerminalTunnelCreateSuccess | TerminalTunnelFailure;

export interface TerminalTunnelCreateTool {
  name: string;
  description: string;
  parameters: typeof TerminalTunnelCreateParamsSchema;
  execute: (params: TerminalTunnelCreateParams) => Promise<TerminalTunnelCreateResult>;
}

/**
 * Creates the terminal_tunnel_create tool.
 */
export function createTerminalTunnelCreateTool(options: TerminalTunnelToolOptions): TerminalTunnelCreateTool {
  const { client, logger, user_id } = options;

  return {
    name: 'terminal_tunnel_create',
    description: 'Creates an SSH tunnel (local/forward, remote/reverse, or dynamic/SOCKS). For local/remote tunnels, target_host and target_port are required. Persists until explicitly closed. Requires an active terminal connection.',
    parameters: TerminalTunnelCreateParamsSchema,

    async execute(params: TerminalTunnelCreateParams): Promise<TerminalTunnelCreateResult> {
      const parseResult = TerminalTunnelCreateParamsSchema.safeParse(params);
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
        return { success: false, error: errorMessage };
      }

      const { connection_id, direction, bind_port, target_host, target_port, bind_host } = parseResult.data;

      if (!isValidUuid(connection_id)) {
        return { success: false, error: 'Invalid connection_id format. Expected UUID.' };
      }

      // Validate target_host/target_port required for local/remote tunnels
      if ((direction === 'local' || direction === 'remote') && (!target_host || !target_port)) {
        return { success: false, error: `target_host and target_port are required for ${direction} tunnels.` };
      }

      logger.info('terminal_tunnel_create invoked', {
        user_id,
        connectionId: connection_id,
        direction,
        bindPort: bind_port,
      });

      try {
        const body: Record<string, unknown> = {
          connection_id,
          direction,
          bind_port,
        };
        if (target_host) body.target_host = target_host;
        if (target_port !== undefined) body.target_port = target_port;
        if (bind_host) body.bind_host = bind_host;

        const response = await client.post<TerminalTunnel>('/api/terminal/tunnels', body, { user_id });

        if (!response.success) {
          logger.error('terminal_tunnel_create API error', {
            user_id,
            connectionId: connection_id,
            status: response.error.status,
            code: response.error.code,
          });
          return { success: false, error: response.error.message || 'Failed to create tunnel' };
        }

        const tunnel = response.data;
        const bindAddr = `${tunnel.bind_host || bind_host || '127.0.0.1'}:${tunnel.bind_port}`;
        const targetAddr = tunnel.target_host && tunnel.target_port ? `${tunnel.target_host}:${tunnel.target_port}` : '';

        let content: string;
        if (direction === 'dynamic') {
          content = `Created dynamic SOCKS tunnel on ${bindAddr} (ID: ${tunnel.id}) — status: ${tunnel.status}`;
        } else if (direction === 'local') {
          content = `Created local tunnel ${bindAddr} → ${targetAddr} (ID: ${tunnel.id}) — status: ${tunnel.status}`;
        } else {
          content = `Created remote tunnel ${targetAddr} → ${bindAddr} (ID: ${tunnel.id}) — status: ${tunnel.status}`;
        }

        logger.debug('terminal_tunnel_create completed', {
          user_id,
          tunnelId: tunnel.id,
          direction,
        });

        return {
          success: true,
          data: {
            content,
            details: {
              tunnel_id: tunnel.id,
              direction: tunnel.direction,
              bind_host: tunnel.bind_host || bind_host || '127.0.0.1',
              bind_port: tunnel.bind_port,
              target_host: tunnel.target_host,
              target_port: tunnel.target_port,
              status: tunnel.status,
              user_id,
            },
          },
        };
      } catch (error) {
        logger.error('terminal_tunnel_create failed', {
          user_id,
          connectionId: connection_id,
          error: error instanceof Error ? error.message : String(error),
        });
        return { success: false, error: sanitizeErrorMessage(error) };
      }
    },
  };
}

// ==================== terminal_tunnel_list ====================

/** Parameters for terminal_tunnel_list */
export const TerminalTunnelListParamsSchema = z.object({
  connection_id: z.string().optional(),
  status: z.string().max(50).optional(),
});
export type TerminalTunnelListParams = z.infer<typeof TerminalTunnelListParamsSchema>;

/** Successful list result */
export interface TerminalTunnelListSuccess {
  success: true;
  data: {
    content: string;
    details: {
      tunnels: TerminalTunnel[];
      total: number;
      user_id: string;
    };
  };
}

export type TerminalTunnelListResult = TerminalTunnelListSuccess | TerminalTunnelFailure;

export interface TerminalTunnelListTool {
  name: string;
  description: string;
  parameters: typeof TerminalTunnelListParamsSchema;
  execute: (params: TerminalTunnelListParams) => Promise<TerminalTunnelListResult>;
}

/**
 * Creates the terminal_tunnel_list tool.
 */
export function createTerminalTunnelListTool(options: TerminalTunnelToolOptions): TerminalTunnelListTool {
  const { client, logger, user_id } = options;

  return {
    name: 'terminal_tunnel_list',
    description: 'Lists active SSH tunnels with optional filtering by connection or status. Use to find tunnel IDs for management or to verify port bindings. Read-only. Requires an active terminal connection.',
    parameters: TerminalTunnelListParamsSchema,

    async execute(params: TerminalTunnelListParams): Promise<TerminalTunnelListResult> {
      const parseResult = TerminalTunnelListParamsSchema.safeParse(params);
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
        return { success: false, error: errorMessage };
      }

      const { connection_id, status } = parseResult.data;

      if (connection_id && !isValidUuid(connection_id)) {
        return { success: false, error: 'Invalid connection_id format. Expected UUID.' };
      }

      logger.info('terminal_tunnel_list invoked', { user_id, connection_id, status });

      try {
        const queryParams = new URLSearchParams();
        if (connection_id) queryParams.set('connection_id', connection_id);
        if (status) queryParams.set('status', status);

        const queryString = queryParams.toString();
        const path = `/api/terminal/tunnels${queryString ? `?${queryString}` : ''}`;
        const response = await client.get<{ tunnels?: TerminalTunnel[]; items?: TerminalTunnel[]; total?: number }>(path, { user_id });

        if (!response.success) {
          logger.error('terminal_tunnel_list API error', {
            user_id,
            status: response.error.status,
            code: response.error.code,
          });
          return { success: false, error: response.error.message || 'Failed to list tunnels' };
        }

        const tunnels = response.data.tunnels ?? response.data.items ?? [];
        const total = response.data.total ?? tunnels.length;

        if (tunnels.length === 0) {
          return {
            success: true,
            data: {
              content: 'No active tunnels found.',
              details: { tunnels: [], total: 0, user_id },
            },
          };
        }

        const content = tunnels
          .map((t) => {
            const bindAddr = `${t.bind_host}:${t.bind_port}`;
            const targetAddr = t.target_host && t.target_port ? `${t.target_host}:${t.target_port}` : '';
            if (t.direction === 'dynamic') {
              return `- SOCKS ${bindAddr} [${t.status}] (ID: ${t.id})`;
            }
            const arrow = t.direction === 'local' ? '→' : '←';
            return `- ${t.direction} ${bindAddr} ${arrow} ${targetAddr} [${t.status}] (ID: ${t.id})`;
          })
          .join('\n');

        logger.debug('terminal_tunnel_list completed', { user_id, count: tunnels.length });

        return {
          success: true,
          data: {
            content,
            details: { tunnels, total, user_id },
          },
        };
      } catch (error) {
        logger.error('terminal_tunnel_list failed', {
          user_id,
          error: error instanceof Error ? error.message : String(error),
        });
        return { success: false, error: sanitizeErrorMessage(error) };
      }
    },
  };
}

// ==================== terminal_tunnel_close ====================

/** Parameters for terminal_tunnel_close */
export const TerminalTunnelCloseParamsSchema = z.object({
  id: z.string().min(1, 'Tunnel ID is required'),
});
export type TerminalTunnelCloseParams = z.infer<typeof TerminalTunnelCloseParamsSchema>;

/** Successful close result */
export interface TerminalTunnelCloseSuccess {
  success: true;
  data: {
    content: string;
    details: {
      id: string;
      user_id: string;
    };
  };
}

export type TerminalTunnelCloseResult = TerminalTunnelCloseSuccess | TerminalTunnelFailure;

export interface TerminalTunnelCloseTool {
  name: string;
  description: string;
  parameters: typeof TerminalTunnelCloseParamsSchema;
  execute: (params: TerminalTunnelCloseParams) => Promise<TerminalTunnelCloseResult>;
}

/**
 * Creates the terminal_tunnel_close tool.
 */
export function createTerminalTunnelCloseTool(options: TerminalTunnelToolOptions): TerminalTunnelCloseTool {
  const { client, logger, user_id } = options;

  return {
    name: 'terminal_tunnel_close',
    description: 'Closes an active SSH tunnel and releases the bound port. The tunnel is permanently removed. Use terminal_tunnel_list to find tunnel IDs. Requires the tunnel ID.',
    parameters: TerminalTunnelCloseParamsSchema,

    async execute(params: TerminalTunnelCloseParams): Promise<TerminalTunnelCloseResult> {
      const parseResult = TerminalTunnelCloseParamsSchema.safeParse(params);
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
        return { success: false, error: errorMessage };
      }

      const { id } = parseResult.data;

      if (!isValidUuid(id)) {
        return { success: false, error: 'Invalid tunnel ID format. Expected UUID.' };
      }

      logger.info('terminal_tunnel_close invoked', { user_id, tunnelId: id });

      try {
        const response = await client.delete<void>(`/api/terminal/tunnels/${id}`, { user_id });

        if (!response.success) {
          if (response.error.code === 'NOT_FOUND') {
            return { success: false, error: 'Tunnel not found.' };
          }
          logger.error('terminal_tunnel_close API error', {
            user_id,
            tunnelId: id,
            status: response.error.status,
          });
          return { success: false, error: response.error.message || 'Failed to close tunnel' };
        }

        logger.debug('terminal_tunnel_close completed', { user_id, tunnelId: id });

        return {
          success: true,
          data: {
            content: `Tunnel ${id} closed.`,
            details: { id, user_id },
          },
        };
      } catch (error) {
        logger.error('terminal_tunnel_close failed', {
          user_id,
          tunnelId: id,
          error: error instanceof Error ? error.message : String(error),
        });
        return { success: false, error: sanitizeErrorMessage(error) };
      }
    },
  };
}

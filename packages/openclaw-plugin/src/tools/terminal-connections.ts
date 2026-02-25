/**
 * Terminal connection and credential management tools.
 * Provides tools for managing SSH connections and credentials for OpenClaw agents.
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

/** Tool configuration for terminal connection tools */
export interface TerminalConnectionToolOptions {
  client: ApiClient;
  logger: Logger;
  config: PluginConfig;
  user_id: string;
}

/** Terminal connection from API */
export interface TerminalConnection {
  id: string;
  name: string;
  host?: string;
  port?: number;
  username?: string;
  auth_method?: string;
  credential_id?: string;
  proxy_jump_id?: string;
  is_local?: boolean;
  tags?: string[];
  notes?: string;
  last_connected_at?: string;
  last_error?: string;
  created_at?: string;
  updated_at?: string;
}

/** Terminal credential from API (no secrets) */
export interface TerminalCredential {
  id: string;
  name: string;
  kind: string;
  fingerprint?: string;
  public_key?: string;
  created_at?: string;
  updated_at?: string;
}

/** Failure result */
export interface TerminalConnectionFailure {
  success: false;
  error: string;
}

// ==================== terminal_connection_list ====================

/** Parameters for terminal_connection_list */
export const TerminalConnectionListParamsSchema = z.object({
  tags: z.string().max(500, 'Tags must be 500 characters or less').optional(),
  search: z.string().max(200, 'Search must be 200 characters or less').optional(),
  is_local: z.boolean().optional(),
});
export type TerminalConnectionListParams = z.infer<typeof TerminalConnectionListParamsSchema>;

/** Successful list result */
export interface TerminalConnectionListSuccess {
  success: true;
  data: {
    content: string;
    details: {
      connections: TerminalConnection[];
      total: number;
      user_id: string;
    };
  };
}

export type TerminalConnectionListResult = TerminalConnectionListSuccess | TerminalConnectionFailure;

export interface TerminalConnectionListTool {
  name: string;
  description: string;
  parameters: typeof TerminalConnectionListParamsSchema;
  execute: (params: TerminalConnectionListParams) => Promise<TerminalConnectionListResult>;
}

/**
 * Creates the terminal_connection_list tool.
 */
export function createTerminalConnectionListTool(options: TerminalConnectionToolOptions): TerminalConnectionListTool {
  const { client, logger, user_id } = options;

  return {
    name: 'terminal_connection_list',
    description: 'List saved terminal connections. Optionally filter by tags, search term, or local/remote.',
    parameters: TerminalConnectionListParamsSchema,

    async execute(params: TerminalConnectionListParams): Promise<TerminalConnectionListResult> {
      const parseResult = TerminalConnectionListParamsSchema.safeParse(params);
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
        return { success: false, error: errorMessage };
      }

      const { tags, search, is_local } = parseResult.data;

      logger.info('terminal_connection_list invoked', { user_id, hasTags: !!tags, hasSearch: !!search, is_local });

      try {
        const queryParams = new URLSearchParams();
        if (tags) queryParams.set('tags', tags);
        if (search) queryParams.set('search', search);
        if (is_local !== undefined) queryParams.set('is_local', String(is_local));

        const queryString = queryParams.toString();
        const path = `/api/terminal/connections${queryString ? `?${queryString}` : ''}`;
        const response = await client.get<{ connections?: TerminalConnection[]; items?: TerminalConnection[]; total?: number }>(path, { user_id });

        if (!response.success) {
          logger.error('terminal_connection_list API error', {
            user_id,
            status: response.error.status,
            code: response.error.code,
          });
          return { success: false, error: response.error.message || 'Failed to list connections' };
        }

        const connections = response.data.connections ?? response.data.items ?? [];
        const total = response.data.total ?? connections.length;

        if (connections.length === 0) {
          return {
            success: true,
            data: {
              content: 'No terminal connections found.',
              details: { connections: [], total: 0, user_id },
            },
          };
        }

        const content = connections
          .map((c) => {
            const parts = [c.name];
            if (c.host) parts.push(`(${c.username ? `${c.username}@` : ''}${c.host}${c.port && c.port !== 22 ? `:${c.port}` : ''})`);
            if (c.is_local) parts.push('[local]');
            if (c.tags && c.tags.length > 0) parts.push(`[${c.tags.join(', ')}]`);
            return `- ${parts.join(' ')}`;
          })
          .join('\n');

        logger.debug('terminal_connection_list completed', { user_id, count: connections.length });

        return {
          success: true,
          data: {
            content,
            details: { connections, total, user_id },
          },
        };
      } catch (error) {
        logger.error('terminal_connection_list failed', {
          user_id,
          error: error instanceof Error ? error.message : String(error),
        });
        return { success: false, error: sanitizeErrorMessage(error) };
      }
    },
  };
}

// ==================== terminal_connection_create ====================

/** Auth method enum */
export const TerminalAuthMethod = z.enum(['key', 'password', 'agent', 'command']);

/** Parameters for terminal_connection_create */
export const TerminalConnectionCreateParamsSchema = z.object({
  name: z.string().min(1, 'Connection name is required').max(200, 'Name must be 200 characters or less'),
  host: z.string().max(253, 'Host must be 253 characters or less').optional(),
  port: z.number().int().min(1).max(65535).optional(),
  username: z.string().max(100, 'Username must be 100 characters or less').optional(),
  auth_method: TerminalAuthMethod.optional(),
  credential_id: z.string().optional(),
  is_local: z.boolean().optional(),
  tags: z.string().max(500, 'Tags must be 500 characters or less').optional(),
  notes: z.string().max(2000, 'Notes must be 2000 characters or less').optional(),
});
export type TerminalConnectionCreateParams = z.infer<typeof TerminalConnectionCreateParamsSchema>;

/** Successful create result */
export interface TerminalConnectionCreateSuccess {
  success: true;
  data: {
    content: string;
    details: {
      id: string;
      name: string;
      user_id: string;
    };
  };
}

export type TerminalConnectionCreateResult = TerminalConnectionCreateSuccess | TerminalConnectionFailure;

export interface TerminalConnectionCreateTool {
  name: string;
  description: string;
  parameters: typeof TerminalConnectionCreateParamsSchema;
  execute: (params: TerminalConnectionCreateParams) => Promise<TerminalConnectionCreateResult>;
}

/**
 * Creates the terminal_connection_create tool.
 */
export function createTerminalConnectionCreateTool(options: TerminalConnectionToolOptions): TerminalConnectionCreateTool {
  const { client, logger, user_id } = options;

  return {
    name: 'terminal_connection_create',
    description: 'Create a new terminal connection definition. Specify host/port/username for SSH connections, or set is_local=true for local tmux.',
    parameters: TerminalConnectionCreateParamsSchema,

    async execute(params: TerminalConnectionCreateParams): Promise<TerminalConnectionCreateResult> {
      const parseResult = TerminalConnectionCreateParamsSchema.safeParse(params);
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
        return { success: false, error: errorMessage };
      }

      const { name, host, port, username, auth_method, credential_id, is_local, tags, notes } = parseResult.data;

      const sanitizedName = stripHtml(name);
      if (sanitizedName.length === 0) {
        return { success: false, error: 'Connection name cannot be empty after sanitization' };
      }

      if (credential_id && !isValidUuid(credential_id)) {
        return { success: false, error: 'Invalid credential_id format. Expected UUID.' };
      }

      logger.info('terminal_connection_create invoked', {
        user_id,
        nameLength: sanitizedName.length,
        hasHost: !!host,
        is_local: is_local ?? false,
      });

      try {
        const body: Record<string, unknown> = { name: sanitizedName };
        if (host) body.host = host;
        if (port !== undefined) body.port = port;
        if (username) body.username = username;
        if (auth_method) body.auth_method = auth_method;
        if (credential_id) body.credential_id = credential_id;
        if (is_local !== undefined) body.is_local = is_local;
        if (tags) body.tags = tags.split(',').map((t) => t.trim()).filter(Boolean);
        if (notes) body.notes = stripHtml(notes);

        const response = await client.post<{ id: string; name?: string }>('/api/terminal/connections', body, { user_id });

        if (!response.success) {
          logger.error('terminal_connection_create API error', {
            user_id,
            status: response.error.status,
            code: response.error.code,
          });
          return { success: false, error: response.error.message || 'Failed to create connection' };
        }

        logger.debug('terminal_connection_create completed', { user_id, connectionId: response.data.id });

        return {
          success: true,
          data: {
            content: `Created connection "${sanitizedName}" (ID: ${response.data.id})`,
            details: { id: response.data.id, name: sanitizedName, user_id },
          },
        };
      } catch (error) {
        logger.error('terminal_connection_create failed', {
          user_id,
          error: error instanceof Error ? error.message : String(error),
        });
        return { success: false, error: sanitizeErrorMessage(error) };
      }
    },
  };
}

// ==================== terminal_connection_update ====================

/** Parameters for terminal_connection_update */
export const TerminalConnectionUpdateParamsSchema = z.object({
  id: z.string().min(1, 'Connection ID is required'),
  name: z.string().min(1).max(200, 'Name must be 200 characters or less').optional(),
  host: z.string().max(253, 'Host must be 253 characters or less').optional(),
  port: z.number().int().min(1).max(65535).optional(),
  username: z.string().max(100, 'Username must be 100 characters or less').optional(),
  auth_method: TerminalAuthMethod.optional(),
  credential_id: z.string().optional(),
  tags: z.string().max(500, 'Tags must be 500 characters or less').optional(),
  notes: z.string().max(2000, 'Notes must be 2000 characters or less').optional(),
});
export type TerminalConnectionUpdateParams = z.infer<typeof TerminalConnectionUpdateParamsSchema>;

/** Successful update result */
export interface TerminalConnectionUpdateSuccess {
  success: true;
  data: {
    content: string;
    details: {
      id: string;
      user_id: string;
    };
  };
}

export type TerminalConnectionUpdateResult = TerminalConnectionUpdateSuccess | TerminalConnectionFailure;

export interface TerminalConnectionUpdateTool {
  name: string;
  description: string;
  parameters: typeof TerminalConnectionUpdateParamsSchema;
  execute: (params: TerminalConnectionUpdateParams) => Promise<TerminalConnectionUpdateResult>;
}

/**
 * Creates the terminal_connection_update tool.
 */
export function createTerminalConnectionUpdateTool(options: TerminalConnectionToolOptions): TerminalConnectionUpdateTool {
  const { client, logger, user_id } = options;

  return {
    name: 'terminal_connection_update',
    description: 'Update an existing terminal connection. Only provided fields will be changed.',
    parameters: TerminalConnectionUpdateParamsSchema,

    async execute(params: TerminalConnectionUpdateParams): Promise<TerminalConnectionUpdateResult> {
      const parseResult = TerminalConnectionUpdateParamsSchema.safeParse(params);
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
        return { success: false, error: errorMessage };
      }

      const { id, name, host, port, username, auth_method, credential_id, tags, notes } = parseResult.data;

      if (!isValidUuid(id)) {
        return { success: false, error: 'Invalid connection ID format. Expected UUID.' };
      }

      if (credential_id && !isValidUuid(credential_id)) {
        return { success: false, error: 'Invalid credential_id format. Expected UUID.' };
      }

      logger.info('terminal_connection_update invoked', { user_id, connectionId: id });

      try {
        const body: Record<string, unknown> = {};
        if (name) body.name = stripHtml(name);
        if (host) body.host = host;
        if (port !== undefined) body.port = port;
        if (username) body.username = username;
        if (auth_method) body.auth_method = auth_method;
        if (credential_id) body.credential_id = credential_id;
        if (tags) body.tags = tags.split(',').map((t) => t.trim()).filter(Boolean);
        if (notes) body.notes = stripHtml(notes);

        const response = await client.patch<{ id: string }>(`/api/terminal/connections/${id}`, body, { user_id });

        if (!response.success) {
          if (response.error.code === 'NOT_FOUND') {
            return { success: false, error: 'Connection not found.' };
          }
          logger.error('terminal_connection_update API error', {
            user_id,
            connectionId: id,
            status: response.error.status,
          });
          return { success: false, error: response.error.message || 'Failed to update connection' };
        }

        logger.debug('terminal_connection_update completed', { user_id, connectionId: id });

        return {
          success: true,
          data: {
            content: `Connection ${id} updated.`,
            details: { id, user_id },
          },
        };
      } catch (error) {
        logger.error('terminal_connection_update failed', {
          user_id,
          connectionId: id,
          error: error instanceof Error ? error.message : String(error),
        });
        return { success: false, error: sanitizeErrorMessage(error) };
      }
    },
  };
}

// ==================== terminal_connection_delete ====================

/** Parameters for terminal_connection_delete */
export const TerminalConnectionDeleteParamsSchema = z.object({
  id: z.string().min(1, 'Connection ID is required'),
});
export type TerminalConnectionDeleteParams = z.infer<typeof TerminalConnectionDeleteParamsSchema>;

/** Successful delete result */
export interface TerminalConnectionDeleteSuccess {
  success: true;
  data: {
    content: string;
    details: {
      id: string;
      user_id: string;
    };
  };
}

export type TerminalConnectionDeleteResult = TerminalConnectionDeleteSuccess | TerminalConnectionFailure;

export interface TerminalConnectionDeleteTool {
  name: string;
  description: string;
  parameters: typeof TerminalConnectionDeleteParamsSchema;
  execute: (params: TerminalConnectionDeleteParams) => Promise<TerminalConnectionDeleteResult>;
}

/**
 * Creates the terminal_connection_delete tool.
 */
export function createTerminalConnectionDeleteTool(options: TerminalConnectionToolOptions): TerminalConnectionDeleteTool {
  const { client, logger, user_id } = options;

  return {
    name: 'terminal_connection_delete',
    description: 'Soft-delete a terminal connection. The connection will be marked as deleted but retained for history.',
    parameters: TerminalConnectionDeleteParamsSchema,

    async execute(params: TerminalConnectionDeleteParams): Promise<TerminalConnectionDeleteResult> {
      const parseResult = TerminalConnectionDeleteParamsSchema.safeParse(params);
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
        return { success: false, error: errorMessage };
      }

      const { id } = parseResult.data;

      if (!isValidUuid(id)) {
        return { success: false, error: 'Invalid connection ID format. Expected UUID.' };
      }

      logger.info('terminal_connection_delete invoked', { user_id, connectionId: id });

      try {
        const response = await client.delete<void>(`/api/terminal/connections/${id}`, { user_id });

        if (!response.success) {
          if (response.error.code === 'NOT_FOUND') {
            return { success: false, error: 'Connection not found.' };
          }
          logger.error('terminal_connection_delete API error', {
            user_id,
            connectionId: id,
            status: response.error.status,
          });
          return { success: false, error: response.error.message || 'Failed to delete connection' };
        }

        logger.debug('terminal_connection_delete completed', { user_id, connectionId: id });

        return {
          success: true,
          data: {
            content: `Connection ${id} deleted.`,
            details: { id, user_id },
          },
        };
      } catch (error) {
        logger.error('terminal_connection_delete failed', {
          user_id,
          connectionId: id,
          error: error instanceof Error ? error.message : String(error),
        });
        return { success: false, error: sanitizeErrorMessage(error) };
      }
    },
  };
}

// ==================== terminal_connection_test ====================

/** Parameters for terminal_connection_test */
export const TerminalConnectionTestParamsSchema = z.object({
  id: z.string().min(1, 'Connection ID is required'),
});
export type TerminalConnectionTestParams = z.infer<typeof TerminalConnectionTestParamsSchema>;

/** Connection test response from API */
export interface ConnectionTestResponse {
  success: boolean;
  latency_ms?: number;
  error?: string;
  host_key_fingerprint?: string;
}

/** Successful test result */
export interface TerminalConnectionTestSuccess {
  success: true;
  data: {
    content: string;
    details: {
      id: string;
      test_success: boolean;
      latency_ms?: number;
      host_key_fingerprint?: string;
      error?: string;
      user_id: string;
    };
  };
}

export type TerminalConnectionTestResult = TerminalConnectionTestSuccess | TerminalConnectionFailure;

export interface TerminalConnectionTestTool {
  name: string;
  description: string;
  parameters: typeof TerminalConnectionTestParamsSchema;
  execute: (params: TerminalConnectionTestParams) => Promise<TerminalConnectionTestResult>;
}

/**
 * Creates the terminal_connection_test tool.
 */
export function createTerminalConnectionTestTool(options: TerminalConnectionToolOptions): TerminalConnectionTestTool {
  const { client, logger, user_id } = options;

  return {
    name: 'terminal_connection_test',
    description: 'Test SSH connectivity to a saved connection. Returns latency and host key fingerprint on success.',
    parameters: TerminalConnectionTestParamsSchema,

    async execute(params: TerminalConnectionTestParams): Promise<TerminalConnectionTestResult> {
      const parseResult = TerminalConnectionTestParamsSchema.safeParse(params);
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
        return { success: false, error: errorMessage };
      }

      const { id } = parseResult.data;

      if (!isValidUuid(id)) {
        return { success: false, error: 'Invalid connection ID format. Expected UUID.' };
      }

      logger.info('terminal_connection_test invoked', { user_id, connectionId: id });

      try {
        const response = await client.post<ConnectionTestResponse>(`/api/terminal/connections/${id}/test`, undefined, { user_id });

        if (!response.success) {
          if (response.error.code === 'NOT_FOUND') {
            return { success: false, error: 'Connection not found.' };
          }
          logger.error('terminal_connection_test API error', {
            user_id,
            connectionId: id,
            status: response.error.status,
          });
          return { success: false, error: response.error.message || 'Failed to test connection' };
        }

        const testResult = response.data;

        const content = testResult.success
          ? `Connection test successful. Latency: ${testResult.latency_ms ?? 'N/A'}ms${testResult.host_key_fingerprint ? ` | Fingerprint: ${testResult.host_key_fingerprint}` : ''}`
          : `Connection test failed: ${testResult.error ?? 'Unknown error'}`;

        logger.debug('terminal_connection_test completed', {
          user_id,
          connectionId: id,
          testSuccess: testResult.success,
        });

        return {
          success: true,
          data: {
            content,
            details: {
              id,
              test_success: testResult.success,
              latency_ms: testResult.latency_ms,
              host_key_fingerprint: testResult.host_key_fingerprint,
              error: testResult.error,
              user_id,
            },
          },
        };
      } catch (error) {
        logger.error('terminal_connection_test failed', {
          user_id,
          connectionId: id,
          error: error instanceof Error ? error.message : String(error),
        });
        return { success: false, error: sanitizeErrorMessage(error) };
      }
    },
  };
}

// ==================== terminal_credential_create ====================

/** Credential kind enum */
export const TerminalCredentialKind = z.enum(['ssh_key', 'password', 'command']);

/** Parameters for terminal_credential_create */
export const TerminalCredentialCreateParamsSchema = z.object({
  name: z.string().min(1, 'Credential name is required').max(200, 'Name must be 200 characters or less'),
  kind: TerminalCredentialKind,
  private_key: z.string().optional(),
  password: z.string().optional(),
  command: z.string().max(500, 'Command must be 500 characters or less').optional(),
  command_timeout_s: z.number().int().min(1).max(300).optional(),
});
export type TerminalCredentialCreateParams = z.infer<typeof TerminalCredentialCreateParamsSchema>;

/** Successful credential create result */
export interface TerminalCredentialCreateSuccess {
  success: true;
  data: {
    content: string;
    details: {
      id: string;
      name: string;
      kind: string;
      fingerprint?: string;
      user_id: string;
    };
  };
}

export type TerminalCredentialCreateResult = TerminalCredentialCreateSuccess | TerminalConnectionFailure;

export interface TerminalCredentialCreateTool {
  name: string;
  description: string;
  parameters: typeof TerminalCredentialCreateParamsSchema;
  execute: (params: TerminalCredentialCreateParams) => Promise<TerminalCredentialCreateResult>;
}

/**
 * Creates the terminal_credential_create tool.
 */
export function createTerminalCredentialCreateTool(options: TerminalConnectionToolOptions): TerminalCredentialCreateTool {
  const { client, logger, user_id } = options;

  return {
    name: 'terminal_credential_create',
    description: 'Create a terminal credential. Upload an SSH key, set a password, or configure a command-based credential provider.',
    parameters: TerminalCredentialCreateParamsSchema,

    async execute(params: TerminalCredentialCreateParams): Promise<TerminalCredentialCreateResult> {
      const parseResult = TerminalCredentialCreateParamsSchema.safeParse(params);
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
        return { success: false, error: errorMessage };
      }

      const { name, kind, private_key, password, command, command_timeout_s } = parseResult.data;

      const sanitizedName = stripHtml(name);
      if (sanitizedName.length === 0) {
        return { success: false, error: 'Credential name cannot be empty after sanitization' };
      }

      logger.info('terminal_credential_create invoked', {
        user_id,
        kind,
        nameLength: sanitizedName.length,
      });

      try {
        const body: Record<string, unknown> = { name: sanitizedName, kind };
        if (private_key) body.private_key = private_key;
        if (password) body.password = password;
        if (command) body.command = command;
        if (command_timeout_s !== undefined) body.command_timeout_s = command_timeout_s;

        const response = await client.post<{ id: string; name?: string; kind?: string; fingerprint?: string }>(
          '/api/terminal/credentials',
          body,
          { user_id },
        );

        if (!response.success) {
          logger.error('terminal_credential_create API error', {
            user_id,
            status: response.error.status,
            code: response.error.code,
          });
          return { success: false, error: response.error.message || 'Failed to create credential' };
        }

        logger.debug('terminal_credential_create completed', { user_id, credentialId: response.data.id });

        return {
          success: true,
          data: {
            content: `Created ${kind} credential "${sanitizedName}" (ID: ${response.data.id})${response.data.fingerprint ? ` | Fingerprint: ${response.data.fingerprint}` : ''}`,
            details: {
              id: response.data.id,
              name: sanitizedName,
              kind,
              fingerprint: response.data.fingerprint,
              user_id,
            },
          },
        };
      } catch (error) {
        logger.error('terminal_credential_create failed', {
          user_id,
          error: error instanceof Error ? error.message : String(error),
        });
        return { success: false, error: sanitizeErrorMessage(error) };
      }
    },
  };
}

// ==================== terminal_credential_list ====================

/** Parameters for terminal_credential_list */
export const TerminalCredentialListParamsSchema = z.object({
  kind: TerminalCredentialKind.optional(),
});
export type TerminalCredentialListParams = z.infer<typeof TerminalCredentialListParamsSchema>;

/** Successful credential list result */
export interface TerminalCredentialListSuccess {
  success: true;
  data: {
    content: string;
    details: {
      credentials: TerminalCredential[];
      total: number;
      user_id: string;
    };
  };
}

export type TerminalCredentialListResult = TerminalCredentialListSuccess | TerminalConnectionFailure;

export interface TerminalCredentialListTool {
  name: string;
  description: string;
  parameters: typeof TerminalCredentialListParamsSchema;
  execute: (params: TerminalCredentialListParams) => Promise<TerminalCredentialListResult>;
}

/**
 * Creates the terminal_credential_list tool.
 */
export function createTerminalCredentialListTool(options: TerminalConnectionToolOptions): TerminalCredentialListTool {
  const { client, logger, user_id } = options;

  return {
    name: 'terminal_credential_list',
    description: 'List terminal credentials (metadata only, no secrets). Optionally filter by kind.',
    parameters: TerminalCredentialListParamsSchema,

    async execute(params: TerminalCredentialListParams): Promise<TerminalCredentialListResult> {
      const parseResult = TerminalCredentialListParamsSchema.safeParse(params);
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
        return { success: false, error: errorMessage };
      }

      const { kind } = parseResult.data;

      logger.info('terminal_credential_list invoked', { user_id, kind });

      try {
        const queryParams = new URLSearchParams();
        if (kind) queryParams.set('kind', kind);

        const queryString = queryParams.toString();
        const path = `/api/terminal/credentials${queryString ? `?${queryString}` : ''}`;
        const response = await client.get<{ credentials?: TerminalCredential[]; items?: TerminalCredential[]; total?: number }>(path, { user_id });

        if (!response.success) {
          logger.error('terminal_credential_list API error', {
            user_id,
            status: response.error.status,
            code: response.error.code,
          });
          return { success: false, error: response.error.message || 'Failed to list credentials' };
        }

        const credentials = response.data.credentials ?? response.data.items ?? [];
        const total = response.data.total ?? credentials.length;

        if (credentials.length === 0) {
          return {
            success: true,
            data: {
              content: 'No terminal credentials found.',
              details: { credentials: [], total: 0, user_id },
            },
          };
        }

        const content = credentials
          .map((c) => {
            const parts = [c.name, `(${c.kind})`];
            if (c.fingerprint) parts.push(`fingerprint: ${c.fingerprint}`);
            return `- ${parts.join(' ')}`;
          })
          .join('\n');

        logger.debug('terminal_credential_list completed', { user_id, count: credentials.length });

        return {
          success: true,
          data: {
            content,
            details: { credentials, total, user_id },
          },
        };
      } catch (error) {
        logger.error('terminal_credential_list failed', {
          user_id,
          error: error instanceof Error ? error.message : String(error),
        });
        return { success: false, error: sanitizeErrorMessage(error) };
      }
    },
  };
}

// ==================== terminal_credential_delete ====================

/** Parameters for terminal_credential_delete */
export const TerminalCredentialDeleteParamsSchema = z.object({
  id: z.string().min(1, 'Credential ID is required'),
});
export type TerminalCredentialDeleteParams = z.infer<typeof TerminalCredentialDeleteParamsSchema>;

/** Successful credential delete result */
export interface TerminalCredentialDeleteSuccess {
  success: true;
  data: {
    content: string;
    details: {
      id: string;
      user_id: string;
    };
  };
}

export type TerminalCredentialDeleteResult = TerminalCredentialDeleteSuccess | TerminalConnectionFailure;

export interface TerminalCredentialDeleteTool {
  name: string;
  description: string;
  parameters: typeof TerminalCredentialDeleteParamsSchema;
  execute: (params: TerminalCredentialDeleteParams) => Promise<TerminalCredentialDeleteResult>;
}

/**
 * Creates the terminal_credential_delete tool.
 */
export function createTerminalCredentialDeleteTool(options: TerminalConnectionToolOptions): TerminalCredentialDeleteTool {
  const { client, logger, user_id } = options;

  return {
    name: 'terminal_credential_delete',
    description: 'Delete a terminal credential. The credential will be removed and can no longer be used by connections.',
    parameters: TerminalCredentialDeleteParamsSchema,

    async execute(params: TerminalCredentialDeleteParams): Promise<TerminalCredentialDeleteResult> {
      const parseResult = TerminalCredentialDeleteParamsSchema.safeParse(params);
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
        return { success: false, error: errorMessage };
      }

      const { id } = parseResult.data;

      if (!isValidUuid(id)) {
        return { success: false, error: 'Invalid credential ID format. Expected UUID.' };
      }

      logger.info('terminal_credential_delete invoked', { user_id, credentialId: id });

      try {
        const response = await client.delete<void>(`/api/terminal/credentials/${id}`, { user_id });

        if (!response.success) {
          if (response.error.code === 'NOT_FOUND') {
            return { success: false, error: 'Credential not found.' };
          }
          logger.error('terminal_credential_delete API error', {
            user_id,
            credentialId: id,
            status: response.error.status,
          });
          return { success: false, error: response.error.message || 'Failed to delete credential' };
        }

        logger.debug('terminal_credential_delete completed', { user_id, credentialId: id });

        return {
          success: true,
          data: {
            content: `Credential ${id} deleted.`,
            details: { id, user_id },
          },
        };
      } catch (error) {
        logger.error('terminal_credential_delete failed', {
          user_id,
          credentialId: id,
          error: error instanceof Error ? error.message : String(error),
        });
        return { success: false, error: sanitizeErrorMessage(error) };
      }
    },
  };
}

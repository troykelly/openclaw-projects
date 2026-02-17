/**
 * OAuth Gateway RPC methods for surfacing connected account data to agents.
 * Part of Issue #1054.
 *
 * Registers gateway methods that proxy requests to the openclaw-projects
 * backend API, exposing connected account data (contacts, email, files)
 * in an agent-friendly format with pagination, connectionLabel, and
 * availableActions metadata.
 */

import type { ApiClient } from '../api-client.js';
import type { Logger } from '../logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Backend connection shape returned by /api/oauth/connections. */
interface BackendConnection {
  id: string;
  provider: string;
  label?: string;
  provider_account_email?: string;
  permission_level: string;
  enabled_features: string[];
  is_active: boolean;
  last_sync_at?: string;
  sync_status: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

/** Options for creating OAuth gateway methods. */
export interface OAuthGatewayMethodsOptions {
  logger: Logger;
  apiClient: ApiClient;
  user_id: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build available actions for an account listing based on features and permissions. */
function buildAccountActions(conn: BackendConnection): string[] {
  const actions: string[] = [];
  if (conn.enabled_features.includes('contacts')) {
    actions.push('list_contacts');
  }
  if (conn.enabled_features.includes('email')) {
    actions.push('list_emails', 'get_email');
    if (conn.permission_level === 'read_write') {
      actions.push('send_email', 'create_draft', 'update_email', 'delete_email');
    }
  }
  if (conn.enabled_features.includes('files')) {
    actions.push('list_files', 'search_files', 'get_file');
  }
  if (conn.enabled_features.includes('calendar')) {
    actions.push('list_events');
  }
  return actions;
}

/** Build email-specific available actions based on permission level. */
function buildEmailActions(permission_level: string): string[] {
  const actions = ['list_messages', 'get_message', 'list_threads', 'list_folders'];
  if (permission_level === 'read_write') {
    actions.push('send_email', 'create_draft', 'update_draft', 'update_message', 'delete_message');
  }
  return actions;
}

/** Build file-specific available actions. */
function buildFileActions(): string[] {
  return ['list_files', 'search_files', 'get_file'];
}

/**
 * Resolve a connection by ID from the backend.
 * Returns null with logged warning when not found or inactive.
 */
async function resolveConnection(
  apiClient: ApiClient,
  user_id: string,
  logger: Logger,
  connection_id: string,
): Promise<BackendConnection | null> {
  const response = await apiClient.get<{ connections: BackendConnection[] }>('/api/oauth/connections', { user_id });
  if (!response.success) {
    logger.error('Failed to fetch OAuth connections', { user_id, error: response.error.message });
    return null;
  }

  const conn = response.data.connections.find((c) => c.id === connection_id);
  if (!conn) {
    logger.debug('OAuth connection not found', { user_id, connection_id });
    return null;
  }

  if (!conn.is_active) {
    logger.debug('OAuth connection is disabled', { user_id, connection_id });
    return null;
  }

  return conn;
}

// ---------------------------------------------------------------------------
// Method handlers
// ---------------------------------------------------------------------------

export interface OAuthAccountListParams {
  user_email?: string;
  provider?: string;
}

export interface OAuthAccountListResult {
  accounts: Array<{
    connection_id: string;
    provider: string;
    connectionLabel: string;
    provider_account_email?: string;
    permission_level: string;
    enabled_features: string[];
    is_active: boolean;
    last_sync_at?: string;
    sync_status: Record<string, unknown>;
    availableActions: string[];
  }>;
}

export interface OAuthContactsListParams {
  connection_id: string;
  page_token?: string;
}

export interface OAuthContactsListResult {
  connectionLabel: string;
  contacts: Array<Record<string, unknown>>;
  next_page_token?: string;
  availableActions: string[];
}

export interface OAuthEmailListParams {
  connection_id: string;
  folder_id?: string;
  q?: string;
  max_results?: number;
  page_token?: string;
}

export interface OAuthEmailListResult {
  connectionLabel: string;
  messages: Array<Record<string, unknown>>;
  next_page_token?: string;
  availableActions: string[];
}

export interface OAuthEmailGetParams {
  connection_id: string;
  message_id: string;
}

export interface OAuthEmailGetResult {
  connectionLabel: string;
  message: Record<string, unknown>;
  availableActions: string[];
}

export interface OAuthFilesListParams {
  connection_id: string;
  folder_id?: string;
  page_token?: string;
}

export interface OAuthFilesListResult {
  connectionLabel: string;
  files: Array<Record<string, unknown>>;
  next_page_token?: string;
  availableActions: string[];
}

export interface OAuthFilesSearchParams {
  connection_id: string;
  query: string;
  page_token?: string;
}

export interface OAuthFilesSearchResult {
  connectionLabel: string;
  files: Array<Record<string, unknown>>;
  next_page_token?: string;
  availableActions: string[];
}

export interface OAuthFilesGetParams {
  connection_id: string;
  file_id: string;
}

export interface OAuthFilesGetResult {
  connectionLabel: string;
  file: Record<string, unknown>;
  availableActions: string[];
}

/** All OAuth gateway methods. */
export interface OAuthGatewayMethods {
  accountsList: (params: OAuthAccountListParams) => Promise<OAuthAccountListResult>;
  contactsList: (params: OAuthContactsListParams) => Promise<OAuthContactsListResult>;
  emailList: (params: OAuthEmailListParams) => Promise<OAuthEmailListResult>;
  emailGet: (params: OAuthEmailGetParams) => Promise<OAuthEmailGetResult>;
  filesList: (params: OAuthFilesListParams) => Promise<OAuthFilesListResult>;
  filesSearch: (params: OAuthFilesSearchParams) => Promise<OAuthFilesSearchResult>;
  filesGet: (params: OAuthFilesGetParams) => Promise<OAuthFilesGetResult>;
}

/**
 * Create OAuth gateway RPC method handlers.
 */
export function createOAuthGatewayMethods(options: OAuthGatewayMethodsOptions): OAuthGatewayMethods {
  const { logger, apiClient, user_id } = options;

  return {
    async accountsList(params: OAuthAccountListParams): Promise<OAuthAccountListResult> {
      logger.debug('oauth.accounts.list', { user_id });

      const qs = new URLSearchParams();
      if (params.user_email) qs.set('user_email', params.user_email);
      if (params.provider) qs.set('provider', params.provider);
      const qsStr = qs.toString();
      const path = `/api/oauth/connections${qsStr ? `?${qsStr}` : ''}`;

      const response = await apiClient.get<{ connections: BackendConnection[] }>(path, { user_id });
      if (!response.success) {
        throw new Error(response.error.message || 'Failed to list accounts');
      }

      return {
        accounts: response.data.connections.map((conn) => ({
          connection_id: conn.id,
          provider: conn.provider,
          connectionLabel: conn.label ?? conn.provider,
          provider_account_email: conn.provider_account_email,
          permission_level: conn.permission_level,
          enabled_features: conn.enabled_features,
          is_active: conn.is_active,
          last_sync_at: conn.last_sync_at,
          sync_status: conn.sync_status,
          availableActions: buildAccountActions(conn),
        })),
      };
    },

    async contactsList(params: OAuthContactsListParams): Promise<OAuthContactsListResult> {
      if (!params.connection_id) throw new Error('connection_id is required');

      logger.debug('oauth.contacts.list', { user_id, connection_id: params.connection_id });

      const conn = await resolveConnection(apiClient, user_id, logger, params.connection_id);
      if (!conn) throw new Error('Connection not found or inactive');

      if (!conn.enabled_features.includes('contacts')) {
        throw new Error('Contacts feature is not enabled on this connection');
      }

      const qs = new URLSearchParams({ connection_id: params.connection_id });
      if (params.page_token) qs.set('page_token', params.page_token);

      const response = await apiClient.get<{ contacts: Array<Record<string, unknown>>; next_page_token?: string }>(
        `/api/contacts?${qs}`,
        { user_id },
      );

      if (!response.success) {
        throw new Error(response.error.message || 'Failed to list contacts');
      }

      return {
        connectionLabel: conn.label ?? conn.provider,
        contacts: response.data.contacts ?? [],
        next_page_token: response.data.next_page_token,
        availableActions: ['list_contacts'],
      };
    },

    async emailList(params: OAuthEmailListParams): Promise<OAuthEmailListResult> {
      if (!params.connection_id) throw new Error('connection_id is required');

      logger.debug('oauth.email.list', { user_id, connection_id: params.connection_id });

      const conn = await resolveConnection(apiClient, user_id, logger, params.connection_id);
      if (!conn) throw new Error('Connection not found or inactive');

      if (!conn.enabled_features.includes('email')) {
        throw new Error('Email feature is not enabled on this connection');
      }

      const qs = new URLSearchParams({ connection_id: params.connection_id });
      if (params.folder_id) qs.set('folder_id', params.folder_id);
      if (params.q) qs.set('q', params.q);
      if (params.max_results) qs.set('max_results', String(params.max_results));
      if (params.page_token) qs.set('page_token', params.page_token);

      const response = await apiClient.get<{ messages: Array<Record<string, unknown>>; next_page_token?: string }>(
        `/api/email/messages?${qs}`,
        { user_id },
      );

      if (!response.success) {
        throw new Error(response.error.message || 'Failed to list emails');
      }

      return {
        connectionLabel: conn.label ?? conn.provider,
        messages: response.data.messages ?? [],
        next_page_token: response.data.next_page_token,
        availableActions: buildEmailActions(conn.permission_level),
      };
    },

    async emailGet(params: OAuthEmailGetParams): Promise<OAuthEmailGetResult> {
      if (!params.connection_id) throw new Error('connection_id is required');
      if (!params.message_id) throw new Error('message_id is required');

      logger.debug('oauth.email.get', { user_id, connection_id: params.connection_id, message_id: params.message_id });

      const conn = await resolveConnection(apiClient, user_id, logger, params.connection_id);
      if (!conn) throw new Error('Connection not found or inactive');

      if (!conn.enabled_features.includes('email')) {
        throw new Error('Email feature is not enabled on this connection');
      }

      const qs = new URLSearchParams({ connection_id: params.connection_id });
      const response = await apiClient.get<Record<string, unknown>>(
        `/api/email/messages/${encodeURIComponent(params.message_id)}?${qs}`,
        { user_id },
      );

      if (!response.success) {
        throw new Error(response.error.message || 'Failed to get email');
      }

      return {
        connectionLabel: conn.label ?? conn.provider,
        message: response.data,
        availableActions: buildEmailActions(conn.permission_level),
      };
    },

    async filesList(params: OAuthFilesListParams): Promise<OAuthFilesListResult> {
      if (!params.connection_id) throw new Error('connection_id is required');

      logger.debug('oauth.files.list', { user_id, connection_id: params.connection_id });

      const conn = await resolveConnection(apiClient, user_id, logger, params.connection_id);
      if (!conn) throw new Error('Connection not found or inactive');

      if (!conn.enabled_features.includes('files')) {
        throw new Error('Files feature is not enabled on this connection');
      }

      const qs = new URLSearchParams({ connection_id: params.connection_id });
      if (params.folder_id) qs.set('folder_id', params.folder_id);
      if (params.page_token) qs.set('page_token', params.page_token);

      const response = await apiClient.get<{ files: Array<Record<string, unknown>>; next_page_token?: string }>(
        `/api/drive/files?${qs}`,
        { user_id },
      );

      if (!response.success) {
        throw new Error(response.error.message || 'Failed to list files');
      }

      return {
        connectionLabel: conn.label ?? conn.provider,
        files: response.data.files ?? [],
        next_page_token: response.data.next_page_token,
        availableActions: buildFileActions(),
      };
    },

    async filesSearch(params: OAuthFilesSearchParams): Promise<OAuthFilesSearchResult> {
      if (!params.connection_id) throw new Error('connection_id is required');
      if (!params.query) throw new Error('query is required');

      logger.debug('oauth.files.search', { user_id, connection_id: params.connection_id });

      const conn = await resolveConnection(apiClient, user_id, logger, params.connection_id);
      if (!conn) throw new Error('Connection not found or inactive');

      if (!conn.enabled_features.includes('files')) {
        throw new Error('Files feature is not enabled on this connection');
      }

      const qs = new URLSearchParams({ connection_id: params.connection_id, q: params.query });
      if (params.page_token) qs.set('page_token', params.page_token);

      const response = await apiClient.get<{ files: Array<Record<string, unknown>>; next_page_token?: string }>(
        `/api/drive/files/search?${qs}`,
        { user_id },
      );

      if (!response.success) {
        throw new Error(response.error.message || 'Failed to search files');
      }

      return {
        connectionLabel: conn.label ?? conn.provider,
        files: response.data.files ?? [],
        next_page_token: response.data.next_page_token,
        availableActions: buildFileActions(),
      };
    },

    async filesGet(params: OAuthFilesGetParams): Promise<OAuthFilesGetResult> {
      if (!params.connection_id) throw new Error('connection_id is required');
      if (!params.file_id) throw new Error('file_id is required');

      logger.debug('oauth.files.get', { user_id, connection_id: params.connection_id, file_id: params.file_id });

      const conn = await resolveConnection(apiClient, user_id, logger, params.connection_id);
      if (!conn) throw new Error('Connection not found or inactive');

      if (!conn.enabled_features.includes('files')) {
        throw new Error('Files feature is not enabled on this connection');
      }

      const qs = new URLSearchParams({ connection_id: params.connection_id });
      const response = await apiClient.get<Record<string, unknown>>(
        `/api/drive/files/${encodeURIComponent(params.file_id)}?${qs}`,
        { user_id },
      );

      if (!response.success) {
        throw new Error(response.error.message || 'Failed to get file');
      }

      return {
        connectionLabel: conn.label ?? conn.provider,
        file: response.data,
        availableActions: buildFileActions(),
      };
    },
  };
}

/**
 * Register OAuth gateway RPC methods with the OpenClaw plugin API.
 */
export function registerOAuthGatewayRpcMethods(
  api: {
    registerGatewayMethod: <T, R>(name: string, handler: (params: T) => Promise<R>) => void;
  },
  methods: OAuthGatewayMethods,
): void {
  api.registerGatewayMethod<OAuthAccountListParams, OAuthAccountListResult>(
    'oauth.accounts.list',
    methods.accountsList,
  );
  api.registerGatewayMethod<OAuthContactsListParams, OAuthContactsListResult>(
    'oauth.contacts.list',
    methods.contactsList,
  );
  api.registerGatewayMethod<OAuthEmailListParams, OAuthEmailListResult>(
    'oauth.email.list',
    methods.emailList,
  );
  api.registerGatewayMethod<OAuthEmailGetParams, OAuthEmailGetResult>(
    'oauth.email.get',
    methods.emailGet,
  );
  api.registerGatewayMethod<OAuthFilesListParams, OAuthFilesListResult>(
    'oauth.files.list',
    methods.filesList,
  );
  api.registerGatewayMethod<OAuthFilesSearchParams, OAuthFilesSearchResult>(
    'oauth.files.search',
    methods.filesSearch,
  );
  api.registerGatewayMethod<OAuthFilesGetParams, OAuthFilesGetResult>(
    'oauth.files.get',
    methods.filesGet,
  );
}

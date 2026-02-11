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
  providerAccountEmail?: string;
  permissionLevel: string;
  enabledFeatures: string[];
  isActive: boolean;
  lastSyncAt?: string;
  syncStatus: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

/** Options for creating OAuth gateway methods. */
export interface OAuthGatewayMethodsOptions {
  logger: Logger;
  apiClient: ApiClient;
  userId: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build available actions for an account listing based on features and permissions. */
function buildAccountActions(conn: BackendConnection): string[] {
  const actions: string[] = [];
  if (conn.enabledFeatures.includes('contacts')) {
    actions.push('list_contacts');
  }
  if (conn.enabledFeatures.includes('email')) {
    actions.push('list_emails', 'get_email');
    if (conn.permissionLevel === 'read_write') {
      actions.push('send_email', 'create_draft', 'update_email', 'delete_email');
    }
  }
  if (conn.enabledFeatures.includes('files')) {
    actions.push('list_files', 'search_files', 'get_file');
  }
  if (conn.enabledFeatures.includes('calendar')) {
    actions.push('list_events');
  }
  return actions;
}

/** Build email-specific available actions based on permission level. */
function buildEmailActions(permissionLevel: string): string[] {
  const actions = ['list_messages', 'get_message', 'list_threads', 'list_folders'];
  if (permissionLevel === 'read_write') {
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
  userId: string,
  logger: Logger,
  connectionId: string,
): Promise<BackendConnection | null> {
  const response = await apiClient.get<{ connections: BackendConnection[] }>('/api/oauth/connections', { userId });
  if (!response.success) {
    logger.error('Failed to fetch OAuth connections', { userId, error: response.error.message });
    return null;
  }

  const conn = response.data.connections.find((c) => c.id === connectionId);
  if (!conn) {
    logger.debug('OAuth connection not found', { userId, connectionId });
    return null;
  }

  if (!conn.isActive) {
    logger.debug('OAuth connection is disabled', { userId, connectionId });
    return null;
  }

  return conn;
}

// ---------------------------------------------------------------------------
// Method handlers
// ---------------------------------------------------------------------------

export interface OAuthAccountListParams {
  userEmail?: string;
  provider?: string;
}

export interface OAuthAccountListResult {
  accounts: Array<{
    connectionId: string;
    provider: string;
    connectionLabel: string;
    providerAccountEmail?: string;
    permissionLevel: string;
    enabledFeatures: string[];
    isActive: boolean;
    lastSyncAt?: string;
    syncStatus: Record<string, unknown>;
    availableActions: string[];
  }>;
}

export interface OAuthContactsListParams {
  connectionId: string;
  pageToken?: string;
}

export interface OAuthContactsListResult {
  connectionLabel: string;
  contacts: Array<Record<string, unknown>>;
  nextPageToken?: string;
  availableActions: string[];
}

export interface OAuthEmailListParams {
  connectionId: string;
  folderId?: string;
  q?: string;
  maxResults?: number;
  pageToken?: string;
}

export interface OAuthEmailListResult {
  connectionLabel: string;
  messages: Array<Record<string, unknown>>;
  nextPageToken?: string;
  availableActions: string[];
}

export interface OAuthEmailGetParams {
  connectionId: string;
  messageId: string;
}

export interface OAuthEmailGetResult {
  connectionLabel: string;
  message: Record<string, unknown>;
  availableActions: string[];
}

export interface OAuthFilesListParams {
  connectionId: string;
  folderId?: string;
  pageToken?: string;
}

export interface OAuthFilesListResult {
  connectionLabel: string;
  files: Array<Record<string, unknown>>;
  nextPageToken?: string;
  availableActions: string[];
}

export interface OAuthFilesSearchParams {
  connectionId: string;
  query: string;
  pageToken?: string;
}

export interface OAuthFilesSearchResult {
  connectionLabel: string;
  files: Array<Record<string, unknown>>;
  nextPageToken?: string;
  availableActions: string[];
}

export interface OAuthFilesGetParams {
  connectionId: string;
  fileId: string;
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
  const { logger, apiClient, userId } = options;

  return {
    async accountsList(params: OAuthAccountListParams): Promise<OAuthAccountListResult> {
      logger.debug('oauth.accounts.list', { userId });

      const qs = new URLSearchParams();
      if (params.userEmail) qs.set('userEmail', params.userEmail);
      if (params.provider) qs.set('provider', params.provider);
      const qsStr = qs.toString();
      const path = `/api/oauth/connections${qsStr ? `?${qsStr}` : ''}`;

      const response = await apiClient.get<{ connections: BackendConnection[] }>(path, { userId });
      if (!response.success) {
        throw new Error(response.error.message || 'Failed to list accounts');
      }

      return {
        accounts: response.data.connections.map((conn) => ({
          connectionId: conn.id,
          provider: conn.provider,
          connectionLabel: conn.label ?? conn.provider,
          providerAccountEmail: conn.providerAccountEmail,
          permissionLevel: conn.permissionLevel,
          enabledFeatures: conn.enabledFeatures,
          isActive: conn.isActive,
          lastSyncAt: conn.lastSyncAt,
          syncStatus: conn.syncStatus,
          availableActions: buildAccountActions(conn),
        })),
      };
    },

    async contactsList(params: OAuthContactsListParams): Promise<OAuthContactsListResult> {
      if (!params.connectionId) throw new Error('connectionId is required');

      logger.debug('oauth.contacts.list', { userId, connectionId: params.connectionId });

      const conn = await resolveConnection(apiClient, userId, logger, params.connectionId);
      if (!conn) throw new Error('Connection not found or inactive');

      if (!conn.enabledFeatures.includes('contacts')) {
        throw new Error('Contacts feature is not enabled on this connection');
      }

      const qs = new URLSearchParams({ connectionId: params.connectionId });
      if (params.pageToken) qs.set('pageToken', params.pageToken);

      const response = await apiClient.get<{ contacts: Array<Record<string, unknown>>; nextPageToken?: string }>(
        `/api/contacts?${qs}`,
        { userId },
      );

      if (!response.success) {
        throw new Error(response.error.message || 'Failed to list contacts');
      }

      return {
        connectionLabel: conn.label ?? conn.provider,
        contacts: response.data.contacts ?? [],
        nextPageToken: response.data.nextPageToken,
        availableActions: ['list_contacts'],
      };
    },

    async emailList(params: OAuthEmailListParams): Promise<OAuthEmailListResult> {
      if (!params.connectionId) throw new Error('connectionId is required');

      logger.debug('oauth.email.list', { userId, connectionId: params.connectionId });

      const conn = await resolveConnection(apiClient, userId, logger, params.connectionId);
      if (!conn) throw new Error('Connection not found or inactive');

      if (!conn.enabledFeatures.includes('email')) {
        throw new Error('Email feature is not enabled on this connection');
      }

      const qs = new URLSearchParams({ connectionId: params.connectionId });
      if (params.folderId) qs.set('folderId', params.folderId);
      if (params.q) qs.set('q', params.q);
      if (params.maxResults) qs.set('maxResults', String(params.maxResults));
      if (params.pageToken) qs.set('pageToken', params.pageToken);

      const response = await apiClient.get<{ messages: Array<Record<string, unknown>>; nextPageToken?: string }>(
        `/api/email/messages?${qs}`,
        { userId },
      );

      if (!response.success) {
        throw new Error(response.error.message || 'Failed to list emails');
      }

      return {
        connectionLabel: conn.label ?? conn.provider,
        messages: response.data.messages ?? [],
        nextPageToken: response.data.nextPageToken,
        availableActions: buildEmailActions(conn.permissionLevel),
      };
    },

    async emailGet(params: OAuthEmailGetParams): Promise<OAuthEmailGetResult> {
      if (!params.connectionId) throw new Error('connectionId is required');
      if (!params.messageId) throw new Error('messageId is required');

      logger.debug('oauth.email.get', { userId, connectionId: params.connectionId, messageId: params.messageId });

      const conn = await resolveConnection(apiClient, userId, logger, params.connectionId);
      if (!conn) throw new Error('Connection not found or inactive');

      if (!conn.enabledFeatures.includes('email')) {
        throw new Error('Email feature is not enabled on this connection');
      }

      const qs = new URLSearchParams({ connectionId: params.connectionId });
      const response = await apiClient.get<Record<string, unknown>>(
        `/api/email/messages/${encodeURIComponent(params.messageId)}?${qs}`,
        { userId },
      );

      if (!response.success) {
        throw new Error(response.error.message || 'Failed to get email');
      }

      return {
        connectionLabel: conn.label ?? conn.provider,
        message: response.data,
        availableActions: buildEmailActions(conn.permissionLevel),
      };
    },

    async filesList(params: OAuthFilesListParams): Promise<OAuthFilesListResult> {
      if (!params.connectionId) throw new Error('connectionId is required');

      logger.debug('oauth.files.list', { userId, connectionId: params.connectionId });

      const conn = await resolveConnection(apiClient, userId, logger, params.connectionId);
      if (!conn) throw new Error('Connection not found or inactive');

      if (!conn.enabledFeatures.includes('files')) {
        throw new Error('Files feature is not enabled on this connection');
      }

      const qs = new URLSearchParams({ connectionId: params.connectionId });
      if (params.folderId) qs.set('folderId', params.folderId);
      if (params.pageToken) qs.set('pageToken', params.pageToken);

      const response = await apiClient.get<{ files: Array<Record<string, unknown>>; nextPageToken?: string }>(
        `/api/drive/files?${qs}`,
        { userId },
      );

      if (!response.success) {
        throw new Error(response.error.message || 'Failed to list files');
      }

      return {
        connectionLabel: conn.label ?? conn.provider,
        files: response.data.files ?? [],
        nextPageToken: response.data.nextPageToken,
        availableActions: buildFileActions(),
      };
    },

    async filesSearch(params: OAuthFilesSearchParams): Promise<OAuthFilesSearchResult> {
      if (!params.connectionId) throw new Error('connectionId is required');
      if (!params.query) throw new Error('query is required');

      logger.debug('oauth.files.search', { userId, connectionId: params.connectionId });

      const conn = await resolveConnection(apiClient, userId, logger, params.connectionId);
      if (!conn) throw new Error('Connection not found or inactive');

      if (!conn.enabledFeatures.includes('files')) {
        throw new Error('Files feature is not enabled on this connection');
      }

      const qs = new URLSearchParams({ connectionId: params.connectionId, q: params.query });
      if (params.pageToken) qs.set('pageToken', params.pageToken);

      const response = await apiClient.get<{ files: Array<Record<string, unknown>>; nextPageToken?: string }>(
        `/api/drive/files/search?${qs}`,
        { userId },
      );

      if (!response.success) {
        throw new Error(response.error.message || 'Failed to search files');
      }

      return {
        connectionLabel: conn.label ?? conn.provider,
        files: response.data.files ?? [],
        nextPageToken: response.data.nextPageToken,
        availableActions: buildFileActions(),
      };
    },

    async filesGet(params: OAuthFilesGetParams): Promise<OAuthFilesGetResult> {
      if (!params.connectionId) throw new Error('connectionId is required');
      if (!params.fileId) throw new Error('fileId is required');

      logger.debug('oauth.files.get', { userId, connectionId: params.connectionId, fileId: params.fileId });

      const conn = await resolveConnection(apiClient, userId, logger, params.connectionId);
      if (!conn) throw new Error('Connection not found or inactive');

      if (!conn.enabledFeatures.includes('files')) {
        throw new Error('Files feature is not enabled on this connection');
      }

      const qs = new URLSearchParams({ connectionId: params.connectionId });
      const response = await apiClient.get<Record<string, unknown>>(
        `/api/drive/files/${encodeURIComponent(params.fileId)}?${qs}`,
        { userId },
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

/**
 * OAuth Gateway RPC methods for surfacing connected account data to agents.
 * Part of Issue #1054.
 *
 * Registers gateway methods that proxy requests to the openclaw-projects
 * backend API, exposing connected account data (contacts, email, files)
 * in an agent-friendly format with pagination, connection_label, and
 * available_actions metadata.
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
  getUserId: () => string;
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
    actions.push('list_events', 'sync_calendar');
    if (conn.permission_level === 'read_write') {
      actions.push('create_event', 'delete_event');
    }
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

/** Build calendar-specific available actions based on permission level. */
function buildCalendarActions(permission_level: string): string[] {
  const actions = ['list_events', 'sync_calendar'];
  if (permission_level === 'read_write') {
    actions.push('create_event', 'delete_event');
  }
  return actions;
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
    connection_label: string;
    provider_account_email?: string;
    permission_level: string;
    enabled_features: string[];
    is_active: boolean;
    last_sync_at?: string;
    sync_status: Record<string, unknown>;
    available_actions: string[];
  }>;
}

export interface OAuthContactsListParams {
  connection_id: string;
  page_token?: string;
}

export interface OAuthContactsListResult {
  connection_label: string;
  contacts: Array<Record<string, unknown>>;
  next_page_token?: string;
  available_actions: string[];
}

export interface OAuthEmailListParams {
  connection_id: string;
  folder_id?: string;
  q?: string;
  max_results?: number;
  page_token?: string;
}

export interface OAuthEmailListResult {
  connection_label: string;
  messages: Array<Record<string, unknown>>;
  next_page_token?: string;
  available_actions: string[];
}

export interface OAuthEmailGetParams {
  connection_id: string;
  message_id: string;
}

export interface OAuthEmailGetResult {
  connection_label: string;
  message: Record<string, unknown>;
  available_actions: string[];
}

export interface OAuthFilesListParams {
  connection_id: string;
  folder_id?: string;
  page_token?: string;
}

export interface OAuthFilesListResult {
  connection_label: string;
  files: Array<Record<string, unknown>>;
  next_page_token?: string;
  available_actions: string[];
}

export interface OAuthFilesSearchParams {
  connection_id: string;
  query: string;
  page_token?: string;
}

export interface OAuthFilesSearchResult {
  connection_label: string;
  files: Array<Record<string, unknown>>;
  next_page_token?: string;
  available_actions: string[];
}

export interface OAuthFilesGetParams {
  connection_id: string;
  file_id: string;
}

export interface OAuthFilesGetResult {
  connection_label: string;
  file: Record<string, unknown>;
  available_actions: string[];
}

export interface OAuthCalendarListParams {
  connection_id: string;
  time_min?: string;
  time_max?: string;
  max_results?: number;
  page_token?: string;
}

export interface OAuthCalendarListResult {
  connection_label: string;
  events: Array<Record<string, unknown>>;
  next_page_token?: string;
  available_actions: string[];
}

export interface OAuthCalendarSyncParams {
  connection_id: string;
  time_min?: string;
  time_max?: string;
}

export interface OAuthCalendarSyncResult {
  connection_label: string;
  [key: string]: unknown;
}

export interface OAuthCalendarCreateParams {
  connection_id: string;
  title: string;
  description?: string;
  location?: string;
  all_day?: boolean;
  start_time?: string;
  end_time?: string;
}

export interface OAuthCalendarCreateResult {
  connection_label: string;
  event: Record<string, unknown>;
  available_actions: string[];
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
  calendarList: (params: OAuthCalendarListParams) => Promise<OAuthCalendarListResult>;
  calendarSync: (params: OAuthCalendarSyncParams) => Promise<OAuthCalendarSyncResult>;
  calendarCreate: (params: OAuthCalendarCreateParams) => Promise<OAuthCalendarCreateResult>;
}

/**
 * Create OAuth gateway RPC method handlers.
 */
export function createOAuthGatewayMethods(options: OAuthGatewayMethodsOptions): OAuthGatewayMethods {
  const { logger, apiClient, getUserId } = options;

  return {
    async accountsList(params: OAuthAccountListParams): Promise<OAuthAccountListResult> {
      const user_id = getUserId();
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
          connection_label: conn.label ?? conn.provider,
          provider_account_email: conn.provider_account_email,
          permission_level: conn.permission_level,
          enabled_features: conn.enabled_features,
          is_active: conn.is_active,
          last_sync_at: conn.last_sync_at,
          sync_status: conn.sync_status,
          available_actions: buildAccountActions(conn),
        })),
      };
    },

    async contactsList(params: OAuthContactsListParams): Promise<OAuthContactsListResult> {
      if (!params.connection_id) throw new Error('connection_id is required');
      const user_id = getUserId();

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
        connection_label: conn.label ?? conn.provider,
        contacts: response.data.contacts ?? [],
        next_page_token: response.data.next_page_token,
        available_actions: ['list_contacts'],
      };
    },

    async emailList(params: OAuthEmailListParams): Promise<OAuthEmailListResult> {
      if (!params.connection_id) throw new Error('connection_id is required');
      const user_id = getUserId();

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
        connection_label: conn.label ?? conn.provider,
        messages: response.data.messages ?? [],
        next_page_token: response.data.next_page_token,
        available_actions: buildEmailActions(conn.permission_level),
      };
    },

    async emailGet(params: OAuthEmailGetParams): Promise<OAuthEmailGetResult> {
      if (!params.connection_id) throw new Error('connection_id is required');
      if (!params.message_id) throw new Error('message_id is required');
      const user_id = getUserId();

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
        connection_label: conn.label ?? conn.provider,
        message: response.data,
        available_actions: buildEmailActions(conn.permission_level),
      };
    },

    async filesList(params: OAuthFilesListParams): Promise<OAuthFilesListResult> {
      if (!params.connection_id) throw new Error('connection_id is required');
      const user_id = getUserId();

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
        connection_label: conn.label ?? conn.provider,
        files: response.data.files ?? [],
        next_page_token: response.data.next_page_token,
        available_actions: buildFileActions(),
      };
    },

    async filesSearch(params: OAuthFilesSearchParams): Promise<OAuthFilesSearchResult> {
      if (!params.connection_id) throw new Error('connection_id is required');
      if (!params.query) throw new Error('query is required');
      const user_id = getUserId();

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
        connection_label: conn.label ?? conn.provider,
        files: response.data.files ?? [],
        next_page_token: response.data.next_page_token,
        available_actions: buildFileActions(),
      };
    },

    async filesGet(params: OAuthFilesGetParams): Promise<OAuthFilesGetResult> {
      if (!params.connection_id) throw new Error('connection_id is required');
      if (!params.file_id) throw new Error('file_id is required');
      const user_id = getUserId();

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
        connection_label: conn.label ?? conn.provider,
        file: response.data,
        available_actions: buildFileActions(),
      };
    },

    async calendarList(params: OAuthCalendarListParams): Promise<OAuthCalendarListResult> {
      if (!params.connection_id) throw new Error('connection_id is required');
      const user_id = getUserId();

      logger.debug('oauth.calendar.list', { user_id, connection_id: params.connection_id });

      const conn = await resolveConnection(apiClient, user_id, logger, params.connection_id);
      if (!conn) throw new Error('Connection not found or inactive');

      if (!conn.enabled_features.includes('calendar')) {
        throw new Error('Calendar feature is not enabled on this connection');
      }

      const qs = new URLSearchParams({ connection_id: params.connection_id });
      if (params.time_min) qs.set('time_min', params.time_min);
      if (params.time_max) qs.set('time_max', params.time_max);
      if (params.max_results) qs.set('max_results', String(params.max_results));
      if (params.page_token) qs.set('page_token', params.page_token);

      const response = await apiClient.get<{ events: Array<Record<string, unknown>>; next_page_token?: string }>(
        `/api/calendar/events/live?${qs}`,
        { user_id },
      );

      if (!response.success) {
        throw new Error(response.error.message || 'Failed to list calendar events');
      }

      return {
        connection_label: conn.label ?? conn.provider,
        events: response.data.events ?? [],
        next_page_token: response.data.next_page_token,
        available_actions: buildCalendarActions(conn.permission_level),
      };
    },

    async calendarSync(params: OAuthCalendarSyncParams): Promise<OAuthCalendarSyncResult> {
      if (!params.connection_id) throw new Error('connection_id is required');
      const user_id = getUserId();

      logger.debug('oauth.calendar.sync', { user_id, connection_id: params.connection_id });

      const conn = await resolveConnection(apiClient, user_id, logger, params.connection_id);
      if (!conn) throw new Error('Connection not found or inactive');

      if (!conn.enabled_features.includes('calendar')) {
        throw new Error('Calendar feature is not enabled on this connection');
      }

      const body: Record<string, unknown> = { connection_id: params.connection_id };
      if (params.time_min) body.time_min = params.time_min;
      if (params.time_max) body.time_max = params.time_max;

      const response = await apiClient.post<Record<string, unknown>>(
        '/api/sync/calendar',
        body,
        { user_id },
      );

      if (!response.success) {
        throw new Error(response.error.message || 'Failed to sync calendar');
      }

      return {
        connection_label: conn.label ?? conn.provider,
        ...response.data,
      };
    },

    async calendarCreate(params: OAuthCalendarCreateParams): Promise<OAuthCalendarCreateResult> {
      if (!params.connection_id) throw new Error('connection_id is required');
      if (!params.title) throw new Error('title is required');
      const user_id = getUserId();

      logger.debug('oauth.calendar.create', { user_id, connection_id: params.connection_id });

      const conn = await resolveConnection(apiClient, user_id, logger, params.connection_id);
      if (!conn) throw new Error('Connection not found or inactive');

      if (!conn.enabled_features.includes('calendar')) {
        throw new Error('Calendar feature is not enabled on this connection');
      }

      if (conn.permission_level !== 'read_write') {
        throw new Error('Write permission required to create events');
      }

      const body: Record<string, unknown> = {
        connection_id: params.connection_id,
        user_email: conn.provider_account_email ?? '',
        provider: conn.provider,
        title: params.title,
        start_time: params.start_time,
        end_time: params.end_time,
      };
      if (params.description !== undefined) body.description = params.description;
      if (params.location !== undefined) body.location = params.location;
      if (params.all_day !== undefined) body.all_day = params.all_day;

      const response = await apiClient.post<{ event: Record<string, unknown> }>(
        '/api/calendar/events',
        body,
        { user_id },
      );

      if (!response.success) {
        throw new Error(response.error.message || 'Failed to create calendar event');
      }

      return {
        connection_label: conn.label ?? conn.provider,
        event: response.data.event,
        available_actions: buildCalendarActions(conn.permission_level),
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
  api.registerGatewayMethod<OAuthCalendarListParams, OAuthCalendarListResult>(
    'oauth.calendar.list',
    methods.calendarList,
  );
  api.registerGatewayMethod<OAuthCalendarSyncParams, OAuthCalendarSyncResult>(
    'oauth.calendar.sync',
    methods.calendarSync,
  );
  api.registerGatewayMethod<OAuthCalendarCreateParams, OAuthCalendarCreateResult>(
    'oauth.calendar.create',
    methods.calendarCreate,
  );
}

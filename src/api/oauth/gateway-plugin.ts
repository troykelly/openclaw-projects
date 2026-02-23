/**
 * OpenClaw Gateway plugin that surfaces OAuth account data to agents.
 * Part of Issue #1054.
 *
 * Registers gateway methods that proxy requests to the openclaw-projects
 * backend API, exposing connected account data (contacts, email, files)
 * in an agent-friendly format with pagination, connection_label, and
 * available_actions metadata.
 *
 * Gateway methods registered:
 *   oauth.accounts.list    — List connected accounts with metadata
 *   oauth.contacts.list    — Contacts from a specific connection
 *   oauth.email.list       — Emails from a specific connection
 *   oauth.email.get        — Single email message by ID
 *   oauth.files.list       — Files/folders from a specific connection
 *   oauth.files.search     — Search files across a connection
 *   oauth.files.get        — Single file metadata with download URL
 *   oauth.calendar.list    — Calendar events from a connection (Issue #1362)
 *   oauth.calendar.sync    — Sync calendar events from provider (Issue #1362)
 *   oauth.calendar.create  — Create a calendar event (Issue #1362)
 *
 * NOTE (Issue #1610): The base methods (accounts, contacts, email, files) are
 * also implemented in the plugin package at
 * `packages/openclaw-plugin/src/gateway/oauth-rpc-methods.ts`, which is the
 * canonical registration path used by `register-openclaw.ts`. The calendar
 * methods (oauth.calendar.*) exist ONLY in this file and have not yet been
 * ported to the plugin package. See the follow-up issue created from #1610
 * for tracking that migration (Issue #1630).
 *
 * This file is retained as the reference implementation and for standalone
 * gateway deployments that import directly from the backend source.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Plugin configuration passed via pluginConfig. */
export interface OAuthGatewayPluginConfig {
  /** Base URL of the openclaw-projects backend (e.g. http://localhost:3001). */
  backendUrl: string;
  /** Optional API key / bearer token for authenticating to the backend. */
  apiKey?: string;
}

/** Minimal representation of an OAuth connection from the backend. */
interface BackendConnection {
  id: string;
  user_email?: string;
  provider: string;
  label: string;
  provider_account_email?: string;
  permission_level: string;
  enabled_features: string[];
  is_active: boolean;
  last_sync_at?: string;
  sync_status: Record<string, unknown>;
  scopes?: string[];
  created_at: string;
  updated_at: string;
}

/** Minimal plugin API surface — only the parts we use. */
interface PluginApi {
  id: string;
  name: string;
  pluginConfig?: Record<string, unknown>;
  logger: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
    debug?: (msg: string) => void;
  };
  registerGatewayMethod: (
    method: string,
    handler: (opts: { params: Record<string, unknown>; respond: (ok: boolean, payload?: unknown) => void }) => void | Promise<void>,
  ) => void;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build available actions based on enabled features and permission level. */
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
 * Make an HTTP request to the backend API.
 * Handles JSON parsing, error responses, and network failures.
 */
async function backendFetch(
  baseUrl: string,
  path: string,
  apiKey?: string,
): Promise<{ ok: true; data: unknown } | { ok: false; error: string; status?: number }> {
  const url = `${baseUrl.replace(/\/+$/, '')}${path}`;
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  try {
    const response = await fetch(url, { headers });
    const data = await response.json();

    if (!response.ok) {
      const errorMsg = (data as Record<string, unknown>)?.error;
      return {
        ok: false,
        error: typeof errorMsg === 'string' ? errorMsg : `Backend returned ${response.status}`,
        status: response.status,
      };
    }

    return { ok: true, data };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

type RespondFn = (ok: boolean, payload?: unknown) => void;

/** Validate that a string param is present; respond with error if not. */
function requireParam(params: Record<string, unknown>, name: string, respond: RespondFn): string | null {
  const value = typeof params[name] === 'string' ? (params[name] as string).trim() : '';
  if (!value) {
    respond(false, { error: `${name} is required` });
    return null;
  }
  return value;
}

/**
 * Resolve a connection by ID: fetches the connection list from the backend
 * and finds the matching entry. Returns the connection or responds with error.
 */
async function resolveConnection(baseUrl: string, apiKey: string | undefined, connection_id: string, respond: RespondFn): Promise<BackendConnection | null> {
  // We fetch all connections and filter — this keeps the plugin simple.
  // For large connection counts a dedicated endpoint would be better.
  const result = await backendFetch(baseUrl, '/api/oauth/connections');
  if (!result.ok) {
    respond(false, { error: result.error });
    return null;
  }

  const connections = ((result.data as Record<string, unknown>).connections as BackendConnection[]) ?? [];
  const conn = connections.find((c) => c.id === connection_id);
  if (!conn) {
    respond(false, { error: `Connection ${connection_id} not found` });
    return null;
  }

  if (!conn.is_active) {
    respond(false, { error: `Connection ${connection_id} is disabled` });
    return null;
  }

  return conn;
}

// ---------------------------------------------------------------------------
// Plugin factory
// ---------------------------------------------------------------------------

/**
 * Create the OAuth gateway plugin definition.
 *
 * Usage in the gateway's plugin loader / default registry:
 * ```ts
 * import { createOAuthGatewayPlugin } from 'openclaw-projects/src/api/oauth/gateway-plugin';
 * registry.register(createOAuthGatewayPlugin());
 * ```
 */
export function createOAuthGatewayPlugin() {
  return {
    id: 'oauth-accounts',
    name: 'OAuth Connected Accounts',
    description: 'Surfaces OAuth-connected account data (contacts, email, files) to OpenClaw agents via gateway methods.',
    version: '1.0.0',

    register(api: PluginApi) {
      const config = (api.pluginConfig ?? {}) as Partial<OAuthGatewayPluginConfig>;
      const backendUrl = config.backendUrl;
      const apiKey = config.apiKey;

      if (!backendUrl) {
        api.logger.warn('[oauth-accounts] backendUrl not configured; gateway methods will not be registered');
        return;
      }

      api.logger.info(`[oauth-accounts] Registering gateway methods (backend: ${backendUrl})`);

      // -------------------------------------------------------------------
      // oauth.accounts.list — List all connected accounts
      // -------------------------------------------------------------------
      api.registerGatewayMethod('oauth.accounts.list', async ({ params, respond }) => {
        const user_email = typeof params.user_email === 'string' ? params.user_email : undefined;
        const provider = typeof params.provider === 'string' ? params.provider : undefined;

        const qs = new URLSearchParams();
        if (user_email) qs.set('user_email', user_email);
        if (provider) qs.set('provider', provider);

        const qsStr = qs.toString();
        const path = `/api/oauth/connections${qsStr ? `?${qsStr}` : ''}`;

        const result = await backendFetch(backendUrl, path, apiKey);
        if (!result.ok) {
          respond(false, { error: result.error });
          return;
        }

        const connections = ((result.data as Record<string, unknown>).connections as BackendConnection[]) ?? [];

        respond(true, {
          accounts: connections.map((conn) => ({
            connection_id: conn.id,
            provider: conn.provider,
            connection_label: conn.label,
            provider_account_email: conn.provider_account_email,
            permission_level: conn.permission_level,
            enabled_features: conn.enabled_features,
            is_active: conn.is_active,
            last_sync_at: conn.last_sync_at,
            sync_status: conn.sync_status,
            created_at: conn.created_at,
            updated_at: conn.updated_at,
            available_actions: buildAccountActions(conn),
          })),
        });
      });

      // -------------------------------------------------------------------
      // oauth.contacts.list — Contacts from a specific connection
      // -------------------------------------------------------------------
      api.registerGatewayMethod('oauth.contacts.list', async ({ params, respond }) => {
        const connection_id = requireParam(params, 'connection_id', respond);
        if (!connection_id) return;

        const conn = await resolveConnection(backendUrl, apiKey, connection_id, respond);
        if (!conn) return;

        if (!conn.enabled_features.includes('contacts')) {
          respond(false, { error: 'Contacts feature is not enabled on this connection' });
          return;
        }

        const qs = new URLSearchParams({ connection_id });
        const page_token = typeof params.page_token === 'string' ? params.page_token : undefined;
        if (page_token) qs.set('page_token', page_token);

        const result = await backendFetch(backendUrl, `/api/contacts?${qs.toString()}`, apiKey);
        if (!result.ok) {
          respond(false, { error: result.error });
          return;
        }

        const data = result.data as Record<string, unknown>;

        respond(true, {
          connection_label: conn.label,
          connection_id: conn.id,
          provider: conn.provider,
          contacts: data.contacts ?? [],
          next_page_token: data.next_page_token,
          available_actions: ['list_contacts'],
        });
      });

      // -------------------------------------------------------------------
      // oauth.email.list — List or search emails
      // -------------------------------------------------------------------
      api.registerGatewayMethod('oauth.email.list', async ({ params, respond }) => {
        const connection_id = requireParam(params, 'connection_id', respond);
        if (!connection_id) return;

        const conn = await resolveConnection(backendUrl, apiKey, connection_id, respond);
        if (!conn) return;

        if (!conn.enabled_features.includes('email')) {
          respond(false, { error: 'Email feature is not enabled on this connection' });
          return;
        }

        const qs = new URLSearchParams({ connection_id });
        if (typeof params.query === 'string') qs.set('query', params.query);
        if (typeof params.folder_id === 'string') qs.set('folder_id', params.folder_id);
        if (typeof params.max_results === 'number') qs.set('max_results', String(params.max_results));
        if (typeof params.page_token === 'string') qs.set('page_token', params.page_token);

        const result = await backendFetch(backendUrl, `/api/email/messages?${qs.toString()}`, apiKey);
        if (!result.ok) {
          respond(false, { error: result.error });
          return;
        }

        const data = result.data as Record<string, unknown>;

        respond(true, {
          connection_label: conn.label,
          connection_id: conn.id,
          provider: conn.provider,
          messages: data.messages ?? [],
          next_page_token: data.next_page_token,
          result_size_estimate: data.result_size_estimate,
          available_actions: buildEmailActions(conn.permission_level),
        });
      });

      // -------------------------------------------------------------------
      // oauth.email.get — Get a single email message
      // -------------------------------------------------------------------
      api.registerGatewayMethod('oauth.email.get', async ({ params, respond }) => {
        const connection_id = requireParam(params, 'connection_id', respond);
        if (!connection_id) return;

        const message_id = requireParam(params, 'message_id', respond);
        if (!message_id) return;

        const conn = await resolveConnection(backendUrl, apiKey, connection_id, respond);
        if (!conn) return;

        if (!conn.enabled_features.includes('email')) {
          respond(false, { error: 'Email feature is not enabled on this connection' });
          return;
        }

        const qs = new URLSearchParams({ connection_id });
        const result = await backendFetch(backendUrl, `/api/email/messages/${encodeURIComponent(message_id)}?${qs.toString()}`, apiKey);
        if (!result.ok) {
          respond(false, { error: result.error });
          return;
        }

        respond(true, {
          connection_label: conn.label,
          connection_id: conn.id,
          provider: conn.provider,
          message: result.data,
          available_actions: buildEmailActions(conn.permission_level),
        });
      });

      // -------------------------------------------------------------------
      // oauth.files.list — List files/folders
      // -------------------------------------------------------------------
      api.registerGatewayMethod('oauth.files.list', async ({ params, respond }) => {
        const connection_id = requireParam(params, 'connection_id', respond);
        if (!connection_id) return;

        const conn = await resolveConnection(backendUrl, apiKey, connection_id, respond);
        if (!conn) return;

        if (!conn.enabled_features.includes('files')) {
          respond(false, { error: 'Files feature is not enabled on this connection' });
          return;
        }

        const qs = new URLSearchParams({ connection_id });
        if (typeof params.folder_id === 'string') qs.set('folder_id', params.folder_id);
        if (typeof params.page_token === 'string') qs.set('page_token', params.page_token);

        const result = await backendFetch(backendUrl, `/api/drive/files?${qs.toString()}`, apiKey);
        if (!result.ok) {
          respond(false, { error: result.error });
          return;
        }

        const data = result.data as Record<string, unknown>;

        respond(true, {
          connection_label: conn.label,
          connection_id: conn.id,
          provider: conn.provider,
          files: data.files ?? [],
          next_page_token: data.next_page_token,
          total_count: data.total_count,
          available_actions: buildFileActions(),
        });
      });

      // -------------------------------------------------------------------
      // oauth.files.search — Search files
      // -------------------------------------------------------------------
      api.registerGatewayMethod('oauth.files.search', async ({ params, respond }) => {
        const connection_id = requireParam(params, 'connection_id', respond);
        if (!connection_id) return;

        const query = requireParam(params, 'query', respond);
        if (!query) return;

        const conn = await resolveConnection(backendUrl, apiKey, connection_id, respond);
        if (!conn) return;

        if (!conn.enabled_features.includes('files')) {
          respond(false, { error: 'Files feature is not enabled on this connection' });
          return;
        }

        const qs = new URLSearchParams({ connection_id, q: query });
        if (typeof params.page_token === 'string') qs.set('page_token', params.page_token);

        const result = await backendFetch(backendUrl, `/api/drive/files/search?${qs.toString()}`, apiKey);
        if (!result.ok) {
          respond(false, { error: result.error });
          return;
        }

        const data = result.data as Record<string, unknown>;

        respond(true, {
          connection_label: conn.label,
          connection_id: conn.id,
          provider: conn.provider,
          files: data.files ?? [],
          next_page_token: data.next_page_token,
          total_count: data.total_count,
          available_actions: buildFileActions(),
        });
      });

      // -------------------------------------------------------------------
      // oauth.files.get — Get a single file
      // -------------------------------------------------------------------
      api.registerGatewayMethod('oauth.files.get', async ({ params, respond }) => {
        const connection_id = requireParam(params, 'connection_id', respond);
        if (!connection_id) return;

        const fileId = requireParam(params, 'fileId', respond);
        if (!fileId) return;

        const conn = await resolveConnection(backendUrl, apiKey, connection_id, respond);
        if (!conn) return;

        if (!conn.enabled_features.includes('files')) {
          respond(false, { error: 'Files feature is not enabled on this connection' });
          return;
        }

        const qs = new URLSearchParams({ connection_id });
        const result = await backendFetch(backendUrl, `/api/drive/files/${encodeURIComponent(fileId)}?${qs.toString()}`, apiKey);
        if (!result.ok) {
          respond(false, { error: result.error });
          return;
        }

        respond(true, {
          connection_label: conn.label,
          connection_id: conn.id,
          provider: conn.provider,
          file: result.data,
          available_actions: buildFileActions(),
        });
      });
      // -------------------------------------------------------------------
      // oauth.calendar.list — List calendar events from a connection (Issue #1362)
      // -------------------------------------------------------------------
      api.registerGatewayMethod('oauth.calendar.list', async ({ params, respond }) => {
        const connection_id = requireParam(params, 'connection_id', respond);
        if (!connection_id) return;

        const conn = await resolveConnection(backendUrl, apiKey, connection_id, respond);
        if (!conn) return;

        if (!conn.enabled_features.includes('calendar')) {
          respond(false, { error: 'Calendar feature is not enabled on this connection' });
          return;
        }

        const qs = new URLSearchParams({ connection_id });
        if (typeof params.time_min === 'string') qs.set('time_min', params.time_min);
        if (typeof params.time_max === 'string') qs.set('time_max', params.time_max);
        if (typeof params.max_results === 'number') qs.set('max_results', String(params.max_results));
        if (typeof params.page_token === 'string') qs.set('page_token', params.page_token);

        const result = await backendFetch(backendUrl, `/api/calendar/events/live?${qs.toString()}`, apiKey);
        if (!result.ok) {
          respond(false, { error: result.error });
          return;
        }

        const data = result.data as Record<string, unknown>;

        respond(true, {
          connection_label: conn.label,
          connection_id: conn.id,
          provider: conn.provider,
          events: data.events ?? [],
          next_page_token: data.next_page_token,
          available_actions: buildCalendarActions(conn.permission_level),
        });
      });

      // -------------------------------------------------------------------
      // oauth.calendar.sync — Sync calendar events from provider to local DB (Issue #1362)
      // -------------------------------------------------------------------
      api.registerGatewayMethod('oauth.calendar.sync', async ({ params, respond }) => {
        const connection_id = requireParam(params, 'connection_id', respond);
        if (!connection_id) return;

        const conn = await resolveConnection(backendUrl, apiKey, connection_id, respond);
        if (!conn) return;

        if (!conn.enabled_features.includes('calendar')) {
          respond(false, { error: 'Calendar feature is not enabled on this connection' });
          return;
        }

        const body: Record<string, unknown> = { connection_id };
        if (typeof params.time_min === 'string') body.time_min = params.time_min;
        if (typeof params.time_max === 'string') body.time_max = params.time_max;

        try {
          const url = `${backendUrl.replace(/\/+$/, '')}/api/sync/calendar`;
          const headers: Record<string, string> = {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          };
          if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

          const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
          });

          const data = await response.json();
          if (!response.ok) {
            respond(false, { error: (data as Record<string, unknown>).error || 'Sync failed' });
            return;
          }

          respond(true, {
            connection_label: conn.label,
            connection_id: conn.id,
            provider: conn.provider,
            ...(data as Record<string, unknown>),
          });
        } catch (err) {
          respond(false, { error: err instanceof Error ? err.message : String(err) });
        }
      });

      // -------------------------------------------------------------------
      // oauth.calendar.create — Create a calendar event (Issue #1362)
      // -------------------------------------------------------------------
      api.registerGatewayMethod('oauth.calendar.create', async ({ params, respond }) => {
        const connection_id = requireParam(params, 'connection_id', respond);
        if (!connection_id) return;

        const title = requireParam(params, 'title', respond);
        if (!title) return;

        const conn = await resolveConnection(backendUrl, apiKey, connection_id, respond);
        if (!conn) return;

        if (!conn.enabled_features.includes('calendar')) {
          respond(false, { error: 'Calendar feature is not enabled on this connection' });
          return;
        }

        if (conn.permission_level !== 'read_write') {
          respond(false, { error: 'Write permission required to create events' });
          return;
        }

        const body: Record<string, unknown> = {
          connection_id,
          user_email: conn.provider_account_email || '',
          provider: conn.provider,
          title,
          start_time: params.start_time,
          end_time: params.end_time,
        };
        if (typeof params.description === 'string') body.description = params.description;
        if (typeof params.location === 'string') body.location = params.location;
        if (typeof params.all_day === 'boolean') body.all_day = params.all_day;

        try {
          const url = `${backendUrl.replace(/\/+$/, '')}/api/calendar/events`;
          const headers: Record<string, string> = {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          };
          if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

          const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
          });

          const data = await response.json();
          if (!response.ok) {
            respond(false, { error: (data as Record<string, unknown>).error || 'Create failed' });
            return;
          }

          respond(true, {
            connection_label: conn.label,
            connection_id: conn.id,
            provider: conn.provider,
            event: (data as Record<string, unknown>).event,
            available_actions: buildCalendarActions(conn.permission_level),
          });
        } catch (err) {
          respond(false, { error: err instanceof Error ? err.message : String(err) });
        }
      });
    },
  };
}

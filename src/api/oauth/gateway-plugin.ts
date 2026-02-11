/**
 * OpenClaw Gateway plugin that surfaces OAuth account data to agents.
 * Part of Issue #1054.
 *
 * Registers gateway methods that proxy requests to the openclaw-projects
 * backend API, exposing connected account data (contacts, email, files)
 * in an agent-friendly format with pagination, connectionLabel, and
 * availableActions metadata.
 *
 * Gateway methods registered:
 *   oauth.accounts.list  — List connected accounts with metadata
 *   oauth.contacts.list  — Contacts from a specific connection
 *   oauth.email.list     — Emails from a specific connection
 *   oauth.email.get      — Single email message by ID
 *   oauth.files.list     — Files/folders from a specific connection
 *   oauth.files.search   — Search files across a connection
 *   oauth.files.get      — Single file metadata with download URL
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
  userEmail?: string;
  provider: string;
  label: string;
  providerAccountEmail?: string;
  permissionLevel: string;
  enabledFeatures: string[];
  isActive: boolean;
  lastSyncAt?: string;
  syncStatus: Record<string, unknown>;
  scopes?: string[];
  createdAt: string;
  updatedAt: string;
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
    handler: (opts: {
      params: Record<string, unknown>;
      respond: (ok: boolean, payload?: unknown) => void;
    }) => void | Promise<void>,
  ) => void;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build available actions based on enabled features and permission level. */
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
    'Accept': 'application/json',
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
function requireParam(
  params: Record<string, unknown>,
  name: string,
  respond: RespondFn,
): string | null {
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
async function resolveConnection(
  baseUrl: string,
  apiKey: string | undefined,
  connectionId: string,
  respond: RespondFn,
): Promise<BackendConnection | null> {
  // We fetch all connections and filter — this keeps the plugin simple.
  // For large connection counts a dedicated endpoint would be better.
  const result = await backendFetch(baseUrl, '/api/oauth/connections');
  if (!result.ok) {
    respond(false, { error: result.error });
    return null;
  }

  const connections = ((result.data as Record<string, unknown>).connections as BackendConnection[]) ?? [];
  const conn = connections.find((c) => c.id === connectionId);
  if (!conn) {
    respond(false, { error: `Connection ${connectionId} not found` });
    return null;
  }

  if (!conn.isActive) {
    respond(false, { error: `Connection ${connectionId} is disabled` });
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
        const userEmail = typeof params.userEmail === 'string' ? params.userEmail : undefined;
        const provider = typeof params.provider === 'string' ? params.provider : undefined;

        const qs = new URLSearchParams();
        if (userEmail) qs.set('userEmail', userEmail);
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
            connectionId: conn.id,
            provider: conn.provider,
            connectionLabel: conn.label,
            providerAccountEmail: conn.providerAccountEmail,
            permissionLevel: conn.permissionLevel,
            enabledFeatures: conn.enabledFeatures,
            isActive: conn.isActive,
            lastSyncAt: conn.lastSyncAt,
            syncStatus: conn.syncStatus,
            createdAt: conn.createdAt,
            updatedAt: conn.updatedAt,
            availableActions: buildAccountActions(conn),
          })),
        });
      });

      // -------------------------------------------------------------------
      // oauth.contacts.list — Contacts from a specific connection
      // -------------------------------------------------------------------
      api.registerGatewayMethod('oauth.contacts.list', async ({ params, respond }) => {
        const connectionId = requireParam(params, 'connectionId', respond);
        if (!connectionId) return;

        const conn = await resolveConnection(backendUrl, apiKey, connectionId, respond);
        if (!conn) return;

        if (!conn.enabledFeatures.includes('contacts')) {
          respond(false, { error: 'Contacts feature is not enabled on this connection' });
          return;
        }

        const qs = new URLSearchParams({ connectionId });
        const pageToken = typeof params.pageToken === 'string' ? params.pageToken : undefined;
        if (pageToken) qs.set('pageToken', pageToken);

        const result = await backendFetch(backendUrl, `/api/contacts?${qs.toString()}`, apiKey);
        if (!result.ok) {
          respond(false, { error: result.error });
          return;
        }

        const data = result.data as Record<string, unknown>;

        respond(true, {
          connectionLabel: conn.label,
          connectionId: conn.id,
          provider: conn.provider,
          contacts: data.contacts ?? [],
          nextPageToken: data.nextPageToken,
          availableActions: ['list_contacts'],
        });
      });

      // -------------------------------------------------------------------
      // oauth.email.list — List or search emails
      // -------------------------------------------------------------------
      api.registerGatewayMethod('oauth.email.list', async ({ params, respond }) => {
        const connectionId = requireParam(params, 'connectionId', respond);
        if (!connectionId) return;

        const conn = await resolveConnection(backendUrl, apiKey, connectionId, respond);
        if (!conn) return;

        if (!conn.enabledFeatures.includes('email')) {
          respond(false, { error: 'Email feature is not enabled on this connection' });
          return;
        }

        const qs = new URLSearchParams({ connectionId });
        if (typeof params.query === 'string') qs.set('query', params.query);
        if (typeof params.folderId === 'string') qs.set('folderId', params.folderId);
        if (typeof params.maxResults === 'number') qs.set('maxResults', String(params.maxResults));
        if (typeof params.pageToken === 'string') qs.set('pageToken', params.pageToken);

        const result = await backendFetch(backendUrl, `/api/email/messages?${qs.toString()}`, apiKey);
        if (!result.ok) {
          respond(false, { error: result.error });
          return;
        }

        const data = result.data as Record<string, unknown>;

        respond(true, {
          connectionLabel: conn.label,
          connectionId: conn.id,
          provider: conn.provider,
          messages: data.messages ?? [],
          nextPageToken: data.nextPageToken,
          resultSizeEstimate: data.resultSizeEstimate,
          availableActions: buildEmailActions(conn.permissionLevel),
        });
      });

      // -------------------------------------------------------------------
      // oauth.email.get — Get a single email message
      // -------------------------------------------------------------------
      api.registerGatewayMethod('oauth.email.get', async ({ params, respond }) => {
        const connectionId = requireParam(params, 'connectionId', respond);
        if (!connectionId) return;

        const messageId = requireParam(params, 'messageId', respond);
        if (!messageId) return;

        const conn = await resolveConnection(backendUrl, apiKey, connectionId, respond);
        if (!conn) return;

        if (!conn.enabledFeatures.includes('email')) {
          respond(false, { error: 'Email feature is not enabled on this connection' });
          return;
        }

        const qs = new URLSearchParams({ connectionId });
        const result = await backendFetch(
          backendUrl,
          `/api/email/messages/${encodeURIComponent(messageId)}?${qs.toString()}`,
          apiKey,
        );
        if (!result.ok) {
          respond(false, { error: result.error });
          return;
        }

        respond(true, {
          connectionLabel: conn.label,
          connectionId: conn.id,
          provider: conn.provider,
          message: result.data,
          availableActions: buildEmailActions(conn.permissionLevel),
        });
      });

      // -------------------------------------------------------------------
      // oauth.files.list — List files/folders
      // -------------------------------------------------------------------
      api.registerGatewayMethod('oauth.files.list', async ({ params, respond }) => {
        const connectionId = requireParam(params, 'connectionId', respond);
        if (!connectionId) return;

        const conn = await resolveConnection(backendUrl, apiKey, connectionId, respond);
        if (!conn) return;

        if (!conn.enabledFeatures.includes('files')) {
          respond(false, { error: 'Files feature is not enabled on this connection' });
          return;
        }

        const qs = new URLSearchParams({ connectionId });
        if (typeof params.folderId === 'string') qs.set('folderId', params.folderId);
        if (typeof params.pageToken === 'string') qs.set('pageToken', params.pageToken);

        const result = await backendFetch(backendUrl, `/api/drive/files?${qs.toString()}`, apiKey);
        if (!result.ok) {
          respond(false, { error: result.error });
          return;
        }

        const data = result.data as Record<string, unknown>;

        respond(true, {
          connectionLabel: conn.label,
          connectionId: conn.id,
          provider: conn.provider,
          files: data.files ?? [],
          nextPageToken: data.nextPageToken,
          totalCount: data.totalCount,
          availableActions: buildFileActions(),
        });
      });

      // -------------------------------------------------------------------
      // oauth.files.search — Search files
      // -------------------------------------------------------------------
      api.registerGatewayMethod('oauth.files.search', async ({ params, respond }) => {
        const connectionId = requireParam(params, 'connectionId', respond);
        if (!connectionId) return;

        const query = requireParam(params, 'query', respond);
        if (!query) return;

        const conn = await resolveConnection(backendUrl, apiKey, connectionId, respond);
        if (!conn) return;

        if (!conn.enabledFeatures.includes('files')) {
          respond(false, { error: 'Files feature is not enabled on this connection' });
          return;
        }

        const qs = new URLSearchParams({ connectionId, q: query });
        if (typeof params.pageToken === 'string') qs.set('pageToken', params.pageToken);

        const result = await backendFetch(backendUrl, `/api/drive/files/search?${qs.toString()}`, apiKey);
        if (!result.ok) {
          respond(false, { error: result.error });
          return;
        }

        const data = result.data as Record<string, unknown>;

        respond(true, {
          connectionLabel: conn.label,
          connectionId: conn.id,
          provider: conn.provider,
          files: data.files ?? [],
          nextPageToken: data.nextPageToken,
          totalCount: data.totalCount,
          availableActions: buildFileActions(),
        });
      });

      // -------------------------------------------------------------------
      // oauth.files.get — Get a single file
      // -------------------------------------------------------------------
      api.registerGatewayMethod('oauth.files.get', async ({ params, respond }) => {
        const connectionId = requireParam(params, 'connectionId', respond);
        if (!connectionId) return;

        const fileId = requireParam(params, 'fileId', respond);
        if (!fileId) return;

        const conn = await resolveConnection(backendUrl, apiKey, connectionId, respond);
        if (!conn) return;

        if (!conn.enabledFeatures.includes('files')) {
          respond(false, { error: 'Files feature is not enabled on this connection' });
          return;
        }

        const qs = new URLSearchParams({ connectionId });
        const result = await backendFetch(
          backendUrl,
          `/api/drive/files/${encodeURIComponent(fileId)}?${qs.toString()}`,
          apiKey,
        );
        if (!result.ok) {
          respond(false, { error: result.error });
          return;
        }

        respond(true, {
          connectionLabel: conn.label,
          connectionId: conn.id,
          provider: conn.provider,
          file: result.data,
          availableActions: buildFileActions(),
        });
      });
    },
  };
}

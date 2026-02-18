/**
 * Tests for the OpenClaw gateway OAuth plugin.
 * Part of Issue #1054.
 *
 * Tests verify that the plugin:
 * - Registers the expected gateway methods
 * - Validates parameters and calls the backend API correctly
 * - Formats responses in an agent-friendly structure
 * - Handles errors gracefully
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OAuthGatewayPluginConfig } from './gateway-plugin.ts';

// ---------------------------------------------------------------------------
// Stubs / helpers
// ---------------------------------------------------------------------------

const noopLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

/**
 * Minimal mock of the gateway plugin API surface used by our plugin.
 * We only need registerGatewayMethod and registerTool.
 */
type RegisteredMethods = Map<string, (opts: { params: Record<string, unknown>; respond: ReturnType<typeof vi.fn> }) => unknown>;

async function setupPlugin(config: OAuthGatewayPluginConfig) {
  const { createOAuthGatewayPlugin } = await import('./gateway-plugin.ts');
  const plugin = createOAuthGatewayPlugin();
  const methods: RegisteredMethods = new Map();

  plugin.register!({
    id: 'oauth-accounts',
    name: 'OAuth Accounts',
    description: 'test',
    version: '0',
    source: 'test',
    config: {},
    pluginConfig: config,
    runtime: {},
    logger: noopLogger,
    registerGatewayMethod: (method: string, handler: unknown) => methods.set(method, handler as Parameters<RegisteredMethods['set']>[1]),
    registerTool: () => {},
    registerHttpHandler: () => {},
    registerHttpRoute: () => {},
    registerChannel: () => {},
    registerCli: () => {},
    registerService: () => {},
    registerProvider: () => {},
    registerCommand: () => {},
    resolvePath: (p: string) => p,
    on: () => {},
  } as never);

  return { methods };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OAuth Gateway Plugin', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('registers expected gateway methods', async () => {
    const { methods } = await setupPlugin({ backendUrl: 'http://localhost:3001' });
    expect(methods.has('oauth.accounts.list')).toBe(true);
    expect(methods.has('oauth.contacts.list')).toBe(true);
    expect(methods.has('oauth.email.list')).toBe(true);
    expect(methods.has('oauth.email.get')).toBe(true);
    expect(methods.has('oauth.files.list')).toBe(true);
    expect(methods.has('oauth.files.search')).toBe(true);
    expect(methods.has('oauth.files.get')).toBe(true);
  });

  it('does not register methods when backendUrl is missing', async () => {
    const { methods } = await setupPlugin({} as OAuthGatewayPluginConfig);
    expect(methods.size).toBe(0);
    expect(noopLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('backendUrl'),
    );
  });

  // -----------------------------------------------------------------------
  // oauth.accounts.list
  // -----------------------------------------------------------------------

  describe('oauth.accounts.list', () => {
    it('returns connections with metadata', async () => {
      const { methods } = await setupPlugin({ backendUrl: 'http://localhost:3001' });
      const handler = methods.get('oauth.accounts.list')!;

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          connections: [
            {
              id: 'conn-1',
              provider: 'microsoft',
              label: 'Work M365',
              provider_account_email: 'user@example.com',
              permission_level: 'read',
              enabled_features: ['email', 'contacts'],
              is_active: true,
              last_sync_at: '2026-01-01T00:00:00Z',
              sync_status: {},
              created_at: '2026-01-01T00:00:00Z',
              updated_at: '2026-01-01T00:00:00Z',
            },
          ],
        }),
      });

      const respond = vi.fn();
      await handler({ params: {}, respond });

      expect(respond).toHaveBeenCalledWith(true, expect.objectContaining({
        accounts: expect.arrayContaining([
          expect.objectContaining({
            connection_id: 'conn-1',
            provider: 'microsoft',
            connection_label: 'Work M365',
            enabled_features: ['email', 'contacts'],
            available_actions: expect.arrayContaining(['list_emails', 'list_contacts']),
          }),
        ]),
      }));
    });

    it('handles backend error', async () => {
      const { methods } = await setupPlugin({ backendUrl: 'http://localhost:3001' });
      const handler = methods.get('oauth.accounts.list')!;

      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Internal error' }),
      });

      const respond = vi.fn();
      await handler({ params: {}, respond });

      expect(respond).toHaveBeenCalledWith(false, expect.objectContaining({
        error: expect.stringContaining('Internal error'),
      }));
    });

    it('handles network failure', async () => {
      const { methods } = await setupPlugin({ backendUrl: 'http://localhost:3001' });
      const handler = methods.get('oauth.accounts.list')!;

      fetchSpy.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const respond = vi.fn();
      await handler({ params: {}, respond });

      expect(respond).toHaveBeenCalledWith(false, expect.objectContaining({
        error: expect.stringContaining('ECONNREFUSED'),
      }));
    });
  });

  // -----------------------------------------------------------------------
  // oauth.contacts.list
  // -----------------------------------------------------------------------

  describe('oauth.contacts.list', () => {
    it('returns contacts for a connection', async () => {
      const { methods } = await setupPlugin({ backendUrl: 'http://localhost:3001' });
      const handler = methods.get('oauth.contacts.list')!;

      // First call: get the connection to validate feature
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          connections: [
            {
              id: 'conn-1',
              provider: 'microsoft',
              label: 'Work',
              enabled_features: ['contacts'],
              is_active: true,
              permission_level: 'read',
            },
          ],
        }),
      });

      // Second call: fetch contacts from the sync endpoint
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          contacts: [
            {
              id: 'c-1',
              display_name: 'Alice',
              email_addresses: ['alice@example.com'],
              phone_numbers: ['+1555000'],
            },
          ],
        }),
      });

      const respond = vi.fn();
      await handler({ params: { connection_id: 'conn-1' }, respond });

      expect(respond).toHaveBeenCalledWith(true, expect.objectContaining({
        connection_label: 'Work',
        contacts: expect.arrayContaining([
          expect.objectContaining({
            display_name: 'Alice',
          }),
        ]),
      }));
    });

    it('rejects when connection_id is missing', async () => {
      const { methods } = await setupPlugin({ backendUrl: 'http://localhost:3001' });
      const handler = methods.get('oauth.contacts.list')!;

      const respond = vi.fn();
      await handler({ params: {}, respond });

      expect(respond).toHaveBeenCalledWith(false, expect.objectContaining({
        error: expect.stringContaining('connection_id'),
      }));
    });
  });

  // -----------------------------------------------------------------------
  // oauth.email.list
  // -----------------------------------------------------------------------

  describe('oauth.email.list', () => {
    it('returns emails for a connection', async () => {
      const { methods } = await setupPlugin({ backendUrl: 'http://localhost:3001' });
      const handler = methods.get('oauth.email.list')!;

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          connections: [{
            id: 'conn-1',
            label: 'Work Gmail',
            enabled_features: ['email'],
            is_active: true,
            permission_level: 'read_write',
            provider: 'google',
          }],
        }),
      });

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          messages: [
            {
              id: 'msg-1',
              subject: 'Hello',
              from: { email: 'bob@example.com', name: 'Bob' },
              to: [{ email: 'me@example.com' }],
              cc: [],
              bcc: [],
              snippet: 'Hi there',
              received_at: '2026-01-01T00:00:00Z',
              is_read: false,
              is_starred: false,
              is_draft: false,
              labels: ['INBOX'],
              attachments: [],
              provider: 'google',
            },
          ],
          next_page_token: 'page2',
        }),
      });

      const respond = vi.fn();
      await handler({ params: { connection_id: 'conn-1', max_results: 10 }, respond });

      expect(respond).toHaveBeenCalledWith(true, expect.objectContaining({
        connection_label: 'Work Gmail',
        messages: expect.arrayContaining([
          expect.objectContaining({
            id: 'msg-1',
            subject: 'Hello',
          }),
        ]),
        next_page_token: 'page2',
        available_actions: expect.arrayContaining(['send_email', 'create_draft']),
      }));
    });

    it('omits write actions for read-only connections', async () => {
      const { methods } = await setupPlugin({ backendUrl: 'http://localhost:3001' });
      const handler = methods.get('oauth.email.list')!;

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          connections: [{
            id: 'conn-1',
            label: 'Read Only',
            enabled_features: ['email'],
            is_active: true,
            permission_level: 'read',
            provider: 'google',
          }],
        }),
      });

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ messages: [], next_page_token: undefined }),
      });

      const respond = vi.fn();
      await handler({ params: { connection_id: 'conn-1' }, respond });

      const payload = respond.mock.calls[0][1];
      expect(payload.available_actions).not.toContain('send_email');
      expect(payload.available_actions).not.toContain('create_draft');
      expect(payload.available_actions).toContain('list_messages');
    });
  });

  // -----------------------------------------------------------------------
  // oauth.email.get
  // -----------------------------------------------------------------------

  describe('oauth.email.get', () => {
    it('returns a single email message', async () => {
      const { methods } = await setupPlugin({ backendUrl: 'http://localhost:3001' });
      const handler = methods.get('oauth.email.get')!;

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          connections: [{
            id: 'conn-1',
            label: 'Work',
            enabled_features: ['email'],
            is_active: true,
            permission_level: 'read',
            provider: 'microsoft',
          }],
        }),
      });

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'msg-1',
          subject: 'Test',
          from: { email: 'test@example.com' },
          to: [],
          cc: [],
          bcc: [],
          body_text: 'Hello world',
          received_at: '2026-01-01T00:00:00Z',
          is_read: true,
          is_starred: false,
          is_draft: false,
          labels: [],
          attachments: [],
          provider: 'microsoft',
        }),
      });

      const respond = vi.fn();
      await handler({ params: { connection_id: 'conn-1', message_id: 'msg-1' }, respond });

      expect(respond).toHaveBeenCalledWith(true, expect.objectContaining({
        connection_label: 'Work',
        message: expect.objectContaining({
          id: 'msg-1',
          subject: 'Test',
          body_text: 'Hello world',
        }),
      }));
    });

    it('rejects when message_id is missing', async () => {
      const { methods } = await setupPlugin({ backendUrl: 'http://localhost:3001' });
      const handler = methods.get('oauth.email.get')!;

      const respond = vi.fn();
      await handler({ params: { connection_id: 'conn-1' }, respond });

      expect(respond).toHaveBeenCalledWith(false, expect.objectContaining({
        error: expect.stringContaining('message_id'),
      }));
    });
  });

  // -----------------------------------------------------------------------
  // oauth.files.list
  // -----------------------------------------------------------------------

  describe('oauth.files.list', () => {
    it('returns files for a connection', async () => {
      const { methods } = await setupPlugin({ backendUrl: 'http://localhost:3001' });
      const handler = methods.get('oauth.files.list')!;

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          connections: [{
            id: 'conn-1',
            label: 'Work Drive',
            enabled_features: ['files'],
            is_active: true,
            permission_level: 'read',
            provider: 'google',
          }],
        }),
      });

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          files: [
            {
              id: 'f-1',
              name: 'document.pdf',
              mimeType: 'application/pdf',
              size: 1024,
              is_folder: false,
              provider: 'google',
              connection_id: 'conn-1',
              metadata: {},
            },
          ],
          next_page_token: 'next',
        }),
      });

      const respond = vi.fn();
      await handler({ params: { connection_id: 'conn-1' }, respond });

      expect(respond).toHaveBeenCalledWith(true, expect.objectContaining({
        connection_label: 'Work Drive',
        files: expect.arrayContaining([
          expect.objectContaining({
            id: 'f-1',
            name: 'document.pdf',
          }),
        ]),
        next_page_token: 'next',
        available_actions: expect.arrayContaining(['list_files', 'search_files', 'get_file']),
      }));
    });
  });

  // -----------------------------------------------------------------------
  // oauth.files.search
  // -----------------------------------------------------------------------

  describe('oauth.files.search', () => {
    it('searches files', async () => {
      const { methods } = await setupPlugin({ backendUrl: 'http://localhost:3001' });
      const handler = methods.get('oauth.files.search')!;

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          connections: [{
            id: 'conn-1',
            label: 'Drive',
            enabled_features: ['files'],
            is_active: true,
            permission_level: 'read',
            provider: 'microsoft',
          }],
        }),
      });

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          files: [
            {
              id: 'f-2',
              name: 'budget.xlsx',
              mimeType: 'application/vnd.ms-excel',
              is_folder: false,
              provider: 'microsoft',
              connection_id: 'conn-1',
              metadata: {},
            },
          ],
        }),
      });

      const respond = vi.fn();
      await handler({ params: { connection_id: 'conn-1', query: 'budget' }, respond });

      expect(respond).toHaveBeenCalledWith(true, expect.objectContaining({
        files: expect.arrayContaining([
          expect.objectContaining({ name: 'budget.xlsx' }),
        ]),
      }));
    });

    it('rejects when query is missing', async () => {
      const { methods } = await setupPlugin({ backendUrl: 'http://localhost:3001' });
      const handler = methods.get('oauth.files.search')!;

      const respond = vi.fn();
      await handler({ params: { connection_id: 'conn-1' }, respond });

      expect(respond).toHaveBeenCalledWith(false, expect.objectContaining({
        error: expect.stringContaining('query'),
      }));
    });
  });

  // -----------------------------------------------------------------------
  // oauth.files.get
  // -----------------------------------------------------------------------

  describe('oauth.files.get', () => {
    it('returns a single file', async () => {
      const { methods } = await setupPlugin({ backendUrl: 'http://localhost:3001' });
      const handler = methods.get('oauth.files.get')!;

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          connections: [{
            id: 'conn-1',
            label: 'Drive',
            enabled_features: ['files'],
            is_active: true,
            permission_level: 'read',
            provider: 'google',
          }],
        }),
      });

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'f-1',
          name: 'photo.jpg',
          mimeType: 'image/jpeg',
          size: 2048,
          is_folder: false,
          web_url: 'https://drive.google.com/file/f-1',
          download_url: 'https://drive.google.com/file/f-1/download',
          provider: 'google',
          connection_id: 'conn-1',
          metadata: {},
        }),
      });

      const respond = vi.fn();
      await handler({ params: { connection_id: 'conn-1', fileId: 'f-1' }, respond });

      expect(respond).toHaveBeenCalledWith(true, expect.objectContaining({
        connection_label: 'Drive',
        file: expect.objectContaining({
          id: 'f-1',
          name: 'photo.jpg',
          download_url: 'https://drive.google.com/file/f-1/download',
        }),
      }));
    });

    it('rejects when fileId is missing', async () => {
      const { methods } = await setupPlugin({ backendUrl: 'http://localhost:3001' });
      const handler = methods.get('oauth.files.get')!;

      const respond = vi.fn();
      await handler({ params: { connection_id: 'conn-1' }, respond });

      expect(respond).toHaveBeenCalledWith(false, expect.objectContaining({
        error: expect.stringContaining('fileId'),
      }));
    });
  });
});

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
              providerAccountEmail: 'user@example.com',
              permissionLevel: 'read',
              enabledFeatures: ['email', 'contacts'],
              isActive: true,
              lastSyncAt: '2026-01-01T00:00:00Z',
              syncStatus: {},
              createdAt: '2026-01-01T00:00:00Z',
              updatedAt: '2026-01-01T00:00:00Z',
            },
          ],
        }),
      });

      const respond = vi.fn();
      await handler({ params: {}, respond });

      expect(respond).toHaveBeenCalledWith(true, expect.objectContaining({
        accounts: expect.arrayContaining([
          expect.objectContaining({
            connectionId: 'conn-1',
            provider: 'microsoft',
            connectionLabel: 'Work M365',
            enabledFeatures: ['email', 'contacts'],
            availableActions: expect.arrayContaining(['list_emails', 'list_contacts']),
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
              enabledFeatures: ['contacts'],
              isActive: true,
              permissionLevel: 'read',
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
              displayName: 'Alice',
              emailAddresses: ['alice@example.com'],
              phoneNumbers: ['+1555000'],
            },
          ],
        }),
      });

      const respond = vi.fn();
      await handler({ params: { connectionId: 'conn-1' }, respond });

      expect(respond).toHaveBeenCalledWith(true, expect.objectContaining({
        connectionLabel: 'Work',
        contacts: expect.arrayContaining([
          expect.objectContaining({
            displayName: 'Alice',
          }),
        ]),
      }));
    });

    it('rejects when connectionId is missing', async () => {
      const { methods } = await setupPlugin({ backendUrl: 'http://localhost:3001' });
      const handler = methods.get('oauth.contacts.list')!;

      const respond = vi.fn();
      await handler({ params: {}, respond });

      expect(respond).toHaveBeenCalledWith(false, expect.objectContaining({
        error: expect.stringContaining('connectionId'),
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
            enabledFeatures: ['email'],
            isActive: true,
            permissionLevel: 'read_write',
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
              receivedAt: '2026-01-01T00:00:00Z',
              isRead: false,
              isStarred: false,
              isDraft: false,
              labels: ['INBOX'],
              attachments: [],
              provider: 'google',
            },
          ],
          nextPageToken: 'page2',
        }),
      });

      const respond = vi.fn();
      await handler({ params: { connectionId: 'conn-1', maxResults: 10 }, respond });

      expect(respond).toHaveBeenCalledWith(true, expect.objectContaining({
        connectionLabel: 'Work Gmail',
        messages: expect.arrayContaining([
          expect.objectContaining({
            id: 'msg-1',
            subject: 'Hello',
          }),
        ]),
        nextPageToken: 'page2',
        availableActions: expect.arrayContaining(['send_email', 'create_draft']),
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
            enabledFeatures: ['email'],
            isActive: true,
            permissionLevel: 'read',
            provider: 'google',
          }],
        }),
      });

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ messages: [], nextPageToken: undefined }),
      });

      const respond = vi.fn();
      await handler({ params: { connectionId: 'conn-1' }, respond });

      const payload = respond.mock.calls[0][1];
      expect(payload.availableActions).not.toContain('send_email');
      expect(payload.availableActions).not.toContain('create_draft');
      expect(payload.availableActions).toContain('list_messages');
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
            enabledFeatures: ['email'],
            isActive: true,
            permissionLevel: 'read',
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
          bodyText: 'Hello world',
          receivedAt: '2026-01-01T00:00:00Z',
          isRead: true,
          isStarred: false,
          isDraft: false,
          labels: [],
          attachments: [],
          provider: 'microsoft',
        }),
      });

      const respond = vi.fn();
      await handler({ params: { connectionId: 'conn-1', messageId: 'msg-1' }, respond });

      expect(respond).toHaveBeenCalledWith(true, expect.objectContaining({
        connectionLabel: 'Work',
        message: expect.objectContaining({
          id: 'msg-1',
          subject: 'Test',
          bodyText: 'Hello world',
        }),
      }));
    });

    it('rejects when messageId is missing', async () => {
      const { methods } = await setupPlugin({ backendUrl: 'http://localhost:3001' });
      const handler = methods.get('oauth.email.get')!;

      const respond = vi.fn();
      await handler({ params: { connectionId: 'conn-1' }, respond });

      expect(respond).toHaveBeenCalledWith(false, expect.objectContaining({
        error: expect.stringContaining('messageId'),
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
            enabledFeatures: ['files'],
            isActive: true,
            permissionLevel: 'read',
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
              isFolder: false,
              provider: 'google',
              connectionId: 'conn-1',
              metadata: {},
            },
          ],
          nextPageToken: 'next',
        }),
      });

      const respond = vi.fn();
      await handler({ params: { connectionId: 'conn-1' }, respond });

      expect(respond).toHaveBeenCalledWith(true, expect.objectContaining({
        connectionLabel: 'Work Drive',
        files: expect.arrayContaining([
          expect.objectContaining({
            id: 'f-1',
            name: 'document.pdf',
          }),
        ]),
        nextPageToken: 'next',
        availableActions: expect.arrayContaining(['list_files', 'search_files', 'get_file']),
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
            enabledFeatures: ['files'],
            isActive: true,
            permissionLevel: 'read',
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
              isFolder: false,
              provider: 'microsoft',
              connectionId: 'conn-1',
              metadata: {},
            },
          ],
        }),
      });

      const respond = vi.fn();
      await handler({ params: { connectionId: 'conn-1', query: 'budget' }, respond });

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
      await handler({ params: { connectionId: 'conn-1' }, respond });

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
            enabledFeatures: ['files'],
            isActive: true,
            permissionLevel: 'read',
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
          isFolder: false,
          webUrl: 'https://drive.google.com/file/f-1',
          downloadUrl: 'https://drive.google.com/file/f-1/download',
          provider: 'google',
          connectionId: 'conn-1',
          metadata: {},
        }),
      });

      const respond = vi.fn();
      await handler({ params: { connectionId: 'conn-1', fileId: 'f-1' }, respond });

      expect(respond).toHaveBeenCalledWith(true, expect.objectContaining({
        connectionLabel: 'Drive',
        file: expect.objectContaining({
          id: 'f-1',
          name: 'photo.jpg',
          downloadUrl: 'https://drive.google.com/file/f-1/download',
        }),
      }));
    });

    it('rejects when fileId is missing', async () => {
      const { methods } = await setupPlugin({ backendUrl: 'http://localhost:3001' });
      const handler = methods.get('oauth.files.get')!;

      const respond = vi.fn();
      await handler({ params: { connectionId: 'conn-1' }, respond });

      expect(respond).toHaveBeenCalledWith(false, expect.objectContaining({
        error: expect.stringContaining('fileId'),
      }));
    });
  });
});

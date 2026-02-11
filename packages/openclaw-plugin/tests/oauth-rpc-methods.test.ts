/**
 * Tests for the OAuth Gateway RPC methods module.
 * Part of Issue #1054.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createOAuthGatewayMethods,
  registerOAuthGatewayRpcMethods,
  type OAuthGatewayMethods,
} from '../src/gateway/oauth-rpc-methods.js';
import type { ApiClient, ApiResponse } from '../src/api-client.js';
import type { Logger } from '../src/logger.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const noopLogger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

function createMockApiClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    healthCheck: vi.fn(),
    ...overrides,
  } as unknown as ApiClient;
}

/** Helper to set up a mock connection response. */
function mockConnectionsResponse(
  client: ApiClient,
  connections: Array<Record<string, unknown>>,
): void {
  (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    success: true,
    data: { connections },
  } satisfies ApiResponse<{ connections: Array<Record<string, unknown>> }>);
}

const TEST_CONNECTION = {
  id: 'conn-1',
  provider: 'microsoft',
  label: 'Work M365',
  providerAccountEmail: 'user@example.com',
  permissionLevel: 'read',
  enabledFeatures: ['email', 'contacts', 'files'],
  isActive: true,
  lastSyncAt: '2026-01-01T00:00:00Z',
  syncStatus: {},
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OAuth Gateway RPC Methods', () => {
  let client: ApiClient;
  let methods: OAuthGatewayMethods;

  beforeEach(() => {
    client = createMockApiClient();
    methods = createOAuthGatewayMethods({
      logger: noopLogger,
      apiClient: client,
      userId: 'test-user',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // registerOAuthGatewayRpcMethods
  // -----------------------------------------------------------------------

  describe('registerOAuthGatewayRpcMethods', () => {
    it('registers all 7 gateway methods', () => {
      const registerGatewayMethod = vi.fn();
      registerOAuthGatewayRpcMethods({ registerGatewayMethod }, methods);

      expect(registerGatewayMethod).toHaveBeenCalledTimes(7);
      const registeredNames = registerGatewayMethod.mock.calls.map(
        (call: unknown[]) => call[0],
      );
      expect(registeredNames).toEqual([
        'oauth.accounts.list',
        'oauth.contacts.list',
        'oauth.email.list',
        'oauth.email.get',
        'oauth.files.list',
        'oauth.files.search',
        'oauth.files.get',
      ]);
    });
  });

  // -----------------------------------------------------------------------
  // accountsList
  // -----------------------------------------------------------------------

  describe('accountsList', () => {
    it('returns accounts with metadata', async () => {
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        success: true,
        data: { connections: [TEST_CONNECTION] },
      });

      const result = await methods.accountsList({});

      expect(result.accounts).toHaveLength(1);
      expect(result.accounts[0]).toMatchObject({
        connectionId: 'conn-1',
        provider: 'microsoft',
        connectionLabel: 'Work M365',
        enabledFeatures: ['email', 'contacts', 'files'],
      });
      expect(result.accounts[0].availableActions).toContain('list_contacts');
      expect(result.accounts[0].availableActions).toContain('list_emails');
      expect(result.accounts[0].availableActions).toContain('list_files');
    });

    it('throws on API failure', async () => {
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        success: false,
        error: { status: 500, message: 'Internal error', code: 'SERVER_ERROR' },
      });

      await expect(methods.accountsList({})).rejects.toThrow('Internal error');
    });
  });

  // -----------------------------------------------------------------------
  // contactsList
  // -----------------------------------------------------------------------

  describe('contactsList', () => {
    it('returns contacts for a valid connection', async () => {
      mockConnectionsResponse(client, [TEST_CONNECTION]);
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        success: true,
        data: {
          contacts: [{ id: 'c-1', displayName: 'Alice', emailAddresses: ['alice@example.com'] }],
        },
      });

      const result = await methods.contactsList({ connectionId: 'conn-1' });

      expect(result.connectionLabel).toBe('Work M365');
      expect(result.contacts).toHaveLength(1);
      expect(result.availableActions).toContain('list_contacts');
    });

    it('throws when connectionId is missing', async () => {
      await expect(
        methods.contactsList({ connectionId: '' }),
      ).rejects.toThrow('connectionId is required');
    });

    it('throws when connection not found', async () => {
      mockConnectionsResponse(client, []);
      await expect(
        methods.contactsList({ connectionId: 'nonexistent' }),
      ).rejects.toThrow('Connection not found');
    });
  });

  // -----------------------------------------------------------------------
  // emailList
  // -----------------------------------------------------------------------

  describe('emailList', () => {
    it('returns emails for a valid connection', async () => {
      mockConnectionsResponse(client, [{ ...TEST_CONNECTION, permissionLevel: 'read_write' }]);
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        success: true,
        data: {
          messages: [{ id: 'msg-1', subject: 'Hello' }],
          nextPageToken: 'page2',
        },
      });

      const result = await methods.emailList({ connectionId: 'conn-1' });

      expect(result.connectionLabel).toBe('Work M365');
      expect(result.messages).toHaveLength(1);
      expect(result.nextPageToken).toBe('page2');
      expect(result.availableActions).toContain('send_email');
      expect(result.availableActions).toContain('create_draft');
    });

    it('omits write actions for read-only connections', async () => {
      mockConnectionsResponse(client, [TEST_CONNECTION]); // permissionLevel: 'read'
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        success: true,
        data: { messages: [] },
      });

      const result = await methods.emailList({ connectionId: 'conn-1' });

      expect(result.availableActions).not.toContain('send_email');
      expect(result.availableActions).toContain('list_messages');
    });
  });

  // -----------------------------------------------------------------------
  // emailGet
  // -----------------------------------------------------------------------

  describe('emailGet', () => {
    it('returns a single email', async () => {
      mockConnectionsResponse(client, [TEST_CONNECTION]);
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        success: true,
        data: { id: 'msg-1', subject: 'Test', bodyText: 'Hello' },
      });

      const result = await methods.emailGet({ connectionId: 'conn-1', messageId: 'msg-1' });

      expect(result.connectionLabel).toBe('Work M365');
      expect(result.message).toMatchObject({ id: 'msg-1', subject: 'Test' });
    });

    it('throws when messageId is missing', async () => {
      await expect(
        methods.emailGet({ connectionId: 'conn-1', messageId: '' }),
      ).rejects.toThrow('messageId is required');
    });
  });

  // -----------------------------------------------------------------------
  // filesList
  // -----------------------------------------------------------------------

  describe('filesList', () => {
    it('returns files for a valid connection', async () => {
      mockConnectionsResponse(client, [TEST_CONNECTION]);
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        success: true,
        data: {
          files: [{ id: 'f-1', name: 'document.pdf' }],
          nextPageToken: 'next',
        },
      });

      const result = await methods.filesList({ connectionId: 'conn-1' });

      expect(result.connectionLabel).toBe('Work M365');
      expect(result.files).toHaveLength(1);
      expect(result.nextPageToken).toBe('next');
      expect(result.availableActions).toContain('list_files');
    });
  });

  // -----------------------------------------------------------------------
  // filesSearch
  // -----------------------------------------------------------------------

  describe('filesSearch', () => {
    it('searches files', async () => {
      mockConnectionsResponse(client, [TEST_CONNECTION]);
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        success: true,
        data: {
          files: [{ id: 'f-2', name: 'budget.xlsx' }],
        },
      });

      const result = await methods.filesSearch({ connectionId: 'conn-1', query: 'budget' });

      expect(result.files).toHaveLength(1);
      expect(result.files[0]).toMatchObject({ name: 'budget.xlsx' });
      expect(result.availableActions).toContain('search_files');
    });

    it('throws when query is missing', async () => {
      await expect(
        methods.filesSearch({ connectionId: 'conn-1', query: '' }),
      ).rejects.toThrow('query is required');
    });
  });

  // -----------------------------------------------------------------------
  // filesGet
  // -----------------------------------------------------------------------

  describe('filesGet', () => {
    it('returns a single file', async () => {
      mockConnectionsResponse(client, [TEST_CONNECTION]);
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        success: true,
        data: { id: 'f-1', name: 'photo.jpg', downloadUrl: 'https://example.com/download' },
      });

      const result = await methods.filesGet({ connectionId: 'conn-1', fileId: 'f-1' });

      expect(result.connectionLabel).toBe('Work M365');
      expect(result.file).toMatchObject({ id: 'f-1', name: 'photo.jpg' });
      expect(result.availableActions).toContain('get_file');
    });

    it('throws when fileId is missing', async () => {
      await expect(
        methods.filesGet({ connectionId: 'conn-1', fileId: '' }),
      ).rejects.toThrow('fileId is required');
    });
  });
});

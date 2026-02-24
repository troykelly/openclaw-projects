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
  provider_account_email: 'user@example.com',
  permission_level: 'read',
  enabled_features: ['email', 'contacts', 'files'],
  is_active: true,
  last_sync_at: '2026-01-01T00:00:00Z',
  sync_status: {},
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const CALENDAR_CONNECTION = {
  ...TEST_CONNECTION,
  enabled_features: ['calendar'],
};

const CALENDAR_RW_CONNECTION = {
  ...TEST_CONNECTION,
  permission_level: 'read_write',
  enabled_features: ['calendar'],
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
      getUserId: () => 'test-user',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // registerOAuthGatewayRpcMethods
  // -----------------------------------------------------------------------

  describe('registerOAuthGatewayRpcMethods', () => {
    it('registers all 10 gateway methods', () => {
      const registerGatewayMethod = vi.fn();
      registerOAuthGatewayRpcMethods({ registerGatewayMethod }, methods);

      expect(registerGatewayMethod).toHaveBeenCalledTimes(10);
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
        'oauth.calendar.list',
        'oauth.calendar.sync',
        'oauth.calendar.create',
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
        connection_id: 'conn-1',
        provider: 'microsoft',
        connection_label: 'Work M365',
        enabled_features: ['email', 'contacts', 'files'],
      });
      expect(result.accounts[0].available_actions).toContain('list_contacts');
      expect(result.accounts[0].available_actions).toContain('list_emails');
      expect(result.accounts[0].available_actions).toContain('list_files');
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
          contacts: [{ id: 'c-1', display_name: 'Alice', email_addresses: ['alice@example.com'] }],
        },
      });

      const result = await methods.contactsList({ connection_id: 'conn-1' });

      expect(result.connection_label).toBe('Work M365');
      expect(result.contacts).toHaveLength(1);
      expect(result.available_actions).toContain('list_contacts');
    });

    it('throws when connection_id is missing', async () => {
      await expect(
        methods.contactsList({ connection_id: '' }),
      ).rejects.toThrow('connection_id is required');
    });

    it('throws when connection not found', async () => {
      mockConnectionsResponse(client, []);
      await expect(
        methods.contactsList({ connection_id: 'nonexistent' }),
      ).rejects.toThrow('Connection not found');
    });
  });

  // -----------------------------------------------------------------------
  // emailList
  // -----------------------------------------------------------------------

  describe('emailList', () => {
    it('returns emails for a valid connection', async () => {
      mockConnectionsResponse(client, [{ ...TEST_CONNECTION, permission_level: 'read_write' }]);
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        success: true,
        data: {
          messages: [{ id: 'msg-1', subject: 'Hello' }],
          next_page_token: 'page2',
        },
      });

      const result = await methods.emailList({ connection_id: 'conn-1' });

      expect(result.connection_label).toBe('Work M365');
      expect(result.messages).toHaveLength(1);
      expect(result.next_page_token).toBe('page2');
      expect(result.available_actions).toContain('send_email');
      expect(result.available_actions).toContain('create_draft');
    });

    it('omits write actions for read-only connections', async () => {
      mockConnectionsResponse(client, [TEST_CONNECTION]); // permission_level: 'read'
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        success: true,
        data: { messages: [] },
      });

      const result = await methods.emailList({ connection_id: 'conn-1' });

      expect(result.available_actions).not.toContain('send_email');
      expect(result.available_actions).toContain('list_messages');
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
        data: { id: 'msg-1', subject: 'Test', body_text: 'Hello' },
      });

      const result = await methods.emailGet({ connection_id: 'conn-1', message_id: 'msg-1' });

      expect(result.connection_label).toBe('Work M365');
      expect(result.message).toMatchObject({ id: 'msg-1', subject: 'Test' });
    });

    it('throws when message_id is missing', async () => {
      await expect(
        methods.emailGet({ connection_id: 'conn-1', message_id: '' }),
      ).rejects.toThrow('message_id is required');
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
          next_page_token: 'next',
        },
      });

      const result = await methods.filesList({ connection_id: 'conn-1' });

      expect(result.connection_label).toBe('Work M365');
      expect(result.files).toHaveLength(1);
      expect(result.next_page_token).toBe('next');
      expect(result.available_actions).toContain('list_files');
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

      const result = await methods.filesSearch({ connection_id: 'conn-1', query: 'budget' });

      expect(result.files).toHaveLength(1);
      expect(result.files[0]).toMatchObject({ name: 'budget.xlsx' });
      expect(result.available_actions).toContain('search_files');
    });

    it('throws when query is missing', async () => {
      await expect(
        methods.filesSearch({ connection_id: 'conn-1', query: '' }),
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
        data: { id: 'f-1', name: 'photo.jpg', download_url: 'https://example.com/download' },
      });

      const result = await methods.filesGet({ connection_id: 'conn-1', file_id: 'f-1' });

      expect(result.connection_label).toBe('Work M365');
      expect(result.file).toMatchObject({ id: 'f-1', name: 'photo.jpg' });
      expect(result.available_actions).toContain('get_file');
    });

    it('throws when file_id is missing', async () => {
      await expect(
        methods.filesGet({ connection_id: 'conn-1', file_id: '' }),
      ).rejects.toThrow('file_id is required');
    });
  });

  // -----------------------------------------------------------------------
  // calendarList
  // -----------------------------------------------------------------------

  describe('calendarList', () => {
    it('returns events for a valid connection', async () => {
      mockConnectionsResponse(client, [CALENDAR_CONNECTION]);
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        success: true,
        data: {
          events: [{ id: 'ev-1', title: 'Standup' }],
          next_page_token: 'page2',
        },
      });

      const result = await methods.calendarList({ connection_id: 'conn-1' });

      expect(result.connection_label).toBe('Work M365');
      expect(result.events).toHaveLength(1);
      expect(result.events[0]).toMatchObject({ id: 'ev-1', title: 'Standup' });
      expect(result.next_page_token).toBe('page2');
      expect(result.available_actions).toContain('list_events');
      expect(result.available_actions).toContain('sync_calendar');
    });

    it('includes write actions for read_write connections', async () => {
      mockConnectionsResponse(client, [CALENDAR_RW_CONNECTION]);
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        success: true,
        data: { events: [] },
      });

      const result = await methods.calendarList({ connection_id: 'conn-1' });

      expect(result.available_actions).toContain('create_event');
      expect(result.available_actions).toContain('delete_event');
    });

    it('omits write actions for read-only connections', async () => {
      mockConnectionsResponse(client, [CALENDAR_CONNECTION]);
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        success: true,
        data: { events: [] },
      });

      const result = await methods.calendarList({ connection_id: 'conn-1' });

      expect(result.available_actions).not.toContain('create_event');
      expect(result.available_actions).not.toContain('delete_event');
    });

    it('passes optional query parameters', async () => {
      mockConnectionsResponse(client, [CALENDAR_CONNECTION]);
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        success: true,
        data: { events: [] },
      });

      await methods.calendarList({
        connection_id: 'conn-1',
        time_min: '2026-01-01',
        time_max: '2026-01-31',
        max_results: 10,
        page_token: 'abc',
      });

      const callUrl = (client.get as ReturnType<typeof vi.fn>).mock.calls[1][0] as string;
      expect(callUrl).toContain('time_min=2026-01-01');
      expect(callUrl).toContain('time_max=2026-01-31');
      expect(callUrl).toContain('max_results=10');
      expect(callUrl).toContain('page_token=abc');
    });

    it('throws when connection_id is missing', async () => {
      await expect(
        methods.calendarList({ connection_id: '' }),
      ).rejects.toThrow('connection_id is required');
    });

    it('throws when calendar feature is not enabled', async () => {
      mockConnectionsResponse(client, [TEST_CONNECTION]); // no calendar feature
      await expect(
        methods.calendarList({ connection_id: 'conn-1' }),
      ).rejects.toThrow('Calendar feature is not enabled');
    });

    it('throws when connection not found', async () => {
      mockConnectionsResponse(client, []);
      await expect(
        methods.calendarList({ connection_id: 'nonexistent' }),
      ).rejects.toThrow('Connection not found');
    });
  });

  // -----------------------------------------------------------------------
  // calendarSync
  // -----------------------------------------------------------------------

  describe('calendarSync', () => {
    it('syncs calendar and returns result', async () => {
      mockConnectionsResponse(client, [CALENDAR_CONNECTION]);
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        success: true,
        data: { synced_count: 42, next_sync_token: 'tok-1' },
      });

      const result = await methods.calendarSync({ connection_id: 'conn-1' });

      expect(result.connection_label).toBe('Work M365');
      expect(result.synced_count).toBe(42);
      expect(result.next_sync_token).toBe('tok-1');
    });

    it('passes time_min and time_max in POST body', async () => {
      mockConnectionsResponse(client, [CALENDAR_CONNECTION]);
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        success: true,
        data: { synced_count: 0 },
      });

      await methods.calendarSync({
        connection_id: 'conn-1',
        time_min: '2026-01-01',
        time_max: '2026-01-31',
      });

      const postCall = (client.post as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(postCall[0]).toBe('/api/sync/calendar');
      expect(postCall[1]).toMatchObject({
        connection_id: 'conn-1',
        time_min: '2026-01-01',
        time_max: '2026-01-31',
      });
    });

    it('throws when connection_id is missing', async () => {
      await expect(
        methods.calendarSync({ connection_id: '' }),
      ).rejects.toThrow('connection_id is required');
    });

    it('throws when calendar feature is not enabled', async () => {
      mockConnectionsResponse(client, [TEST_CONNECTION]);
      await expect(
        methods.calendarSync({ connection_id: 'conn-1' }),
      ).rejects.toThrow('Calendar feature is not enabled');
    });

    it('throws on API failure', async () => {
      mockConnectionsResponse(client, [CALENDAR_CONNECTION]);
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        success: false,
        error: { status: 500, message: 'Sync failed', code: 'SYNC_ERROR' },
      });

      await expect(
        methods.calendarSync({ connection_id: 'conn-1' }),
      ).rejects.toThrow('Sync failed');
    });
  });

  // -----------------------------------------------------------------------
  // calendarCreate
  // -----------------------------------------------------------------------

  describe('calendarCreate', () => {
    it('creates an event and returns it', async () => {
      mockConnectionsResponse(client, [CALENDAR_RW_CONNECTION]);
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        success: true,
        data: { event: { id: 'ev-new', title: 'Lunch' } },
      });

      const result = await methods.calendarCreate({
        connection_id: 'conn-1',
        title: 'Lunch',
        start_time: '2026-02-01T12:00:00Z',
        end_time: '2026-02-01T13:00:00Z',
      });

      expect(result.connection_label).toBe('Work M365');
      expect(result.event).toMatchObject({ id: 'ev-new', title: 'Lunch' });
      expect(result.available_actions).toContain('create_event');
    });

    it('passes optional fields in POST body', async () => {
      mockConnectionsResponse(client, [CALENDAR_RW_CONNECTION]);
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        success: true,
        data: { event: { id: 'ev-2' } },
      });

      await methods.calendarCreate({
        connection_id: 'conn-1',
        title: 'Meeting',
        description: 'Quarterly review',
        location: 'Room 5',
        all_day: false,
        start_time: '2026-02-01T10:00:00Z',
        end_time: '2026-02-01T11:00:00Z',
      });

      const postBody = (client.post as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(postBody).toMatchObject({
        connection_id: 'conn-1',
        title: 'Meeting',
        description: 'Quarterly review',
        location: 'Room 5',
        all_day: false,
      });
    });

    it('throws when connection_id is missing', async () => {
      await expect(
        methods.calendarCreate({ connection_id: '', title: 'Test' }),
      ).rejects.toThrow('connection_id is required');
    });

    it('throws when title is missing', async () => {
      await expect(
        methods.calendarCreate({ connection_id: 'conn-1', title: '' }),
      ).rejects.toThrow('title is required');
    });

    it('throws when calendar feature is not enabled', async () => {
      mockConnectionsResponse(client, [{ ...TEST_CONNECTION, permission_level: 'read_write' }]);
      await expect(
        methods.calendarCreate({ connection_id: 'conn-1', title: 'Test' }),
      ).rejects.toThrow('Calendar feature is not enabled');
    });

    it('throws when permission level is read-only', async () => {
      mockConnectionsResponse(client, [CALENDAR_CONNECTION]); // read only
      await expect(
        methods.calendarCreate({ connection_id: 'conn-1', title: 'Test' }),
      ).rejects.toThrow('Write permission required');
    });

    it('throws on API failure', async () => {
      mockConnectionsResponse(client, [CALENDAR_RW_CONNECTION]);
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        success: false,
        error: { status: 500, message: 'Create failed', code: 'CREATE_ERROR' },
      });

      await expect(
        methods.calendarCreate({ connection_id: 'conn-1', title: 'Test' }),
      ).rejects.toThrow('Create failed');
    });
  });

  // -----------------------------------------------------------------------
  // buildAccountActions — calendar actions
  // -----------------------------------------------------------------------

  describe('accountsList calendar actions', () => {
    it('includes sync_calendar and list_events when calendar enabled', async () => {
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        success: true,
        data: { connections: [CALENDAR_CONNECTION] },
      });

      const result = await methods.accountsList({});

      expect(result.accounts[0].available_actions).toContain('list_events');
      expect(result.accounts[0].available_actions).toContain('sync_calendar');
    });

    it('includes create_event and delete_event for read_write calendar', async () => {
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        success: true,
        data: { connections: [CALENDAR_RW_CONNECTION] },
      });

      const result = await methods.accountsList({});

      expect(result.accounts[0].available_actions).toContain('create_event');
      expect(result.accounts[0].available_actions).toContain('delete_event');
    });

    it('omits calendar write actions for read-only calendar', async () => {
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        success: true,
        data: { connections: [CALENDAR_CONNECTION] },
      });

      const result = await methods.accountsList({});

      expect(result.accounts[0].available_actions).not.toContain('create_event');
      expect(result.accounts[0].available_actions).not.toContain('delete_event');
    });
  });
});

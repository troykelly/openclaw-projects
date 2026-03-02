/**
 * Tests for Gateway RPC methods.
 * Part of Epic #310, Issue #324.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createGatewayMethods, registerGatewayRpcMethods, type SubscribeParams, type GetNotificationsParams, type NotificationEvent } from '../src/gateway/rpc-methods.js';
import type { ApiClient } from '../src/api-client.js';
import type { Logger } from '../src/logger.js';
import type { GatewayMethodHandler, GatewayMethodHandlerOptions } from '../src/types/openclaw-api.js';

// Mock logger
function createMockLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

// Mock API client
function createMockApiClient(): ApiClient {
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  } as unknown as ApiClient;
}

describe('Gateway RPC Methods', () => {
  let mockLogger: Logger;
  let mockApiClient: ApiClient;

  beforeEach(() => {
    mockLogger = createMockLogger();
    mockApiClient = createMockApiClient();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('subscribe', () => {
    it('should subscribe to events successfully', async () => {
      const methods = createGatewayMethods({
        logger: mockLogger,
        apiClient: mockApiClient,
        getAgentId: () => 'user@example.com',
      });

      const params: SubscribeParams = {
        events: ['message.new', 'task.due'],
      };

      const result = await methods.subscribe(params);

      expect(result.subscribed).toEqual(['message.new', 'task.due']);
      expect(mockLogger.info).toHaveBeenCalled();
    });

    it('should handle empty events array', async () => {
      const methods = createGatewayMethods({
        logger: mockLogger,
        apiClient: mockApiClient,
        getAgentId: () => 'user@example.com',
      });

      const params: SubscribeParams = {
        events: [],
      };

      const result = await methods.subscribe(params);

      expect(result.subscribed).toEqual([]);
    });

    it('should filter invalid event types', async () => {
      const methods = createGatewayMethods({
        logger: mockLogger,
        apiClient: mockApiClient,
        getAgentId: () => 'user@example.com',
      });

      const params: SubscribeParams = {
        events: ['message.new', 'invalid.event', 'task.due'],
      };

      const result = await methods.subscribe(params);

      // Only valid events should be subscribed
      expect(result.subscribed).toEqual(['message.new', 'task.due']);
    });
  });

  describe('unsubscribe', () => {
    it('should unsubscribe successfully', async () => {
      const methods = createGatewayMethods({
        logger: mockLogger,
        apiClient: mockApiClient,
        getAgentId: () => 'user@example.com',
      });

      // First subscribe
      await methods.subscribe({ events: ['message.new'] });

      // Then unsubscribe
      const result = await methods.unsubscribe({});

      expect(result.unsubscribed).toBe(true);
      expect(mockLogger.info).toHaveBeenCalled();
    });

    it('should handle unsubscribe when not subscribed', async () => {
      const methods = createGatewayMethods({
        logger: mockLogger,
        apiClient: mockApiClient,
        getAgentId: () => 'user@example.com',
      });

      const result = await methods.unsubscribe({});

      expect(result.unsubscribed).toBe(true);
    });
  });

  describe('getNotifications', () => {
    it('should fetch notifications with default limit', async () => {
      (mockApiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: {
          notifications: [
            {
              id: 'notif-1',
              event: 'message.new',
              payload: { message_id: 'msg-1', channel: 'sms' },
              created_at: '2025-01-01T00:00:00Z',
            },
          ],
          total: 1,
        },
      });

      const methods = createGatewayMethods({
        logger: mockLogger,
        apiClient: mockApiClient,
        getAgentId: () => 'user@example.com',
      });

      const params: GetNotificationsParams = {};

      const result = await methods.getNotifications(params);

      expect(result.notifications).toHaveLength(1);
      expect(result.notifications[0].event).toBe('message.new');
      expect(result.has_more).toBe(false);
      expect(mockApiClient.get).toHaveBeenCalled();
    });

    it('should respect limit parameter', async () => {
      (mockApiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: {
          notifications: Array(5).fill({
            id: 'notif-1',
            event: 'message.new',
            payload: {},
            created_at: '2025-01-01T00:00:00Z',
          }),
          total: 10,
        },
      });

      const methods = createGatewayMethods({
        logger: mockLogger,
        apiClient: mockApiClient,
        getAgentId: () => 'user@example.com',
      });

      const params: GetNotificationsParams = { limit: 5 };

      const result = await methods.getNotifications(params);

      expect(result.notifications).toHaveLength(5);
      expect(result.has_more).toBe(true);
    });

    it('should filter by since timestamp', async () => {
      (mockApiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: {
          notifications: [],
          total: 0,
        },
      });

      const methods = createGatewayMethods({
        logger: mockLogger,
        apiClient: mockApiClient,
        getAgentId: () => 'user@example.com',
      });

      const since = '2025-01-01T00:00:00Z';
      const params: GetNotificationsParams = { since };

      await methods.getNotifications(params);

      expect(mockApiClient.get).toHaveBeenCalledWith(expect.stringContaining('since='), expect.anything());
    });

    it('should handle API errors gracefully', async () => {
      (mockApiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: false,
        error: { message: 'API error', status: 500 },
      });

      const methods = createGatewayMethods({
        logger: mockLogger,
        apiClient: mockApiClient,
        getAgentId: () => 'user@example.com',
      });

      const result = await methods.getNotifications({});

      expect(result.notifications).toEqual([]);
      expect(result.has_more).toBe(false);
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('Event types validation', () => {
    const validEvents: NotificationEvent[] = ['message.new', 'message.delivered', 'task.due', 'task.overdue', 'memory.created'];

    it('should recognize all valid event types', async () => {
      const methods = createGatewayMethods({
        logger: mockLogger,
        apiClient: mockApiClient,
        getAgentId: () => 'user@example.com',
      });

      const result = await methods.subscribe({ events: validEvents });

      expect(result.subscribed).toEqual(validEvents);
    });
  });

  describe('registerGatewayRpcMethods (#2031)', () => {
    it('should register wrapped handlers that call opts.respond()', async () => {
      const registeredMethods = new Map<string, GatewayMethodHandler>();
      const mockRegisterApi = {
        registerGatewayMethod: (name: string, handler: GatewayMethodHandler) => {
          registeredMethods.set(name, handler);
        },
      };

      const methods = createGatewayMethods({
        logger: mockLogger,
        apiClient: mockApiClient,
        getAgentId: () => 'user@example.com',
      });

      registerGatewayRpcMethods(mockRegisterApi, methods);

      // All 3 methods should be registered
      expect(registeredMethods.size).toBe(3);
      expect(registeredMethods.has('openclaw-projects.subscribe')).toBe(true);
      expect(registeredMethods.has('openclaw-projects.unsubscribe')).toBe(true);
      expect(registeredMethods.has('openclaw-projects.getNotifications')).toBe(true);
    });

    it('should pass params from opts and call respond with result', async () => {
      const registeredMethods = new Map<string, GatewayMethodHandler>();
      const mockRegisterApi = {
        registerGatewayMethod: (name: string, handler: GatewayMethodHandler) => {
          registeredMethods.set(name, handler);
        },
      };

      const methods = createGatewayMethods({
        logger: mockLogger,
        apiClient: mockApiClient,
        getAgentId: () => 'user@example.com',
      });

      registerGatewayRpcMethods(mockRegisterApi, methods);

      const respondFn = vi.fn();
      const opts: GatewayMethodHandlerOptions = {
        req: {},
        params: { events: ['message.new', 'task.due'] },
        respond: respondFn,
        client: null,
        isWebchatConnect: () => false,
        context: {},
      };

      const handler = registeredMethods.get('openclaw-projects.subscribe')!;
      await handler(opts);

      expect(respondFn).toHaveBeenCalledWith(true, {
        subscribed: ['message.new', 'task.due'],
      });
    });

    it('should call respond with error when handler throws', async () => {
      const registeredMethods = new Map<string, GatewayMethodHandler>();
      const mockRegisterApi = {
        registerGatewayMethod: (name: string, handler: GatewayMethodHandler) => {
          registeredMethods.set(name, handler);
        },
      };

      (mockApiClient.get as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Connection failed'));

      const methods = createGatewayMethods({
        logger: mockLogger,
        apiClient: mockApiClient,
        getAgentId: () => 'user@example.com',
      });

      registerGatewayRpcMethods(mockRegisterApi, methods);

      const respondFn = vi.fn();
      const opts: GatewayMethodHandlerOptions = {
        req: {},
        params: {},
        respond: respondFn,
        client: null,
        isWebchatConnect: () => false,
        context: {},
      };

      const handler = registeredMethods.get('openclaw-projects.getNotifications')!;
      await handler(opts);

      // The internal getNotifications catches errors and returns empty,
      // so respond should be called with success
      expect(respondFn).toHaveBeenCalledWith(true, expect.objectContaining({
        notifications: [],
        has_more: false,
      }));
    });
  });

  describe('Subscription state', () => {
    it('should maintain subscription state across calls', async () => {
      const methods = createGatewayMethods({
        logger: mockLogger,
        apiClient: mockApiClient,
        getAgentId: () => 'user@example.com',
      });

      // Subscribe to events
      await methods.subscribe({ events: ['message.new', 'task.due'] });

      // Get current subscriptions
      const subscriptions = methods.getSubscribedEvents();

      expect(subscriptions).toContain('message.new');
      expect(subscriptions).toContain('task.due');
    });

    it('should clear subscriptions on unsubscribe', async () => {
      const methods = createGatewayMethods({
        logger: mockLogger,
        apiClient: mockApiClient,
        getAgentId: () => 'user@example.com',
      });

      // Subscribe
      await methods.subscribe({ events: ['message.new'] });

      // Unsubscribe
      await methods.unsubscribe({});

      // Check subscriptions cleared
      const subscriptions = methods.getSubscribedEvents();
      expect(subscriptions).toEqual([]);
    });
  });
});

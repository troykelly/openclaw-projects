/**
 * Gateway RPC methods for real-time updates.
 * Part of Epic #310, Issue #324.
 *
 * Provides bidirectional communication between OpenClaw agents and
 * the openclaw-projects backend via the Gateway protocol.
 *
 * @see https://docs.openclaw.ai/gateway/protocol.md
 */

import type { ApiClient } from '../api-client.js';
import type { Logger } from '../logger.js';

/** Valid notification event types */
export type NotificationEvent = 'message.new' | 'message.delivered' | 'task.due' | 'task.overdue' | 'memory.created';

/** All valid event types for validation */
const VALID_EVENTS: NotificationEvent[] = ['message.new', 'message.delivered', 'task.due', 'task.overdue', 'memory.created'];

/** Subscribe method parameters */
export interface SubscribeParams {
  /** Event types to subscribe to */
  events: string[];
}

/** Subscribe method result */
export interface SubscribeResult {
  /** Events successfully subscribed to */
  subscribed: NotificationEvent[];
}

/** Unsubscribe method parameters — empty: unsubscribes from all events */
export type UnsubscribeParams = Record<string, never>;

/** Unsubscribe method result */
export interface UnsubscribeResult {
  /** Whether unsubscribe was successful */
  unsubscribed: boolean;
}

/** Get notifications parameters */
export interface GetNotificationsParams {
  /** ISO timestamp to get notifications since */
  since?: string;
  /** Maximum notifications to return (default: 20) */
  limit?: number;
}

/** Notification object */
export interface Notification {
  /** Unique notification ID */
  id: string;
  /** Event type */
  event: NotificationEvent;
  /** Event-specific payload */
  payload: Record<string, unknown>;
  /** When the notification was created */
  createdAt: string;
}

/** Get notifications result */
export interface GetNotificationsResult {
  /** Notifications matching the query */
  notifications: Notification[];
  /** Whether there are more notifications available */
  hasMore: boolean;
}

/** Options for creating gateway methods */
export interface GatewayMethodsOptions {
  /** Logger instance */
  logger: Logger;
  /** API client for backend calls */
  apiClient: ApiClient;
  /** User ID for scoping */
  userId: string;
}

/** Gateway methods interface */
export interface GatewayMethods {
  /** Subscribe to event notifications */
  subscribe: (params: SubscribeParams) => Promise<SubscribeResult>;
  /** Unsubscribe from all event notifications */
  unsubscribe: (params: UnsubscribeParams) => Promise<UnsubscribeResult>;
  /** Get pending notifications */
  getNotifications: (params: GetNotificationsParams) => Promise<GetNotificationsResult>;
  /** Get currently subscribed events (for internal use) */
  getSubscribedEvents: () => NotificationEvent[];
}

/**
 * Validate event types and filter to only valid ones.
 *
 * @param events - Array of event type strings
 * @returns Array of valid NotificationEvent types
 */
function filterValidEvents(events: string[]): NotificationEvent[] {
  return events.filter((e): e is NotificationEvent => VALID_EVENTS.includes(e as NotificationEvent));
}

/**
 * Create Gateway RPC method handlers.
 *
 * @param options - Configuration options
 * @returns Gateway method handlers
 */
export function createGatewayMethods(options: GatewayMethodsOptions): GatewayMethods {
  const { logger, apiClient, userId } = options;

  // Local subscription state
  let subscribedEvents: NotificationEvent[] = [];

  return {
    /**
     * Subscribe to event notifications.
     *
     * Registers the user to receive notifications for specified event types.
     * Invalid event types are filtered out.
     */
    async subscribe(params: SubscribeParams): Promise<SubscribeResult> {
      const validEvents = filterValidEvents(params.events);

      // Update local subscription state
      subscribedEvents = validEvents;

      logger.info('Gateway subscribe', {
        userId,
        requestedEvents: params.events,
        subscribedEvents: validEvents,
      });

      return {
        subscribed: validEvents,
      };
    },

    /**
     * Unsubscribe from all event notifications.
     */
    async unsubscribe(_params: UnsubscribeParams): Promise<UnsubscribeResult> {
      const previousEvents = subscribedEvents;

      // Clear local subscription state
      subscribedEvents = [];

      logger.info('Gateway unsubscribe', {
        userId,
        previousEvents,
      });

      return {
        unsubscribed: true,
      };
    },

    /**
     * Get pending notifications for the user.
     *
     * Fetches notifications from the backend, optionally filtered by timestamp.
     */
    async getNotifications(params: GetNotificationsParams): Promise<GetNotificationsResult> {
      const { since, limit = 20 } = params;

      logger.debug('Gateway getNotifications', {
        userId,
        since,
        limit,
      });

      try {
        // Build query parameters
        const queryParams = new URLSearchParams();
        queryParams.set('limit', String(limit));
        if (since) {
          queryParams.set('since', since);
        }

        const response = await apiClient.get<{
          notifications: Notification[];
          total: number;
        }>(`/api/notifications?${queryParams}`, { userId });

        if (!response.success) {
          logger.error('Gateway getNotifications API error', {
            userId,
            error: response.error.message,
          });
          return {
            notifications: [],
            hasMore: false,
          };
        }

        const { notifications, total } = response.data;

        logger.debug('Gateway getNotifications success', {
          userId,
          count: notifications.length,
          total,
        });

        return {
          notifications,
          hasMore: notifications.length >= limit && total > notifications.length,
        };
      } catch (error) {
        logger.error('Gateway getNotifications failed', {
          userId,
          error: error instanceof Error ? error.message : String(error),
        });

        return {
          notifications: [],
          hasMore: false,
        };
      }
    },

    /**
     * Get currently subscribed events.
     *
     * Internal method for checking subscription state.
     */
    getSubscribedEvents(): NotificationEvent[] {
      return [...subscribedEvents];
    },
  };
}

/**
 * Register Gateway RPC methods with the OpenClaw API.
 *
 * @param api - OpenClaw Plugin API
 * @param methods - Gateway method handlers
 */
export function registerGatewayRpcMethods(
  api: {
    registerGatewayMethod: <T, R>(name: string, handler: (params: T) => Promise<R>) => void;
  },
  methods: GatewayMethods,
): void {
  api.registerGatewayMethod<SubscribeParams, SubscribeResult>('openclaw-projects.subscribe', methods.subscribe);

  api.registerGatewayMethod<UnsubscribeParams, UnsubscribeResult>('openclaw-projects.unsubscribe', methods.unsubscribe);

  api.registerGatewayMethod<GetNotificationsParams, GetNotificationsResult>('openclaw-projects.getNotifications', methods.getNotifications);
}

/**
 * Background notification service for the OpenClaw plugin.
 * Part of Epic #310, Issue #325.
 *
 * Polls the backend for new notifications and emits events to the agent.
 *
 * @see https://docs.openclaw.ai/plugin.md#background-services
 */

import type { ApiClient } from '../api-client.js';
import type { Logger } from '../logger.js';
import type { Notification, NotificationEvent } from '../gateway/rpc-methods.js';
import type { ServiceDefinition } from '../types/openclaw-api.js';

/** Configuration for the notification service */
export interface NotificationServiceConfig {
  /** Whether the service is enabled (default: true) */
  enabled?: boolean;
  /** Polling interval in milliseconds (default: 30000) */
  pollIntervalMs?: number;
  /** Reconnect delay in milliseconds for future WebSocket support (default: 5000) */
  reconnectDelayMs?: number;
}

/** Event emitter interface for notification events */
export interface NotificationServiceEvents {
  /** Emit an event */
  emit: (event: string, payload: unknown) => void;
  /** Add event listener */
  on: (event: string, handler: (payload: unknown) => void) => void;
  /** Remove event listener */
  off: (event: string, handler: (payload: unknown) => void) => void;
}

/** Options for creating the notification service */
export interface NotificationServiceOptions {
  /** Logger instance */
  logger: Logger;
  /** API client for backend communication */
  apiClient: ApiClient;
  /** Getter for current user ID (reads from mutable state, Issue #1644) */
  getAgentId: () => string;
  /** Event emitter for notifications */
  events: NotificationServiceEvents;
  /** Service configuration */
  config?: NotificationServiceConfig;
}

/** Notification service interface with state accessors */
export interface NotificationService extends ServiceDefinition {
  /** Check if the service is currently running */
  isRunning: () => boolean;
  /** Get the timestamp of the last successful poll */
  getLastPollTime: () => Date | null;
}

/** Default configuration values */
const DEFAULT_CONFIG: Required<NotificationServiceConfig> = {
  enabled: true,
  pollIntervalMs: 30000,
  reconnectDelayMs: 5000,
};

/** Map notification event types to emitted event names */
const EVENT_MAP: Record<NotificationEvent, string> = {
  'message.new': 'projects:message',
  'message.delivered': 'projects:message-status',
  'task.due': 'projects:task-due',
  'task.overdue': 'projects:task-overdue',
  'memory.created': 'projects:memory',
};

/**
 * Create a notification background service.
 *
 * This service polls the backend for new notifications and emits
 * corresponding events to the agent.
 *
 * @param options - Service configuration options
 * @returns Service definition for registration
 */
export function createNotificationService(options: NotificationServiceOptions): NotificationService {
  const { logger, apiClient, getAgentId, events, config: userConfig } = options;
  const config = { ...DEFAULT_CONFIG, ...userConfig };

  // Service state
  let running = false;
  let pollingInterval: ReturnType<typeof setInterval> | null = null;
  let lastPollTime: Date | null = null;
  let lastSeenId: string | null = null;

  /**
   * Handle a notification from the backend.
   */
  function handleNotification(notification: Notification): void {
    const user_id = getAgentId();
    const eventName = EVENT_MAP[notification.event];
    if (!eventName) {
      logger.warn('Unknown notification event type', {
        user_id,
        event: notification.event,
      });
      return;
    }

    logger.debug('Emitting notification event', {
      user_id,
      event: notification.event,
      notificationId: notification.id,
    });

    events.emit(eventName, notification.payload);
  }

  /**
   * Poll the backend for new notifications.
   */
  async function poll(): Promise<void> {
    const user_id = getAgentId();
    try {
      const queryParams = new URLSearchParams();
      queryParams.set('limit', '20');
      if (lastSeenId) {
        // "since" is a notification ID (not a timestamp) — the backend returns
        // only notifications created after this ID, providing cursor-based pagination.
        queryParams.set('since', lastSeenId);
      }

      const response = await apiClient.get<{
        notifications: Notification[];
        total: number;
      }>(`/api/notifications?${queryParams}`, { user_id });

      if (!response.success) {
        logger.error('Notification poll failed', {
          user_id,
          error: response.error.message,
        });
        return;
      }

      const { notifications } = response.data;

      // Process notifications
      for (const notification of notifications) {
        handleNotification(notification);
        lastSeenId = notification.id;
      }

      lastPollTime = new Date();

      logger.debug('Notification poll completed', {
        user_id,
        count: notifications.length,
      });
    } catch (error) {
      logger.error('Notification poll failed', {
        user_id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    id: 'projects-notifier',

    /**
     * Start the notification service.
     */
    async start(): Promise<void> {
      const user_id = getAgentId();
      if (!config.enabled) {
        logger.debug('Notification service disabled', { user_id });
        return;
      }

      if (running) {
        logger.debug('Notification service already running', { user_id });
        return;
      }

      running = true;

      logger.info('Starting notification service', {
        user_id,
        pollIntervalMs: config.pollIntervalMs,
      });

      // Poll immediately on start, then at the configured interval
      poll();
      pollingInterval = setInterval(() => {
        poll();
      }, config.pollIntervalMs);
    },

    /**
     * Stop the notification service.
     */
    async stop(): Promise<void> {
      if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
      }

      running = false;

      logger.info('Notification service stopped', { user_id: getAgentId() });
    },

    /**
     * Check if the service is currently running.
     */
    isRunning(): boolean {
      return running;
    },

    /**
     * Get the timestamp of the last successful poll.
     */
    getLastPollTime(): Date | null {
      return lastPollTime;
    },
  };
}

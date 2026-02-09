/**
 * Tests for notification background service.
 * Part of Epic #310, Issue #325.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createNotificationService,
  type NotificationServiceConfig,
  type NotificationServiceEvents,
} from '../../src/services/notification-service.js'
import type { NotificationEvent } from '../../src/gateway/rpc-methods.js'
import type { ApiClient } from '../../src/api-client.js'
import type { Logger } from '../../src/logger.js'

// Mock logger
function createMockLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }
}

// Mock API client
function createMockApiClient(): ApiClient {
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  } as unknown as ApiClient
}

// Mock event emitter
function createMockEmitter(): NotificationServiceEvents {
  return {
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  }
}

describe('Notification Service', () => {
  let mockLogger: Logger
  let mockApiClient: ApiClient
  let mockEmitter: NotificationServiceEvents

  beforeEach(() => {
    vi.useFakeTimers()
    mockLogger = createMockLogger()
    mockApiClient = createMockApiClient()
    mockEmitter = createMockEmitter()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  describe('Service Creation', () => {
    it('should create a service with default configuration', () => {
      const service = createNotificationService({
        logger: mockLogger,
        apiClient: mockApiClient,
        userId: 'user@example.com',
        events: mockEmitter,
      })

      expect(service).toBeDefined()
      expect(service.id).toBe('projects-notifier')
      expect(typeof service.start).toBe('function')
      expect(typeof service.stop).toBe('function')
    })

    it('should accept custom configuration', () => {
      const config: NotificationServiceConfig = {
        enabled: true,
        pollIntervalMs: 60000,
        reconnectDelayMs: 10000,
      }

      const service = createNotificationService({
        logger: mockLogger,
        apiClient: mockApiClient,
        userId: 'user@example.com',
        events: mockEmitter,
        config,
      })

      expect(service).toBeDefined()
    })
  })

  describe('Service Lifecycle', () => {
    it('should start service and begin polling', async () => {
      (mockApiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: { notifications: [], total: 0 },
      })

      const service = createNotificationService({
        logger: mockLogger,
        apiClient: mockApiClient,
        userId: 'user@example.com',
        events: mockEmitter,
        config: { enabled: true, pollIntervalMs: 5000 },
      })

      await service.start()

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Starting notification service'),
        expect.anything()
      )
    })

    it('should poll immediately on start', async () => {
      (mockApiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: { notifications: [], total: 0 },
      })

      const service = createNotificationService({
        logger: mockLogger,
        apiClient: mockApiClient,
        userId: 'user@example.com',
        events: mockEmitter,
        config: { enabled: true, pollIntervalMs: 60000 },
      })

      await service.start()
      // Flush the microtask queue so the poll() promise resolves
      await vi.advanceTimersByTimeAsync(0)

      // Should have polled immediately without waiting for interval
      expect(mockApiClient.get).toHaveBeenCalledTimes(1)
      expect(mockApiClient.get).toHaveBeenCalledWith(
        expect.stringContaining('/api/notifications'),
        expect.anything()
      )
    })

    it('should stop service cleanly', async () => {
      const service = createNotificationService({
        logger: mockLogger,
        apiClient: mockApiClient,
        userId: 'user@example.com',
        events: mockEmitter,
        config: { enabled: true },
      })

      await service.start()
      await service.stop()

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Notification service stopped'),
        expect.anything()
      )
    })

    it('should not start if disabled', async () => {
      const service = createNotificationService({
        logger: mockLogger,
        apiClient: mockApiClient,
        userId: 'user@example.com',
        events: mockEmitter,
        config: { enabled: false },
      })

      await service.start()

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Notification service disabled'),
        expect.anything()
      )
    })
  })

  describe('Polling Behavior', () => {
    it('should poll for notifications at configured interval', async () => {
      (mockApiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: { notifications: [], total: 0 },
      })

      const service = createNotificationService({
        logger: mockLogger,
        apiClient: mockApiClient,
        userId: 'user@example.com',
        events: mockEmitter,
        config: { enabled: true, pollIntervalMs: 5000 },
      })

      await service.start()

      // Fast-forward time
      await vi.advanceTimersByTimeAsync(5000)

      expect(mockApiClient.get).toHaveBeenCalled()
    })

    it('should emit events for new notifications', async () => {
      const notifications = [
        {
          id: 'notif-1',
          event: 'message.new' as const,
          payload: { messageId: 'msg-1', channel: 'sms' },
          createdAt: '2025-01-01T00:00:00Z',
        },
      ]

      ;(mockApiClient.get as ReturnType<typeof vi.fn>)
        .mockResolvedValue({
          success: true,
          data: { notifications, total: 1 },
        })

      const service = createNotificationService({
        logger: mockLogger,
        apiClient: mockApiClient,
        userId: 'user@example.com',
        events: mockEmitter,
        config: { enabled: true, pollIntervalMs: 5000 },
      })

      await service.start()

      // Fast-forward to trigger poll
      await vi.advanceTimersByTimeAsync(5000)

      expect(mockEmitter.emit).toHaveBeenCalledWith(
        'projects:message',
        expect.objectContaining({ messageId: 'msg-1' })
      )
    })

    it('should handle poll errors gracefully', async () => {
      (mockApiClient.get as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Network error')
      )

      const service = createNotificationService({
        logger: mockLogger,
        apiClient: mockApiClient,
        userId: 'user@example.com',
        events: mockEmitter,
        config: { enabled: true, pollIntervalMs: 5000 },
      })

      await service.start()

      // Fast-forward to trigger poll
      await vi.advanceTimersByTimeAsync(5000)

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('poll failed'),
        expect.anything()
      )
    })
  })

  describe('Event Mapping', () => {
    const testCases: Array<{ event: NotificationEvent; expectedEmit: string }> = [
      { event: 'message.new', expectedEmit: 'projects:message' },
      { event: 'message.delivered', expectedEmit: 'projects:message-status' },
      { event: 'task.due', expectedEmit: 'projects:task-due' },
      { event: 'task.overdue', expectedEmit: 'projects:task-overdue' },
      { event: 'memory.created', expectedEmit: 'projects:memory' },
    ]

    for (const { event, expectedEmit } of testCases) {
      it(`should map ${event} to ${expectedEmit}`, async () => {
        const notifications = [
          {
            id: 'notif-1',
            event,
            payload: { id: 'test-id' },
            createdAt: '2025-01-01T00:00:00Z',
          },
        ]

        ;(mockApiClient.get as ReturnType<typeof vi.fn>)
          .mockResolvedValue({
            success: true,
            data: { notifications, total: 1 },
          })

        const service = createNotificationService({
          logger: mockLogger,
          apiClient: mockApiClient,
          userId: 'user@example.com',
          events: mockEmitter,
          config: { enabled: true, pollIntervalMs: 5000 },
        })

        await service.start()
        await vi.advanceTimersByTimeAsync(5000)

        expect(mockEmitter.emit).toHaveBeenCalledWith(
          expectedEmit,
          expect.anything()
        )
      })
    }
  })

  describe('Service State', () => {
    it('should track running state', async () => {
      const service = createNotificationService({
        logger: mockLogger,
        apiClient: mockApiClient,
        userId: 'user@example.com',
        events: mockEmitter,
        config: { enabled: true },
      })

      expect(service.isRunning()).toBe(false)

      await service.start()
      expect(service.isRunning()).toBe(true)

      await service.stop()
      expect(service.isRunning()).toBe(false)
    })

    it('should not start if already running', async () => {
      const service = createNotificationService({
        logger: mockLogger,
        apiClient: mockApiClient,
        userId: 'user@example.com',
        events: mockEmitter,
        config: { enabled: true },
      })

      await service.start()
      await service.start() // Second call should be no-op

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('already running'),
        expect.anything()
      )
    })

    it('should track last poll timestamp', async () => {
      (mockApiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: { notifications: [], total: 0 },
      })

      const service = createNotificationService({
        logger: mockLogger,
        apiClient: mockApiClient,
        userId: 'user@example.com',
        events: mockEmitter,
        config: { enabled: true, pollIntervalMs: 5000 },
      })

      expect(service.getLastPollTime()).toBeNull()

      await service.start()
      // Flush the initial poll
      await vi.advanceTimersByTimeAsync(0)

      // Should be set after the initial poll
      expect(service.getLastPollTime()).toBeDefined()
    })
  })
})

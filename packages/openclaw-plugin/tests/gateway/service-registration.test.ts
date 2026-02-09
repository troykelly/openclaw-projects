/**
 * Gateway Integration Tests: Service Registration
 * Tests notification service registration.
 */

import { describe, it, expect } from 'vitest';
import { loadOpenClawPlugins } from 'openclaw/dist/plugins/loader.js';
import { createTestLogger, createTestConfig } from './setup.js';

describe('Gateway Service Registration', () => {
  it('should register notification service', () => {
    const logger = createTestLogger();
    const config = createTestConfig();

    const registry = loadOpenClawPlugins({ config, cache: false, logger });
    const plugin = registry.plugins.get('openclaw-projects');

    expect(plugin).toBeDefined();
    expect(plugin?.services).toBeDefined();

    const services = plugin?.services ?? {};
    expect(services.notification).toBeDefined();
  });

  it('should have start and stop methods on notification service', () => {
    const logger = createTestLogger();
    const config = createTestConfig();

    const registry = loadOpenClawPlugins({ config, cache: false, logger });
    const plugin = registry.plugins.get('openclaw-projects');

    expect(plugin).toBeDefined();

    const services = plugin?.services ?? {};
    const notificationService = services.notification;

    expect(notificationService).toBeDefined();
    expect(notificationService?.start).toBeDefined();
    expect(typeof notificationService?.start).toBe('function');
    expect(notificationService?.stop).toBeDefined();
    expect(typeof notificationService?.stop).toBe('function');
  });
});

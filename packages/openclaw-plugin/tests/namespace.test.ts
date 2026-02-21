/**
 * Tests for namespace configuration (Issue #1428).
 *
 * Validates:
 * - Config schema accepts namespace as object or string
 * - resolveNamespaceConfig applies fallback logic
 * - Tool schemas include namespace/namespaces params
 * - Tool handlers pass namespace to API calls
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  validateConfig,
  safeValidateRawConfig,
  resolveNamespaceConfig,
  type PluginConfig,
} from '../src/config.js';

describe('Namespace Configuration (Issue #1428)', () => {
  describe('resolveNamespaceConfig', () => {
    it('should use explicit default and recall from config', () => {
      const result = resolveNamespaceConfig(
        { default: 'arthouse', recall: ['arthouse', 'shared'] },
        'some-agent',
      );
      expect(result.default).toBe('arthouse');
      expect(result.recall).toEqual(['arthouse', 'shared']);
    });

    it('should default recall to [default] when recall not specified', () => {
      const result = resolveNamespaceConfig(
        { default: 'arthouse' },
        'some-agent',
      );
      expect(result.default).toBe('arthouse');
      expect(result.recall).toEqual(['arthouse']);
    });

    it('should fall back to agent ID as namespace when no config', () => {
      const result = resolveNamespaceConfig(undefined, 'arthouse');
      expect(result.default).toBe('arthouse');
      expect(result.recall).toEqual(['arthouse']);
    });

    it('should fall back to "default" when agent ID has invalid chars', () => {
      const result = resolveNamespaceConfig(undefined, 'Agent With Spaces');
      expect(result.default).toBe('default');
      expect(result.recall).toEqual(['default']);
    });

    it('should fall back to "default" when agent ID starts with hyphen', () => {
      const result = resolveNamespaceConfig(undefined, '-invalid');
      expect(result.default).toBe('default');
      expect(result.recall).toEqual(['default']);
    });

    it('should accept agent ID with dots, hyphens, underscores', () => {
      const result = resolveNamespaceConfig(undefined, 'my-agent.v2_test');
      expect(result.default).toBe('my-agent.v2_test');
      expect(result.recall).toEqual(['my-agent.v2_test']);
    });

    it('should accept agent ID starting with digit', () => {
      const result = resolveNamespaceConfig(undefined, '42agent');
      expect(result.default).toBe('42agent');
      expect(result.recall).toEqual(['42agent']);
    });

    it('should use explicit recall even when default is from agent ID fallback', () => {
      const result = resolveNamespaceConfig(
        { recall: ['ns1', 'ns2'] },
        'arthouse',
      );
      // No explicit default, so falls back to agent ID
      expect(result.default).toBe('arthouse');
      expect(result.recall).toEqual(['ns1', 'ns2']);
    });
  });

  describe('Config schema', () => {
    it('should accept namespace as object with default and recall', () => {
      const result = safeValidateRawConfig({
        apiUrl: 'https://example.com',
        apiKey: 'test-key',
        namespace: {
          default: 'arthouse',
          recall: ['arthouse', 'shared'],
        },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.namespace).toEqual({
          default: 'arthouse',
          recall: ['arthouse', 'shared'],
        });
      }
    });

    it('should accept namespace as bare string (backward compat)', () => {
      const result = safeValidateRawConfig({
        apiUrl: 'https://example.com',
        apiKey: 'test-key',
        namespace: 'personal',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        // String is transformed to { default: value }
        expect(result.data.namespace).toEqual({ default: 'personal' });
      }
    });

    it('should accept config without namespace (undefined)', () => {
      const result = safeValidateRawConfig({
        apiUrl: 'https://example.com',
        apiKey: 'test-key',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.namespace).toBeUndefined();
      }
    });

    it('should reject invalid namespace pattern', () => {
      const result = safeValidateRawConfig({
        apiUrl: 'https://example.com',
        apiKey: 'test-key',
        namespace: 'UPPERCASE',
      });
      expect(result.success).toBe(false);
    });

    it('should reject namespace with spaces', () => {
      const result = safeValidateRawConfig({
        apiUrl: 'https://example.com',
        apiKey: 'test-key',
        namespace: 'has spaces',
      });
      expect(result.success).toBe(false);
    });

    it('should reject namespace object with invalid default pattern', () => {
      const result = safeValidateRawConfig({
        apiUrl: 'https://example.com',
        apiKey: 'test-key',
        namespace: { default: 'INVALID' },
      });
      expect(result.success).toBe(false);
    });

    it('should reject namespace object with invalid recall entry', () => {
      const result = safeValidateRawConfig({
        apiUrl: 'https://example.com',
        apiKey: 'test-key',
        namespace: { default: 'valid', recall: ['also-valid', 'NOT VALID'] },
      });
      expect(result.success).toBe(false);
    });

    it('should accept userScoping as optional (deprecated)', () => {
      const result = safeValidateRawConfig({
        apiUrl: 'https://example.com',
        apiKey: 'test-key',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.userScoping).toBeUndefined();
      }
    });

    it('should still accept userScoping for backward compat', () => {
      const result = safeValidateRawConfig({
        apiUrl: 'https://example.com',
        apiKey: 'test-key',
        userScoping: 'session',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.userScoping).toBe('session');
      }
    });
  });

  describe('Resolved config schema', () => {
    it('should accept namespace object in resolved config', () => {
      const config = validateConfig({
        apiUrl: 'https://example.com',
        apiKey: 'test-key',
        namespace: { default: 'personal', recall: ['personal', 'shared'] },
      });
      expect(config.namespace).toEqual({
        default: 'personal',
        recall: ['personal', 'shared'],
      });
    });

    it('should accept undefined namespace in resolved config', () => {
      const config = validateConfig({
        apiUrl: 'https://example.com',
        apiKey: 'test-key',
      });
      expect(config.namespace).toBeUndefined();
    });

    it('should make userScoping optional in resolved config', () => {
      const config = validateConfig({
        apiUrl: 'https://example.com',
        apiKey: 'test-key',
      });
      expect(config.userScoping).toBeUndefined();
    });
  });
});

describe('Dynamic namespace discovery (Issue #1537)', () => {
  it('should accept namespaceRefreshIntervalMs in config', () => {
    const result = safeValidateRawConfig({
      apiUrl: 'https://example.com',
      apiKey: 'test-key',
      namespaceRefreshIntervalMs: 60000,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.namespaceRefreshIntervalMs).toBe(60000);
    }
  });

  it('should default namespaceRefreshIntervalMs to 300000', () => {
    const result = safeValidateRawConfig({
      apiUrl: 'https://example.com',
      apiKey: 'test-key',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.namespaceRefreshIntervalMs).toBe(300_000);
    }
  });

  it('should accept namespaceRefreshIntervalMs: 0 to disable dynamic discovery', () => {
    const result = safeValidateRawConfig({
      apiUrl: 'https://example.com',
      apiKey: 'test-key',
      namespaceRefreshIntervalMs: 0,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.namespaceRefreshIntervalMs).toBe(0);
    }
  });

  it('should reject negative namespaceRefreshIntervalMs', () => {
    const result = safeValidateRawConfig({
      apiUrl: 'https://example.com',
      apiKey: 'test-key',
      namespaceRefreshIntervalMs: -1,
    });
    expect(result.success).toBe(false);
  });
});

describe('refreshNamespacesAsync (Issue #1537)', () => {
  // Import the async refresh function
  let refreshNamespacesAsync: (state: import('../src/register-openclaw.js').default extends never ? never : Parameters<typeof import('../src/register-openclaw.js').refreshNamespacesAsync>[0]) => Promise<void>;

  beforeAll(async () => {
    const mod = await import('../src/register-openclaw.js');
    refreshNamespacesAsync = mod.refreshNamespacesAsync;
  });

  function createMockState(overrides: Partial<{
    recallNamespaces: string[];
    hasStaticRecall: boolean;
    lastNamespaceRefreshMs: number;
    fetchResponse: { success: boolean; data?: unknown; error?: { message: string } };
  }> = {}) {
    const mockLogger = {
      namespace: 'test',
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const mockApiClient = {
      get: vi.fn().mockResolvedValue(overrides.fetchResponse ?? {
        success: true,
        data: [
          { namespace: 'troy', priority: 90, role: 'owner' },
          { namespace: 'default', priority: 10, role: 'member' },
          { namespace: 'shared', priority: 50, role: 'member' },
        ],
      }),
    };

    return {
      config: { namespaceRefreshIntervalMs: 300_000 } as any,
      logger: mockLogger,
      apiClient: mockApiClient as any,
      user_id: 'test-agent',
      resolvedNamespace: {
        default: 'troy',
        recall: overrides.recallNamespaces ?? ['troy'],
      },
      hasStaticRecall: overrides.hasStaticRecall ?? false,
      lastNamespaceRefreshMs: overrides.lastNamespaceRefreshMs ?? 0,
    };
  }

  it('should update recall namespaces from API response sorted by priority', async () => {
    const state = createMockState();
    await refreshNamespacesAsync(state);

    // Sorted by priority desc: troy(90), shared(50), default(10)
    expect(state.resolvedNamespace.recall).toEqual(['troy', 'shared', 'default']);
  });

  it('should stamp lastNamespaceRefreshMs', async () => {
    const state = createMockState();
    const before = Date.now();
    await refreshNamespacesAsync(state);
    expect(state.lastNamespaceRefreshMs).toBeGreaterThanOrEqual(before);
  });

  it('should keep cached list on API failure', async () => {
    const state = createMockState({
      recallNamespaces: ['original'],
      fetchResponse: { success: false, error: { message: 'Server error' } },
    });
    await refreshNamespacesAsync(state);

    expect(state.resolvedNamespace.recall).toEqual(['original']);
    expect(state.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('failed'),
      expect.any(Object),
    );
  });

  it('should NOT update timestamp on failure (allows immediate retry)', async () => {
    const state = createMockState({
      recallNamespaces: ['original'],
      fetchResponse: { success: false, error: { message: 'Server error' } },
    });
    const originalTimestamp = state.lastNamespaceRefreshMs;
    await refreshNamespacesAsync(state);

    // On failure, timestamp must remain unchanged so the next check triggers a retry
    expect(state.lastNamespaceRefreshMs).toBe(originalTimestamp);
  });

  it('should keep cached list when API returns empty', async () => {
    const state = createMockState({
      recallNamespaces: ['original'],
      fetchResponse: { success: true, data: [] },
    });
    await refreshNamespacesAsync(state);

    expect(state.resolvedNamespace.recall).toEqual(['original']);
  });

  it('should sort alphabetically when priorities are equal', async () => {
    const state = createMockState({
      fetchResponse: {
        success: true,
        data: [
          { namespace: 'bravo', priority: 50 },
          { namespace: 'alpha', priority: 50 },
          { namespace: 'charlie', priority: 50 },
        ],
      },
    });
    await refreshNamespacesAsync(state);

    expect(state.resolvedNamespace.recall).toEqual(['alpha', 'bravo', 'charlie']);
  });

  it('should use default priority 50 when priority is undefined', async () => {
    const state = createMockState({
      fetchResponse: {
        success: true,
        data: [
          { namespace: 'high', priority: 90 },
          { namespace: 'none' },
          { namespace: 'low', priority: 10 },
        ],
      },
    });
    await refreshNamespacesAsync(state);

    // high(90), none(50 default), low(10)
    expect(state.resolvedNamespace.recall).toEqual(['high', 'none', 'low']);
  });
});

describe('Tool schema namespace properties', () => {
  // Import the schemas export from register-openclaw
  // We can't directly test the internal schemas, but we can test via the
  // exported schemas object
  it('should export schemas with namespace/namespaces properties', async () => {
    const { schemas } = await import('../src/register-openclaw.js');
    // memory_recall should have namespaces (query tool)
    expect(schemas.memoryRecall.properties?.namespaces).toBeDefined();
    expect(schemas.memoryRecall.properties?.namespaces?.type).toBe('array');

    // memory_store should have namespace (store tool)
    expect(schemas.memoryStore.properties?.namespace).toBeDefined();
    expect(schemas.memoryStore.properties?.namespace?.type).toBe('string');
  });
});

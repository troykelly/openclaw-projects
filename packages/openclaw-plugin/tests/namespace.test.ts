/**
 * Tests for namespace configuration (Issue #1428).
 *
 * Validates:
 * - Config schema accepts namespace as object or string
 * - resolveNamespaceConfig applies fallback logic
 * - Tool schemas include namespace/namespaces params
 * - Tool handlers pass namespace to API calls
 */

import { describe, expect, it } from 'vitest';
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

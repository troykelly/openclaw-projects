/**
 * Gateway Integration Tests: Manifest Validation
 * Tests plugin manifest structure and validity.
 *
 * This test does NOT require the gateway source at .local/openclaw-gateway —
 * it only reads local filesystem files (openclaw.plugin.json). It always runs,
 * including in CI. (#2043)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { getPluginPath } from './setup.js';
import path from 'node:path';
import { RawPluginConfigSchema } from '../../src/config.js';

describe('Gateway Manifest Validation', () => {
  it('should have valid openclaw.plugin.json manifest', () => {
    const manifestPath = path.join(getPluginPath(), 'openclaw.plugin.json');
    const manifestContent = readFileSync(manifestPath, 'utf-8');

    // Should be valid JSON
    expect(() => JSON.parse(manifestContent)).not.toThrow();

    const manifest = JSON.parse(manifestContent);

    // Should have required Gateway plugin fields
    expect(manifest.id).toBe('openclaw-projects');
    expect(manifest.version).toBeDefined();
    expect(manifest.name).toBeDefined();
    expect(manifest.description).toBeDefined();
    expect(manifest.kind).toBe('memory');
  });

  it('should have valid configSchema in manifest', () => {
    const manifestPath = path.join(getPluginPath(), 'openclaw.plugin.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));

    expect(manifest.configSchema).toBeDefined();
    expect(manifest.configSchema.type).toBe('object');
    expect(manifest.configSchema.properties).toBeDefined();
    expect(manifest.configSchema.required).toContain('apiUrl');
  });

  it('should have configSchema with all expected fields', () => {
    const manifestPath = path.join(getPluginPath(), 'openclaw.plugin.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));

    const props = manifest.configSchema.properties;

    // Core fields
    expect(props.apiUrl).toBeDefined();
    expect(props.apiKey).toBeDefined();

    // Memory fields
    expect(props.autoRecall).toBeDefined();
    expect(props.autoCapture).toBeDefined();
    expect(props.maxRecallMemories).toBeDefined();
    expect(props.minRecallScore).toBeDefined();

    // Advanced fields
    expect(props.timeout).toBeDefined();
    expect(props.maxRetries).toBeDefined();
    expect(props.debug).toBeDefined();
  });

  it('should have namespace-related config fields in configSchema (#2304)', () => {
    const manifestPath = path.join(getPluginPath(), 'openclaw.plugin.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    const props = manifest.configSchema.properties;

    // Fields added for Issue #2260 / #1537 / #1644
    expect(props.agentId).toBeDefined();
    expect(props.agentNamespaces).toBeDefined();
    expect(props.namespaceRefreshIntervalMs).toBeDefined();
  });

  it('should have configSchema properties matching RawPluginConfigSchema keys (#2304)', () => {
    const manifestPath = path.join(getPluginPath(), 'openclaw.plugin.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    const manifestKeys = new Set(Object.keys(manifest.configSchema.properties));

    // RawPluginConfigSchema is a ZodObject with .strip() — its shape contains all valid keys
    // Every Zod key must be present in the manifest to prevent gateway rejection
    const zodKeys = Object.keys(RawPluginConfigSchema.shape);

    const missingInManifest = zodKeys.filter((k) => !manifestKeys.has(k));
    expect(missingInManifest).toEqual([]);
  });

  it('should have skills directory referenced in manifest', () => {
    const manifestPath = path.join(getPluginPath(), 'openclaw.plugin.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));

    expect(manifest.skills).toBeDefined();
    expect(manifest.skills).toEqual(['skills']);
  });
});

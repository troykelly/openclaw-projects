/**
 * Gateway Integration Tests: Manifest Validation
 * Tests plugin manifest structure and validity.
 *
 * NOTE: Full loader integration tests are blocked pending openclaw Gateway config documentation.
 * See follow-up issue for full loader integration tests.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { getPluginPath } from './setup.js';
import path from 'node:path';

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

  it('should have skills directory referenced in manifest', () => {
    const manifestPath = path.join(getPluginPath(), 'openclaw.plugin.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));

    expect(manifest.skills).toBeDefined();
    expect(manifest.skills).toEqual(['skills']);
  });
});

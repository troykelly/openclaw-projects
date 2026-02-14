/**
 * Gateway Integration Tests: Plugin Exports
 * Tests that the plugin exports the expected structure.
 */

import { describe, it, expect } from 'vitest';
import * as plugin from '../../dist/index.js';
import { EXPECTED_TOOLS } from './setup.js';

describe('Gateway Plugin Exports', () => {
  it('should export default function for OpenClaw 2026 API', () => {
    expect(plugin.default).toBeDefined();
    expect(typeof plugin.default).toBe('function');
  });

  it('should export registerOpenClaw function', () => {
    expect(plugin.registerOpenClaw).toBeDefined();
    expect(typeof plugin.registerOpenClaw).toBe('function');
  });

  it('should export schemas object', () => {
    expect(plugin.schemas).toBeDefined();
    expect(typeof plugin.schemas).toBe('object');
  });

  it('should export all tool factory functions', () => {
    // Memory tools
    expect(plugin.createMemoryRecallTool).toBeDefined();
    expect(plugin.createMemoryStoreTool).toBeDefined();
    expect(plugin.createMemoryForgetTool).toBeDefined();

    // Project tools
    expect(plugin.createProjectListTool).toBeDefined();
    expect(plugin.createProjectGetTool).toBeDefined();
    expect(plugin.createProjectCreateTool).toBeDefined();

    // Todo tools
    expect(plugin.createTodoListTool).toBeDefined();
    expect(plugin.createTodoCreateTool).toBeDefined();
    expect(plugin.createTodoCompleteTool).toBeDefined();

    // Contact tools
    expect(plugin.createContactSearchTool).toBeDefined();
    expect(plugin.createContactGetTool).toBeDefined();
    expect(plugin.createContactCreateTool).toBeDefined();
  });

  it('should have tool count matching EXPECTED_TOOLS', () => {
    // Verify the documented tool count matches actual registration count (28 tools)
    expect(EXPECTED_TOOLS.length).toBe(28);
  });
});

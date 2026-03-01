/**
 * Tests for tool_guide meta-tool.
 * Part of Issue #1923.
 */

import { describe, it, expect } from 'vitest';
import {
  createToolGuideTool,
  ToolGuideParamsSchema,
  type ToolGuideResult,
} from '../../src/tools/tool-guide.js';
import { TOOL_CATALOG, GROUP_CATALOG } from '../../src/tool-guidance/catalog.js';

describe('tool_guide', () => {
  const tool = createToolGuideTool();

  describe('schema validation', () => {
    it('should accept empty params (no args)', () => {
      const result = ToolGuideParamsSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should accept group param', () => {
      const result = ToolGuideParamsSchema.safeParse({ group: 'memory' });
      expect(result.success).toBe(true);
    });

    it('should accept tool param', () => {
      const result = ToolGuideParamsSchema.safeParse({ tool: 'memory_recall' });
      expect(result.success).toBe(true);
    });

    it('should accept task param', () => {
      const result = ToolGuideParamsSchema.safeParse({ task: 'search for memories' });
      expect(result.success).toBe(true);
    });
  });

  describe('tool factory', () => {
    it('should have the correct name', () => {
      expect(tool.name).toBe('tool_guide');
    });

    it('should have a description', () => {
      expect(tool.description).toBeTruthy();
      expect(tool.description.length).toBeGreaterThan(10);
    });
  });

  describe('returns guidance for a specific tool name', () => {
    it('should return full guidance for memory_recall', async () => {
      const result = await tool.execute({ tool: 'memory_recall' });
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.content).toContain('memory_recall');
      expect(result.data.details.tool).toBe('memory_recall');
      expect(result.data.details.guidance).toBeDefined();
      expect(result.data.details.guidance.group).toBeTruthy();
      expect(result.data.details.guidance.when_to_use).toBeTruthy();
      expect(result.data.details.guidance.when_not_to_use).toBeTruthy();
      expect(Array.isArray(result.data.details.guidance.alternatives)).toBe(true);
      expect(Array.isArray(result.data.details.guidance.side_effects)).toBe(true);
      expect(Array.isArray(result.data.details.guidance.prerequisites)).toBe(true);
      expect(Array.isArray(result.data.details.guidance.example_calls)).toBe(true);
    });
  });

  describe('returns group overview with tool list', () => {
    it('should return group info for "memory"', async () => {
      const result = await tool.execute({ group: 'memory' });
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.content).toContain('memory');
      expect(result.data.details.group).toBe('memory');
      expect(result.data.details.group_info).toBeDefined();
      expect(result.data.details.group_info.description).toBeTruthy();
      expect(Array.isArray(result.data.details.group_info.tools)).toBe(true);
      expect(result.data.details.group_info.tools.length).toBeGreaterThan(0);
      expect(result.data.details.group_info.workflow_tips).toBeTruthy();
      expect(Array.isArray(result.data.details.group_info.related_skills)).toBe(true);
    });
  });

  describe('returns task-based recommendations for a natural language task', () => {
    it('should return matching tools for "store a preference"', async () => {
      const result = await tool.execute({ task: 'store a preference' });
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.content).toContain('store');
      expect(result.data.details.task).toBe('store a preference');
      expect(Array.isArray(result.data.details.matches)).toBe(true);
      expect(result.data.details.matches.length).toBeGreaterThan(0);
      expect(result.data.details.matches.length).toBeLessThanOrEqual(5);
      // At least memory_store should match
      const toolNames = result.data.details.matches.map((m: { tool: string }) => m.tool);
      expect(toolNames).toContain('memory_store');
    });

    it('should return matching tools for "send a text message"', async () => {
      const result = await tool.execute({ task: 'send a text message' });
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.details.matches.length).toBeGreaterThan(0);
      const toolNames = result.data.details.matches.map((m: { tool: string }) => m.tool);
      expect(toolNames).toContain('sms_send');
    });
  });

  describe('returns full catalog overview when no params given', () => {
    it('should return all groups with tool counts', async () => {
      const result = await tool.execute({});
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.content).toContain('Available tool groups');
      expect(result.data.details.groups).toBeDefined();
      expect(Array.isArray(result.data.details.groups)).toBe(true);
      expect(result.data.details.groups.length).toBeGreaterThanOrEqual(23);
      // Each group entry should have name, description, tool_count
      for (const g of result.data.details.groups) {
        expect(g.name).toBeTruthy();
        expect(g.description).toBeTruthy();
        expect(typeof g.tool_count).toBe('number');
        expect(g.tool_count).toBeGreaterThan(0);
      }
    });
  });

  describe('returns error for unknown tool name', () => {
    it('should return error with suggestions for unknown tool', async () => {
      const result = await tool.execute({ tool: 'nonexistent_tool' });
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error).toContain('nonexistent_tool');
      expect(result.error).toContain('not found');
    });
  });

  describe('returns error for unknown group name', () => {
    it('should return error with suggestions for unknown group', async () => {
      const result = await tool.execute({ group: 'nonexistent_group' });
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error).toContain('nonexistent_group');
      expect(result.error).toContain('not found');
    });
  });

  describe('catalog covers all registered tool names', () => {
    it('should have entries in TOOL_CATALOG for all expected tools', () => {
      // All tools in the catalog should have complete guidance
      for (const [toolName, guidance] of Object.entries(TOOL_CATALOG)) {
        expect(guidance.group, `${toolName} missing group`).toBeTruthy();
        expect(guidance.when_to_use, `${toolName} missing when_to_use`).toBeTruthy();
        expect(guidance.when_not_to_use, `${toolName} missing when_not_to_use`).toBeTruthy();
        expect(Array.isArray(guidance.alternatives), `${toolName} alternatives not array`).toBe(true);
        expect(Array.isArray(guidance.side_effects), `${toolName} side_effects not array`).toBe(true);
        expect(Array.isArray(guidance.prerequisites), `${toolName} prerequisites not array`).toBe(true);
        expect(Array.isArray(guidance.example_calls), `${toolName} example_calls not array`).toBe(true);
      }
    });

    it('should have group entries for all groups referenced by tools', () => {
      const referencedGroups = new Set(Object.values(TOOL_CATALOG).map((g) => g.group));
      for (const groupName of referencedGroups) {
        expect(GROUP_CATALOG[groupName], `Missing group entry for "${groupName}"`).toBeDefined();
      }
    });

    it('should have all GROUP_CATALOG tools present in TOOL_CATALOG', () => {
      for (const [groupName, groupInfo] of Object.entries(GROUP_CATALOG)) {
        for (const toolName of groupInfo.tools) {
          expect(TOOL_CATALOG[toolName], `Tool "${toolName}" listed in group "${groupName}" but not in TOOL_CATALOG`).toBeDefined();
        }
      }
    });

    it('should include tool_guide itself in the catalog', () => {
      expect(TOOL_CATALOG['tool_guide']).toBeDefined();
      expect(TOOL_CATALOG['tool_guide'].group).toBe('meta');
    });
  });
});

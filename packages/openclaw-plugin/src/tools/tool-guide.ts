/**
 * tool_guide meta-tool implementation.
 * Returns on-demand usage guidance for tools, groups, or task-based recommendations.
 * Part of Issue #1923.
 */

import { z } from 'zod';
import { TOOL_CATALOG, GROUP_CATALOG, type ToolGuidance, type GroupGuidance } from '../tool-guidance/catalog.js';

/** Parameters for tool_guide tool */
export const ToolGuideParamsSchema = z.object({
  group: z.string().max(100).optional().describe('Tool group name (e.g., "memory", "contacts", "projects")'),
  tool: z.string().max(100).optional().describe('Specific tool name (e.g., "memory_recall", "todo_create")'),
  task: z.string().max(500).optional().describe('Natural language task description to find matching tools (e.g., "send a text message")'),
});
export type ToolGuideParams = z.infer<typeof ToolGuideParamsSchema>;

/** Successful tool_guide result for a specific tool */
interface ToolGuideToolSuccess {
  success: true;
  data: {
    content: string;
    details: {
      tool: string;
      guidance: ToolGuidance;
    };
  };
}

/** Successful tool_guide result for a group */
interface ToolGuideGroupSuccess {
  success: true;
  data: {
    content: string;
    details: {
      group: string;
      group_info: GroupGuidance;
    };
  };
}

/** Successful tool_guide result for task search */
interface ToolGuideTaskSuccess {
  success: true;
  data: {
    content: string;
    details: {
      task: string;
      matches: Array<{ tool: string; reason: string }>;
    };
  };
}

/** Successful tool_guide result for catalog overview */
interface ToolGuideCatalogSuccess {
  success: true;
  data: {
    content: string;
    details: {
      groups: Array<{ name: string; description: string; tool_count: number }>;
    };
  };
}

/** Failed tool_guide result */
interface ToolGuideFailure {
  success: false;
  error: string;
}

/** Union of all possible results */
export type ToolGuideResult =
  | ToolGuideToolSuccess
  | ToolGuideGroupSuccess
  | ToolGuideTaskSuccess
  | ToolGuideCatalogSuccess
  | ToolGuideFailure;

/** Tool definition */
export interface ToolGuideTool {
  name: string;
  description: string;
  parameters: typeof ToolGuideParamsSchema;
  execute: (params: ToolGuideParams) => Promise<ToolGuideResult>;
}

/**
 * Tokenize a string into lowercase words for keyword matching.
 */
function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
}

/**
 * Score a tool against a task query using keyword matching.
 * Returns a score >= 0 based on keyword overlap.
 */
function scoreToolForTask(toolName: string, guidance: ToolGuidance, queryTokens: string[]): number {
  // Strongly weight the tool name itself
  const nameTokens = tokenize(toolName.replace(/_/g, ' '));

  // Build searchable text from guidance fields (separate from name for weighting)
  const guidanceText = [
    guidance.when_to_use,
    guidance.group,
    ...guidance.example_calls.map((e) => e.description),
  ].join(' ');

  const guidanceTokens = tokenize(guidanceText);
  let score = 0;

  for (const qt of queryTokens) {
    // Name matches get highest weight
    for (const nt of nameTokens) {
      if (nt === qt) {
        score += 5;
      } else if (nt.includes(qt) || qt.includes(nt)) {
        score += 3;
      }
    }

    // Guidance matches
    for (const gt of guidanceTokens) {
      if (gt === qt) {
        score += 2;
      } else if (gt.includes(qt) || qt.includes(gt)) {
        score += 1;
      }
    }
  }

  return score;
}

/**
 * Format tool guidance as readable text.
 */
function formatToolGuidance(toolName: string, guidance: ToolGuidance): string {
  const lines: string[] = [
    `## ${toolName}`,
    `**Group:** ${guidance.group}`,
    '',
    `**When to use:** ${guidance.when_to_use}`,
    '',
    `**When NOT to use:** ${guidance.when_not_to_use}`,
  ];

  if (guidance.alternatives.length > 0) {
    lines.push('', `**Alternatives:** ${guidance.alternatives.join(', ')}`);
  }

  if (guidance.side_effects.length > 0) {
    lines.push('', `**Side effects:** ${guidance.side_effects.join('; ')}`);
  }

  if (guidance.prerequisites.length > 0) {
    lines.push('', `**Prerequisites:** ${guidance.prerequisites.join('; ')}`);
  }

  if (guidance.example_calls.length > 0) {
    lines.push('', '**Example calls:**');
    for (const ex of guidance.example_calls) {
      lines.push(`- ${ex.description}: \`${JSON.stringify(ex.params)}\``);
    }
  }

  return lines.join('\n');
}

/**
 * Format group guidance as readable text.
 */
function formatGroupGuidance(groupName: string, groupInfo: GroupGuidance): string {
  const lines: string[] = [
    `## Group: ${groupName}`,
    '',
    groupInfo.description,
    '',
    `**Tools (${groupInfo.tools.length}):** ${groupInfo.tools.join(', ')}`,
    '',
    `**Workflow tips:** ${groupInfo.workflow_tips}`,
  ];

  if (groupInfo.related_skills.length > 0) {
    lines.push('', `**Related tools:** ${groupInfo.related_skills.join(', ')}`);
  }

  return lines.join('\n');
}

/**
 * Creates the tool_guide meta-tool.
 * No external dependencies required — purely static guidance.
 */
export function createToolGuideTool(): ToolGuideTool {
  return {
    name: 'tool_guide',
    description:
      'Get usage guidance for tools. Call with a tool name for detailed guidance, a group name for group overview, a task description for recommendations, or no params for a full catalog overview.',
    parameters: ToolGuideParamsSchema,

    async execute(params: ToolGuideParams): Promise<ToolGuideResult> {
      const parseResult = ToolGuideParamsSchema.safeParse(params);
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
        return { success: false, error: errorMessage };
      }

      const { tool, group, task } = parseResult.data;

      // Priority: tool > group > task > catalog overview
      if (tool) {
        return handleToolLookup(tool);
      }

      if (group) {
        return handleGroupLookup(group);
      }

      if (task) {
        return handleTaskSearch(task);
      }

      return handleCatalogOverview();
    },
  };
}

/**
 * Handle lookup of a specific tool by name.
 */
function handleToolLookup(toolName: string): ToolGuideResult {
  const guidance = TOOL_CATALOG[toolName];

  if (!guidance) {
    const allToolNames = Object.keys(TOOL_CATALOG);
    const suggestions = allToolNames
      .filter((name) => name.includes(toolName) || toolName.includes(name))
      .slice(0, 5);

    const suggestionText = suggestions.length > 0
      ? ` Did you mean: ${suggestions.join(', ')}?`
      : ` Available groups: ${Object.keys(GROUP_CATALOG).join(', ')}`;

    return {
      success: false,
      error: `Tool "${toolName}" not found.${suggestionText}`,
    };
  }

  return {
    success: true,
    data: {
      content: formatToolGuidance(toolName, guidance),
      details: {
        tool: toolName,
        guidance,
      },
    },
  };
}

/**
 * Handle lookup of a tool group.
 */
function handleGroupLookup(groupName: string): ToolGuideResult {
  const groupInfo = GROUP_CATALOG[groupName];

  if (!groupInfo) {
    const allGroupNames = Object.keys(GROUP_CATALOG);
    const suggestions = allGroupNames
      .filter((name) => name.includes(groupName) || groupName.includes(name))
      .slice(0, 5);

    const suggestionText = suggestions.length > 0
      ? ` Did you mean: ${suggestions.join(', ')}?`
      : ` Available groups: ${allGroupNames.join(', ')}`;

    return {
      success: false,
      error: `Group "${groupName}" not found.${suggestionText}`,
    };
  }

  return {
    success: true,
    data: {
      content: formatGroupGuidance(groupName, groupInfo),
      details: {
        group: groupName,
        group_info: groupInfo,
      },
    },
  };
}

/**
 * Handle natural-language task search by keyword matching.
 */
function handleTaskSearch(task: string): ToolGuideResult {
  const queryTokens = tokenize(task);

  if (queryTokens.length === 0) {
    return { success: false, error: 'Task description is empty after tokenization.' };
  }

  const scored = Object.entries(TOOL_CATALOG)
    .map(([name, guidance]) => ({
      tool: name,
      score: scoreToolForTask(name, guidance, queryTokens),
      reason: guidance.when_to_use,
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const matches = scored.map((s) => ({ tool: s.tool, reason: s.reason }));

  const contentLines = [`## Tools matching: "${task}"`, ''];
  if (matches.length === 0) {
    contentLines.push('No matching tools found. Try calling with no params to see all available groups.');
  } else {
    for (const m of matches) {
      contentLines.push(`- **${m.tool}**: ${m.reason}`);
    }
  }

  return {
    success: true,
    data: {
      content: contentLines.join('\n'),
      details: {
        task,
        matches,
      },
    },
  };
}

/**
 * Handle catalog overview (no params).
 */
function handleCatalogOverview(): ToolGuideResult {
  const groups = Object.entries(GROUP_CATALOG).map(([name, info]) => ({
    name,
    description: info.description,
    tool_count: info.tools.length,
  }));

  const totalTools = Object.keys(TOOL_CATALOG).length;
  const lines = [
    `## Available tool groups (${groups.length} groups, ${totalTools} tools total)`,
    '',
    ...groups.map((g) => `- **${g.name}** (${g.tool_count} tools): ${g.description}`),
    '',
    'Call tool_guide with `group` for group details, `tool` for specific tool guidance, or `task` for task-based recommendations.',
  ];

  return {
    success: true,
    data: {
      content: lines.join('\n'),
      details: {
        groups,
      },
    },
  };
}

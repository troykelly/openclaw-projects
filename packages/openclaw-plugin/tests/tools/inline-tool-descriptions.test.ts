/**
 * TDD tests for inline tool descriptions in register-openclaw.ts
 * Validates all 63 inline tools follow the standard description template:
 * <What it does>. <When to use / typical trigger>. <Prefer X when Y>. <Side effects>. <Prerequisites>.
 *
 * Target: 80–300 characters, multi-sentence, ends with period.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Read source and extract tool name+description pairs via regex
const srcPath = resolve(__dirname, '../../src/register-openclaw.ts');
const source = readFileSync(srcPath, 'utf-8');

interface ToolEntry {
  name: string;
  description: string;
}

/**
 * Extract inline tool definitions from register-openclaw.ts.
 * Matches patterns like:
 *   name: 'tool_name',
 *   description: 'single line' | "single line" | `template`
 * or multi-line:
 *   description:
 *     'multi line',
 */
function extractToolDescriptions(src: string): ToolEntry[] {
  const entries: ToolEntry[] = [];

  // Match name + description pairs in tool definition objects
  const toolBlockRegex = /name:\s*'([^']+)',\s*\n\s*description:\s*(?:'([^']*(?:\\.[^']*)*)'|"([^"]*(?:\\.[^"]*)*)"|([\s\S]*?)(?=,\s*\n\s*parameters:))/g;

  let match: RegExpExecArray | null;
  while ((match = toolBlockRegex.exec(src)) !== null) {
    const name = match[1];
    // Description can be in single quotes (group 2), double quotes (group 3), or template (group 4)
    let description = match[2] ?? match[3] ?? match[4] ?? '';
    // Clean up multi-line string concatenation
    description = description
      .replace(/'\s*\+\s*'/g, '')
      .replace(/"\s*\+\s*"/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    // Remove surrounding quotes if present
    if ((description.startsWith("'") && description.endsWith("'")) ||
        (description.startsWith('"') && description.endsWith('"'))) {
      description = description.slice(1, -1);
    }
    entries.push({ name, description });
  }

  return entries;
}

const tools = extractToolDescriptions(source);
const toolMap = new Map(tools.map((t) => [t.name, t.description]));

// ── All 63 tool names that should be present ────────────────────────
const EXPECTED_TOOLS = [
  // Memory
  'memory_recall', 'memory_store', 'memory_forget',
  // Projects
  'project_list', 'project_get', 'project_create', 'project_search',
  // Todos
  'todo_list', 'todo_create', 'todo_complete', 'todo_search',
  // Contacts
  'contact_search', 'contact_get', 'contact_create', 'contact_update',
  'contact_merge', 'contact_tag_add', 'contact_tag_remove', 'contact_resolve',
  // Search
  'context_search',
  // Communication
  'sms_send', 'email_send', 'message_search',
  // Threads
  'thread_list', 'thread_get',
  // Relationships
  'relationship_set', 'relationship_query',
  // File
  'file_share',
  // Skill Store
  'skill_store_put', 'skill_store_get', 'skill_store_list',
  'skill_store_delete', 'skill_store_search', 'skill_store_collections',
  'skill_store_aggregate',
  // Entity Links
  'links_set', 'links_query', 'links_remove',
  // Prompt Templates
  'prompt_template_list', 'prompt_template_get', 'prompt_template_create',
  'prompt_template_update', 'prompt_template_delete',
  // Inbound Routing
  'inbound_destination_list', 'inbound_destination_get', 'inbound_destination_update',
  // Channel Defaults
  'channel_default_list', 'channel_default_get', 'channel_default_set',
  // Namespaces
  'namespace_list', 'namespace_create', 'namespace_grant',
  'namespace_members', 'namespace_revoke',
  // API Management
  'api_onboard', 'api_recall', 'api_get', 'api_list', 'api_update',
  'api_credential_manage', 'api_refresh', 'api_remove', 'api_restore',
];

describe('Inline tool descriptions — register-openclaw.ts', () => {
  it('should extract all 63 tools', () => {
    expect(tools.length).toBeGreaterThanOrEqual(63);
  });

  for (const name of EXPECTED_TOOLS) {
    it(`should find tool: ${name}`, () => {
      expect(toolMap.has(name)).toBe(true);
    });
  }

  describe('Template compliance', () => {
    for (const name of EXPECTED_TOOLS) {
      describe(name, () => {
        it('has description length between 80 and 300 characters', () => {
          const desc = toolMap.get(name)!;
          expect(desc.length).toBeGreaterThanOrEqual(80);
          expect(desc.length).toBeLessThanOrEqual(300);
        });

        it('has multi-sentence description (at least 2 sentences)', () => {
          const desc = toolMap.get(name)!;
          // Count sentence endings (period followed by space and uppercase, or period at end)
          const sentences = desc.split(/\.\s+/).filter((s) => s.length > 0);
          expect(sentences.length).toBeGreaterThanOrEqual(2);
        });

        it('ends with a period', () => {
          const desc = toolMap.get(name)!;
          expect(desc.endsWith('.')).toBe(true);
        });
      });
    }
  });

  describe('Side effects mentioned for write/delete/send operations', () => {
    const WRITE_TOOLS_SIDE_EFFECTS: Record<string, string[]> = {
      // Create tools should mention what record they create
      'project_create': ['work_item'],
      'todo_create': ['work_item'],
      'contact_create': ['contact'],
      // Delete/remove tools should mention soft-delete or permanent
      'memory_forget': ['delet', 'remov'],
      'todo_complete': ['cannot be undone', 'idempotent', 'Idempotent'],
      'contact_merge': ['irreversible', 'Irreversible', 'soft-delet'],
      'skill_store_delete': ['soft', 'Soft'],
      'links_remove': ['delet', 'Delet', 'remov', 'Remov'],
      'prompt_template_delete': ['soft', 'Soft', 'is_active'],
      'api_remove': ['soft', 'Soft', 'restor', 'Restor'],
      // Send tools should mention irreversibility and service requirement
      'sms_send': ['Twilio', 'irreversible', 'actual SMS'],
      'email_send': ['Postmark', 'irreversible', 'actual email'],
    };

    for (const [tool, keywords] of Object.entries(WRITE_TOOLS_SIDE_EFFECTS)) {
      it(`${tool} mentions side effects: ${keywords.join(' | ')}`, () => {
        const desc = toolMap.get(tool)!;
        const hasKeyword = keywords.some((kw) => desc.includes(kw));
        expect(hasKeyword).toBe(true);
      });
    }
  });

  describe('Alternatives mentioned', () => {
    const ALTERNATIVE_HINTS: Record<string, string[]> = {
      'contact_search': ['contact_resolve'],
      'todo_list': ['todo_search', 'context_search'],
      'project_list': ['project_search'],
      'memory_recall': ['context_search'],
      'todo_search': ['context_search'],
      'project_search': ['context_search'],
      'message_search': ['context_search'],
    };

    for (const [tool, alternatives] of Object.entries(ALTERNATIVE_HINTS)) {
      it(`${tool} mentions alternatives: ${alternatives.join(', ')}`, () => {
        const desc = toolMap.get(tool)!;
        const hasAlternative = alternatives.some((alt) => desc.includes(alt));
        expect(hasAlternative).toBe(true);
      });
    }
  });

  describe('Prerequisites/access mentioned', () => {
    const PREREQUISITE_TOOLS: Record<string, string[]> = {
      'prompt_template_create': ['agentadmin'],
      'channel_default_set': ['agentadmin'],
      'namespace_grant': ['owner', 'admin'],
      'namespace_revoke': ['owner', 'admin'],
    };

    for (const [tool, keywords] of Object.entries(PREREQUISITE_TOOLS)) {
      it(`${tool} mentions prerequisites: ${keywords.join(' | ')}`, () => {
        const desc = toolMap.get(tool)!;
        const hasKeyword = keywords.some((kw) => desc.toLowerCase().includes(kw.toLowerCase()));
        expect(hasKeyword).toBe(true);
      });
    }
  });

  describe('Update tools mention partial update semantics', () => {
    const UPDATE_TOOLS = [
      'contact_update', 'prompt_template_update', 'api_update',
      'inbound_destination_update',
    ];

    for (const tool of UPDATE_TOOLS) {
      it(`${tool} mentions partial update`, () => {
        const desc = toolMap.get(tool)!;
        const hasPartial = desc.toLowerCase().includes('partial') ||
          desc.toLowerCase().includes('only provided fields') ||
          desc.toLowerCase().includes('only supplied fields');
        expect(hasPartial).toBe(true);
      });
    }
  });
});

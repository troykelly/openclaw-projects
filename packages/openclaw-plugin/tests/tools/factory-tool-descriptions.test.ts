/**
 * Tests that all 33 factory-defined tool descriptions follow the standard template.
 *
 * Template: <What it does>. <When to use / typical trigger>. <Prefer X when Y>. <Side effects>. <Prerequisites>.
 * Target: 150–250 characters per description.
 */

import { describe, expect, it, vi } from 'vitest';

// Terminal connections (8 tools)
import {
  createTerminalConnectionListTool,
  createTerminalConnectionCreateTool,
  createTerminalConnectionUpdateTool,
  createTerminalConnectionDeleteTool,
  createTerminalConnectionTestTool,
  createTerminalCredentialCreateTool,
  createTerminalCredentialListTool,
  createTerminalCredentialDeleteTool,
} from '../../src/tools/terminal-connections.js';

// Terminal sessions (7 tools)
import {
  createTerminalSessionStartTool,
  createTerminalSessionListTool,
  createTerminalSessionTerminateTool,
  createTerminalSessionInfoTool,
  createTerminalSendCommandTool,
  createTerminalSendKeysTool,
  createTerminalCapturePaneTool,
} from '../../src/tools/terminal-sessions.js';

// Terminal tunnels (3 tools)
import {
  createTerminalTunnelCreateTool,
  createTerminalTunnelListTool,
  createTerminalTunnelCloseTool,
} from '../../src/tools/terminal-tunnels.js';

// Terminal search (2 tools)
import {
  createTerminalSearchTool,
  createTerminalAnnotateTool,
} from '../../src/tools/terminal-search.js';

// Dev sessions (5 tools)
import {
  createDevSessionCreateTool,
  createDevSessionListTool,
  createDevSessionGetTool,
  createDevSessionUpdateTool,
  createDevSessionCompleteTool,
} from '../../src/tools/dev-sessions.js';

// Notes (5 tools)
import {
  createNoteCreateTool,
  createNoteGetTool,
  createNoteUpdateTool,
  createNoteDeleteTool,
  createNoteSearchTool,
} from '../../src/tools/notes.js';

// Notebooks (3 tools)
import {
  createNotebookListTool,
  createNotebookCreateTool,
  createNotebookGetTool,
} from '../../src/tools/notebooks.js';

import type { ApiClient } from '../../src/api-client.js';
import type { Logger } from '../../src/logger.js';
import type { PluginConfig } from '../../src/config.js';

const mockLogger: Logger = {
  namespace: 'test',
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

const mockConfig: PluginConfig = {
  apiUrl: 'https://api.example.com',
  apiKey: 'test-key',
  autoRecall: true,
  autoCapture: true,
  userScoping: 'agent',
  maxRecallMemories: 5,
  minRecallScore: 0.7,
  timeout: 30000,
  maxRetries: 3,
  debug: false,
  baseUrl: 'https://app.example.com',
};

const mockApiClient = {
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
} as unknown as ApiClient;

const sharedOptions = {
  client: mockApiClient,
  logger: mockLogger,
  config: mockConfig,
  user_id: 'test@example.com',
};

/**
 * Collect all 33 factory tools with name + description.
 */
function getAllFactoryTools(): Array<{ name: string; description: string }> {
  return [
    // Terminal connections (8)
    createTerminalConnectionListTool(sharedOptions),
    createTerminalConnectionCreateTool(sharedOptions),
    createTerminalConnectionUpdateTool(sharedOptions),
    createTerminalConnectionDeleteTool(sharedOptions),
    createTerminalConnectionTestTool(sharedOptions),
    createTerminalCredentialCreateTool(sharedOptions),
    createTerminalCredentialListTool(sharedOptions),
    createTerminalCredentialDeleteTool(sharedOptions),
    // Terminal sessions (7)
    createTerminalSessionStartTool(sharedOptions),
    createTerminalSessionListTool(sharedOptions),
    createTerminalSessionTerminateTool(sharedOptions),
    createTerminalSessionInfoTool(sharedOptions),
    createTerminalSendCommandTool(sharedOptions),
    createTerminalSendKeysTool(sharedOptions),
    createTerminalCapturePaneTool(sharedOptions),
    // Terminal tunnels (3)
    createTerminalTunnelCreateTool(sharedOptions),
    createTerminalTunnelListTool(sharedOptions),
    createTerminalTunnelCloseTool(sharedOptions),
    // Terminal search (2)
    createTerminalSearchTool(sharedOptions),
    createTerminalAnnotateTool(sharedOptions),
    // Dev sessions (5)
    createDevSessionCreateTool(sharedOptions),
    createDevSessionListTool(sharedOptions),
    createDevSessionGetTool(sharedOptions),
    createDevSessionUpdateTool(sharedOptions),
    createDevSessionCompleteTool(sharedOptions),
    // Notes (5)
    createNoteCreateTool(sharedOptions),
    createNoteGetTool(sharedOptions),
    createNoteUpdateTool(sharedOptions),
    createNoteDeleteTool(sharedOptions),
    createNoteSearchTool(sharedOptions),
    // Notebooks (3)
    createNotebookListTool(sharedOptions),
    createNotebookCreateTool(sharedOptions),
    createNotebookGetTool(sharedOptions),
  ];
}

describe('factory tool descriptions', () => {
  const tools = getAllFactoryTools();

  it('should have exactly 33 factory tools', () => {
    expect(tools).toHaveLength(33);
  });

  describe.each(tools.map((t) => [t.name, t.description]))('%s', (name, description) => {
    it('should have a description between 80 and 300 characters', () => {
      expect(description.length).toBeGreaterThanOrEqual(80);
      expect(description.length).toBeLessThanOrEqual(300);
    });

    it('should contain at least two sentences (multiple periods)', () => {
      // Template requires multiple sentences separated by periods
      const sentenceCount = (description.match(/\.\s*\S/g) || []).length + (description.endsWith('.') ? 1 : 0);
      expect(sentenceCount).toBeGreaterThanOrEqual(2);
    });

    it('should end with a period', () => {
      expect(description.endsWith('.')).toBe(true);
    });
  });

  // --- Side effects for write/delete operations ---

  const writeDeleteTools = tools.filter((t) =>
    /create|update|delete|terminate|close|complete|annotate|send_command|send_keys/.test(t.name),
  );

  describe.each(writeDeleteTools.map((t) => [t.name, t.description]))('%s (write/delete)', (_name, description) => {
    it('should mention side effects or consequences', () => {
      const hasSideEffect =
        /creates?\b/i.test(description) ||
        /persists?\b/i.test(description) ||
        /delet/i.test(description) ||
        /remov/i.test(description) ||
        /soft[- ]?delet/i.test(description) ||
        /terminat/i.test(description) ||
        /close[sd]?\b/i.test(description) ||
        /marks?\b.*\bcompleted?\b/i.test(description) ||
        /preserv/i.test(description) ||
        /updat/i.test(description) ||
        /modif/i.test(description) ||
        /version/i.test(description) ||
        /embedded/i.test(description) ||
        /execute/i.test(description) ||
        /send/i.test(description) ||
        /trigger/i.test(description) ||
        /may trigger/i.test(description) ||
        /history/i.test(description) ||
        /retained/i.test(description) ||
        /restore/i.test(description);
      expect(hasSideEffect).toBe(true);
    });
  });

  // --- Prerequisites for terminal tools ---

  const terminalSessionTools = tools.filter(
    (t) =>
      t.name.startsWith('terminal_session_') ||
      t.name === 'terminal_send_command' ||
      t.name === 'terminal_send_keys' ||
      t.name === 'terminal_capture_pane' ||
      t.name === 'terminal_annotate',
  );

  // Session-dependent tools (not session_start and not session_list) should mention session/connection prerequisite
  const sessionDependentTools = terminalSessionTools.filter(
    (t) => t.name !== 'terminal_session_start' && t.name !== 'terminal_session_list',
  );

  describe.each(sessionDependentTools.map((t) => [t.name, t.description]))(
    '%s (session prereq)',
    (_name, description) => {
      it('should mention session prerequisite', () => {
        const hasPrereq =
          /requires?\b.*\bsession\b/i.test(description) ||
          /active\b.*\bsession\b/i.test(description) ||
          /session\b.*\brequired\b/i.test(description) ||
          /session ID/i.test(description);
        expect(hasPrereq).toBe(true);
      });
    },
  );

  // terminal_session_start should mention connection prerequisite
  it('terminal_session_start should mention connection prerequisite', () => {
    const startTool = tools.find((t) => t.name === 'terminal_session_start');
    expect(startTool).toBeDefined();
    const hasPrereq =
      /requires?\b.*\bconnection\b/i.test(startTool!.description) ||
      /connection\b.*\brequired\b/i.test(startTool!.description) ||
      /saved\b.*\bconnection\b/i.test(startTool!.description);
    expect(hasPrereq).toBe(true);
  });

  // --- Alternatives mentions ---

  it('terminal_search should mention context_search as alternative', () => {
    const tool = tools.find((t) => t.name === 'terminal_search');
    expect(tool).toBeDefined();
    expect(tool!.description).toContain('context_search');
  });

  it('terminal_send_keys should mention terminal_send_command as alternative', () => {
    const tool = tools.find((t) => t.name === 'terminal_send_keys');
    expect(tool).toBeDefined();
    expect(tool!.description).toContain('terminal_send_command');
  });

  it('note_create should mention memory_store alternative', () => {
    const tool = tools.find((t) => t.name === 'note_create');
    expect(tool).toBeDefined();
    expect(tool!.description).toContain('memory_store');
  });

  it('note_search should mention context_search as alternative', () => {
    const tool = tools.find((t) => t.name === 'note_search');
    expect(tool).toBeDefined();
    expect(tool!.description).toContain('context_search');
  });
});

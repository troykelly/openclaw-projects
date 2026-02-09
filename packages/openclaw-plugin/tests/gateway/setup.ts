/**
 * Gateway Integration Test Setup
 * Shared configuration, logger, and helpers for Level 3 Gateway tests.
 */

import type { Logger } from 'openclaw';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Get the absolute path to the plugin directory (packages/openclaw-plugin).
 * The SDK needs to load from the plugin root which contains openclaw.plugin.json.
 */
export function getPluginPath(): string {
  // tests/gateway/setup.ts -> go up 2 levels to get to plugin root
  return path.resolve(__dirname, '..', '..');
}

/**
 * Create a minimal logger for Gateway tests.
 * The SDK expects a logger with debug, info, warn, error methods.
 */
export function createTestLogger(): Logger {
  return {
    debug: (_msg: string, ..._args: unknown[]) => {
      // Silent in tests unless debugging
    },
    info: (_msg: string, ..._args: unknown[]) => {
      // Silent in tests
    },
    warn: (msg: string, ...args: unknown[]) => {
      console.warn(`[WARN] ${msg}`, ...args);
    },
    error: (msg: string, ...args: unknown[]) => {
      console.error(`[ERROR] ${msg}`, ...args);
    },
  };
}

/**
 * Create a valid minimal Gateway config for loading the plugin.
 * Uses direct secret values (no file/command resolution in tests per spec).
 */
export function createTestConfig(overrides?: {
  apiUrl?: string;
  apiKey?: string;
  autoRecall?: boolean;
  autoCapture?: boolean;
  slots?: { memory?: string };
  enabled?: boolean;
  entries?: Record<string, unknown>;
}) {
  const pluginPath = getPluginPath();

  return {
    plugins: {
      enabled: overrides?.enabled ?? true,
      load: {
        paths: [pluginPath],
      },
      slots: {
        memory: overrides?.slots?.memory ?? 'openclaw-projects',
      },
      entries: overrides?.entries ?? {
        'openclaw-projects': {
          enabled: true,
          config: {
            apiUrl: overrides?.apiUrl ?? 'http://localhost:3000',
            apiKey: overrides?.apiKey ?? 'test-key',
            autoRecall: overrides?.autoRecall ?? true,
            autoCapture: overrides?.autoCapture ?? true,
          },
        },
      },
    },
  };
}

/**
 * Expected tool names (all 27 tools) in alphabetical order.
 */
export const EXPECTED_TOOLS = [
  'contact_create',
  'contact_get',
  'contact_search',
  'email_send',
  'file_share',
  'memory_forget',
  'memory_recall',
  'memory_store',
  'message_search',
  'notebook_create',
  'notebook_get',
  'notebook_list',
  'note_create',
  'note_delete',
  'note_get',
  'note_search',
  'note_update',
  'project_create',
  'project_get',
  'project_list',
  'relationship_query',
  'relationship_set',
  'skill_store_aggregate',
  'skill_store_collections',
  'skill_store_delete',
  'skill_store_get',
  'skill_store_list',
  'skill_store_put',
  'skill_store_search',
  'sms_send',
  'thread_get',
  'thread_list',
  'todo_complete',
  'todo_create',
  'todo_list',
] as const;

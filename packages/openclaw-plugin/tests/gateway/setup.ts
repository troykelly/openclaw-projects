/**
 * Gateway Integration Test Setup
 * Shared configuration, logger, and helpers for Level 3 Gateway tests.
 *
 * These tests use the real Gateway loadOpenClawPlugins() function imported
 * from the gateway source at .local/openclaw-gateway. The vitest config
 * aliases 'openclaw-gateway/plugins/*' to the source TypeScript files.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Get the absolute path to the plugin directory (packages/openclaw-plugin).
 * The loader discovers plugins via load.paths and looks for openclaw.plugin.json.
 */
export function getPluginPath(): string {
  return path.resolve(__dirname, '..', '..');
}

/**
 * Create a minimal logger for Gateway tests.
 * The loader expects a logger with debug, info, warn, error methods.
 */
export function createTestLogger() {
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
 *
 * Based on the actual Gateway source (loader.ts, config-state.ts):
 * - The loader calls normalizePluginsConfig(cfg.plugins)
 * - It only needs cfg.plugins, not channels/agent/etc.
 * - plugins.load.paths points to our plugin directory
 * - plugins.entries configures per-plugin settings
 * - plugins.slots.memory selects the memory plugin
 *
 * The config shape matches OpenClawConfig loosely — only the plugins
 * section is required for loadOpenClawPlugins().
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
 * Find a plugin record by ID in the registry.
 * The registry stores plugins as an array, not a Map.
 */
export function findPlugin(registry: { plugins: Array<{ id: string }> }, id: string) {
  return registry.plugins.find((p) => p.id === id);
}

/**
 * Expected tool names (all 41 tools) in alphabetical order.
 * These match the tools registered by register-openclaw.ts via api.registerTool().
 */
export const EXPECTED_TOOLS = [
  'contact_create',
  'contact_get',
  'contact_search',
  'context_search',
  'email_send',
  'file_share',
  'links_query',
  'links_remove',
  'links_set',
  'memory_forget',
  'memory_recall',
  'memory_store',
  'message_search',
  'note_create',
  'note_delete',
  'note_get',
  'note_search',
  'note_update',
  'notebook_create',
  'notebook_get',
  'notebook_list',
  'project_create',
  'project_get',
  'project_list',
  'project_search',
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
  'todo_search',
] as const;

/**
 * Dev prompt tools for OpenClaw plugin (Epic #2011, Issue #2015).
 *
 * Tools: dev_prompt_list, dev_prompt_get, dev_prompt_create,
 *        dev_prompt_update, dev_prompt_reset
 */

import { z } from 'zod';
import type { ApiClient } from '../api-client.js';
import type { Logger } from '../logger.js';
import type { PluginConfig } from '../config.js';
import { sanitizeErrorMessage } from '../utils/sanitize.js';

// ==================== Shared Types ====================

/** Tool configuration for dev prompt tools */
export interface DevPromptToolOptions {
  client: ApiClient;
  logger: Logger;
  config: PluginConfig;
  user_id: string;
}

/** Dev prompt from API */
export interface DevPrompt {
  id: string;
  namespace: string;
  prompt_key: string;
  category: string;
  is_system: boolean;
  title: string;
  description: string;
  body: string;
  default_body: string;
  sort_order: number;
  is_active: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Paginated list result from API */
interface DevPromptListResponse {
  total: number;
  limit: number;
  offset: number;
  items: DevPrompt[];
}

/** Render result from API */
interface DevPromptRenderResponse {
  rendered: string;
  variables_used: string[];
  available_variables: { name: string; description: string; example: string }[];
}

/** Failure result */
export interface DevPromptFailure {
  success: false;
  error: string;
}

const CATEGORIES = ['identification', 'creation', 'triage', 'shipping', 'general', 'custom'] as const;

/**
 * Parse a "org/name" repo string into repo_org and repo_name.
 */
function parseRepo(repo: string): { repo_org: string; repo_name: string } | null {
  const idx = repo.indexOf('/');
  if (idx <= 0 || idx === repo.length - 1) return null;
  return { repo_org: repo.slice(0, idx), repo_name: repo.slice(idx + 1) };
}

// ==================== dev_prompt_list ====================

export const DevPromptListParamsSchema = z.object({
  namespace: z.string().optional().describe('Namespace to list prompts from (defaults to your namespace)'),
  category: z.enum(CATEGORIES).optional().describe('Filter by category'),
});
export type DevPromptListParams = z.infer<typeof DevPromptListParamsSchema>;

export interface DevPromptListSuccess {
  success: true;
  data: {
    content: string;
    details: {
      prompts: Pick<DevPrompt, 'prompt_key' | 'title' | 'category' | 'is_system'>[];
      total: number;
    };
  };
}

export type DevPromptListResult = DevPromptListSuccess | DevPromptFailure;

export interface DevPromptListTool {
  name: string;
  description: string;
  parameters: typeof DevPromptListParamsSchema;
  execute: (params: DevPromptListParams) => Promise<DevPromptListResult>;
}

export function createDevPromptListTool(options: DevPromptToolOptions): DevPromptListTool {
  const { client, logger, user_id } = options;

  return {
    name: 'dev_prompt_list',
    description: 'Lists available dev prompt templates grouped by category. Use to discover what prompts are available before using dev_prompt_get to retrieve and render one. Returns prompt keys, titles, categories, and whether each is a system or user prompt.',
    parameters: DevPromptListParamsSchema,

    async execute(params: DevPromptListParams): Promise<DevPromptListResult> {
      const parseResult = DevPromptListParamsSchema.safeParse(params);
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
        return { success: false, error: errorMessage };
      }

      const { namespace, category } = parseResult.data;

      logger.info('dev_prompt_list invoked', { user_id, namespace, category });

      try {
        const queryParams = new URLSearchParams({ limit: '100', offset: '0' });
        if (namespace) queryParams.set('namespace', namespace);
        if (category) queryParams.set('category', category);

        const response = await client.get<DevPromptListResponse>(
          `/dev-prompts?${queryParams.toString()}`,
          { user_id },
        );

        if (!response.success) {
          logger.error('dev_prompt_list API error', { user_id, status: response.error.status });
          return { success: false, error: response.error.message || 'Failed to list dev prompts' };
        }

        const items = response.data.items ?? [];
        const total = response.data.total ?? items.length;

        if (items.length === 0) {
          return {
            success: true,
            data: {
              content: 'No dev prompts found.',
              details: { prompts: [], total: 0 },
            },
          };
        }

        // Group by category
        const grouped = new Map<string, typeof items>();
        for (const item of items) {
          const cat = item.category;
          if (!grouped.has(cat)) grouped.set(cat, []);
          grouped.get(cat)!.push(item);
        }

        const lines: string[] = [`Found ${total} dev prompt(s):\n`];
        for (const [cat, prompts] of grouped) {
          lines.push(`**${cat}**`);
          for (const p of prompts) {
            const tag = p.is_system ? '[system]' : '[user]';
            lines.push(`  - \`${p.prompt_key}\` — ${p.title} ${tag}`);
          }
          lines.push('');
        }

        logger.debug('dev_prompt_list completed', { user_id, count: items.length });

        return {
          success: true,
          data: {
            content: lines.join('\n').trim(),
            details: {
              prompts: items.map((i) => ({
                prompt_key: i.prompt_key,
                title: i.title,
                category: i.category,
                is_system: i.is_system,
              })),
              total,
            },
          },
        };
      } catch (error) {
        logger.error('dev_prompt_list failed', {
          user_id,
          error: error instanceof Error ? error.message : String(error),
        });
        return { success: false, error: sanitizeErrorMessage(error) };
      }
    },
  };
}

// ==================== dev_prompt_get ====================

export const DevPromptGetParamsSchema = z.object({
  namespace: z.string().optional().describe('Namespace to search in (defaults to your namespace)'),
  key: z.string().min(1, 'Prompt key is required').describe('The prompt_key to look up'),
  repo: z.string().optional().describe('Repository in "org/name" format — splits into repo_org and repo_name template variables'),
  variables: z.record(z.string()).optional().describe('Extra variables to pass to the template renderer'),
  render: z.boolean().optional().default(true).describe('Whether to render the template (default: true). Set false to get raw Handlebars template.'),
});
export type DevPromptGetParams = z.infer<typeof DevPromptGetParamsSchema>;

export interface DevPromptGetSuccess {
  success: true;
  data: {
    content: string;
    details: {
      prompt_key: string;
      title: string;
      category: string;
      is_system: boolean;
      rendered: boolean;
    };
  };
}

export type DevPromptGetResult = DevPromptGetSuccess | DevPromptFailure;

export interface DevPromptGetTool {
  name: string;
  description: string;
  parameters: typeof DevPromptGetParamsSchema;
  execute: (params: DevPromptGetParams) => Promise<DevPromptGetResult>;
}

export function createDevPromptGetTool(options: DevPromptToolOptions): DevPromptGetTool {
  const { client, logger, user_id } = options;

  return {
    name: 'dev_prompt_get',
    description: 'Gets a dev prompt by key and renders it with Handlebars template variables. By default returns the fully rendered output. Set render=false to get the raw template. Pass repo="org/name" to populate repo variables. Use dev_prompt_list first to discover available keys.',
    parameters: DevPromptGetParamsSchema,

    async execute(params: DevPromptGetParams): Promise<DevPromptGetResult> {
      const parseResult = DevPromptGetParamsSchema.safeParse(params);
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
        return { success: false, error: errorMessage };
      }

      const { namespace, key, repo, variables, render } = parseResult.data;

      logger.info('dev_prompt_get invoked', { user_id, key, render, hasRepo: !!repo });

      try {
        // Look up prompt by key
        const queryParams = new URLSearchParams();
        if (namespace) queryParams.set('namespace', namespace);
        const qs = queryParams.toString();
        const url = `/dev-prompts/by-key/${encodeURIComponent(key)}${qs ? `?${qs}` : ''}`;

        const lookupResponse = await client.get<DevPrompt>(url, { user_id });

        if (!lookupResponse.success) {
          if (lookupResponse.error.status === 404 || lookupResponse.error.code === 'NOT_FOUND') {
            return { success: false, error: `Dev prompt "${key}" not found. Use dev_prompt_list to see available prompts.` };
          }
          return { success: false, error: lookupResponse.error.message || 'Failed to get dev prompt' };
        }

        const prompt = lookupResponse.data;

        // If render=false, return raw template
        if (!render) {
          return {
            success: true,
            data: {
              content: `**${prompt.title}** (\`${prompt.prompt_key}\`) [${prompt.category}]\n\n${prompt.body}`,
              details: {
                prompt_key: prompt.prompt_key,
                title: prompt.title,
                category: prompt.category,
                is_system: prompt.is_system,
                rendered: false,
              },
            },
          };
        }

        // Build render variables
        const renderVariables: Record<string, string> = { ...(variables ?? {}) };
        if (repo) {
          const parsed = parseRepo(repo);
          if (parsed) {
            renderVariables.repo_org = parsed.repo_org;
            renderVariables.repo_name = parsed.repo_name;
          }
        }

        // Call render endpoint
        const renderResponse = await client.post<DevPromptRenderResponse>(
          `/dev-prompts/${prompt.id}/render`,
          { variables: renderVariables },
          { user_id },
        );

        if (!renderResponse.success) {
          // Fall back to raw template if render fails
          logger.warn('dev_prompt_get render failed, returning raw', {
            key,
            error: renderResponse.error.message,
          });
          return {
            success: true,
            data: {
              content: `**${prompt.title}** (\`${prompt.prompt_key}\`) [${prompt.category}]\n\n${prompt.body}`,
              details: {
                prompt_key: prompt.prompt_key,
                title: prompt.title,
                category: prompt.category,
                is_system: prompt.is_system,
                rendered: false,
              },
            },
          };
        }

        logger.debug('dev_prompt_get completed', { user_id, key, rendered: true });

        return {
          success: true,
          data: {
            content: renderResponse.data.rendered,
            details: {
              prompt_key: prompt.prompt_key,
              title: prompt.title,
              category: prompt.category,
              is_system: prompt.is_system,
              rendered: true,
            },
          },
        };
      } catch (error) {
        logger.error('dev_prompt_get failed', {
          user_id,
          key,
          error: error instanceof Error ? error.message : String(error),
        });
        return { success: false, error: sanitizeErrorMessage(error) };
      }
    },
  };
}

// ==================== dev_prompt_create ====================

export const DevPromptCreateParamsSchema = z.object({
  namespace: z.string().optional().describe('Namespace to create the prompt in (defaults to your namespace)'),
  key: z.string().min(1, 'Prompt key is required').describe('Snake_case key for the prompt (unique per namespace)'),
  title: z.string().optional().describe('Human-readable title (defaults to key if not provided)'),
  body: z.string().optional().describe('Handlebars template body'),
  category: z.enum(CATEGORIES).optional().describe('Prompt category (defaults to "custom")'),
  repo: z.string().optional().describe('Repository in "org/name" format — used for rendering context'),
});
export type DevPromptCreateParams = z.infer<typeof DevPromptCreateParamsSchema>;

export interface DevPromptCreateSuccess {
  success: true;
  data: {
    content: string;
    details: {
      id: string;
      prompt_key: string;
      title: string;
      category: string;
    };
  };
}

export type DevPromptCreateResult = DevPromptCreateSuccess | DevPromptFailure;

export interface DevPromptCreateTool {
  name: string;
  description: string;
  parameters: typeof DevPromptCreateParamsSchema;
  execute: (params: DevPromptCreateParams) => Promise<DevPromptCreateResult>;
}

export function createDevPromptCreateTool(options: DevPromptToolOptions): DevPromptCreateTool {
  const { client, logger, user_id } = options;

  return {
    name: 'dev_prompt_create',
    description: 'Creates a new user-defined dev prompt template. The key must be snake_case and unique within the namespace. If the key already exists, use dev_prompt_update instead. Use Handlebars syntax ({{ variable }}) in the body for dynamic content.',
    parameters: DevPromptCreateParamsSchema,

    async execute(params: DevPromptCreateParams): Promise<DevPromptCreateResult> {
      const parseResult = DevPromptCreateParamsSchema.safeParse(params);
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
        return { success: false, error: errorMessage };
      }

      const { namespace, key, title, body, category } = parseResult.data;

      logger.info('dev_prompt_create invoked', { user_id, key, category });

      try {
        const payload: Record<string, unknown> = {
          prompt_key: key,
          title: title ?? key,
          body: body ?? '',
        };
        if (category) payload.category = category;

        const queryParams = new URLSearchParams();
        if (namespace) queryParams.set('namespace', namespace);
        const qs = queryParams.toString();

        const response = await client.post<DevPrompt>(
          `/dev-prompts${qs ? `?${qs}` : ''}`,
          payload,
          { user_id },
        );

        if (!response.success) {
          if (response.error.status === 409 || response.error.code === 'CONFLICT') {
            return {
              success: false,
              error: `A prompt with key "${key}" already exists. Use dev_prompt_update to modify it.`,
            };
          }
          logger.error('dev_prompt_create API error', { user_id, key, status: response.error.status });
          return { success: false, error: response.error.message || 'Failed to create dev prompt' };
        }

        const prompt = response.data;

        logger.debug('dev_prompt_create completed', { user_id, key, id: prompt.id });

        return {
          success: true,
          data: {
            content: `Created dev prompt \`${prompt.prompt_key}\` — "${prompt.title}" [${prompt.category}] (ID: ${prompt.id})`,
            details: {
              id: prompt.id,
              prompt_key: prompt.prompt_key,
              title: prompt.title,
              category: prompt.category,
            },
          },
        };
      } catch (error) {
        logger.error('dev_prompt_create failed', {
          user_id,
          key,
          error: error instanceof Error ? error.message : String(error),
        });
        return { success: false, error: sanitizeErrorMessage(error) };
      }
    },
  };
}

// ==================== dev_prompt_update ====================

export const DevPromptUpdateParamsSchema = z.object({
  namespace: z.string().optional().describe('Namespace of the prompt (defaults to your namespace)'),
  key: z.string().min(1, 'Prompt key is required').describe('The prompt_key to update'),
  body: z.string().min(1, 'Body is required').describe('New Handlebars template body'),
});
export type DevPromptUpdateParams = z.infer<typeof DevPromptUpdateParamsSchema>;

export interface DevPromptUpdateSuccess {
  success: true;
  data: {
    content: string;
    details: {
      prompt_key: string;
      title: string;
    };
  };
}

export type DevPromptUpdateResult = DevPromptUpdateSuccess | DevPromptFailure;

export interface DevPromptUpdateTool {
  name: string;
  description: string;
  parameters: typeof DevPromptUpdateParamsSchema;
  execute: (params: DevPromptUpdateParams) => Promise<DevPromptUpdateResult>;
}

export function createDevPromptUpdateTool(options: DevPromptToolOptions): DevPromptUpdateTool {
  const { client, logger, user_id } = options;

  return {
    name: 'dev_prompt_update',
    description: 'Updates the body of an existing dev prompt by key. For system prompts, only the body can be changed. Looks up the prompt by key first, then patches by ID.',
    parameters: DevPromptUpdateParamsSchema,

    async execute(params: DevPromptUpdateParams): Promise<DevPromptUpdateResult> {
      const parseResult = DevPromptUpdateParamsSchema.safeParse(params);
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
        return { success: false, error: errorMessage };
      }

      const { namespace, key, body } = parseResult.data;

      logger.info('dev_prompt_update invoked', { user_id, key });

      try {
        // Look up prompt by key
        const queryParams = new URLSearchParams();
        if (namespace) queryParams.set('namespace', namespace);
        const qs = queryParams.toString();
        const lookupUrl = `/dev-prompts/by-key/${encodeURIComponent(key)}${qs ? `?${qs}` : ''}`;

        const lookupResponse = await client.get<DevPrompt>(lookupUrl, { user_id });

        if (!lookupResponse.success) {
          if (lookupResponse.error.status === 404 || lookupResponse.error.code === 'NOT_FOUND') {
            return { success: false, error: `Dev prompt "${key}" not found. Use dev_prompt_list to see available prompts, or dev_prompt_create to create a new one.` };
          }
          return { success: false, error: lookupResponse.error.message || 'Failed to look up dev prompt' };
        }

        const prompt = lookupResponse.data;

        // PATCH by ID
        const patchResponse = await client.patch<DevPrompt>(
          `/dev-prompts/${prompt.id}`,
          { body },
          { user_id },
        );

        if (!patchResponse.success) {
          logger.error('dev_prompt_update patch failed', { user_id, key, id: prompt.id, status: patchResponse.error.status });
          return { success: false, error: patchResponse.error.message || 'Failed to update dev prompt' };
        }

        const updated = patchResponse.data;

        logger.debug('dev_prompt_update completed', { user_id, key, id: prompt.id });

        return {
          success: true,
          data: {
            content: `Updated dev prompt \`${updated.prompt_key}\` — "${updated.title}"`,
            details: {
              prompt_key: updated.prompt_key,
              title: updated.title,
            },
          },
        };
      } catch (error) {
        logger.error('dev_prompt_update failed', {
          user_id,
          key,
          error: error instanceof Error ? error.message : String(error),
        });
        return { success: false, error: sanitizeErrorMessage(error) };
      }
    },
  };
}

// ==================== dev_prompt_reset ====================

export const DevPromptResetParamsSchema = z.object({
  namespace: z.string().optional().describe('Namespace of the prompt (defaults to your namespace)'),
  key: z.string().min(1, 'Prompt key is required').describe('The prompt_key of the system prompt to reset'),
});
export type DevPromptResetParams = z.infer<typeof DevPromptResetParamsSchema>;

export interface DevPromptResetSuccess {
  success: true;
  data: {
    content: string;
    details: {
      prompt_key: string;
      title: string;
    };
  };
}

export type DevPromptResetResult = DevPromptResetSuccess | DevPromptFailure;

export interface DevPromptResetTool {
  name: string;
  description: string;
  parameters: typeof DevPromptResetParamsSchema;
  execute: (params: DevPromptResetParams) => Promise<DevPromptResetResult>;
}

export function createDevPromptResetTool(options: DevPromptToolOptions): DevPromptResetTool {
  const { client, logger, user_id } = options;

  return {
    name: 'dev_prompt_reset',
    description: 'Resets a system dev prompt back to its original default body. Only works for system prompts — user prompts cannot be reset. Use after customizing a system prompt to revert to the original template.',
    parameters: DevPromptResetParamsSchema,

    async execute(params: DevPromptResetParams): Promise<DevPromptResetResult> {
      const parseResult = DevPromptResetParamsSchema.safeParse(params);
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
        return { success: false, error: errorMessage };
      }

      const { namespace, key } = parseResult.data;

      logger.info('dev_prompt_reset invoked', { user_id, key });

      try {
        // Look up prompt by key
        const queryParams = new URLSearchParams();
        if (namespace) queryParams.set('namespace', namespace);
        const qs = queryParams.toString();
        const lookupUrl = `/dev-prompts/by-key/${encodeURIComponent(key)}${qs ? `?${qs}` : ''}`;

        const lookupResponse = await client.get<DevPrompt>(lookupUrl, { user_id });

        if (!lookupResponse.success) {
          if (lookupResponse.error.status === 404 || lookupResponse.error.code === 'NOT_FOUND') {
            return { success: false, error: `Dev prompt "${key}" not found. Use dev_prompt_list to see available prompts.` };
          }
          return { success: false, error: lookupResponse.error.message || 'Failed to look up dev prompt' };
        }

        const prompt = lookupResponse.data;

        // Call reset endpoint
        const resetResponse = await client.post<DevPrompt>(
          `/dev-prompts/${prompt.id}/reset`,
          {},
          { user_id },
        );

        if (!resetResponse.success) {
          logger.error('dev_prompt_reset API error', { user_id, key, id: prompt.id, status: resetResponse.error.status });
          return { success: false, error: resetResponse.error.message || 'Failed to reset dev prompt' };
        }

        const reset = resetResponse.data;

        logger.debug('dev_prompt_reset completed', { user_id, key, id: prompt.id });

        return {
          success: true,
          data: {
            content: `Reset dev prompt \`${reset.prompt_key}\` — "${reset.title}" to its default body.`,
            details: {
              prompt_key: reset.prompt_key,
              title: reset.title,
            },
          },
        };
      } catch (error) {
        logger.error('dev_prompt_reset failed', {
          user_id,
          key,
          error: error instanceof Error ? error.message : String(error),
        });
        return { success: false, error: sanitizeErrorMessage(error) };
      }
    },
  };
}

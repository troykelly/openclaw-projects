/**
 * Dev session management tools.
 * Provides tools for creating, listing, getting, updating, and completing
 * developer coding sessions tracked by the API.
 */

import { z } from 'zod';
import type { ApiClient } from '../api-client.js';
import type { Logger } from '../logger.js';
import type { PluginConfig } from '../config.js';
import { sanitizeErrorMessage } from '../utils/sanitize.js';

/** UUID validation regex */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validate UUID format.
 */
function isValidUuid(id: string): boolean {
  return UUID_REGEX.test(id);
}

/**
 * Strip HTML tags from a string.
 */
function stripHtml(text: string): string {
  return text
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<[^>]*>/g, '')
    .trim();
}

// ==================== Shared Types ====================

/** Tool configuration for dev session tools */
export interface DevSessionToolOptions {
  client: ApiClient;
  logger: Logger;
  config: PluginConfig;
  user_id: string;
}

/** Dev session from API */
export interface DevSession {
  id: string;
  user_email: string;
  session_name: string;
  node: string;
  status: string;
  project_id?: string | null;
  task_summary?: string | null;
  task_prompt?: string | null;
  branch?: string | null;
  container?: string | null;
  container_user?: string | null;
  repo_org?: string | null;
  repo_name?: string | null;
  context_pct?: number | null;
  last_capture?: string | null;
  last_capture_at?: string | null;
  completion_summary?: string | null;
  linked_issues?: string[];
  linked_prs?: string[];
  webhook_id?: string | null;
  completed_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

/** Failure result */
export interface DevSessionFailure {
  success: false;
  error: string;
}

// ==================== dev_session_create ====================

/** Parameters for dev_session_create */
export const DevSessionCreateParamsSchema = z.object({
  session_name: z.string().min(1, 'Session name is required').max(200, 'Session name must be 200 characters or less'),
  node: z.string().min(1, 'Node is required').max(200, 'Node must be 200 characters or less'),
  project_id: z.string().optional(),
  container: z.string().max(200).optional(),
  container_user: z.string().max(100).optional(),
  repo_org: z.string().max(100).optional(),
  repo_name: z.string().max(200).optional(),
  branch: z.string().max(200).optional(),
  task_summary: z.string().max(2000).optional(),
  task_prompt: z.string().max(10000).optional(),
  linked_issues: z.array(z.string()).optional(),
  linked_prs: z.array(z.string()).optional(),
});
export type DevSessionCreateParams = z.infer<typeof DevSessionCreateParamsSchema>;

/** Successful create result */
export interface DevSessionCreateSuccess {
  success: true;
  data: {
    content: string;
    details: {
      session_id: string;
      session_name: string;
      status: string;
      user_id: string;
    };
  };
}

export type DevSessionCreateResult = DevSessionCreateSuccess | DevSessionFailure;

export interface DevSessionCreateTool {
  name: string;
  description: string;
  parameters: typeof DevSessionCreateParamsSchema;
  execute: (params: DevSessionCreateParams) => Promise<DevSessionCreateResult>;
}

/**
 * Creates the dev_session_create tool.
 */
export function createDevSessionCreateTool(options: DevSessionToolOptions): DevSessionCreateTool {
  const { client, logger, user_id } = options;

  return {
    name: 'dev_session_create',
    description: 'Create a new developer coding session. Tracks what you are working on, which machine, branch, and linked issues.',
    parameters: DevSessionCreateParamsSchema,

    async execute(params: DevSessionCreateParams): Promise<DevSessionCreateResult> {
      const parseResult = DevSessionCreateParamsSchema.safeParse(params);
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
        return { success: false, error: errorMessage };
      }

      const { session_name, node, project_id, container, container_user, repo_org, repo_name, branch, task_summary, task_prompt, linked_issues, linked_prs } = parseResult.data;

      if (project_id && !isValidUuid(project_id)) {
        return { success: false, error: 'Invalid project_id format. Expected UUID.' };
      }

      logger.info('dev_session_create invoked', {
        user_id,
        sessionName: session_name,
        node,
      });

      try {
        const body: Record<string, unknown> = {
          user_email: user_id,
          session_name,
          node,
        };
        if (project_id) body.project_id = project_id;
        if (container) body.container = container;
        if (container_user) body.container_user = container_user;
        if (repo_org) body.repo_org = repo_org;
        if (repo_name) body.repo_name = repo_name;
        if (branch) body.branch = branch;
        if (task_summary) body.task_summary = stripHtml(task_summary);
        if (task_prompt) body.task_prompt = stripHtml(task_prompt);
        if (linked_issues) body.linked_issues = linked_issues;
        if (linked_prs) body.linked_prs = linked_prs;

        const response = await client.post<DevSession>(
          '/api/dev-sessions',
          body,
          { user_id },
        );

        if (!response.success) {
          logger.error('dev_session_create API error', {
            user_id,
            sessionName: session_name,
            status: response.error.status,
            code: response.error.code,
          });
          return { success: false, error: response.error.message || 'Failed to create dev session' };
        }

        const session = response.data;

        logger.debug('dev_session_create completed', {
          user_id,
          sessionId: session.id,
          sessionName: session.session_name,
        });

        return {
          success: true,
          data: {
            content: `Created dev session "${session.session_name}" on ${node} (ID: ${session.id}) — status: ${session.status}`,
            details: {
              session_id: session.id,
              session_name: session.session_name,
              status: session.status,
              user_id,
            },
          },
        };
      } catch (error) {
        logger.error('dev_session_create failed', {
          user_id,
          sessionName: session_name,
          error: error instanceof Error ? error.message : String(error),
        });
        return { success: false, error: sanitizeErrorMessage(error) };
      }
    },
  };
}

// ==================== dev_session_list ====================

/** Parameters for dev_session_list */
export const DevSessionListParamsSchema = z.object({
  status: z.string().max(50).optional(),
  node: z.string().max(200).optional(),
  project_id: z.string().optional(),
  limit: z.number().int().min(1).max(200).optional(),
  offset: z.number().int().min(0).optional(),
});
export type DevSessionListParams = z.infer<typeof DevSessionListParamsSchema>;

/** Successful list result */
export interface DevSessionListSuccess {
  success: true;
  data: {
    content: string;
    details: {
      sessions: DevSession[];
      total: number;
      user_id: string;
    };
  };
}

export type DevSessionListResult = DevSessionListSuccess | DevSessionFailure;

export interface DevSessionListTool {
  name: string;
  description: string;
  parameters: typeof DevSessionListParamsSchema;
  execute: (params: DevSessionListParams) => Promise<DevSessionListResult>;
}

/**
 * Creates the dev_session_list tool.
 */
export function createDevSessionListTool(options: DevSessionToolOptions): DevSessionListTool {
  const { client, logger, user_id } = options;

  return {
    name: 'dev_session_list',
    description: 'List dev sessions. Optionally filter by status (active, completed, abandoned), node, or project.',
    parameters: DevSessionListParamsSchema,

    async execute(params: DevSessionListParams): Promise<DevSessionListResult> {
      const parseResult = DevSessionListParamsSchema.safeParse(params);
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
        return { success: false, error: errorMessage };
      }

      const { status, node, project_id, limit = 50, offset = 0 } = parseResult.data;

      if (project_id && !isValidUuid(project_id)) {
        return { success: false, error: 'Invalid project_id format. Expected UUID.' };
      }

      logger.info('dev_session_list invoked', { user_id, status, node, limit, offset });

      try {
        const queryParams = new URLSearchParams({
          limit: String(limit),
          offset: String(offset),
        });
        if (status) queryParams.set('status', status);
        if (node) queryParams.set('node', node);
        if (project_id) queryParams.set('project_id', project_id);

        const response = await client.get<{ sessions?: DevSession[]; items?: DevSession[]; total?: number }>(
          `/api/dev-sessions?${queryParams.toString()}`,
          { user_id },
        );

        if (!response.success) {
          logger.error('dev_session_list API error', {
            user_id,
            status: response.error.status,
            code: response.error.code,
          });
          return { success: false, error: response.error.message || 'Failed to list dev sessions' };
        }

        const sessions = response.data.sessions ?? response.data.items ?? [];
        const total = response.data.total ?? sessions.length;

        if (sessions.length === 0) {
          return {
            success: true,
            data: {
              content: 'No dev sessions found.',
              details: { sessions: [], total: 0, user_id },
            },
          };
        }

        const content = sessions
          .map((s) => {
            const parts = [s.session_name, `[${s.status}]`, `on ${s.node}`];
            if (s.branch) parts.push(`branch: ${s.branch}`);
            return `- ${parts.join(' ')} (ID: ${s.id})`;
          })
          .join('\n');

        logger.debug('dev_session_list completed', { user_id, count: sessions.length });

        return {
          success: true,
          data: {
            content,
            details: { sessions, total, user_id },
          },
        };
      } catch (error) {
        logger.error('dev_session_list failed', {
          user_id,
          error: error instanceof Error ? error.message : String(error),
        });
        return { success: false, error: sanitizeErrorMessage(error) };
      }
    },
  };
}

// ==================== dev_session_get ====================

/** Parameters for dev_session_get */
export const DevSessionGetParamsSchema = z.object({
  session_id: z.string().min(1, 'Session ID is required'),
});
export type DevSessionGetParams = z.infer<typeof DevSessionGetParamsSchema>;

/** Successful get result */
export interface DevSessionGetSuccess {
  success: true;
  data: {
    content: string;
    details: {
      session: DevSession;
      user_id: string;
    };
  };
}

export type DevSessionGetResult = DevSessionGetSuccess | DevSessionFailure;

export interface DevSessionGetTool {
  name: string;
  description: string;
  parameters: typeof DevSessionGetParamsSchema;
  execute: (params: DevSessionGetParams) => Promise<DevSessionGetResult>;
}

/**
 * Creates the dev_session_get tool.
 */
export function createDevSessionGetTool(options: DevSessionToolOptions): DevSessionGetTool {
  const { client, logger, user_id } = options;

  return {
    name: 'dev_session_get',
    description: 'Get detailed information about a specific dev session including task, branch, context usage, and linked issues.',
    parameters: DevSessionGetParamsSchema,

    async execute(params: DevSessionGetParams): Promise<DevSessionGetResult> {
      const parseResult = DevSessionGetParamsSchema.safeParse(params);
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
        return { success: false, error: errorMessage };
      }

      const { session_id } = parseResult.data;

      if (!isValidUuid(session_id)) {
        return { success: false, error: 'Invalid session ID format. Expected UUID.' };
      }

      logger.info('dev_session_get invoked', { user_id, sessionId: session_id });

      try {
        const response = await client.get<DevSession>(`/api/dev-sessions/${session_id}`, { user_id });

        if (!response.success) {
          if (response.error.code === 'NOT_FOUND') {
            return { success: false, error: 'Dev session not found.' };
          }
          logger.error('dev_session_get API error', {
            user_id,
            sessionId: session_id,
            status: response.error.status,
          });
          return { success: false, error: response.error.message || 'Failed to get dev session' };
        }

        const session = response.data;
        const lines = [
          `**${session.session_name}** [${session.status}] on ${session.node}`,
        ];

        if (session.branch) lines.push(`Branch: ${session.branch}`);
        if (session.repo_org && session.repo_name) lines.push(`Repo: ${session.repo_org}/${session.repo_name}`);
        if (session.task_summary) lines.push(`Task: ${session.task_summary}`);
        if (session.context_pct != null) lines.push(`Context: ${session.context_pct}%`);
        if (session.linked_issues && session.linked_issues.length > 0) lines.push(`Issues: ${session.linked_issues.join(', ')}`);
        if (session.linked_prs && session.linked_prs.length > 0) lines.push(`PRs: ${session.linked_prs.join(', ')}`);
        if (session.created_at) lines.push(`Created: ${session.created_at}`);
        if (session.completed_at) lines.push(`Completed: ${session.completed_at}`);

        logger.debug('dev_session_get completed', { user_id, sessionId: session_id });

        return {
          success: true,
          data: {
            content: lines.join('\n'),
            details: { session, user_id },
          },
        };
      } catch (error) {
        logger.error('dev_session_get failed', {
          user_id,
          sessionId: session_id,
          error: error instanceof Error ? error.message : String(error),
        });
        return { success: false, error: sanitizeErrorMessage(error) };
      }
    },
  };
}

// ==================== dev_session_update ====================

/** Parameters for dev_session_update */
export const DevSessionUpdateParamsSchema = z.object({
  session_id: z.string().min(1, 'Session ID is required'),
  status: z.string().max(50).optional(),
  task_summary: z.string().max(2000).optional(),
  task_prompt: z.string().max(10000).optional(),
  branch: z.string().max(200).optional(),
  container: z.string().max(200).optional(),
  container_user: z.string().max(100).optional(),
  repo_org: z.string().max(100).optional(),
  repo_name: z.string().max(200).optional(),
  context_pct: z.number().min(0).max(100).optional(),
  last_capture: z.string().max(50000).optional(),
  last_capture_at: z.string().optional(),
  completion_summary: z.string().max(5000).optional(),
  linked_issues: z.array(z.string()).optional(),
  linked_prs: z.array(z.string()).optional(),
  webhook_id: z.string().max(200).optional(),
});
export type DevSessionUpdateParams = z.infer<typeof DevSessionUpdateParamsSchema>;

/** Successful update result */
export interface DevSessionUpdateSuccess {
  success: true;
  data: {
    content: string;
    details: {
      session: DevSession;
      user_id: string;
    };
  };
}

export type DevSessionUpdateResult = DevSessionUpdateSuccess | DevSessionFailure;

export interface DevSessionUpdateTool {
  name: string;
  description: string;
  parameters: typeof DevSessionUpdateParamsSchema;
  execute: (params: DevSessionUpdateParams) => Promise<DevSessionUpdateResult>;
}

/**
 * Creates the dev_session_update tool.
 */
export function createDevSessionUpdateTool(options: DevSessionToolOptions): DevSessionUpdateTool {
  const { client, logger, user_id } = options;

  return {
    name: 'dev_session_update',
    description: 'Update a dev session. Use this to change status, update task summary, record context percentage, or save a context capture.',
    parameters: DevSessionUpdateParamsSchema,

    async execute(params: DevSessionUpdateParams): Promise<DevSessionUpdateResult> {
      const parseResult = DevSessionUpdateParamsSchema.safeParse(params);
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
        return { success: false, error: errorMessage };
      }

      const { session_id, ...updates } = parseResult.data;

      if (!isValidUuid(session_id)) {
        return { success: false, error: 'Invalid session ID format. Expected UUID.' };
      }

      logger.info('dev_session_update invoked', {
        user_id,
        sessionId: session_id,
        updateFields: Object.keys(updates),
      });

      try {
        const body: Record<string, unknown> = { user_email: user_id };
        if (updates.status) body.status = updates.status;
        if (updates.task_summary) body.task_summary = stripHtml(updates.task_summary);
        if (updates.task_prompt) body.task_prompt = stripHtml(updates.task_prompt);
        if (updates.branch) body.branch = updates.branch;
        if (updates.container) body.container = updates.container;
        if (updates.container_user) body.container_user = updates.container_user;
        if (updates.repo_org) body.repo_org = updates.repo_org;
        if (updates.repo_name) body.repo_name = updates.repo_name;
        if (updates.context_pct !== undefined) body.context_pct = updates.context_pct;
        if (updates.last_capture) body.last_capture = updates.last_capture;
        if (updates.last_capture_at) body.last_capture_at = updates.last_capture_at;
        if (updates.completion_summary) body.completion_summary = stripHtml(updates.completion_summary);
        if (updates.linked_issues) body.linked_issues = updates.linked_issues;
        if (updates.linked_prs) body.linked_prs = updates.linked_prs;
        if (updates.webhook_id) body.webhook_id = updates.webhook_id;

        const response = await client.patch<DevSession>(
          `/api/dev-sessions/${session_id}`,
          body,
          { user_id },
        );

        if (!response.success) {
          if (response.error.code === 'NOT_FOUND') {
            return { success: false, error: 'Dev session not found.' };
          }
          logger.error('dev_session_update API error', {
            user_id,
            sessionId: session_id,
            status: response.error.status,
          });
          return { success: false, error: response.error.message || 'Failed to update dev session' };
        }

        const session = response.data;

        logger.debug('dev_session_update completed', {
          user_id,
          sessionId: session_id,
          updatedStatus: session.status,
        });

        return {
          success: true,
          data: {
            content: `Updated dev session "${session.session_name}" (ID: ${session.id}) — status: ${session.status}`,
            details: { session, user_id },
          },
        };
      } catch (error) {
        logger.error('dev_session_update failed', {
          user_id,
          sessionId: session_id,
          error: error instanceof Error ? error.message : String(error),
        });
        return { success: false, error: sanitizeErrorMessage(error) };
      }
    },
  };
}

// ==================== dev_session_complete ====================

/** Parameters for dev_session_complete */
export const DevSessionCompleteParamsSchema = z.object({
  session_id: z.string().min(1, 'Session ID is required'),
  completion_summary: z.string().max(5000).optional(),
});
export type DevSessionCompleteParams = z.infer<typeof DevSessionCompleteParamsSchema>;

/** Successful complete result */
export interface DevSessionCompleteSuccess {
  success: true;
  data: {
    content: string;
    details: {
      session: DevSession;
      user_id: string;
    };
  };
}

export type DevSessionCompleteResult = DevSessionCompleteSuccess | DevSessionFailure;

export interface DevSessionCompleteTool {
  name: string;
  description: string;
  parameters: typeof DevSessionCompleteParamsSchema;
  execute: (params: DevSessionCompleteParams) => Promise<DevSessionCompleteResult>;
}

/**
 * Creates the dev_session_complete tool.
 */
export function createDevSessionCompleteTool(options: DevSessionToolOptions): DevSessionCompleteTool {
  const { client, logger, user_id } = options;

  return {
    name: 'dev_session_complete',
    description: 'Mark a dev session as completed. Optionally include a summary of what was accomplished.',
    parameters: DevSessionCompleteParamsSchema,

    async execute(params: DevSessionCompleteParams): Promise<DevSessionCompleteResult> {
      const parseResult = DevSessionCompleteParamsSchema.safeParse(params);
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
        return { success: false, error: errorMessage };
      }

      const { session_id, completion_summary } = parseResult.data;

      if (!isValidUuid(session_id)) {
        return { success: false, error: 'Invalid session ID format. Expected UUID.' };
      }

      logger.info('dev_session_complete invoked', {
        user_id,
        sessionId: session_id,
        hasSummary: !!completion_summary,
      });

      try {
        const body: Record<string, unknown> = { user_email: user_id };
        if (completion_summary) body.completion_summary = stripHtml(completion_summary);

        const response = await client.post<DevSession>(
          `/api/dev-sessions/${session_id}/complete`,
          body,
          { user_id },
        );

        if (!response.success) {
          if (response.error.code === 'NOT_FOUND') {
            return { success: false, error: 'Dev session not found.' };
          }
          logger.error('dev_session_complete API error', {
            user_id,
            sessionId: session_id,
            status: response.error.status,
          });
          return { success: false, error: response.error.message || 'Failed to complete dev session' };
        }

        const session = response.data;

        logger.debug('dev_session_complete completed', {
          user_id,
          sessionId: session_id,
        });

        return {
          success: true,
          data: {
            content: `Dev session "${session.session_name}" marked as completed (ID: ${session.id})`,
            details: { session, user_id },
          },
        };
      } catch (error) {
        logger.error('dev_session_complete failed', {
          user_id,
          sessionId: session_id,
          error: error instanceof Error ? error.message : String(error),
        });
        return { success: false, error: sanitizeErrorMessage(error) };
      }
    },
  };
}

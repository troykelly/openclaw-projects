/**
 * Project management tools implementation.
 * Provides project_list, project_get, and project_create tools.
 */

import { z } from 'zod';
import type { ApiClient } from '../api-client.js';
import type { Logger } from '../logger.js';
import type { PluginConfig } from '../config.js';
import { sanitizeErrorMessage } from '../utils/sanitize.js';

/** UUID validation regex */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Project status enum */
export const ProjectStatus = z.enum(['active', 'completed', 'archived']);
export type ProjectStatus = z.infer<typeof ProjectStatus>;

// ==================== project_list ====================

/** Parameters for project_list tool */
export const ProjectListParamsSchema = z.object({
  status: ProjectStatus.optional(),
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).optional(),
});
export type ProjectListParams = z.infer<typeof ProjectListParamsSchema>;

/** Project item from API */
export interface Project {
  id: string;
  name?: string;
  title?: string;
  status?: string;
  description?: string;
  createdAt?: string;
  updatedAt?: string;
}

/** Successful list result */
export interface ProjectListSuccess {
  success: true;
  data: {
    content: string;
    details: {
      projects: Project[];
      total: number;
      userId: string;
    };
  };
}

/** Failed result */
export interface ProjectFailure {
  success: false;
  error: string;
}

export type ProjectListResult = ProjectListSuccess | ProjectFailure;

/** Tool configuration */
export interface ProjectToolOptions {
  client: ApiClient;
  logger: Logger;
  config: PluginConfig;
  userId: string;
}

/** Tool definition */
export interface ProjectListTool {
  name: string;
  description: string;
  parameters: typeof ProjectListParamsSchema;
  execute: (params: ProjectListParams) => Promise<ProjectListResult>;
}

/**
 * Strip HTML tags from a string.
 * Also removes content inside script and style tags for security.
 */
function stripHtml(text: string): string {
  return text
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<[^>]*>/g, '')
    .trim();
}

/**
 * Truncate text for display.
 */
function truncate(text: string, maxLength = 100): string {
  if (text.length <= maxLength) return text;
  return `${text.substring(0, maxLength)}...`;
}

/**
 * Creates the project_list tool.
 */
export function createProjectListTool(options: ProjectToolOptions): ProjectListTool {
  const { client, logger, userId } = options;

  return {
    name: 'project_list',
    description: 'List all projects. Optionally filter by status (active, completed, archived).',
    parameters: ProjectListParamsSchema,

    async execute(params: ProjectListParams): Promise<ProjectListResult> {
      const parseResult = ProjectListParamsSchema.safeParse(params);
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
        return { success: false, error: errorMessage };
      }

      const { status, limit = 20, offset = 0 } = parseResult.data;

      logger.info('project_list invoked', { userId, status, limit, offset });

      try {
        const queryParams = new URLSearchParams({
          item_type: 'project',
          limit: String(limit),
          offset: String(offset),
        });
        if (status) {
          queryParams.set('status', status);
        }

        const response = await client.get<{ items?: Project[]; total?: number }>(`/api/work-items?${queryParams.toString()}`, { userId });

        if (!response.success) {
          logger.error('project_list API error', {
            userId,
            status: response.error.status,
            code: response.error.code,
          });
          return {
            success: false,
            error: response.error.message || 'Failed to list projects',
          };
        }

        const projects = response.data.items ?? [];
        const total = response.data.total ?? projects.length;

        if (projects.length === 0) {
          return {
            success: true,
            data: {
              content: 'No projects found.',
              details: { projects: [], total: 0, userId },
            },
          };
        }

        const content = projects
          .map((p) => {
            const name = p.name ?? p.title ?? 'Untitled';
            const desc = p.description ? ` - ${truncate(p.description, 50)}` : '';
            return `- **${name}** [${p.status ?? 'unknown'}]${desc}`;
          })
          .join('\n');

        logger.debug('project_list completed', { userId, count: projects.length });

        return {
          success: true,
          data: {
            content,
            details: { projects, total, userId },
          },
        };
      } catch (error) {
        logger.error('project_list failed', {
          userId,
          error: error instanceof Error ? error.message : String(error),
        });
        return { success: false, error: sanitizeErrorMessage(error) };
      }
    },
  };
}

// ==================== project_get ====================

/** Parameters for project_get tool */
export const ProjectGetParamsSchema = z.object({
  id: z.string().min(1, 'Project ID is required'),
});
export type ProjectGetParams = z.infer<typeof ProjectGetParamsSchema>;

/** Successful get result */
export interface ProjectGetSuccess {
  success: true;
  data: {
    content: string;
    details: {
      project: Project;
      userId: string;
    };
  };
}

export type ProjectGetResult = ProjectGetSuccess | ProjectFailure;

export interface ProjectGetTool {
  name: string;
  description: string;
  parameters: typeof ProjectGetParamsSchema;
  execute: (params: ProjectGetParams) => Promise<ProjectGetResult>;
}

/**
 * Creates the project_get tool.
 */
export function createProjectGetTool(options: ProjectToolOptions): ProjectGetTool {
  const { client, logger, userId } = options;

  return {
    name: 'project_get',
    description: 'Get details of a specific project by ID.',
    parameters: ProjectGetParamsSchema,

    async execute(params: ProjectGetParams): Promise<ProjectGetResult> {
      const parseResult = ProjectGetParamsSchema.safeParse(params);
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
        return { success: false, error: errorMessage };
      }

      const { id } = parseResult.data;

      // Validate UUID format
      if (!UUID_REGEX.test(id)) {
        return { success: false, error: 'Invalid project ID format. Expected UUID.' };
      }

      logger.info('project_get invoked', { userId, projectId: id });

      try {
        const response = await client.get<Project>(`/api/work-items/${id}`, { userId });

        if (!response.success) {
          if (response.error.code === 'NOT_FOUND') {
            return { success: false, error: 'Project not found.' };
          }
          logger.error('project_get API error', {
            userId,
            projectId: id,
            status: response.error.status,
          });
          return {
            success: false,
            error: response.error.message || 'Failed to get project',
          };
        }

        const project = response.data;
        const name = project.name ?? project.title ?? 'Untitled';
        const content = `**${name}** [${project.status ?? 'unknown'}]\n\n${project.description ?? 'No description.'}`;

        logger.debug('project_get completed', { userId, projectId: id });

        return {
          success: true,
          data: {
            content,
            details: { project, userId },
          },
        };
      } catch (error) {
        logger.error('project_get failed', {
          userId,
          projectId: id,
          error: error instanceof Error ? error.message : String(error),
        });
        return { success: false, error: sanitizeErrorMessage(error) };
      }
    },
  };
}

// ==================== project_create ====================

/** Parameters for project_create tool */
export const ProjectCreateParamsSchema = z.object({
  name: z.string().min(1, 'Project name is required').max(200, 'Project name must be 200 characters or less'),
  description: z.string().max(2000, 'Description must be 2000 characters or less').optional(),
});
export type ProjectCreateParams = z.infer<typeof ProjectCreateParamsSchema>;

/** Successful create result */
export interface ProjectCreateSuccess {
  success: true;
  data: {
    content: string;
    details: {
      id: string;
      name: string;
      userId: string;
    };
  };
}

export type ProjectCreateResult = ProjectCreateSuccess | ProjectFailure;

export interface ProjectCreateTool {
  name: string;
  description: string;
  parameters: typeof ProjectCreateParamsSchema;
  execute: (params: ProjectCreateParams) => Promise<ProjectCreateResult>;
}

/**
 * Creates the project_create tool.
 */
export function createProjectCreateTool(options: ProjectToolOptions): ProjectCreateTool {
  const { client, logger, userId } = options;

  return {
    name: 'project_create',
    description: 'Create a new project.',
    parameters: ProjectCreateParamsSchema,

    async execute(params: ProjectCreateParams): Promise<ProjectCreateResult> {
      const parseResult = ProjectCreateParamsSchema.safeParse(params);
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
        return { success: false, error: errorMessage };
      }

      const { name, description } = parseResult.data;

      // Sanitize input
      const sanitizedName = stripHtml(name);
      const sanitizedDescription = description ? stripHtml(description) : undefined;

      if (sanitizedName.length === 0) {
        return { success: false, error: 'Project name cannot be empty after sanitization' };
      }

      logger.info('project_create invoked', {
        userId,
        nameLength: sanitizedName.length,
      });

      try {
        const response = await client.post<{ id: string; title?: string; name?: string }>(
          '/api/work-items',
          {
            title: sanitizedName,
            description: sanitizedDescription,
            item_type: 'project',
          },
          { userId },
        );

        if (!response.success) {
          logger.error('project_create API error', {
            userId,
            status: response.error.status,
            code: response.error.code,
          });
          return {
            success: false,
            error: response.error.message || 'Failed to create project',
          };
        }

        const newProject = response.data;

        logger.debug('project_create completed', {
          userId,
          projectId: newProject.id,
        });

        return {
          success: true,
          data: {
            content: `Created project "${sanitizedName}" (ID: ${newProject.id})`,
            details: {
              id: newProject.id,
              name: sanitizedName,
              userId,
            },
          },
        };
      } catch (error) {
        logger.error('project_create failed', {
          userId,
          error: error instanceof Error ? error.message : String(error),
        });
        return { success: false, error: sanitizeErrorMessage(error) };
      }
    },
  };
}

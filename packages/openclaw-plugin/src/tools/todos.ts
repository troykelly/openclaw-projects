/**
 * Todo management tools implementation.
 * Provides todo_list, todo_create, and todo_complete tools.
 */

import { z } from 'zod';
import type { ApiClient } from '../api-client.js';
import type { Logger } from '../logger.js';
import type { PluginConfig } from '../config.js';
import { sanitizeErrorMessage } from '../utils/sanitize.js';

/** UUID validation regex */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ISO 8601 date format (YYYY-MM-DD) */
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

// ==================== todo_list ====================

/** Parameters for todo_list tool */
export const TodoListParamsSchema = z.object({
  project_id: z.string().optional(),
  completed: z.boolean().optional(),
  limit: z.number().int().min(1).max(200).optional(),
  offset: z.number().int().min(0).optional(),
});
export type TodoListParams = z.infer<typeof TodoListParamsSchema>;

/** Todo item from API */
export interface Todo {
  id: string;
  title: string;
  completed: boolean;
  project_id?: string;
  dueDate?: string;
  created_at?: string;
  updated_at?: string;
}

/** Successful list result */
export interface TodoListSuccess {
  success: true;
  data: {
    content: string;
    details: {
      todos: Todo[];
      total: number;
      user_id: string;
    };
  };
}

/** Failed result */
export interface TodoFailure {
  success: false;
  error: string;
}

export type TodoListResult = TodoListSuccess | TodoFailure;

/** Tool configuration */
export interface TodoToolOptions {
  client: ApiClient;
  logger: Logger;
  config: PluginConfig;
  user_id: string;
}

/** Tool definition */
export interface TodoListTool {
  name: string;
  description: string;
  parameters: typeof TodoListParamsSchema;
  execute: (params: TodoListParams) => Promise<TodoListResult>;
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
 * Validate UUID format.
 */
function isValidUuid(id: string): boolean {
  return UUID_REGEX.test(id);
}

/**
 * Validate ISO 8601 date format (YYYY-MM-DD).
 */
function isValidIsoDate(date: string): boolean {
  if (!ISO_DATE_REGEX.test(date)) {
    return false;
  }
  // Also validate it's a real date
  const parsed = new Date(date);
  return !Number.isNaN(parsed.getTime());
}

/**
 * Creates the todo_list tool.
 */
export function createTodoListTool(options: TodoToolOptions): TodoListTool {
  const { client, logger, user_id } = options;

  return {
    name: 'todo_list',
    description: 'List todos. Optionally filter by project ID or completion status.',
    parameters: TodoListParamsSchema,

    async execute(params: TodoListParams): Promise<TodoListResult> {
      const parseResult = TodoListParamsSchema.safeParse(params);
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
        return { success: false, error: errorMessage };
      }

      const { project_id, completed, limit = 50, offset = 0 } = parseResult.data;

      // Validate project_id if provided
      if (project_id && !isValidUuid(project_id)) {
        return { success: false, error: 'Invalid project_id format. Expected UUID.' };
      }

      logger.info('todo_list invoked', { user_id, project_id, completed, limit, offset });

      try {
        const queryParams = new URLSearchParams({
          item_type: 'task',
          limit: String(limit),
          offset: String(offset),
        });
        if (project_id) {
          queryParams.set('parent_work_item_id', project_id);
        }
        if (completed !== undefined) {
          queryParams.set('status', completed ? 'completed' : 'active');
        }

        const response = await client.get<{ items?: Todo[]; total?: number }>(`/api/work-items?${queryParams.toString()}`, { user_id });

        if (!response.success) {
          logger.error('todo_list API error', {
            user_id,
            status: response.error.status,
            code: response.error.code,
          });
          return {
            success: false,
            error: response.error.message || 'Failed to list todos',
          };
        }

        const todos = response.data.items ?? [];
        const total = response.data.total ?? todos.length;

        if (todos.length === 0) {
          return {
            success: true,
            data: {
              content: 'No todos found.',
              details: { todos: [], total: 0, user_id },
            },
          };
        }

        const content = todos
          .map((t) => {
            const checkbox = t.completed ? '[x]' : '[ ]';
            const dueStr = t.dueDate ? ` (due: ${t.dueDate})` : '';
            return `- ${checkbox} ${t.title}${dueStr}`;
          })
          .join('\n');

        logger.debug('todo_list completed', { user_id, count: todos.length });

        return {
          success: true,
          data: {
            content,
            details: { todos, total, user_id },
          },
        };
      } catch (error) {
        logger.error('todo_list failed', {
          user_id,
          error: error instanceof Error ? error.message : String(error),
        });
        return { success: false, error: sanitizeErrorMessage(error) };
      }
    },
  };
}

// ==================== todo_create ====================

/** Parameters for todo_create tool */
export const TodoCreateParamsSchema = z.object({
  title: z.string().min(1, 'Todo title is required').max(500, 'Todo title must be 500 characters or less'),
  project_id: z.string().optional(),
  dueDate: z.string().optional(),
});
export type TodoCreateParams = z.infer<typeof TodoCreateParamsSchema>;

/** Successful create result */
export interface TodoCreateSuccess {
  success: true;
  data: {
    content: string;
    details: {
      id: string;
      title: string;
      user_id: string;
    };
  };
}

export type TodoCreateResult = TodoCreateSuccess | TodoFailure;

export interface TodoCreateTool {
  name: string;
  description: string;
  parameters: typeof TodoCreateParamsSchema;
  execute: (params: TodoCreateParams) => Promise<TodoCreateResult>;
}

/**
 * Creates the todo_create tool.
 */
export function createTodoCreateTool(options: TodoToolOptions): TodoCreateTool {
  const { client, logger, user_id } = options;

  return {
    name: 'todo_create',
    description: 'Create a new todo item. Optionally associate with a project and set a due date.',
    parameters: TodoCreateParamsSchema,

    async execute(params: TodoCreateParams): Promise<TodoCreateResult> {
      const parseResult = TodoCreateParamsSchema.safeParse(params);
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
        return { success: false, error: errorMessage };
      }

      const { title, project_id, dueDate } = parseResult.data;

      // Sanitize input
      const sanitizedTitle = stripHtml(title);

      if (sanitizedTitle.length === 0) {
        return { success: false, error: 'Todo title cannot be empty after sanitization' };
      }

      // Validate project_id if provided
      if (project_id && !isValidUuid(project_id)) {
        return { success: false, error: 'Invalid project_id format. Expected UUID.' };
      }

      // Validate dueDate if provided
      if (dueDate && !isValidIsoDate(dueDate)) {
        return { success: false, error: 'Invalid date format. Expected ISO 8601 (YYYY-MM-DD).' };
      }

      logger.info('todo_create invoked', {
        user_id,
        titleLength: sanitizedTitle.length,
        hasProjectId: !!project_id,
        hasDueDate: !!dueDate,
      });

      try {
        const body: Record<string, unknown> = {
          title: sanitizedTitle,
          item_type: 'task',
        };
        if (project_id) {
          body.parent_work_item_id = project_id;
        }
        if (dueDate) {
          body.not_after = dueDate;
        }

        const response = await client.post<{ id: string; title?: string }>('/api/work-items', body, { user_id });

        if (!response.success) {
          logger.error('todo_create API error', {
            user_id,
            status: response.error.status,
            code: response.error.code,
          });
          return {
            success: false,
            error: response.error.message || 'Failed to create todo',
          };
        }

        const newTodo = response.data;

        logger.debug('todo_create completed', {
          user_id,
          todoId: newTodo.id,
        });

        return {
          success: true,
          data: {
            content: `Created todo "${sanitizedTitle}" (ID: ${newTodo.id})`,
            details: {
              id: newTodo.id,
              title: sanitizedTitle,
              user_id,
            },
          },
        };
      } catch (error) {
        logger.error('todo_create failed', {
          user_id,
          error: error instanceof Error ? error.message : String(error),
        });
        return { success: false, error: sanitizeErrorMessage(error) };
      }
    },
  };
}

// ==================== todo_complete ====================

/** Parameters for todo_complete tool */
export const TodoCompleteParamsSchema = z.object({
  id: z.string().min(1, 'Todo ID is required'),
});
export type TodoCompleteParams = z.infer<typeof TodoCompleteParamsSchema>;

/** Successful complete result */
export interface TodoCompleteSuccess {
  success: true;
  data: {
    content: string;
    details: {
      id: string;
      user_id: string;
    };
  };
}

export type TodoCompleteResult = TodoCompleteSuccess | TodoFailure;

export interface TodoCompleteTool {
  name: string;
  description: string;
  parameters: typeof TodoCompleteParamsSchema;
  execute: (params: TodoCompleteParams) => Promise<TodoCompleteResult>;
}

/**
 * Creates the todo_complete tool.
 */
export function createTodoCompleteTool(options: TodoToolOptions): TodoCompleteTool {
  const { client, logger, user_id } = options;

  return {
    name: 'todo_complete',
    description: 'Mark a todo as completed. This operation is idempotent.',
    parameters: TodoCompleteParamsSchema,

    async execute(params: TodoCompleteParams): Promise<TodoCompleteResult> {
      const parseResult = TodoCompleteParamsSchema.safeParse(params);
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
        return { success: false, error: errorMessage };
      }

      const { id } = parseResult.data;

      // Validate UUID format
      if (!isValidUuid(id)) {
        return { success: false, error: 'Invalid todo ID format. Expected UUID.' };
      }

      logger.info('todo_complete invoked', { user_id, todoId: id });

      try {
        const response = await client.patch<{ status: string; title?: string }>(`/api/work-items/${id}/status`, { status: 'completed' }, { user_id });

        if (!response.success) {
          if (response.error.code === 'NOT_FOUND') {
            return { success: false, error: 'Todo not found.' };
          }
          logger.error('todo_complete API error', {
            user_id,
            todoId: id,
            status: response.error.status,
          });
          return {
            success: false,
            error: response.error.message || 'Failed to complete todo',
          };
        }

        logger.debug('todo_complete completed', { user_id, todoId: id });

        return {
          success: true,
          data: {
            content: 'Todo marked as completed.',
            details: {
              id,
              user_id,
            },
          },
        };
      } catch (error) {
        logger.error('todo_complete failed', {
          user_id,
          todoId: id,
          error: error instanceof Error ? error.message : String(error),
        });
        return { success: false, error: sanitizeErrorMessage(error) };
      }
    },
  };
}

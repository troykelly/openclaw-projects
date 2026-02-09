/**
 * CLI command handlers for the OpenClaw plugin.
 * These handlers can be registered with an OpenClaw CLI API.
 */

import type { ApiClient } from './api-client.js';
import type { Logger } from './logger.js';
import type { PluginConfig } from './config.js';

/** Default limit for recall command */
const DEFAULT_RECALL_LIMIT = 5;

/** Context required for CLI commands */
export interface CliContext {
  client: ApiClient;
  logger: Logger;
  config: PluginConfig;
  userId: string;
}

/** Result from a CLI command */
export interface CommandResult<T = unknown> {
  success: boolean;
  message: string;
  data?: T;
}

/** Options for recall command */
export interface RecallOptions {
  query: string;
  limit?: number;
}

/** Options for export command */
export interface ExportOptions {
  output?: string;
}

/** Status command result data */
export interface StatusData {
  healthy: boolean;
  latencyMs: number;
  apiUrl: string;
}

/** Users command result data */
export interface UsersData {
  scopingMode: string;
  description: string;
  currentUserId: string;
}

/** Memory item for recall results */
export interface MemoryItem {
  id: string;
  content: string;
  score: number;
  category?: string;
}

/** Recall command result data */
export interface RecallData {
  memories: MemoryItem[];
  query: string;
  limit: number;
}

/** Stats command result data */
export interface StatsData {
  totalMemories: number;
  byCategory: Record<string, number>;
  recentActivity?: {
    last24h: number;
    last7d: number;
  };
}

/** Export command result data */
export interface ExportData {
  memories: Array<{
    id: string;
    content: string;
    category?: string;
  }>;
  exportedAt: string;
  userId: string;
  suggestedPath?: string;
}

/** User scoping mode descriptions */
const SCOPING_DESCRIPTIONS: Record<string, string> = {
  agent: 'Memories are scoped by agent ID. One agent = one user. All sessions for this agent share the same memories.',
  identity: 'Memories are scoped by canonical identity from identity links. Useful when a single user may interact through multiple agents.',
  session: 'Memories are scoped by full session key. Most isolated mode - each session has separate memories.',
};

/**
 * Creates the status command handler.
 * Tests API connectivity and displays health information.
 */
export function createStatusCommand(ctx: CliContext): () => Promise<CommandResult<StatusData>> {
  const { client, logger, config } = ctx;

  return async (): Promise<CommandResult<StatusData>> => {
    logger.info('CLI status command invoked', { userId: ctx.userId });

    try {
      const response = await client.healthCheck();

      if (response.healthy) {
        return {
          success: true,
          message: `API is healthy (latency: ${response.latencyMs}ms)`,
          data: {
            healthy: true,
            latencyMs: response.latencyMs,
            apiUrl: config.apiUrl,
          },
        };
      } else {
        return {
          success: false,
          message: 'API is unhealthy',
          data: {
            healthy: false,
            latencyMs: response.latencyMs,
            apiUrl: config.apiUrl,
          },
        };
      }
    } catch (error) {
      logger.error('CLI status command error', {
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        success: false,
        message: `Connection error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  };
}

/**
 * Creates the users command handler.
 * Displays current user scoping configuration.
 */
export function createUsersCommand(ctx: CliContext): () => Promise<CommandResult<UsersData>> {
  const { logger, config, userId } = ctx;

  return async (): Promise<CommandResult<UsersData>> => {
    logger.info('CLI users command invoked', { userId });

    const scopingMode = config.userScoping;
    const description = SCOPING_DESCRIPTIONS[scopingMode] ?? 'Unknown scoping mode';

    return {
      success: true,
      message: `User scoping mode: ${scopingMode}`,
      data: {
        scopingMode,
        description,
        currentUserId: userId,
      },
    };
  };
}

/**
 * Creates the recall command handler.
 * Searches memories from the command line.
 */
export function createRecallCommand(ctx: CliContext): (options: RecallOptions) => Promise<CommandResult<RecallData>> {
  const { client, logger, config, userId } = ctx;

  return async (options: RecallOptions): Promise<CommandResult<RecallData>> => {
    const { query, limit = config.maxRecallMemories ?? DEFAULT_RECALL_LIMIT } = options;

    // Log without query content for privacy
    logger.info('CLI recall command invoked', {
      userId,
      queryLength: query?.length ?? 0,
      limit,
    });

    if (!query || query.trim() === '') {
      return {
        success: false,
        message: 'Error: query is required',
      };
    }

    try {
      const queryParams = new URLSearchParams({
        query: query.substring(0, 500), // Limit query length
        limit: String(limit),
      });

      const response = await client.get<{ memories: MemoryItem[] }>(`/api/memory/recall?${queryParams.toString()}`, { userId });

      if (!response.success) {
        logger.error('CLI recall command API error', {
          userId,
          status: response.error.status,
          code: response.error.code,
        });

        return {
          success: false,
          message: `API error: ${response.error.message}`,
        };
      }

      const memories = response.data.memories ?? [];

      return {
        success: true,
        message: `Found ${memories.length} memories`,
        data: {
          memories,
          query,
          limit,
        },
      };
    } catch (error) {
      logger.error('CLI recall command error', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        success: false,
        message: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  };
}

/**
 * Creates the stats command handler.
 * Displays memory statistics.
 */
export function createStatsCommand(ctx: CliContext): () => Promise<CommandResult<StatsData>> {
  const { client, logger, userId } = ctx;

  return async (): Promise<CommandResult<StatsData>> => {
    logger.info('CLI stats command invoked', { userId });

    try {
      const response = await client.get<StatsData>('/api/memory/stats', { userId });

      if (!response.success) {
        logger.error('CLI stats command API error', {
          userId,
          status: response.error.status,
          code: response.error.code,
        });

        return {
          success: false,
          message: `API error: ${response.error.message}`,
        };
      }

      return {
        success: true,
        message: `Total memories: ${response.data.totalMemories}`,
        data: response.data,
      };
    } catch (error) {
      logger.error('CLI stats command error', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        success: false,
        message: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  };
}

/**
 * Creates the export command handler.
 * Exports all memories for GDPR data portability.
 */
export function createExportCommand(ctx: CliContext): (options?: ExportOptions) => Promise<CommandResult<ExportData>> {
  const { client, logger, userId } = ctx;

  return async (options?: ExportOptions): Promise<CommandResult<ExportData>> => {
    logger.info('CLI export command invoked', { userId });

    try {
      const response = await client.get<{
        memories: Array<{ id: string; content: string; category?: string }>;
        exportedAt: string;
      }>('/api/memory/export', { userId });

      if (!response.success) {
        logger.error('CLI export command API error', {
          userId,
          status: response.error.status,
          code: response.error.code,
        });

        return {
          success: false,
          message: `API error: ${response.error.message}`,
        };
      }

      return {
        success: true,
        message: `Exported ${response.data.memories.length} memories`,
        data: {
          memories: response.data.memories,
          exportedAt: response.data.exportedAt,
          userId,
          suggestedPath: options?.output,
        },
      };
    } catch (error) {
      logger.error('CLI export command error', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        success: false,
        message: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  };
}

/** All CLI command handlers */
export interface CliCommands {
  status: () => Promise<CommandResult<StatusData>>;
  users: () => Promise<CommandResult<UsersData>>;
  recall: (options: RecallOptions) => Promise<CommandResult<RecallData>>;
  stats: () => Promise<CommandResult<StatsData>>;
  export: (options?: ExportOptions) => Promise<CommandResult<ExportData>>;
}

/**
 * Creates all CLI command handlers.
 */
export function createCliCommands(ctx: CliContext): CliCommands {
  return {
    status: createStatusCommand(ctx),
    users: createUsersCommand(ctx),
    recall: createRecallCommand(ctx),
    stats: createStatsCommand(ctx),
    export: createExportCommand(ctx),
  };
}

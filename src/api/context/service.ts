/**
 * Context retrieval service for the auto-recall feature.
 * Part of Epic #235 - Issue #251.
 *
 * This service retrieves relevant context (memories, projects, todos)
 * based on a user's prompt using semantic search.
 */

import type { Pool } from 'pg';
import { searchMemoriesSemantic } from '../embeddings/memory-integration.ts';

/** Input for context retrieval */
export interface ContextRetrievalInput {
  /** User identifier for scoping */
  user_id?: string;
  /** The prompt/query to find relevant context for */
  prompt: string;
  /** Maximum number of memories to include (1-20, default 5) */
  max_memories?: number;
  /** Maximum length of the context string (100-10000, default 2000) */
  max_context_length?: number;
  /** Whether to include active projects (default false) */
  include_projects?: boolean;
  /** Whether to include pending todos (default false) */
  include_todos?: boolean;
  /** Whether to include contacts (default false) */
  include_contacts?: boolean;
  /** Minimum similarity score for memories (0-1, default 0.5) */
  min_similarity?: number;
}

/** Memory source in context response */
export interface MemorySource {
  id: string;
  title: string;
  content: string;
  type: string;
  similarity: number;
}

/** Project source in context response */
export interface ProjectSource {
  id: string;
  title: string;
  description?: string;
  status: string;
}

/** Todo source in context response */
export interface TodoSource {
  id: string;
  title: string;
  due_date?: string;
  completed: boolean;
}

/** Sources included in context */
export interface ContextSources {
  memories: MemorySource[];
  projects?: ProjectSource[];
  todos?: TodoSource[];
}

/** Metadata about the context retrieval */
export interface ContextMetadata {
  query_time_ms: number;
  memory_count: number;
  project_count?: number;
  todo_count?: number;
  truncated: boolean;
  search_type: 'semantic' | 'text';
}

/** Result of context retrieval */
export interface ContextRetrievalResult {
  /** Formatted context string, or null if nothing relevant */
  context: string | null;
  /** Sources used to build the context */
  sources: ContextSources;
  /** Metadata about the retrieval */
  metadata: ContextMetadata;
}

/**
 * Validates input parameters for context retrieval.
 * Returns an error message if invalid, null if valid.
 */
export function validateContextInput(input: ContextRetrievalInput): string | null {
  // Prompt validation
  if (!input.prompt || typeof input.prompt !== 'string') {
    return 'prompt is required';
  }
  if (input.prompt.trim().length === 0) {
    return 'prompt cannot be empty';
  }
  if (input.prompt.length > 2000) {
    return 'prompt must be 2000 characters or less';
  }

  // max_memories validation
  if (input.max_memories !== undefined) {
    if (typeof input.max_memories !== 'number' || input.max_memories < 1 || input.max_memories > 20) {
      return 'max_memories must be between 1 and 20';
    }
  }

  // max_context_length validation
  if (input.max_context_length !== undefined) {
    if (typeof input.max_context_length !== 'number' || input.max_context_length < 100 || input.max_context_length > 10000) {
      return 'max_context_length must be between 100 and 10000';
    }
  }

  // min_similarity validation
  if (input.min_similarity !== undefined) {
    if (typeof input.min_similarity !== 'number' || input.min_similarity < 0 || input.min_similarity > 1) {
      return 'min_similarity must be between 0 and 1';
    }
  }

  return null;
}

/**
 * Retrieves relevant context based on a prompt.
 *
 * Uses semantic search to find relevant memories, and optionally
 * includes active projects and pending todos.
 */
export async function retrieveContext(pool: Pool, input: ContextRetrievalInput): Promise<ContextRetrievalResult> {
  const startTime = Date.now();

  const { prompt, max_memories: maxMemories = 5, max_context_length: maxContextLength = 2000, include_projects: includeProjects = false, include_todos: includeTodos = false, min_similarity: min_similarity = 0.5 } = input;

  // Initialize result
  const sources: ContextSources = {
    memories: [],
    projects: includeProjects ? [] : undefined,
    todos: includeTodos ? [] : undefined,
  };

  let search_type: 'semantic' | 'text' = 'text';
  let truncated = false;

  // Fetch memories using semantic search
  try {
    const searchResult = await searchMemoriesSemantic(pool, prompt, {
      limit: maxMemories,
    });

    search_type = searchResult.search_type;

    // Filter by similarity threshold
    sources.memories = searchResult.results
      .filter((m) => m.similarity >= min_similarity)
      .map((m) => ({
        id: m.id,
        title: m.title,
        content: m.content,
        type: m.type,
        similarity: m.similarity,
      }));
  } catch (error) {
    console.error('[Context] Memory search failed:', error);
    // Continue without memories
  }

  // Fetch active projects if requested
  if (includeProjects) {
    try {
      // Epic #1418 Phase 4: user_email column dropped from work_item table.
      // Namespace scoping is handled at the route level.
      const projectResult = await pool.query(
        `SELECT
           id::text,
           title,
           description,
           status::text
         FROM work_item
         WHERE kind = 'project'
           AND status NOT IN ('completed', 'archived', 'deleted')
         ORDER BY updated_at DESC
         LIMIT 5`,
      );

      sources.projects = projectResult.rows.map((row) => ({
        id: row.id,
        title: row.title,
        description: row.description,
        status: row.status,
      }));
    } catch (error) {
      console.error('[Context] Project fetch failed:', error);
    }
  }

  // Fetch pending todos if requested
  if (includeTodos) {
    try {
      // Epic #1418 Phase 4: user_email column dropped from work_item table.
      // Namespace scoping is handled at the route level.
      const todoResult = await pool.query(
        `SELECT
           id::text,
           title,
           not_after as "dueDate",
           status::text
         FROM work_item
         WHERE kind IN ('task', 'issue')
           AND status NOT IN ('completed', 'archived', 'deleted')
         ORDER BY
           CASE WHEN not_after IS NOT NULL THEN 0 ELSE 1 END,
           not_after ASC,
           updated_at DESC
         LIMIT 10`,
      );

      sources.todos = todoResult.rows.map((row) => ({
        id: row.id,
        title: row.title,
        due_date: row.dueDate ? new Date(row.dueDate).toISOString() : undefined,
        completed: row.status === 'completed',
      }));
    } catch (error) {
      console.error('[Context] Todo fetch failed:', error);
    }
  }

  // Build context string
  let context = buildContextString(sources, maxContextLength);

  // Check if truncation occurred
  if (context && context.length >= maxContextLength) {
    truncated = true;
    // Ensure we don't cut in the middle of a word
    const lastSpace = context.lastIndexOf(' ', maxContextLength - 3);
    if (lastSpace > maxContextLength * 0.8) {
      context = context.substring(0, lastSpace) + '...';
    } else {
      context = context.substring(0, maxContextLength - 3) + '...';
    }
  }

  const queryTimeMs = Date.now() - startTime;

  return {
    context: context || null,
    sources,
    metadata: {
      query_time_ms: queryTimeMs,
      memory_count: sources.memories.length,
      project_count: sources.projects?.length,
      todo_count: sources.todos?.length,
      truncated,
      search_type: search_type,
    },
  };
}

/**
 * Builds a formatted context string from sources.
 */
function buildContextString(sources: ContextSources, maxLength: number): string {
  const parts: string[] = [];

  // Add memories
  if (sources.memories.length > 0) {
    parts.push('## Relevant Memories\n');
    for (const memory of sources.memories) {
      parts.push(`- **${memory.title}**: ${memory.content}\n`);
    }
    parts.push('\n');
  }

  // Add projects
  if (sources.projects && sources.projects.length > 0) {
    parts.push('## Active Projects\n');
    for (const project of sources.projects) {
      const desc = project.description ? `: ${project.description}` : '';
      parts.push(`- **${project.title}** (${project.status})${desc}\n`);
    }
    parts.push('\n');
  }

  // Add todos
  if (sources.todos && sources.todos.length > 0) {
    parts.push('## Pending Tasks\n');
    for (const todo of sources.todos) {
      const due = todo.due_date ? ` (due: ${todo.due_date.split('T')[0]})` : '';
      const checkbox = todo.completed ? '[x]' : '[ ]';
      parts.push(`- ${checkbox} ${todo.title}${due}\n`);
    }
    parts.push('\n');
  }

  const fullContext = parts.join('');

  // Return empty string if nothing found
  if (fullContext.trim().length === 0) {
    return '';
  }

  // Truncate if needed (rough truncation, will be refined in caller)
  if (fullContext.length > maxLength) {
    return fullContext.substring(0, maxLength);
  }

  return fullContext.trim();
}

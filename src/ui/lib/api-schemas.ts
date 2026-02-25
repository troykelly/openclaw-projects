/**
 * Zod schemas for runtime validation of API responses.
 *
 * These schemas validate the *shape* of API responses before they reach
 * React components. They use `.passthrough()` on objects so extra fields
 * from the API are preserved (forward-compatible).
 *
 * Only the highest-risk response types are validated here — specifically
 * those that return arrays or complex nested objects, which crash hardest
 * when the API returns unexpected data.
 *
 * @see Issue #1743
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Work Items
// ---------------------------------------------------------------------------

export const workItemSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string().nullable(),
  priority: z.string().nullable(),
  task_type: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
}).passthrough();

export const workItemsResponseSchema = z.object({
  items: z.array(workItemSummarySchema),
}).passthrough();

export const workItemTreeNodeSchema: z.ZodType<{
  id: string;
  title: string;
  kind: string;
  status: string;
  priority: string;
  parent_id: string | null;
  children_count: number;
  children: unknown[];
}> = z.object({
  id: z.string(),
  title: z.string(),
  kind: z.string(),
  status: z.string(),
  priority: z.string(),
  parent_id: z.string().nullable(),
  children_count: z.number(),
  children: z.array(z.lazy(() => workItemTreeNodeSchema)),
}).passthrough();

export const workItemTreeResponseSchema = z.object({
  items: z.array(workItemTreeNodeSchema),
}).passthrough();

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

export const contactSchema = z.object({
  id: z.string(),
  display_name: z.string().nullable(),
  created_at: z.string(),
}).passthrough();

export const contactsResponseSchema = z.object({
  contacts: z.array(contactSchema),
  total: z.number(),
}).passthrough();

export const tagCountSchema = z.object({
  tag: z.string(),
  contact_count: z.number(),
}).passthrough();

export const tagCountArraySchema = z.array(tagCountSchema);

// ---------------------------------------------------------------------------
// Memories
// ---------------------------------------------------------------------------

/** Minimal memory shape shared across all endpoints. */
export const memoryBaseSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
}).passthrough();

/**
 * GET /api/memory returns `{ items, total }` (not `{ memories }`).
 * Each item has at minimum: id, title, content.
 */
export const memoryListResponseSchema = z.object({
  items: z.array(memoryBaseSchema),
  total: z.number(),
}).passthrough();

/**
 * GET /api/work-items/:id/memories returns `{ memories: [{ id, title, content, type, ... }] }`.
 * The shape is a reduced projection — only validate the guaranteed fields.
 */
export const workItemMemoriesResponseSchema = z.object({
  memories: z.array(memoryBaseSchema),
}).passthrough();

/** GET /api/memories/search returns `{ results, search_type }`. */
export const memorySearchResultSchema = memoryBaseSchema.extend({
  similarity: z.number().optional(),
}).passthrough();

export const memorySearchResponseSchema = z.object({
  results: z.array(memorySearchResultSchema),
  search_type: z.string(),
}).passthrough();

/**
 * GET /api/memories/:id/similar returns `{ source_memory_id, threshold, similar }`.
 * Different shape from search — use a separate schema.
 */
export const memorySimilarResponseSchema = z.object({
  source_memory_id: z.string(),
  threshold: z.number(),
  similar: z.array(memoryBaseSchema),
}).passthrough();

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export const notificationSchema = z.object({
  id: z.string(),
  type: z.string(),
  title: z.string(),
  read: z.boolean(),
  created_at: z.string(),
}).passthrough();

export const notificationsResponseSchema = z.object({
  notifications: z.array(notificationSchema),
  total: z.number(),
}).passthrough();

export const unreadCountResponseSchema = z.object({
  count: z.number(),
}).passthrough();

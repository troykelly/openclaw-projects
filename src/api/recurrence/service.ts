/**
 * Recurrence service for managing recurring work items.
 * Part of Issue #217.
 */

import rruleModule from 'rrule';
const { RRule } = rruleModule;
type RRuleInstance = InstanceType<typeof RRule>;
import type { Pool } from 'pg';
import type { RecurrenceInfo, RecurrenceInstance } from './types.ts';
import { parseNaturalLanguage, describeRrule } from './parser.ts';

/**
 * Parse an RRULE string and return the RRule object
 */
export function parseRRule(ruleString: string): RRuleInstance {
  // Remove RRULE: prefix if present
  const cleanRule = ruleString.replace(/^RRULE:/i, '');
  return RRule.fromString(`RRULE:${cleanRule}`);
}

/**
 * Get the next N occurrences of a recurrence rule
 */
export function getNextOccurrences(ruleString: string, count: number = 10, after: Date = new Date()): Date[] {
  const rule = parseRRule(ruleString);
  const nextDate = rule.after(after, true);
  if (!nextDate) return [];

  const endDate = rule.options.until || new Date(after.getTime() + 365 * 24 * 60 * 60 * 1000);
  return rule.between(after, endDate, true, (_: Date, len: number) => len < count);
}

/**
 * Get the next occurrence of a recurrence rule
 */
export function getNextOccurrence(ruleString: string, after: Date = new Date()): Date | null {
  const rule = parseRRule(ruleString);
  return rule.after(after, true);
}

/**
 * Create a recurrence template work item
 */
export async function createRecurrenceTemplate(
  pool: Pool,
  params: {
    title: string;
    description?: string;
    recurrenceRule: string;
    recurrenceEnd?: Date;
    priority?: string;
    taskType?: string;
    parentWorkItemId?: string;
    workItemKind?: string;
  },
): Promise<{ id: string; rrule: string; description: string }> {
  const result = await pool.query(
    `INSERT INTO work_item (
      title,
      description,
      recurrence_rule,
      recurrence_end,
      is_recurrence_template,
      priority,
      task_type,
      parent_work_item_id,
      work_item_kind,
      status
    ) VALUES ($1, $2, $3, $4, true, COALESCE($5::work_item_priority, 'P2'), COALESCE($6::work_item_task_type, 'general'), $7, COALESCE($8::work_item_kind, 'issue'), 'open')
    RETURNING id::text`,
    [
      params.title,
      params.description || null,
      params.recurrenceRule,
      params.recurrenceEnd || null,
      params.priority || null,
      params.taskType || null,
      params.parentWorkItemId || null,
      params.workItemKind || null,
    ],
  );

  return {
    id: result.rows[0].id,
    rrule: params.recurrenceRule,
    description: describeRrule(params.recurrenceRule),
  };
}

/**
 * Create a work item from a natural language recurrence description
 */
export async function createFromNaturalLanguage(
  pool: Pool,
  params: {
    title: string;
    description?: string;
    recurrenceNatural: string;
    priority?: string;
    taskType?: string;
    parentWorkItemId?: string;
    workItemKind?: string;
  },
): Promise<{
  id: string;
  is_recurring: boolean;
  rrule: string | null;
  description: string;
}> {
  const parseResult = parseNaturalLanguage(params.recurrenceNatural);

  if (parseResult.is_recurring && parseResult.rrule) {
    const template = await createRecurrenceTemplate(pool, {
      title: params.title,
      description: params.description,
      recurrenceRule: parseResult.rrule,
      priority: params.priority,
      taskType: params.taskType,
      parentWorkItemId: params.parentWorkItemId,
      workItemKind: params.workItemKind,
    });

    return {
      id: template.id,
      is_recurring: true,
      rrule: parseResult.rrule,
      description: parseResult.description,
    };
  }

  // Not recurring - create a regular work item
  const result = await pool.query(
    `INSERT INTO work_item (
      title,
      description,
      priority,
      task_type,
      parent_work_item_id,
      work_item_kind,
      status
    ) VALUES ($1, $2, COALESCE($3::work_item_priority, 'P2'), COALESCE($4::work_item_task_type, 'general'), $5, COALESCE($6::work_item_kind, 'issue'), 'open')
    RETURNING id::text`,
    [params.title, params.description || null, params.priority || null, params.taskType || null, params.parentWorkItemId || null, params.workItemKind || null],
  );

  return {
    id: result.rows[0].id,
    is_recurring: false,
    rrule: null,
    description: parseResult.description,
  };
}

/**
 * Get recurrence information for a work item
 */
export async function getRecurrenceInfo(pool: Pool, work_item_id: string): Promise<RecurrenceInfo | null> {
  const result = await pool.query(
    `SELECT
      recurrence_rule,
      recurrence_end,
      recurrence_parent_id::text as parent_id,
      is_recurrence_template
    FROM work_item
    WHERE id = $1`,
    [work_item_id],
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];

  // If not a template and no rule, no recurrence info
  if (!row.is_recurrence_template && !row.recurrence_rule && !row.parent_id) {
    return null;
  }

  let next_occurrence: Date | null = null;
  if (row.recurrence_rule) {
    next_occurrence = getNextOccurrence(row.recurrence_rule);
  }

  return {
    rule: row.recurrence_rule,
    end: row.recurrence_end,
    parent_id: row.parent_id,
    is_template: row.is_recurrence_template,
    next_occurrence,
  };
}

/**
 * Update recurrence rule for a work item
 */
export async function updateRecurrence(
  pool: Pool,
  work_item_id: string,
  params: {
    recurrenceRule?: string;
    recurrenceEnd?: Date | null;
  },
): Promise<boolean> {
  const updates: string[] = [];
  const values: (string | Date | null)[] = [];
  let paramIndex = 1;

  if (params.recurrenceRule !== undefined) {
    updates.push(`recurrence_rule = $${paramIndex++}`);
    values.push(params.recurrenceRule);
    updates.push(`is_recurrence_template = true`);
  }

  if (params.recurrenceEnd !== undefined) {
    updates.push(`recurrence_end = $${paramIndex++}`);
    values.push(params.recurrenceEnd);
  }

  if (updates.length === 0) {
    return false;
  }

  values.push(work_item_id);
  const result = await pool.query(
    `UPDATE work_item
    SET ${updates.join(', ')}, updated_at = now()
    WHERE id = $${paramIndex}`,
    values,
  );

  return result.rowCount !== null && result.rowCount > 0;
}

/**
 * Stop recurrence for a work item (remove recurrence rule)
 */
export async function stopRecurrence(pool: Pool, work_item_id: string): Promise<boolean> {
  const result = await pool.query(
    `UPDATE work_item
    SET recurrence_rule = NULL,
        recurrence_end = NULL,
        is_recurrence_template = false,
        updated_at = now()
    WHERE id = $1`,
    [work_item_id],
  );

  return result.rowCount !== null && result.rowCount > 0;
}

/**
 * Create an instance from a recurrence template
 */
export async function createInstance(pool: Pool, templateId: string, scheduled_date: Date): Promise<string | null> {
  // Get the template
  const templateResult = await pool.query(
    `SELECT
      title,
      description,
      priority,
      task_type,
      parent_work_item_id,
      work_item_kind
    FROM work_item
    WHERE id = $1 AND is_recurrence_template = true`,
    [templateId],
  );

  if (templateResult.rows.length === 0) {
    return null;
  }

  const template = templateResult.rows[0];

  // Create the instance
  const result = await pool.query(
    `INSERT INTO work_item (
      title,
      description,
      priority,
      task_type,
      parent_work_item_id,
      work_item_kind,
      recurrence_parent_id,
      not_before,
      status
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'open')
    RETURNING id::text`,
    [
      template.title,
      template.description,
      template.priority,
      template.task_type,
      template.parent_work_item_id,
      template.work_item_kind,
      templateId,
      scheduled_date,
    ],
  );

  return result.rows[0].id;
}

/**
 * Get instances of a recurrence template
 */
export async function getInstances(
  pool: Pool,
  templateId: string,
  options: {
    limit?: number;
    includeCompleted?: boolean;
  } = {},
): Promise<RecurrenceInstance[]> {
  const limit = options.limit || 50;
  const includeCompleted = options.includeCompleted ?? true;

  let query = `
    SELECT
      id::text,
      title,
      status,
      not_before as scheduled_date,
      created_at,
      CASE WHEN status = 'closed' THEN updated_at ELSE NULL END as completed_at
    FROM work_item
    WHERE recurrence_parent_id = $1
  `;

  if (!includeCompleted) {
    query += ` AND status != 'closed'`;
  }

  query += ` ORDER BY not_before ASC NULLS LAST, created_at DESC LIMIT $2`;

  const result = await pool.query(query, [templateId, limit]);

  return result.rows.map((row) => ({
    id: row.id,
    title: row.title,
    status: row.status,
    scheduled_date: row.scheduled_date,
    created_at: row.created_at,
    completed_at: row.completed_at,
  }));
}

/**
 * Truncate a Date to the start of its UTC day (YYYY-MM-DD).
 *
 * RRule without a persisted DTSTART anchors occurrences to the parse-time,
 * so two calls seconds (or even minutes) apart generate slightly different
 * timestamps for the same logical slot.  Because all recurrence rules in
 * this system are daily or coarser (DAILY, WEEKLY, MONTHLY, YEARLY), we
 * compare at day granularity, which is immune to sub-day drift.
 */
function truncateToDay(d: Date): string {
  return d.toISOString().slice(0, 10); // "YYYY-MM-DD"
}

/**
 * Generate upcoming instances for all templates
 * This is typically called by a scheduled job
 */
export async function generateUpcomingInstances(pool: Pool, daysAhead: number = 14): Promise<{ generated: number; errors: string[] }> {
  const errors: string[] = [];
  let generated = 0;

  // Capture a single reference time for the entire run so that the RRule
  // generator and the lookahead window use a consistent "now".
  const now = new Date();

  // Get all active templates
  const templates = await pool.query(
    `SELECT
      id::text,
      recurrence_rule,
      recurrence_end
    FROM work_item
    WHERE is_recurrence_template = true
      AND recurrence_rule IS NOT NULL
      AND (recurrence_end IS NULL OR recurrence_end > $1)`,
    [now],
  );

  const endDate = new Date(now);
  endDate.setDate(endDate.getDate() + daysAhead);

  for (const template of templates.rows) {
    try {
      // Get existing instances — no lower bound so we never miss an instance
      // that was created at the boundary of a previous run (fixes #2420 now()
      // drift). Dates are truncated to the day for comparison so that
      // occurrences generated at different times still deduplicate correctly.
      const existingInstances = await pool.query(
        `SELECT not_before
        FROM work_item
        WHERE recurrence_parent_id = $1
          AND not_before IS NOT NULL
          AND not_before <= $2`,
        [template.id, endDate],
      );

      const existingDates = new Set(existingInstances.rows.map((r) => truncateToDay(r.not_before)));

      // Get occurrences that should exist — use the same `now` reference for
      // consistency within a single run.
      const occurrences = getNextOccurrences(
        template.recurrence_rule,
        100, // Max instances to generate
        now,
      ).filter((d) => d <= endDate);

      // Create missing instances
      for (const occurrence of occurrences) {
        if (!existingDates.has(truncateToDay(occurrence))) {
          const instanceId = await createInstance(pool, template.id, occurrence);
          if (instanceId) {
            generated++;
          }
        }
      }
    } catch (error) {
      errors.push(`Error processing template ${template.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { generated, errors };
}

/**
 * Get all recurrence templates
 */
export async function getTemplates(
  pool: Pool,
  options: {
    limit?: number;
    offset?: number;
  } = {},
): Promise<
  Array<{
    id: string;
    title: string;
    rule: string;
    rule_description: string;
    end: Date | null;
    next_occurrence: Date | null;
    instance_count: number;
  }>
> {
  const limit = options.limit || 50;
  const offset = options.offset || 0;

  const result = await pool.query(
    `SELECT
      t.id::text,
      t.title,
      t.recurrence_rule as rule,
      t.recurrence_end as "end",
      COUNT(i.id) as instance_count
    FROM work_item t
    LEFT JOIN work_item i ON i.recurrence_parent_id = t.id
    WHERE t.is_recurrence_template = true
    GROUP BY t.id
    ORDER BY t.created_at DESC
    LIMIT $1 OFFSET $2`,
    [limit, offset],
  );

  return result.rows.map((row) => ({
    id: row.id,
    title: row.title,
    rule: row.rule,
    rule_description: row.rule ? describeRrule(row.rule) : '',
    end: row.end,
    next_occurrence: row.rule ? getNextOccurrence(row.rule) : null,
    instance_count: parseInt(row.instance_count, 10),
  }));
}

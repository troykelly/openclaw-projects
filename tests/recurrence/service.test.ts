/**
 * Tests for recurrence service.
 * Part of Issue #217.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Pool } from 'pg';
import { createTestPool, truncateAllTables } from '../helpers/db.ts';
import {
  createRecurrenceTemplate,
  createFromNaturalLanguage,
  getRecurrenceInfo,
  updateRecurrence,
  stopRecurrence,
  createInstance,
  getInstances,
  generateUpcomingInstances,
  getTemplates,
  getNextOccurrence,
  getNextOccurrences,
  parseRRule,
} from '../../src/api/recurrence/service.ts';

describe('Recurrence Service', () => {
  let pool: Pool;

  beforeEach(async () => {
    pool = createTestPool();
    await truncateAllTables(pool);
  });

  afterEach(async () => {
    await pool.end();
  });

  describe('parseRRule', () => {
    it('parses a simple daily rule', () => {
      const rule = parseRRule('RRULE:FREQ=DAILY');
      expect(rule).toBeDefined();
      expect(rule.options.freq).toBe(3); // RRule.DAILY = 3
    });

    it('parses a weekly rule with days', () => {
      const rule = parseRRule('RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR');
      expect(rule).toBeDefined();
      expect(rule.options.freq).toBe(2); // RRule.WEEKLY = 2
    });

    it('parses without RRULE: prefix', () => {
      const rule = parseRRule('FREQ=DAILY;INTERVAL=2');
      expect(rule).toBeDefined();
      expect(rule.options.interval).toBe(2);
    });
  });

  describe('getNextOccurrence', () => {
    it('returns the next occurrence for daily rule', () => {
      const now = new Date();
      const next = getNextOccurrence('RRULE:FREQ=DAILY', now);
      expect(next).not.toBeNull();
      expect(next!.getTime()).toBeGreaterThanOrEqual(now.getTime());
    });

    it('returns the next occurrence for weekly rule', () => {
      const now = new Date();
      const next = getNextOccurrence('RRULE:FREQ=WEEKLY;BYDAY=MO', now);
      expect(next).not.toBeNull();
      // Should be on a Monday
      expect(next!.getUTCDay()).toBe(1);
    });
  });

  describe('getNextOccurrences', () => {
    it('returns multiple occurrences', () => {
      const now = new Date();
      const occurrences = getNextOccurrences('RRULE:FREQ=DAILY', 5, now);
      expect(occurrences.length).toBeLessThanOrEqual(5);
      // Each occurrence should be after the previous
      for (let i = 1; i < occurrences.length; i++) {
        expect(occurrences[i].getTime()).toBeGreaterThan(occurrences[i - 1].getTime());
      }
    });
  });

  describe('createRecurrenceTemplate', () => {
    it('creates a recurrence template', async () => {
      const result = await createRecurrenceTemplate(pool, {
        title: 'Daily Standup',
        description: 'Team standup meeting',
        recurrenceRule: 'RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=0',
      });

      expect(result.id).toBeDefined();
      expect(result.rrule).toBe('RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=0');
      expect(result.description).toContain('Every day');

      // Verify in database
      const dbResult = await pool.query(
        `SELECT is_recurrence_template, recurrence_rule
         FROM work_item WHERE id = $1`,
        [result.id],
      );
      expect(dbResult.rows[0].is_recurrence_template).toBe(true);
      expect(dbResult.rows[0].recurrence_rule).toBe('RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=0');
    });

    it('creates template with end date', async () => {
      const endDate = new Date();
      endDate.setMonth(endDate.getMonth() + 1);

      const result = await createRecurrenceTemplate(pool, {
        title: 'Limited Recurrence',
        recurrenceRule: 'RRULE:FREQ=WEEKLY',
        recurrenceEnd: endDate,
      });

      const dbResult = await pool.query(`SELECT recurrence_end FROM work_item WHERE id = $1`, [result.id]);
      expect(dbResult.rows[0].recurrence_end).toBeDefined();
    });

    it('creates template with priority and task type', async () => {
      const result = await createRecurrenceTemplate(pool, {
        title: 'Important Meeting',
        recurrenceRule: 'RRULE:FREQ=WEEKLY;BYDAY=MO',
        priority: 'P1',
        taskType: 'meeting',
      });

      const dbResult = await pool.query(`SELECT priority, task_type FROM work_item WHERE id = $1`, [result.id]);
      expect(dbResult.rows[0].priority).toBe('P1');
      expect(dbResult.rows[0].task_type).toBe('meeting');
    });
  });

  describe('createFromNaturalLanguage', () => {
    it('creates recurring task from natural language', async () => {
      const result = await createFromNaturalLanguage(pool, {
        title: 'Morning Review',
        recurrenceNatural: 'every day at 9am',
      });

      expect(result.isRecurring).toBe(true);
      expect(result.rrule).toContain('FREQ=DAILY');
      expect(result.rrule).toContain('BYHOUR=9');
    });

    it('creates non-recurring task for single occurrence', async () => {
      const result = await createFromNaturalLanguage(pool, {
        title: 'One-time Task',
        recurrenceNatural: 'tomorrow',
      });

      expect(result.isRecurring).toBe(false);
      expect(result.rrule).toBeNull();

      // Verify it's not a template
      const dbResult = await pool.query(`SELECT is_recurrence_template FROM work_item WHERE id = $1`, [result.id]);
      expect(dbResult.rows[0].is_recurrence_template).toBe(false);
    });

    it('parses weekday pattern', async () => {
      const result = await createFromNaturalLanguage(pool, {
        title: 'Weekday Task',
        recurrenceNatural: 'every weekday morning',
      });

      expect(result.isRecurring).toBe(true);
      expect(result.rrule).toContain('BYDAY=MO,TU,WE,TH,FR');
    });
  });

  describe('getRecurrenceInfo', () => {
    it('returns null for non-existent work item', async () => {
      const info = await getRecurrenceInfo(pool, '00000000-0000-0000-0000-000000000000');
      expect(info).toBeNull();
    });

    it('returns null for non-recurring work item', async () => {
      const result = await pool.query(`INSERT INTO work_item (title) VALUES ('Regular Task') RETURNING id::text`);
      const info = await getRecurrenceInfo(pool, result.rows[0].id);
      expect(info).toBeNull();
    });

    it('returns recurrence info for template', async () => {
      const template = await createRecurrenceTemplate(pool, {
        title: 'Recurring Template',
        recurrenceRule: 'RRULE:FREQ=DAILY',
      });

      const info = await getRecurrenceInfo(pool, template.id);
      expect(info).not.toBeNull();
      expect(info!.rule).toBe('RRULE:FREQ=DAILY');
      expect(info!.isTemplate).toBe(true);
      expect(info!.nextOccurrence).not.toBeNull();
    });
  });

  describe('updateRecurrence', () => {
    it('updates recurrence rule', async () => {
      const template = await createRecurrenceTemplate(pool, {
        title: 'Update Test',
        recurrenceRule: 'RRULE:FREQ=DAILY',
      });

      const updated = await updateRecurrence(pool, template.id, {
        recurrenceRule: 'RRULE:FREQ=WEEKLY',
      });

      expect(updated).toBe(true);

      const info = await getRecurrenceInfo(pool, template.id);
      expect(info!.rule).toBe('RRULE:FREQ=WEEKLY');
    });

    it('updates recurrence end date', async () => {
      const template = await createRecurrenceTemplate(pool, {
        title: 'End Date Test',
        recurrenceRule: 'RRULE:FREQ=DAILY',
      });

      const endDate = new Date();
      endDate.setMonth(endDate.getMonth() + 1);

      const updated = await updateRecurrence(pool, template.id, {
        recurrenceEnd: endDate,
      });

      expect(updated).toBe(true);

      const info = await getRecurrenceInfo(pool, template.id);
      expect(info!.end).not.toBeNull();
    });

    it('returns false for empty update', async () => {
      const template = await createRecurrenceTemplate(pool, {
        title: 'No Update Test',
        recurrenceRule: 'RRULE:FREQ=DAILY',
      });

      const updated = await updateRecurrence(pool, template.id, {});
      expect(updated).toBe(false);
    });
  });

  describe('stopRecurrence', () => {
    it('removes recurrence from work item', async () => {
      const template = await createRecurrenceTemplate(pool, {
        title: 'Stop Test',
        recurrenceRule: 'RRULE:FREQ=DAILY',
      });

      const stopped = await stopRecurrence(pool, template.id);
      expect(stopped).toBe(true);

      const dbResult = await pool.query(
        `SELECT is_recurrence_template, recurrence_rule
         FROM work_item WHERE id = $1`,
        [template.id],
      );
      expect(dbResult.rows[0].is_recurrence_template).toBe(false);
      expect(dbResult.rows[0].recurrence_rule).toBeNull();
    });
  });

  describe('createInstance', () => {
    it('creates an instance from template', async () => {
      const template = await createRecurrenceTemplate(pool, {
        title: 'Instance Test',
        description: 'Test description',
        recurrenceRule: 'RRULE:FREQ=DAILY',
        priority: 'P1',
      });

      const scheduledDate = new Date();
      scheduledDate.setDate(scheduledDate.getDate() + 1);

      const instanceId = await createInstance(pool, template.id, scheduledDate);
      expect(instanceId).not.toBeNull();

      // Verify instance properties
      const dbResult = await pool.query(
        `SELECT title, description, priority, recurrence_parent_id::text, not_before
         FROM work_item WHERE id = $1`,
        [instanceId],
      );
      expect(dbResult.rows[0].title).toBe('Instance Test');
      expect(dbResult.rows[0].description).toBe('Test description');
      expect(dbResult.rows[0].priority).toBe('P1');
      expect(dbResult.rows[0].recurrence_parent_id).toBe(template.id);
      expect(dbResult.rows[0].not_before).toBeDefined();
    });

    it('returns null for non-template', async () => {
      const result = await pool.query(`INSERT INTO work_item (title) VALUES ('Not a template') RETURNING id::text`);

      const instanceId = await createInstance(pool, result.rows[0].id, new Date());
      expect(instanceId).toBeNull();
    });
  });

  describe('getInstances', () => {
    it('returns instances of a template', async () => {
      const template = await createRecurrenceTemplate(pool, {
        title: 'Instances Test',
        recurrenceRule: 'RRULE:FREQ=DAILY',
      });

      // Create some instances
      const date1 = new Date();
      const date2 = new Date();
      date2.setDate(date2.getDate() + 1);

      await createInstance(pool, template.id, date1);
      await createInstance(pool, template.id, date2);

      const instances = await getInstances(pool, template.id);
      expect(instances.length).toBe(2);
      expect(instances[0].title).toBe('Instances Test');
    });

    it('filters completed instances when requested', async () => {
      const template = await createRecurrenceTemplate(pool, {
        title: 'Filter Test',
        recurrenceRule: 'RRULE:FREQ=DAILY',
      });

      const instanceId = await createInstance(pool, template.id, new Date());

      // Complete the instance
      await pool.query(`UPDATE work_item SET status = 'closed' WHERE id = $1`, [instanceId]);

      const allInstances = await getInstances(pool, template.id, {
        includeCompleted: true,
      });
      expect(allInstances.length).toBe(1);

      const openInstances = await getInstances(pool, template.id, {
        includeCompleted: false,
      });
      expect(openInstances.length).toBe(0);
    });
  });

  describe('generateUpcomingInstances', () => {
    it('generates instances for active templates', async () => {
      await createRecurrenceTemplate(pool, {
        title: 'Generate Test',
        recurrenceRule: 'RRULE:FREQ=DAILY',
      });

      const result = await generateUpcomingInstances(pool, 7);
      expect(result.generated).toBeGreaterThan(0);
      expect(result.errors.length).toBe(0);
    });

    it('skips templates with past end date', async () => {
      const pastEnd = new Date();
      pastEnd.setDate(pastEnd.getDate() - 1);

      await createRecurrenceTemplate(pool, {
        title: 'Expired Template',
        recurrenceRule: 'RRULE:FREQ=DAILY',
        recurrenceEnd: pastEnd,
      });

      const result = await generateUpcomingInstances(pool, 7);
      expect(result.generated).toBe(0);
    });

    it('does not create duplicate instances', async () => {
      const template = await createRecurrenceTemplate(pool, {
        title: 'No Duplicates',
        recurrenceRule: 'RRULE:FREQ=DAILY',
      });

      // Generate twice
      await generateUpcomingInstances(pool, 7);
      const firstCount = (await getInstances(pool, template.id)).length;

      await generateUpcomingInstances(pool, 7);
      const secondCount = (await getInstances(pool, template.id)).length;

      expect(secondCount).toBe(firstCount);
    });
  });

  describe('getTemplates', () => {
    it('returns all templates', async () => {
      await createRecurrenceTemplate(pool, {
        title: 'Template 1',
        recurrenceRule: 'RRULE:FREQ=DAILY',
      });

      await createRecurrenceTemplate(pool, {
        title: 'Template 2',
        recurrenceRule: 'RRULE:FREQ=WEEKLY',
      });

      const templates = await getTemplates(pool);
      expect(templates.length).toBe(2);
    });

    it('includes instance counts', async () => {
      const template = await createRecurrenceTemplate(pool, {
        title: 'Count Test',
        recurrenceRule: 'RRULE:FREQ=DAILY',
      });

      await createInstance(pool, template.id, new Date());
      await createInstance(pool, template.id, new Date());

      const templates = await getTemplates(pool);
      const found = templates.find((t) => t.id === template.id);
      expect(found?.instanceCount).toBe(2);
    });

    it('supports pagination', async () => {
      for (let i = 0; i < 5; i++) {
        await createRecurrenceTemplate(pool, {
          title: `Template ${i}`,
          recurrenceRule: 'RRULE:FREQ=DAILY',
        });
      }

      const page1 = await getTemplates(pool, { limit: 2, offset: 0 });
      expect(page1.length).toBe(2);

      const page2 = await getTemplates(pool, { limit: 2, offset: 2 });
      expect(page2.length).toBe(2);

      // Different templates
      expect(page1[0].id).not.toBe(page2[0].id);
    });
  });
});

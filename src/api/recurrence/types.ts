/**
 * Types for recurring work items.
 * All property names use snake_case to match the project-wide convention (Issue #1412).
 * Part of Issue #217.
 */

export interface RecurrenceRule {
  rule: string; // RRULE format string
  end?: Date; // Optional end date
}

export interface RecurrenceInfo {
  rule: string;
  end: Date | null;
  parent_id: string | null;
  is_template: boolean;
  next_occurrence: Date | null;
}

export interface RecurrenceInstanceCreate {
  template_id: string;
  scheduled_date: Date;
}

export interface RecurrenceInstance {
  id: string;
  title: string;
  status: string;
  scheduled_date: Date | null;
  created_at: Date;
  completed_at: Date | null;
}

export interface NaturalLanguageParseResult {
  rrule: string | null;
  single_date: Date | null;
  is_recurring: boolean;
  description: string;
}

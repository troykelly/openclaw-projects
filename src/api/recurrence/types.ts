/**
 * Types for recurring work items.
 * Part of Issue #217.
 */

export interface RecurrenceRule {
  rule: string; // RRULE format string
  end?: Date; // Optional end date
}

export interface RecurrenceInfo {
  rule: string;
  end: Date | null;
  parentId: string | null;
  isTemplate: boolean;
  nextOccurrence: Date | null;
}

export interface RecurrenceInstanceCreate {
  templateId: string;
  scheduledDate: Date;
}

export interface RecurrenceInstance {
  id: string;
  title: string;
  status: string;
  scheduledDate: Date | null;
  createdAt: Date;
  completedAt: Date | null;
}

export interface NaturalLanguageParseResult {
  rrule: string | null;
  singleDate: Date | null;
  isRecurring: boolean;
  description: string;
}

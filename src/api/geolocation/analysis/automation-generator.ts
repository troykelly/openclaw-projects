// NOTE: Intentionally unwired — pending #1603 (HA Connector Container)

/**
 * Automation suggestion generator for Home Assistant routines.
 *
 * Converts confirmed routines with sufficient confidence into Home Assistant
 * automation YAML suggestions. Produces trigger + condition + action blocks
 * derived from the routine's entity sequence, time window, and day-of-week pattern.
 *
 * Issue #1464, Epic #1440.
 */

// ---------- types ----------

/** A routine row from ha_routines (subset of fields needed for generation). */
export interface HaRoutine {
  id: string;
  key: string;
  title: string;
  description: string | null;
  confidence: number;
  status: string;
  time_window: {
    start_hour: number;
    end_hour: number;
    avg_duration_minutes: number;
  };
  days: string[];
  sequence: Array<{
    entity_id: string;
    domain: string;
    to_state: string;
    offset_minutes: number;
  }>;
}

/** A generated automation suggestion with YAML and metadata. */
export interface HaAutomationSuggestion {
  /** Valid Home Assistant automation YAML. */
  yaml: string;
  /** Human-readable description of the automation. */
  description: string;
  /** Entity that triggers the automation. */
  trigger_entity: string;
  /** Entities controlled by the automation actions. */
  action_entities: string[];
  /** Note about the confidence level and generation rationale. */
  confidence_note: string;
}

// ---------- constants ----------

/** Minimum confidence to generate automation from a routine. */
const MIN_CONFIDENCE = 0.7;

/** Maximum action entities before flagging for manual review. */
const MAX_ACTION_ENTITIES = 5;

/** Days of week in HA-compatible format (lowercase abbreviations). */
const DAY_ABBREV: Record<string, string> = {
  monday: 'mon',
  tuesday: 'tue',
  wednesday: 'wed',
  thursday: 'thu',
  friday: 'fri',
  saturday: 'sat',
  sunday: 'sun',
};

// ---------- AutomationGenerator ----------

export class AutomationGenerator {
  /**
   * Generate a Home Assistant automation suggestion from a confirmed routine.
   *
   * Returns null if:
   * - Routine status is not 'confirmed'
   * - Confidence is below 0.7
   * - Sequence has fewer than 2 entities (need trigger + at least 1 action)
   * - Sequence has >5 action entities (flagged for manual review via confidence_note)
   *
   * @param routine - The routine to generate an automation for
   * @returns Automation suggestion or null if not eligible
   */
  generate(routine: HaRoutine): HaAutomationSuggestion | null {
    // Gate: only confirmed routines with sufficient confidence
    if (routine.status !== 'confirmed') {
      return null;
    }

    if (routine.confidence < MIN_CONFIDENCE) {
      return null;
    }

    // Need at least 2 steps: 1 trigger + 1 action
    if (routine.sequence.length < 2) {
      return null;
    }

    const triggerStep = routine.sequence[0];
    const actionSteps = routine.sequence.slice(1);

    // Skip generation for routines with too many action entities — flag for manual review
    if (actionSteps.length > MAX_ACTION_ENTITIES) {
      return null;
    }

    const triggerEntity = triggerStep.entity_id;
    const actionEntities = actionSteps.map((s) => s.entity_id);

    const yaml = this.buildYaml(routine, triggerStep, actionSteps);
    const description = this.buildDescription(routine, triggerEntity, actionEntities);
    const confidenceNote = this.buildConfidenceNote(routine);

    return {
      yaml,
      description,
      trigger_entity: triggerEntity,
      action_entities: actionEntities,
      confidence_note: confidenceNote,
    };
  }

  // ---------- private: YAML generation ----------

  private buildYaml(
    routine: HaRoutine,
    triggerStep: HaRoutine['sequence'][0],
    actionSteps: HaRoutine['sequence'],
  ): string {
    const aliasSlug = routine.key
      .replace(/[^a-z0-9]+/gi, '_')
      .replace(/^_|_$/g, '')
      .toLowerCase();

    const lines: string[] = [];

    // Header
    lines.push(`alias: "${this.escapeYaml(routine.title)}"`);
    if (routine.description) {
      lines.push(`description: "${this.escapeYaml(routine.description)}"`);
    }
    lines.push(`id: "auto_${aliasSlug}"`);
    lines.push('mode: single');
    lines.push('');

    // Trigger
    lines.push('trigger:');
    lines.push(`  - platform: state`);
    lines.push(`    entity_id: "${this.escapeYaml(triggerStep.entity_id)}"`);
    lines.push(`    to: "${this.escapeYaml(triggerStep.to_state)}"`);
    lines.push('');

    // Condition: time window + days
    lines.push('condition:');
    lines.push('  - condition: time');
    lines.push(`    after: "${this.formatHour(routine.time_window.start_hour)}"`);
    lines.push(`    before: "${this.formatHour(routine.time_window.end_hour)}"`);

    if (routine.days.length > 0 && routine.days.length < 7) {
      const haWeekday = routine.days
        .map((d) => DAY_ABBREV[d])
        .filter(Boolean);

      if (haWeekday.length > 0) {
        lines.push(`    weekday:`);
        for (const day of haWeekday) {
          lines.push(`      - ${day}`);
        }
      }
    }
    lines.push('');

    // Actions
    lines.push('action:');
    for (const step of actionSteps) {
      const service = this.domainToService(step.domain, step.to_state);
      lines.push(`  - service: "${this.escapeYaml(service)}"`);
      lines.push(`    target:`);
      lines.push(`      entity_id: "${this.escapeYaml(step.entity_id)}"`);

      if (step.offset_minutes > 0) {
        const safeMinutes = Math.round(Number(step.offset_minutes));
        lines.push(`    # Offset: ~${String(safeMinutes)} minute(s) after trigger`);
      }
    }

    return lines.join('\n');
  }

  // ---------- private: helpers ----------

  private buildDescription(
    routine: HaRoutine,
    triggerEntity: string,
    actionEntities: string[],
  ): string {
    const timeStr = `${this.formatHour(routine.time_window.start_hour)}-${this.formatHour(routine.time_window.end_hour)}`;
    const daysStr =
      routine.days.length === 7
        ? 'every day'
        : routine.days.join(', ');

    return (
      `Automation for "${routine.title}": when ${triggerEntity} changes state ` +
      `during ${timeStr} on ${daysStr}, control ${actionEntities.join(', ')}.`
    );
  }

  private buildConfidenceNote(routine: HaRoutine): string {
    const pct = Math.round(routine.confidence * 100);
    return (
      `Generated from routine "${routine.key}" with ${pct}% confidence ` +
      `(observed ${routine.sequence.length} entity steps). ` +
      `Review before enabling.`
    );
  }

  /**
   * Map a domain + state to a Home Assistant service call.
   */
  private domainToService(domain: string, toState: string): string {
    // Common domain → service mappings
    switch (domain) {
      case 'light':
        return toState === 'off' ? 'light.turn_off' : 'light.turn_on';
      case 'switch':
        return toState === 'off' ? 'switch.turn_off' : 'switch.turn_on';
      case 'lock':
        return toState === 'locked' ? 'lock.lock' : 'lock.unlock';
      case 'cover':
        return toState === 'closed' ? 'cover.close_cover' : 'cover.open_cover';
      case 'climate':
        return `climate.set_hvac_mode`;
      case 'fan':
        return toState === 'off' ? 'fan.turn_off' : 'fan.turn_on';
      case 'media_player':
        return toState === 'off' ? 'media_player.turn_off' : 'media_player.turn_on';
      case 'alarm_control_panel':
        if (toState === 'armed_away') return 'alarm_control_panel.alarm_arm_away';
        if (toState === 'armed_home') return 'alarm_control_panel.alarm_arm_home';
        if (toState === 'armed_night') return 'alarm_control_panel.alarm_arm_night';
        return 'alarm_control_panel.alarm_disarm';
      default:
        // Generic homeassistant service for unknown domains
        return toState === 'off' ? 'homeassistant.turn_off' : 'homeassistant.turn_on';
    }
  }

  /**
   * Format an hour (0-23) as HH:MM:SS for HA YAML.
   */
  private formatHour(hour: number): string {
    return `${hour.toString().padStart(2, '0')}:00:00`;
  }

  /**
   * Escape a string for use in YAML double-quoted strings.
   * Handles backslashes, quotes, newlines, carriage returns, and tabs.
   */
  private escapeYaml(str: string): string {
    return str
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t');
  }
}

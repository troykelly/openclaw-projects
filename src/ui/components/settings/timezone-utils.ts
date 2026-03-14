/**
 * Timezone list generation and formatting utilities.
 *
 * Uses Intl APIs only — no third-party timezone libraries.
 *
 * @see Issue #2513 — Epic #2509
 */

/** Region prefixes for grouping IANA timezones. */
const REGION_PREFIXES = [
  'Africa',
  'America',
  'Antarctica',
  'Asia',
  'Atlantic',
  'Australia',
  'Europe',
  'Indian',
  'Pacific',
] as const;

/**
 * Get all IANA timezones from the runtime, ensuring UTC is always present.
 */
export function getAllTimezones(): string[] {
  const fromIntl = Intl.supportedValuesOf('timeZone');
  if (!fromIntl.includes('UTC')) {
    return ['UTC', ...fromIntl].sort();
  }
  return [...fromIntl].sort();
}

/**
 * Group timezones by their region prefix.
 * Ungrouped entries (UTC, Etc/*) go into an "Other" group.
 */
export function groupTimezones(
  timezones: string[],
): [region: string, zones: string[]][] {
  const groups = new Map<string, string[]>();

  for (const tz of timezones) {
    const slashIdx = tz.indexOf('/');
    const prefix = slashIdx > 0 ? tz.substring(0, slashIdx) : null;

    if (prefix && (REGION_PREFIXES as readonly string[]).includes(prefix)) {
      const existing = groups.get(prefix);
      if (existing) {
        existing.push(tz);
      } else {
        groups.set(prefix, [tz]);
      }
    } else {
      const existing = groups.get('Other');
      if (existing) {
        existing.push(tz);
      } else {
        groups.set('Other', [tz]);
      }
    }
  }

  // Sort zones within each group
  for (const [, zones] of groups) {
    zones.sort((a, b) => a.localeCompare(b));
  }

  // Return in region order, with Other at the end
  const result: [string, string[]][] = [];
  for (const region of REGION_PREFIXES) {
    const zones = groups.get(region);
    if (zones?.length) {
      result.push([region, zones]);
    }
  }
  const other = groups.get('Other');
  if (other?.length) {
    result.push(['Other', other]);
  }

  return result;
}

/**
 * Format an IANA timezone for display.
 * Replaces underscores with spaces and slashes with spaced slashes.
 */
export function formatTimezoneDisplay(tz: string): string {
  return tz.replace(/_/g, ' ').replace(/\//g, ' / ');
}

/**
 * Canonicalize a timezone string via Intl round-trip.
 * Handles aliases like US/Pacific → America/Los_Angeles.
 */
export function canonicalizeTimezone(tz: string): string {
  try {
    return Intl.DateTimeFormat(undefined, { timeZone: tz }).resolvedOptions().timeZone;
  } catch {
    return tz;
  }
}

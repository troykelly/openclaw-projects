/**
 * IANA timezone validation and canonicalization.
 * @module src/api/timezone
 */

/**
 * Validate and canonicalize an IANA timezone string.
 *
 * Uses `Intl.DateTimeFormat` to test whether the runtime recognizes the
 * timezone and to resolve aliases to their canonical form (e.g.
 * `US/Pacific` → `America/Los_Angeles`, `Etc/UTC` → `UTC`).
 *
 * @param tz - The timezone string to validate.
 * @returns The canonical IANA timezone string, or `null` if invalid.
 */
export function canonicalizeTimezone(tz: string): string | null {
  if (!tz || typeof tz !== 'string' || tz.trim() === '') return null;
  try {
    const canonical = Intl.DateTimeFormat(undefined, { timeZone: tz })
      .resolvedOptions()
      .timeZone;
    return canonical;
  } catch {
    return null;
  }
}

/**
 * Locale-aware contact name formatting (#1592).
 *
 * Renders contact names in culturally correct order:
 * - CJK (ja, zh, ko): {family_name}{given_name} (no space)
 * - Hungarian (hu): {family_name} {given_name}
 * - Default: {given_name} {family_name}
 *
 * Falls back to display_name when structured name fields are absent.
 */

/** Minimal contact shape needed for name formatting. */
export interface NameableContact {
  display_name?: string | null;
  given_name?: string | null;
  family_name?: string | null;
  middle_name?: string | null;
  name_prefix?: string | null;
  name_suffix?: string | null;
  nickname?: string | null;
  phonetic_given_name?: string | null;
  phonetic_family_name?: string | null;
  file_as?: string | null;
  contact_kind?: string | null;
}

export type NameStyle = 'full' | 'short' | 'formal';

export interface FormatNameOptions {
  /** Locale string (e.g. 'en-US', 'ja-JP'). Defaults to navigator.language. */
  locale?: string;
  /** Rendering style. Defaults to 'full'. */
  style?: NameStyle;
}

/** Locales where family name comes first. */
const FAMILY_FIRST_LOCALES = new Set(['ja', 'zh', 'ko', 'hu', 'vi']);
/** CJK locales: no space between family and given name. */
const CJK_LOCALES = new Set(['ja', 'zh', 'ko']);

function getLanguageCode(locale: string): string {
  return locale.split('-')[0].toLowerCase();
}

/**
 * Format a contact's name according to locale conventions.
 *
 * For non-person contacts (organisation, group, agent), always uses display_name.
 * For person contacts, computes from structured name fields.
 */
export function formatContactName(
  contact: NameableContact | null | undefined,
  options?: FormatNameOptions,
): string {
  if (!contact) return '';

  // Non-person contacts always use display_name
  if (contact.contact_kind && contact.contact_kind !== 'person') {
    return contact.display_name ?? '';
  }

  const locale = options?.locale ?? (typeof navigator !== 'undefined' ? navigator.language : 'en');
  const style = options?.style ?? 'full';
  const lang = getLanguageCode(locale);

  const given = contact.given_name?.trim() || '';
  const family = contact.family_name?.trim() || '';
  const middle = contact.middle_name?.trim() || '';
  const prefix = contact.name_prefix?.trim() || '';
  const suffix = contact.name_suffix?.trim() || '';

  // No structured name fields? Fall back to display_name
  if (!given && !family) {
    return contact.display_name ?? contact.nickname ?? '';
  }

  const isFamilyFirst = FAMILY_FIRST_LOCALES.has(lang);
  const isCJK = CJK_LOCALES.has(lang);
  const separator = isCJK ? '' : ' ';

  let name: string;

  switch (style) {
    case 'short':
      // Short: just given name (or family name for family-first locales)
      name = isFamilyFirst ? (family || given) : (given || family);
      break;

    case 'formal':
      // Formal: include prefix and suffix
      if (isFamilyFirst) {
        name = [family, given].filter(Boolean).join(separator);
      } else {
        name = [given, middle, family].filter(Boolean).join(' ');
      }
      if (prefix) name = `${prefix} ${name}`;
      if (suffix) name = `${name}, ${suffix}`;
      break;

    default: // 'full'
      if (isFamilyFirst) {
        name = [family, given].filter(Boolean).join(separator);
      } else {
        name = [given, middle, family].filter(Boolean).join(' ');
      }
      break;
  }

  return name || contact.display_name || '';
}

/**
 * Get a sortable key for a contact.
 * Uses file_as if set, otherwise computes "family_name, given_name".
 */
export function getContactSortKey(contact: NameableContact): string {
  if (contact.file_as) return contact.file_as;
  const family = contact.family_name?.trim() || '';
  const given = contact.given_name?.trim() || '';
  if (family && given) return `${family}, ${given}`;
  return family || given || contact.display_name || '';
}

/**
 * Get initials for avatar display.
 * Prefers given_name + family_name initials, falls back to display_name.
 */
export function getContactInitials(contact: NameableContact | null | undefined): string {
  if (!contact) return '';

  const given = contact.given_name?.trim() || '';
  const family = contact.family_name?.trim() || '';

  if (given && family) {
    return `${given[0]}${family[0]}`.toUpperCase();
  }

  if (given || family) {
    const name = given || family;
    return name[0].toUpperCase();
  }

  // Fall back to display_name
  const display = contact.display_name?.trim() || '';
  if (!display) return '';

  const parts = display.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  }
  return parts[0]?.[0]?.toUpperCase() || '';
}

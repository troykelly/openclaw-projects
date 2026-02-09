import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * UUID v4 validation regex pattern.
 * Matches standard UUID format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
 * where y is 8, 9, a, or b.
 */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Validates whether a string is a valid UUID v4.
 * Used for URL parameter validation to prevent injection attacks
 * and ensure API compatibility.
 *
 * @param value - The string to validate
 * @returns true if the string is a valid UUID v4, false otherwise
 */
export function isValidUUID(value: string): boolean {
  return UUID_REGEX.test(value);
}

/**
 * Validates a URL parameter and returns it if valid, undefined otherwise.
 * Provides defense-in-depth against malformed URL parameters.
 *
 * @param value - The URL parameter value (may be undefined)
 * @returns The validated value if it's a valid UUID, undefined otherwise
 */
export function validateUrlParam(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return isValidUUID(value) ? value : undefined;
}

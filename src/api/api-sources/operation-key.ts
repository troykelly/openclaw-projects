/**
 * Operation key resolver for OpenAPI operations.
 * Generates unique, stable keys for each operation in a parsed spec.
 * Part of API Onboarding feature (#1778).
 */

/** Path parameter pattern: {param_name} */
const PATH_PARAM_RE = /\{[^}]+\}/g;

/**
 * Generate a key for an OpenAPI operation.
 *
 * Uses `operationId` when available (preferred, already unique per spec).
 * Falls back to `METHOD:path` with path parameters replaced by `{}`.
 */
export function resolveOperationKey(
  method: string,
  path: string,
  operationId?: string,
): string {
  if (operationId) {
    return operationId;
  }

  const normalizedMethod = method.toUpperCase();
  const normalizedPath = path.replace(PATH_PARAM_RE, '{}');
  return `${normalizedMethod}:${normalizedPath}`;
}

/**
 * Generate a key for a tag group.
 * Returns `tag:<tagName>`.
 */
export function resolveTagGroupKey(tagName: string): string {
  return `tag:${tagName}`;
}

/**
 * Deduplicate an array of keys by appending `_2`, `_3`, etc. on collision.
 * Preserves the first occurrence of each key, only modifies subsequent duplicates.
 */
export function deduplicateKeys(keys: string[]): string[] {
  const seen = new Map<string, number>();
  const result: string[] = [];

  for (const key of keys) {
    const count = seen.get(key) ?? 0;
    if (count === 0) {
      result.push(key);
    } else {
      result.push(`${key}_${count + 1}`);
    }
    seen.set(key, count + 1);
  }

  return result;
}

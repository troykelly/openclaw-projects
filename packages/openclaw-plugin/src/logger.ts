/**
 * Logger adapter for OpenClaw plugin integration.
 *
 * Wraps the host's PluginLogger (string-only methods) with a richer Logger
 * interface that accepts structured data, handles redaction, and supports
 * component-scoped child loggers.
 *
 * The host handles timestamps, levels, and `[plugins]` prefixes.
 * This adapter adds `[openclaw-projects]` or `[openclaw-projects:component]`.
 */

// ── Sensitive field names (case-insensitive match) ──────────────────────────

const SENSITIVE_FIELDS = new Set([
  'apikey',
  'api_key',
  'token',
  'password',
  'secret',
  'authorization',
  'auth',
  'bearer',
  'credential',
  'credentials',
  'private_key',
  'privatekey',
  'access_token',
  'refresh_token',
  'share_token',
  'session_token',
  'id_token',
  'webhook_token',
  'connection_token',
  'otp',
]);

/** Patterns in string values that indicate a secret (regardless of field name). */
const SENSITIVE_VALUE_PATTERNS = [
  /^Bearer\s+/i,
  /^sk_live_/,
  /^sk_test_/,
];

/** Maximum component nesting depth for child loggers. */
const MAX_CHILD_DEPTH = 3;

// ── Public types ────────────────────────────────────────────────────────────

/**
 * PluginLogger — matches the OpenClaw SDK spec.
 * This is what the host provides via `api.logger`.
 */
export type PluginLogger = {
  debug?: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

/**
 * Logger — the richer interface used internally by the plugin.
 * Accepts optional structured data and supports child scoping.
 */
export interface Logger {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
  debug(message: string, data?: Record<string, unknown>): void;
  child(component: string): Logger;
}

// ── redactSensitive ─────────────────────────────────────────────────────────

/**
 * Recursively redacts sensitive fields from an object.
 * Creates a deep copy to avoid modifying the original.
 *
 * Redacts by:
 * 1. Field name matching (case-insensitive) against SENSITIVE_FIELDS
 * 2. Value pattern matching against SENSITIVE_VALUE_PATTERNS
 */
export function redactSensitive<T>(value: T, seen?: WeakSet<object>): T {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value !== 'object') {
    return value;
  }

  // Circular reference protection
  const visited = seen ?? new WeakSet<object>();
  if (visited.has(value as object)) {
    return '[Circular]' as T;
  }
  visited.add(value as object);

  if (Array.isArray(value)) {
    return value.map((item) => redactSensitive(item, visited)) as T;
  }

  // Error objects: extract message/stack/code before processing
  if (value instanceof Error) {
    const errorObj: Record<string, unknown> = { message: value.message };
    if (value.stack) {
      errorObj.stack = value.stack;
    }
    if ('code' in value && (value as Record<string, unknown>).code !== undefined) {
      errorObj.code = (value as Record<string, unknown>).code;
    }
    return errorObj as T;
  }

  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_FIELDS.has(key.toLowerCase())) {
      result[key] = '[REDACTED]';
    } else if (typeof val === 'string' && SENSITIVE_VALUE_PATTERNS.some((p) => p.test(val))) {
      result[key] = '[REDACTED]';
    } else if (typeof val === 'object' && val !== null) {
      result[key] = redactSensitive(val, visited);
    } else {
      result[key] = val;
    }
  }

  return result as T;
}

// ── Safe serialization ──────────────────────────────────────────────────────

/**
 * Safely serializes a value to JSON, handling:
 * - Circular references → `"[Circular]"`
 * - BigInt → string representation
 * - Error objects → `{ message, stack?, code? }`
 */
function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>();

  return JSON.stringify(value, (_key: string, val: unknown): unknown => {
    if (typeof val === 'bigint') {
      return val.toString();
    }

    if (val instanceof Error) {
      const errorObj: Record<string, unknown> = { message: val.message };
      if (val.stack) {
        errorObj.stack = val.stack;
      }
      if ('code' in val && val.code !== undefined) {
        errorObj.code = val.code;
      }
      return errorObj;
    }

    if (typeof val === 'object' && val !== null) {
      if (seen.has(val)) {
        return '[Circular]';
      }
      seen.add(val);
    }

    return val;
  });
}

// ── createPluginLogger ──────────────────────────────────────────────────────

/**
 * Creates a Logger that wraps a host PluginLogger.
 *
 * @param hostLogger - The host-provided PluginLogger (string-only methods)
 * @param component  - Optional component name for scoped prefixes
 */
export function createPluginLogger(hostLogger: PluginLogger, component?: string): Logger {
  const prefix = component
    ? `[openclaw-projects:${component}]`
    : '[openclaw-projects]';

  // Count current nesting depth (number of colons in component path)
  const depth = component ? component.split(':').length : 0;

  function format(message: string, data?: Record<string, unknown>): string {
    if (data && Object.keys(data).length > 0) {
      return `${prefix} ${message} ${safeStringify(redactSensitive(data))}`;
    }
    return `${prefix} ${message}`;
  }

  return {
    info: (msg, data?) => hostLogger.info(format(msg, data)),
    warn: (msg, data?) => hostLogger.warn(format(msg, data)),
    error: (msg, data?) => hostLogger.error(format(msg, data)),
    debug: (msg, data?) => hostLogger.debug?.(format(msg, data)),
    child: (comp) => {
      if (depth >= MAX_CHILD_DEPTH) {
        // Return a logger at the current depth — do not nest further
        return createPluginLogger(hostLogger, component);
      }
      const nested = component ? `${component}:${comp}` : comp;
      return createPluginLogger(hostLogger, nested);
    },
  };
}

// ── createFallbackLogger ────────────────────────────────────────────────────

/**
 * Creates a console-based fallback PluginLogger for tests or standalone use.
 * Does NOT add timestamps or level prefixes — mirrors the host's behavior.
 */
export function createFallbackLogger(): PluginLogger {
  return {
    info: (msg) => console.info(msg),
    warn: (msg) => console.warn(msg),
    error: (msg) => console.error(msg),
    debug: (msg) => console.debug(msg),
  };
}

// ── Deprecated: createLogger (backward compatibility) ───────────────────────

/**
 * @deprecated Use `createPluginLogger()` instead. This is retained for
 * backward compatibility during migration. Will be removed in a future version.
 */
export function createLogger(namespace: string): Logger {
  const fallback = createFallbackLogger();
  return createPluginLogger(fallback, namespace);
}

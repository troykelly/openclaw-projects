/**
 * Logger utility with automatic sensitive data redaction.
 * Ensures API keys, tokens, and other secrets are never logged.
 */

/** Fields that should be redacted from logs */
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
]);

/**
 * Recursively redacts sensitive fields from an object.
 * Creates a deep copy to avoid modifying the original.
 */
export function redactSensitive<T>(value: T): T {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactSensitive(item)) as T;
  }

  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    if (SENSITIVE_FIELDS.has(key.toLowerCase())) {
      result[key] = '[REDACTED]';
    } else if (typeof val === 'object' && val !== null) {
      result[key] = redactSensitive(val);
    } else {
      result[key] = val;
    }
  }

  return result as T;
}

/** Logger interface */
export interface Logger {
  namespace: string;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
  debug(message: string, data?: Record<string, unknown>): void;
}

/**
 * Creates a namespaced logger that automatically redacts sensitive data.
 */
export function createLogger(namespace: string): Logger {
  const formatMessage = (level: string, message: string, data?: Record<string, unknown>): string => {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level}] [${namespace}]`;
    if (data) {
      return `${prefix} ${message} ${JSON.stringify(redactSensitive(data))}`;
    }
    return `${prefix} ${message}`;
  };

  return {
    namespace,
    info(message: string, data?: Record<string, unknown>): void {
      console.info(formatMessage('INFO', message, data));
    },
    warn(message: string, data?: Record<string, unknown>): void {
      console.warn(formatMessage('WARN', message, data));
    },
    error(message: string, data?: Record<string, unknown>): void {
      console.error(formatMessage('ERROR', message, data));
    },
    debug(message: string, data?: Record<string, unknown>): void {
      console.debug(formatMessage('DEBUG', message, data));
    },
  };
}

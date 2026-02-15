/**
 * Client for the PromptGuard-2 classifier service.
 *
 * Provides async HTTP-based classification of text for prompt injection
 * and jailbreak detection using Meta's PromptGuard-2 model.
 *
 * Falls back gracefully when the service is unavailable.
 *
 * Issue #1256
 */

/** Classification result from the PromptGuard service */
export interface PromptGuardResult {
  /** Whether injection was detected */
  injection: boolean;
  /** Whether jailbreak was detected */
  jailbreak: boolean;
  /** Top label: BENIGN, INJECTION, or JAILBREAK */
  label: string;
  /** Confidence scores per class */
  scores: {
    benign: number;
    injection: number;
    jailbreak: number;
  };
}

/** Health check response from the PromptGuard service */
export interface PromptGuardHealth {
  ok: boolean;
  model: string;
  ready: boolean;
}

/** Default timeout for classifier requests (500ms) */
const DEFAULT_TIMEOUT_MS = 500;

/**
 * Classify a single text for prompt injection / jailbreak.
 *
 * Returns `null` if the service is unavailable, not ready, or times out.
 * Callers should fall back to regex detection when this returns null.
 *
 * @param baseUrl - The PromptGuard service base URL (e.g. http://localhost:8190)
 * @param text - The text to classify
 * @param timeoutMs - Request timeout in milliseconds (default 500ms)
 */
export async function classifyText(baseUrl: string, text: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<PromptGuardResult | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(`${baseUrl}/classify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as PromptGuardResult;
  } catch {
    // Network error, timeout, or abort — graceful degradation
    return null;
  }
}

/**
 * Classify multiple texts in a single batch request.
 *
 * Returns `null` if the service is unavailable, not ready, or times out.
 *
 * @param baseUrl - The PromptGuard service base URL
 * @param texts - Array of texts to classify
 * @param timeoutMs - Request timeout in milliseconds (default 500ms)
 */
export async function classifyBatch(baseUrl: string, texts: string[], timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<PromptGuardResult[] | null> {
  if (texts.length === 0) return [];

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(`${baseUrl}/classify/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texts }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as PromptGuardResult[];
  } catch {
    // Network error, timeout, or abort — graceful degradation
    return null;
  }
}

/**
 * Check the health of the PromptGuard service.
 *
 * Returns `null` if the service is unreachable.
 */
export async function checkHealth(baseUrl: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<PromptGuardHealth | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(`${baseUrl}/health`, {
      method: 'GET',
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as PromptGuardHealth;
  } catch {
    return null;
  }
}

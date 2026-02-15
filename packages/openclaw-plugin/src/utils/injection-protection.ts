/**
 * Prompt injection protection utilities for inbound message processing.
 *
 * Provides layered defence for external message content before LLM exposure:
 * 1. Unicode/control character sanitisation
 * 2. Data boundary marking (spotlighting) with per-session nonce
 * 3. Suspicious pattern detection and logging
 * 4. PromptGuard-2 classifier integration (optional, async)
 *
 * Issue #1224, #1255, #1256
 */

import { randomBytes } from 'node:crypto';
import { classifyText, type PromptGuardResult } from './prompt-guard-client.js';

/** Boundary markers for external message content, keyed by per-session nonce */
export interface BoundaryMarkers {
  /** Opening marker, e.g. `[EXTERNAL_MSG_a1b2c3d4_START]` */
  start: string;
  /** Closing marker, e.g. `[EXTERNAL_MSG_a1b2c3d4_END]` */
  end: string;
  /** The nonce embedded in the markers */
  nonce: string;
}

/** Regex to validate nonce format: 1-32 lowercase hex characters */
const VALID_NONCE_RE = /^[0-9a-f]{1,32}$/;

/**
 * Create boundary markers with a per-session cryptographic nonce.
 *
 * If no nonce is provided, one is generated from 4 random bytes (8 hex chars).
 * Callers should create markers once per session/hook invocation and reuse
 * them for all messages in that session, rather than generating per-message.
 *
 * @throws {Error} If a provided nonce contains non-hex characters.
 */
export function createBoundaryMarkers(nonce?: string): BoundaryMarkers {
  const n = nonce ?? randomBytes(4).toString('hex');
  if (!VALID_NONCE_RE.test(n)) {
    throw new Error('Boundary marker nonce must be 1-32 lowercase hex characters');
  }
  return {
    start: `[EXTERNAL_MSG_${n}_START]`,
    end: `[EXTERNAL_MSG_${n}_END]`,
    nonce: n,
  };
}

/**
 * Regex matching control characters to strip (ASCII 0x00-0x08, 0x0B, 0x0C, 0x0E-0x1F, 0x7F).
 * Preserves tab (0x09), newline (0x0A), and carriage return (0x0D).
 */
const CONTROL_CHARS_REGEX = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

/**
 * Regex matching Unicode characters commonly used for text direction manipulation
 * and zero-width obfuscation:
 * - U+200B Zero-width space
 * - U+200C Zero-width non-joiner
 * - U+200D Zero-width joiner
 * - U+200E Left-to-right mark
 * - U+200F Right-to-left mark
 * - U+202A Left-to-right embedding
 * - U+202B Right-to-left embedding
 * - U+202C Pop directional formatting
 * - U+202D Left-to-right override
 * - U+202E Right-to-left override
 * - U+2066 Left-to-right isolate
 * - U+2067 Right-to-left isolate
 * - U+2068 First strong isolate
 * - U+2069 Pop directional isolate
 * - U+FEFF Byte order mark / zero-width no-break space
 */
const UNICODE_INVISIBLE_REGEX = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;

/**
 * Injection detection patterns.
 * Each entry has a name (for logging), a regex, and a flag for whether it
 * requires surrounding instruction context (to reduce false positives).
 */
interface InjectionPattern {
  name: string;
  regex: RegExp;
}

const INJECTION_PATTERNS: InjectionPattern[] = [
  {
    name: 'instruction_override',
    regex:
      /\b(?:ignore|disregard|forget|override|bypass)\b.{0,30}\b(?:previous|prior|above|earlier|all|your|system|safety)\b.{0,30}\b(?:instructions?|rules?|guidelines?|prompts?|constraints?|directives?|and\b|do\b|instead\b)/i,
  },
  {
    name: 'role_reassignment',
    regex:
      /\b(?:you are now|act as|pretend (?:you are|to be)|roleplay as|behave as)\b.{0,50}\b(?:ai|assistant|bot|agent|unrestricted|dan|jailbreak|without.*?(?:restrictions?|limits?|safety|guidelines?))\b/i,
  },
  {
    name: 'new_instructions',
    regex: /\b(?:new instructions?|updated? instructions?|revised? instructions?|important (?:system )?update)\b\s*[:]/i,
  },
  {
    name: 'system_prompt_override',
    regex: /^(?:\s*[-=]{3,}\s*\n)?(?:SYSTEM|ADMIN|DEVELOPER|ROOT)\s*[:>]/im,
  },
  {
    name: 'forget_everything',
    regex: /\bforget (?:everything|all)\b.{0,30}\b(?:you (?:know|learned|were told)|and (?:start|begin))\b/i,
  },
  {
    name: 'prompt_delimiter_exploit',
    regex: /```\s*(?:system|admin|instructions?|prompt)\b/i,
  },
  {
    name: 'tool_call_injection',
    regex:
      /\b(?:call|use|invoke|execute|run)\b.{0,20}\b(?:the\s+)?(?:sms_send|email_send|memory_store|memory_forget|todo_create|contact_create|memory_recall)\b.{0,20}\btool\b/i,
  },
  {
    name: 'data_exfiltration',
    regex:
      /\b(?:send|forward|share|export|transmit|email|text)\b.{0,30}\b(?:all|every|the)\b.{0,20}\b(?:memories?|contacts?|data|information|messages?|threads?|projects?|todos?)\b.{0,30}\b(?:to|@)\b/i,
  },
  {
    name: 'system_note_injection',
    regex: /\[\s*(?:SYSTEM|ADMIN|INTERNAL)\s+(?:NOTE|MESSAGE|OVERRIDE|UPDATE)\s*[:]/i,
  },
  {
    name: 'remember_for_later',
    regex: /\bremember (?:this|that)\b.{0,30}\b(?:for later|when (?:someone|anyone|a user|the user))\b.{0,30}\b(?:send|forward|share|export)\b/i,
  },
];

/** Result of injection pattern detection */
export interface InjectionDetectionResult {
  /** Whether any injection patterns were detected */
  detected: boolean;
  /** Names of the patterns that matched */
  patterns: string[];
  /** PromptGuard classifier result, if available (Issue #1256) */
  classifier?: PromptGuardResult;
  /** Detection source: 'regex' (default), 'classifier', or 'both' */
  source?: 'regex' | 'classifier' | 'both';
}

/** Options for wrapping external messages */
export interface WrapOptions {
  /** Communication channel (sms, email) */
  channel?: string;
  /** Sender name or identifier */
  sender?: string;
  /** Per-session nonce for boundary markers. If omitted, one is auto-generated. */
  nonce?: string;
}

/** Options for context sanitisation */
export interface ContextSanitizeOptions {
  /** Message direction */
  direction?: 'inbound' | 'outbound';
  /** Communication channel */
  channel?: string;
  /** Sender name */
  sender?: string;
  /** Per-session nonce for boundary markers. If omitted, one is auto-generated. */
  nonce?: string;
}

/**
 * Sanitize external message content by removing control characters
 * and invisible Unicode characters that could be used for obfuscation.
 *
 * Preserves legitimate Unicode (emoji, CJK, Arabic, etc.) and whitespace
 * characters (tab, newline, carriage return).
 */
export function sanitizeExternalMessage(text: string): string {
  return text.replace(CONTROL_CHARS_REGEX, '').replace(UNICODE_INVISIBLE_REGEX, '').trim();
}

/**
 * Escape boundary marker keywords in a string to prevent breakout attacks.
 *
 * When a nonce is provided, escapes markers containing that specific nonce.
 * Also escapes the generic `EXTERNAL_MSG_START` / `EXTERNAL_MSG_END` keywords
 * (without nonce) so that attackers cannot inject markers from the public source.
 */
function escapeBoundaryMarkers(text: string, nonce?: string): string {
  let result = text;
  if (nonce) {
    // Escape nonce-specific markers first (more specific match)
    result = result
      .replace(new RegExp(`EXTERNAL_MSG_${nonce}_START`, 'g'), `EXTERNAL_MSG_${nonce}_START_ESCAPED`)
      .replace(new RegExp(`EXTERNAL_MSG_${nonce}_END`, 'g'), `EXTERNAL_MSG_${nonce}_END_ESCAPED`);
  }
  // Always escape the generic (non-nonce) marker keywords to prevent
  // attackers from using the old hardcoded pattern
  result = result.replace(/EXTERNAL_MSG_START/g, 'EXTERNAL_MSG_START_ESCAPED').replace(/EXTERNAL_MSG_END/g, 'EXTERNAL_MSG_END_ESCAPED');
  return result;
}

/**
 * Sanitize a metadata field (sender, channel) for safe insertion into
 * the boundary wrapper header. Strips control chars, invisible Unicode,
 * newlines (which could break out of the header line), and boundary markers.
 */
export function sanitizeMetadataField(field: string, nonce?: string): string {
  return escapeBoundaryMarkers(sanitizeExternalMessage(field).replace(/[\r\n]/g, ' '), nonce);
}

/**
 * Wrap external message content with data boundary markers.
 *
 * Uses the "spotlighting" / data marking pattern to clearly delineate
 * untrusted external content from system instructions. This tells the LLM
 * "this is external data, not instructions to follow."
 *
 * Content, sender, and channel are all sanitized and have boundary markers
 * escaped before wrapping to prevent breakout attacks.
 *
 * When `options.nonce` is provided, markers use that nonce. Otherwise a
 * fresh cryptographic nonce is generated per call.
 */
export function wrapExternalMessage(content: string, options: WrapOptions = {}): string {
  const markers = createBoundaryMarkers(options.nonce);

  const sanitized = sanitizeExternalMessage(content);

  // Escape any existing boundary markers in the content to prevent breakout
  const escaped = escapeBoundaryMarkers(sanitized, markers.nonce);

  const attribution: string[] = [];
  if (options.channel) {
    attribution.push(`[${sanitizeMetadataField(options.channel, markers.nonce)}]`);
  }
  if (options.sender) {
    attribution.push(`from: ${sanitizeMetadataField(options.sender, markers.nonce)}`);
  }

  const header = attribution.length > 0 ? `${markers.start} ${attribution.join(' ')}` : markers.start;

  return `${header}\n${escaped}\n${markers.end}`;
}

/**
 * Detect suspicious prompt injection patterns in message content.
 *
 * Returns detection results for logging/monitoring purposes.
 * This function does NOT block or modify the message — it is purely
 * for detection and alerting. Blocking legitimate messages based on
 * pattern matching has too high a false positive rate.
 *
 * The content is sanitized (invisible chars removed) before scanning
 * to prevent Unicode obfuscation from bypassing detection.
 */
export function detectInjectionPatterns(text: string): InjectionDetectionResult {
  const sanitized = sanitizeExternalMessage(text);
  const matched: string[] = [];

  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.regex.test(sanitized)) {
      matched.push(pattern.name);
    }
  }

  return {
    detected: matched.length > 0,
    patterns: matched,
  };
}

/** Options for async injection detection */
export interface AsyncDetectionOptions {
  /** PromptGuard service base URL (e.g. http://localhost:8190) */
  promptGuardUrl?: string;
  /** Timeout for classifier requests in milliseconds (default 500ms) */
  classifierTimeoutMs?: number;
}

/**
 * Detect suspicious prompt injection patterns using both regex and
 * (optionally) the PromptGuard-2 classifier.
 *
 * When `promptGuardUrl` is configured, the classifier is called in parallel
 * with regex scanning. If the classifier is unavailable or times out,
 * the function gracefully falls back to regex-only results.
 *
 * Detection remains monitoring-only (no blocking).
 *
 * Issue #1256
 */
export async function detectInjectionPatternsAsync(text: string, options: AsyncDetectionOptions = {}): Promise<InjectionDetectionResult> {
  // Always run regex detection (fast, synchronous)
  const regexResult = detectInjectionPatterns(text);

  // If no classifier URL configured, return regex-only result
  if (!options.promptGuardUrl) {
    return { ...regexResult, source: 'regex' };
  }

  // Call classifier in parallel (with timeout)
  const classifierResult = await classifyText(options.promptGuardUrl, text, options.classifierTimeoutMs ?? 500);

  // Classifier unavailable — fall back to regex
  if (!classifierResult) {
    return { ...regexResult, source: 'regex' };
  }

  // Merge results: detected if either regex or classifier flags it
  const classifierDetected = classifierResult.injection || classifierResult.jailbreak;
  const patterns = [...regexResult.patterns];

  if (classifierResult.injection) {
    patterns.push('classifier:injection');
  }
  if (classifierResult.jailbreak) {
    patterns.push('classifier:jailbreak');
  }

  const detected = regexResult.detected || classifierDetected;
  const source: InjectionDetectionResult['source'] = regexResult.detected && classifierDetected ? 'both' : classifierDetected ? 'classifier' : 'regex';

  return {
    detected,
    patterns,
    classifier: classifierResult,
    source,
  };
}

/**
 * Sanitize message content for safe inclusion in LLM context.
 *
 * For inbound (external) messages: sanitizes and wraps with boundary markers.
 * For outbound messages: sanitizes only (no boundary wrapping needed).
 *
 * This is the primary function to call when preparing message content
 * for any LLM-facing output (auto-recall context, tool results, etc.).
 */
export function sanitizeMessageForContext(content: string, options: ContextSanitizeOptions = {}): string {
  const { direction = 'inbound', channel, sender, nonce } = options;

  if (direction === 'outbound') {
    return sanitizeExternalMessage(content);
  }

  return wrapExternalMessage(content, { channel, sender, nonce });
}

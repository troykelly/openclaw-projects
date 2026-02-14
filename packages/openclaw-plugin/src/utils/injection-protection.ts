/**
 * Prompt injection protection utilities for inbound message processing.
 *
 * Provides layered defence for external message content before LLM exposure:
 * 1. Unicode/control character sanitisation
 * 2. Data boundary marking (spotlighting)
 * 3. Suspicious pattern detection and logging
 *
 * Issue #1224
 */

/** Boundary markers for external message content */
const EXTERNAL_MSG_START = '[EXTERNAL_MSG_START]';
const EXTERNAL_MSG_END = '[EXTERNAL_MSG_END]';

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
    regex: /\b(?:ignore|disregard|forget|override|bypass)\b.{0,30}\b(?:previous|prior|above|earlier|all|your|system|safety)\b.{0,30}\b(?:instructions?|rules?|guidelines?|prompts?|constraints?|directives?|and\b|do\b|instead\b)/i,
  },
  {
    name: 'role_reassignment',
    regex: /\b(?:you are now|act as|pretend (?:you are|to be)|roleplay as|behave as)\b.{0,50}\b(?:ai|assistant|bot|agent|unrestricted|dan|jailbreak|without.*?(?:restrictions?|limits?|safety|guidelines?))\b/i,
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
    regex: /\b(?:call|use|invoke|execute|run)\b.{0,20}\b(?:the\s+)?(?:sms_send|email_send|memory_store|memory_forget|todo_create|contact_create|memory_recall)\b.{0,20}\btool\b/i,
  },
  {
    name: 'data_exfiltration',
    regex: /\b(?:send|forward|share|export|transmit|email|text)\b.{0,30}\b(?:all|every|the)\b.{0,20}\b(?:memories?|contacts?|data|information|messages?|threads?|projects?|todos?)\b.{0,30}\b(?:to|@)\b/i,
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
}

/** Options for wrapping external messages */
export interface WrapOptions {
  /** Communication channel (sms, email) */
  channel?: string;
  /** Sender name or identifier */
  sender?: string;
}

/** Options for context sanitisation */
export interface ContextSanitizeOptions {
  /** Message direction */
  direction?: 'inbound' | 'outbound';
  /** Communication channel */
  channel?: string;
  /** Sender name */
  sender?: string;
}

/**
 * Sanitize external message content by removing control characters
 * and invisible Unicode characters that could be used for obfuscation.
 *
 * Preserves legitimate Unicode (emoji, CJK, Arabic, etc.) and whitespace
 * characters (tab, newline, carriage return).
 */
export function sanitizeExternalMessage(text: string): string {
  return text
    .replace(CONTROL_CHARS_REGEX, '')
    .replace(UNICODE_INVISIBLE_REGEX, '')
    .trim();
}

/**
 * Wrap external message content with data boundary markers.
 *
 * Uses the "spotlighting" / data marking pattern to clearly delineate
 * untrusted external content from system instructions. This tells the LLM
 * "this is external data, not instructions to follow."
 *
 * Content is sanitized before wrapping. Any existing boundary markers
 * in the content are escaped to prevent breakout.
 */
export function wrapExternalMessage(content: string, options: WrapOptions = {}): string {
  const sanitized = sanitizeExternalMessage(content);

  // Escape any existing boundary markers in the content to prevent breakout
  const escaped = sanitized
    .replace(/\[EXTERNAL_MSG_START\]/g, '[EXTERNAL_MSG_START_ESCAPED]')
    .replace(/\[EXTERNAL_MSG_END\]/g, '[EXTERNAL_MSG_END_ESCAPED]');

  const attribution: string[] = [];
  if (options.channel) {
    attribution.push(`[${options.channel}]`);
  }
  if (options.sender) {
    attribution.push(`from: ${options.sender}`);
  }

  const header = attribution.length > 0
    ? `${EXTERNAL_MSG_START} ${attribution.join(' ')}`
    : EXTERNAL_MSG_START;

  return `${header}\n${escaped}\n${EXTERNAL_MSG_END}`;
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

/**
 * Sanitize message content for safe inclusion in LLM context.
 *
 * For inbound (external) messages: sanitizes and wraps with boundary markers.
 * For outbound messages: sanitizes only (no boundary wrapping needed).
 *
 * This is the primary function to call when preparing message content
 * for any LLM-facing output (auto-recall context, tool results, etc.).
 */
export function sanitizeMessageForContext(
  content: string,
  options: ContextSanitizeOptions = {},
): string {
  const { direction = 'inbound', channel, sender } = options;

  if (direction === 'outbound') {
    return sanitizeExternalMessage(content);
  }

  return wrapExternalMessage(content, { channel, sender });
}

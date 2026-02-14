/**
 * Spam filtering utility for inbound message processing.
 *
 * Provides pre-processing gate that detects bulk/marketing email,
 * SMS spam signals, and supports configurable allowlist/blocklist.
 *
 * LIMITATION: Header-based spam detection is inherently best-effort.
 * Sophisticated spammers can omit or forge headers to bypass these checks.
 * This filter catches the majority of bulk/marketing email and common SMS
 * spam patterns, but should be complemented with content-based analysis
 * and external reputation services for production use at scale.
 *
 * Part of Issue #1225 — rate limiting and spam protection.
 */

/** Supported inbound message channels */
export type MessageChannel = 'email' | 'sms';

/** Inbound message to evaluate for spam */
export interface InboundMessage {
  /** Message channel (email or sms) */
  channel: MessageChannel;
  /** Sender identifier (email address or phone number) */
  sender: string;
  /** Recipient identifier */
  recipient: string;
  /** Message body text */
  body: string;
  /** Email headers (only present for email channel) */
  headers?: Record<string, string>;
}

/** Result of spam evaluation */
export interface SpamFilterResult {
  /** Whether the message is classified as spam */
  isSpam: boolean;
  /** Human-readable reason for the classification, null if not spam */
  reason: string | null;
  /** The channel of the evaluated message */
  channel: MessageChannel;
  /** The sender of the evaluated message */
  sender: string;
}

/** Configurable spam filter settings */
export interface SpamFilterConfig {
  /** Senders that are always allowed (bypass all checks) */
  allowlist: string[];
  /** Senders that are always blocked */
  blocklist: string[];
  /** Threshold for X-Spam-Score header (emails scoring above this are spam) */
  spamScoreThreshold: number;
  /** Patterns in X-Mailer header that indicate bulk mailers */
  bulkMailerPatterns: string[];
  /** Patterns in SMS body that indicate spam */
  smsSpamPatterns: string[];
}

/** Default spam filter configuration */
export const DEFAULT_SPAM_FILTER_CONFIG: SpamFilterConfig = {
  allowlist: [],
  blocklist: [],
  spamScoreThreshold: 5.0,
  bulkMailerPatterns: [
    'mailchimp',
    'sendgrid',
    'constantcontact',
    'mailgun',
    'campaign monitor',
    'hubspot',
    'marketo',
    'pardot',
    'sendinblue',
    'brevo',
  ],
  smsSpamPatterns: [
    'you have won',
    'you have been selected',
    'click here',
    'free gift',
    'act now',
    'limited time',
    'congratulations',
    'claim your',
    'verify now',
    'your account has been',
  ],
};

/** Email header values indicating bulk/list mail */
const BULK_PRECEDENCE_VALUES = new Set(['bulk', 'list', 'junk']);

/** SMS opt-out keywords that indicate marketing messages */
const SMS_OPT_OUT_KEYWORDS = ['stop', 'unsubscribe', 'opt-out', 'opt out', 'cancel', 'quit', 'end'];

/** Maximum length for a short code sender (SMS) */
const SHORT_CODE_MAX_LENGTH = 6;

/**
 * Normalize a sender identifier for consistent comparison.
 *
 * - Email: lowercased, with `+` alias portion stripped (e.g. user+tag@gmail.com -> user@gmail.com)
 * - Phone: non-digit characters stripped, leading country code '1' normalized to '+1'
 *
 * This prevents bypass via formatting variants like `+1...` vs `1...`
 * or `user+spam@gmail.com` vs `user@gmail.com`.
 */
export function normalizeSender(sender: string, channel: MessageChannel): string {
  if (channel === 'email') {
    return normalizeEmail(sender);
  }
  return normalizePhone(sender);
}

/**
 * Normalize an email address for consistent comparison.
 * Lowercases and strips `+` alias tags (e.g. user+tag@example.com -> user@example.com).
 */
function normalizeEmail(email: string): string {
  const lower = email.toLowerCase().trim();
  const atIndex = lower.indexOf('@');
  if (atIndex === -1) {
    return lower;
  }

  const localPart = lower.slice(0, atIndex);
  const domain = lower.slice(atIndex);

  // Strip + alias
  const plusIndex = localPart.indexOf('+');
  if (plusIndex !== -1) {
    return localPart.slice(0, plusIndex) + domain;
  }

  return lower;
}

/**
 * Normalize a phone number for consistent comparison.
 * Strips non-digit characters and normalizes country code.
 */
function normalizePhone(phone: string): string {
  // Strip everything except digits and leading +
  const hasPlus = phone.startsWith('+');
  const digits = phone.replace(/[^0-9]/g, '');

  if (digits.length === 0) {
    return phone.toLowerCase();
  }

  // Normalize US numbers: 10 digits -> +1XXXXXXXXXX, 11 digits starting with 1 -> +1XXXXXXXXXX
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  }

  // For other formats, preserve the + prefix if it was present
  return hasPlus ? `+${digits}` : digits;
}

/**
 * Evaluate whether an inbound message is spam.
 *
 * Checks are applied in this order:
 * 1. Allowlist (always passes)
 * 2. Blocklist (always fails)
 * 3. Channel-specific spam checks (email headers, SMS signals)
 *
 * @param message - The inbound message to evaluate
 * @param config - Optional spam filter configuration (uses defaults if omitted)
 * @returns SpamFilterResult with classification and reason
 */
export function isSpam(message: InboundMessage, config: SpamFilterConfig = DEFAULT_SPAM_FILTER_CONFIG): SpamFilterResult {
  const normalizedSender = normalizeSender(message.sender, message.channel);

  const result: SpamFilterResult = {
    isSpam: false,
    reason: null,
    channel: message.channel,
    sender: message.sender,
  };

  // Check allowlist first (always passes) — normalize both sides for consistent matching
  if (config.allowlist.some((allowed) => normalizeSender(allowed, message.channel) === normalizedSender)) {
    result.reason = 'allowlisted sender';
    return result;
  }

  // Check blocklist (always fails) — normalize both sides for consistent matching
  if (config.blocklist.some((blocked) => normalizeSender(blocked, message.channel) === normalizedSender)) {
    result.isSpam = true;
    result.reason = 'blocklisted sender';
    return result;
  }

  // Channel-specific checks
  if (message.channel === 'email') {
    return checkEmailSpam(message, config, result);
  }

  if (message.channel === 'sms') {
    return checkSmsSpam(message, config, result);
  }

  return result;
}

/**
 * Check email-specific spam signals.
 */
function checkEmailSpam(message: InboundMessage, config: SpamFilterConfig, result: SpamFilterResult): SpamFilterResult {
  const headers = normalizeHeaders(message.headers);

  // Check Precedence header for bulk/list
  const precedence = headers.precedence;
  if (precedence && BULK_PRECEDENCE_VALUES.has(precedence.toLowerCase())) {
    result.isSpam = true;
    result.reason = 'bulk precedence header detected';
    return result;
  }

  // Check List-Unsubscribe header
  if (headers['list-unsubscribe']) {
    result.isSpam = true;
    result.reason = 'list-unsubscribe header detected (mailing list)';
    return result;
  }

  // Check X-Spam-Score
  const spamScore = headers['x-spam-score'];
  if (spamScore) {
    const score = Number.parseFloat(spamScore);
    if (!Number.isNaN(score) && score >= config.spamScoreThreshold) {
      result.isSpam = true;
      result.reason = `high spam score (${score} >= ${config.spamScoreThreshold})`;
      return result;
    }
  }

  // Check X-Mailer for known bulk mailers
  const xMailer = headers['x-mailer'];
  if (xMailer) {
    const mailerLower = xMailer.toLowerCase();
    for (const pattern of config.bulkMailerPatterns) {
      if (mailerLower.includes(pattern.toLowerCase())) {
        result.isSpam = true;
        result.reason = `bulk mailer detected: ${pattern}`;
        return result;
      }
    }
  }

  return result;
}

/**
 * Check SMS-specific spam signals.
 */
function checkSmsSpam(message: InboundMessage, config: SpamFilterConfig, result: SpamFilterResult): SpamFilterResult {
  // Check for short code sender
  const senderDigits = message.sender.replace(/[^0-9]/g, '');
  if (senderDigits.length > 0 && senderDigits.length <= SHORT_CODE_MAX_LENGTH) {
    result.isSpam = true;
    result.reason = 'short code sender detected';
    return result;
  }

  const bodyLower = message.body.toLowerCase();

  // Check for opt-out keywords (indicates marketing/automated message)
  for (const keyword of SMS_OPT_OUT_KEYWORDS) {
    if (bodyLower.includes(keyword)) {
      result.isSpam = true;
      result.reason = `opt-out keyword detected: ${keyword}`;
      return result;
    }
  }

  // Check for common SMS spam patterns
  for (const pattern of config.smsSpamPatterns) {
    if (bodyLower.includes(pattern.toLowerCase())) {
      result.isSpam = true;
      result.reason = `spam pattern detected: ${pattern}`;
      return result;
    }
  }

  return result;
}

/**
 * Normalize email headers to lowercase keys for consistent lookup.
 */
function normalizeHeaders(headers: Record<string, string> | undefined): Record<string, string> {
  if (!headers) {
    return {};
  }

  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    normalized[key.toLowerCase()] = value;
  }
  return normalized;
}

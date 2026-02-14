/**
 * Spam filtering utility for inbound message processing.
 *
 * Provides pre-processing gate that detects bulk/marketing email,
 * SMS spam signals, and supports configurable allowlist/blocklist.
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
  const result: SpamFilterResult = {
    isSpam: false,
    reason: null,
    channel: message.channel,
    sender: message.sender,
  };

  // Check allowlist first (always passes)
  if (config.allowlist.some((allowed) => allowed.toLowerCase() === message.sender.toLowerCase())) {
    result.reason = 'allowlisted sender';
    return result;
  }

  // Check blocklist (always fails)
  if (config.blocklist.some((blocked) => blocked.toLowerCase() === message.sender.toLowerCase())) {
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

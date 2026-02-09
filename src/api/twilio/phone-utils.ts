/**
 * Phone number utilities for Twilio integration.
 * Part of Issue #202.
 */

import type { E164PhoneNumber } from './types.ts';

/**
 * Normalize a phone number to E.164 format.
 * Twilio typically sends numbers in E.164 format already,
 * but this ensures consistency and handles edge cases.
 *
 * @param phone - The phone number to normalize
 * @param defaultCountryCode - Default country code if missing (e.g., '1' for US)
 * @returns E.164 formatted number (e.g., +14155551234)
 */
export function normalizePhoneNumber(phone: string, defaultCountryCode: string = '1'): E164PhoneNumber {
  // Strip all non-digit characters except leading +
  let cleaned = phone.replace(/[^\d+]/g, '');

  // If already has +, it's likely E.164
  if (cleaned.startsWith('+')) {
    return cleaned;
  }

  // Handle international format with leading 00 (common in Europe)
  // e.g., 00447911123456 -> +447911123456
  if (cleaned.startsWith('00') && cleaned.length > 10) {
    return `+${cleaned.slice(2)}`;
  }

  // Remove any leading zeros that aren't part of international prefix
  cleaned = cleaned.replace(/^0+/, '');

  // If it looks like a US/Canada number without country code (10 digits)
  if (cleaned.length === 10 && defaultCountryCode === '1') {
    return `+1${cleaned}`;
  }

  // If it starts with 1 and is 11 digits (US/Canada with country code)
  if (cleaned.length === 11 && cleaned.startsWith('1')) {
    return `+${cleaned}`;
  }

  // If it's longer than 10 digits, it probably already has a country code
  if (cleaned.length > 10) {
    return `+${cleaned}`;
  }

  // Otherwise, assume the default country code is needed
  return `+${defaultCountryCode}${cleaned}`;
}

/**
 * Extract the phone number part without country code.
 * Useful for display purposes.
 *
 * @param phone - E.164 formatted phone number
 * @returns Phone number without country code
 */
export function getLocalNumber(phone: E164PhoneNumber): string {
  // Remove + and country code (assumes US/Canada for now)
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) {
    return digits.slice(1);
  }
  return digits;
}

/**
 * Format a phone number for display.
 * Converts E.164 to a more readable format.
 *
 * @param phone - E.164 formatted phone number
 * @returns Human-readable format (e.g., +1 (415) 555-1234)
 */
export function formatPhoneForDisplay(phone: E164PhoneNumber): string {
  const digits = phone.replace(/\D/g, '');

  // US/Canada format
  if (digits.length === 11 && digits.startsWith('1')) {
    const area = digits.slice(1, 4);
    const exchange = digits.slice(4, 7);
    const subscriber = digits.slice(7, 11);
    return `+1 (${area}) ${exchange}-${subscriber}`;
  }

  // Default: just add + and spaces every 3 digits
  return `+${digits.replace(/(\d{3})(?=\d)/g, '$1 ').trim()}`;
}

/**
 * Create a unique thread key for SMS conversations.
 * Combines both phone numbers to create a stable thread identifier.
 *
 * @param from - Sender phone number (E.164)
 * @param to - Recipient phone number (E.164)
 * @returns Thread key string
 */
export function createSmsThreadKey(from: E164PhoneNumber, to: E164PhoneNumber): string {
  // Sort to ensure same thread regardless of direction
  const [phone1, phone2] = [from, to].sort();
  return `sms:${phone1}:${phone2}`;
}

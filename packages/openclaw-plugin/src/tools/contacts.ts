/**
 * Contact management tools implementation.
 * Provides contact_search, contact_get, and contact_create tools.
 */

import { z } from 'zod';
import type { ApiClient } from '../api-client.js';
import type { Logger } from '../logger.js';
import type { PluginConfig } from '../config.js';
import { sanitizeErrorMessage } from '../utils/sanitize.js';

/** UUID validation regex */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Email validation regex (simplified RFC 5322) */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Phone validation regex (E.164 or common formats with digits) */
const PHONE_REGEX = /^\+?[0-9\s()-]{7,20}$/;

// ==================== contact_search ====================

/** Parameters for contact_search tool */
export const ContactSearchParamsSchema = z.object({
  query: z.string().min(1, 'Search query is required').max(200, 'Search query must be 200 characters or less'),
  limit: z.number().int().min(1).max(50).optional(),
});
export type ContactSearchParams = z.infer<typeof ContactSearchParamsSchema>;

/** Contact item from API (snake_case fields) */
export interface Contact {
  id: string;
  display_name: string;
  email?: string;
  phone?: string;
  notes?: string;
  contact_kind?: string;
  created_at?: string;
  updated_at?: string;
}

/** Successful search result */
export interface ContactSearchSuccess {
  success: true;
  data: {
    content: string;
    details: {
      contacts: Contact[];
      total: number;
      userId: string;
    };
  };
}

/** Failed result */
export interface ContactFailure {
  success: false;
  error: string;
}

export type ContactSearchResult = ContactSearchSuccess | ContactFailure;

/** Tool configuration */
export interface ContactToolOptions {
  client: ApiClient;
  logger: Logger;
  config: PluginConfig;
  userId: string;
}

/** Tool definition */
export interface ContactSearchTool {
  name: string;
  description: string;
  parameters: typeof ContactSearchParamsSchema;
  execute: (params: ContactSearchParams) => Promise<ContactSearchResult>;
}

/**
 * Strip HTML tags from a string.
 * Also removes content inside script and style tags for security.
 */
function stripHtml(text: string): string {
  return text
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<[^>]*>/g, '')
    .trim();
}

/**
 * Sanitize query input to remove control characters.
 */
function sanitizeQuery(query: string): string {
  const sanitized = query.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  return sanitized.trim();
}

/**
 * Validate UUID format.
 */
function isValidUuid(id: string): boolean {
  return UUID_REGEX.test(id);
}

/**
 * Validate email format.
 */
function _isValidEmail(email: string): boolean {
  return EMAIL_REGEX.test(email);
}

/**
 * Validate phone format.
 */
function _isValidPhone(phone: string): boolean {
  // Must have at least some digits
  const digitCount = (phone.match(/\d/g) || []).length;
  return PHONE_REGEX.test(phone) && digitCount >= 7;
}

/**
 * Creates the contact_search tool.
 */
export function createContactSearchTool(options: ContactToolOptions): ContactSearchTool {
  const { client, logger, userId } = options;

  return {
    name: 'contact_search',
    description: 'Search for contacts by name, email, or phone number.',
    parameters: ContactSearchParamsSchema,

    async execute(params: ContactSearchParams): Promise<ContactSearchResult> {
      const parseResult = ContactSearchParamsSchema.safeParse(params);
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
        return { success: false, error: errorMessage };
      }

      const { query, limit = 20 } = parseResult.data;
      const sanitizedQuery = sanitizeQuery(query);

      if (sanitizedQuery.length === 0) {
        return { success: false, error: 'Search query cannot be empty' };
      }

      // Log without PII
      logger.info('contact_search invoked', { userId, queryLength: sanitizedQuery.length, limit });

      try {
        const queryParams = new URLSearchParams({
          search: sanitizedQuery,
          limit: String(limit),
        });

        const response = await client.get<{ contacts?: Contact[]; items?: Contact[]; total?: number }>(`/api/contacts?${queryParams.toString()}`, {
          userId,
        });

        if (!response.success) {
          logger.error('contact_search API error', {
            userId,
            status: response.error.status,
            code: response.error.code,
          });
          return {
            success: false,
            error: response.error.message || 'Failed to search contacts',
          };
        }

        const contacts = response.data.contacts ?? response.data.items ?? [];
        const total = response.data.total ?? contacts.length;

        if (contacts.length === 0) {
          return {
            success: true,
            data: {
              content: 'No contacts found matching your search.',
              details: { contacts: [], total: 0, userId },
            },
          };
        }

        const content = contacts
          .map((c) => {
            const parts = [c.display_name];
            if (c.email) parts.push(`<${c.email}>`);
            if (c.phone) parts.push(c.phone);
            return `- ${parts.join(' ')}`;
          })
          .join('\n');

        // Don't log contact details
        logger.debug('contact_search completed', { userId, count: contacts.length });

        return {
          success: true,
          data: {
            content,
            details: { contacts, total, userId },
          },
        };
      } catch (error) {
        logger.error('contact_search failed', {
          userId,
          error: error instanceof Error ? error.message : String(error),
        });
        return { success: false, error: sanitizeErrorMessage(error) };
      }
    },
  };
}

// ==================== contact_get ====================

/** Parameters for contact_get tool */
export const ContactGetParamsSchema = z.object({
  id: z.string().min(1, 'Contact ID is required'),
});
export type ContactGetParams = z.infer<typeof ContactGetParamsSchema>;

/** Successful get result */
export interface ContactGetSuccess {
  success: true;
  data: {
    content: string;
    details: {
      contact: Contact;
      userId: string;
    };
  };
}

export type ContactGetResult = ContactGetSuccess | ContactFailure;

export interface ContactGetTool {
  name: string;
  description: string;
  parameters: typeof ContactGetParamsSchema;
  execute: (params: ContactGetParams) => Promise<ContactGetResult>;
}

/**
 * Creates the contact_get tool.
 */
export function createContactGetTool(options: ContactToolOptions): ContactGetTool {
  const { client, logger, userId } = options;

  return {
    name: 'contact_get',
    description: 'Get full details of a specific contact by ID.',
    parameters: ContactGetParamsSchema,

    async execute(params: ContactGetParams): Promise<ContactGetResult> {
      const parseResult = ContactGetParamsSchema.safeParse(params);
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
        return { success: false, error: errorMessage };
      }

      const { id } = parseResult.data;

      // Validate UUID format
      if (!isValidUuid(id)) {
        return { success: false, error: 'Invalid contact ID format. Expected UUID.' };
      }

      logger.info('contact_get invoked', { userId, contactId: id });

      try {
        const response = await client.get<Contact>(`/api/contacts/${id}`, { userId });

        if (!response.success) {
          if (response.error.code === 'NOT_FOUND') {
            return { success: false, error: 'Contact not found.' };
          }
          logger.error('contact_get API error', {
            userId,
            contactId: id,
            status: response.error.status,
          });
          return {
            success: false,
            error: response.error.message || 'Failed to get contact',
          };
        }

        const contact = response.data;
        const lines = [`**${contact.display_name}**`];
        if (contact.email) lines.push(`Email: ${contact.email}`);
        if (contact.phone) lines.push(`Phone: ${contact.phone}`);
        if (contact.notes) lines.push(`\nNotes: ${contact.notes}`);

        const content = lines.join('\n');

        logger.debug('contact_get completed', { userId, contactId: id });

        return {
          success: true,
          data: {
            content,
            details: { contact, userId },
          },
        };
      } catch (error) {
        logger.error('contact_get failed', {
          userId,
          contactId: id,
          error: error instanceof Error ? error.message : String(error),
        });
        return { success: false, error: sanitizeErrorMessage(error) };
      }
    },
  };
}

// ==================== contact_create ====================

/** Parameters for contact_create tool */
export const ContactCreateParamsSchema = z.object({
  name: z.string().min(1, 'Contact name is required').max(200, 'Contact name must be 200 characters or less'),
  notes: z.string().max(2000, 'Notes must be 2000 characters or less').optional(),
  contactKind: z.string().max(50, 'Contact kind must be 50 characters or less').optional(),
});
export type ContactCreateParams = z.infer<typeof ContactCreateParamsSchema>;

/** Successful create result */
export interface ContactCreateSuccess {
  success: true;
  data: {
    content: string;
    details: {
      id: string;
      display_name: string;
      userId: string;
    };
  };
}

export type ContactCreateResult = ContactCreateSuccess | ContactFailure;

export interface ContactCreateTool {
  name: string;
  description: string;
  parameters: typeof ContactCreateParamsSchema;
  execute: (params: ContactCreateParams) => Promise<ContactCreateResult>;
}

/**
 * Creates the contact_create tool.
 */
export function createContactCreateTool(options: ContactToolOptions): ContactCreateTool {
  const { client, logger, userId } = options;

  return {
    name: 'contact_create',
    description: 'Create a new contact with a display name and optional notes. Endpoints (email, phone) are managed separately.',
    parameters: ContactCreateParamsSchema,

    async execute(params: ContactCreateParams): Promise<ContactCreateResult> {
      const parseResult = ContactCreateParamsSchema.safeParse(params);
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
        return { success: false, error: errorMessage };
      }

      const { name, notes, contactKind } = parseResult.data;

      // Sanitize input
      const sanitizedName = stripHtml(name);
      const sanitizedNotes = notes ? stripHtml(notes) : undefined;

      if (sanitizedName.length === 0) {
        return { success: false, error: 'Contact name cannot be empty after sanitization' };
      }

      // Log without PII
      logger.info('contact_create invoked', {
        userId,
        nameLength: sanitizedName.length,
        hasNotes: !!notes,
        contactKind: contactKind ?? 'person',
      });

      try {
        const body: Record<string, unknown> = {
          display_name: sanitizedName,
        };
        if (sanitizedNotes) {
          body.notes = sanitizedNotes;
        }
        if (contactKind) {
          body.contact_kind = contactKind;
        }

        const response = await client.post<{ id: string; display_name?: string }>('/api/contacts', body, { userId });

        if (!response.success) {
          logger.error('contact_create API error', {
            userId,
            status: response.error.status,
            code: response.error.code,
          });
          return {
            success: false,
            error: response.error.message || 'Failed to create contact',
          };
        }

        const newContact = response.data;

        logger.debug('contact_create completed', {
          userId,
          contactId: newContact.id,
        });

        return {
          success: true,
          data: {
            content: `Created contact "${sanitizedName}" (ID: ${newContact.id})`,
            details: {
              id: newContact.id,
              display_name: sanitizedName,
              userId,
            },
          },
        };
      } catch (error) {
        logger.error('contact_create failed', {
          userId,
          error: error instanceof Error ? error.message : String(error),
        });
        return { success: false, error: sanitizeErrorMessage(error) };
      }
    },
  };
}

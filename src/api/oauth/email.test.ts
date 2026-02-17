/**
 * Tests for email API access.
 * Part of Issue #1048.
 *
 * Tests cover:
 * - Gmail message parsing (address parsing, body extraction, attachment extraction)
 * - Microsoft Graph message mapping
 * - Provider error handling (rate limits, 404s)
 * - Folder/label mapping
 */

import { describe, it, expect, vi } from 'vitest';
import { parseEmailAddress, parseAddressList } from './email-google.ts';
import { microsoftEmailProvider } from './email-microsoft.ts';
import { googleEmailProvider } from './email-google.ts';
import { OAuthError } from './types.ts';

// ---- Gmail address parsing ----

describe('parseEmailAddress', () => {
  it('parses a bare email address', () => {
    expect(parseEmailAddress('user@example.com')).toEqual({
      email: 'user@example.com',
    });
  });

  it('parses name with angle brackets', () => {
    expect(parseEmailAddress('John Doe <john@example.com>')).toEqual({
      email: 'john@example.com',
      name: 'John Doe',
    });
  });

  it('parses quoted name with angle brackets', () => {
    expect(parseEmailAddress('"Jane Smith" <jane@example.com>')).toEqual({
      email: 'jane@example.com',
      name: 'Jane Smith',
    });
  });

  it('handles single-quoted name', () => {
    expect(parseEmailAddress("'Bob' <bob@example.com>")).toEqual({
      email: 'bob@example.com',
      name: 'Bob',
    });
  });

  it('trims whitespace', () => {
    expect(parseEmailAddress('  user@example.com  ')).toEqual({
      email: 'user@example.com',
    });
  });

  it('handles complex display name', () => {
    expect(parseEmailAddress('Dr. Alice Smith-Jones <alice@example.co.uk>')).toEqual({
      email: 'alice@example.co.uk',
      name: 'Dr. Alice Smith-Jones',
    });
  });
});

describe('parseAddressList', () => {
  it('returns empty array for undefined', () => {
    expect(parseAddressList(undefined)).toEqual([]);
  });

  it('returns empty array for empty string', () => {
    expect(parseAddressList('')).toEqual([]);
  });

  it('parses a single address', () => {
    expect(parseAddressList('user@example.com')).toEqual([
      { email: 'user@example.com' },
    ]);
  });

  it('parses comma-separated addresses', () => {
    expect(parseAddressList('alice@example.com, bob@example.com')).toEqual([
      { email: 'alice@example.com' },
      { email: 'bob@example.com' },
    ]);
  });

  it('parses mixed named and bare addresses', () => {
    const result = parseAddressList('Alice <alice@example.com>, bob@example.com');
    expect(result).toEqual([
      { email: 'alice@example.com', name: 'Alice' },
      { email: 'bob@example.com' },
    ]);
  });

  it('handles addresses with commas inside display names and angle brackets', () => {
    const result = parseAddressList('Smith, John <john@example.com>');
    const emails = result.map((r) => r.email).filter(Boolean);
    expect(emails.length).toBeGreaterThanOrEqual(1);
    expect(emails).toContain('john@example.com');
  });
});

// ---- Microsoft Graph message mapping ----

describe('Microsoft email provider mapping', () => {
  const mockGraphMessage = {
    id: 'msg-123',
    conversationId: 'conv-456',
    subject: 'Test Subject',
    from: { emailAddress: { address: 'sender@example.com', name: 'Sender' } },
    toRecipients: [{ emailAddress: { address: 'recipient@example.com', name: 'Recipient' } }],
    ccRecipients: [],
    bccRecipients: [],
    body: { content_type: 'text', content: 'Hello world' },
    bodyPreview: 'Hello world',
    receivedDateTime: '2026-01-15T10:30:00Z',
    is_read: true,
    flag: { flagStatus: 'notFlagged' },
    is_draft: false,
    categories: ['Work'],
    hasAttachments: false,
    parentFolderId: 'inbox-id',
    web_link: 'https://outlook.office.com/mail/msg-123',
  };

  it('maps a Graph message to EmailMessage format', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => mockGraphMessage,
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await microsoftEmailProvider.getMessage('fake-token', 'msg-123');

    expect(result.id).toBe('msg-123');
    expect(result.thread_id).toBe('conv-456');
    expect(result.subject).toBe('Test Subject');
    expect(result.from).toEqual({ email: 'sender@example.com', name: 'Sender' });
    expect(result.to).toEqual([{ email: 'recipient@example.com', name: 'Recipient' }]);
    expect(result.body_text).toBe('Hello world');
    expect(result.is_read).toBe(true);
    expect(result.is_starred).toBe(false);
    expect(result.is_draft).toBe(false);
    expect(result.labels).toEqual(['Work']);
    expect(result.provider).toBe('microsoft');

    vi.unstubAllGlobals();
  });

  it('maps an HTML body message correctly', async () => {
    const htmlMessage = {
      ...mockGraphMessage,
      body: { content_type: 'html', content: '<p>Hello</p>' },
    };

    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => htmlMessage,
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await microsoftEmailProvider.getMessage('fake-token', 'msg-123');

    expect(result.body_text).toBeUndefined();
    expect(result.body_html).toBe('<p>Hello</p>');

    vi.unstubAllGlobals();
  });

  it('maps a flagged message as starred', async () => {
    const flaggedMessage = {
      ...mockGraphMessage,
      flag: { flagStatus: 'flagged' },
    };

    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => flaggedMessage,
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await microsoftEmailProvider.getMessage('fake-token', 'msg-123');
    expect(result.is_starred).toBe(true);

    vi.unstubAllGlobals();
  });

  it('maps a message with no from address', async () => {
    const noFromMessage = {
      ...mockGraphMessage,
      from: undefined,
    };

    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => noFromMessage,
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await microsoftEmailProvider.getMessage('fake-token', 'msg-123');
    expect(result.from).toEqual({ email: '' });

    vi.unstubAllGlobals();
  });
});

// ---- Gmail message mapping ----

describe('Gmail email provider mapping', () => {
  const mockGmailMessage = {
    id: 'gmail-msg-123',
    thread_id: 'gmail-thread-456',
    label_ids: ['INBOX', 'UNREAD'],
    snippet: 'Hello world snippet',
    internalDate: '1705312200000',
    sizeEstimate: 1500,
    payload: {
      partId: '',
      mimeType: 'text/plain',
      headers: [
        { name: 'From', value: 'Sender Name <sender@example.com>' },
        { name: 'To', value: 'recipient@example.com' },
        { name: 'Subject', value: 'Gmail Test Subject' },
        { name: 'Cc', value: 'cc@example.com' },
      ],
      body: {
        size: 11,
        data: Buffer.from('Hello world').toString('base64url'),
      },
    },
  };

  it('maps a Gmail message to EmailMessage format', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => mockGmailMessage,
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await googleEmailProvider.getMessage('fake-token', 'gmail-msg-123');

    expect(result.id).toBe('gmail-msg-123');
    expect(result.thread_id).toBe('gmail-thread-456');
    expect(result.subject).toBe('Gmail Test Subject');
    expect(result.from).toEqual({ email: 'sender@example.com', name: 'Sender Name' });
    expect(result.to).toEqual([{ email: 'recipient@example.com' }]);
    expect(result.cc).toEqual([{ email: 'cc@example.com' }]);
    expect(result.body_text).toBe('Hello world');
    expect(result.snippet).toBe('Hello world snippet');
    expect(result.is_read).toBe(false); // UNREAD label present
    expect(result.is_draft).toBe(false);
    expect(result.provider).toBe('google');

    vi.unstubAllGlobals();
  });

  it('extracts HTML body from multipart message', async () => {
    const multipartMessage = {
      ...mockGmailMessage,
      payload: {
        partId: '',
        mimeType: 'multipart/alternative',
        headers: mockGmailMessage.payload.headers,
        body: { size: 0 },
        parts: [
          {
            partId: '0',
            mimeType: 'text/plain',
            headers: [],
            body: { size: 5, data: Buffer.from('Plain').toString('base64url') },
          },
          {
            partId: '1',
            mimeType: 'text/html',
            headers: [],
            body: { size: 12, data: Buffer.from('<p>HTML</p>').toString('base64url') },
          },
        ],
      },
    };

    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => multipartMessage,
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await googleEmailProvider.getMessage('fake-token', 'gmail-msg-123');
    expect(result.body_text).toBe('Plain');
    expect(result.body_html).toBe('<p>HTML</p>');

    vi.unstubAllGlobals();
  });

  it('extracts attachment metadata', async () => {
    const messageWithAttachment = {
      ...mockGmailMessage,
      payload: {
        partId: '',
        mimeType: 'multipart/mixed',
        headers: mockGmailMessage.payload.headers,
        body: { size: 0 },
        parts: [
          {
            partId: '0',
            mimeType: 'text/plain',
            headers: [],
            body: { size: 5, data: Buffer.from('Body').toString('base64url') },
          },
          {
            partId: '1',
            mimeType: 'application/pdf',
            filename: 'report.pdf',
            headers: [{ name: 'Content-Disposition', value: 'attachment; filename="report.pdf"' }],
            body: { attachmentId: 'att-123', size: 50000 },
          },
        ],
      },
    };

    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => messageWithAttachment,
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await googleEmailProvider.getMessage('fake-token', 'gmail-msg-123');
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0]).toEqual({
      id: 'att-123',
      name: 'report.pdf',
      content_type: 'application/pdf',
      size: 50000,
      is_inline: false,
    });

    vi.unstubAllGlobals();
  });

  it('marks starred messages correctly', async () => {
    const starredMessage = {
      ...mockGmailMessage,
      label_ids: ['INBOX', 'STARRED'],
    };

    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => starredMessage,
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await googleEmailProvider.getMessage('fake-token', 'gmail-msg-123');
    expect(result.is_read).toBe(true); // No UNREAD label
    expect(result.is_starred).toBe(true);

    vi.unstubAllGlobals();
  });

  it('marks draft messages correctly', async () => {
    const draftMessage = {
      ...mockGmailMessage,
      label_ids: ['DRAFT'],
    };

    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => draftMessage,
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await googleEmailProvider.getMessage('fake-token', 'gmail-msg-123');
    expect(result.is_draft).toBe(true);

    vi.unstubAllGlobals();
  });
});

// ---- Rate limit handling ----

describe('rate limit handling', () => {
  it('Microsoft provider throws RATE_LIMITED on 429', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: new Headers({ 'Retry-After': '30' }),
      text: async () => 'rate limited',
    });
    vi.stubGlobal('fetch', mockFetch);

    try {
      await microsoftEmailProvider.getMessage('fake-token', 'msg-123');
      expect.fail('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(OAuthError);
      const oauthError = error as OAuthError;
      expect(oauthError.code).toBe('RATE_LIMITED');
      expect(oauthError.status_code).toBe(429);
      expect(oauthError.provider).toBe('microsoft');
    }

    vi.unstubAllGlobals();
  });

  it('Gmail provider throws RATE_LIMITED on 429', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: new Headers({ 'Retry-After': '60' }),
      text: async () => 'rate limited',
    });
    vi.stubGlobal('fetch', mockFetch);

    try {
      await googleEmailProvider.getMessage('fake-token', 'msg-123');
      expect.fail('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(OAuthError);
      const oauthError = error as OAuthError;
      expect(oauthError.code).toBe('RATE_LIMITED');
      expect(oauthError.status_code).toBe(429);
      expect(oauthError.provider).toBe('google');
    }

    vi.unstubAllGlobals();
  });
});

// ---- 404 handling ----

describe('not found handling', () => {
  it('Microsoft provider throws NOT_FOUND on 404', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      headers: new Headers(),
      text: async () => 'not found',
    });
    vi.stubGlobal('fetch', mockFetch);

    try {
      await microsoftEmailProvider.getMessage('fake-token', 'nonexistent');
      expect.fail('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(OAuthError);
      const oauthError = error as OAuthError;
      expect(oauthError.code).toBe('NOT_FOUND');
      expect(oauthError.status_code).toBe(404);
    }

    vi.unstubAllGlobals();
  });

  it('Gmail provider throws NOT_FOUND on 404', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      headers: new Headers(),
      text: async () => 'not found',
    });
    vi.stubGlobal('fetch', mockFetch);

    try {
      await googleEmailProvider.getMessage('fake-token', 'nonexistent');
      expect.fail('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(OAuthError);
      const oauthError = error as OAuthError;
      expect(oauthError.code).toBe('NOT_FOUND');
      expect(oauthError.status_code).toBe(404);
    }

    vi.unstubAllGlobals();
  });
});

// ---- Microsoft folder mapping ----

describe('Microsoft folder listing', () => {
  it('maps well-known folders to types', async () => {
    const mockFolders = {
      value: [
        { id: 'id1', display_name: 'Inbox', totalItemCount: 100, unreadItemCount: 5, isHidden: false },
        { id: 'id2', display_name: 'Sent Items', totalItemCount: 50, unreadItemCount: 0, isHidden: false },
        { id: 'id3', display_name: 'Drafts', totalItemCount: 3, unreadItemCount: 0, isHidden: false },
        { id: 'id4', display_name: 'Deleted Items', totalItemCount: 10, unreadItemCount: 0, isHidden: false },
        { id: 'id5', display_name: 'Junk Email', totalItemCount: 2, unreadItemCount: 0, isHidden: false },
        { id: 'id6', display_name: 'Archive', totalItemCount: 200, unreadItemCount: 0, isHidden: false },
        { id: 'id7', display_name: 'Custom Folder', totalItemCount: 15, unreadItemCount: 3, isHidden: false },
        { id: 'id8', display_name: 'Hidden', totalItemCount: 0, unreadItemCount: 0, isHidden: true },
      ],
    };

    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => mockFolders,
    });
    vi.stubGlobal('fetch', mockFetch);

    const folders = await microsoftEmailProvider.listFolders('fake-token');

    // Hidden folder should be excluded
    expect(folders).toHaveLength(7);

    expect(folders[0].type).toBe('inbox');
    expect(folders[0].message_count).toBe(100);
    expect(folders[0].unread_count).toBe(5);
    expect(folders[1].type).toBe('sent');
    expect(folders[2].type).toBe('drafts');
    expect(folders[3].type).toBe('trash');
    expect(folders[4].type).toBe('spam');
    expect(folders[5].type).toBe('archive');
    expect(folders[6].type).toBe('other');

    vi.unstubAllGlobals();
  });
});

// ---- Gmail label mapping ----

describe('Gmail folder/label listing', () => {
  it('maps well-known labels to types', async () => {
    const mockLabels = {
      labels: [
        { id: 'INBOX', name: 'INBOX', type: 'system', messagesTotal: 100, messagesUnread: 5 },
        { id: 'SENT', name: 'SENT', type: 'system', messagesTotal: 50, messagesUnread: 0 },
        { id: 'DRAFT', name: 'DRAFT', type: 'system', messagesTotal: 3, messagesUnread: 0 },
        { id: 'TRASH', name: 'TRASH', type: 'system', messagesTotal: 10, messagesUnread: 0 },
        { id: 'SPAM', name: 'SPAM', type: 'system', messagesTotal: 2, messagesUnread: 0 },
        { id: 'Label_1', name: 'Custom Label', type: 'user', messagesTotal: 15, messagesUnread: 3 },
      ],
    };

    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => mockLabels,
    });
    vi.stubGlobal('fetch', mockFetch);

    const folders = await googleEmailProvider.listFolders('fake-token');

    expect(folders).toHaveLength(6);
    expect(folders[0].type).toBe('inbox');
    expect(folders[0].message_count).toBe(100);
    expect(folders[0].unread_count).toBe(5);
    expect(folders[1].type).toBe('sent');
    expect(folders[2].type).toBe('drafts');
    expect(folders[3].type).toBe('trash');
    expect(folders[4].type).toBe('spam');
    expect(folders[5].type).toBe('other');

    vi.unstubAllGlobals();
  });
});

// ---- Message listing ----

describe('Microsoft message listing', () => {
  it('lists messages with pagination', async () => {
    const mockResponse = {
      value: [
        {
          id: 'msg-1',
          conversationId: 'conv-1',
          subject: 'First Message',
          from: { emailAddress: { address: 'a@example.com' } },
          toRecipients: [{ emailAddress: { address: 'b@example.com' } }],
          ccRecipients: [],
          bccRecipients: [],
          body: { content_type: 'text', content: 'Body 1' },
          bodyPreview: 'Body 1',
          receivedDateTime: '2026-01-15T10:00:00Z',
          is_read: true,
          is_draft: false,
          categories: [],
          hasAttachments: false,
        },
      ],
      '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/messages?$skip=25',
    };

    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => mockResponse,
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await microsoftEmailProvider.listMessages('fake-token', { max_results: 25 });

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].id).toBe('msg-1');
    expect(result.next_page_token).toBe('https://graph.microsoft.com/v1.0/me/messages?$skip=25');

    vi.unstubAllGlobals();
  });
});

describe('Gmail message listing', () => {
  it('lists messages by listing IDs then fetching full messages', async () => {
    const mockListResponse = {
      messages: [
        { id: 'gmail-1', thread_id: 'thread-1' },
      ],
      next_page_token: 'next-page',
      result_size_estimate: 50,
    };

    const mockFullMessage = {
      id: 'gmail-1',
      thread_id: 'thread-1',
      label_ids: ['INBOX'],
      snippet: 'Hello',
      internalDate: '1705312200000',
      sizeEstimate: 500,
      payload: {
        partId: '',
        mimeType: 'text/plain',
        headers: [
          { name: 'From', value: 'a@example.com' },
          { name: 'To', value: 'b@example.com' },
          { name: 'Subject', value: 'Hello' },
        ],
        body: { size: 5, data: Buffer.from('Hello').toString('base64url') },
      },
    };

    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => mockListResponse,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => mockFullMessage,
      });
    vi.stubGlobal('fetch', mockFetch);

    const result = await googleEmailProvider.listMessages('fake-token', { max_results: 25 });

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].id).toBe('gmail-1');
    expect(result.messages[0].subject).toBe('Hello');
    expect(result.next_page_token).toBe('next-page');
    expect(result.result_size_estimate).toBe(50);

    // Verify two fetch calls: list then full message
    expect(mockFetch).toHaveBeenCalledTimes(2);

    vi.unstubAllGlobals();
  });

  it('handles empty message list', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ messages: [] }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await googleEmailProvider.listMessages('fake-token', {});
    expect(result.messages).toHaveLength(0);

    vi.unstubAllGlobals();
  });
});

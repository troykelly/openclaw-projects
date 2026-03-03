# Messaging API Reference

This document covers the outbound messaging APIs for SMS and Email, including delivery status tracking.

## SMS Endpoints

### Send SMS

**POST** `/twilio/sms/send`

Send an SMS message via Twilio. Messages are queued for async delivery.

**Request Body:**
```json
{
  "to": "+15551234567",
  "body": "Hello from OpenClaw!",
  "idempotency_key": "my-unique-key-123"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `to` | string | Yes | Recipient phone number in E.164 format |
| `body` | string | Yes | Message content (max 1600 chars) |
| `idempotency_key` | string | No | Unique key for deduplication |

**Response (202 Accepted):**
```json
{
  "message_id": "019c1234-5678-7890-abcd-ef1234567890",
  "thread_id": "019c1234-5678-7890-abcd-ef1234567891",
  "status": "queued",
  "idempotency_key": "my-unique-key-123"
}
```

**Error Responses:**
- `400 Bad Request` - Invalid phone number or empty body
- `401 Unauthorized` - Missing or invalid auth token
- `500 Internal Server Error` - Server-side error

**Example:**
```bash
curl -X POST https://api.example.com/twilio/sms/send \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "+15551234567",
    "body": "Your appointment is confirmed for tomorrow at 2pm."
  }'
```

### SMS Delivery Status Webhook

**POST** `/twilio/sms/status`

Webhook endpoint for Twilio delivery status callbacks. Configure in your Twilio console.

**Request Body (from Twilio):**
```
MessageSid=SM1234567890abcdef&
MessageStatus=delivered&
To=%2B15551234567&
From=%2B15559876543&
AccountSid=AC1234567890
```

**Response:** `200 OK` with empty body

**Status Values:**
| Status | Description |
|--------|-------------|
| `queued` | Message queued for sending |
| `sending` | Message being sent to carrier |
| `sent` | Message accepted by carrier |
| `delivered` | Message delivered to recipient |
| `undelivered` | Message could not be delivered |
| `failed` | Message failed to send |

---

## Email Endpoints

### Send Email

**POST** `/postmark/email/send`

Send an email via Postmark. Messages are queued for async delivery.

**Request Body:**
```json
{
  "to": "user@example.com",
  "subject": "Welcome to Our Service",
  "body": "Thank you for signing up!",
  "html_body": "<h1>Welcome!</h1><p>Thank you for signing up!</p>",
  "reply_to_message_id": "optional-message-id-for-threading",
  "idempotency_key": "email-unique-key-456"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `to` | string | Yes | Recipient email address |
| `subject` | string | Yes | Email subject line |
| `body` | string | Yes | Plain text body |
| `html_body` | string | No | HTML body (optional) |
| `thread_id` | string | No | Existing thread ID for replies |
| `reply_to_message_id` | string | No | Message ID for threading |
| `idempotency_key` | string | No | Unique key for deduplication |

**Response (202 Accepted):**
```json
{
  "message_id": "019c1234-5678-7890-abcd-ef1234567892",
  "thread_id": "019c1234-5678-7890-abcd-ef1234567893",
  "status": "queued",
  "idempotency_key": "email-unique-key-456"
}
```

**Error Responses:**
- `400 Bad Request` - Invalid email address, empty subject, or empty body
- `401 Unauthorized` - Missing or invalid auth token
- `500 Internal Server Error` - Server-side error

**Example:**
```bash
curl -X POST https://api.example.com/postmark/email/send \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "user@example.com",
    "subject": "Order Confirmation",
    "body": "Your order #12345 has been confirmed.",
    "html_body": "<h1>Order Confirmed</h1><p>Your order #12345 has been confirmed.</p>"
  }'
```

### Email Delivery Status Webhook

**POST** `/postmark/email/status`

Webhook endpoint for Postmark delivery status callbacks. Configure in your Postmark server settings.

**Request Body (Delivery Event):**
```json
{
  "RecordType": "Delivery",
  "MessageID": "a8b9c0d1-e2f3-4a5b-6c7d-8e9f0a1b2c3d",
  "Recipient": "user@example.com",
  "DeliveredAt": "2024-01-15T12:00:00Z",
  "MessageStream": "outbound",
  "ServerID": 12345
}
```

**Request Body (Bounce Event):**
```json
{
  "RecordType": "Bounce",
  "MessageID": "a8b9c0d1-e2f3-4a5b-6c7d-8e9f0a1b2c3d",
  "Recipient": "user@example.com",
  "Type": "HardBounce",
  "TypeCode": 1,
  "Name": "Hard bounce",
  "Description": "The server was unable to deliver your message",
  "BouncedAt": "2024-01-15T12:00:00Z",
  "MessageStream": "outbound",
  "ServerID": 12345
}
```

**Response:** `200 OK`

**Postmark Event Types:**
| RecordType | Our Status | Description |
|------------|------------|-------------|
| `Delivery` | `delivered` | Email delivered to recipient |
| `Bounce` (HardBounce) | `bounced` | Permanent delivery failure |
| `Bounce` (SoftBounce) | `failed` | Temporary delivery failure |
| `SpamComplaint` | (recorded) | Recipient marked as spam |

---

## Thread Endpoints

### List Threads

**GET** `/threads`

List all conversation threads with optional filtering by channel or contact.

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `limit` | integer | No | Max threads to return (default 20) |
| `offset` | integer | No | Pagination offset (default 0) |
| `channel` | string | No | Filter by channel (e.g., `sms`, `email`) |
| `contact_id` | string | No | Filter by contact UUID |

**Response (200 OK):**
```json
{
  "threads": [
    {
      "id": "019c1234-5678-7890-abcd-ef1234567890",
      "channel": "sms",
      "external_thread_key": "+15551234567",
      "contact": {
        "id": "019c1234-5678-7890-abcd-ef1234567891",
        "display_name": "Jane Doe"
      },
      "created_at": "2026-01-15T12:00:00Z",
      "updated_at": "2026-02-14T09:30:00Z",
      "last_message": {
        "id": "019c1234-5678-7890-abcd-ef1234567892",
        "direction": "inbound",
        "body": "Thanks for the reminder!",
        "received_at": "2026-02-14T09:30:00Z"
      },
      "message_count": 12
    }
  ],
  "total": 42,
  "pagination": {
    "limit": 20,
    "offset": 0,
    "has_more": true
  }
}
```

**Example:**
```bash
# List all threads
curl https://api.example.com/threads \
  -H "Authorization: Bearer $API_TOKEN"

# Filter by channel
curl "https://api.example.com/threads?channel=sms&limit=10" \
  -H "Authorization: Bearer $API_TOKEN"
```

### Get Thread History

**GET** `/threads/:id/history`

Get full thread history including messages, related work items, and contact memories.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Thread UUID |

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `limit` | integer | No | Max messages to return (default 50, max 200) |
| `before` | string | No | Messages before this ISO 8601 timestamp |
| `after` | string | No | Messages after this ISO 8601 timestamp |
| `include_work_items` | boolean | No | Include related work items (default true) |
| `include_memories` | boolean | No | Include contact memories (default true) |

**Response (200 OK):**
```json
{
  "thread": {
    "id": "019c1234-...",
    "channel": "sms",
    "external_thread_key": "+15551234567",
    "contact": { "id": "...", "display_name": "Jane Doe" },
    "created_at": "2026-01-15T12:00:00Z",
    "updated_at": "2026-02-14T09:30:00Z"
  },
  "messages": [
    {
      "id": "...",
      "direction": "outbound",
      "body": "Don't forget your appointment tomorrow!",
      "received_at": "2026-02-13T10:00:00Z",
      "created_at": "2026-02-13T10:00:00Z"
    }
  ],
  "related_work_items": [],
  "contact_memories": [],
  "pagination": {
    "has_more": false,
    "oldest_timestamp": "2026-02-13T10:00:00Z",
    "newest_timestamp": "2026-02-14T09:30:00Z"
  }
}
```

---

## Delivery Status Tracking

### Message Lifecycle

```
pending → queued → sending → sent → delivered
                              ↘    → failed
                                   → bounced
                                   → undelivered
```

### Status Definitions

| Status | Description |
|--------|-------------|
| `pending` | Message created, waiting to be processed |
| `queued` | Message added to send queue |
| `sending` | Message being transmitted to provider |
| `sent` | Provider accepted the message |
| `delivered` | Recipient received the message |
| `failed` | Temporary failure (may retry) |
| `bounced` | Permanent delivery failure |
| `undelivered` | Message could not be delivered |

### Idempotency

Both SMS and Email endpoints support idempotency keys:

1. **First request**: Message is created and queued
2. **Duplicate request** (same key): Returns original message ID without creating duplicate

Use idempotency keys to safely retry failed requests without sending duplicate messages.

```bash
# Safe to retry - only sends once
curl -X POST /twilio/sms/send \
  -d '{"to": "+15551234567", "body": "Hello", "idempotency_key": "retry-safe-123"}'
```

---

## Rate Limits

| Endpoint | Limit | Window |
|----------|-------|--------|
| SMS send | 30 req | 1 minute |
| Email send | 30 req | 1 minute |
| Status webhooks | 100 req | 1 minute |

Exceeding rate limits returns `429 Too Many Requests`.

---

## Authentication

All API endpoints require Bearer token authentication:

```bash
Authorization: Bearer your-api-token
```

Webhook endpoints verify signatures:
- **Twilio**: X-Twilio-Signature header validation
- **Postmark**: Basic auth or API token validation
- **Cloudflare Email**: X-Cloudflare-Email-Secret shared secret (see below)

---

## Cloudflare Email Inbound Webhook

### Overview

The Cloudflare Email integration receives inbound emails via a [Cloudflare Email Worker](https://developers.cloudflare.com/email-routing/email-workers/) that parses the MIME message and POSTs a JSON payload to this endpoint.

**Flow:**
```
Inbound email → Cloudflare Email Routing → Email Worker → POST /cloudflare/email → openclaw-projects
```

A reference Worker implementation is provided in [`examples/cloudflare-email-worker/`](../../examples/cloudflare-email-worker/README.md).

### Receive Inbound Email

**POST** `/cloudflare/email`

Receives a parsed email from the Cloudflare Worker, creates or matches the sender contact, threads the email, stores the message, and returns a triage decision.

**Authentication:**

This endpoint does NOT use Bearer token auth. Instead, the Worker authenticates via a shared secret header:

```bash
X-Cloudflare-Email-Secret: your-shared-secret
```

The secret must match the `CLOUDFLARE_EMAIL_SECRET` environment variable. Comparison is timing-safe.

**Request Body:**
```json
{
  "from": "sender@example.com",
  "to": "support@myapp.com",
  "subject": "Question about my order",
  "text_body": "Hi, I have a question about order #12345.",
  "html_body": "<p>Hi, I have a question about order #12345.</p>",
  "headers": {
    "message-id": "<unique-id-123@example.com>",
    "in-reply-to": "<previous-id-456@example.com>",
    "references": "<original-id-789@example.com>"
  },
  "timestamp": "2026-03-03T12:00:00.000Z"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `from` | string | Yes | Sender email address |
| `to` | string | Yes | Recipient email address (used for route resolution) |
| `subject` | string | Yes | Email subject line |
| `text_body` | string | No | Plain text body from MIME |
| `html_body` | string | No | HTML body from MIME |
| `headers` | object | Yes | Email headers (see below) |
| `headers.message-id` | string | No | RFC 5322 Message-ID (used for deduplication and threading) |
| `headers.in-reply-to` | string | No | In-Reply-To header (links replies to parent messages) |
| `headers.references` | string | No | References header (full thread chain) |
| `raw` | string | No | Full raw MIME message (optional, for debugging) |
| `timestamp` | string | Yes | ISO 8601 timestamp (must be within 5 minutes for replay protection) |

**Response (200 OK):**

The response always includes a triage `action` field that the Worker uses to decide whether to accept or reject the email at the SMTP level.

**Accept response** (route found):
```json
{
  "success": true,
  "action": "accept",
  "receipt_id": "d290f1ee-6c54-4b01-90e6-d701748f0851",
  "contact_id": "a1b2c3d4-5678-90ab-cdef-1234567890ab",
  "thread_id": "b2c3d4e5-6789-01ab-cdef-2345678901bc",
  "message_id": "c3d4e5f6-7890-12ab-cdef-3456789012cd"
}
```

**Reject response** (no route configured):
```json
{
  "success": true,
  "action": "reject",
  "reject_reason": "No agent configured for support@myapp.com",
  "receipt_id": "d290f1ee-6c54-4b01-90e6-d701748f0851",
  "contact_id": "a1b2c3d4-5678-90ab-cdef-1234567890ab",
  "thread_id": "b2c3d4e5-6789-01ab-cdef-2345678901bc",
  "message_id": "c3d4e5f6-7890-12ab-cdef-3456789012cd"
}
```

**Accept with auto-reply:**
```json
{
  "success": true,
  "action": "accept",
  "receipt_id": "...",
  "contact_id": "...",
  "thread_id": "...",
  "message_id": "...",
  "auto_reply": {
    "subject": "Re: Question about my order",
    "text_body": "Thank you for your message. An agent will respond shortly.",
    "html_body": "<p>Thank you for your message. An agent will respond shortly.</p>"
  }
}
```

When `auto_reply` is present, the Worker constructs a MIME reply and sends it back to the sender via `message.reply()`.

**Error Responses:**
- `400 Bad Request` — Missing required fields, invalid timestamp, or stale timestamp (>5 min old)
- `401 Unauthorized` — Missing or invalid `X-Cloudflare-Email-Secret` header
- `500 Internal Server Error` — Server-side error

**Example:**
```bash
curl -X POST https://api.example.com/cloudflare/email \
  -H "X-Cloudflare-Email-Secret: $CLOUDFLARE_EMAIL_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "from": "sender@example.com",
    "to": "support@myapp.com",
    "subject": "Hello",
    "text_body": "This is a test email.",
    "headers": {
      "message-id": "<test-123@example.com>"
    },
    "timestamp": "2026-03-03T12:00:00.000Z"
  }'
```

### Triage and Route Resolution

When an email arrives, the API resolves a route to decide which agent handles it:

1. **Inbound destination lookup** — Checks the `inbound_destination` table for a row matching the recipient address and `email` channel type
2. **Channel default fallback** — If no destination match, checks the `channel_default` table for an email channel default
3. **No route** — If neither exists, returns `action: "reject"`

**To configure email routing:**

Use the [Inbound Destinations API](/inbound-destinations) to create a destination:

```bash
# Create an inbound destination for email
curl -X PUT https://api.example.com/inbound-destinations/{id} \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "channel_type": "email",
    "destination_value": "support@myapp.com",
    "agent_id": "agent-assistant-v2",
    "is_active": true
  }'
```

Or set a channel default so ALL email is routed to an agent:

```bash
curl -X PUT https://api.example.com/channel-defaults/email \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "agent_id": "agent-assistant-v2"
  }'
```

### Email Threading

Emails are automatically threaded using RFC 5322 headers:

| Header | Purpose |
|--------|---------|
| `Message-ID` | Unique identifier for each email. Used as the external message key for deduplication. |
| `In-Reply-To` | Links a reply to its parent message. Used to find existing threads. |
| `References` | Full chain of Message-IDs in the thread. Used as fallback for thread resolution. |

**Thread key derivation:**
- If `In-Reply-To` is present → thread key derived from the referenced message
- If `References` is present → thread key derived from the first reference
- Otherwise → new thread created from the Message-ID

Duplicate messages (same Message-ID + thread) are upserted, not duplicated.

### Contact Creation

When an email arrives from an unknown sender:
1. A new `contact` record is created with the email address as the display name
2. A `contact_endpoint` is created with type `email` and the normalized sender address
3. Subsequent emails from the same address reuse the existing contact

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `CLOUDFLARE_EMAIL_SECRET` | Yes | Shared secret for authenticating the Worker |
| `CLOUDFLARE_EMAIL_SECRET_FILE` | No | Alternative: path to a file containing the secret |

### Worker Deployment

See the reference Cloudflare Email Worker implementation in [`examples/cloudflare-email-worker/`](../../examples/cloudflare-email-worker/README.md) for:
- Complete Worker source code with MIME parsing via `postal-mime`
- Triage-based rejection via `message.setReject()`
- Auto-reply via `message.reply()`
- Retry logic for transient failures
- `wrangler.jsonc` deployment configuration

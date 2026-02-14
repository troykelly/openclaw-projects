# Local Development: Messaging Setup

This guide covers setting up SMS and Email messaging for local development and testing.

## Prerequisites

- Docker and Docker Compose
- Node.js 18+
- ngrok (for webhook testing)

## Quick Start

```bash
# 1. Start the development environment
docker compose up -d

# 2. Copy environment template
cp .env.example .env

# 3. Run migrations
pnpm migrate up

# 4. Start the dev server
pnpm dev
```

## Twilio SMS Setup

### Test Credentials

For development, use Twilio test credentials:

```bash
# .env
TWILIO_ACCOUNT_SID=ACtest... # Your test account SID
TWILIO_AUTH_TOKEN=your-test-auth-token
TWILIO_PHONE_NUMBER=+15005550006  # Twilio magic test number
```

### Twilio Test Numbers

| Number | Behavior |
|--------|----------|
| `+15005550006` | Valid sender |
| `+15005550001` | Returns invalid number error |
| `+15005550009` | Returns cannot route error |

### Getting Real Credentials

1. Sign up at [twilio.com](https://www.twilio.com)
2. Get Account SID and Auth Token from Console
3. Purchase a phone number
4. Configure webhook URL for status callbacks

### Webhook Testing with ngrok

```bash
# Start ngrok
ngrok http 3000

# Configure Twilio webhook URL
# https://xxxxx.ngrok.io/api/twilio/sms/status
```

## Postmark Email Setup

### Test Mode

Postmark provides a test server for development:

```bash
# .env
POSTMARK_SERVER_TOKEN=POSTMARK_API_TEST  # Test token
POSTMARK_FROM_EMAIL=test@example.com     # Any email for tests
```

### Production Setup

1. Sign up at [postmarkapp.com](https://postmarkapp.com)
2. Verify your sending domain
3. Create a server and get the Server Token
4. Configure webhooks for delivery events

```bash
# .env (production)
POSTMARK_SERVER_TOKEN=your-server-token
POSTMARK_FROM_EMAIL=noreply@yourdomain.com
```

### Webhook Configuration

In Postmark server settings:
1. Go to **Webhooks** tab
2. Add webhook URL: `https://yourdomain.com/api/postmark/email/status`
3. Select events: Delivery, Bounce, SpamComplaint

## Testing Endpoints

### Send Test SMS

```bash
# Without auth (dev mode)
curl -X POST http://localhost:3000/api/twilio/sms/send \
  -H "Content-Type: application/json" \
  -d '{
    "to": "+15551234567",
    "body": "Test message from local dev"
  }'
```

### Send Test Email

```bash
curl -X POST http://localhost:3000/api/postmark/email/send \
  -H "Content-Type: application/json" \
  -d '{
    "to": "test@example.com",
    "subject": "Test Email",
    "body": "This is a test email from local development."
  }'
```

### Simulate Webhook Events

#### Twilio SMS Status

```bash
curl -X POST http://localhost:3000/api/twilio/sms/status \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "MessageSid=SM12345&MessageStatus=delivered&To=%2B15551234567"
```

#### Postmark Delivery

```bash
curl -X POST http://localhost:3000/api/postmark/email/status \
  -H "Content-Type: application/json" \
  -d '{
    "RecordType": "Delivery",
    "MessageID": "your-message-id",
    "Recipient": "test@example.com",
    "DeliveredAt": "2024-01-15T12:00:00Z",
    "MessageStream": "outbound",
    "ServerID": 12345
  }'
```

#### Postmark Bounce

```bash
curl -X POST http://localhost:3000/api/postmark/email/status \
  -H "Content-Type: application/json" \
  -d '{
    "RecordType": "Bounce",
    "MessageID": "your-message-id",
    "Recipient": "invalid@example.com",
    "Type": "HardBounce",
    "TypeCode": 1,
    "Name": "Hard bounce",
    "Description": "Invalid email address",
    "BouncedAt": "2024-01-15T12:00:00Z",
    "MessageStream": "outbound",
    "ServerID": 12345
  }'
```

## Running Tests

### Unit Tests

```bash
# Run all messaging tests
pnpm test tests/twilio
pnpm test tests/postmark
pnpm test tests/message-embeddings.test.ts

# Run specific test file
pnpm test tests/twilio/sms-outbound.test.ts
```

### Integration Tests

Integration tests require a running PostgreSQL instance:

```bash
# Ensure database is running
docker compose up -d postgres

# Run migrations
pnpm migrate up

# Run integration tests
pnpm test:integration
```

## Environment Variables Reference

### Twilio

| Variable | Required | Description |
|----------|----------|-------------|
| `TWILIO_ACCOUNT_SID` | Yes | Twilio Account SID |
| `TWILIO_AUTH_TOKEN` | Yes | Twilio Auth Token |
| `TWILIO_PHONE_NUMBER` | Yes | Sender phone number |

### Postmark

| Variable | Required | Description |
|----------|----------|-------------|
| `POSTMARK_SERVER_TOKEN` | Yes* | Server API token |
| `POSTMARK_TRANSACTIONAL_TOKEN` | Yes* | Alternative token name |
| `POSTMARK_TRANSACTIONAL_TOKEN_FILE` | Yes* | Path to token file |
| `POSTMARK_FROM_EMAIL` | Yes** | Verified sender email |
| `POSTMARK_FROM` | No | Legacy alias for `POSTMARK_FROM_EMAIL` (used as fallback) |

*One of the token options is required.
**Either `POSTMARK_FROM_EMAIL` or legacy `POSTMARK_FROM` must be set.

### Embeddings (for semantic search)

| Variable | Required | Description |
|----------|----------|-------------|
| `VOYAGE_API_KEY` | No | VoyageAI API key |
| `OPENAI_API_KEY` | No | OpenAI API key |
| `GOOGLE_AI_API_KEY` | No | Google AI API key |
| `EMBEDDING_PROVIDER` | No | Force specific provider |

## Troubleshooting

### SMS not sending

1. Check Twilio credentials are correct
2. Verify phone number format (E.164: +15551234567)
3. Check Twilio console for errors
4. Verify sender number is active

### Email not sending

1. Check Postmark server token
2. Verify sender domain is verified in Postmark
3. Check Postmark activity feed for errors
4. Ensure `POSTMARK_FROM_EMAIL` matches verified domain

### Webhooks not received

1. Verify ngrok is running and URL is correct
2. Check webhook configuration in Twilio/Postmark console
3. Look for errors in application logs
4. Test with curl to local endpoint first

### Embeddings not generating

1. Ensure at least one embedding provider is configured
2. Check API key is valid
3. Run backfill: `pnpm cli embeddings backfill-messages`
4. Check message has body content (empty messages are skipped)

## Database Schema

### Key Tables

```sql
-- Messages with delivery tracking
external_message (
  id, thread_id, direction, body, subject,
  delivery_status,      -- pending, queued, sending, sent, delivered, failed, bounced
  provider_message_id,  -- Twilio SID or Postmark MessageID
  provider_status_raw,  -- Full webhook payload
  embedding,            -- Vector for semantic search
  embedding_status      -- pending, complete, failed
)

-- Conversations
external_thread (
  id, endpoint_id, channel, external_thread_key
)

-- Contact endpoints with bounce tracking
contact_endpoint (
  id, contact_id, endpoint_type, endpoint_value,
  metadata  -- Contains { bounced: true, bounce_type: 'HardBounce' }
)

-- Background jobs
internal_job (
  id, kind,           -- message.send.sms, message.send.email, message.embed
  payload, run_at, attempts, completed_at
)
```

### Useful Queries

```sql
-- Check message status
SELECT id, delivery_status, provider_message_id
FROM external_message
WHERE id = 'your-message-id';

-- Find pending embedding jobs
SELECT COUNT(*) FROM internal_job
WHERE kind = 'message.embed' AND completed_at IS NULL;

-- Find bounced endpoints
SELECT ce.*, c.display_name
FROM contact_endpoint ce
JOIN contact c ON c.id = ce.contact_id
WHERE ce.metadata->>'bounced' = 'true';
```

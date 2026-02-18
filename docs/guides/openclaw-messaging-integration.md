# OpenClaw Messaging Integration Guide

This guide explains how OpenClaw agents should integrate with the messaging APIs to send SMS and email messages, and handle delivery status updates.

## Overview

The messaging system provides:
- **Asynchronous delivery** - Messages are queued and processed in the background
- **Delivery tracking** - Status updates via webhooks
- **Semantic search** - Find messages by meaning, not just keywords
- **Thread management** - Automatic conversation threading

## Sending Messages

### SMS Messages

```typescript
// Send an SMS
const response = await fetch('/api/twilio/sms/send', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${apiToken}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    to: '+15551234567',
    body: 'Your appointment is confirmed for tomorrow at 2pm.',
    idempotency_key: `reminder:${appointmentId}:${Date.now()}`
  })
});

const result = await response.json();
// { message_id: '...', thread_id: '...', status: 'queued', idempotency_key: '...' }
```

### Email Messages

```typescript
// Send an email
const response = await fetch('/api/postmark/email/send', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${apiToken}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    to: 'user@example.com',
    subject: 'Order Confirmation',
    body: 'Your order #12345 has been confirmed and will ship within 2 business days.',
    html_body: '<h1>Order Confirmed!</h1><p>Your order #12345 has been confirmed...</p>',
    idempotency_key: `order:${orderId}:confirmation`
  })
});
```

## Idempotency Best Practices

Always use idempotency keys to prevent duplicate messages:

```typescript
// Good: Unique key based on business context
idempotency_key: `appointment:${appointmentId}:reminder:24h`

// Good: Include timestamp for time-sensitive messages
idempotency_key: `daily-digest:${userId}:${formatDate(new Date())}`

// Bad: Random key - no deduplication benefit
idempotency_key: uuidv4()

// Bad: No key - duplicate requests create duplicate messages
// (omitted)
```

## Handling Delivery Status

### Webhook Configuration

Configure your Twilio and Postmark accounts to send delivery status webhooks to:
- SMS: `https://your-domain/api/twilio/sms/status`
- Email: `https://your-domain/api/postmark/email/status`

### Status Flow

```
┌─────────┐   ┌────────┐   ┌─────────┐   ┌──────┐   ┌───────────┐
│ pending │──▶│ queued │──▶│ sending │──▶│ sent │──▶│ delivered │
└─────────┘   └────────┘   └─────────┘   └──────┘   └───────────┘
                                            │
                                            ├──▶ failed
                                            ├──▶ bounced
                                            └──▶ undelivered
```

### Querying Message Status

```typescript
// Get message by ID
const message = await fetch(`/api/messages/${message_id}`, {
  headers: { 'Authorization': `Bearer ${apiToken}` }
});

// Check delivery status
if (message.delivery_status === 'delivered') {
  console.log('Message delivered successfully');
} else if (message.delivery_status === 'bounced') {
  console.log('Permanent delivery failure - email may be invalid');
}
```

## Error Handling

### Retry Strategy

```typescript
async function sendWithRetry(endpoint, payload, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        return await response.json();
      }

      // Don't retry client errors
      if (response.status < 500) {
        throw new Error(`Client error: ${response.status}`);
      }

      // Retry server errors with exponential backoff
      if (attempt < maxRetries) {
        await sleep(Math.pow(2, attempt) * 1000);
      }
    } catch (error) {
      if (attempt === maxRetries) throw error;
      await sleep(Math.pow(2, attempt) * 1000);
    }
  }
}
```

### Common Error Codes

| Status | Cause | Action |
|--------|-------|--------|
| 400 | Invalid input | Check phone/email format, required fields |
| 401 | Auth failed | Check API token |
| 429 | Rate limited | Wait and retry with backoff |
| 500 | Server error | Retry with exponential backoff |

## Semantic Message Search

Messages are automatically embedded for semantic search. Use the unified search API:

```typescript
// Search messages by meaning
const results = await fetch('/api/search?' + new URLSearchParams({
  query: 'conversations about the renovation project',
  types: 'message',
  limit: '10'
}), {
  headers: { 'Authorization': `Bearer ${apiToken}` }
});

// Returns messages mentioning home improvement, contractors, etc.
```

### Search Modes

| Mode | Description |
|------|-------------|
| `keyword` | Traditional text matching |
| `semantic` | Vector similarity search |
| `hybrid` | Combined keyword + semantic (default) |

## Contact Endpoint Handling

### Bounce Handling

When a hard bounce occurs, the contact endpoint is automatically flagged:

```typescript
// Check if endpoint is bounced
const endpoint = await getContactEndpoint(endpointId);
if (endpoint.metadata?.bounced) {
  console.log(`Endpoint bounced: ${endpoint.metadata.bounce_type}`);
  // Consider alternative contact methods or manual intervention
}
```

### Best Practices

1. **Check bounce status** before sending to known endpoints
2. **Provide fallback** contact methods when primary fails
3. **Monitor bounce rates** to identify systematic issues
4. **Clean email lists** regularly based on bounce data

## Threading

Messages are automatically threaded by conversation.

### Listing Threads

```typescript
// List all threads, optionally filtered by channel or contact
const threads = await fetch('/api/threads?channel=sms&limit=20', {
  headers: { 'Authorization': `Bearer ${apiToken}` }
});
// Returns { threads: [...], total: N, pagination: { limit, offset, has_more } }
```

### Thread History

```typescript
// Get full thread with messages, related work items, and contact memories
const history = await fetch(`/api/threads/${thread_id}/history?limit=50`, {
  headers: { 'Authorization': `Bearer ${apiToken}` }
});
// Returns { thread, messages, related_work_items, contact_memories, pagination }
```

### Replying to Threads

```typescript
// Reply to existing thread
const response = await fetch('/api/postmark/email/send', {
  method: 'POST',
  headers: { /* ... */ },
  body: JSON.stringify({
    to: 'user@example.com',
    subject: 'Re: Order Confirmation',
    body: 'Your order has shipped!',
    thread_id: existingThreadId  // Links to existing conversation
  })
});
```

## Rate Limiting

Respect rate limits in your integration:

```typescript
class RateLimiter {
  private queue: Array<() => Promise<any>> = [];
  private processing = false;

  async add<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          resolve(await fn());
        } catch (e) {
          reject(e);
        }
      });
      this.process();
    });
  }

  private async process() {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const fn = this.queue.shift()!;
      await fn();
      await sleep(2000); // 30 req/min = 1 every 2 seconds
    }

    this.processing = false;
  }
}
```

## Security Considerations

1. **Never log** full message content - use truncation
2. **Sanitize** user input in message bodies
3. **Validate** phone numbers and email addresses
4. **Use HTTPS** for all API calls
5. **Rotate** API tokens regularly

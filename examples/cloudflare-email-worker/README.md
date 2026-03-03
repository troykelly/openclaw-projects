# Cloudflare Email Worker for openclaw-projects

A production-ready Cloudflare Email Worker that receives inbound emails via [Cloudflare Email Routing](https://developers.cloudflare.com/email-routing/) and forwards them to the openclaw-projects webhook API.

## How It Works

```
Inbound email
  → Cloudflare Email Routing
    → This Worker (parses MIME, extracts body/headers)
      → POST /api/cloudflare/email (openclaw-projects API)
        → Contact linking, thread management, agent routing
```

1. An email arrives at your domain (e.g. `support@yourdomain.com`)
2. Cloudflare Email Routing invokes this Worker
3. The Worker parses the raw MIME using [postal-mime](https://github.com/postalsys/postal-mime)
4. It POSTs a structured JSON payload to `POST /api/cloudflare/email`
5. openclaw-projects creates/links contacts, threads the message, and routes it to the appropriate OpenClaw agent

## Prerequisites

- A Cloudflare account with [Email Routing enabled](https://developers.cloudflare.com/email-routing/get-started/enable-email-routing/)
- A deployed openclaw-projects instance
- Node.js 20+ and pnpm

## Setup

```bash
# Install dependencies
pnpm install

# Set the shared secret (must match CLOUDFLARE_EMAIL_SECRET in openclaw-projects)
pnpm exec wrangler secret put CLOUDFLARE_EMAIL_SECRET

# Update OPENCLAW_PROJECTS_API_URL in wrangler.jsonc to point to your API

# Deploy
pnpm exec wrangler deploy
```

## Configure Email Routing

After deploying the Worker:

1. Go to the [Cloudflare dashboard](https://dash.cloudflare.com) → your domain → **Email Routing**
2. Under **Email Workers**, create a routing rule:
   - **Custom address**: e.g. `support@yourdomain.com`, or use catch-all (`*`)
   - **Action**: Send to a Worker → select `openclaw-email-worker`
3. Save the rule

Emails matching the rule will now be processed by this Worker.

## Configuration

### Environment Variables (wrangler.jsonc `"vars"`)

| Variable | Required | Default | Description |
|---|---|---|---|
| `OPENCLAW_PROJECTS_API_URL` | Yes | — | Base URL of the openclaw-projects API |
| `FALLBACK_FORWARD_ADDRESS` | No | — | Verified address to forward original email to |
| `INCLUDE_RAW_MIME` | No | `"false"` | Include full MIME in webhook payload |
| `MAX_RAW_BYTES` | No | `"26214400"` | Max email size in bytes (25 MiB) |

### Secrets (via `wrangler secret put`)

| Secret | Required | Description |
|---|---|---|
| `CLOUDFLARE_EMAIL_SECRET` | Yes | Shared secret for API authentication |

## Local Development

```bash
# Start local dev server
pnpm run dev

# Test with a sample email
curl -X POST 'http://localhost:8787/cdn-cgi/handler/email?from=sender@example.com&to=recipient@example.com' \
  -H 'Content-Type: message/rfc822' \
  -d $'From: Alice <sender@example.com>\r\nTo: recipient@example.com\r\nSubject: Test Email\r\nMessage-ID: <test-123@example.com>\r\nDate: Mon, 03 Mar 2026 10:00:00 +0000\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nHello from the test email!'
```

## Webhook Payload

The Worker sends this JSON to `POST /api/cloudflare/email`:

```json
{
  "from": "sender@example.com",
  "to": "support@yourdomain.com",
  "subject": "Re: Project update",
  "text_body": "Looks good, let's proceed.",
  "html_body": "<p>Looks good, let's proceed.</p>",
  "headers": {
    "message-id": "<abc123@example.com>",
    "in-reply-to": "<def456@yourdomain.com>",
    "references": "<def456@yourdomain.com>"
  },
  "timestamp": "2026-03-03T12:00:00.000Z"
}
```

The API responds with:

```json
{
  "contact_id": "uuid",
  "thread_id": "uuid",
  "message_id": "uuid"
}
```

## Environments

Uncomment the `[env.staging]` and `[env.production]` blocks in `wrangler.jsonc` to deploy per-environment:

```bash
pnpm run deploy:staging
pnpm run deploy:production
```

Each environment can have its own `OPENCLAW_PROJECTS_API_URL` and separate secrets.

## Observability

- **Console logs**: Structured logs with `[email-worker]` prefix, envelope addresses, timing
- **`wrangler tail`**: Stream live logs from the deployed Worker
- **Cloudflare dashboard**: Workers → Logs tab for historical logs

```bash
# Stream live logs
pnpm run tail
```

## Security Notes

- The shared secret authenticates the Worker to the API. The server performs timing-safe comparison.
- The `timestamp` field enables replay protection — the server rejects payloads older than 5 minutes.
- No email content or PII is logged. Only envelope addresses, subject lines, and processing metadata appear in logs.
- The optional `FALLBACK_FORWARD_ADDRESS` ensures emails aren't lost if the API is temporarily unreachable.

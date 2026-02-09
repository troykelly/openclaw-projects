# OpenClaw Integration Guide

This guide walks through deploying openclaw-projects and connecting it to an OpenClaw gateway, from zero to a working AI assistant with persistent memory and task management.

## Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Your Infrastructure                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────┐        ┌─────────────────┐        ┌────────────────┐  │
│  │                 │        │                 │        │                │  │
│  │  OpenClaw       │◄──────►│  openclaw-      │◄──────►│  PostgreSQL    │  │
│  │  Gateway        │  API   │  projects API   │   DB   │  + pgvector    │  │
│  │                 │        │                 │        │                │  │
│  └────────┬────────┘        └─────────────────┘        └────────────────┘  │
│           │                                                                 │
│           │ Channels                                                        │
│           ▼                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Telegram │ Discord │ Slack │ WhatsApp │ SMS │ Email │ CLI           │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

The openclaw-projects system provides:
- **Persistent memory** with semantic search (via pgvector embeddings)
- **Task management** (projects, epics, issues, todos)
- **Contact management** with multi-platform identity linking
- **Scheduled hooks** for reminders and notifications (via pg_cron)

## Prerequisites

Before starting, ensure you have:

- [ ] A server with Docker and Docker Compose v2
- [ ] A domain name with DNS pointing to your server
- [ ] DNS API credentials for ACME certificate automation (e.g., Cloudflare API token)
- [ ] An embedding provider API key (OpenAI, VoyageAI, or Gemini) for semantic search
- [ ] (Optional) Messaging platform credentials (Telegram bot token, Discord app, etc.)

## Step 1: Deploy the Backend

### Option A: Full Stack (Recommended)

Deploy everything together using `docker-compose.full.yml`:

```bash
# Clone the repository
git clone https://github.com/troykelly/openclaw-projects.git
cd openclaw-projects

# Create environment file
cp .env.example .env
```

Generate required secrets using the setup wizard:

```bash
./scripts/setup.sh
```

The script generates unique random secrets for each variable and writes them to `.env`. For CI or unattended environments, use `./scripts/setup.sh --non-interactive`.

Configure your domain and DNS provider:

```bash
# Add to .env
echo "DOMAIN=your-domain.com" >> .env
echo "ACME_EMAIL=admin@your-domain.com" >> .env
echo "CF_DNS_API_TOKEN=your-cloudflare-api-token" >> .env
```

Configure embedding provider:

```bash
# Choose one embedding provider
echo "EMBEDDING_PROVIDER=openai" >> .env
echo "OPENAI_API_KEY=sk-your-openai-key" >> .env
```

Configure at least one model provider:

```bash
# Add API key for the model you want to use
echo "ANTHROPIC_API_KEY=sk-ant-your-anthropic-key" >> .env
# Or: echo "OPENAI_API_KEY=sk-your-openai-key" >> .env
```

Start the full stack:

```bash
docker compose -f docker-compose.full.yml up -d
```

### Option B: Backend Only

If you already have an OpenClaw gateway running elsewhere, deploy only the backend:

```bash
# Use the Traefik compose for production with TLS
docker compose -f docker-compose.traefik.yml up -d

# Or use the basic compose for development/testing
docker compose up -d
```

## Step 2: Install the Plugin

On your OpenClaw gateway (skip if using full stack - it's pre-configured):

```bash
# Install from npm
openclaw plugins install @troykelly/openclaw-projects

# Or specify a specific version
openclaw plugins install @troykelly/openclaw-projects@0.0.3
```

## Step 3: Configure the Plugin

### Full Stack (docker-compose.full.yml)

The plugin is automatically configured via environment variables:
- `OPENCLAW_PROJECTS_API_URL`: Set to `http://api:3000` (internal Docker network)
- `OPENCLAW_PROJECTS_AUTH_SECRET`: Shared with the API container

### External Gateway

Add the plugin configuration to your OpenClaw config file:

```jsonc
// ~/.openclaw/config.json
{
  "plugins": {
    "slots": {
      // Set openclaw-projects as the memory provider
      "memory": "openclaw-projects"
    },
    "entries": {
      "openclaw-projects": {
        "enabled": true,
        "config": {
          // Your deployed API URL
          "apiUrl": "https://api.your-domain.com",
          // Authentication (choose one method)
          "apiKey": "your-shared-auth-secret",
          // Or load from file (for Docker secrets)
          // "apiKeyFile": "~/.secrets/openclaw-projects-api-key",
          // Or load from command (for 1Password, etc.)
          // "apiKeyCommand": "op read 'op://vault/openclaw-projects/api-key'"
        }
      }
    }
  }
}
```

Restart your gateway:

```bash
openclaw gateway restart
```

## Step 4: Verify the Integration

### Check Plugin Status

```bash
openclaw plugins list
```

You should see `openclaw-projects` listed as enabled.

### Test Memory Storage

Ask your agent to remember something:

```
You: Remember that my favorite color is blue.
Agent: I've stored that your favorite color is blue.
```

### Test Memory Recall

Start a new conversation and ask:

```
You: What's my favorite color?
Agent: Your favorite color is blue.
```

The agent should retrieve this from the memory system's semantic search.

### Test Work Items

```
You: Add "Buy groceries" to my shopping list.
Agent: I've added "Buy groceries" to your shopping list.
```

Check the web dashboard at `https://your-domain.com` to see the task.

## Troubleshooting

### Plugin not loading

```bash
# Check gateway logs
docker logs openclaw-gateway

# Verify plugin installation
openclaw plugins list --verbose
```

### Memory not being stored

```bash
# Check API health
curl https://api.your-domain.com/health

# Check database connection
docker exec openclaw-api node -e "require('./dist/db').pool.query('SELECT 1')"
```

### Semantic search returning no results

Ensure you've configured an embedding provider:

```bash
# Check environment
docker exec openclaw-api env | grep EMBEDDING

# Verify embeddings are being generated (check logs)
docker logs openclaw-api | grep -i embedding
```

### Authentication failures

```bash
# Verify the API key matches
docker exec openclaw-api env | grep OPENCLAW_PROJECTS_AUTH_SECRET
# Compare with your gateway config
```

### Connection refused

If the gateway can't reach the API:

```bash
# Test internal network connectivity (from gateway container)
docker exec openclaw-gateway wget -q -O - http://api:3000/health

# Check API is healthy
docker exec openclaw-api wget -q -O - http://localhost:3000/health
```

## Step 5: Use the Skill Store (Optional)

The Skill Store provides persistent, namespaced storage for skills that need to maintain state, cache data, or process content on a schedule.

### Store Data from a Skill

Skills use the `skill_store_put` tool to persist data:

```
skill_store_put({
  skill_id: "my-skill",
  collection: "config",
  key: "settings",
  data: { theme: "dark", language: "en" }
})
```

### Search Stored Content

Skills can search across their stored data using full-text or semantic search:

```
skill_store_search({
  skill_id: "my-skill",
  query: "configuration options",
  semantic: true
})
```

### Set Up Scheduled Processing

Create recurring schedules that fire webhooks to your gateway for periodic skill processing:

```bash
curl -X POST https://api.your-domain.com/api/skill-store/schedules \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "skill_id": "my-skill",
    "cron_expression": "0 9 * * *",
    "webhook_url": "https://gateway.your-domain.com/hooks/daily-process",
    "payload_template": { "action": "daily_digest" }
  }'
```

For full details, see the [Skill Store Developer Guide](./skill-store-guide.md).

## Next Steps

- **Explore the Dashboard**: Visit `https://your-domain.com` to manage tasks and view activity
- **Configure Channels**: Add Telegram, Discord, or other messaging platforms to your gateway
- **Set Up Reminders**: Use the `not_before` field on tasks to create reminders
- **Browse Contacts**: Link your contacts across platforms for unified identity
- **Build Skills with Persistent State**: Use the [Skill Store](./skill-store-guide.md) for skills that need to remember, search, and process data

## Reference

- [Deployment Guide](../deployment.md) - Full deployment options and configuration
- [Plugin README](../../packages/openclaw-plugin/README.md) - Plugin API reference
- [Skill Store API Reference](../api/skill-store.md) - Complete Skill Store endpoint documentation
- [Skill Store Developer Guide](./skill-store-guide.md) - Patterns and best practices for skill development
- [OpenClaw Documentation](https://docs.openclaw.ai/) - Gateway configuration

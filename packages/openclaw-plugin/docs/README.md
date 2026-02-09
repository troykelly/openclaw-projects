# OpenClaw Projects Plugin

Memory, projects, todos, contacts, and messaging for OpenClaw agents.

## Overview

The OpenClaw Projects Plugin provides a comprehensive suite of tools for OpenClaw agents to manage:

- **Persistent Memory** - Store and recall facts, preferences, and context with semantic search
- **Projects & Tasks** - Create and manage work items with hierarchical organization
- **Contacts** - Manage people and their communication endpoints
- **Messaging** - Send SMS (via Twilio) and email (via Postmark)

## Quick Start

### 1. Install the Plugin

```bash
openclaw plugins install @troykelly/openclaw-projects
```

### 2. Configure the Plugin

Create or edit your OpenClaw configuration to add the plugin:

```yaml
plugins:
  entries:
    openclaw-projects:
      enabled: true
      config:
        apiUrl: "https://api.your-backend.example.com"
        apiKeyFile: "~/.secrets/openclaw-api-key"
```

### 3. Verify Installation

The plugin will automatically register its tools. You can verify by asking your OpenClaw agent:

> "What tools do you have for managing tasks?"

## Features

### Memory System

Store and retrieve information using semantic search powered by pgvector:

```
Agent: I'll remember that you prefer dark mode.
[Uses memory_store tool]

Later...
Agent: Based on your preference for dark mode, I'll suggest the dark theme.
[Uses memory_recall tool]
```

### Project Management

Create and track projects, tasks, and todos:

- Hierarchical work items (Projects → Epics → Tasks → Todos)
- Due dates and priorities
- Status tracking (pending, in_progress, completed, blocked)

### Contact Management

Manage contacts and their communication endpoints:

- Multiple endpoints per contact (email, phone, Telegram, etc.)
- Automatic linking from inbound messages
- Contact search and lookup

### Messaging

Send messages through configured providers:

- **SMS**: Via Twilio with E.164 phone number validation
- **Email**: Via Postmark with subject and HTML support

## Documentation

- [Installation Guide](./installation.md)
- [Configuration Reference](./configuration.md)
- [Tool Reference](./tools.md)
- [Security Best Practices](./security.md)
- [Troubleshooting](./troubleshooting.md)

## Requirements

- Node.js 20+
- OpenClaw Gateway
- Backend API (openclaw-projects backend)
- Optional: Twilio account (for SMS)
- Optional: Postmark account (for email)

## License

MIT

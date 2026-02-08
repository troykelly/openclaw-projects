# @troykelly/openclaw-projects

An [OpenClaw](https://docs.openclaw.ai/) plugin that connects agents to the openclaw-projects backend for project management, memory, todos, contacts, and communications.

> **Note:** This is a third-party plugin — not part of OpenClaw itself. It provides OpenClaw agents with tools to interact with the [openclaw-projects](https://github.com/troykelly/openclaw-projects) backend service.

## Features

- **Memory Management**: Store, recall, and forget memories with semantic search (pgvector)
- **Project Management**: List, get, and create projects
- **Todo Management**: Manage todos with completion tracking
- **Contact Management**: Search, get, and create contacts with relationship mapping
- **Communications**: Send SMS (Twilio) and email (Postmark) directly from agents
- **Message History**: Search and browse message threads across channels
- **Skill Store**: Persist and query structured data for agent skills
- **Auto-Recall**: Automatically inject relevant context into conversations
- **Auto-Capture**: Capture important information from completed conversations
- **Bundled Skills**: 4 ready-to-use skills for common workflows

## Installation

### Via OpenClaw CLI (recommended)

```bash
openclaw plugins install @troykelly/openclaw-projects
```

Then configure the plugin in your OpenClaw config file (`~/.openclaw/config.yaml` or equivalent):

```yaml
plugins:
  entries:
    openclaw-projects:
      enabled: true
      config:
        apiUrl: https://your-backend.example.com
        apiKey: your-api-key
```

### Via npm (for programmatic use)

```bash
pnpm add @troykelly/openclaw-projects
```

This method is for integrating the plugin programmatically outside of the OpenClaw runtime. Most users should use the OpenClaw CLI method above.

## Verification

After installation, verify the plugin is loaded:

```bash
openclaw plugins info openclaw-projects
```

Check that the plugin is healthy and can reach the backend:

```bash
openclaw plugins doctor
```

## Configuration

Configure the plugin in your OpenClaw config file or pass config programmatically.

### Required Settings

| Option | Type | Description |
|--------|------|-------------|
| `apiUrl` | string | Backend API URL (must be HTTPS in production) |
| `apiKey` | string | API authentication key (direct value) |

You must provide the API key via one of three methods:

| Method | Config Key | Description |
|--------|-----------|-------------|
| Direct value | `apiKey` | Plaintext key (for development only) |
| File reference | `apiKeyFile` | Path to file containing key (e.g., `~/.secrets/api_key`) |
| Command | `apiKeyCommand` | Shell command to retrieve key (e.g., `op read op://Personal/openclaw/api_key`) |

### Optional Settings

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `autoRecall` | boolean | `true` | Inject relevant memories at conversation start |
| `autoCapture` | boolean | `true` | Capture important info from completed conversations |
| `userScoping` | string | `'agent'` | User scoping mode (`agent`, `session`, `identity`) |
| `maxRecallMemories` | number | `5` | Max memories to inject in auto-recall |
| `minRecallScore` | number | `0.7` | Minimum similarity score for auto-recall (0-1) |
| `timeout` | number | `30000` | API request timeout (ms) |
| `maxRetries` | number | `3` | Max retry attempts for failed requests |
| `debug` | boolean | `false` | Enable debug logging (never logs secrets) |

### Secret Management

All secret fields (API key, Twilio credentials, Postmark token) support three resolution methods. The plugin resolves secrets in priority order: command > file > direct value.

```yaml
plugins:
  entries:
    openclaw-projects:
      enabled: true
      config:
        apiUrl: https://your-backend.example.com
        # Option 1: Direct value (development only)
        apiKey: sk-dev-key-here
        # Option 2: File reference
        # apiKeyFile: ~/.secrets/openclaw-api-key
        # Option 3: Command (e.g., 1Password CLI)
        # apiKeyCommand: op read op://Personal/openclaw/api_key
```

### Twilio SMS (optional)

To enable SMS sending, add Twilio credentials using the same direct/file/command pattern:

```yaml
        twilioAccountSid: AC...
        twilioAuthToken: your-auth-token
        twilioPhoneNumber: "+15551234567"
```

### Postmark Email (optional)

To enable email sending, add Postmark credentials:

```yaml
        postmarkToken: your-postmark-token
        postmarkFromEmail: noreply@example.com
```

### User Scoping Modes

| Mode | Description | Use Case |
|------|-------------|----------|
| `agent` | Scope by agent ID | Single user per agent (default) |
| `session` | Scope by session key | Maximum isolation between sessions |
| `identity` | Scope by canonical identity | Shared identity across agents |

## Tools

The plugin registers 27 tools that agents can use. Tools are automatically available to any agent with the plugin enabled.

### Memory Tools

| Tool | Description |
|------|-------------|
| `memory_recall` | Search memories semantically by query |
| `memory_store` | Store a new memory (preference, fact, decision, context) |
| `memory_forget` | Delete memories by ID or search query |

### Project Tools

| Tool | Description |
|------|-------------|
| `project_list` | List projects with optional status filter |
| `project_get` | Get full details of a specific project |
| `project_create` | Create a new project |

### Todo Tools

| Tool | Description |
|------|-------------|
| `todo_list` | List todos, optionally filtered by project or status |
| `todo_create` | Create a new todo item |
| `todo_complete` | Mark a todo as complete |

### Contact Tools

| Tool | Description |
|------|-------------|
| `contact_search` | Search contacts by name, email, or other fields |
| `contact_get` | Get full details of a specific contact |
| `contact_create` | Create a new contact |

### Communication Tools

| Tool | Description |
|------|-------------|
| `sms_send` | Send an SMS message (requires Twilio config) |
| `email_send` | Send an email message (requires Postmark config) |
| `message_search` | Search message history semantically |
| `thread_list` | List message threads (conversations) |
| `thread_get` | Get a thread with full message history |

### Relationship Tools

| Tool | Description |
|------|-------------|
| `relationship_set` | Record a relationship between contacts |
| `relationship_query` | Query a contact's relationships |

### Skill Store Tools

| Tool | Description |
|------|-------------|
| `skill_store_put` | Store or update data in the skill store |
| `skill_store_get` | Retrieve an item by ID or composite key |
| `skill_store_list` | List items with filtering and pagination |
| `skill_store_delete` | Delete an item (soft delete) |
| `skill_store_search` | Search items by text or semantic similarity |
| `skill_store_collections` | List all collections with item counts |
| `skill_store_aggregate` | Run aggregations on skill store items |

### Other Tools

| Tool | Description |
|------|-------------|
| `file_share` | Generate a time-limited shareable download link |

## Skills

The plugin includes 4 bundled skills that agents can invoke as high-level workflows. Skills combine multiple tools to accomplish common tasks.

### `contact-lookup`

Look up contact information and recent communications.

```
/contact-lookup name="Alice Smith"
```

Searches contacts, retrieves details, shows recent messages, related projects/tasks, and stored memories about the person.

### `daily-summary`

Get a summary of today's tasks, messages, and activities.

```
/daily-summary
```

Shows tasks due today, recent messages, upcoming deadlines, and items requiring attention.

### `project-status`

Get a status overview of a specific project.

```
/project-status project="Home Renovation"
```

Shows project overview, task breakdown with completion percentage, recent activity, blockers, and recommended next steps.

### `send-reminder`

Send a reminder message to a contact via SMS or email.

```
/send-reminder contact="Alice" message="Don't forget the meeting tomorrow" channel="sms"
```

Looks up the contact, verifies their endpoint, sends the message, and confirms delivery.

## Lifecycle Hooks

### `before_agent_start` (Auto-Recall)

When `autoRecall` is enabled (default), the plugin automatically searches for relevant memories before each conversation. It uses the user's prompt for semantic search and injects matching memories as context via `prependContext`.

### `agent_end` (Auto-Capture)

When `autoCapture` is enabled (default), the plugin automatically analyzes completed conversations and stores important information (preferences, facts, decisions) as memories for future recall.

## Security

### Secret Management

- Use file references or command execution for secrets in production
- Direct values are for development only
- The plugin supports 1Password CLI, Vault, AWS Secrets Manager, or any command-line tool
- Secret files are checked for world-readable permissions (warns if `chmod 644`)

### Data Isolation

- All data is scoped to the configured user scope
- Cross-user access is prevented at the API level

### HTTPS

- HTTPS is required in production (`NODE_ENV=production`)
- HTTP is permitted for local development only

### Sensitive Content

- Secrets are never logged (config is redacted in logs)
- Error messages are sanitized to prevent information leakage

## Troubleshooting

### Plugin not loading

Verify the plugin is installed and the manifest is detected:

```bash
openclaw plugins info openclaw-projects
```

### Connection issues

Check that the backend API is reachable:

```bash
openclaw plugins doctor
```

### No memories found

- Verify the user scoping mode matches your setup
- Check that memories were stored for the same user scope
- Try broadening your search query

### API errors

- Verify `apiUrl` is correct and accessible
- Check that the API key is valid
- Review network connectivity

## Contributing

1. Fork the repository
2. Create a feature branch
3. Write tests for new functionality
4. Submit a pull request

## License

MIT

## Links

- [OpenClaw Documentation](https://docs.openclaw.ai/)
- [OpenClaw Plugin Guide](https://docs.openclaw.ai/plugins)
- [openclaw-projects Backend](https://github.com/troykelly/openclaw-projects)
- [Report Issues](https://github.com/troykelly/openclaw-projects/issues)

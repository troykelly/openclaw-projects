# @troykelly/openclaw-projects

An [OpenClaw](https://docs.openclaw.ai/) plugin that connects agents to the openclaw-projects backend for project management, memory, todos, contacts, and communications.

> **Note:** This is a third-party plugin — not part of OpenClaw itself. It provides OpenClaw agents with tools to interact with the [openclaw-projects](https://github.com/troykelly/openclaw-projects) backend service.

## Quickstart

Get from zero to a working plugin in under 5 minutes.

### 1. Deploy the backend

Clone the repository and run the setup wizard:

```bash
git clone https://github.com/troykelly/openclaw-projects.git
cd openclaw-projects
./scripts/setup.sh
```

The setup script generates a `.env` file with random secrets and sensible defaults. For CI or unattended setup, use `./scripts/setup.sh --non-interactive`.

### 2. Start services

```bash
docker compose -f docker-compose.quickstart.yml up -d
```

Wait for all services to become healthy (this may take 30-60 seconds on first run):

```bash
docker compose -f docker-compose.quickstart.yml ps
```

Expected output:

```
NAME                  STATUS
openclaw-qs-db        running (healthy)
openclaw-qs-seaweedfs running (healthy)
openclaw-qs-migrate   exited (0)
openclaw-qs-api       running (healthy)
```

### 3. Verify the API is running

```bash
curl http://localhost:3000/health
```

Expected output:

```json
{"status":"ok"}
```

### 4. Install the plugin

```bash
openclaw plugins install @troykelly/openclaw-projects
```

### 5. Configure the plugin

Add to your OpenClaw config (`~/.openclaw/config.yaml`):

```yaml
plugins:
  entries:
    openclaw-projects:
      enabled: true
      config:
        apiUrl: http://localhost:3000
```

The quickstart compose disables authentication by default, so no `apiKey` is needed. When you later switch to a production compose file with auth enabled, add `apiKey` with the `OPENCLAW_API_TOKEN` value from your `.env` file. See [Configuration](#configuration) for details.

### 6. Verify the connection

```bash
openclaw openclaw-projects status
```

Expected output when healthy:

```
openclaw-projects status:
  API URL:    http://localhost:3000
  Status:     healthy
  Auth:       valid
  Latency:    12ms
```

If the status shows unhealthy, see [Troubleshooting](#troubleshooting) below.

### Next steps

- See [Configuration](#configuration) for optional settings (embedding providers, SMS, email)
- See [Tools](#tools) for the 27 available agent tools
- See [Which compose file?](#which-compose-file) to choose the right deployment for your needs
- For the detailed installation guide, see [docs/installation.md](docs/installation.md)

### Which compose file?

| File | Auth | Use case |
|------|------|----------|
| `docker-compose.quickstart.yml` | Disabled | Local development and testing (recommended for getting started) |
| `docker-compose.yml` | Enabled | Basic production deployment without TLS |
| `docker-compose.traefik.yml` | Enabled | Production with automatic TLS, HTTP/3, and WAF |
| `docker-compose.full.yml` | Enabled | All services including frontend and optional integrations |
| `docker-compose.test.yml` | Disabled | CI and automated testing |

Start with `docker-compose.quickstart.yml`. When you are ready for production, switch to `docker-compose.yml` or `docker-compose.traefik.yml` and configure your `apiKey` in the plugin config.

### Moving to Production

When you're ready to move from the quickstart to a production setup:

1. Stop the quickstart services: `docker compose -f docker-compose.quickstart.yml down`
2. Open your `.env` file and find the `OPENCLAW_API_TOKEN` value
3. Set `OPENCLAW_PROJECTS_AUTH_DISABLED=false` in your `.env`
4. Add the API key to your OpenClaw plugin config:
   ```yaml
   plugins:
     entries:
       openclaw-projects:
         config:
           apiUrl: https://your-domain.example.com
           apiKey: your-OPENCLAW_API_TOKEN-value
   ```
5. Switch to a production compose file: `docker compose -f docker-compose.yml up -d`

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

### Health Check (status command)

The plugin includes a built-in health check that verifies API connectivity, authentication, and reports latency:

```bash
openclaw openclaw-projects status
```

**Healthy output:**

```
openclaw-projects status:
  API URL:    http://localhost:3000
  Status:     healthy
  Auth:       valid
  Latency:    12ms
```

**Unhealthy output (backend unreachable):**

```
openclaw-projects status:
  API URL:    http://localhost:3000
  Status:     unhealthy
  Error:      Connection refused (ECONNREFUSED)
```

**Unhealthy output (authentication failure):**

```
openclaw-projects status:
  API URL:    http://localhost:3000
  Status:     unhealthy
  Auth:       invalid (401 Unauthorized)
  Latency:    8ms
```

The status command checks:
- **API connectivity** -- can the plugin reach the backend URL?
- **Authentication** -- is the API key valid and accepted?
- **Response time** -- how long does the health check take (latency in ms)?

Use this command as the first diagnostic step when tools fail or behave unexpectedly.

You can also use the general plugin doctor command:

```bash
openclaw plugins doctor
```

## Configuration

Configure the plugin in your OpenClaw config file or pass config programmatically.

### Required Settings

| Option | Type | Description |
|--------|------|-------------|
| `apiUrl` | string | Backend API URL (must be HTTPS in production) |

### Authentication (Optional)

When your backend has authentication enabled, provide the API key via one of three methods. If your backend has auth disabled (e.g., the quickstart compose), no API key is needed.

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
| `agent` | Scope by agent ID; single user per agent | Personal assistant (default) |
| `session` | Scope by session key; maximum isolation | Sensitive operations |
| `identity` | Scope by canonical user identity across agents and sessions | Multi-agent setups, shared identity |

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

> **First step for any issue:** Run `openclaw openclaw-projects status` to check connectivity, authentication, and latency. See [Health Check](#health-check-status-command) above for expected output.

### Plugin not loading

Verify the plugin is installed and the manifest is detected:

```bash
openclaw plugins info openclaw-projects
```

### Connection issues

Run the status command to diagnose:

```bash
openclaw openclaw-projects status
```

If the status shows unhealthy, check:
- Is the backend running? `curl http://localhost:3000/health`
- Is the `apiUrl` in your config correct?
- Are there firewall rules blocking the connection?

For detailed troubleshooting, see [docs/troubleshooting.md](docs/troubleshooting.md).

### Authentication failures

If the status command reports `Auth: invalid`:
- Verify your `apiKey` matches the `OPENCLAW_API_TOKEN` in the backend `.env`
- Check the secret retrieval method (file, command) is working
- If using the quickstart compose, auth is disabled by default (`OPENCLAW_PROJECTS_AUTH_DISABLED=true`). If you have overridden this to `false` (enabling auth), ensure your `apiKey` is correctly configured

### No memories found

- Verify the user scoping mode matches your setup
- Check that memories were stored for the same user scope
- Try broadening your search query

### API errors

- Run `openclaw openclaw-projects status` to verify connectivity
- Check that the API key is valid
- Review network connectivity
- Enable debug logging (`debug: true` in config) for detailed request/response info

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

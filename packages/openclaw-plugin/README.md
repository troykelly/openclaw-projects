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
- See [Tools](#tools) for the 97 available agent tools
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
- **Project Management**: List, get, create, and search projects
- **Todo Management**: Manage todos with completion tracking and search
- **Contact Management**: Search, get, create, update, merge, tag, and resolve contacts with relationship mapping
- **Communications**: Send SMS (Twilio) and email (Postmark) directly from agents
- **Message History**: Search and browse message threads across channels
- **Notes and Notebooks**: Create, update, search, and organize notes in notebooks
- **Entity Links**: Link any entities together (contacts, projects, notes, etc.)
- **Terminal Management**: Create and manage SSH connections, sessions, tunnels, and credentials
- **Dev Sessions**: Track development sessions with linked issues and completion reports
- **API Onboarding**: Register external APIs, manage credentials, and search indexed endpoints
- **Namespace Management**: Create namespaces, manage members, and control access
- **Prompt Templates**: Create and manage reusable prompt templates
- **Inbound Routing**: Configure how inbound messages are routed to agents
- **Channel Defaults**: Set default agent and template per communication channel
- **Skill Store**: Persist and query structured data for agent skills
- **Context Search**: Cross-entity semantic search across memories, projects, and more
- **Tool Discovery**: `tool_guide` meta-tool for on-demand usage guidance
- **Auto-Recall**: Graph-aware memory injection with `minRecallScore` threshold
- **Auto-Capture**: Capture important information from completed conversations
- **Bundled Skills**: 11 ready-to-use skills for common multi-tool workflows

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

The plugin registers 97 tools that agents can use. Core tools are always available; optional tool groups can be enabled per-agent.

### Memory Tools (3)

| Tool | Description |
|------|-------------|
| `memory_recall` | Search memories by semantic similarity and optional filters |
| `memory_store` | Store a new memory (preference, fact, decision, context) |
| `memory_forget` | Delete memories by ID or search query |

### Project Tools (4)

| Tool | Description |
|------|-------------|
| `project_list` | List projects with optional status filter |
| `project_get` | Get full details of a specific project |
| `project_create` | Create a new project |
| `project_search` | Search projects by natural language query |

### Todo Tools (4)

| Tool | Description |
|------|-------------|
| `todo_list` | List todos, optionally filtered by project or status |
| `todo_create` | Create a new todo item |
| `todo_complete` | Mark a todo as complete |
| `todo_search` | Search todos by text query |

### Contact Tools (8)

| Tool | Description |
|------|-------------|
| `contact_search` | Search contacts by name, email, or other fields |
| `contact_get` | Get full details of a specific contact |
| `contact_create` | Create a new contact |
| `contact_update` | Update an existing contact's details |
| `contact_merge` | Merge duplicate contacts into one |
| `contact_tag_add` | Add a tag to a contact |
| `contact_tag_remove` | Remove a tag from a contact |
| `contact_resolve` | Resolve a contact by endpoint (email, phone, etc.) |

### Communication Tools (5)

| Tool | Description |
|------|-------------|
| `sms_send` | Send an SMS message (requires Twilio config) |
| `email_send` | Send an email message (requires Postmark config) |
| `message_search` | Search message history semantically |
| `thread_list` | List message threads (conversations) |
| `thread_get` | Get a thread with full message history |

### Relationship Tools (2)

| Tool | Description |
|------|-------------|
| `relationship_set` | Record a relationship between contacts |
| `relationship_query` | Query a contact's relationships |

### Note Tools (5)

| Tool | Description |
|------|-------------|
| `note_create` | Create a new note in a notebook |
| `note_get` | Get a note by ID |
| `note_update` | Update a note's title or content |
| `note_delete` | Delete a note |
| `note_search` | Search notes by text query |

### Notebook Tools (3)

| Tool | Description |
|------|-------------|
| `notebook_list` | List all notebooks |
| `notebook_create` | Create a new notebook |
| `notebook_get` | Get a notebook by ID with its notes |

### Entity Link Tools (3)

| Tool | Description |
|------|-------------|
| `links_set` | Create a link between two entities |
| `links_query` | Query links for an entity |
| `links_remove` | Remove a link between entities |

### Terminal Connection Tools (8)

| Tool | Description |
|------|-------------|
| `terminal_connection_list` | List saved terminal connections |
| `terminal_connection_create` | Create a new terminal connection definition |
| `terminal_connection_update` | Update a terminal connection |
| `terminal_connection_delete` | Delete a terminal connection |
| `terminal_connection_test` | Test connectivity for a terminal connection |
| `terminal_credential_create` | Create a terminal credential (SSH key, password) |
| `terminal_credential_list` | List saved terminal credentials |
| `terminal_credential_delete` | Delete a terminal credential |

### Terminal Session Tools (7)

| Tool | Description |
|------|-------------|
| `terminal_session_start` | Start a new terminal session on a connection |
| `terminal_session_list` | List active terminal sessions |
| `terminal_session_terminate` | Terminate a terminal session |
| `terminal_session_info` | Get detailed info about a terminal session |
| `terminal_send_command` | Send a command to a terminal session |
| `terminal_send_keys` | Send raw keystrokes to a terminal session |
| `terminal_capture_pane` | Capture the current terminal pane content |

### Terminal Tunnel Tools (3)

| Tool | Description |
|------|-------------|
| `terminal_tunnel_create` | Create an SSH tunnel (port forward) |
| `terminal_tunnel_list` | List active tunnels |
| `terminal_tunnel_close` | Close a tunnel |

### Terminal Search Tools (2)

| Tool | Description |
|------|-------------|
| `terminal_search` | Search terminal session history and output |
| `terminal_annotate` | Add annotations to terminal sessions |

### Dev Session Tools (5)

| Tool | Description |
|------|-------------|
| `dev_session_create` | Create a new dev session |
| `dev_session_list` | List dev sessions |
| `dev_session_get` | Get detailed info about a dev session |
| `dev_session_update` | Update a dev session |
| `dev_session_complete` | Mark a dev session as complete with summary |

### API Management Tools (9)

| Tool | Description |
|------|-------------|
| `api_onboard` | Onboard a new external API from an OpenAPI spec |
| `api_recall` | Search onboarded APIs by natural language query |
| `api_get` | Get details of a specific onboarded API |
| `api_list` | List all onboarded APIs |
| `api_update` | Update an onboarded API's configuration |
| `api_credential_manage` | Manage credentials for an onboarded API |
| `api_refresh` | Refresh an API's indexed endpoints |
| `api_remove` | Remove (soft-delete) an onboarded API |
| `api_restore` | Restore a previously removed API |

### Prompt Template Tools (5)

| Tool | Description |
|------|-------------|
| `prompt_template_list` | List all prompt templates |
| `prompt_template_get` | Get a prompt template by name |
| `prompt_template_create` | Create a new prompt template |
| `prompt_template_update` | Update an existing prompt template |
| `prompt_template_delete` | Delete a prompt template |

### Inbound Routing Tools (3)

| Tool | Description |
|------|-------------|
| `inbound_destination_list` | List inbound routing destinations |
| `inbound_destination_get` | Get details of a routing destination |
| `inbound_destination_update` | Update routing destination config |

### Channel Default Tools (3)

| Tool | Description |
|------|-------------|
| `channel_default_list` | List channel default configurations |
| `channel_default_get` | Get defaults for a specific channel |
| `channel_default_set` | Set default agent and template for a channel |

### Namespace Tools (5)

| Tool | Description |
|------|-------------|
| `namespace_list` | List available namespaces |
| `namespace_create` | Create a new namespace |
| `namespace_grant` | Grant access to a namespace |
| `namespace_members` | List members of a namespace |
| `namespace_revoke` | Revoke access from a namespace |

### Skill Store Tools (7)

| Tool | Description |
|------|-------------|
| `skill_store_put` | Store or update data in the skill store |
| `skill_store_get` | Retrieve an item by ID or composite key |
| `skill_store_list` | List items with filtering and pagination |
| `skill_store_delete` | Delete an item (soft delete) |
| `skill_store_search` | Search items by text or semantic similarity |
| `skill_store_collections` | List all collections with item counts |
| `skill_store_aggregate` | Run aggregations on skill store items |

### Search and Discovery Tools (2)

| Tool | Description |
|------|-------------|
| `context_search` | Cross-entity semantic search across memories, projects, contacts, and more |
| `tool_guide` | Get on-demand usage guidance for tools, groups, or task-based recommendations |

### Other Tools (1)

| Tool | Description |
|------|-------------|
| `file_share` | Generate a time-limited shareable download link |

### Optional Tool Groups

Many tools are organized into optional groups that can be enabled or disabled per-agent. Core tools (memory, project, todo, contact, search) are always available.

| Group | Tools | Count |
|-------|-------|-------|
| `terminal_connections` | terminal_connection_*, terminal_credential_* | 8 |
| `terminal_sessions` | terminal_session_*, terminal_send_*, terminal_capture_* | 7 |
| `terminal_tunnels` | terminal_tunnel_* | 3 |
| `terminal_search` | terminal_search, terminal_annotate | 2 |
| `api_management` | api_* | 9 |
| `dev_sessions` | dev_session_* | 5 |
| `outbound_comms` | sms_send, email_send | 2 |
| `prompt_templates` | prompt_template_* | 5 |
| `inbound_routing` | inbound_destination_* | 3 |
| `channel_defaults` | channel_default_* | 3 |
| `namespaces` | namespace_* | 5 |
| `notes` | note_* | 5 |
| `notebooks` | notebook_* | 3 |
| `file_share` | file_share | 1 |

## Skills

The plugin includes 11 bundled skills that agents can invoke as high-level workflows. Skills combine multiple tools to accomplish common tasks.

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

### `terminal-setup`

Set up a new terminal connection with credentials and verification.

```
/terminal-setup host="server.example.com" label="Production"
```

Creates credentials, configures the connection, tests connectivity, and confirms setup.

### `api-integration`

Onboard a new external API, configure credentials, and verify endpoints.

```
/api-integration name="Stripe API"
```

Registers the API, configures authentication, verifies discoverability, and refreshes the index.

### `dev-session-report`

Generate a summary report for a completed dev session.

```
/dev-session-report session_id="550e8400-e29b-41d4-a716-446655440000"
```

Retrieves session details, gathers related work items, adds project context, and compiles a structured report.

### `note-meeting`

Create meeting notes with attendees, action items, and linked references.

```
/note-meeting title="Q1 Planning"
```

Creates a note, identifies attendees as contacts, extracts action items as todos, and links everything together.

### `namespace-audit`

Audit namespace content by searching across projects, memories, and items.

```
/namespace-audit namespace="team-alpha"
```

Searches namespace content, reviews projects, checks stored memories, and presents an audit summary with cleanup recommendations.

### `contact-relationship-map`

Build a comprehensive view of a contact with relationships, links, and memories.

```
/contact-relationship-map name="Alice Smith"
```

Retrieves contact details, maps relationships, finds linked items, recalls stored memories, and presents a unified relationship map.

### `weekly-review`

Comprehensive weekly review of projects, tasks, communications, and sessions.

```
/weekly-review
```

Reviews project progress, open/completed tasks, recent messages, dev sessions, and notes. Presents wins, blockers, and priorities for the coming week.

## Lifecycle Hooks

### `before_agent_start` (Auto-Recall)

When `autoRecall` is enabled (default), the plugin performs graph-aware memory recall before each conversation:

- **Semantic search**: Uses the user's prompt to find relevant memories via pgvector similarity
- **Relationship graph traversal**: Walks the user's relationship graph to retrieve context from connected namespaces and scopes
- **`minRecallScore` threshold**: Only memories scoring above the configured threshold (default `0.7`) are included, preventing low-relevance noise
- **Boundary wrapping**: Injected context is wrapped with clear boundary markers for prompt injection protection
- **Graceful fallback**: If the graph-aware endpoint is unavailable, falls back to basic memory search

Matching memories are injected via `prependContext` so they appear at the start of the conversation.

### `agent_end` (Auto-Capture)

When `autoCapture` is enabled (default), the plugin automatically analyzes completed conversations and stores important information (preferences, facts, decisions) as memories for future recall. Sensitive content is filtered before storage.

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

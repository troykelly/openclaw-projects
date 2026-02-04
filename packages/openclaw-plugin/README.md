# @troykelly/openclaw-projects

An [OpenClaw](https://docs.openclaw.ai/) plugin that connects agents to the openclaw-projects backend for project management, memory, todos, and contacts.

> **Note:** This is a third-party plugin — not part of OpenClaw itself. It provides OpenClaw agents with tools to interact with the [openclaw-projects](https://github.com/troykelly/openclaw-projects) backend service.

## Features

- **Memory Management**: Store, recall, and forget memories with semantic search
- **Project Management**: List, get, and create projects
- **Todo Management**: Manage todos with completion tracking
- **Contact Management**: Search, get, and create contacts
- **Auto-Recall**: Automatically inject relevant context into conversations
- **Auto-Capture**: Capture important information from completed conversations
- **CLI Commands**: Debug and manage the plugin from the command line
- **Multi-User Support**: Flexible user scoping (agent, session, identity)

## Installation

```bash
pnpm add @troykelly/openclaw-projects
```

## Quick Start

```typescript
import { register } from '@troykelly/openclaw-projects'

const plugin = register({
  config: {
    apiUrl: 'https://your-backend.example.com',
    apiKey: process.env.OPENCLAW_API_KEY,
  },
})

// Use tools
const result = await plugin.tools.memoryRecall.execute({
  query: 'user preferences',
})
```

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiUrl` | string | **required** | Backend API URL |
| `apiKey` | string | **required** | API authentication key |
| `autoRecall` | boolean | `true` | Enable auto-recall hook |
| `autoCapture` | boolean | `true` | Enable auto-capture hook |
| `userScoping` | string | `'agent'` | User scoping mode |
| `maxRecallMemories` | number | `5` | Max memories to return |
| `minRecallScore` | number | `0.7` | Minimum similarity score |
| `timeout` | number | `30000` | API timeout (ms) |
| `maxRetries` | number | `3` | Max retry attempts |
| `debug` | boolean | `false` | Enable debug logging |

### User Scoping Modes

| Mode | Description | Use Case |
|------|-------------|----------|
| `agent` | Scope by agent ID | Single user per agent |
| `session` | Scope by session key | Maximum isolation |
| `identity` | Scope by canonical identity | Shared identity across agents |

### Environment Variables

```bash
OPENCLAW_API_URL=https://your-backend.example.com
OPENCLAW_API_KEY=your-api-key
```

## Tools

### Memory Tools

#### `memory_recall`
Search memories semantically.

```typescript
const result = await plugin.tools.memoryRecall.execute({
  query: 'user preferences for notifications',
  limit: 10,           // optional, default: 5
  category: 'preference', // optional filter
})
```

#### `memory_store`
Save information to long-term memory.

```typescript
const result = await plugin.tools.memoryStore.execute({
  text: 'User prefers dark mode',
  category: 'preference', // preference, fact, decision, context, other
  importance: 0.8,        // optional, 0-1
})
```

#### `memory_forget`
Delete memories (GDPR data portability).

```typescript
// By ID
const result = await plugin.tools.memoryForget.execute({
  memoryId: '123e4567-e89b-12d3-a456-426614174000',
})

// By query (bulk delete)
const result = await plugin.tools.memoryForget.execute({
  query: 'outdated preferences',
  confirm: true, // required for bulk delete
})
```

### Project Tools

#### `project_list`
List projects with optional filtering.

```typescript
const result = await plugin.tools.projectList.execute({
  status: 'active', // optional: active, completed, archived, on_hold
  limit: 20,        // optional
})
```

#### `project_get`
Get a specific project by ID.

```typescript
const result = await plugin.tools.projectGet.execute({
  id: '123e4567-e89b-12d3-a456-426614174000',
})
```

#### `project_create`
Create a new project.

```typescript
const result = await plugin.tools.projectCreate.execute({
  name: 'Home Renovation',
  description: 'Kitchen remodel project', // optional
  status: 'active', // optional
})
```

### Todo Tools

#### `todo_list`
List todos with optional filtering.

```typescript
const result = await plugin.tools.todoList.execute({
  projectId: '123e4567-e89b-12d3-a456-426614174000', // optional
  completed: false, // optional
  limit: 50,        // optional
})
```

#### `todo_create`
Create a new todo.

```typescript
const result = await plugin.tools.todoCreate.execute({
  title: 'Buy groceries',
  projectId: '123e4567-e89b-12d3-a456-426614174000', // optional
  dueDate: '2024-01-15', // optional, ISO 8601
})
```

#### `todo_complete`
Mark a todo as complete.

```typescript
const result = await plugin.tools.todoComplete.execute({
  id: '123e4567-e89b-12d3-a456-426614174000',
})
```

### Contact Tools

#### `contact_search`
Search contacts.

```typescript
const result = await plugin.tools.contactSearch.execute({
  query: 'Alice',
  limit: 10, // optional
})
```

#### `contact_get`
Get a specific contact by ID.

```typescript
const result = await plugin.tools.contactGet.execute({
  id: '123e4567-e89b-12d3-a456-426614174000',
})
```

#### `contact_create`
Create a new contact.

```typescript
const result = await plugin.tools.contactCreate.execute({
  name: 'Alice Smith',
  email: 'alice@example.com', // optional
  phone: '+1-555-123-4567',   // optional
})
```

## Lifecycle Hooks

### `beforeAgentStart` (Auto-Recall)

Automatically fetches relevant context before the agent processes a prompt.

```typescript
const context = await plugin.hooks.beforeAgentStart({
  prompt: 'What are my notification preferences?',
})

if (context) {
  // Prepend context.prependContext to the conversation
}
```

### `agentEnd` (Auto-Capture)

Automatically captures important information after a conversation ends.

```typescript
await plugin.hooks.agentEnd({
  messages: [
    { role: 'user', content: 'Remember I prefer email notifications' },
    { role: 'assistant', content: 'Noted! I will remember your preference.' },
  ],
})
```

## CLI Commands

The plugin provides CLI command handlers that can be registered with OpenClaw:

### `status`
Check API connectivity.

```typescript
const result = await plugin.cli.status()
// { success: true, message: 'API is healthy (latency: 50ms)', data: { ... } }
```

### `users`
Show user scoping configuration.

```typescript
const result = await plugin.cli.users()
// { success: true, data: { scopingMode: 'agent', description: '...', currentUserId: '...' } }
```

### `recall`
Search memories from CLI.

```typescript
const result = await plugin.cli.recall({ query: 'preferences', limit: 10 })
// { success: true, data: { memories: [...], query: '...', limit: 10 } }
```

### `stats`
Show memory statistics.

```typescript
const result = await plugin.cli.stats()
// { success: true, data: { totalMemories: 42, byCategory: { ... } } }
```

### `export`
Export all memories (GDPR data portability).

```typescript
const result = await plugin.cli.export({ output: '/path/to/export.json' })
// { success: true, data: { memories: [...], exportedAt: '...', userId: '...' } }
```

## Health Check

```typescript
const health = await plugin.healthCheck()
if (!health.healthy) {
  console.error('Plugin unhealthy:', health.error)
}
```

## Security

### API Key Management

- Store API keys in environment variables, never in code
- Use secrets management in production (Vault, AWS Secrets Manager, etc.)
- Rotate keys regularly

### Data Isolation

- All data is scoped to the configured user scope
- Cross-user access is prevented at the API level
- Audit logs track all data access

### Sensitive Content

- The plugin filters sensitive content (API keys, passwords, credit cards)
- PII is not logged at info level
- Error messages are sanitized to prevent information leakage

### HTTPS

- Use HTTPS in production
- HTTP is only recommended for local development

## Error Handling

All tool executions return a result object:

```typescript
interface ToolResult {
  success: boolean
  content?: string   // Human-readable response
  data?: unknown     // Structured data
  error?: string     // Error message if success is false
}
```

## Troubleshooting

### Connection Issues

```typescript
// Check health
const health = await plugin.healthCheck()
console.log('Healthy:', health.healthy, 'Error:', health.error)

// Check status via CLI
const status = await plugin.cli.status()
console.log('Status:', status.message, 'Latency:', status.data?.latencyMs)
```

### No Memories Found

- Verify the user scoping mode matches your setup
- Check that memories were stored for the same user scope
- Try broadening your search query

### API Errors

- Verify API URL is correct and accessible
- Check API key is valid
- Review network connectivity

## API Reference

Full TypeScript types are exported:

```typescript
import type {
  PluginConfig,
  PluginInstance,
  MemoryRecallParams,
  MemoryStoreParams,
  ProjectListParams,
  TodoCreateParams,
  ContactSearchParams,
  // ... and more
} from '@troykelly/openclaw-projects'
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Write tests for new functionality
4. Submit a pull request

## License

MIT

## Links

- [OpenClaw Documentation](https://docs.openclaw.ai/)
- [openclaw-projects Backend](https://github.com/troykelly/openclaw-projects)
- [Report Issues](https://github.com/troykelly/openclaw-projects/issues)

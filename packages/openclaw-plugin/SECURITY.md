# Security Policy

## Reporting Security Issues

If you discover a security vulnerability in this project, please report it responsibly:

1. **Do not** open a public GitHub issue
2. Email security concerns to: security@troykelly.com
3. Include a detailed description of the vulnerability
4. Provide steps to reproduce if possible

### Expected Response Time

- **Acknowledgment**: Within 48 hours
- **Initial assessment**: Within 7 days
- **Resolution timeline**: Provided after assessment

## Security Best Practices

### API Key Management

```typescript
// DO: Use environment variables
const plugin = register({
  config: {
    apiUrl: process.env.OPENCLAW_API_URL,
    apiKey: process.env.OPENCLAW_API_KEY,
  },
})

// DON'T: Hardcode credentials
const plugin = register({
  config: {
    apiUrl: 'https://api.example.com',
    apiKey: 'sk-1234567890abcdef', // Never do this!
  },
})
```

### Production Configuration

- **Always use HTTPS** for API URLs in production
- Store API keys in a secrets manager (Vault, AWS Secrets Manager, etc.)
- Rotate API keys regularly
- Use the minimum required permissions

### User Data Isolation

The plugin enforces user isolation through scoping:

| Mode | Isolation Level | Description |
|------|-----------------|-------------|
| `agent` | Per-agent | Data isolated by agent ID |
| `session` | Per-session | Strictest isolation, each session separate |
| `identity` | Per-identity | Shared across agents for same identity |

### PII Handling

The plugin implements the following PII protections:

1. **Contact details** (email, phone) are not logged at info level
2. **Memory content** is not logged during storage
3. **Search queries** are logged by length only, not content
4. **Error messages** are sanitized to remove internal details

### Sensitive Content Filtering

The auto-capture hook filters content matching these patterns:

- Passwords and secrets (`password: xxx`, `secret: xxx`)
- API keys (`sk-xxx`, `api_key: xxx`)
- Credit card numbers (16 digit patterns)
- Social Security Numbers (XXX-XX-XXXX format)

## Threat Model

### Trust Boundaries

```
┌─────────────────────────────────────────────────────────────┐
│                      User Device                            │
│  ┌─────────────────┐      ┌──────────────────────┐         │
│  │   OpenClaw      │      │     Plugin           │         │
│  │   Agent         │◄────►│  @troykelly/         │         │
│  │                 │      │  openclaw-projects   │         │
│  └─────────────────┘      └──────────┬───────────┘         │
└────────────────────────────────────────│─────────────────────┘
                                         │ HTTPS
                                         │ Bearer Auth
                                         ▼
┌─────────────────────────────────────────────────────────────┐
│                  clawdbot-projects Backend                  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │                   API Layer                          │  │
│  │  - Authentication (API Key)                          │  │
│  │  - Authorization (User Scoping)                      │  │
│  │  - Input Validation                                  │  │
│  │  - Rate Limiting                                     │  │
│  └────────────────────────┬─────────────────────────────┘  │
│                           │                                 │
│  ┌────────────────────────▼─────────────────────────────┐  │
│  │                  Database (PostgreSQL)               │  │
│  │  - Row-level security                                │  │
│  │  - Encrypted at rest                                 │  │
│  │  - User-scoped queries                               │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow

1. **Agent → Plugin**: Tool parameters (queries, content)
2. **Plugin → Backend**: Authenticated API requests with user context
3. **Backend → Plugin**: Scoped data responses
4. **Plugin → Agent**: Formatted tool results

### Known Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| API key exposure | Unauthorized access | Environment variables, secrets manager |
| Cross-user data access | Privacy breach | Row-level security, user scoping |
| Injection attacks | Data corruption | Input validation, parameterized queries |
| Content exfiltration | Data leak | Sensitive pattern filtering |
| Man-in-the-middle | Data interception | HTTPS enforcement |

## Input Validation

All inputs are validated against Zod schemas:

### String Inputs
- Maximum length enforced
- Control characters stripped
- Null bytes removed

### ID Parameters
- UUID format validation (`/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`)

### Date Parameters
- ISO 8601 format required (`YYYY-MM-DD`)

### Email/Phone
- Format validation applied
- Not logged at info level

## Audit Logging

The plugin logs the following events (without content):

- Tool invocations (tool name, user ID, parameter lengths)
- API errors (status, error code)
- Auto-recall/capture invocations (user ID, message count)
- CLI command executions

## Dependencies

Keep dependencies updated to address security vulnerabilities:

```bash
pnpm audit
pnpm update
```

## Security Testing

The test suite includes security-focused tests:

- SQL injection payloads
- XSS payloads
- Malformed UUID handling
- Oversized input handling
- Credential exposure checks
- Error message sanitization

Run security tests:

```bash
pnpm test tests/security.test.ts
```

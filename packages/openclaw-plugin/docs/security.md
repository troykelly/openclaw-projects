# Security Best Practices

This document outlines security recommendations for deploying and using the OpenClaw Projects Plugin.

## Secret Management

### Never Store Secrets in Configuration Files

Direct secret values in configuration files are a security risk:

```yaml
# BAD - Never do this in production
plugins:
  entries:
    openclaw-projects:
      config:
        apiKey: "sk-abc123..."
```

### Use Secret Managers (Recommended)

Use the `*Command` options to integrate with secret managers:

```yaml
# GOOD - 1Password CLI
plugins:
  entries:
    openclaw-projects:
      config:
        apiKeyCommand: "op read op://Vault/openclaw/api_key"
```

```yaml
# GOOD - AWS Secrets Manager
plugins:
  entries:
    openclaw-projects:
      config:
        apiKeyCommand: "aws secretsmanager get-secret-value --secret-id openclaw/api-key --query SecretString --output text"
```

```yaml
# GOOD - HashiCorp Vault
plugins:
  entries:
    openclaw-projects:
      config:
        apiKeyCommand: "vault kv get -field=api_key secret/openclaw"
```

```yaml
# GOOD - macOS Keychain
plugins:
  entries:
    openclaw-projects:
      config:
        apiKeyCommand: "security find-generic-password -s 'openclaw-api-key' -w"
```

### Use File-Based Secrets

If command-based secrets aren't possible, use file-based secrets with proper permissions:

```bash
# Create secret file with restricted permissions
echo "your-api-key" > ~/.secrets/openclaw-api-key
chmod 600 ~/.secrets/openclaw-api-key
```

```yaml
plugins:
  entries:
    openclaw-projects:
      config:
        apiKeyFile: "~/.secrets/openclaw-api-key"
```

The plugin will warn if secret files have overly permissive permissions.

### Secret Rotation

Regularly rotate API keys and credentials:

1. Generate new key in backend
2. Update secret storage (manager/file)
3. Plugin will use new key on next invocation (commands) or restart (files)
4. Revoke old key after verification

## Transport Security

### HTTPS Required in Production

The plugin enforces HTTPS for `apiUrl` in production:

```yaml
# Production - HTTPS required
plugins:
  entries:
    openclaw-projects:
      config:
        apiUrl: "https://api.example.com"
```

```yaml
# Development only - HTTP allowed
plugins:
  entries:
    openclaw-projects:
      config:
        apiUrl: "http://localhost:3000"
```

### Certificate Validation

The plugin uses Node.js default certificate validation. For self-signed certificates in development, use:

```bash
NODE_TLS_REJECT_UNAUTHORIZED=0 openclaw ...
```

**Warning**: Never disable certificate validation in production.

## Data Privacy

### Memory Content

The plugin stores and retrieves memories that may contain sensitive information:

- **Do not** store passwords, API keys, or credentials as memories
- **Do** use memories for preferences, facts, and context
- Consider memory retention policies for compliance

### Message Content

SMS and email messages may contain:

- Personal information (names, addresses)
- Sensitive communications

Ensure your backend implements appropriate data protection measures.

### Logging

The plugin sanitizes sensitive data in logs:

```typescript
// Phone numbers are masked
"+15551234567" → "+1555***4567"

// API keys are redacted
"sk-abc123..." → "[REDACTED]"

// Email addresses are masked
"user@example.com" → "u***@example.com"
```

Enable debug logging only when troubleshooting:

```yaml
plugins:
  entries:
    openclaw-projects:
      config:
        debug: false  # Keep false in production
```

## Access Control

### User Scoping

Configure appropriate user scoping based on your security requirements:

```yaml
plugins:
  entries:
    openclaw-projects:
      config:
        userScoping: agent  # Default - memories shared per user
```

Options:

| Scope | Description | Use Case |
|-------|-------------|----------|
| `agent` | Shared across all sessions | Personal assistant |
| `identity` | Scoped to specific identity | Multi-account users |
| `session` | Isolated to single session | Sensitive operations |

### API Key Permissions

Use API keys with minimal required permissions:

- Memory read/write
- Todo read/write
- Contact read (write if needed)
- Message send (if SMS/email needed)

Do not use admin API keys in the plugin.

## Messaging Security

### SMS (Twilio)

- Verify Twilio webhook signatures (backend responsibility)
- Whitelist Twilio IP addresses (optional, defense-in-depth)
- Use separate phone numbers for testing vs. production
- Monitor for abuse (spam, phishing)

### Email (Postmark)

- Verify sender domain in Postmark
- Use DKIM/SPF records
- Monitor bounce rates
- Implement unsubscribe handling

## Audit Logging

For compliance and security monitoring, ensure your backend logs:

- All API requests with user context
- Memory create/read/delete operations
- Message send operations
- Authentication failures

The plugin logs operations at INFO level:

```
[INFO] [openclaw-projects] Memory stored {"memoryId":"...","category":"preference"}
[INFO] [openclaw-projects] SMS sent {"to":"+1555***4567","status":"queued"}
```

## Incident Response

### Credential Compromise

If API keys are compromised:

1. Immediately revoke the compromised key in backend
2. Generate new key
3. Update secret storage
4. Review audit logs for unauthorized access
5. Notify affected users if data was accessed

### Data Breach

If memories or messages are exposed:

1. Identify scope of exposure
2. Notify affected users per applicable regulations
3. Review and improve security controls
4. Document incident and remediation

## Compliance Considerations

### GDPR

- Implement data export (memory_recall all)
- Implement data deletion (memory_forget)
- Document data retention policies
- Obtain consent for memory storage

### CCPA

- Support "Do Not Sell" requests
- Provide data access on request
- Document data practices

### HIPAA

If handling health information:

- Use encrypted connections only
- Implement access logging
- Sign BAA with backend provider
- Review memory content for PHI

## Security Checklist

Before production deployment:

- [ ] Using secret manager or file-based secrets
- [ ] HTTPS enabled for API URL
- [ ] Debug logging disabled
- [ ] User scoping configured appropriately
- [ ] API key has minimal required permissions
- [ ] Audit logging enabled on backend
- [ ] Incident response plan documented
- [ ] Compliance requirements reviewed

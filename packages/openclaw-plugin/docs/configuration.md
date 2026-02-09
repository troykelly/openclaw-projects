# Configuration Reference

This document describes all configuration options for the OpenClaw Projects Plugin.

## Configuration File

The plugin is configured through your OpenClaw configuration file (`~/.openclaw/config.yaml`):

```yaml
plugins:
  entries:
    openclaw-projects:
      enabled: true
      config:
        # Configuration options here
```

All options listed below go under the `plugins.entries.openclaw-projects.config` key.

## API Connection

### apiUrl (required)

The base URL of your openclaw-projects backend API.

| Property | Value |
|----------|-------|
| Type | string |
| Required | Yes |
| Example | `"https://api.openclaw-projects.example.com"` |

**Security Note**: Must be HTTPS in production environments.

### API Key Options

You must provide the API key using one of these three methods:

#### apiKey

Direct API key value. **Least secure** - only use for development.

| Property | Value |
|----------|-------|
| Type | string |
| Required | One of apiKey/apiKeyFile/apiKeyCommand |
| Example | `"sk-abc123..."` |

#### apiKeyFile

Path to a file containing the API key. File should have restricted permissions (600).

| Property | Value |
|----------|-------|
| Type | string |
| Required | One of apiKey/apiKeyFile/apiKeyCommand |
| Example | `"~/.secrets/openclaw-api-key"` |

#### apiKeyCommand

Shell command to execute to retrieve the API key. **Most secure** - integrates with secret managers.

| Property | Value |
|----------|-------|
| Type | string |
| Required | One of apiKey/apiKeyFile/apiKeyCommand |
| Example | `"op read op://Personal/openclaw/api_key"` |

## Twilio Configuration (SMS)

To enable SMS messaging, configure Twilio credentials. Each credential supports the same three methods as the API key.

### twilioAccountSid / twilioAccountSidFile / twilioAccountSidCommand

Your Twilio Account SID.

| Property | Value |
|----------|-------|
| Type | string |
| Required | No (required for SMS) |
| Example | `"AC..."` |

### twilioAuthToken / twilioAuthTokenFile / twilioAuthTokenCommand

Your Twilio Auth Token.

| Property | Value |
|----------|-------|
| Type | string |
| Required | No (required for SMS) |
| Sensitive | Yes |

### twilioPhoneNumber / twilioPhoneNumberFile / twilioPhoneNumberCommand

Your Twilio phone number in E.164 format.

| Property | Value |
|----------|-------|
| Type | string |
| Required | No (required for SMS) |
| Example | `"+15551234567"` |

## Postmark Configuration (Email)

To enable email messaging, configure Postmark credentials.

### postmarkToken / postmarkTokenFile / postmarkTokenCommand

Your Postmark server token.

| Property | Value |
|----------|-------|
| Type | string |
| Required | No (required for email) |
| Sensitive | Yes |

### postmarkFromEmail / postmarkFromEmailFile / postmarkFromEmailCommand

The email address to send from. Must be verified in Postmark.

| Property | Value |
|----------|-------|
| Type | string (email format) |
| Required | No (required for email) |
| Example | `"noreply@example.com"` |

## Behavior Options

### autoRecall

Automatically inject relevant memories at conversation start.

| Property | Value |
|----------|-------|
| Type | boolean |
| Default | `true` |

When enabled, the plugin will search for relevant memories based on the user's initial prompt and include them in the agent's context.

### autoCapture

Automatically capture important information as memories at conversation end.

| Property | Value |
|----------|-------|
| Type | boolean |
| Default | `true` |

When enabled, the plugin will analyze the conversation and store relevant facts, preferences, and decisions as memories.

### userScoping

How to isolate memories between users.

| Property | Value |
|----------|-------|
| Type | `"agent"` \| `"identity"` \| `"session"` |
| Default | `"agent"` |

- `"agent"` - Memories shared across all sessions for the user
- `"identity"` - Memories scoped to specific identity/account
- `"session"` - Memories isolated to single session

## Advanced Options

### secretCommandTimeout

Timeout for secret retrieval commands in milliseconds.

| Property | Value |
|----------|-------|
| Type | integer |
| Default | `5000` |
| Minimum | `1000` |
| Maximum | `30000` |

### timeout

HTTP request timeout in milliseconds.

| Property | Value |
|----------|-------|
| Type | integer |
| Default | `30000` |

### maxRetries

Maximum number of retry attempts for failed requests.

| Property | Value |
|----------|-------|
| Type | integer |
| Default | `3` |

### debug

Enable debug logging.

| Property | Value |
|----------|-------|
| Type | boolean |
| Default | `false` |

## Example Configurations

### Development (Simple)

```yaml
plugins:
  entries:
    openclaw-projects:
      enabled: true
      config:
        apiUrl: http://localhost:3000
        apiKey: dev-key-123
```

### Production (Secure)

```yaml
plugins:
  entries:
    openclaw-projects:
      enabled: true
      config:
        apiUrl: https://api.openclaw-projects.example.com
        apiKeyCommand: op read op://Production/openclaw/api_key
        twilioAccountSidCommand: op read op://Production/twilio/account_sid
        twilioAuthTokenCommand: op read op://Production/twilio/auth_token
        twilioPhoneNumberCommand: op read op://Production/twilio/phone_number
        postmarkTokenCommand: op read op://Production/postmark/server_token
        postmarkFromEmail: noreply@example.com
        autoRecall: true
        autoCapture: true
        userScoping: agent
```

### File-Based Secrets

```yaml
plugins:
  entries:
    openclaw-projects:
      enabled: true
      config:
        apiUrl: https://api.openclaw-projects.example.com
        apiKeyFile: ~/.secrets/openclaw/api-key
        twilioAccountSidFile: ~/.secrets/twilio/account-sid
        twilioAuthTokenFile: ~/.secrets/twilio/auth-token
        twilioPhoneNumberFile: ~/.secrets/twilio/phone-number
```

## Environment Variables

The plugin respects standard environment variables when applicable:

- `NODE_ENV` - Affects security checks (HTTPS required when not "development")

## Configuration Validation

The plugin validates configuration at startup. Invalid configuration will prevent the plugin from loading. Common validation errors:

- Missing required `apiUrl`
- No API key method specified
- Invalid email format for `postmarkFromEmail`
- Invalid phone format (must be E.164)

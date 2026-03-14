# User Settings: Timezone — Agent Guide

This guide documents how OpenClaw agents read and update the user's timezone
setting via the REST API.

---

## Reading the Current Timezone

```http
GET /settings
```

The response includes a `timezone` field containing the user's canonical IANA
timezone string (e.g. `"Australia/Sydney"`, `"America/New_York"`, `"UTC"`).

```json
{
  "email": "alice@example.com",
  "timezone": "Australia/Sydney",
  "theme": "dark",
  ...
}
```

The `timezone` value is always a **canonical IANA identifier** — never an alias
or abbreviation.

---

## Updating the Timezone

```http
PATCH /settings
Content-Type: application/json

{
  "timezone": "America/New_York"
}
```

### Valid Values

Any valid [IANA timezone identifier](https://www.iana.org/time-zones) is
accepted. Common examples:

| Input | Stored Value |
|-------|-------------|
| `"UTC"` | `"UTC"` |
| `"America/New_York"` | `"America/New_York"` |
| `"Australia/Sydney"` | `"Australia/Sydney"` |
| `"Europe/London"` | `"Europe/London"` |
| `"Asia/Tokyo"` | `"Asia/Tokyo"` |

### Alias Canonicalization

Timezone aliases are accepted and automatically normalized to their canonical
IANA form. The response `timezone` value may differ from the input:

| Input (alias) | Stored Value (canonical) |
|---------------|-------------------------|
| `"US/Pacific"` | `"America/Los_Angeles"` |
| `"US/Eastern"` | `"America/New_York"` |
| `"Etc/UTC"` | `"UTC"` |
| `"Etc/GMT"` | `"UTC"` |

**Agents should prefer sending canonical IANA identifiers** but aliases are
handled gracefully.

### UTC Is Always Valid

`"UTC"` is always accepted regardless of the runtime environment. This is the
default timezone for new users.

### Invalid Values

Invalid timezone strings return `400 Bad Request`:

```json
{
  "error": "Invalid timezone: must be a valid IANA timezone identifier (e.g. \"America/New_York\", \"UTC\", \"Australia/Sydney\")"
}
```

Common invalid forms:

- Empty string: `""`
- Whitespace-only: `"   "`
- Non-IANA identifiers: `"Funky/Timezone"`, `"Eastern Time"`

Note: Some timezone abbreviations (e.g. `"EST"`, `"PST"`) may be accepted by
certain Node.js runtimes and canonicalized to their IANA equivalent. Agents
should always use full IANA identifiers for consistency.

### Omitting Timezone

If the `timezone` field is omitted from the PATCH request body, the existing
timezone value is preserved unchanged.

---

## How Timezone Affects the System

The stored timezone is used for:

- **Reminder scheduling**: `not_before` and `not_after` dates are interpreted
  relative to the user's timezone
- **Quiet hours**: notification suppression windows use the user's timezone
- **Date/time display**: the UI renders all dates in the user's timezone
- **Agent context**: the bootstrap endpoint includes the timezone for agents to
  use when interpreting user requests about dates and times

---

## Browser Timezone Detection

The web UI automatically detects the browser's timezone on login. If it differs
from the stored timezone, the UI offers to sync. Agents should prefer sending
explicit IANA strings rather than relying on browser detection.

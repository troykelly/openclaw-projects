# OpenClaw Skills

This directory contains OpenClaw skill definitions for the clawdbot-projects API.

## Available Skills

### clawdbot-projects

The main skill for interacting with the clawdbot-projects API. Provides:

- Work item management (projects, epics, issues, tasks)
- Memory storage and semantic search
- Contact management
- Activity feeds and notifications
- Timeline and analytics

See [clawdbot-projects/SKILL.md](./clawdbot-projects/SKILL.md) for full documentation.

## Installation

### Manual Installation

Copy the skill to your OpenClaw skills directory:

```bash
cp -r skills/clawdbot-projects ~/.openclaw/skills/
```

### Via ClawHub (when available)

```bash
clawhub install clawdbot-projects
```

## Configuration

Set the required environment variables:

```bash
export CLAWDBOT_URL="https://your-instance.example.com"
export CLAWDBOT_AUTH_SECRET="your-secret"
# Or use command-based secret:
export CLAWDBOT_AUTH_SECRET_COMMAND="op read 'op://Vault/clawdbot/secret'"
```

## References

- [OpenClaw Skills Documentation](https://docs.openclaw.ai/tools/skills)
- [ClawHub Registry](https://github.com/openclaw/clawhub)

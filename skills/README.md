# OpenClaw Skills

This directory contains OpenClaw skill definitions for the openclaw-projects API.

## Available Skills

### openclaw-projects

The main skill for interacting with the openclaw-projects API. Provides:

- Work item management (projects, epics, issues, tasks)
- Memory storage and semantic search
- Contact management
- Activity feeds and notifications
- Timeline and analytics

See [openclaw-projects/SKILL.md](./openclaw-projects/SKILL.md) for full documentation.

## Installation

### Manual Installation

Copy the skill to your OpenClaw skills directory:

```bash
cp -r skills/openclaw-projects ~/.openclaw/skills/
```

### Via ClawHub (when available)

```bash
clawhub install openclaw-projects
```

## Configuration

Set the required environment variables:

```bash
export OPENCLAW_PROJECTS_URL="https://your-instance.example.com"
export OPENCLAW_API_TOKEN="your-secret"
# Or use command-based secret:
export OPENCLAW_API_TOKEN_COMMAND="op read 'op://Vault/openclaw-projects/secret'"
```

## References

- [OpenClaw Skills Documentation](https://docs.openclaw.ai/tools/skills)
- [ClawHub Registry](https://github.com/openclaw/clawhub)

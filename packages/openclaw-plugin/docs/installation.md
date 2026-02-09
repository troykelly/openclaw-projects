# Installation Guide

## Prerequisites

Before installing the plugin, ensure you have:

1. **Node.js 20 or later** - The plugin uses modern JavaScript features
2. **OpenClaw Gateway** - The plugin runs within the OpenClaw ecosystem
3. **Backend API** - A running instance of the openclaw-projects backend

## Installation Methods

### Method 1: OpenClaw Plugin Manager (Recommended)

```bash
openclaw plugins install @troykelly/openclaw-projects
```

This will:
- Download the plugin from the registry
- Register it with your OpenClaw installation
- Create a configuration template

### Method 2: pnpm Global Installation

```bash
pnpm add -g @troykelly/openclaw-projects
```

Then link it to OpenClaw:

```bash
openclaw plugins link $(pnpm root -g)/@troykelly/openclaw-projects
```

### Method 3: Local Development

For contributing or local testing:

```bash
# Clone the repository
git clone https://github.com/troykelly/openclaw-projects.git
cd openclaw-projects

# Install dependencies
pnpm install

# Build the plugin
cd packages/openclaw-plugin
pnpm build

# Link to OpenClaw
openclaw plugins link $(pwd)
```

## Post-Installation

### 1. Verify Installation

Check that the plugin is registered:

```bash
openclaw plugins list
```

You should see `openclaw-projects` in the list.

### 2. Configure the Plugin

Create or update your OpenClaw configuration. See [Configuration Reference](./configuration.md) for all options.

Minimum required configuration (`~/.openclaw/config.yaml`):

```yaml
plugins:
  entries:
    openclaw-projects:
      enabled: true
      config:
        apiUrl: https://api.your-backend.example.com
        apiKey: your-api-key
```

### 3. Test the Connection

Start an OpenClaw session and test a simple tool:

```
You: Can you check my memory for any stored preferences?
Agent: [Uses memory_recall] You don't have any stored preferences yet.
```

## Updating the Plugin

### Via OpenClaw Plugin Manager

```bash
openclaw plugins update @troykelly/openclaw-projects
```

### Via pnpm

```bash
pnpm update -g @troykelly/openclaw-projects
```

## Uninstalling

### Via OpenClaw Plugin Manager

```bash
openclaw plugins uninstall @troykelly/openclaw-projects
```

### Via pnpm

```bash
pnpm remove -g @troykelly/openclaw-projects
```

## Troubleshooting Installation

### Plugin Not Found After Installation

Ensure the plugin is in your OpenClaw plugin path:

```bash
openclaw config get pluginPaths
```

If missing, add the pnpm global path:

```bash
openclaw config set pluginPaths "$(pnpm root -g)"
```

### Build Errors (Local Development)

Ensure you're using the correct Node version:

```bash
node --version  # Should be 20+
```

Clear and reinstall dependencies:

```bash
rm -rf node_modules
pnpm install
pnpm build
```

### Permission Errors

On Unix systems, you may need to adjust permissions:

```bash
# Option 1: Use a node version manager (recommended)
# Option 2: Configure pnpm to use a different directory
pnpm config set global-dir ~/.pnpm-global
export PATH=~/.pnpm-global/bin:$PATH
```

For more troubleshooting help, see [Troubleshooting](./troubleshooting.md).

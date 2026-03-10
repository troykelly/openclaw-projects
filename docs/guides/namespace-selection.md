# Namespace Selection User Guide

Namespaces are workspaces that separate your data — tasks, projects, memories, contacts — into distinct scopes. You might have a personal namespace, a team workspace, or project-specific namespaces.

## Overview

- Each user has at least one namespace (their **home** namespace).
- Users with access to multiple namespaces see a **namespace selector** in the app header.
- Users with only one namespace see no selector (it just works).

## Selecting a Namespace

### Single Namespace Mode

When you click a namespace in the header dropdown, you switch to that namespace:

- All data views (projects, tasks, contacts, etc.) reload to show data from the selected namespace.
- New items you create go into this namespace.
- Your selection persists across page refreshes and browser sessions.

### Multi-Namespace Mode

You can enable multi-namespace mode to see data from multiple namespaces at once:

- Toggle additional namespaces on/off using the namespace selector.
- Your **primary** namespace (the first selected) is used for write operations — new tasks, projects, etc.
- Read views combine data from all selected namespaces.
- Items from different namespaces show a **namespace badge** for disambiguation.

### What Happens When You Switch

When you change your active namespace:

1. All in-progress data loads are cancelled.
2. The data cache is cleared to prevent stale data.
3. All views refresh with data from the new namespace.
4. There may be a brief loading state while fresh data loads.

## Namespace Management

Navigate to **Settings > Namespaces** to manage your namespaces.

### Viewing Your Namespaces

The namespace settings page shows all namespaces you have access to, including:

- **Name** — the namespace identifier
- **Access level** — `read` (view only) or `readwrite` (full access)
- **Home badge** — indicates your default namespace

Click a namespace to see its members and manage access.

### Creating a Namespace

1. Go to **Settings > Namespaces**.
2. Click **Create Namespace**.
3. Enter a name following these rules:
   - Lowercase letters, numbers, dots, hyphens, underscores only
   - Must start with a letter or number
   - Maximum 63 characters
   - Example: `my-project`, `team.alpha`, `home_2026`
4. Click **Create**.

You are automatically granted `readwrite` access to namespaces you create.

### Inviting Members

1. Go to **Settings > Namespaces** and click the namespace you want to manage.
2. Click **Invite Member**.
3. Enter the member's email address.
4. Select their access level:
   - **Read** — can view data but not create or modify
   - **Readwrite** — full access to create, edit, and delete
5. Click **Invite**.

### Changing Member Access

In the namespace detail view, use the access dropdown next to each member to change their access level between `read` and `readwrite`.

### Removing Members

1. In the namespace detail view, click the trash icon next to a member.
2. Confirm the removal in the dialog.
3. The member immediately loses all access to the namespace.

### Leaving a Namespace

To leave a namespace, an admin must remove your grant from the namespace detail view. Self-removal is handled through the same grant deletion mechanism.

## How It Works (Technical)

### Data Scoping

Every API request includes namespace information:

- **Single namespace:** An `X-Namespace` header with the active namespace name.
- **Multiple namespaces:** An `X-Namespaces` header with a comma-separated list.

The backend uses these headers to filter data queries and route write operations.

### Persistence

Your namespace selection is saved in your browser's local storage. If you clear your browser data, you'll revert to your home namespace.

### Access Enforcement

- The backend validates your namespace access on every request.
- If a namespace grant is revoked while you're using it, subsequent requests will fail and you'll be redirected to your home namespace.
- Namespace names are validated against a strict pattern (`^[a-z0-9][a-z0-9._-]*$`) to prevent injection attacks.

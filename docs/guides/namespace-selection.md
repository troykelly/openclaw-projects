# Namespace Selection User Guide

Namespaces are workspaces that separate your data — tasks, projects, memories, contacts — into distinct scopes. You might have a personal namespace, a team workspace, or project-specific namespaces.

## Overview

- Each user has at least one namespace (their **home** namespace).
- Users with access to multiple namespaces see a **namespace selector** dropdown in the app header.
- Users with only one namespace see a subtle namespace label (no dropdown).

## Selecting a Namespace

When you click a namespace in the header dropdown, you switch your active namespace:

- All data views (projects, tasks, contacts, etc.) reload to show data from the selected namespace.
- New items you create go into this namespace.
- Your selection persists across page refreshes and browser sessions (stored in your browser's local storage).

### What Happens When You Switch

When you change your active namespace:

1. All in-progress data loads are cancelled.
2. The data cache is cleared to prevent stale data from the previous namespace.
3. All views refresh with data from the new namespace.
4. There may be a brief loading state while fresh data loads.

### When No Namespace Is Selected

If you haven't explicitly chosen a namespace (e.g., first visit or cleared browser data), the system uses your **home** namespace. If no home namespace is set, it uses your first namespace alphabetically.

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

## How It Works (Technical)

### Data Scoping

Every API request from the UI includes an `X-Namespace` header with the active namespace name. The backend uses this header to filter data queries and route write operations to the correct namespace.

### Persistence

Your namespace selection is saved in your browser's local storage. If you clear your browser data, you'll revert to your home namespace.

### Access Enforcement

- The backend validates your namespace access on every request against your `namespace_grant` entries.
- If you request a namespace you don't have a grant for, the request is rejected.
- Namespace names are validated against a strict pattern (`^[a-z0-9][a-z0-9._-]*$`) to prevent injection attacks. Invalid names are silently filtered.

### Namespace Badges

When viewing data, items from a different namespace than your primary display a small namespace badge for disambiguation. These badges are only shown to users who have access to multiple namespaces.

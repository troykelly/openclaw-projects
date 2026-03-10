# Namespace Management Guide

Namespaces organize your work items, memories, contacts, and other data into separate spaces. Each namespace has its own set of members with configurable access levels.

## Key Concepts

### Home Namespace
Every user has one **home namespace** — this is their personal workspace created when their account is provisioned. The home namespace is marked with a "Home" badge in the UI. You cannot leave your home namespace.

### Access Levels
- **Read:** View data within the namespace. Cannot create, modify, or delete items.
- **Read & Write:** Full access to create, modify, and delete items. Can also manage namespace membership (invite, update access, remove members).

### Priority
Each namespace grant has a priority value (0-100). Higher priority namespaces appear first in lists and the namespace selector. Your home namespace typically has the highest priority.

## Switching Namespaces

### Single Namespace Mode (Default)
The namespace selector in the application header shows your currently active namespace. Click it to switch between namespaces.

When you switch namespaces:
- All data views update to show data from the selected namespace
- Write operations (creating items, editing, etc.) target the selected namespace
- Previously loaded data for the old namespace is kept in cache for instant switching back

### Multi-Namespace Mode
Power users can enable multi-namespace mode to view aggregated data from multiple namespaces simultaneously.

In multi-namespace mode:
- **Read operations** pull data from all selected namespaces
- **Write operations** always target your primary (first selected) namespace
- Useful for team leads overseeing multiple projects

## Managing Namespaces

Access namespace management at **Settings > Namespaces** (`/app/settings/namespaces`).

### Viewing Your Namespaces
The namespace list shows all namespaces you belong to with:
- Namespace name
- Your access level (Read or Read & Write)
- Home badge (if applicable)

Click any namespace to view its members and manage access.

### Creating a Namespace
1. Go to **Settings > Namespaces**
2. Click **Create Namespace**
3. Enter a namespace name following these rules:
   - Must start with a lowercase letter or digit
   - Can contain lowercase letters, digits, dots, hyphens, underscores
   - Maximum 63 characters
   - Examples: `my-project`, `team.alpha`, `2026-renovation`
4. Click **Create**

You automatically receive Read & Write access to namespaces you create.

### Viewing Namespace Members
1. Go to **Settings > Namespaces**
2. Click on a namespace
3. The member list shows all users with access, including:
   - Email address
   - Access level
   - Home badge (if this is their home namespace)
   - Join date

### Inviting Members
Requires Read & Write access to the namespace.

1. Navigate to the namespace detail view
2. Click **Invite Member**
3. Enter the member's email address (they must have an existing account)
4. Select the access level:
   - **Read** — can view data
   - **Read & Write** — can view and modify data, manage members
5. Click **Invite**

If the user already has access, their access level is updated to the new value.

### Changing a Member's Access Level
Requires Read & Write access.

1. Navigate to the namespace detail view
2. Find the member in the list
3. Use the access level dropdown next to their name to change between Read and Read & Write

### Removing a Member
Requires Read & Write access.

1. Navigate to the namespace detail view
2. Click the remove button (trash icon) next to the member
3. Confirm the removal in the dialog

The member immediately loses all access to the namespace and its data.

## For OpenClaw Agents

OpenClaw agents interact with namespaces via the REST API using M2M tokens. Key points:

- Agents with `api:full` scope can list all namespaces across all users
- Creating namespaces on behalf of users requires the `X-User-Email` header
- Admin operations (invite, update access, remove) require an explicit `readwrite` grant
- See the [Namespace API Reference](../api/namespaces.md) for endpoint details

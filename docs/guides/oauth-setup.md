# OAuth Setup Guide

This guide explains how to configure Microsoft 365 and Google OAuth credentials for
openclaw-projects. OAuth enables **contacts**, **email**, **drive/files**, and **calendar**
integration.

## Table of Contents

- [Overview](#overview)
- [Environment Variables](#environment-variables)
- [Microsoft 365 / Azure AD](#microsoft-365--azure-ad)
  - [Portal Walkthrough](#azure-portal-walkthrough)
  - [CLI Automation](#azure-cli-automation)
- [Google](#google)
  - [Console Walkthrough](#google-console-walkthrough)
  - [CLI Automation](#google-cli-automation)
- [Token Encryption](#token-encryption)
- [Redirect URI Configuration](#redirect-uri-configuration)
- [Permissions Reference](#permissions-reference)

---

## Overview

openclaw-projects uses standard OAuth 2.0 Authorization Code flow (with PKCE) to access
user data from Microsoft 365 and Google. Users connect their accounts through the web UI,
granting access to specific features. The server stores encrypted tokens and refreshes them
automatically.

Both providers are optional — configure one, both, or neither. If a provider's credentials
are not set, its features are silently disabled (no errors).

---

## Environment Variables

Add these to your `.env` file. See `.env.example` for a documented template.

### Microsoft 365

| Variable | Required | Description |
|----------|----------|-------------|
| `MS365_CLIENT_ID` | Yes (for MS365) | Application (client) ID from Azure AD |
| `MS365_CLIENT_SECRET` | Yes (for MS365) | Client secret value |
| `AZURE_TENANT_ID` | No | Restrict to a single tenant; omit for multi-tenant (`/common/`) |

Fallback names (for backward compatibility): `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`

### Google

| Variable | Required | Description |
|----------|----------|-------------|
| `GOOGLE_CLIENT_ID` | Yes (for Google) | OAuth 2.0 client ID |
| `GOOGLE_CLIENT_SECRET` | Yes (for Google) | OAuth 2.0 client secret |

Fallback names (for backward compatibility): `GOOGLE_CLOUD_CLIENT_ID`, `GOOGLE_CLOUD_CLIENT_SECRET`

### Shared

| Variable | Required | Description |
|----------|----------|-------------|
| `OAUTH_REDIRECT_URI` | No | Override the callback URL. Default: `http://localhost:3000/api/oauth/callback` |
| `OAUTH_TOKEN_ENCRYPTION_KEY` | **Yes (production)** | 64-char hex string (32 bytes). Encrypts tokens at rest. |

Provider-specific redirect URI overrides are also supported: `MS365_REDIRECT_URI`, `GOOGLE_REDIRECT_URI`.

---

## Microsoft 365 / Azure AD

### Azure Portal Walkthrough

1. **Go to Azure Portal**
   - Open [https://portal.azure.com](https://portal.azure.com)
   - Navigate to **Microsoft Entra ID** (formerly Azure Active Directory)

2. **Create an App Registration**
   - Click **App registrations** → **New registration**
   - **Name:** `openclaw-projects` (or your preferred name)
   - **Supported account types:** Choose based on your needs:
     - *Single tenant* — only users in your organization
     - *Multitenant* — users in any Azure AD organization
     - *Multitenant + personal Microsoft accounts* — broadest access
   - **Redirect URI:**
     - Platform: **Web**
     - URI: Your callback URL (see [Redirect URI Configuration](#redirect-uri-configuration))
   - Click **Register**

3. **Note the Application (client) ID**
   - On the app's **Overview** page, copy the **Application (client) ID**
   - This is your `MS365_CLIENT_ID`
   - If single-tenant: also copy the **Directory (tenant) ID** → `AZURE_TENANT_ID`

4. **Create a Client Secret**
   - Go to **Certificates & secrets** → **Client secrets** → **New client secret**
   - **Description:** `openclaw-projects`
   - **Expires:** Choose an appropriate duration (recommend 24 months)
   - Click **Add**
   - **Copy the Value immediately** — it won't be shown again
   - This is your `MS365_CLIENT_SECRET`

5. **Add API Permissions**
   - Go to **API permissions** → **Add a permission** → **Microsoft Graph** → **Delegated permissions**
   - Add these permissions:

   | Permission | Purpose |
   |------------|---------|
   | `User.Read` | Read user profile (always required) |
   | `offline_access` | Refresh tokens (always required) |
   | `Contacts.Read` | Read contacts |
   | `Mail.Read` | Read email |
   | `Files.Read` | Read OneDrive files |
   | `Calendars.Read` | Read calendar events |

   - For write access, add the `.ReadWrite` variants instead (e.g. `Mail.ReadWrite`)
   - Click **Grant admin consent** if you are an admin and want to pre-approve for all users

6. **Set Environment Variables**
   ```bash
   MS365_CLIENT_ID=<application-client-id>
   MS365_CLIENT_SECRET=<client-secret-value>
   # Only for single-tenant:
   AZURE_TENANT_ID=<directory-tenant-id>
   ```

### Azure CLI Automation

For agents or automated setup with the Azure CLI (`az`).

**Prerequisites:** `az` CLI installed and authenticated (`az login`).

```bash
# Variables — adjust these
APP_NAME="openclaw-projects"
REDIRECT_URI="https://api.yourdomain.com/api/oauth/callback"

# 1. Create the app registration
APP_ID=$(az ad app create \
  --display-name "$APP_NAME" \
  --sign-in-audience "AzureADandPersonalMicrosoftAccount" \
  --web-redirect-uris "$REDIRECT_URI" \
  --query appId -o tsv)

echo "MS365_CLIENT_ID=$APP_ID"

# 2. Add required Microsoft Graph delegated permissions
# Permission IDs for Microsoft Graph delegated permissions:
#   User.Read         = e1fe6dd8-ba31-4d61-89e7-88639da4683d
#   offline_access    = 7427e0e9-2fba-42fe-b0c0-848c9e6a8182
#   Contacts.Read     = ff74d97f-43af-4b68-9f2a-b77988e32399
#   Mail.Read         = 570282fd-fa5c-430d-a7fd-fc8dc98a9dca
#   Files.Read        = 10465720-29dd-4523-a11a-6a75c743c9d9
#   Calendars.Read    = 465a38f9-76ea-45b9-9f34-9e8b0d4b0b42
GRAPH_API_ID="00000003-0000-0000-c000-000000000000"

for PERM_ID in \
  "e1fe6dd8-ba31-4d61-89e7-88639da4683d" \
  "7427e0e9-2fba-42fe-b0c0-848c9e6a8182" \
  "ff74d97f-43af-4b68-9f2a-b77988e32399" \
  "570282fd-fa5c-430d-a7fd-fc8dc98a9dca" \
  "10465720-29dd-4523-a11a-6a75c743c9d9" \
  "465a38f9-76ea-45b9-9f34-9e8b0d4b0b42"; do
  az ad app permission add \
    --id "$APP_ID" \
    --api "$GRAPH_API_ID" \
    --api-permissions "${PERM_ID}=Scope"
done

# 3. Create a client secret (valid 2 years)
SECRET=$(az ad app credential reset \
  --id "$APP_ID" \
  --display-name "openclaw-projects" \
  --years 2 \
  --query password -o tsv)

echo "MS365_CLIENT_SECRET=$SECRET"

# 4. Get tenant ID (if single-tenant)
TENANT_ID=$(az account show --query tenantId -o tsv)
echo "AZURE_TENANT_ID=$TENANT_ID"
```

**After running:** Set the output values in your `.env` file.

---

## Google

### Google Console Walkthrough

1. **Go to Google Cloud Console**
   - Open [https://console.cloud.google.com](https://console.cloud.google.com)
   - Select or create a project

2. **Enable Required APIs**
   - Go to **APIs & Services** → **Library**
   - Search for and enable each of these APIs:

   | API | Purpose |
   |-----|---------|
   | **People API** | Contact access |
   | **Gmail API** | Email access |
   | **Google Drive API** | File/drive access |
   | **Google Calendar API** | Calendar access |

3. **Configure OAuth Consent Screen**
   - Go to **APIs & Services** → **OAuth consent screen**
   - **User type:**
     - *Internal* — only users in your Google Workspace organization
     - *External* — any Google account (requires verification for production)
   - Fill in the required fields:
     - **App name:** `openclaw-projects`
     - **User support email:** your email
     - **Developer contact email:** your email
   - **Scopes:** Add these scopes:
     - `https://www.googleapis.com/auth/userinfo.email`
     - `https://www.googleapis.com/auth/contacts.readonly`
     - `https://www.googleapis.com/auth/gmail.readonly`
     - `https://www.googleapis.com/auth/drive.readonly`
     - `https://www.googleapis.com/auth/calendar.readonly`
   - Save and continue

4. **Create OAuth 2.0 Credentials**
   - Go to **APIs & Services** → **Credentials** → **Create Credentials** → **OAuth client ID**
   - **Application type:** Web application
   - **Name:** `openclaw-projects`
   - **Authorized redirect URIs:** Add your callback URL (see [Redirect URI Configuration](#redirect-uri-configuration))
   - Click **Create**
   - **Copy the Client ID and Client Secret**

5. **Set Environment Variables**
   ```bash
   GOOGLE_CLIENT_ID=<client-id>.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=<client-secret>
   ```

### Google CLI Automation

For agents or automated setup with the `gcloud` CLI.

**Prerequisites:** `gcloud` CLI installed and authenticated (`gcloud auth login`).

```bash
# Variables — adjust these
PROJECT_ID="your-gcp-project-id"
APP_NAME="openclaw-projects"
REDIRECT_URI="https://api.yourdomain.com/api/oauth/callback"

# 1. Set the active project
gcloud config set project "$PROJECT_ID"

# 2. Enable required APIs
gcloud services enable \
  people.googleapis.com \
  gmail.googleapis.com \
  drive.googleapis.com \
  calendar-json.googleapis.com

# 3. Create OAuth brand (consent screen) — required once per project
#    Note: This creates an "internal" brand. For external, use the console.
gcloud alpha iap oauth-brands create \
  --application_title="$APP_NAME" \
  --support_email="$(gcloud config get-value account)"

# 4. Create OAuth client
#    Note: gcloud does not directly support creating OAuth 2.0 web clients
#    with redirect URIs. Use the REST API instead:
ACCESS_TOKEN=$(gcloud auth print-access-token)

CLIENT_RESPONSE=$(curl -s -X POST \
  "https://oauth2.googleapis.com/v1/projects/${PROJECT_ID}/oauthClients" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"displayName\": \"$APP_NAME\",
    \"allowedGrantTypes\": [\"AUTHORIZATION_CODE_GRANT\"],
    \"allowedRedirectUris\": [\"$REDIRECT_URI\"],
    \"allowedScopes\": [
      \"https://www.googleapis.com/auth/userinfo.email\",
      \"https://www.googleapis.com/auth/contacts.readonly\",
      \"https://www.googleapis.com/auth/gmail.readonly\",
      \"https://www.googleapis.com/auth/drive.readonly\",
      \"https://www.googleapis.com/auth/calendar.readonly\"
    ]
  }")

# If the REST API is not available, create the client via the console:
#   https://console.cloud.google.com/apis/credentials
echo "If the above command fails, create the OAuth client manually in the console."
echo "See: https://console.cloud.google.com/apis/credentials?project=$PROJECT_ID"

# 5. Alternatively, use the console and paste the values:
echo ""
echo "Set these in your .env:"
echo "  GOOGLE_CLIENT_ID=<from console>"
echo "  GOOGLE_CLIENT_SECRET=<from console>"
```

**Note:** Google's `gcloud` CLI has limited support for creating OAuth 2.0 web application
clients programmatically. The most reliable method for agents is:
1. Enable the APIs via `gcloud services enable` (fully automatable)
2. Create the OAuth client via the Google Cloud Console (requires browser access)

If the agent has browser automation (e.g. Playwright), it can navigate the console UI to
complete client creation.

---

## Token Encryption

OAuth tokens (access tokens and refresh tokens) are stored in the database. In production,
they **must** be encrypted at rest.

### Generating the Key

```bash
openssl rand -hex 32
```

This produces a 64-character hex string (32 bytes), used as the AES-256-GCM master key.

### How It Works

- Each OAuth connection row gets a unique derived key via HKDF (using the row UUID as salt)
- Tokens are encrypted with AES-256-GCM before database writes
- Tokens are decrypted after database reads
- Without the key, tokens pass through in plaintext (development fallback)

### Key Rotation Warning

**Changing `OAUTH_TOKEN_ENCRYPTION_KEY` after deployment invalidates all existing encrypted
tokens.** Users will need to re-authorize their connected accounts. There is no automatic
migration path — plan key rotation carefully.

### Recommendations

- Always set `OAUTH_TOKEN_ENCRYPTION_KEY` in production
- Store the key securely (e.g. Docker secrets, 1Password, HashiCorp Vault)
- Back up the key — losing it means losing access to all encrypted tokens
- `scripts/setup.sh` auto-generates this key when OAuth credentials are configured

---

## Redirect URI Configuration

The OAuth callback endpoint is: `/api/oauth/callback`

The full redirect URI depends on your deployment mode:

| Deployment | Redirect URI | Env var |
|------------|-------------|---------|
| Quickstart (localhost) | `http://localhost:3000/api/oauth/callback` | Default (no config needed) |
| `docker-compose.yml` (basic) | `http://localhost:3000/api/oauth/callback` | Default or set `OAUTH_REDIRECT_URI` |
| `docker-compose.traefik.yml` | `https://api.yourdomain.com/api/oauth/callback` | `OAUTH_REDIRECT_URI=https://api.DOMAIN/api/oauth/callback` |
| `docker-compose.full.yml` | `https://api.yourdomain.com/api/oauth/callback` | `OAUTH_REDIRECT_URI=https://api.DOMAIN/api/oauth/callback` |

**The redirect URI must exactly match** what is registered in the Azure portal or Google
Cloud Console. A mismatch causes OAuth to fail with a redirect_uri_mismatch error.

You can also set provider-specific overrides:
- `MS365_REDIRECT_URI` — only for Microsoft
- `GOOGLE_REDIRECT_URI` — only for Google

Priority: provider-specific → `OAUTH_REDIRECT_URI` → default (`http://localhost:3000/api/oauth/callback`)

---

## Permissions Reference

### Features and Required Scopes

Each feature can be enabled per-connection. The required OAuth scopes per feature:

#### Microsoft 365 (Microsoft Graph API)

| Feature | Read scope | Read+Write scope |
|---------|-----------|-----------------|
| Contacts | `Contacts.Read` | `Contacts.ReadWrite` |
| Email | `Mail.Read` | `Mail.ReadWrite` |
| Files | `Files.Read` | `Files.ReadWrite` |
| Calendar | `Calendars.Read` | `Calendars.ReadWrite` |

**Always required:** `User.Read`, `offline_access`

#### Google

| Feature | Read scope | Read+Write scope |
|---------|-----------|-----------------|
| Contacts | `contacts.readonly` | `contacts` |
| Email | `gmail.readonly` | `gmail.readonly` + `gmail.send` |
| Files | `drive.readonly` | `drive.file` |
| Calendar | `calendar.readonly` | `calendar` |

**Always required:** `userinfo.email`

Full scope URIs are prefixed with `https://www.googleapis.com/auth/`.

### Incremental Authorization

Both providers support incremental authorization — users can grant additional scopes later
without revoking existing ones. When a user enables a new feature (e.g. files) on an
existing connection, they are redirected to re-authorize with the additional scopes.

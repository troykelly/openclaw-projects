# HA OAuth Silent Failure Fix

**Date:** 2026-03-02
**Issue:** #1836
**Status:** Implementing

## Problem

After completing the HA OAuth flow, the user is redirected to
`/app/settings?ha_connected=<uuid>`. The provider appears in the list
with status "active" and encrypted credentials, but:

1. The HA connector never decrypts or connects to the HA instance.
2. `GET /api/geolocation/current` returns 404 indefinitely.
3. No feedback is shown to the user — silent failure.

Users have attempted the flow multiple times (4 duplicate providers
for the same HA instance in the HAR capture).

## Root Cause

### Primary: Encryption key env var mismatch

The `ha-connector` service in `docker-compose.yml` and
`docker-compose.full.yml` received `GEO_ENCRYPTION_KEY`, but
`src/api/geolocation/crypto.ts` expects either
`GEO_TOKEN_ENCRYPTION_KEY` or `OAUTH_TOKEN_ENCRYPTION_KEY`.

The API server encrypts credentials using `OAUTH_TOKEN_ENCRYPTION_KEY`
(correctly set). The HA connector cannot find the key under the wrong
name, so `isGeoEncryptionEnabled()` returns `false` and
`decryptCredentials()` passes the raw base64 ciphertext through
unchanged. `parseHaCredentials()` receives garbled data, treats it as
a plain access token, and the WebSocket auth fails with
`auth_invalid`.

### Secondary: Credentials leaked to frontend

`GET /api/geolocation/providers` returned the encrypted credentials
blob to the browser. Even though encrypted, ciphertext should never
reach the client.

### Tertiary: No user feedback

The `ha_connected` query parameter from the OAuth callback redirect
was not handled by the SettingsPage component — no toast, scroll, or
visual confirmation.

## Fixes

### 1. Docker-compose env var alignment

Replace `GEO_ENCRYPTION_KEY` with both `OAUTH_TOKEN_ENCRYPTION_KEY`
and `GEO_TOKEN_ENCRYPTION_KEY` in the ha-connector service definition.
This ensures the crypto module can find the key through either path.

**Files:** `docker-compose.yml`, `docker-compose.full.yml`

### 2. Strip credentials from API responses

Replace the `credentials` field with `has_credentials` (boolean) in
GET `/api/geolocation/providers` and
GET `/api/geolocation/providers/:id` responses. Update the OpenAPI
spec to match.

**Files:** `src/api/server.ts`, `src/api/openapi/paths/geolocation.ts`

### 3. Frontend feedback on OAuth completion

Add `useSearchParams` handling to `SettingsPage` that detects the
`ha_connected` query param, shows a success banner above the Location
section, scrolls to it, and clears the param from the URL.

**Files:** `src/ui/components/settings/settings-page.tsx`,
`src/ui/components/settings/use-geolocation.ts`

### 4. Documentation

Update `.env.example` to clarify the encryption key relationship
between the API server and HA connector.

## Out of Scope (separate issues)

- Duplicate provider deduplication on retry
- Webhook token display after creation (POST returns encrypted blob)
- Provider status polling in the frontend after OAuth completion

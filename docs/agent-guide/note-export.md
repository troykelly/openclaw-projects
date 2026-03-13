# Note & Notebook Export — Agent Guide

This guide documents the happy paths for OpenClaw agents exporting notes and
notebooks to PDF, DOCX, and ODF formats via the REST API.

Part of Epic #2475, Issue #2478.

---

## Overview

Agents can export individual notes or entire notebooks. Small notes are exported
synchronously (response includes `download_url`), while larger notes and all
notebooks are exported asynchronously (response includes `poll_url`).

**Rate limit:** 10 export requests per user per minute.

---

## Export a Single Note

```http
POST /namespaces/{ns}/notes/{note_id}/exports
Authorization: Bearer <token>
Content-Type: application/json

{
  "format": "pdf",
  "options": {
    "page_size": "A4",
    "include_metadata": true
  }
}
```

### Synchronous response (200) — small notes

```json
{
  "id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  "status": "ready",
  "format": "pdf",
  "source_type": "note",
  "source_id": "11111111-2222-3333-4444-555555555555",
  "original_filename": "Meeting_Notes.pdf",
  "size_bytes": 24576,
  "download_url": "https://s3.example.com/exports/...",
  "poll_url": null,
  "error_message": null,
  "expires_at": "2026-03-14T12:00:00Z",
  "created_at": "2026-03-13T12:00:00Z",
  "updated_at": "2026-03-13T12:00:00Z"
}
```

### Asynchronous response (202) — large notes

```json
{
  "id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  "status": "pending",
  "format": "pdf",
  "source_type": "note",
  "source_id": "11111111-2222-3333-4444-555555555555",
  "original_filename": null,
  "size_bytes": null,
  "download_url": null,
  "poll_url": "/namespaces/my-workspace/exports/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  "error_message": null,
  "expires_at": "2026-03-14T12:00:00Z",
  "created_at": "2026-03-13T12:00:00Z",
  "updated_at": "2026-03-13T12:00:00Z"
}
```

---

## Export a Notebook

Notebooks always export asynchronously (all notes in sort order).

```http
POST /namespaces/{ns}/notebooks/{notebook_id}/exports
Authorization: Bearer <token>
Content-Type: application/json

{
  "format": "docx"
}
```

**Response:** 202 with the same shape as the async note response above.

---

## Poll Export Status

```http
GET /namespaces/{ns}/exports/{export_id}
Authorization: Bearer <token>
```

Poll until `status` is `ready` (has `download_url`) or `failed` (has `error_message`).

**Status lifecycle:** `pending` -> `generating` -> `ready` | `failed` | `expired`

When `status` is `ready`, the `download_url` is a time-limited presigned S3 URL
regenerated on each GET request.

Returns **410 Gone** for expired exports.

---

## List Exports

```http
GET /namespaces/{ns}/exports?status=ready&limit=20&offset=0
Authorization: Bearer <token>
```

Returns only the authenticated user's exports within the namespace.

```json
{
  "exports": [ ... ],
  "total": 42,
  "limit": 20,
  "offset": 0
}
```

**Query parameters:**
| Parameter | Type    | Default | Description                    |
|-----------|---------|---------|--------------------------------|
| `status`  | string  | —       | Filter: pending, generating, ready, failed, expired |
| `limit`   | integer | 20      | Max results (1–100)            |
| `offset`  | integer | 0       | Skip N results                 |

---

## Delete an Export

```http
DELETE /namespaces/{ns}/exports/{export_id}
Authorization: Bearer <token>
```

Cancels a pending/generating export or deletes a ready export (including the S3
object). Returns **204 No Content** on success.

---

## Supported Formats

| Format | Value  | Notes                          |
|--------|--------|--------------------------------|
| PDF    | `pdf`  | Rendered via headless Chromium  |
| DOCX   | `docx` | Converted via pandoc            |
| ODF    | `odf`  | Converted via pandoc            |

## Export Options

| Option             | Type    | Default | Applies to | Description              |
|--------------------|---------|---------|------------|--------------------------|
| `page_size`        | string  | `A4`    | PDF        | `A4` or `Letter`         |
| `include_metadata` | boolean | `false` | All        | Include title and date   |

---

## Agent Workflow: Export and Share

A common pattern is to export a note and share the download URL:

1. `POST /namespaces/{ns}/notes/{id}/exports` with desired format
2. If 202, poll `GET /namespaces/{ns}/exports/{export_id}` until `status=ready`
3. Use the `download_url` from the response (presigned, time-limited)
4. Optionally upload the file via `POST /files/upload` for permanent storage

---

## Error Handling

| Status | Meaning                                    |
|--------|--------------------------------------------|
| 401    | Missing or invalid authentication          |
| 403    | No access to the namespace                 |
| 404    | Note, notebook, or export not found        |
| 410    | Export has expired                          |
| 422    | Invalid format or options                  |
| 429    | Rate limit exceeded (10 requests/min)      |
| 500    | Internal server error                      |
| 503    | Storage backend not configured             |

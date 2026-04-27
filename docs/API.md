# StoreAI HTTP API

All endpoints live under `/api`. Cookie-authenticated calls require the `x-sa-csrf` header on mutations. Bearer API keys (`Authorization: Bearer sk_<prefix>_<secret>`) bypass CSRF.

Every response is JSON of the form `{ "ok": true, "data": ... }` or `{ "ok": false, "error": { "code", "message", "requestId", "details?" } }`. The `requestId` is also returned in the `x-request-id` response header — quote it when filing bugs.

## Limits

| Limit | Value | Error code | HTTP |
| --- | --- | --- | --- |
| File upload | 50 MB | `validation_error` | 400 |
| Record `data` (serialized JSON) | 1 MB | `record_too_large` | 413 |
| Record `key` length | 120 chars | `validation_error` | 400 |
| `?key=` / `?keyPrefix=` query param | 255 chars | `validation_error` | 400 |

## Files — `POST /api/files`

Multipart upload. Required form parts:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `file` | binary | yes | The file to upload. |
| `projectId` | string (UUID) | no | Top-level form field. |
| `meta` | JSON string | no | `{ "projectId": "<uuid>" }`. Either `projectId` form field or `meta.projectId` is accepted; the top-level field is preferred. |

Response (`200 OK`):

```json
{
  "ok": true,
  "data": {
    "id": "...",
    "tenantId": "...",
    "projectId": "..." or null,
    "objectKey": "tenants/<tenant>/projects/<project>/<date>/<rand>-<name>",
    "originalName": "hello.txt",
    "sizeBytes": 11,
    "contentType": "text/plain",
    "createdAt": "2026-04-27T12:00:00.000Z",
    "downloadUrl": "https://<s3-host>/...&X-Amz-Expires=3600..."
  }
}
```

The `downloadUrl` is a short-lived presigned GET URL (1 hour TTL). Use it to fetch the bytes from S3/MinIO. To re-mint a URL later, call `GET /api/files/:id` (5-minute TTL) or `GET /api/files` (5-minute TTL).

Errors:

- `400 validation_error` — missing `file`, empty file, oversize file (>50 MB), or invalid content type.

## Records — `GET /api/records`

Query parameters:

| Param | Type | Notes |
| --- | --- | --- |
| `projectId` | UUID | Filter to one project. |
| `key` | string (≤255) | Exact-match lookup on `key`. |
| `keyPrefix` | string (≤255) | Prefix lookup on `key`. LIKE wildcards (`%`, `_`) and `\` are escaped. |
| `page` | int ≥1, default 1 | |
| `pageSize` | int 1..100, default 20 | |
| `sort` | `created_at` \| `-created_at` \| `updated_at` \| `-updated_at` | Default `-created_at`. |

Indexed by `(tenant_id, project_id, key)` — keyed lookups against a project are cheap regardless of project size.

Combine `key` and `keyPrefix` if you want; both are AND-ed.

Response:

```json
{
  "ok": true,
  "data": {
    "items": [ { "id": "...", "key": "...", "data": {...}, ... } ],
    "page": 1,
    "pageSize": 20,
    "total": 42
  }
}
```

## Records — `POST /api/records`

Body:

```json
{ "projectId": "<uuid>", "key": "my-key", "data": { "...": "..." } }
```

Errors:

- `400 validation_error` — missing/invalid fields, key over 120 chars.
- `413 record_too_large` — serialized `data` exceeds 1 MB. The limit is in the message.
- `404 not_found` — `projectId` is not in your tenant.

Same `record_too_large` check applies to `PATCH /api/records/:id`.

## Errors

In non-production (or when `STOREAI_VERBOSE_ERRORS=true`), unhandled errors include `err.message` in the response and `err.stack` as an extra `stack` field — useful when integrating against a self-hosted dev instance. In production, only the generic message is returned; check the server log for the matching `requestId`.

Common Postgres errors are mapped to specific codes before falling through to the generic 500: `unique_violation` (409), `foreign_key_violation` (409), `not_null_violation` (400), `check_violation` (400), `value_too_long` (400), `payload_too_large` (413).

# Errors

Anything other than a `2xx` returns the same shape.

```json
{ "error": "A sentence you can log", "code": "not_found" }
```

`error` is for a human reading a log. `code` is for a program deciding what to
do.

## The codes

| Status | `code` | Means | Retry? |
| --- | --- | --- | --- |
| 401 | `unauthorized` | Key missing, mistyped or revoked | No |
| 403 | `forbidden` | Missing a scope, or the call is account-wide and the key is not | No |
| 404 | `not_found` | No such object, or none this key may reach | No |
| 405 | `method_not_allowed` | The path exists but does not take that method | No |
| 409 | `conflict` | Already exists, a destructive call needs its confirmation flag, a recipient is blocked, or an idempotency key was reused with a different body | No |
| 413 | `payload_too_large` | Over 32 MB. Usually an attachment | No |
| 422 | `invalid_request` | A field is wrong, or the body has a field this API does not take. `param` names the field when it can | No |
| 429 | `rate_limited` | Too many calls this minute | Yes, after `Retry-After` |
| 500 | `server_error` | The instance failed. The reason is in its log, not in the reply | Yes |

## A missing scope

```json
{
  "error": "This API key does not have the \"mail:write\" scope",
  "code": "forbidden",
  "required_scope": "mail:write",
  "scopes": ["mail:read"]
}
```

`required_scope` is the one to add.

## A bad field

```json
{
  "error": "to: Required",
  "code": "invalid_request",
  "param": "to"
}
```

When several fields are wrong, every problem is listed in `error` and `param`
names the first, which is enough to highlight a form field.

A field this API does not take is refused the same way. A misspelt
`replyTo`, or a field copied from another email service, fails loudly instead
of being dropped:

```json
{
  "error": "Request body is not valid JSON for this endpoint: json: unknown field \"replyTo\"",
  "code": "invalid_request"
}
```

## A blocked recipient

A send to an address on the [blocked list](/docs/api/suppressions) is refused
before anything is written:

```json
{
  "error": "Blocked after an earlier bounce or complaint: gone@example.net",
  "code": "conflict",
  "suppressed": ["gone@example.net"]
}
```

## Rate limiting

```
HTTP/1.1 429
Retry-After: 43
X-RateLimit-Limit: 300
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1800000000
```

```json
{ "error": "Too many requests. Slow down.", "code": "rate_limited" }
```

## Why 404 and not 403

A key that cannot reach an object is told the object does not exist. That is
on purpose: a `403` confirms it *does* exist, which turns "no access" into a
way to enumerate what you cannot see.

So a `404` means one of two things, and the API will not tell you which:

- It is genuinely not there
- It is outside this key's [reach](/docs/api/scopes#reach)

Check with `GET /me` when you are unsure.

## Partial success

Two endpoints can half-work, and neither uses an error status for it.

**Batch sending** returns `207` when some messages failed:

```json
{
  "object": "batch",
  "sent": 2,
  "failed": 1,
  "data": [
    { "index": 0, "ok": true, "id": "msg_…", "thread_id": "thr_…", "delivery_status": "sent" },
    { "index": 1, "ok": false, "error": "to: Required", "status": 422 },
    { "index": 2, "ok": true, "id": "msg_…", "thread_id": "thr_…", "delivery_status": "queued" }
  ]
}
```

**Webhook ping and replay** return `502` with a full result body when your
endpoint failed. The call worked; the endpoint did not.

```json
{
  "object": "webhook_ping",
  "webhook_id": "whk_…",
  "delivery_id": "whd_…",
  "succeeded": false,
  "status_code": 500,
  "duration_ms": 87,
  "response_body": "Internal Server Error",
  "error": "Endpoint replied 500"
}
```

# Webhooks

Managing endpoints and reading their history. For what the events *are* and
how to check a signature, see [Webhooks](/docs/webhooks/index).

## List endpoints

```
GET /api/v1/webhooks
```

Scope: `webhooks:read`

```json
{
  "object": "webhook",
  "id": "whk_…",
  "url": "https://api.example.com/hooks/mail",
  "description": "Production receiver",
  "events": ["mail.received", "email.bounced"],
  "enabled": true,
  "mailbox_id": null,
  "domain_id": null,
  "last_status": 200,
  "last_delivered_at": "2026-09-21T09:58:02Z",
  "last_error_at": null,
  "last_error": null,
  "consecutive_failures": 0,
  "created_at": "2026-08-01T12:00:00Z"
}
```

The **secret is never returned on a read**. It is shown once, at creation, and
once more if you rotate it.

A key that reaches only part of the account sees only endpoints scoped to a
mailbox it reaches.

## Create

```
POST /api/v1/webhooks
```

Scope: `webhooks:write`

```json
{
  "url": "https://api.example.com/hooks/mail",
  "description": "Production receiver",
  "events": ["mail.received", "email.bounced"],
  "domain_id": "dom_…",
  "enabled": true
}
```

| Field | |
| --- | --- |
| `url` | **required**. Must be `https`. At most 2000 characters |
| `events` | Event names, or `["*"]` for everything **including events added later**. Defaults to `["*"]` |
| `mailbox_id` | Only fire for mail in this one mailbox |
| `domain_id` | Only fire for mail on this domain — every address on it, including ones added later |
| `description` | For your own reference. At most 500 characters |
| `enabled` | Defaults to `true` |

Give one of `mailbox_id` or `domain_id`, or neither. Both together is a
`422`: two answers to "what does this hear about" is a rule nobody can read
back off the endpoint. An unknown event name is a `422` too; `webhook.test`
cannot be subscribed to.

Returns `201` **with the signing secret**:

```json
{ "object": "webhook", "id": "whk_…", "secret": "whsec_…", "…": "…" }
```

> **Danger:** Store the secret now. It is shown here and never again. An
> endpoint that does not check the signature will accept anything anybody
> posts at it.

### Where an endpoint may point

The URL must be `https`, and it must not resolve to a private address.
Loopback, private and link-local ranges, multicast, cloud metadata hosts like
`169.254.169.254`, and the other special-purpose ranges are all refused. The
check runs again on every delivery, against the address actually connected
to, so a DNS record changed later does not get round it. Redirects are not
followed.

This is not decoration: Mails fetches the URL and stores the reply where the
key holder can read it, so an unchecked URL would be a way to read whatever
the server can reach — an internal admin page, a metadata service — from
outside.

`http://localhost` and `http://127.0.0.1` are allowed **only when `APP_URL`
is not `https`** — a development machine, where a local receiver is how one
gets tried out.

### Scope

Three widths, narrowest first:

| Scope | Hears about |
| --- | --- |
| `mailbox_id` | That one address |
| `domain_id` | Every address on that domain, including ones added later |
| neither | The whole account |

A domain is usually what you want when an account sends for more than one
of them: one endpoint per domain, rather than one per mailbox plus another
every time a mailbox is added.

### Reach applies

An unscoped webhook hears about every address, and a domain-scoped one hears
about every address on that domain. A key that reaches only part of the
account cannot create either, and cannot widen an existing one, because
either would be a way to receive mail the key cannot read.

A key restricted to named domains **may** scope a webhook to one of those
domains. A key restricted to named mailboxes may not scope to a domain at
all — the domain covers addresses the key was not given.

## Change

```
PATCH /api/v1/webhooks/:id
```

Scope: `webhooks:write`

```json
{ "enabled": true, "events": ["*"], "rotate_secret": false }
```

Takes `url`, `description`, `events`, `enabled`, `mailbox_id`, `domain_id` and
`rotate_secret`. Only what you send changes; `null` clears `description`,
`mailbox_id` or `domain_id`.

Turning an endpoint **back on also clears its failure count**, since that is
what somebody means by having fixed it.

`rotate_secret: true` replaces the secret and returns the new one, once.

## Turn off or delete

```
DELETE /api/v1/webhooks/:id
DELETE /api/v1/webhooks/:id?disable_only=true
```

Scope: `webhooks:write`

`disable_only` stops delivery but keeps the endpoint and its history, which is
usually what you want while something is being repaired. It returns the
endpoint. A plain delete takes the endpoint **and its deliveries** together:

```json
{ "object": "webhook", "id": "whk_…", "deleted": true }
```

## Test

```
POST /api/v1/webhooks/:id/ping
```

Scope: `webhooks:write`

Sends a `webhook.test` event and **waits for the answer**. Unlike a real event
it is not retried and not sent in the background: the point is to see, now,
whether the endpoint is reachable and whether it is checking the signature.
The attempt is recorded with the other deliveries.

```json
{
  "object": "webhook_ping",
  "webhook_id": "whk_…",
  "delivery_id": "whd_…",
  "succeeded": true,
  "status_code": 200,
  "duration_ms": 214,
  "response_body": "{\"ok\":true}",
  "error": null
}
```

`response_body` is the first 2 KB of what your endpoint answered.

A failure comes back as `502` **with this same body**, not as a bare error —
the call worked, the endpoint did not.

## Deliveries

```
GET /api/v1/webhook-deliveries
```

Scope: `webhooks:read`

Every attempt at every endpoint, newest first, with the status and the reply
that came back.

| Filter | |
| --- | --- |
| `webhook_id` | One endpoint |
| `event` | One event name |
| `succeeded` | `true` or `false` |
| `limit`, `cursor` | See [Pagination](/docs/api/pagination) |

```json
{
  "object": "webhook_delivery",
  "id": "whd_…",
  "event_id": "whd_…",
  "webhook_id": "whk_…",
  "event": "mail.received",
  "payload": { "email": { "…": "…" } },
  "attempt": 2,
  "status_code": 500,
  "response_body": "Internal Server Error",
  "error": "Endpoint replied 500",
  "duration_ms": 1204,
  "succeeded": false,
  "next_retry_at": null,
  "created_at": "2026-09-21T09:58:02Z"
}
```

Each attempt is its own row. `event_id` is shared by every attempt at the same
event, and is the `id` your endpoint saw in the envelope. `next_retry_at` is
set while an attempt is waiting to be made.

A delivery carries the payload of the event it was for, so a key that reaches
only part of the account sees only deliveries for endpoints scoped to a
mailbox it reaches.

## Replay

```
POST /api/v1/webhook-deliveries/:id/replay
```

Scope: `webhooks:write`

Sends a stored payload again, under the **same event id** — what an endpoint
that was down gets caught up with, once it is back.

```sh
# Everything that failed, again.
curl -s "$BASE/webhook-deliveries?succeeded=false&limit=100" -H "Authorization: Bearer $KEY" \
| jq -r '.data[].id' \
| xargs -I{} curl -s -X POST "$BASE/webhook-deliveries/{}/replay" -H "Authorization: Bearer $KEY"
```

Same reply shape as a ping, and the same `502`-with-a-body on failure.

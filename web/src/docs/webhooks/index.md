# Webhooks

Being told what happens to mail, rather than asking.

## What arrives

A `POST` with a JSON body, and these headers:

| Header | |
| --- | --- |
| `X-Mails-Event` | The event name |
| `X-Mails-Signature` | `t=<unix seconds>,v1=<hex>` |
| `X-Mails-Webhook-Id` | Which endpoint this came from |
| `Content-Type` | `application/json` |
| `User-Agent` | `Mails-Webhooks/1` |

The body is always the same envelope:

```json
{
  "id": "whd_9f2c…",
  "object": "event",
  "type": "mail.received",
  "created_at": "2026-09-21T09:58:02.000Z",
  "data": { "email": { "…": "…" } }
}
```

`id` is the **event id**. It is the same on every retry of the event and on
every replay of it, so a repeat can be recognised and ignored.

## Setting one up

Two ways, and they do the same thing:

- **Settings → Webhooks** in the app
- [`POST /api/v1/webhooks`](/docs/api/webhooks#create)

Either way the reply carries the **signing secret**, shown once and never
again.

The URL must be `https`, and must not resolve to a private, loopback,
link-local or cloud metadata address. See
[Where an endpoint may point](/docs/api/webhooks#where-an-endpoint-may-point).

## What to do in a handler

1. Read the **raw body** as text. Not a parsed object.
2. [Verify the signature](/docs/webhooks/verifying) against it.
3. Answer `2xx` **quickly**. Do the slow part after, or on a queue.
4. Ignore an `id` you have already seen.

A handler that takes ten seconds is a handler that gets retried, because the
timeout is ten seconds.

## Next

- [The events](/docs/webhooks/events): all twelve, and what is in each
- [Verifying a call](/docs/webhooks/verifying): with code that works
- [Retries and replays](/docs/webhooks/retries): what happens when you are down

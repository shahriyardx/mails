# Messages and files

Threads are the better way to read a conversation. These endpoints are for
when a program wants **messages themselves** — everything that arrived since a
stamp, everything from one sender, everything unread.

## List

```
GET /api/v1/messages
```

Scope: `mail:read`

| Filter | |
| --- | --- |
| `direction` | `inbound` or `outbound` |
| `folder` | `inbox`, `sent`, `drafts`, `archive`, `spam`, `trash`, or `all` |
| `thread_id` | Everything in one conversation |
| `drafts` | `true` for only drafts, `false` to exclude them |
| `unread`, `starred` | `true` or `false` |
| `from` | Exact sender address |
| `to` | Exact recipient address, in `to`, `cc` or `bcc` |
| `subject` | Substring |
| `q` | Full text over subject, sender and body, plus the [search filters](/docs/api/threads#search-filters) |
| `status` | Delivery statuses, comma-separated. Sent mail only |
| `opened` | `true` or `false` |
| `api_key_id` | Only mail sent by one key |
| `since`, `until` | Against `received_at`. An ISO 8601 time, or milliseconds since 1970 |
| `include_body` | `true` to include `text` and `html`. Off by default |
| `mailbox_id`, `mailbox`, `domain` | Narrow to part of the account |
| `limit`, `cursor` | See [Pagination](/docs/api/pagination) |

Bodies are left out by default because they are large and a list of fifty of
them is mostly HTML you did not ask for.

## Read one

```
GET /api/v1/messages/:id
```

Scope: `mail:read`

The message with its body, its files and its events. The SES message id works
as well as the id.

```json
{
  "object": "message",
  "id": "msg_…",
  "thread_id": "thr_…",
  "mailbox_id": "mbx_…",
  "mailbox": "support@example.com",
  "message_id": "<CAO…@mail.gmail.com>",
  "in_reply_to": null,
  "references": [],
  "from": { "name": "Ada", "address": "ada@example.net" },
  "to": [{ "name": null, "address": "support@example.com" }],
  "cc": [],
  "bcc": [],
  "reply_to": null,
  "subject": "Refund for order 4821",
  "snippet": "Hi — I'd like to return…",
  "folder": "inbox",
  "direction": "inbound",
  "is_read": false,
  "is_starred": false,
  "is_draft": false,
  "has_attachments": true,
  "size_bytes": 48211,
  "spf": null,
  "dkim": null,
  "dmarc": null,
  "spam_score": null,
  "mailed_by": null,
  "signed_by": null,
  "tls": null,
  "ses_message_id": null,
  "status": null,
  "error": null,
  "opened_at": null,
  "open_count": 0,
  "api_key_id": null,
  "sent_at": "2026-09-20T14:03:09Z",
  "received_at": "2026-09-20T14:03:11Z",
  "created_at": "2026-09-20T14:03:12Z",
  "text": "…",
  "html": "…",
  "attachments": [ … ],
  "events": []
}
```

`ses_message_id`, `status`, `error`, `opened_at` and `events` are about sent
mail, and stay empty on mail you received.

### The authentication fields

`spf`, `dkim`, `dmarc`, `mailed_by`, `signed_by` and `tls` are what
Cloudflare checked when the message arrived. They are `null` until the
inbound worker is told to trust Cloudflare's results (`TRUST_AUTH_RESULTS`),
because nothing in a message proves Cloudflare wrote that header. See
[Receiving mail](/docs/guide/receiving).

`spam_score` is always `null`. The only score a message could carry is one the
sender wrote.

## Change one

```
PATCH /api/v1/messages/:id
```

Scope: `mail:write`

```json
{ "is_read": true, "is_starred": true }
```

Read and star **one message**, rather than the whole thread. The thread's
counts are recomputed afterwards.

## The original message

```
GET /api/v1/messages/:id/raw
```

Scope: `mail:read`

Returns `message/rfc822` bytes — the message exactly as it arrived. Pipe it
into a MIME parser, re-send it, or keep it for an audit.

```sh
curl "https://mail.yourdomain.com/api/v1/messages/msg_…/raw" \
  -H "Authorization: Bearer mk_live_..." \
  -o message.eml
```

Only **inbound** mail has one. Outbound mail is assembled at send time and its
wire form is not stored, so asking for it returns `404`.

A `404` here can also mean the row outlived the object — a bucket lifecycle
rule, or a restore that did not bring everything back.

## Attachments

```
GET /api/v1/attachments/:id
```

Scope: `mail:read`

```json
{
  "object": "attachment",
  "id": "att_…",
  "message_id": "msg_…",
  "filename": "invoice.pdf",
  "content_type": "application/pdf",
  "size_bytes": 84213,
  "content_id": null,
  "is_inline": false,
  "created_at": "2026-09-20T14:03:12Z",
  "download_url": "https://…",
  "download_url_expires_in": 300
}
```

`download_url` is a signed link straight to storage, good for **five
minutes**. Use it for anything large or headed to a browser: it does not spend
your rate limit and the bytes never pass through the app.

For a small file, `?download=true` returns the bytes directly and saves a
second request.

An attachment is only reachable **through a message this key may read**.
Files uploaded in the dashboard and not yet sent are not reachable at all.

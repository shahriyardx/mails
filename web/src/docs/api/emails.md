# Emails

Sending, and looking at what was sent.

## Send one

```
POST /api/v1/emails
```

Scope: `emails:send`

```sh
curl -X POST https://mail.yourdomain.com/api/v1/emails \
  -H "Authorization: Bearer mk_live_..." \
  -H "Idempotency-Key: receipt-4821" \
  -H "Content-Type: application/json" \
  -d '{
    "from": "Receipts <receipts@example.com>",
    "to": ["customer@example.net"],
    "cc": "manager@example.net",
    "reply_to": "support@example.com",
    "subject": "Your receipt",
    "html": "<p>Thanks for your order.</p>",
    "text": "Thanks for your order.",
    "headers": { "X-Order-Id": "4821" }
  }'
```

| Field | | |
| --- | --- | --- |
| `from` | **required** | An address on a verified domain. `Name <a@b.c>` works. Without a name, the mailbox's display name is used |
| `to` | **required** | A string or an array |
| `cc`, `bcc` | | A string or an array. At most 50 recipients across `to`, `cc` and `bcc` |
| `reply_to` | | One address |
| `subject` | | Defaults to empty. At most 998 characters |
| `html`, `text` | | Send either, or both. The missing one is made from the other |
| `headers` | | Extra headers, as a flat object. See below |
| `attachments` | | Files, inline in the request. See below |
| `attachment_ids` | | Ids of files on messages this key can read, to send them on — forwarding, in other words |
| `thread_id` | | Add this message to an existing thread of the sending mailbox. A thread of another mailbox is ignored and a new one is started |
| `in_reply_to`, `references` | | Threading headers, if you are building them yourself |

That is the whole list. Any other field is a `422`, so a misspelt or borrowed
field fails loudly instead of being dropped. Mails sends now, and sends what
you give it.

Returns `202`:

```json
{
  "id": "msg_…",
  "message_id": "<…@example.com>",
  "ses_message_id": "0100018f…",
  "thread_id": "thr_…",
  "from": "receipts@example.com",
  "to": ["customer@example.net"],
  "subject": "Your receipt",
  "status": "sent"
}
```

`202`, not `200`: SES has accepted it, and whether it was *delivered* comes
later — as a `status` on the message, and as an
[`email.delivered` webhook](/docs/webhooks/events).

### What `status` means

| | |
| --- | --- |
| `sent` | Handed to SES. The usual answer |
| `queued` | SES could not take it right now. It will keep trying. An `error` field says why |

`queued` is not an error and needs nothing from you. Each send gets one
attempt at SES straight away. A refusal that will still be true in an hour —
an unverified identity, a rejected message, a suspended account — returns a
`422` instead and records nothing:

```json
{ "error": "SES refused this message: …", "code": "invalid_request" }
```

Anything else, from throttling to a dropped socket, goes into the
[send queue](/docs/guide/queue) and is retried up to eight attempts in all,
with the gap growing from 30 seconds to 15 minutes. `email.sent` fires when it
goes out, and `email.failed` if the attempts run out.

### Blocked recipients

A recipient on the [blocked list](/docs/api/suppressions) stops the whole send
with a `409`, and the reply names who:

```json
{
  "error": "Blocked after an earlier bounce or complaint: gone@example.net",
  "code": "conflict",
  "suppressed": ["gone@example.net"]
}
```

### Headers

Any header that is not one Mails sets itself. These are refused with a `422`:
`From`, `To`, `Cc`, `Bcc`, `Subject`, `Date`, `Message-ID`, `Reply-To`,
`In-Reply-To`, `References`, `MIME-Version`, `Sender`, `Return-Path`,
`Content-Type`, `Content-Transfer-Encoding`, `Content-Disposition`,
`DKIM-Signature`, `Received`, `Authentication-Results`. A value with a line
break is refused too.

### Attachments

```json
{
  "attachments": [
    {
      "filename": "invoice.pdf",
      "content": "JVBERi0xLjQKJ…",
      "content_type": "application/pdf"
    },
    {
      "filename": "logo.png",
      "content": "iVBORw0KGgo…",
      "content_id": "logo"
    }
  ]
}
```

`content` is base64; a `data:` prefix is stripped for you. Setting
`content_id` embeds the file instead of attaching it, so `<img src="cid:logo">`
in your HTML shows it inline.

At most **20 files** per message, counting `attachments` and `attachment_ids`
together.

## Call one off

```
POST /api/v1/emails/:id/cancel
```

Scope: `emails:send`

Works on a message still waiting in the queue because SES was busy. Returns
the message with `status: "canceled"`, and fires `email.canceled`.

Answers `409` for anything else: a message that went out, failed, or that a
worker picked up a moment ago. At that point it is on its way to SES and there
is nothing left to stop, and saying otherwise would be a lie you would go on
to build on.

## Send a batch

```
POST /api/v1/emails/batch
```

Scope: `emails:send`

```json
[
  { "from": "news@example.com", "to": "a@example.net", "subject": "Hi", "text": "…" },
  { "from": "news@example.com", "to": "b@example.net", "subject": "Hi", "text": "…" }
]
```

An object with an `emails` array works too.

Up to **100** messages. Every one is attempted, in order, one at a time — SES
meters sends per second, and firing a hundred at once is the fastest way to be
throttled for all of them.

`202` when all were accepted, `207` when some were not:

```json
{
  "object": "batch",
  "sent": 1,
  "failed": 1,
  "data": [
    { "index": 0, "ok": true, "id": "msg_…", "thread_id": "thr_…", "delivery_status": "sent" },
    { "index": 1, "ok": false, "error": "This API key cannot send as x@y.z", "status": 403 }
  ]
}
```

So you can branch on the status without counting. A successful item carries
`delivery_status` (`sent` or `queued`); a failed one carries the HTTP `status`
it would have had on its own.

An `Idempotency-Key` covers the whole batch. See
[Idempotency](/docs/api/idempotency).

## List what was sent

```
GET /api/v1/emails
```

Scope: `emails:read`

Outbound mail only, drafts left out: they are outbound, but they have not been
sent.

| Filter | |
| --- | --- |
| `status` | One or several of `queued`, `sent`, `delivered`, `bounced`, `complained`, `rejected`, `delayed`, `failed`, `canceled`. Comma-separated |
| `from` | Exact sender address |
| `to` | Exact recipient address, in `to`, `cc` or `bcc` |
| `subject` | Substring |
| `q` | Full text over subject and body |
| `opened` | `true` or `false` |
| `api_key_id` | Only mail sent by one key |
| `thread_id` | Only mail in one thread |
| `folder` | `sent`, `trash`, … or `all` |
| `unread`, `starred` | `true` or `false` |
| `since`, `until` | An ISO 8601 time, or milliseconds since 1970 |
| `mailbox_id`, `mailbox`, `domain` | Narrow to part of the account |
| `limit`, `cursor` | See [Pagination](/docs/api/pagination) |

```sh
curl "https://mail.yourdomain.com/api/v1/emails?status=bounced,complained&since=2026-09-01T00:00:00Z" \
  -H "Authorization: Bearer mk_live_..."
```

`since` and `until` take a full time, not a bare date: `2026-09-01` is a `422`.

## Read one

```
GET /api/v1/emails/:id
```

Scope: `emails:read`

Returns the message with its body, its files, and **every SES event seen for
it so far**:

```json
{
  "object": "message",
  "id": "msg_…",
  "direction": "outbound",
  "status": "bounced",
  "error": "smtp; 550 5.1.1 user unknown",
  "opened_at": null,
  "open_count": 0,
  "api_key_id": "key_…",
  "sent_at": "2026-09-21T09:58:00Z",
  "text": "…",
  "html": "…",
  "attachments": [ … ],
  "events": [
    { "object": "event", "id": "evt_…", "type": "send", "recipient": "a@b.c", "detail": null, "occurred_at": "…" },
    { "object": "event", "id": "evt_…", "type": "bounce", "recipient": "a@b.c", "detail": "Permanent/General", "occurred_at": "…" }
  ]
}
```

The id from a send works, and so does the **SES message id** — which is what a
bounce report or a webhook hands you. An inbound message is a `404` here; read
it through [Messages](/docs/api/messages).

Events and later statuses need delivery reporting set up. See
[Sending domains](/docs/guide/domains).

## A note on opens

`opened_at` means the tracking image was loaded. Apple Mail and Gmail fetch
images through their own servers, so an open is evidence of **delivery**, not
proof anybody read it.

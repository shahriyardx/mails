# The events

Twelve, plus a test. Subscribe with a list of names, or `["*"]` for everything,
including events added later.

| Event | When |
| --- | --- |
| `mail.received` | A message arrived in a mailbox |
| `email.sent` | A message was handed to SES |
| `email.delivered` | The receiving server accepted it |
| `email.bounced` | It came back |
| `email.complained` | Somebody marked it as spam |
| `email.opened` | The tracking image was loaded |
| `email.clicked` | A tracked link was followed |
| `email.delayed` | SES is still trying |
| `email.rejected` | SES refused to send it |
| `email.failed` | It could not be handed to SES, and no attempts are left |
| `email.canceled` | A queued message was called off before it went out |
| `thread.updated` | A thread was moved, read, starred or labelled through the API |

`webhook.test` is sent only by a [ping](/docs/api/webhooks#test). It is
deliberately **not** in the subscribable list, because sending a test under a
real event name would have a receiver record something that never happened.

> **Warning:** The delivery events need SES event reporting.
> `email.delivered`, `email.bounced`, `email.complained`, `email.opened`,
> `email.clicked`, `email.delayed` and `email.rejected` come from SES's own
> reporting. They fire only when `SES_CONFIGURATION_SET` names a
> configuration set that publishes to an SNS topic, and `SES_SNS_TOPIC_ARN`
> is set to that topic. Without both, they never fire. See
> [Self-hosting](/docs/guide/self-hosting).
>
> `email.sent`, `email.failed` and `email.canceled` come from the app itself,
> so they arrive either way.

## mail.received

```json
{
  "id": "whd_…",
  "object": "event",
  "type": "mail.received",
  "created_at": "2026-09-21T09:58:02.000Z",
  "data": {
    "email": {
      "id": "msg_…",
      "thread_id": "thr_…",
      "mailbox_id": "mbx_…",
      "mailbox": "support@example.com",
      "message_id": "<CAO…@mail.gmail.com>",
      "from": { "name": "Ada", "address": "ada@example.net" },
      "to": [{ "name": null, "address": "support@example.com" }],
      "delivered_to": "support@example.com",
      "subject": "Refund for order 4821",
      "snippet": "Hi, I'd like to return…",
      "folder": "inbox",
      "has_attachments": true,
      "spf": null,
      "dkim": null,
      "dmarc": null,
      "spam_score": null,
      "mailed_by": null,
      "signed_by": null,
      "tls": null,
      "received_at": "2026-09-21T09:58:01.000Z"
    }
  }
}
```

`delivered_to` is the address this copy actually arrived at, which differs
from `mailbox` when a catch-all caught it.

`spf`, `dkim`, `dmarc`, `mailed_by`, `signed_by` and `tls` are `null` unless
the inbound worker is set to trust Cloudflare's authentication results. See
[Receiving mail](/docs/guide/receiving). `spam_score` is always `null`.

The body is **not** included: it can be megabytes. Fetch it with
[`GET /messages/:id`](/docs/api/messages#read-one) when you need it.

A message that arrives twice with the same `Message-ID` fires once.

## email.sent

`data.email` is the full [message object](/docs/api/messages#read-one), as
`GET /messages/:id` returns it, without `text` and `html`.

```json
{
  "type": "email.sent",
  "data": {
    "email": {
      "object": "message",
      "id": "msg_…",
      "thread_id": "thr_…",
      "mailbox_id": "mbx_…",
      "mailbox": "receipts@example.com",
      "message_id": "<…@example.com>",
      "ses_message_id": "0100018f…",
      "from": { "name": "Receipts", "address": "receipts@example.com" },
      "to": [{ "name": null, "address": "customer@example.net" }],
      "cc": [],
      "subject": "Your receipt",
      "direction": "outbound",
      "status": "sent",
      "error": null,
      "api_key_id": "key_…",
      "sent_at": "2026-09-21T09:58:00.000Z",
      "attachments": [],
      "events": [],
      "…": "…"
    }
  }
}
```

`api_key_id` is set when the message came in through the API, so you can tell
a script's mail from a person's.

It fires when SES accepts the message: straight away on a normal send, or
later when the [send queue](/docs/guide/queue) gets it out.

## The delivery events

`email.delivered`, `email.bounced`, `email.complained`, `email.opened`,
`email.clicked`, `email.delayed` and `email.rejected` all carry the same
shape:

```json
{
  "type": "email.bounced",
  "data": {
    "email": {
      "id": "msg_…",
      "thread_id": "thr_…",
      "mailbox_id": "mbx_…",
      "mailbox": "receipts@example.com",
      "ses_message_id": "0100018f…",
      "message_id": "<…@example.com>",
      "from": "receipts@example.com",
      "to": [{ "name": null, "address": "gone@example.net" }],
      "subject": "Your receipt",
      "status": "bounced"
    },
    "recipients": ["gone@example.net"],
    "detail": "Permanent/General",
    "occurred_at": "2026-09-21T09:58:40Z"
  }
}
```

`recipients` is **which addresses this event was about**. A message to five
people can bounce for one of them, and `to` still lists all five.

`detail` depends on the event:

| Event | `detail` |
| --- | --- |
| `email.bounced` | The bounce type and subtype, e.g. `Permanent/General` |
| `email.complained` | The feedback type SES gave, else `complaint` |
| `email.delayed` | The delay type |
| `email.clicked` | The link that was followed |
| `email.rejected` | The reason SES gave |
| the others | `null` |

`status` is the message's status after this event. Statuses only move
forward, so a late `email.delayed` after a delivery leaves it `delivered`.

SNS can deliver one notification more than once. Mails records each one once,
so a redelivery never fires a second webhook.

## email.failed and email.canceled

Both are about this app's [send queue](/docs/guide/queue) rather than about
SES, and both carry the same `email` object as `email.sent`.

`email.failed` fires when a queued message could not be handed to SES and the
attempts have run out, or SES refused it for good. The reason is on the
message:

```json
{
  "type": "email.failed",
  "data": {
    "email": { "id": "msg_…", "status": "failed", "error": "Maximum sending rate exceeded", "…": "…" }
  }
}
```

`email.canceled` fires when a queued message is called off with
[`POST /emails/:id/cancel`](/docs/api/emails#call-one-off).

## thread.updated

Fires when a thread is changed through
[`PATCH /threads/:id`](/docs/api/threads#change-one). Not when it changes in
the web app, and not when a new message arrives.

```json
{
  "type": "thread.updated",
  "data": {
    "thread": { "object": "thread", "id": "thr_…", "folders": ["archive"], "…": "…" },
    "changes": { "folder": "archive", "is_read": true }
  }
}
```

`data.thread` is the thread as it now is, without its messages. `data.changes`
is the body of the `PATCH` that caused it.

## webhook.test

```json
{
  "type": "webhook.test",
  "data": { "message": "This is a test from Mails.", "webhook_id": "whk_…" }
}
```

## Which endpoints hear what

| The endpoint | Hears |
| --- | --- |
| No `mailbox_id` or `domain_id` | Every event on the account |
| A `mailbox_id` | Only events for that mailbox |
| A `domain_id` | Events for every mailbox on that domain, including ones added later |

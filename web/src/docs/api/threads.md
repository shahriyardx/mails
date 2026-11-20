# Threads

A thread is a conversation. Inbound mail lives in threads, and this is the
endpoint that makes an inbox readable from outside the app.

## List

```
GET /api/v1/threads
```

Scope: `mail:read`

| Filter | |
| --- | --- |
| `folder` | `inbox`, `sent`, `drafts`, `archive`, `spam`, `trash`, `starred`, or `all` (the default) |
| `label_id` / `label` | By id or by name |
| `q` | Full text across every message in the thread, plus sender and subject |
| `unread` | `true` for threads with anything unread, `false` for none |
| `starred`, `has_attachments` | `true` or `false` |
| `participant` | Anybody on the conversation, by address |
| `subject` | Substring |
| `since`, `until` | Against `last_message_at`. An ISO 8601 time, or milliseconds since 1970 |
| `mailbox_id`, `mailbox`, `domain` | Narrow to part of the account |
| `limit`, `cursor` | See [Pagination](/docs/api/pagination) |

```json
{
  "object": "thread",
  "id": "thr_…",
  "mailbox_id": "mbx_…",
  "mailbox": "support@example.com",
  "mailbox_color": "#6366f1",
  "domain": "example.com",
  "subject": "Refund for order 4821",
  "snippet": "Hi — I'd like to return…",
  "folders": ["inbox"],
  "participants": [{ "name": "Ada", "address": "ada@example.net" }],
  "message_count": 3,
  "unread_count": 1,
  "is_starred": false,
  "has_attachments": true,
  "last_message_at": "2026-09-20T14:03:11Z",
  "created_at": "2026-09-19T08:40:02Z",
  "labels": [{ "object": "label", "id": "lbl_…", "name": "Refunds", "color": "#8a8a8a", "created_at": "…" }]
}
```

`folders` is a list because a thread can have messages in more than one — a
conversation you replied to sits in both `inbox` and `sent`.

`starred` as a folder means starred threads outside the trash.

## Read one

```
GET /api/v1/threads/:id
```

Scope: `mail:read`

Returns the thread with **every message in it**, oldest first, bodies and
attachments included. Add `?include_body=false` for a lighter reply when only
the shape matters.

## Change one

```
PATCH /api/v1/threads/:id
```

Scope: `mail:write`

```json
{
  "folder": "archive",
  "is_read": true,
  "is_starred": false,
  "add_labels": ["Refunds"],
  "remove_labels": ["Needs reply"]
}
```

Every field is optional and only what you send is changed, so archiving and
marking read is one call rather than a read followed by two writes. Returns
the thread, without its messages.

`folder` is one of `inbox`, `archive`, `spam` or `trash`. Mail you sent stays
in `sent` when a thread is archived or marked as spam, and goes back to
`sent` when it comes out of the trash.

Labels may be given **by name or by id**. An unknown one is a `422` and
**nothing is changed** — the labels are resolved before anything is written,
so you never get an error alongside a move that already happened.

Drafts stay where they are when `folder` is set. Moving one into the archive
would lose the only place the composer looks for it.

Every call also sends a [`thread.updated` webhook](/docs/webhooks/events).

## Reply

```
POST /api/v1/threads/:id/reply
```

Scope: `mail:write`

```json
{ "text": "Refunded — sorry for the trouble.", "reply_all": true }
```

The reply goes out from the thread's own mailbox. Who it goes to, what it is
called, and the headers that keep it threaded are all read off the last
message. Each can be overridden:

| Field | |
| --- | --- |
| `text`, `html` | The reply. Either, or both |
| `reply_all` | Also answer everyone else on the last message |
| `to`, `cc`, `bcc` | Replace the worked-out recipients entirely |
| `subject` | Defaults to `Re: …` |
| `quote` | Append the message being answered. **On by default** |
| `headers`, `attachments` | As on a [normal send](/docs/api/emails#send-one) |

Answering mail you received goes to its `Reply-To`, or else its sender.
Answering your own last message goes to the same people again. Your own
address is never added.

Returns `202` with the same body as a send. Like a send, it honours an
[`Idempotency-Key`](/docs/api/idempotency), so a retry cannot answer twice.

## Delete

```
DELETE /api/v1/threads/:id
```

Scope: `mail:write`

To the trash, and **out of it for good on a second call**. `?permanent=true`
skips the trash.

```json
{ "object": "thread", "id": "thr_…", "deleted": true, "permanent": false }
```

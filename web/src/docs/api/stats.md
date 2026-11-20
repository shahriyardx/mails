# Statistics

How much was sent and received, and how it landed.

```
GET /api/v1/stats
```

Scope: `stats:read`

| Parameter | |
| --- | --- |
| `days` | A window ending now. 1 to 365. **30** by default |
| `since`, `until` | An explicit window: an ISO 8601 time or a date like `2026-09-14`. `since` overrides `days` |
| `mailbox_id`, `mailbox`, `domain` | Narrow to part of the account |

```sh
curl "https://mail.yourdomain.com/api/v1/stats?days=7" \
  -H "Authorization: Bearer mk_live_..."
```

```json
{
  "object": "stats",
  "since": "2026-09-14T10:00:00Z",
  "until": "2026-09-21T10:00:00Z",
  "sending": {
    "sent": 1284,
    "delivered": 1249,
    "bounced": 21,
    "complained": 1,
    "failed": 3,
    "opened": 611,
    "total_opens": 903,
    "bounce_rate": 1.64,
    "complaint_rate": 0.08,
    "open_rate": 47.59
  },
  "receiving": { "received": 312, "threads": 189, "unread": 7 },
  "drafts": 4,
  "bytes": 48123904,
  "days": [
    { "day": "2026-09-14", "sent": 180, "received": 44, "delivered": 176, "bounced": 3, "opened": 84 }
  ],
  "mailboxes": [
    { "id": "mbx_…", "address": "receipts@example.com", "sent": 1102, "received": 0 }
  ]
}
```

## What is counted

- `sending.sent` is outbound mail that reached SES. Drafts are not counted,
  and neither is mail still `queued`, `canceled` or `failed`.
- `delivered` counts complaints too: a complaint could not exist otherwise.
- `failed` is mail the [send queue](/docs/guide/queue) gave up on.
- `receiving.received` and `receiving.threads` are within the window:
  messages that arrived, and the conversations they arrived in.
- `receiving.unread`, `drafts` and `bytes` are **not** limited to the window.
  They are the current state — unread threads in the inbox, drafts waiting,
  and the size of everything stored.

## The rates

`bounce_rate`, `complaint_rate` and `open_rate` are **shares of sent mail out
of 100**, with two decimals — so `1.64` is 1.64%, not 164%.

| | SES starts warning above |
| --- | --- |
| `bounce_rate` | **5** |
| `complaint_rate` | **0.1** |

Watching these two is the single most useful thing this endpoint is for. A
bounce rate climbing past 3 is worth investigating before AWS does it for you.

Delivered, bounced, complained and opened all come from SES's own reporting.
Without [delivery reporting](/docs/guide/domains) set up they stay at zero.

`open_rate` counts messages whose tracking image was loaded. Apple Mail and
Gmail fetch images through their own servers, so treat it as evidence of
delivery rather than proof of reading.

## Days

`days` has a row for each UTC day **that had any mail**. Quiet days are left
out, so a chart should fill the gaps with zeros.

## Mailboxes

Every mailbox in reach, by address, with what it sent and received in the
window. `received` is 0 for a send-only address, which makes it easy to see
which mailboxes are doing what.

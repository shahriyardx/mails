# Sending

## One message

```ts
const sent = await mail.emails.send({
  from: "Support <support@yourdomain.com>",
  to: ["a@example.net", "b@example.net"],
  cc: "manager@example.net",
  bcc: "archive@yourdomain.com",
  reply_to: "noreply@yourdomain.com",
  subject: "Your order shipped",
  html: "<h1>On its way</h1>",
  text: "On its way",
  headers: { "X-Order-Id": "4821" },
});

console.log(sent.id, sent.ses_message_id, sent.thread_id);
```

`to`, `cc` and `bcc` take a string or an array, and `Name <address>` is
understood. At most 50 recipients across all three.

`from` has to be an address on a verified domain. The mailbox is created the
first time you send from a new address, as long as your key reaches that
domain.

Send nothing else. A field the API does not take is a `ValidationError`,
not something quietly ignored.

## When it does not go out at once

```ts
const sent = await mail.emails.send({ /* … */ });

if (sent.status === "queued") {
  // SES could not take it right now. It is in the queue and will keep trying.
}
```

A send SES refuses for good throws. Anything else (throttling, an outage, a
dropped socket) comes back `queued`, and the [send queue](/docs/guide/queue)
carries it from there. You do not have to do anything about it.

A recipient on the [blocked list](/docs/api/suppressions) stops the whole
send with a `ConflictError`; `error.body.suppressed` lists the addresses.

While it is still waiting, you can call it off:

```ts
await mail.emails.cancel(sent.id);
```

That throws `ConflictError` once the message has been picked up for sending.
There is nothing left to stop by then.

## Attachments

```ts
import { readFile } from "node:fs/promises";

const pdf = await readFile("invoice.pdf");

await mail.emails.send({
  from: "receipts@yourdomain.com",
  to: "customer@example.net",
  subject: "Your invoice",
  html: '<p>Attached.</p><img src="cid:logo">',
  attachments: [
    {
      filename: "invoice.pdf",
      content: pdf.toString("base64"),
      content_type: "application/pdf",
    },
    {
      filename: "logo.png",
      content: logoBase64,
      content_id: "logo", // embeds it, rather than attaching it
    },
  ],
});
```

At most **20 files**, and 32 MB for the whole request. Base64 adds about a
third, so that is roughly 24 MB of actual file.

## Sending exactly once

```ts
await mail.emails.send(
  { from: "receipts@yourdomain.com", to: "a@b.c", subject: "Receipt #4821" },
  { idempotencyKey: "receipt-4821" },
);
```

Repeat the call with the same key and you get the first reply back, not a
second message. Keys last 24 hours. `sendBatch` and `threads.reply` take a key
the same way, and these three are the only `POST`s the client retries on its
own after a timeout or a `5xx` (see [Errors](/docs/sdk/errors#retries)).

Use something **meaningful**: `receipt-4821`, not a UUID made at call time. A
fresh UUID on a retry is a different key and protects nothing.

It also switches automatic retries on for that call, since repeating it is now
safe.

## Many at once

```ts
const result = await mail.emails.sendBatch([
  { from: "news@yourdomain.com", to: "a@example.net", subject: "Hi", text: "…" },
  { from: "news@yourdomain.com", to: "b@example.net", subject: "Hi", text: "…" },
]);

console.log(`${result.sent} sent, ${result.failed} failed`);

for (const item of result.data) {
  if (!item.ok) console.error(`#${item.index}:`, item.error);
}
```

Up to **100**. Every one is attempted, so one bad address does not throw the
rest away. This does **not** throw when some fail: check `result.failed`.

Each item carries `index` and `ok`. A sent one adds `id`, `thread_id` and
`delivery_status` (`sent` or `queued`); a failed one adds `error` and
`status`, the HTTP status that message alone would have got.

## Replying to a conversation

```ts
await mail.threads.reply(threadId, {
  text: "Refunded. Sorry for the trouble.",
  reply_all: true,
});
```

Recipients, subject and the headers that keep it threaded come off the last
message. See [Reading mail](/docs/sdk/reading#replying).

## What was sent

```ts
const page = await mail.emails.list({
  status: ["bounced", "complained"],
  since: new Date(Date.now() - 7 * 24 * 3600 * 1000),
  limit: 50,
});

for (const message of page.data) {
  console.log(message.to[0]?.address, message.status, message.error);
}
```

A `Date` is serialised for you. So is an array: `status` goes out
comma-separated. A string for `since` or `until` can be a full timestamp
(`2026-09-01T00:00:00Z`) or a bare date (`2026-09-01`, midnight UTC).

## One send in full

```ts
const detail = await mail.emails.get(sent.id);

console.log(detail.status);     // "delivered" | "bounced" | …
console.log(detail.opened_at);  // when the tracking image loaded, or null
console.log(detail.events);     // every SES event seen for it
```

The SES message id works here too, which is what a bounce report or a webhook
hands you.

## A worked example

Receipts, with a per-order idempotency key and bad addresses flagged:

```ts
import { Mails, isMailsError } from "@shahriyardx/mails";

const mail = new Mails();

export async function sendReceipt(order: Order) {
  try {
    return await mail.emails.send(
      {
        from: "Receipts <receipts@yourdomain.com>",
        to: order.customerEmail,
        subject: `Receipt for order ${order.id}`,
        html: receiptHtml(order),
        headers: { "X-Order-Id": String(order.id) },
      },
      { idempotencyKey: `receipt-${order.id}` },
    );
  } catch (error) {
    if (isMailsError(error) && error.code === "invalid_request") {
      // A bad address is the order's problem, not something to retry.
      await flagBadEmail(order.id, error.message);
      return null;
    }
    throw error;
  }
}
```

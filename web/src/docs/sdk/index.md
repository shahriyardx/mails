# The Node SDK

```sh
npm install @shahriyardx/mails
```

The whole API, typed, with **no dependencies**: one `fetch` and Web Crypto.
Node 18 or newer, and anywhere else `fetch` exists: Workers, Deno, Bun, the
browser. Ships ESM, CommonJS and types.

The source is in `packages/sdk` in the repository, under the MIT licence, so
your application can use it whatever you are doing.

## Start

```ts
import { Mails } from "@shahriyardx/mails";

const mail = new Mails({
  apiKey: process.env.MAILS_API_KEY,
  baseUrl: "https://mail.yourdomain.com",
});

const me = await mail.me();
console.log(me.name, me.scopes, me.reach);

await mail.emails.send({
  from: "receipts@yourdomain.com",
  to: "customer@example.net",
  subject: "Your receipt",
  html: "<p>Thanks.</p>",
});
```

`Mails` is also the default export. CommonJS is the same:

```js
const { Mails } = require("@shahriyardx/mails");
```

## Settings

```ts
const mail = new Mails({
  apiKey: process.env.MAILS_API_KEY,   // default: process.env.MAILS_API_KEY
  baseUrl: "https://mail.yourdomain.com", // default: process.env.MAILS_BASE_URL
  timeout: 30_000,                     // ms to wait for a reply
  maxRetries: 2,                       // extra tries after a 429, 5xx or dropped socket
  headers: { "X-Trace-Id": "…" },      // sent on every call
  fetch: myFetch,                      // your own fetch, for tests or a proxy agent
});
```

With `MAILS_API_KEY` and `MAILS_BASE_URL` set, `new Mails()` on its own is
enough.

`baseUrl` is your instance's address. The `/api/v1` suffix is added for you,
so `https://mail.yourdomain.com` and `https://mail.yourdomain.com/api/v1` both
work.

Both settings are checked in the constructor, so a missing key is an error
where you made the client, not a `401` somewhere later.

## What is on the client

| | |
| --- | --- |
| `mail.me()` | What this key is and what it may do |
| `mail.emails` | [Sending](/docs/sdk/sending), and reading what was sent |
| `mail.threads` | [Conversations](/docs/sdk/reading) |
| `mail.messages` | Individual messages |
| `mail.attachments` | Files on a message |
| `mail.mailboxes` | [Addresses](/docs/sdk/managing) |
| `mail.domains` | Sending domains and their DNS |
| `mail.labels` | Labels |
| `mail.contacts` | Everyone corresponded with |
| `mail.suppressions` | Blocked addresses |
| `mail.webhooks` | Endpoints and their deliveries |
| `mail.stats` | Sending and receiving numbers |
| `mail.rateLimit` | The window from the last reply |
| `mail.http` | The escape hatch, for an endpoint not yet wrapped |

## Webhooks

The package also verifies incoming webhooks, with no Node build needed:

```ts
import { constructWebhookEvent } from "@shahriyardx/mails";

const event = await constructWebhookEvent({
  secret: process.env.MAILS_WEBHOOK_SECRET!,
  payload: rawBody,
  signature: request.headers.get("x-mails-signature"),
});
```

See [Verifying a call](/docs/webhooks/verifying).

## Types

Every object, parameter and event is exported:

```ts
import type {
  Message, Thread, Mailbox, Domain, Label, Contact, Suppression,
  Webhook, WebhookDelivery, Stats, Page,
  SendEmailInput, ListThreadsParams, MailsWebhookEvent,
} from "@shahriyardx/mails";
```

Timestamps are ISO 8601 **strings**, because that is what JSON carries. Pass
one to `new Date()` when you need a date.

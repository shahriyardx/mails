# How it fits together

Four moving parts. Knowing which one is at fault is most of debugging a mail
problem, so it is worth five minutes.

## The pieces

| Piece | What it does | Where it runs |
| --- | --- | --- |
| **The app** | One Go binary: the dashboard, the API, the background workers | Your server |
| **Postgres** | Everything: mail, threads, settings, sessions, the send queue | Your server, or any Postgres |
| **Amazon SES** | Hands your outbound mail to the internet, and reports what happened | AWS |
| **The inbound worker** | Catches mail for your domains, posts it to the app | Cloudflare |
| **R2** | Holds attachments and raw messages | Cloudflare |

Postgres and the R2 bucket are the only two things you have to back up.

## One binary

`mails` is a single static binary. Inside it:

- **The HTTP server.** One router serves everything:

  | Path | Who calls it | How it is checked |
  | --- | --- | --- |
  | `/api/auth/*` | You, signing in with GitHub | OAuth state |
  | `/api/app/*` | The dashboard | Owner session cookie |
  | `/api/events` | The dashboard, for live updates | Owner session cookie |
  | `/api/v1/*` | Your code, the SDK, the extension | API key |
  | `/api/inbound` | The Cloudflare worker | HMAC signature |
  | `/api/ses/events` | Amazon SNS | SNS signature and topic |
  | `/api/health` | Your load balancer | Nothing |
  | everything else | Your browser | The dashboard itself |

- **The dashboard.** A React app, built with Vite and embedded into the
  binary with `go:embed`. There is no Node.js at runtime. These docs are part
  of it, at `/docs`.
- **The background workers.** The send queue, webhook delivery, and two
  hourly sweeps (staged uploads older than a day, idempotency keys older than
  24 hours). They run as goroutines in the same process.
- **The migrations.** Embedded SQL, applied on start unless
  `RUN_MIGRATIONS_ON_BOOT=false`. `mails migrate` applies them and exits.

It idles at a few tens of megabytes of memory.

## Package by feature

The Go code is organised by what it does, not by layer. Each feature is one
package under `internal/` with a small surface:

| Package | Job |
| --- | --- |
| `auth` | GitHub sign-in, the single owner, sessions |
| `domain`, `mailbox` | SES identities, DKIM, DNS checks; addresses |
| `inbound` | Mail from the worker: dedupe, threading, filters, spam folder |
| `mail` | Threads, messages, folders, labels, search, attachments |
| `send` | Composing, MIME, drafts, replies, the send queue |
| `delivery` | SES events over SNS, the blocked list, logs, metrics |
| `cloudflare`, `forwarding` | The worker deploy, Email Routing, forwarding |
| `apikey`, `apiv1`, `idempotency` | API keys, the public API |
| `webhook` | Signed delivery to your endpoints, and their management |
| `push`, `realtime` | Web Push; live updates over SSE |

The dashboard's `/api/app` and the public `/api/v1` call the same service
functions, so a rule (what a folder move does, who a reply goes to) is written
once and behaves the same from either side.

## Sending

```
your code ──▶ POST /api/v1/emails ──▶ the app ──▶ SES ──▶ the internet
                                         │
                                         └──▶ Postgres (the message, its thread)
```

The app makes one attempt at SES while you wait. If SES cannot take the
message right now, it goes into the send queue, a table in Postgres, and the
worker keeps trying. See [The send queue](/docs/guide/queue).

SES then reports what happened (delivered, bounced, complained, opened)
through an **SNS topic** that posts back to `/api/ses/events`. That is what
fills in a message's `status`, blocks addresses that bounce, and fires the
`email.*` [webhooks](/docs/webhooks/events).

Delivery reporting needs two things: a **configuration set** attached to
every send (`SES_CONFIGURATION_SET`), and the topic named in
`SES_SNS_TOPIC_ARN`. Without the topic, the app refuses every SNS post, since
anyone with an AWS account can sign a message for a topic of their own. See
[Self-hosting](/docs/guide/self-hosting#6-delivery-reporting).

## Receiving

```
the internet ──▶ Cloudflare Email Routing ──▶ the inbound worker ──▶ R2 (raw, files)
                                                    │
                                                    ▼
                                    POST /api/inbound (signed) ──▶ the app ──▶ Postgres
```

The worker stores the raw message and every attachment in R2 first, then
posts the parsed message to the app. The app answers with the addresses to
forward to, if any.

The worker is deployed **from the app**, under **Settings → Inbound**. You
paste a Cloudflare API token once; there is no `wrangler` step of your own.

Every call from the worker is signed with `INBOUND_WEBHOOK_SECRET` and
carries a timestamp, so nothing else can post mail into your instance, and an
old call cannot be replayed.

## Background work goes through the database

The send queue and webhook retries are rows in Postgres, claimed with
`FOR UPDATE SKIP LOCKED`. Nothing is held only in memory, so a restart loses
no work, and a second process could share the queue without changes.

## Live updates

The dashboard holds a server-sent events stream open at `/api/events`. When
mail arrives or a thread changes, the server sends a small event naming what
changed, and the page refetches it. Nothing polls.

The stream is in memory, in the one process, which is all one person needs.

## Where mail is threaded

An arriving message joins an existing thread in the same mailbox when:

- its `In-Reply-To` or `References` names a message already there, **and**
  the sender is already on that thread or the subject matches; or
- the same subject (ignoring `Re:` and `Fwd:`) arrived in the last thirty
  days **from somebody already on the thread**.

Otherwise it starts a new thread. Both signals are written by the sender, so
neither alone may put a stranger's message into your conversation.

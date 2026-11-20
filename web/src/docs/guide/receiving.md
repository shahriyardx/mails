# Receiving mail

**Settings → Inbound.**

Inbound mail arrives through Cloudflare Email Routing, which hands each
message to a Worker, which posts it to your instance. The Worker is deployed
**from the app**; there is no `wrangler` step of your own.

## The Cloudflare token

Create an API token (My Profile → API Tokens → Create Token → Custom token)
with these permissions:

```
Account → Workers Scripts     → Edit
Account → Workers R2 Storage  → Edit
Zone    → Zone                → Read
Zone    → Zone Settings       → Edit
Zone    → Email Routing Rules → Edit
Zone    → DNS                 → Edit
```

| Permission | What Mails uses it for |
| --- | --- |
| Zone → Read | Finding your zones, and the account they belong to |
| Workers Scripts → Edit | Uploading, checking and removing the worker |
| Workers R2 Storage → Edit | Binding the worker to your R2 bucket |
| Zone Settings → Edit | Turning Email Routing on for a zone |
| Email Routing Rules → Edit | Pointing the zone's catch-all at the worker |
| DNS → Edit | Email Routing's MX records, including those for subdomains |

> **Warning:** Zone Settings is easy to miss. Cloudflare gates *turning
> Email Routing on* behind **Zone Settings**, not behind the Email Routing
> permission.

Cloudflare answers a bad token and a missing permission with the same error,
so when a call is refused Mails names the permission that call needed.
Editing a token in Cloudflare keeps its value, so after adding a permission
there is nothing to paste again. Only a brand-new token has a new value.

For [forwarding](/docs/guide/forwarding) add one more:
`Account → Email Routing Addresses → Edit`. It is an *account* permission,
and a different thing from **Email Routing Rules**, the *zone* permission of
a similar name.

Paste the token and press **Connect**. It is checked, then stored encrypted
with a key derived from `SECRET`.

## Deploying the worker

Press **Deploy worker**. Mails uploads its bundled worker as
`mails-inbound`, with:

- the R2 bucket named in `R2_BUCKET`, which must exist in the same account;
- `APP_INBOUND_URL` set to `<APP_URL>/api/inbound`;
- `INBOUND_WEBHOOK_SECRET`, as a worker secret.

`APP_URL` has to be your public address. A `localhost` URL is refused,
because Cloudflare could never reach it.

Redeploying is the same button, and is what you do after upgrading Mails.

## Turning a domain on

Turn receiving on for each zone listed on the page. Mails switches on Email
Routing for the zone and points its **catch-all** at the worker, so every
address on the domain reaches Mails.

> **Danger:** This replaces the zone's MX records. Turning Email Routing on
> points the domain's MX at Cloudflare. Anything receiving mail on that domain
> today stops receiving it. Set up [forwarding](/docs/guide/forwarding) first
> if you want a copy to keep reaching your old inbox.

Turning it off removes the catch-all, and can turn Email Routing off for the
zone too.

## Subdomains

A zone's catch-all covers its subdomains once their MX records point at
Cloudflare. When you create a mailbox on a subdomain (say
`billing.example.com`) of a zone already receiving here, Mails publishes those
MX records for you, unless the subdomain already has MX records of its own.
The mailbox screen says whether it published them, found them already there,
or skipped (and why).

## Where mail lands

An arriving message goes to the mailbox whose address it was sent to. If no
mailbox matches:

1. A mailbox marked **catch-all** on that domain collects it.
2. A domain with **Capture every address** switched on creates a mailbox for
   the address on the spot.
3. Otherwise the domain's and the instance's [forwarding](/docs/guide/forwarding)
   rules decide where it goes. With no rule, the worker refuses it with
   `550 5.1.1`.

The same message delivered twice (Cloudflare retries, or it was sent to two
of your addresses that share a mailbox) is stored once, matched by its
`Message-ID`.

## Spam

A message whose sender's domain **fails DMARC** starts in **Spam**. Nothing
else is scored. [Filters](#filters) run after that and may still move it.

That check only works once Mails can trust the authentication results; see
below.

## What you get with each message

| Field | Meaning |
| --- | --- |
| `spf` | Did the sending server have permission |
| `dkim` | Was a signature valid |
| `dmarc` | What the domain's own policy says about the two above |
| `mailed_by` | The envelope sender's domain, when SPF passed for it |
| `signed_by` | The domain of a passing DKIM signature, preferring the one that matches `From` |
| `tls` | How the last hop reached Cloudflare: `TLS1.3`, `TLS1.2`, or `none` for plaintext |
| `spam_score` | Always `null`. Nothing trustworthy supplies one |

**These are `null` until you turn them on.** They come from the
`Authentication-Results` header Cloudflare adds, and nothing in a message
proves Cloudflare wrote it: a sender can forge one. So the worker ignores the
header unless its variable `TRUST_AUTH_RESULTS` is `"true"`, and Mails
deploys it as `"false"`.

Turn it on only after checking, in a raw `.eml` from R2, that
`Authentication-Results: mx.cloudflare.net; …` is the topmost such header on
every message. Set the variable on the `mails-inbound` worker in the
Cloudflare dashboard (Workers → mails-inbound → Settings → Variables).

> **Warning:** Pressing **Deploy worker** again sets `TRUST_AUTH_RESULTS`
> back to `"false"`. Set it again after every redeploy.

Even then the worker reads only the topmost header, only when its
authserv-id is exactly `mx.cloudflare.net`, and only when it parses strictly.
Anything else gives `null`, never a guess.

## Attachments

The worker stores every attachment in R2 before it posts the message, so the
app never handles the bytes on the way in. A single file over 25 MB is
skipped.

## The raw message

Every inbound message is stored byte for byte in R2. Fetch it with
[`GET /api/v1/messages/:id/raw`](/docs/api/messages#the-original-message) when
you need to run it through a MIME parser, re-send it, or keep it for an audit.

Outbound mail has no raw copy: it is assembled at send time and handed
straight to SES.

## Filters

**Settings → Filters.** A rule matches on sender, recipient, subject or body
(case-insensitive "contains"); every condition a rule sets must match. A
matching rule can move the message to a folder, mark it read, star it or
label it, before you ever see it.

Rules run in priority order as the message arrives, and every rule that
matches applies.

## How the worker talks to the app

For the curious, or for writing your own worker. Each message is one `POST`
to `/api/inbound` with:

| Header | Value |
| --- | --- |
| `X-Mail-Timestamp` | Unix time in **milliseconds** |
| `X-Mail-Signature` | Hex HMAC-SHA256 of `"<timestamp>.<raw body>"`, keyed with `INBOUND_WEBHOOK_SECRET` |

A timestamp more than five minutes off, or a signature that does not match,
is a `401`. The reply carries `forward`, the addresses the worker should copy
the message to. The full payload is described in `worker/PAYLOAD.md`.

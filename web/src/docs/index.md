# Mails

Your own email platform, on your own domains.

Mails sends through Amazon SES, receives through a Cloudflare Email Worker,
and keeps everything in your Postgres. It is one Go binary with the dashboard
built in. You sign in with GitHub, and the first account to sign in owns the
instance. Nobody else gets in.

## What you get

- **A real inbox, not just an outbox.** Threading, search, labels, filters,
  drafts, signatures and attachments, across as many mailboxes and domains as
  you like. New mail appears as it lands.
- **Domains managed from the app.** Add a domain, copy its DNS records, watch
  it verify. A subdomain of a domain you already verified needs no records at
  all.
- **Receiving set up from the app.** Paste a Cloudflare token, press deploy.
  There is no `wrangler` step of your own.
- **Forwarding without a redeploy.** Nothing is forwarded until you add a
  rule. Once you do, a copy of inbound mail goes on to an address outside
  Mails, from the very next message.
- **A complete API.** Sending, reading, filing and replying, with scoped keys,
  cursor pagination and idempotent sends.
- **Signed webhooks.** Twelve events, HMAC-signed, retried, with a delivery
  log you can replay from.
- **A typed Node SDK.** `@shahriyardx/mails` wraps the whole API with no
  dependencies.
- **Delivery you can see.** Delivered, bounced, complained and opened, per
  message, with addresses that bounce blocked automatically.
- **Notifications.** Web Push on the desktop, and a browser extension for the
  toolbar.

## Where to start

- [What it is](/docs/guide/index), and what it is not
- [Self-hosting it](/docs/guide/self-hosting), start to finish
- [Using the API](/docs/api/index)
- [Webhooks](/docs/webhooks/index)
- [The Node SDK](/docs/sdk/index)

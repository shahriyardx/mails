# Mailboxes

The addresses on your domains.

## List

```
GET /api/v1/mailboxes
```

Scope: `mailboxes:read`

Returns every address **this key can reach**, which is the quickest way for a
client to discover what it is allowed to do. `?domain=example.com` narrows it.

```json
{
  "object": "mailbox",
  "id": "mbx_…",
  "address": "support@example.com",
  "domain": "example.com",
  "domain_id": "dom_…",
  "display_name": "Support",
  "signature": "— The team",
  "is_catch_all": false,
  "is_default": true,
  "color": "#6366f1",
  "forward_off": false,
  "created_at": "2026-01-04T09:12:00Z"
}
```

`forward_off` means wider [forwarding](/docs/guide/forwarding) rules skip this
mailbox.

## Read one

```
GET /api/v1/mailboxes/:id
```

Scope: `mailboxes:read`

Takes the **address** as well as the id: `GET /mailboxes/support@example.com`.

## Create

```
POST /api/v1/mailboxes
```

Scope: `mailboxes:write`

```json
{
  "address": "billing@example.com",
  "display_name": "Billing",
  "signature": "— Accounts",
  "is_catch_all": false,
  "is_default": false,
  "color": "#0ea5e9"
}
```

Only `address` is required. `display_name` defaults to the part before the
`@`, and `color` is picked from the address.

The address must sit on a domain this instance has, **or under one**. Adding
`billing.example.com` mail under `example.com` works without adding the
subdomain first. An address on a domain the instance does not have is a
`422`; one that already exists is a `409`.

A key that holds whole domains may add to them. A key that names addresses
holds exactly those, and naming one more is not its to do — that is a `403`.

The first mailbox becomes the default. Setting `is_default` clears it
everywhere else. Only one at a time, or the composer has to choose between
them.

### A subdomain address

When the address is on a subdomain of a domain whose mail already reaches the
inbound worker, Mails publishes the subdomain's MX records in Cloudflare for
you, and says what it did:

```json
{
  "object": "mailbox",
  "address": "hello@billing.example.com",
  "receiving": { "state": "published", "domain": "billing.example.com", "zone": "example.com" }
}
```

`state` is `published`, `already` (the subdomain has MX records of its own,
left alone) or `skipped`, with a `reason` — no Cloudflare token, or a token
without `DNS → Edit`. See [Receiving mail](/docs/guide/receiving).

## Change one

```
PATCH /api/v1/mailboxes/:id
```

Scope: `mailboxes:write`

```json
{ "display_name": "Billing team", "signature": null }
```

Takes `display_name`, `signature`, `is_catch_all`, `is_default`, `color` and
`forward_off`. Only what you send changes. Send `signature: null` to clear it.

The **address itself cannot change**. Make a new mailbox instead — renaming
one would orphan the mail already threaded under it.

## Delete

```
DELETE /api/v1/mailboxes/:id?confirm=true
```

Scope: `mailboxes:write`

> **Danger:** This deletes the mail in it. Without `?confirm=true` the call
> returns `409` and does nothing. A mistyped id should not empty an inbox.

```json
{ "object": "mailbox", "id": "mbx_…", "deleted": true }
```

## Created on first use

A mailbox does not have to exist before you send from it. A key that reaches a
whole domain, or the whole account, can send as any address on a verified
domain, and the mailbox is created the first time it does — SES already
permits it, and code sends from `noreply@` and `receipts@` that nobody would
think to create by hand.

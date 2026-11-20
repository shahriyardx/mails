# Domains

What this account can send from, and the DNS each one needs.

## List

```
GET /api/v1/domains
```

Scope: `domains:read`

A key limited to part of the account sees the domains it holds, plus the
domains of the mailboxes it holds. A domain name and its records are not
secret, but the rest are not that key's business either.

```json
{
  "object": "domain",
  "id": "dom_…",
  "name": "example.com",
  "region": "us-east-1",
  "status": "verified",
  "sending_enabled": true,
  "dkim_status": "verified",
  "dkim_origin": "EXTERNAL",
  "mail_from_domain": "mail.example.com",
  "mail_from_status": "verified",
  "spf_verified": true,
  "dmarc_verified": true,
  "inherited_from": null,
  "auto_create_mailboxes": false,
  "forward_off": false,
  "imported": false,
  "last_checked_at": "2026-09-21T08:00:00Z",
  "created_at": "2026-09-01T10:00:00Z",
  "records": [
    {
      "kind": "TXT",
      "name": "mail._domainkey.example.com",
      "value": "p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA…",
      "purpose": "DKIM signing",
      "required": true
    },
    {
      "kind": "MX",
      "name": "mail.example.com",
      "value": "feedback-smtp.us-east-1.amazonses.com",
      "priority": 10,
      "purpose": "Bounce return path",
      "required": true
    },
    {
      "kind": "TXT",
      "name": "mail.example.com",
      "value": "v=spf1 include:amazonses.com ~all",
      "purpose": "SPF for return path",
      "required": true
    },
    {
      "kind": "TXT",
      "name": "example.com",
      "value": "v=spf1 include:amazonses.com include:_spf.mx.cloudflare.net ~all",
      "purpose": "SPF for SES + Cloudflare",
      "required": true
    },
    {
      "kind": "TXT",
      "name": "_dmarc.example.com",
      "value": "v=DMARC1; p=none; rua=mailto:dmarc@example.com",
      "purpose": "DMARC policy",
      "required": false
    }
  ]
}
```

`status` is one of `pending`, `verified`, `failed`, `temporary_failure`,
`not_started`. A domain can send when `status` is `verified` and
`sending_enabled` is `true`.

### The records

Mails makes the DKIM key itself, so DKIM is **one TXT record** rather than
three CNAMEs. The record's name uses the selector from `SES_DKIM_SELECTOR`
(`mail` by default), and `dkim_origin` is `EXTERNAL`. Only the public half of
the key is stored; the private half goes to SES.

Two other shapes can appear on a domain that was already in SES before Mails
saw it (`imported: true`):

- An identity with **its own key set up elsewhere** shows a TXT record marked
  `informational: true`. It is already published; Mails knows the selector
  but not the key.
- An identity using SES's **Easy DKIM** shows its CNAMEs, pointing at
  `dkim.amazonses.com`.

The `MX` and `TXT` on `mail.` are the return path, so bounces come back to
SES. The prefix comes from `SES_MAIL_FROM_PREFIX`. The DMARC record is
recommended, not required.

`inherited_from` is set when the domain is a **subdomain covered by a
parent**. Such a domain has an empty `records` array, because there is nothing
to publish.

`auto_create_mailboxes` and `forward_off` are switches set in the dashboard:
mail to an unknown address on the domain makes a mailbox for it, and wider
forwarding rules skip the domain.

## Read one

```
GET /api/v1/domains/:id
```

Scope: `domains:read`

Takes the **name** as well as the id:

```sh
curl https://mail.yourdomain.com/api/v1/domains/example.com \
  -H "Authorization: Bearer mk_live_..."
```

## Add

```
POST /api/v1/domains
```

Scope: `domains:write`

```json
{ "name": "example.com" }
```

Creates the identity in SES, gives it a DKIM key and a MAIL FROM domain, and
returns the records to publish. Returns `201`. A domain already here is a
`409`.

A **subdomain of a domain that can already send** needs none of that: SES lets
it send on its parent's verification. It is recorded straight away as
verified, with `inherited_from` set and no records.

Only a key that reaches the **whole account** may do this, because adding a
domain changes the account rather than one corner of it. A narrower key gets
`403`.

## Re-check

```
POST /api/v1/domains/:id/verify
```

Scope: `domains:write`

Asks SES where the identity stands and probes SPF and DMARC in DNS, then
returns the domain as it now is. This is what a setup script polls after
publishing records. An inherited domain is returned as it is: it stands or
falls with its parent.

```sh
until curl -s -X POST https://mail.yourdomain.com/api/v1/domains/example.com/verify \
  -H "Authorization: Bearer $KEY" | jq -e '.sending_enabled' >/dev/null
do sleep 30; done
```

## Remove

```
DELETE /api/v1/domains/:id
```

Scope: `domains:write`

Removes it from Mails. Add `?delete_in_ses=true` to delete the SES identity
too. An inherited domain never deletes an identity: it has none, and deleting
its parent's would take every sibling down. Like adding, this needs a key that
reaches the whole account.

> **Warning:** `delete_in_ses` cannot be undone, and other applications on
> the same AWS account may be relying on that identity.

```json
{
  "object": "domain",
  "id": "dom_…",
  "name": "example.com",
  "deleted": true,
  "deleted_in_ses": false
}
```

`deleted_in_ses` is `false` when SES refused the delete; the domain is still
removed from Mails.

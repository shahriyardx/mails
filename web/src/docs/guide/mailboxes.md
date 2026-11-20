# Mailboxes

**Settings → Mailboxes.** A mailbox is one address on one of your domains.
There is no limit on how many you have.

| Setting | What it does |
| --- | --- |
| **Display name** | The name on outgoing mail from this address |
| **Signature** | Appended when you compose from this address |
| **Catch-all** | Collects every unclaimed address on the domain |
| **Default** | The address the composer opens with. Only one at a time; the first mailbox you make starts as the default |
| **Colour** | How the mailbox is marked in lists |
| **Skip wider rules** | Domain and instance [forwarding](/docs/guide/forwarding) rules do not apply to it |

The address must sit on a domain you have added, or under one. The address
itself cannot be changed after it is made. Make a new mailbox instead:
renaming one would orphan the mail already threaded under it.

Deleting a mailbox deletes every message in it.

## Created on first use

A mailbox does not have to exist before you send from it. Send as
`receipts@` on a verified domain, from the dashboard or with an API key that
reaches that domain, and the mailbox is created the first time you do. SES
already permits it, and nobody wants to hand-create `noreply@` before a
script can run.

Mail to an address with no mailbox can create one too, if the domain has
**Capture every address** switched on. See
[Receiving mail](/docs/guide/receiving#where-mail-lands).

## On a subdomain

A mailbox on `billing.example.com` works for sending as soon as
`example.com` is verified. For receiving, Mails publishes the subdomain's MX
records when it can; see [Receiving mail](/docs/guide/receiving#subdomains).

## Scope switching

The switcher at the top of the mail view changes what you are looking at:

- **All mail**: every mailbox
- **One domain**: everything on `example.com`
- **One address**: just `you@example.com`

The folder list and the search follow whatever is selected, so "unread in
support@" is two clicks rather than a query.

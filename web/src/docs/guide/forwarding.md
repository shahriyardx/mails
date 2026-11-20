# Forwarding

**Settings → Forwarding.**

A copy of inbound mail, sent on to an address outside Mails. Useful for
keeping an old inbox fed while you move over, for an archive copy, or for
getting one mailbox onto a phone that is already set up for something else.

**Nothing is forwarded until you set it up.** A fresh instance forwards
nowhere. It takes two steps: add the address you want mail copied to and let
its owner verify it, then write a rule saying what to copy there. Neither
happens on its own.

## One permission first

Receiving mail needs nothing from Cloudflare's address list, so the token you
made for [receiving](/docs/guide/receiving#the-cloudflare-token) may not be
able to manage forwarding addresses. If it cannot, the page says so and names
the permission it wants:

```
Account → Email Routing Addresses → Edit
```

It is an *account* permission, not **Email Routing Rules**, the *zone* one of
a similar name that receiving already uses.

Add it to the token you already have. Editing a token in Cloudflare keeps its
value, so there is nothing to paste into Mails again. Only a token created
from scratch has a new value, and that one goes back on **Settings →
Inbound**.

Until then your rules still show and can still be changed, but adding or
removing an address fails: nothing Mails does can touch an address list
Cloudflare will not let it see.

## How it decides

Rules sit at one of three widths:

| | |
| --- | --- |
| **Everything** | Every message this instance receives |
| **By domain** | Every message to any address on that domain |
| **By mailbox** | One address |

**Every rule that matches applies.** A company-wide archive copy and a copy of
`support@` going to a phone are two rules, and a message to `support@`
satisfies both. Each destination gets one copy, however many rules lead to
it.

To keep something out of the wider rules, switch **Skip wider rules** on for
that domain or mailbox. It only stops the widths above it: a mailbox with the
switch on still follows its own rules, and a domain with it on still follows
its domain rules.

> **Tip:** Worked example. You copy everything to `archive@backup.example`,
> but not `hr@acme.com`. Switch **Skip wider rules** on for the `hr@acme.com`
> mailbox, and the archive stops receiving it. Everything else still goes.

## The address list is Cloudflare's

A forwarding destination really lives on your Cloudflare account, as an
Email Routing destination address.

- **Adding** one here creates it there. If Cloudflare already has it, Mails
  takes it as it is.
- **Refreshing** the list pulls in addresses added in the Cloudflare dashboard
  and their verification state.
- **Removing** one here deletes it and every rule that pointed at it. You
  choose whether to delete it in Cloudflare too.

An address on a domain this instance receives on is refused: forwarding there
would send the mail straight back in, forever.

## Verifying an address

Cloudflare will not forward to an address whose owner has not agreed to it.
Adding one registers it with Cloudflare, which emails it a link. Until that
link is clicked the address shows as waiting, and a rule pointing at it does
nothing at all.

There is no notification when somebody clicks, so refresh the list to see it
change. Verification is per address and account-wide: an address verified
once works for every domain on the account.

An address Cloudflare no longer has (somebody deleted the destination there)
keeps its rules rather than quietly losing them, so you can add it again and
carry on.

## How the worker knows

It asks. Nothing is stored in the worker and nothing is cached.

For every message, the worker already posts the whole thing to `/api/inbound`
on your instance; that is how mail gets stored. The reply also carries the
addresses to forward to, worked out from the rules at the moment the message
arrived:

```json
{ "stored": 1, "forward": ["archive@backup.example"] }
```

So a rule changed on this page applies to the next message. There is no
redeploy, and no window where the worker and the dashboard disagree.

## Mail to an address nobody owns

When no mailbox claims the address, Mails cannot apply a mailbox rule: there
is no mailbox. It falls back to the domain and instance rules, so mail to a
retired address still reaches somebody instead of bouncing.

If nothing matches, the message is refused with `550 5.1.1 No such recipient
here`.

## What is not forwarded

- Mail you send. Only inbound messages.
- Anything, if the address is still waiting for verification.
- Anything to an address on one of your own domains.

## When it stops working

Forwarding happens after the message is stored, so a forwarding failure never
costs you the copy in Mails. Cloudflare retries the whole delivery, and Mails
ignores the duplicate.

If one address stops receiving, refresh the list and check it is still
verified. Somebody removing the destination in the Cloudflare dashboard takes
it out of Cloudflare's list, and the worker can forward only to addresses
Cloudflare has verified.

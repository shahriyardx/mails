# Sending domains

**Settings → Domains.**

A domain has to be verified in SES before anything can be sent from it.
Mails creates the SES identity for you and shows the DNS to publish.

## Adding one

Type the domain in and press add. The screen then lists the records, and one
click copies each. Publish them at your DNS host, then re-check the domain.
SES usually verifies within minutes of the records appearing.

Domains **already verified in SES** are imported when you open the page, and
again whenever the list is more than ten minutes old. You do not have to add
them again.

## What the records are for

| Record | Why |
| --- | --- |
| **TXT** on `mail._domainkey` | DKIM. Signs your mail so receivers can tell it really came from you |
| **MX** and **TXT** on the mail-from subdomain | The return path, so bounces come back to SES rather than to nothing |
| **TXT** SPF on the domain | Says SES and Cloudflare may send for this domain |
| **TXT** DMARC on `_dmarc` | Tells receivers what to do when a message fails the two above. Recommended, not required |

**One DKIM record, not three.** Mails generates the DKIM key itself and hands
the private half to SES, so the record is a single TXT with the public key
(`p=…`). The private half is never stored. The selector is `mail` unless you
set `SES_DKIM_SELECTOR`.

A domain imported from SES keeps the DKIM it already has: Easy DKIM shows its
three CNAMEs, and a key set up elsewhere is shown as already published,
because Mails cannot know it. Switching it to a key Mails generates gives it
the single TXT record instead.

If that key's record is lost or deleted, DKIM fails for every message from the
domain, and Mails cannot show the old key. Click **Generate new DKIM key** on
the domain. SES signs with the new key at once, so publish the TXT record it
shows straight away, then click **Check again**.

The mail-from subdomain is `mail.yourdomain.com` unless you set
`SES_MAIL_FROM_PREFIX`.

SPF and DMARC are probed by Mails itself rather than by SES, so the ticks next
to them mean "we can see it resolving in DNS".

## Subdomains are free

A subdomain of a domain you have already verified needs **nothing**. Add
`billing.example.com` under a verified `example.com` and it is ready
immediately. SES lets a subdomain send on its parent's verification, and
Mails records it as covered by its parent.

Such a domain shows no records of its own, because there are none to publish.
To *receive* on a subdomain, see
[Receiving mail](/docs/guide/receiving#subdomains).

## Per-domain switches

| | |
| --- | --- |
| **Capture every address** | Mail to an address with no mailbox creates one on the spot, instead of being refused |
| **Skip wider rules** | Instance-wide [forwarding](/docs/guide/forwarding) rules do not apply to this domain |

## Removing one

Removing a domain removes it from Mails. You can also delete the SES identity
at the same time. That cannot be undone, and other applications on the same
AWS account may rely on it. A subdomain covered by its parent never deletes
an identity: it has none.

## Delivery reporting

Whether a message was delivered, bounced or opened comes from SES events, and
those need a configuration set and an SNS topic. It is a one-time setup in
the AWS console: see
[Self-hosting, step 6](/docs/guide/self-hosting#6-delivery-reporting).

## The sending limit

**Settings → Overview** shows your SES quota and how much of it the last 24
hours used.

It is a **rolling 24-hour window, not a daily allowance**. There is no reset
at midnight: each message stops counting exactly 24 hours after it was sent.

A brand-new SES account is in the **sandbox**: 200 messages a day, and only
to addresses you have verified. Ask AWS for production access before you rely
on it.

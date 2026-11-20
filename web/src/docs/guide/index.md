# What it is

Mails is a self-hosted email platform. You run it on your own server,
against your own database, for your own domains.

It does both halves of email:

- **Sending** goes out through **Amazon SES**, so your mail arrives rather
  than landing in spam.
- **Receiving** comes in through a **Cloudflare Email Worker**, which hands
  each message to your instance.

Everything (messages, threads, labels, contacts, keys) lives in **your
Postgres**. Attachments and raw messages live in **your R2 bucket**. Nothing
passes through anybody else's service, and nothing is metered by anybody but
AWS and Cloudflare.

## Private by design

Sign-in is GitHub only, and the **first GitHub account to sign in owns the
instance**. Every other account is refused, always.

A stranger who finds the sign-in page cannot give themselves an inbox.

Lost access to that GitHub account? `mails reset-owner` on the server removes
the owner and every session, and the next GitHub sign-in claims the instance.
Mail and settings stay.

It suits you if you want:

- Mail on a domain you own, without paying per mailbox
- Transactional sending and a real inbox in the same place
- An API over both, so your own code can read and answer mail

It does **not** suit you if you want a hosted product somebody else keeps
running. There is nothing to sign up for.

## What it is not

- **Not an SMTP server.** SES sends; Cloudflare receives. Mails is the
  application on top, not the mail transfer agent.
- **Not IMAP.** There is no IMAP or POP endpoint, so Apple Mail and
  Thunderbird cannot connect. The web app and the API are the two ways in.
- **Not a spam filter.** A message that fails DMARC starts in Spam, and
  filter rules can move mail, but that is all. See
  [Receiving mail](/docs/guide/receiving).
- **Not for teams, and not for newsletters.** There is one user, and no
  mailing lists.

## What you need

| | Why | Cost |
| --- | --- | --- |
| **Postgres** | Everything is stored here | Free locally, near zero self-hosted |
| **A GitHub OAuth app** | Sign-in | Free |
| **AWS** with SES | Sending | Pennies. You must ask AWS for production access, or you can only send to verified addresses |
| **Cloudflare**, with your domain on it | Receiving | Free |
| **Cloudflare R2** | Attachments and raw messages | Generous free tier |
| Somewhere to run it | One binary, or one Docker container | Your call |

## Next

- [How it fits together](/docs/guide/architecture): what talks to what
- [Self-hosting it](/docs/guide/self-hosting): the deploy, start to finish

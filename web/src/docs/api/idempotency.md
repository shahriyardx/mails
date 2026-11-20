# Idempotency and limits

## Sending exactly once

A send that times out leaves you with a hard question: did it go?

Send an `Idempotency-Key` and the question disappears.

```sh
curl -X POST https://mail.yourdomain.com/api/v1/emails \
  -H "Authorization: Bearer mk_live_..." \
  -H "Idempotency-Key: receipt-4821" \
  -H "Content-Type: application/json" \
  -d '{ "from": "receipts@example.com", "to": "a@b.c", "subject": "Receipt" }'
```

Repeat the call with the same key and you get the **first reply back**, not a
second message. The replay carries a header:

```
Idempotency-Replayed: true
```

Keys are remembered for **24 hours**, per API key and per endpoint. A key is
at most 255 characters.

Only a reply that worked is remembered. If the first call failed — a bad
field, a blocked recipient — the same key can be used again once you have
fixed it.

Two calls with the same key at the same moment do not both send. The second
does not wait: while the first is still running it gets a `409`:

```json
{
  "error": "A request with this idempotency key is still in progress",
  "code": "conflict"
}
```

Wait a moment and repeat it; once the first has finished, the repeat gets its
reply. The [Node SDK](/docs/sdk/errors) does this for you.

### Use something meaningful

The key should come from the thing you are sending about — `receipt-4821`,
`order-19023-shipped` — not from a random UUID generated at call time. A fresh
UUID on a retry is no protection at all, because it is a different key.

### Same key, different body

```json
{
  "error": "This idempotency key was used with a different request",
  "code": "conflict"
}
```

That is the guard working. Either you reused a key you should not have, or
something changed between the first call and the retry.

### Where it works

`POST /emails`, `POST /emails/batch` and `POST /threads/:id/reply`. For a
batch, the whole array is what the key covers. Other endpoints ignore the
header.

## Rate limits

Each key allows **300 calls a minute** unless it was given its own limit when
it was made (anything from 1 to 100,000).

Every reply carries the window:

```
X-RateLimit-Limit: 300
X-RateLimit-Remaining: 297
X-RateLimit-Reset: 1800000000
```

`X-RateLimit-Reset` is Unix seconds.

Going over returns `429` with `Retry-After` in seconds. Wait that long rather
than retrying in a tight loop, which only spends the next allowance as soon as
it comes back.

> **Tip:** The counter lives in the server's memory. It resets on a restart,
> and two processes would each allow the full rate. It exists to stop a
> runaway loop from emptying your SES quota, not to meter a plan.

## The SES quota is separate

The rate limit is Mails'. **SES has its own**, and it is the one that actually
stops mail going out. **Settings → Overview** shows it: the 24-hour cap, how
much of it is used, and the per-second send rate.

A new SES account is in the sandbox — 200 a day, verified recipients only.
Ask AWS for production access before you rely on it.

## Body size

32 MB, which caps attachments. Over it:

```json
{ "error": "The request body is too large", "code": "payload_too_large" }
```

At most **20 attachments** on one message, and SES refuses a whole message
over 40 MB. Remember base64 adds about a third, so a 32 MB body is roughly
24 MB of files.

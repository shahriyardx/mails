# Worker -> app inbound payload

The worker POSTs one JSON body per message to `APP_INBOUND_URL`
(`/api/inbound`). Source: `src/index.ts`. "Parsed" means the message parsed by
`postal-mime`; "runtime" means the `ForwardableEmailMessage` Cloudflare gives
the worker (the SMTP envelope).

## Request headers

| Header | Value |
| --- | --- |
| `Content-Type` | `application/json` |
| `x-mail-timestamp` | Unix time in **milliseconds**, as a string |
| `x-mail-signature` | hex HMAC-SHA256 of `"<timestamp>.<raw body>"`, key `INBOUND_WEBHOOK_SECRET` |

The reference app rejects a timestamp more than 5 minutes off, and compares
the signature in constant time.

## Body

```json
{ "email": { ... }, "attachments": [ ... ] }
```

### `email`

| Field | Type | Comes from |
| --- | --- | --- |
| `to` | string | runtime `message.to` (envelope recipient), lowercased |
| `recipients` | string[] | `[message.to]`, lowercased (always one entry) |
| `from.name` | string \| null | parsed `From` display name, `null` when empty |
| `from.address` | string | parsed `From` address, else runtime `message.from`; lowercased |
| `toAddresses` | `{name: string\|null, address: string}[]` | parsed `To`, addresses lowercased |
| `ccAddresses` | same as `toAddresses` | parsed `Cc` |
| `replyTo` | string \| null | first parsed `Reply-To` address |
| `subject` | string | parsed `Subject`, `""` when missing |
| `text` | string \| null | parsed text/plain body |
| `html` | string \| null | parsed text/html body (unsanitized) |
| `messageId` | string \| null | parsed `Message-ID` (with angle brackets) |
| `inReplyTo` | string \| null | parsed `In-Reply-To` |
| `references` | string[] | parsed `References`, split on whitespace |
| `date` | string | parsed `Date` (ISO 8601 when parseable, else the raw header text); worker's current time as ISO when missing |
| `sizeBytes` | number | byte length of the raw message |
| `rawKey` | string \| null | R2 key of the raw `.eml` (`raw/<uuid>.eml`), `null` when `STORE_RAW = "false"` |
| `auth.spf` | string \| null | trusted A-R: the `smtp.mailfrom` SPF result (several that disagree: `null`); with no `smtp.mailfrom` entry, the single SPF entry if there is exactly one |
| `auth.dkim` | string \| null | trusted A-R: `pass` if any DKIM entry passed, else the verdict all DKIM entries agree on, else `null` |
| `auth.dmarc` | string \| null | trusted A-R: the DMARC verdict; duplicates that disagree give `null` |
| `spamScore` | null | always `null` (see below) |
| `mailedBy` | string \| null | domain of runtime `message.from` (SMTP envelope sender), **only** when the trusted A-R has `spf=pass` with `smtp.mailfrom` in that same domain; else `null` |
| `signedBy` | string \| null | trusted A-R: `header.d` (or the domain of `header.i`) of a `dkim=pass` entry; the one aligned with the From domain wins. `DKIM-Signature` headers are never read |
| `tls` | string \| null | only when trusted: topmost `Received`, read after `by mx.cloudflare.net`: `TLS1.3`/`TLS1.2`/... from `version=`, `TLS` for `with ESMTPS`, `none` for plain `ESMTP`/`SMTP`, else `null` |

Values are `spf`: `pass` `fail` `softfail` `neutral` `none` `temperror`
`permerror`; `dkim`/`dmarc`: `pass` `fail` `none` `policy` `neutral`
`temperror` `permerror`.

### "Trusted A-R" (fails closed)

All of these must hold, or every `auth` value, `mailedBy`, `signedBy` and
`tls` is `null`. Nothing falls back to another header or to a default.

1. The worker var `TRUST_AUTH_RESULTS` is `"true"`. It defaults to `"false"`
   because nothing in a message proves Cloudflare wrote a header: when
   Cloudflare does not stamp one (reported for Worker deliveries in
   cloudflare/workerd#6740), a sender's forged `mx.cloudflare.net` header
   would be the topmost. Turn it on only after a raw `.eml` in R2 shows
   Cloudflare's header on top of every message. The Go server's worker
   deploy should pass this var (default `"false"`).
2. It is the **topmost** `Authentication-Results` header. Lower ones are
   never read.
3. Its authserv-id (first `;` segment, comments removed) is exactly
   `mx.cloudflare.net` (any case), optionally followed by a version number.
4. It parses strictly per RFC 8601: folding removed; comments (nested,
   with `\` escapes) and quoted strings never split a segment; every
   segment is `method[/version]=result` with a known result, followed only
   by `ptype.property=value` (ptype `smtp`, `header`, `body`, `policy`) or
   `reason=value`. Any other text, an unbalanced comment or quote, or an
   empty segment rejects the whole header. `authserv-id; none` means no
   results (all `null`).

### `attachments`

Each attachment is stored in R2 before the POST. Parts over
`MAX_ATTACHMENT_BYTES` are skipped.

| Field | Type | Comes from |
| --- | --- | --- |
| `filename` | string | part filename, else `attachment-<n>` |
| `contentType` | string | part MIME type, else `application/octet-stream` |
| `sizeBytes` | number | decoded byte length |
| `r2Key` | string | `inbound/<uuid>/<index>-<safe filename>` |
| `contentId` | string \| null | part `Content-ID` |
| `isInline` | boolean | `false` for `Content-Disposition: attachment`, else `true` when disposition is `inline` or a Content-ID is present |

## Response the worker expects

| Status | Meaning |
| --- | --- |
| 2xx (not 202) | stored; worker then forwards to every address in `forward` |
| 202 | no mailbox owns the address; worker forwards to `forward` (plus `FORWARD_TO`), or rejects with `550 5.1.1` if that is empty |
| anything else | worker throws, Cloudflare retries delivery |

Body: `{ "forward": string[] }` (other fields ignored). A missing or
malformed `forward` means forward nowhere.

## Changes from the reference app (../mail)

Field names are unchanged. Values that used to come from sender-controlled
headers now come from trusted sources, or are `null`:

- `auth.*`: was the first header containing "cloudflare" anywhere (forgeable);
  now only the strictly parsed topmost header with the exact authserv-id,
  and only with `TRUST_AUTH_RESULTS = "true"`. Missing values are `null`,
  never an absent `auth` object.
- `spamScore`: was read from `X-Spam-Score` / `X-Spam-Status`, which the
  sender writes. Now always `null`. Spam detection should rely on
  `auth.dmarc === "fail"` (and any server-side scoring).
- `mailedBy`: was read from the `Return-Path` header; now the runtime envelope
  sender, and only when Cloudflare's SPF check of it passed.
- `signedBy`: was the `d=` tag of any `DKIM-Signature` header (unverified);
  now only a Cloudflare-verified `dkim=pass` domain.
- `tls`: now `null` unless trusted and the topmost `Received` was written by
  Cloudflare.

# Blocked addresses

Addresses this account will not send to again. Bounces and complaints fill
this in automatically.

## Why it exists

SES judges you on your bounce and complaint rates. Above **5%** bounces or
**0.1%** complaints it starts warning, and it will suspend an account that
keeps going. Continuing to send to an address that hard-bounced is the fastest
way there.

So a permanent bounce or a spam complaint adds the address here, and sends to
it stop: a send that names a blocked address is refused with a `409` before
anything goes out. See [Emails](/docs/api/emails#blocked-recipients).

Automatic blocking needs delivery reporting, since that is how SES tells Mails
about bounces. See [Sending domains](/docs/guide/domains).

The list is kept for the whole account. A key's reach does not narrow it —
only its scope decides.

## List

```
GET /api/v1/suppressions
```

Scope: `suppressions:read`

| Filter | |
| --- | --- |
| `q` | Substring of the address |
| `limit`, `cursor` | See [Pagination](/docs/api/pagination) |

```json
{
  "object": "suppression",
  "id": "sup_…",
  "address": "gone@example.net",
  "reason": "bounce: Permanent/General",
  "created_at": "2026-09-14T11:20:03Z"
}
```

`reason` is `bounce: Permanent/<type>` or `complaint` when Mails added it, and
whatever you wrote (or `manual`) when you did.

## Block one by hand

```
POST /api/v1/suppressions
```

Scope: `suppressions:write`

```json
{ "address": "unsubscribed@example.net", "reason": "Asked to stop" }
```

`reason` is optional, at most 200 characters.

Returns `201` when it is new and `200` when it was already blocked — blocking
an already-blocked address is not an error, it is the state you asked for.

Useful for honouring an unsubscribe from your own application, so the block
lives in one place rather than two.

## Unblock

```
DELETE /api/v1/suppressions/:id
```

Scope: `suppressions:write`

Takes the **address** as well as the id:

```sh
curl -X DELETE "https://mail.yourdomain.com/api/v1/suppressions/gone%40example.net" \
  -H "Authorization: Bearer mk_live_..."
```

> **Warning:** Think before you do. The address is on this list because mail
> to it bounced or was reported as spam. Sending again risks the account's
> own sending reputation, and the reputation is shared by every domain on it.
>
> Unblocking is right when the address was blocked by mistake, or the mailbox
> has genuinely been fixed. It is not a way to retry a bad list.

```json
{ "object": "suppression", "id": "sup_…", "address": "gone@example.net", "deleted": true }
```

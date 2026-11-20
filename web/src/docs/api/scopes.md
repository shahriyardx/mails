# Scopes and reach

A key carries two limits. Both are checked on every call, and neither
substitutes for the other.

## Scopes

Scopes say **what kind of call** is allowed.

| Scope | Allows |
| --- | --- |
| `emails:send` | `POST /emails`, `/emails/batch`, `/emails/:id/cancel` |
| `emails:read` | Listing and reading sent mail |
| `mail:read` | Threads, messages, attachments, raw messages |
| `mail:write` | Moving, reading, starring, labelling, replying, deleting |
| `mailboxes:read` | Listing and reading mailboxes |
| `mailboxes:write` | Creating, changing and deleting them |
| `domains:read` | Listing and reading domains and their DNS |
| `domains:write` | Adding, re-checking and removing them |
| `labels:read` | Listing and reading labels |
| `labels:write` | Creating, renaming and deleting them |
| `contacts:read` | Listing contacts |
| `suppressions:read` | Listing blocked addresses |
| `suppressions:write` | Blocking and unblocking |
| `webhooks:read` | Listing endpoints and deliveries |
| `webhooks:write` | Creating, changing, testing, replaying |
| `stats:read` | `GET /stats` |
| `*` | All of the above, and anything added later |

**Writing implies reading.** A key with `mail:write` has `mail:read` without
being given it, because "may change but may not see" is a trap that only ever
shows up as a 403 in production. The same goes for `emails:send` and
`emails:read`. `contacts:read` and `stats:read` have no write side.

A missing scope is a `403`:

```json
{
  "error": "This API key does not have the \"mail:write\" scope",
  "code": "forbidden",
  "required_scope": "mail:write",
  "scopes": ["mail:read", "emails:send"]
}
```

### The presets

The dashboard offers four ready-made sets:

| Preset | Scopes |
| --- | --- |
| **Full access** | `*` |
| **Send only** | `emails:send`, `emails:read` |
| **Read only** | every `:read` scope |
| **Inbox agent** | `emails:send`, `emails:read`, `mail:read`, `mail:write`, `mailboxes:read`, `labels:read`, `labels:write`, `contacts:read`, `stats:read` |

Scopes and reach are fixed when a key is made. Only its name can change
later, so a key never quietly gains power.

## Reach

Reach says **which mail** those calls may touch.

| Reach | Means |
| --- | --- |
| **Everything** | Every mailbox in the account, including ones made later |
| **Whole domains** | Every address on those domains, including ones made later |
| **Named addresses** | Exactly those mailboxes |

A key holds whole domains or named addresses, never both.

Reach is enforced everywhere mail is involved:

- `GET /threads`, `/messages` and `/emails` return only mail in mailboxes the
  key reaches.
- `GET /domains` returns the domains it holds, plus the domains of the
  mailboxes it holds.
- `GET /contacts` returns `403` for any key that is not unrestricted, because
  contacts are kept for the whole account and there is no honest way to
  narrow them.
- `POST /domains` and `DELETE /domains/:id` return `403` for the same reason —
  adding or removing a domain changes the account, not one corner of it.
- A key that reaches part of the account must scope a webhook to a mailbox or
  domain it holds, or it would be a way to receive mail the key cannot read.

Labels and blocked addresses are kept for the whole account, so they cannot
be narrowed to part of it. Any key with the scope may read labels and add to
the blocked list, but creating, changing or deleting a label, and listing or
unblocking blocked addresses, return `403` for a key that is not unrestricted.
A restricted key that blocks an address gets
`{ "object": "suppression", "address": …, "blocked": true }` back, the same
either way, so it cannot learn what was already on the list.

### Something out of reach is a 404, not a 403

```json
{ "error": "No such thread", "code": "not_found" }
```

Deliberately. A `403` would confirm the object exists, which lets somebody
map what they cannot see by asking about it.

## Sending, specifically

| The key holds | May send as |
| --- | --- |
| Everything | Any address on any verified domain. The mailbox is made on first use |
| Whole domains | Any address on those domains. The mailbox is made on first use |
| Named addresses | Exactly those addresses |

This is why a whole-domain key is the right choice for transactional mail:
`receipts@`, `noreply@` and `alerts@` all work without anybody creating them
first.

## Picking one

Give each integration the narrowest key that does its job.

| The job | Scopes | Reach |
| --- | --- | --- |
| A billing service sending receipts | `emails:send` | the `billing.` domain |
| A dashboard showing delivery health | `emails:read`, `stats:read` | everything |
| A bot that answers support mail | `mail:write`, `emails:send` | `support@` |
| A backup script | `mail:read` | everything |

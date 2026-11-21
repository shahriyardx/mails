# Reading and writing mail

A few things the dashboard does that are easy to miss.

## Undo send

After **Send** the composer closes and a "Sending… Undo" note shows at the
bottom. Until it goes away the message has not left: **Undo** opens it
again in the composer, as a draft, with its files.

How long it waits is up to you, on **Settings -> Preferences -> Undo send**:
off, 5, 10 (the default), 20 or 30 seconds. Off sends at once, as before.

Only the dashboard waits. Mail sent through the API, the SDK or the
extension goes to SES straight away.

While it waits, the message sits in Sent marked `queued`. When the time is
up the [send queue](/docs/guide/queue) sends it like any other queued mail.

## Search filters

The search box (press `/`) takes plain words and filters, like Gmail:

- `from:ada`, `to:bob`, `subject:"q3 plan"`: part of a name, address or subject
- `has:attachment`, `is:unread`, `is:read`, `is:starred`
- `label:work`, `in:archive` (or any folder, or `in:all`)
- `after:2026-01-31`, `before:2026-02-01`: days, in UTC

Quotes keep spaces in a value. Each filter shows as a chip under the box;
its cross takes it out. **Filters** in the box lists them all.
`in:` searches that folder whatever folder is open.

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

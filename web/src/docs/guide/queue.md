# The send queue

A message SES could not take right now waits in a queue: the `send_job`
table in Postgres. A worker in the app keeps trying it until it goes out or
the attempts run out.

## Why it exists

If SES throttles the account, or the socket breaks, or AWS has a bad minute,
a single attempt would fail and the message would be gone. That is the wrong
answer for the one thing an email app is for.

## What is retried, and what is not

Every send makes **one attempt at SES while you wait**. Then:

A refusal that will still be true in an hour is final. The send fails with a
`422` and nothing is recorded:

- SES rejected the message (a malformed address, rejected content)
- the sending domain is not verified
- the request was bad
- the account is suspended or paused

Anything else is a *not right now*, and goes into the queue:

- throttling, and quota limits
- an SES outage, or any `5xx`
- a dropped or refused connection, a DNS failure, a timeout

The reply says `"status": "queued"` and the message is already in Sent.

A send from the dashboard is the one exception: it waits out your
[undo window](/docs/guide/mail#undo-send) in the queue first (no attempt
yet), and only then goes to SES, through the same worker.

## What happens then

The gap between attempts widens each time: about 30 seconds, then a minute,
two, four, eight, and then a quarter of an hour, each with up to 20% of
randomness either way, so a hundred messages queued by one outage do not all
wake at once.

A message gets **eight attempts** in all, counting the first, which comes to
roughly three quarters of an hour. Then it gives up: the message is marked
`failed` with the reason on it, and an `email.failed` webhook fires. A
refusal that turns out to be permanent ends it early, the same way.

When an attempt works, the message becomes `sent` and `email.sent` fires.

While it waits, the message sits in Sent marked `queued`, and you can
[call it off](/docs/api/emails#call-one-off). Once a worker has picked it up
it is on its way, and cancelling is a `409`.

## Where the worker runs

Inside the app process. A self-hosted instance is usually one process, and a
queue that needs a cron job wired up separately is a queue that silently
does nothing for everyone who skipped that step.

Running more than one process is still fine. Jobs are claimed with
`FOR UPDATE SKIP LOCKED`, so each worker takes rows no other worker is
holding, rather than two of them sending the same message twice. A job held
for more than ten minutes by a process that died is released and tried again.

Set `OUTBOX_WORKER=false` to turn the worker off in a process, and run it
somewhere else instead.

> **Tip:** It is at-least-once, not exactly-once. If the process is killed in
> the moment between SES accepting a message and the row being written, the
> job looks unfinished and is tried again, which sends that message twice.
> The window is milliseconds wide, and the alternative would be losing a
> message every time the process restarts.

## What is not here

Every message goes now, or as soon as SES will take it. There is no way to
hold one back for a later time.

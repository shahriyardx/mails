# Self-hosting it

Start to finish. Get the app running on its public URL **before** the SES and
Cloudflare steps: both have to reach a real `https` address, so nothing past
step 5 works against `localhost`.

## Before you start: the licence

Mails is under the PolyForm Noncommercial License 1.0.0 (see `LICENSE` in the
repository). Personal projects, research, teaching and charitable work are
free.

**Running it for a business is not.** That needs a commercial licence; write
to <mdshahriyaralam552@gmail.com>.

The Node SDK in `packages/sdk` is MIT, so your application can use it whatever
you are doing.

## 1. A GitHub OAuth app

Sign-in is GitHub only. **github.com → Settings → Developer settings → OAuth
Apps → New OAuth App**:

| | |
| --- | --- |
| Homepage URL | `https://mail.yourdomain.com` |
| Authorization callback URL | `https://mail.yourdomain.com/api/auth/callback/github` |

The callback is always `<APP_URL>/api/auth/callback/github`. Keep the client
ID, and press **Generate a new client secret** (it is shown once).

The first GitHub account to finish sign-in owns the instance. Every other
account is refused. The owner is matched by GitHub's numeric user id, never by
email.

## 2. The environment

Copy `.env.example` to `.env` and fill it in. Every value is read when the
process starts.

```sh
cp .env.example .env
```

### Required

The app will not start without these.

| Variable | What it is |
| --- | --- |
| `DATABASE_URL` | Postgres, e.g. `postgres://mails:mails@localhost:5437/mails?sslmode=disable` |
| `SECRET` | Encrypts stored secrets (the Cloudflare token). Generate: `openssl rand -base64 32` |
| `GITHUB_CLIENT_ID` | From step 1 |
| `GITHUB_CLIENT_SECRET` | From step 1 |
| `INBOUND_WEBHOOK_SECRET` | Shared with the Cloudflare worker. Generate: `openssl rand -hex 32` |

> **Warning:** `SECRET` is load-bearing. Change it later and the stored
> Cloudflare token can no longer be read; you will have to connect it again
> under Settings → Inbound.

### Your address

| Variable | Default | What it is |
| --- | --- | --- |
| `APP_URL` | `http://localhost:3000` | The public URL, e.g. `https://mail.yourdomain.com`. Used for the OAuth callback, the worker's target and webhook rules. An `https` URL also makes the session cookie `Secure` |
| `ADDR` | `:3000` | Where the server listens |

### AWS SES

| Variable | Default | What it is |
| --- | --- | --- |
| `AWS_REGION` | `us-east-1` | The region SES is set up in. SES is per region |
| `AWS_ACCESS_KEY_ID` | | IAM → Users → your user → Security credentials → Create access key |
| `AWS_SECRET_ACCESS_KEY` | | Shown once, beside the key id |
| `SES_CONFIGURATION_SET` | | The configuration set attached to every send. Step 6 |
| `SES_SNS_TOPIC_ARN` | | The SNS topic SES publishes events to. **Required for delivery reporting.** Step 6 |
| `SES_MAIL_FROM_PREFIX` | `mail` | The return path becomes `mail.yourdomain.com` |
| `SES_DKIM_SELECTOR` | `mail` | The selector for the DKIM keys Mails generates |

Leave both AWS keys empty to use the default AWS credential chain instead (an
instance role, or a shared config file), which is better on EC2 or anything
else that can assume a role.

### Cloudflare R2

In the Cloudflare dashboard, **R2 → Overview**:

| Variable | Default | What it is |
| --- | --- | --- |
| `R2_ACCOUNT_ID` | | The **Account ID** in the right-hand sidebar |
| `R2_BUCKET` | `mail-attachments` | The bucket you create here. The worker writes to the same one |
| `R2_ACCESS_KEY_ID` | | **Manage R2 API Tokens** → Create API token → **Object Read & Write** |
| `R2_SECRET_ACCESS_KEY` | | Shown once, with the key id |

Without R2 the app still starts, but keeps uploads in memory and loses them
on restart, and cannot read the files the worker stored. Treat R2 as
required.

> **Warning:** Keep the bucket private. A public custom domain makes every
> raw message and attachment readable by anyone with the URL. The app hands
> out short-lived signed links instead.

### Web Push

| Variable | Default | What it is |
| --- | --- | --- |
| `VAPID_PUBLIC_KEY` | | Generate the pair with `mails vapid-keys`. Step 9 |
| `VAPID_PRIVATE_KEY` | | |
| `VAPID_SUBJECT` | `mailto:admin@localhost` | How a push service reaches you. Any address you read |

### Safe to leave alone

| Variable | Default | What it is |
| --- | --- | --- |
| `RUN_MIGRATIONS_ON_BOOT` | `true` | Set `false` to run `mails migrate` yourself |
| `OUTBOX_WORKER` | `true` | Set `false` to run the [send queue](/docs/guide/queue) in another process |

## 3. Run it

### With Docker

The repository's `compose.yaml` runs Postgres and the app. The app service
sits behind the `app` profile, so name it:

```sh
git clone <the repository> mails
cd mails
cp .env.example .env          # fill it in
docker compose --profile app up -d --build
```

The image is built from the `Dockerfile`: the dashboard, then one static Go
binary, on a distroless base with no shell. Compose points `DATABASE_URL` at
its own Postgres, waits for it to be healthy, and publishes the app on
`127.0.0.1:3000`. Put a reverse proxy with TLS in front of it.

Migrations run on boot, so there is no separate step.

### As a plain binary

Needs Go and Node with pnpm to build. The dashboard is embedded, so build it
first:

```sh
cd web && pnpm install && pnpm build && cd ..
CGO_ENABLED=0 go build -o mails ./cmd/mails
set -a; . ./.env; set +a
./mails
```

Run it under systemd or anything else that restarts it, behind a reverse
proxy with TLS.

### Check it is up

```sh
curl https://mail.yourdomain.com/api/health
# {"status":"ok"}
```

## 4. Sign in

Open your URL and press **Continue with GitHub**. That account becomes the
owner.

A first-run checklist follows: connect SES, add a domain, create a mailbox,
receive mail. It is live, not a list of ticks: each item checks the real
state and links to the screen for that job. You can finish with items left
over; waiting on DNS is not a reason to be held on a setup screen.

## 5. SES

Give the IAM user behind `AWS_ACCESS_KEY_ID` this policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": [
      "ses:SendEmail",
      "ses:SendRawEmail",
      "ses:GetAccount",
      "ses:ListEmailIdentities",
      "ses:GetEmailIdentity",
      "ses:CreateEmailIdentity",
      "ses:DeleteEmailIdentity",
      "ses:PutEmailIdentityDkimSigningAttributes",
      "ses:PutEmailIdentityMailFromAttributes"
    ],
    "Resource": "*"
  }]
}
```

A brand-new SES account is in the **sandbox**: 200 messages a day, and only to
addresses you have verified. Ask AWS for production access before you rely on
it. **Settings → Overview** shows where your account stands.

Then add your domain under **Settings → Domains** and publish the records it
shows. See [Sending domains](/docs/guide/domains).

## 6. Delivery reporting

Without this every message stays at `sent` forever: no delivered, no bounces,
no automatic blocking, and no `email.delivered` or `email.bounced` webhooks.
It is all set up in the AWS console, in the same region as SES.

1. **Create an SNS topic.** SNS → Topics → Create topic → Standard. Any name,
   e.g. `mails-events`. Copy its ARN; it looks like
   `arn:aws:sns:us-east-1:123456789012:mails-events`.
2. **Set `SES_SNS_TOPIC_ARN`** to that ARN and restart Mails. Until it is
   set, `/api/ses/events` refuses every post, including the subscription
   confirmation in step 3.
3. **Subscribe the app.** On the topic: Create subscription → protocol
   **HTTPS** → endpoint `https://mail.yourdomain.com/api/ses/events`. Leave
   raw message delivery off. Mails confirms the subscription itself; the
   status turns **Confirmed** within seconds. If it stays pending, press
   **Request confirmation**.
4. **Create a configuration set.** SES → Configuration sets → Create, e.g.
   `mails`. Add an **event destination** of type **Amazon SNS** pointing at
   the topic, with these event types: sends, deliveries, bounces, complaints,
   rejects, delivery delays, rendering failures, and opens and clicks if you
   want them.
5. **Set `SES_CONFIGURATION_SET`** to the set's name and restart. Every send
   now carries it.

If SES says it cannot publish to the topic, add this statement to the
topic's access policy:

```json
{
  "Effect": "Allow",
  "Principal": { "Service": "ses.amazonaws.com" },
  "Action": "sns:Publish",
  "Resource": "arn:aws:sns:us-east-1:123456789012:mails-events"
}
```

Only notifications from that one topic, signed by AWS, are accepted. Anyone
with an AWS account can sign a message for a topic of their own, so the topic
check is what makes a valid signature mean "your SES".

Statuses only ever move forward: a late `Send` event never undoes a
`delivered`. A permanent bounce or a complaint adds the address to the
[blocked list](/docs/api/suppressions), and later sends to it are refused.

## 7. Receiving

Two parts, both in Cloudflare.

**The R2 bucket.** Create the bucket named in `R2_BUCKET` (step 2) in the
same Cloudflare account as your domain. The worker writes raw messages and
attachments there.

**A Cloudflare API token** for the worker. My Profile → API Tokens → Create
Token → Custom token, with:

```
Account → Workers Scripts     → Edit
Account → Workers R2 Storage  → Edit
Zone    → Zone                → Read
Zone    → Zone Settings       → Edit
Zone    → Email Routing Rules → Edit
Zone    → DNS                 → Edit
```

Add `Account → Email Routing Addresses → Edit` too if you want
[forwarding](/docs/guide/forwarding).

Then, in Mails, **Settings → Inbound**: paste the token, press **Deploy
worker**, and turn receiving on for each domain. The worker is uploaded as
`mails-inbound`, pointed at `<APP_URL>/api/inbound`, and given
`INBOUND_WEBHOOK_SECRET`. See [Receiving mail](/docs/guide/receiving) for
what each permission is for and what turning a domain on changes.

## 8. A mailbox

**Settings → Mailboxes.** Add `you@yourdomain.com` and send yourself
something. Then reply to it from outside, and watch it arrive.

## 9. Desktop notifications (optional)

Generate a VAPID key pair once:

```sh
mails vapid-keys
# or, with Docker:
docker compose --profile app run --rm --no-deps mails vapid-keys
```

Put the two printed lines in `.env`, set `VAPID_SUBJECT`, and restart. See
[Desktop notifications](/docs/guide/notifications).

## Commands

The binary has four subcommands besides running the server:

| Command | What it does |
| --- | --- |
| `mails` | Run the server |
| `mails migrate` | Apply database migrations and exit |
| `mails reset-owner` | Remove the owner and every session. The next GitHub sign-in claims the instance. Mail and settings stay |
| `mails vapid-keys` | Print a new VAPID key pair for Web Push |
| `mails help` | List these |

`migrate` and `reset-owner` read `DATABASE_URL` from the environment. With
Docker, run them inside the app container:

```sh
docker compose --profile app exec mails /mails reset-owner
```

## Upgrading

Pull the new code and rebuild. Migrations run on boot.

```sh
git pull
docker compose --profile app up -d --build
```

After an upgrade that changes the worker, press **Deploy worker** on
Settings → Inbound once, so Cloudflare runs the new one.

## Working on Mails itself

Only if you are changing the code.

```sh
docker compose up -d postgres          # Postgres 18 on 127.0.0.1:5437
cp .env.example .env                   # fill in GitHub OAuth + secrets
set -a; . ./.env; set +a; go run ./cmd/mails
cd web && pnpm dev                     # the dashboard, with hot reload
go test ./...                          # needs the compose Postgres
```

For local sign-in, make a second GitHub OAuth app with the callback
`http://localhost:3000/api/auth/callback/github`.

Sending works locally. Receiving does not: Cloudflare cannot reach your
laptop, and the worker deploy refuses an `APP_URL` on `localhost`.

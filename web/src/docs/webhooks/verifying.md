# Verifying a call

Your endpoint is a public URL. Anybody can post to it. The signature is what
separates a real event from a stranger's.

## The scheme

```
X-Mails-Signature: t=1758448682,v1=4a8f3c…
```

`v1` is `HMAC-SHA256(secret, "<t>.<raw body>")`, hex.

To check it:

1. Split `t` and `v1` out of the header.
2. Reject if `t` is more than **300 seconds** from now. That is what stops an
   old call being replayed at you.
3. Recompute the HMAC over `` `${t}.${rawBody}` ``.
4. Compare in **constant time**.

> **Danger:** Verify the raw body. `JSON.parse` followed by `JSON.stringify`
> does not always give back the same bytes: key order, number formatting,
> escapes. The signature is over bytes.
>
> Read the body as text or a buffer, verify, **then** parse.

## With the SDK

`constructWebhookEvent` does all four steps and throws if anything is wrong,
so a handler that forgets to check a return value still cannot be fooled.

**Fetch API (Workers, Bun, Deno, route handlers)**

```ts
import { constructWebhookEvent } from "@shahriyardx/mails";

export async function POST(request: Request) {
  const raw = await request.text();

  try {
    const event = await constructWebhookEvent({
      secret: process.env.MAILS_WEBHOOK_SECRET!,
      payload: raw,
      signature: request.headers.get("x-mails-signature"),
    });

    switch (event.type) {
      case "mail.received":
        await queue.add("new-mail", { id: event.data.email.id });
        break;
      case "email.bounced":
        console.warn("bounced", event.data.recipients, event.data.detail);
        break;
    }

    return Response.json({ ok: true });
  } catch {
    return new Response("bad signature", { status: 400 });
  }
}
```

**Express**

```js
const express = require("express");
const { constructWebhookEvent } = require("@shahriyardx/mails");

const app = express();

app.post(
  "/hooks/mail",
  express.raw({ type: "application/json" }), // not express.json()
  async (req, res) => {
    try {
      const event = await constructWebhookEvent({
        secret: process.env.MAILS_WEBHOOK_SECRET,
        payload: req.body,
        signature: req.get("x-mails-signature"),
      });
      res.json({ ok: true });
      await handle(event);
    } catch {
      res.status(400).send("bad signature");
    }
  },
);
```

**Hono on Workers**

```ts
import { Hono } from "hono";
import { constructWebhookEvent } from "@shahriyardx/mails";

const app = new Hono<{ Bindings: { MAILS_WEBHOOK_SECRET: string } }>();

app.post("/hooks/mail", async (c) => {
  const raw = await c.req.text();
  try {
    const event = await constructWebhookEvent({
      secret: c.env.MAILS_WEBHOOK_SECRET,
      payload: raw,
      signature: c.req.header("x-mails-signature"),
    });
    return c.json({ ok: true, type: event.type });
  } catch {
    return c.text("bad signature", 400);
  }
});
```


`verifyWebhook` is the same check as a plain boolean if you would rather parse
the body yourself.

## Without the SDK

**Node**

```js
const { createHmac, timingSafeEqual } = require("node:crypto");

function verify(secret, rawBody, header, tolerance = 300) {
  const parts = Object.fromEntries(
    header.split(",").map((piece) => {
      const at = piece.indexOf("=");
      return [piece.slice(0, at).trim(), piece.slice(at + 1).trim()];
    }),
  );

  const timestamp = Number(parts.t);
  if (!Number.isFinite(timestamp)) return false;
  if (Math.abs(Date.now() / 1000 - timestamp) > tolerance) return false;

  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");

  const left = Buffer.from(expected, "utf8");
  const right = Buffer.from(parts.v1 ?? "", "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}
```

**Python**

```python
import hmac, hashlib, time

def verify(secret: str, raw_body: bytes, header: str, tolerance: int = 300) -> bool:
    parts = dict(
        piece.strip().split("=", 1) for piece in header.split(",") if "=" in piece
    )
    try:
        timestamp = int(parts["t"])
    except (KeyError, ValueError):
        return False

    if abs(time.time() - timestamp) > tolerance:
        return False

    expected = hmac.new(
        secret.encode(),
        f"{timestamp}.".encode() + raw_body,
        hashlib.sha256,
    ).hexdigest()

    return hmac.compare_digest(expected, parts.get("v1", ""))
```

**Go**

```go
func Verify(secret, rawBody, header string, tolerance time.Duration) bool {
	var ts int64
	var got string
	for _, piece := range strings.Split(header, ",") {
		name, value, ok := strings.Cut(strings.TrimSpace(piece), "=")
		if !ok {
			continue
		}
		switch name {
		case "t":
			ts, _ = strconv.ParseInt(value, 10, 64)
		case "v1":
			got = value
		}
	}
	if ts == 0 {
		return false
	}
	if d := time.Since(time.Unix(ts, 0)); d > tolerance || d < -tolerance {
		return false
	}

	mac := hmac.New(sha256.New, []byte(secret))
	fmt.Fprintf(mac, "%d.%s", ts, rawBody)
	want := hex.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(want), []byte(got))
}
```


## Testing your handler

Sign a body yourself and post it, rather than waiting for real mail:

```ts
import { signWebhookPayload } from "@shahriyardx/mails";

const body = JSON.stringify({
  id: "whd_test",
  object: "event",
  type: "mail.received",
  created_at: new Date().toISOString(),
  data: { email: { id: "msg_test", subject: "Hello" } },
});

await fetch("http://localhost:3000/hooks/mail", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Mails-Signature": await signWebhookPayload("whsec_…", body),
  },
  body,
});
```

Or point a real endpoint at a tunnel and use
[ping](/docs/api/webhooks#test), which tells you the status and the reply your
handler gave.

## Rotating a secret

```sh
curl -X PATCH https://mail.yourdomain.com/api/v1/webhooks/whk_… \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{ "rotate_secret": true }'
```

The new secret is in the reply, once. There is no overlap window, and a call
your handler rejects with a `4xx` is not retried. So put the new secret in
your handler as soon as you have it, then
[replay](/docs/webhooks/retries#replaying) whatever it rejected in between.

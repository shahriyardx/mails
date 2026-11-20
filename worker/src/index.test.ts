import { afterEach, describe, expect, it, vi } from "vitest";
import worker, { type Env } from "./index";

/** An R2 bucket that remembers what is in it. */
function fakeBucket() {
  const keys = new Set<string>();
  return {
    keys,
    put: vi.fn(async (key: string) => {
      keys.add(key);
    }),
    delete: vi.fn(async (list: string | string[]) => {
      for (const key of [list].flat()) keys.delete(key);
    }),
  };
}

function setup(raw: string, reply: Response) {
  const bucket = fakeBucket();
  const env = {
    ATTACHMENTS: bucket,
    APP_INBOUND_URL: "https://app.test/api/inbound",
    INBOUND_WEBHOOK_SECRET: "s",
  } as unknown as Env;
  const message = {
    from: "bounce@sender.test",
    to: "me@example.com",
    raw: new Response(raw).body,
    setReject: vi.fn(),
    forward: vi.fn(async () => undefined),
  } as unknown as ForwardableEmailMessage;
  const ctx = { waitUntil: () => undefined } as unknown as ExecutionContext;
  const fetch = vi.fn(async (_url: string, _init: RequestInit) => reply);
  vi.stubGlobal("fetch", fetch);
  const sent = () => JSON.parse(fetch.mock.calls[0]![1].body as string);
  return { bucket, run: () => worker.email(message, env, ctx), sent };
}

const withFile = (from: string) =>
  [
    `From: ${from}`,
    "To: me@example.com",
    "Subject: hi",
    'Content-Type: multipart/mixed; boundary="b"',
    "",
    "--b",
    "Content-Type: text/plain",
    "",
    "hello",
    "--b",
    "Content-Type: text/plain",
    'Content-Disposition: attachment; filename="a.txt"',
    "",
    "file",
    "--b--",
    "",
  ].join("\r\n");

const ok = () => new Response(JSON.stringify({ stored: 1, forward: [] }), { status: 200 });

afterEach(() => vi.unstubAllGlobals());

describe("sender", () => {
  it.each(["Mailer Daemon", "<>", '"Shop" <>'])("falls back to the envelope for From: %s", async (from) => {
    const { run, sent } = setup(withFile(from), ok());
    await run();
    expect(sent().email.from.address).toBe("bounce@sender.test");
  });

  it("keeps the header address when there is one", async () => {
    const { run, sent } = setup(withFile('"Shop" <Shop@Store.test>'), ok());
    await run();
    expect(sent().email.from).toEqual({ name: "Shop", address: "shop@store.test" });
  });
});

describe("stored copies", () => {
  it("are kept when the app stores the message", async () => {
    const { run, bucket } = setup(withFile("a@b.test"), ok());
    await run();
    expect(bucket.keys.size).toBe(2);
  });

  it("are deleted when the app has no mailbox (202)", async () => {
    const { run, bucket } = setup(
      withFile("a@b.test"),
      new Response(JSON.stringify({ stored: 0, forward: [] }), { status: 202 }),
    );
    await run();
    expect(bucket.put).toHaveBeenCalledTimes(2);
    expect(bucket.keys.size).toBe(0);
  });

  it("are deleted when the app refuses the message (4xx)", async () => {
    const { run, bucket } = setup(withFile("a@b.test"), new Response("{}", { status: 400 }));
    await expect(run()).rejects.toThrow(/400/);
    expect(bucket.keys.size).toBe(0);
  });

  it("are kept after a 5xx, since the app may have stored them", async () => {
    const { run, bucket } = setup(withFile("a@b.test"), new Response("{}", { status: 500 }));
    await expect(run()).rejects.toThrow(/500/);
    expect(bucket.keys.size).toBe(2);
  });

  it("are deleted when writing them fails, and the first error is the one thrown", async () => {
    const { run, bucket } = setup(withFile("a@b.test"), ok());
    bucket.put.mockImplementation(async (key: string) => {
      bucket.keys.add(key);
      if (key.startsWith("inbound/")) throw new Error("r2 down");
    });
    bucket.delete.mockRejectedValueOnce(new Error("delete failed"));
    await expect(run()).rejects.toThrow("r2 down");
    expect(bucket.delete).toHaveBeenCalledTimes(1);
  });
});

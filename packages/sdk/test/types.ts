// Compile-time checks on the public types: `pnpm typecheck` fails if they drift.
import type { MailsWebhookEvent } from "../src/index.js";

export function senderOf(event: MailsWebhookEvent): string | undefined {
  // email.sent, email.failed and email.canceled carry the full message.
  if (event.type === "email.sent" || event.type === "email.failed" || event.type === "email.canceled") {
    return event.data.email.from.address;
  }
  return undefined;
}

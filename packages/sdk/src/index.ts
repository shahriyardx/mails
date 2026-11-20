/**
 * The Node and TypeScript SDK for Mails.
 */
export { Mails } from "./client.js";
export { Mails as default } from "./client.js";

export {
  HttpClient,
  paginate,
  type MailsOptions,
  type RateLimitState,
  type RequestOptions,
} from "./http.js";

export {
  AuthenticationError,
  ConflictError,
  ConnectionError,
  MailsError,
  NotFoundError,
  PayloadTooLargeError,
  PermissionError,
  RateLimitError,
  ServerError,
  TimeoutError,
  ValidationError,
  WebhookVerificationError,
  isMailsError,
  type MailsErrorCode,
} from "./errors.js";

export {
  constructWebhookEvent,
  signWebhookPayload,
  verifyWebhook,
  type DeliveryEmailSummary,
  type MailsWebhookEvent,
  type ReceivedEmail,
  type SentEmailSummary,
  type VerifyOptions,
  type WebhookEventEnvelope,
} from "./webhook.js";

export type * from "./types.js";

export type { ListEmailsParams } from "./resources/emails.js";
export type { ListThreadsParams, ReplyInput, UpdateThreadInput } from "./resources/threads.js";
export type { ListMessagesParams, UpdateMessageInput } from "./resources/messages.js";
export type { CreateMailboxInput, UpdateMailboxInput } from "./resources/mailboxes.js";
export type { CreateLabelInput, UpdateLabelInput } from "./resources/labels.js";
export type { ListContactsParams } from "./resources/contacts.js";
export type { ListSuppressionsParams } from "./resources/suppressions.js";
export type {
  CreateWebhookInput,
  ListDeliveriesParams,
  UpdateWebhookInput,
} from "./resources/webhooks.js";
export type { StatsParams } from "./resources/stats.js";

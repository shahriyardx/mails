import type { ComponentType } from "react";

/**
 * Every settings page, in sidebar order (groups appear in the order of their
 * first page). The router, the settings nav and the page header all read
 * this list, so adding a page is one entry here plus its file:
 *
 *   { path: "domains", title: "Domains", icon: "language", group: "Sending",
 *     description: "The domains you send from.",
 *     load: () => import("./domains") }   // domains.tsx: export default function
 *
 * A page without `load` shows the "coming soon" placeholder.
 */
export interface SettingsPage {
  path: string;
  title: string;
  /** One line under the title saying what the page does. */
  description: string;
  /** Material Symbols name (must be in scripts/fetch-icons.mjs). */
  icon: string;
  group: "Sending" | "Receiving" | "Mail" | "Alerts" | "Developers" | "Insights" | "You";
  load?: () => Promise<{ default: ComponentType }>;
}

export const SETTINGS_PAGES: SettingsPage[] = [
  {
    path: "domains",
    title: "Domains",
    description: "The domains you send from, as Amazon SES identities, and their DNS records.",
    icon: "language",
    group: "Sending",
    load: () => import("./domains"),
  },
  {
    path: "mailboxes",
    title: "Mailboxes",
    description: "The addresses that send and receive mail, with their names and signatures.",
    icon: "alternate_email",
    group: "Sending",
    load: () => import("./mailboxes"),
  },
  {
    path: "inbound",
    title: "Inbound",
    description: "How mail reaches Mails: the Cloudflare Email Worker and its routing.",
    icon: "move_to_inbox",
    group: "Receiving",
    load: () => import("./inbound"),
  },
  {
    path: "forwarding",
    title: "Forwarding",
    description: "Copies of incoming mail sent on to other inboxes.",
    icon: "forward_to_inbox",
    group: "Receiving",
    load: () => import("./forwarding"),
  },
  {
    path: "labels",
    title: "Labels",
    description: "Tags you put on conversations to find them again.",
    icon: "label",
    group: "Mail",
    load: () => import("./labels"),
  },
  {
    path: "filters",
    title: "Filters",
    description: "Rules that sort incoming mail as it arrives.",
    icon: "filter_alt",
    group: "Mail",
    load: () => import("./filters"),
  },
  {
    path: "notifications",
    title: "Notifications",
    description: "Push notifications for new mail on this device.",
    icon: "notifications",
    group: "Alerts",
    load: () => import("./notifications"),
  },
  {
    path: "reporting",
    title: "Reporting",
    description: "Delivery, bounce and complaint events from Amazon SES.",
    icon: "bar_chart",
    group: "Alerts",
    load: () => import("./reporting"),
  },
  {
    path: "blocked",
    title: "Blocked addresses",
    description: "Addresses Mails will not send to after a bounce or complaint.",
    icon: "block",
    group: "Alerts",
    load: () => import("./blocked"),
  },
  {
    path: "api-keys",
    title: "API keys",
    description: "Keys for the REST API and the Node SDK, each with its own scopes.",
    icon: "key",
    group: "Developers",
    load: () => import("./api-keys"),
  },
  {
    path: "webhooks",
    title: "Webhooks",
    description: "Signed HTTP calls to your endpoints when mail events happen.",
    icon: "webhook",
    group: "Developers",
    load: () => import("./webhooks"),
  },
  {
    path: "logs",
    title: "Logs",
    description: "Every message sent and every delivery event, newest first.",
    icon: "list_alt",
    group: "Developers",
    load: () => import("./logs"),
  },
  {
    path: "overview",
    title: "Overview",
    description: "How sending is going at a glance.",
    icon: "dashboard",
    group: "Insights",
    load: () => import("./overview"),
  },
  {
    path: "metrics",
    title: "Metrics",
    description: "Sends, deliveries, bounces and opens over time.",
    icon: "monitoring",
    group: "Insights",
    load: () => import("./metrics"),
  },
  {
    path: "account",
    title: "Account",
    description: "The GitHub account that owns this Mails, and your sessions.",
    icon: "account_circle",
    group: "You",
    load: () => import("./account"),
  },
  {
    path: "appearance",
    title: "Preferences",
    description: "Theme, density and how conversations open.",
    icon: "palette",
    group: "You",
    load: () => import("./appearance"),
  },
  {
    path: "setup",
    title: "Setup",
    description: "The first-run checklist: what is done and what is left.",
    icon: "done_all",
    group: "You",
    load: () => import("./setup"),
  },
];

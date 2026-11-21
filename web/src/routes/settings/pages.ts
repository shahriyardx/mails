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
    description: "Domains you send from.",
    icon: "language",
    group: "Sending",
    load: () => import("./domains"),
  },
  {
    path: "mailboxes",
    title: "Mailboxes",
    description: "Addresses that send and receive mail.",
    icon: "alternate_email",
    group: "Sending",
    load: () => import("./mailboxes"),
  },
  {
    path: "inbound",
    title: "Inbound",
    description: "Receive mail through Cloudflare.",
    icon: "move_to_inbox",
    group: "Receiving",
    load: () => import("./inbound"),
  },
  {
    path: "forwarding",
    title: "Forwarding",
    description: "Send copies of incoming mail elsewhere.",
    icon: "forward_to_inbox",
    group: "Receiving",
    load: () => import("./forwarding"),
  },
  {
    path: "labels",
    title: "Labels",
    description: "Tags for conversations.",
    icon: "label",
    group: "Mail",
    load: () => import("./labels"),
  },
  {
    path: "filters",
    title: "Filters",
    description: "Sort incoming mail automatically.",
    icon: "filter_alt",
    group: "Mail",
    load: () => import("./filters"),
  },
  {
    path: "notifications",
    title: "Notifications",
    description: "New mail alerts on this device.",
    icon: "notifications",
    group: "Alerts",
    load: () => import("./notifications"),
  },
  {
    path: "reporting",
    title: "Reporting",
    description: "Delivery and bounce events from SES.",
    icon: "bar_chart",
    group: "Alerts",
    load: () => import("./reporting"),
  },
  {
    path: "blocked",
    title: "Blocked addresses",
    description: "Addresses Mails will not send to.",
    icon: "block",
    group: "Alerts",
    load: () => import("./blocked"),
  },
  {
    path: "api-keys",
    title: "API keys",
    description: "Keys for the API and SDK.",
    icon: "key",
    group: "Developers",
    load: () => import("./api-keys"),
  },
  {
    path: "webhooks",
    title: "Webhooks",
    description: "Get told when mail events happen.",
    icon: "webhook",
    group: "Developers",
    load: () => import("./webhooks"),
  },
  {
    path: "logs",
    title: "Logs",
    description: "Every send and delivery event.",
    icon: "list_alt",
    group: "Developers",
    load: () => import("./logs"),
  },
  {
    path: "overview",
    title: "Overview",
    description: "Sending at a glance.",
    icon: "dashboard",
    group: "Insights",
    load: () => import("./overview"),
  },
  {
    path: "metrics",
    title: "Metrics",
    description: "Sends and bounces over time.",
    icon: "monitoring",
    group: "Insights",
    load: () => import("./metrics"),
  },
  {
    path: "account",
    title: "Account",
    description: "Your GitHub sign-in and sessions.",
    icon: "account_circle",
    group: "You",
    load: () => import("./account"),
  },
  {
    path: "appearance",
    title: "Preferences",
    description: "Theme, layout and undo send.",
    icon: "palette",
    group: "You",
    load: () => import("./appearance"),
  },
  {
    path: "setup",
    title: "Setup",
    description: "What is set up and what is left.",
    icon: "done_all",
    group: "You",
    load: () => import("./setup"),
  },
];

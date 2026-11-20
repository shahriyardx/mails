import type { ComponentType } from "react";

/**
 * Every settings page, in sidebar order. The router and the settings nav both
 * read this list, so adding a page is one entry here plus its file:
 *
 *   { path: "domains", title: "Domains", icon: "language", group: "Sending",
 *     load: () => import("./domains") }   // domains.tsx: export default function
 *
 * A page without `load` shows the "coming soon" placeholder.
 */
export interface SettingsPage {
  path: string;
  title: string;
  /** Material Symbols name (must be in scripts/fetch-icons.mjs). */
  icon: string;
  group: "You" | "Mail" | "Sending" | "Developers" | "Insights";
  load?: () => Promise<{ default: ComponentType }>;
}

export const SETTINGS_PAGES: SettingsPage[] = [
  {
    path: "account",
    title: "Account",
    icon: "account_circle",
    group: "You",
    load: () => import("./account"),
  },
  {
    path: "appearance",
    title: "Appearance",
    icon: "palette",
    group: "You",
    load: () => import("./appearance"),
  },
  {
    path: "notifications",
    title: "Notifications",
    icon: "notifications",
    group: "You",
    load: () => import("./notifications"),
  },
  { path: "setup", title: "Setup", icon: "done_all", group: "You", load: () => import("./setup") },
  {
    path: "mailboxes",
    title: "Mailboxes",
    icon: "alternate_email",
    group: "Mail",
    load: () => import("./mailboxes"),
  },
  { path: "labels", title: "Labels", icon: "label", group: "Mail", load: () => import("./labels") },
  {
    path: "filters",
    title: "Filters",
    icon: "filter_alt",
    group: "Mail",
    load: () => import("./filters"),
  },
  {
    path: "blocked",
    title: "Blocked",
    icon: "block",
    group: "Mail",
    load: () => import("./blocked"),
  },
  {
    path: "forwarding",
    title: "Forwarding",
    icon: "forward_to_inbox",
    group: "Mail",
    load: () => import("./forwarding"),
  },
  {
    path: "domains",
    title: "Domains",
    icon: "language",
    group: "Sending",
    load: () => import("./domains"),
  },
  {
    path: "inbound",
    title: "Inbound",
    icon: "move_to_inbox",
    group: "Sending",
    load: () => import("./inbound"),
  },
  {
    path: "api-keys",
    title: "API keys",
    icon: "key",
    group: "Developers",
    load: () => import("./api-keys"),
  },
  {
    path: "webhooks",
    title: "Webhooks",
    icon: "webhook",
    group: "Developers",
    load: () => import("./webhooks"),
  },
  {
    path: "logs",
    title: "Logs",
    icon: "list_alt",
    group: "Developers",
    load: () => import("./logs"),
  },
  {
    path: "overview",
    title: "Overview",
    icon: "dashboard",
    group: "Insights",
    load: () => import("./overview"),
  },
  {
    path: "metrics",
    title: "Metrics",
    icon: "monitoring",
    group: "Insights",
    load: () => import("./metrics"),
  },
  {
    path: "reporting",
    title: "Reporting",
    icon: "bar_chart",
    group: "Insights",
    load: () => import("./reporting"),
  },
];

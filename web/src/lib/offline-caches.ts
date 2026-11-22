/** Cache Storage names the service worker (src/sw.ts) fills; sign-out empties them. */
export const RUNTIME_CACHES = {
  avatars: "mails-avatars",
  attachments: "mails-attachments",
} as const;

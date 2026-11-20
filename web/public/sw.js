// Mails service worker: web push only (no offline cache).
// Payload: {"title", "body", "url", "tag"} as sent by internal/push.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "New mail";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      tag: data.tag || undefined,
      // Same tag: the newer message replaces the older notification quietly.
      renotify: false,
      icon: "/favicon.svg",
      data: { url: data.url || "/mail/all/inbox" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  // Only same-origin paths: a payload cannot send the click elsewhere.
  const target = new URL(event.notification.data?.url || "/", self.location.origin);
  if (target.origin !== self.location.origin) return;
  event.waitUntil(
    (async () => {
      const tabs = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const tab of tabs) {
        if (new URL(tab.url).origin === target.origin) {
          await tab.focus();
          return tab.navigate(target.href);
        }
      }
      return self.clients.openWindow(target.href);
    })(),
  );
});

/// <reference lib="webworker" />
// Mails service worker, built by vite-plugin-pwa (injectManifest).
//
// - Precaches the app shell (HTML, JS, CSS, fonts, icons), so the app opens
//   with no connection. Every page path falls back to index.html.
// - Keeps sender pictures and opened attachments for offline reading.
//   Mail data itself lives in IndexedDB (src/lib/offline.ts), not here.
// - Nothing else under /api is touched: auth, inbound, SES, /api/v1 and every
//   write always go straight to the network.
// - Web push. Payload: {"title", "body", "url", "tag"} as sent by internal/push.
import { CacheableResponsePlugin } from "workbox-cacheable-response";
import { ExpirationPlugin } from "workbox-expiration";
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { CacheFirst, StaleWhileRevalidate } from "workbox-strategies";
import { RUNTIME_CACHES } from "./lib/offline-caches";

declare let self: ServiceWorkerGlobalScope;

// ?v= on the icon font only busts the browser cache; the precache has its own revision.
precacheAndRoute(self.__WB_MANIFEST, { ignoreURLParametersMatching: [/^v$/, /^utm_/] });
cleanupOutdatedCaches();

// The page asks for the new version with "Reload" (src/components/app/offline.tsx).
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") void self.skipWaiting();
});
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

registerRoute(
  new NavigationRoute(createHandlerBoundToURL("/index.html"), { denylist: [/^\/api\//] }),
);

const ok = new CacheableResponsePlugin({ statuses: [200] });

// Sender pictures: show the saved one at once, refresh it in the background.
registerRoute(
  ({ url, request }) =>
    request.method === "GET" &&
    url.origin === self.location.origin &&
    url.pathname === "/api/app/avatar",
  new StaleWhileRevalidate({
    cacheName: RUNTIME_CACHES.avatars,
    plugins: [ok, new ExpirationPlugin({ maxEntries: 500, maxAgeSeconds: 30 * 24 * 3600 })],
  }),
);

// Attachments and inline images never change once stored: keep the first copy.
registerRoute(
  ({ url, request }) =>
    request.method === "GET" &&
    url.origin === self.location.origin &&
    url.pathname.startsWith("/api/app/attachments/"),
  new CacheFirst({
    cacheName: RUNTIME_CACHES.attachments,
    plugins: [
      ok,
      new ExpirationPlugin({
        maxEntries: 300,
        maxAgeSeconds: 30 * 24 * 3600,
        purgeOnQuotaError: true,
      }),
    ],
  }),
);

self.addEventListener("push", (event) => {
  let data: { title?: string; body?: string; url?: string; tag?: string } = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "New mail", {
      body: data.body || "",
      tag: data.tag || undefined,
      // Same tag: the newer message replaces the older notification quietly.
      renotify: false,
      icon: "/icons/192.png",
      data: { url: data.url || "/mail/all/inbox" },
    } as NotificationOptions),
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
          await tab.navigate(target.href);
          return;
        }
      }
      await self.clients.openWindow(target.href);
    })(),
  );
});

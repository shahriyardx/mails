// Browser side of web push: the service worker (src/sw.ts, registered in
// components/app/offline.tsx) plus PushManager. The server half is /api/app/push.

export type PushSupport = "ready" | "insecure" | "home-screen" | "unsupported";

export function pushSupport(): PushSupport {
  if (typeof window === "undefined") return "unsupported";
  if (!window.isSecureContext) return "insecure";
  if (
    !("serviceWorker" in navigator) ||
    !("PushManager" in window) ||
    !("Notification" in window)
  ) {
    // iPhone and iPad give web push only to apps added to the Home Screen.
    return isAppleMobile(navigator) && !isInstalled() ? "home-screen" : "unsupported";
  }
  return "ready";
}

/** iPhone or iPad (iPadOS says Macintosh, but has touch). */
export function isAppleMobile(nav: Pick<Navigator, "userAgent" | "maxTouchPoints">) {
  return (
    /iPhone|iPad|iPod/.test(nav.userAgent) ||
    (/Macintosh/.test(nav.userAgent) && nav.maxTouchPoints > 1)
  );
}

/** Opened as the installed app, not in a browser tab. */
function isInstalled() {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** A VAPID key (base64url) as PushManager wants it. */
export function urlBase64ToUint8Array(value: string) {
  const base64 = (value + "=".repeat((4 - (value.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

// Order matters: Edge and Opera also say Chrome, Chrome also says Safari,
// Android also says Linux.
const BROWSERS: [string, RegExp][] = [
  ["Edge", /Edg\//],
  ["Opera", /OPR\//],
  ["Firefox", /Firefox\//],
  ["Chrome", /Chrome\//],
  ["Safari", /Safari\//],
];
const SYSTEMS: [string, RegExp][] = [
  ["Android", /Android/],
  ["iOS", /iPhone|iPad/],
  ["Windows", /Windows/],
  ["macOS", /Mac OS X/],
  ["Linux", /Linux/],
];

/** "Firefox on Linux": how a subscribed browser is listed. */
export function describeBrowser(userAgent: string) {
  const find = (list: [string, RegExp][]) => list.find(([, re]) => re.test(userAgent))?.[0];
  const browser = find(BROWSERS) ?? "A browser";
  const os = find(SYSTEMS);
  return os ? `${browser} on ${os}` : browser;
}

async function registration() {
  // Same script as main.tsx, so this is a no-op there; it also covers dev,
  // where main.tsx does not register it.
  await navigator.serviceWorker.register("/sw.js");
  return navigator.serviceWorker.ready;
}

/** This browser's push endpoint, or null when it has none. */
export async function currentEndpoint() {
  if (pushSupport() !== "ready") return null;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub?.endpoint ?? null;
}

/** Asks for permission and subscribes, returning the body for /push/subscribe. */
export async function subscribeBrowser(publicKey: string) {
  const support = pushSupport();
  if (support === "insecure") throw new Error("Notifications need https.");
  if (support === "unsupported") throw new Error("This browser cannot show notifications.");
  if (support === "home-screen") {
    throw new Error("Add Mails to the Home Screen first, then turn this on in the app.");
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error(
      permission === "denied"
        ? "Notifications are blocked for this site. Allow them in the browser's site settings."
        : "Notifications were not allowed.",
    );
  }
  const reg = await registration();
  const key = urlBase64ToUint8Array(publicKey);
  let sub = await reg.pushManager.getSubscription();
  // A subscription made with an older VAPID key can never be delivered to.
  const old = sub?.options.applicationServerKey;
  if (sub && old && !sameBytes(new Uint8Array(old), key)) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) {
    throw new Error("The browser did not return a usable subscription.");
  }
  return {
    endpoint: json.endpoint,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    label: describeBrowser(navigator.userAgent),
  };
}

/** Unsubscribes this browser; returns the endpoint it had. */
export async function unsubscribeBrowser() {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return null;
  await sub.unsubscribe();
  return sub.endpoint;
}

function sameBytes(a: Uint8Array, b: Uint8Array) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

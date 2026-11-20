import { createBrowserRouter, Navigate, useLocation, useParams } from "react-router";
import { AuthGate, Splash } from "@/app/auth-gate";
import { NotFound, RouteError } from "@/app/route-error";
import { isFolder } from "@/lib/mail";
import { SETTINGS_PAGES } from "@/routes/settings/pages";

/**
 * Routes. Every screen is its own chunk (lazy), so the first load carries
 * only the shell. URL formats:
 *
 *   /mail/:scope/:folder?t=<threadId>&reply=reply|replyAll|forward
 *     scope: all | <domain> | <mailbox id mbx_...>; folder: inbox|starred|...
 *   /settings/<page>   pages listed in routes/settings/pages.ts
 *   /docs/*            the markdown docs viewer (phase 2)
 */
export const router = createBrowserRouter([
  {
    path: "/sign-in",
    lazy: () => import("@/routes/sign-in"),
    errorElement: <RouteError />,
    HydrateFallback: Splash,
  },
  {
    element: <AuthGate />,
    errorElement: <RouteError />,
    HydrateFallback: Splash,
    children: [
      { index: true, element: <Navigate to="/mail/all/inbox" replace /> },
      { path: "mail", element: <Navigate to="/mail/all/inbox" replace /> },
      { path: "mail/:folder", element: <ShortMailLink /> },
      { path: "mail/:scope/:folder", lazy: () => import("@/routes/mail") },
      {
        path: "settings",
        lazy: () => import("@/routes/settings/layout"),
        children: [
          { index: true, element: <Navigate to={SETTINGS_PAGES[0]!.path} replace /> },
          ...SETTINGS_PAGES.map((page) => ({
            path: page.path,
            lazy: page.load
              ? async () => ({ Component: (await page.load!()).default })
              : () => import("@/routes/settings/placeholder"),
          })),
        ],
      },
      { path: "docs/*", lazy: () => import("@/routes/docs") },
      { path: "*", element: <NotFound /> },
    ],
  },
]);

/** /mail/inbox?thread=... (older push links) to /mail/all/inbox?t=... */
function ShortMailLink() {
  const { folder } = useParams();
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  const thread = params.get("thread");
  if (thread) {
    params.delete("thread");
    params.set("t", thread);
  }
  const qs = params.toString();
  return (
    <Navigate
      to={`/mail/all/${isFolder(folder) ? folder : "inbox"}${qs ? `?${qs}` : ""}`}
      replace
    />
  );
}

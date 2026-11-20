import { useLocation } from "react-router";
import { Card, EmptyState } from "@/components/kit";
import { SETTINGS_PAGES } from "./pages";

/** Shown for a settings page that has no `load` in pages.ts yet. */
export function Component() {
  const { pathname } = useLocation();
  const page = SETTINGS_PAGES.find((p) => pathname.startsWith(`/settings/${p.path}`));
  return (
    <Card>
      <EmptyState
        icon={page?.icon ?? "settings"}
        title={`${page?.title ?? "This page"} is coming soon`}
        body="This settings page is not built yet. The API behind it already works."
      />
    </Card>
  );
}

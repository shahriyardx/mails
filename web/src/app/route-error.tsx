import { Link, useRouteError } from "react-router";
import { Button, EmptyState } from "@/components/kit";

/** A route failed to load or render (often a stale chunk after a deploy). */
export function RouteError() {
  const error = useRouteError();
  console.error(error);
  return (
    <div className="grid h-dvh place-items-center">
      <EmptyState
        icon="error"
        title="This page failed to load"
        body="A newer version may have been deployed. Reloading usually fixes it."
        action={<Button onClick={() => window.location.reload()}>Reload</Button>}
      />
    </div>
  );
}

export function NotFound() {
  return (
    <div className="grid h-dvh place-items-center">
      <EmptyState
        icon="help"
        title="Nothing here"
        body="This address does not match any page."
        action={
          <Button render={<Link to="/" />} nativeButton={false}>
            Go to the inbox
          </Button>
        }
      />
    </div>
  );
}

import { createContext, useContext } from "react";
import { Navigate, Outlet, useLocation } from "react-router";
import { Button, EmptyState, Logo } from "@/components/kit";
import { ComposerProvider } from "@/components/mail/composer-provider";
import { errorMessage, useAuthStatus, useLiveUpdates } from "@/lib/api";
import type { Owner } from "@/lib/types";

const OwnerContext = createContext<Owner | null>(null);

/** The signed-in owner. Only valid under AuthGate. */
export function useOwner() {
  const owner = useContext(OwnerContext);
  if (!owner) throw new Error("useOwner outside AuthGate");
  return owner;
}

/** Shown while auth or a route's code is loading. */
export function Splash() {
  return (
    <div className="grid h-dvh place-items-center">
      <Logo className="size-10 animate-pulse" />
    </div>
  );
}

/**
 * Lets the app through only with an owner session (GET /api/auth/status),
 * and turns on live updates and the composer for everything inside.
 */
export function AuthGate() {
  const status = useAuthStatus();
  const location = useLocation();
  const owner = status.data?.owner ?? null;
  useLiveUpdates(Boolean(owner));

  if (status.isPending) return <Splash />;
  if (status.isError) {
    return (
      <div className="grid h-dvh place-items-center">
        <EmptyState
          icon="cloud"
          title="Cannot reach Mails"
          body={errorMessage(status.error)}
          action={<Button onClick={() => status.refetch()}>Try again</Button>}
        />
      </div>
    );
  }
  // ponytail: the page asked for is not carried through sign-in (the Go
  // callback always lands on /); add a ?next round trip if deep links need it.
  if (!owner) {
    const next = location.pathname + location.search;
    return (
      <Navigate
        to={next === "/" ? "/sign-in" : `/sign-in?next=${encodeURIComponent(next)}`}
        replace
      />
    );
  }
  return (
    <OwnerContext.Provider value={owner}>
      <ComposerProvider>
        <Outlet />
      </ComposerProvider>
    </OwnerContext.Provider>
  );
}

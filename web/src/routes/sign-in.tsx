import { Navigate, useSearchParams } from "react-router";
import { Button, Card, Icon, Logo } from "@/components/kit";
import { useAuthStatus } from "@/lib/api";

/** What the Go callback's ?error= reasons mean (internal/auth). */
const ERRORS: Record<string, string> = {
  taken: "This Mails already has an owner, and it is a different GitHub account.",
  state: "The sign-in link expired or was opened in another browser. Try again.",
  github: "GitHub did not complete the sign-in. Try again.",
  server: "The server failed to finish signing you in. Check its logs and try again.",
};

export function Component() {
  const [params] = useSearchParams();
  const status = useAuthStatus();
  if (status.data?.owner) return <Navigate to="/" replace />;

  const error = params.get("error");
  const claimed = status.data?.claimed ?? true;

  return (
    <main className="grid min-h-dvh place-items-center p-4">
      <Card className="w-full max-w-sm items-center gap-6 px-8 py-10 text-center">
        <Logo className="size-12" />
        <div className="space-y-2">
          <h1 className="text-2xl font-medium tracking-tight">Sign in to Mails</h1>
          <p className="text-sm text-muted-foreground">
            {claimed
              ? "Only the owner of this instance can sign in."
              : "No owner yet: the first GitHub account to sign in becomes the owner."}
          </p>
        </div>
        {error && (
          <p
            role="alert"
            className="flex gap-2 rounded-2xl bg-destructive-soft p-3 text-left text-[13px] text-destructive"
          >
            <Icon name="error" size={18} />
            {ERRORS[error] ?? "Sign-in failed. Try again."}
          </p>
        )}
        <Button
          variant="primary"
          size="lg"
          block
          render={<a href={signInHref(params.get("next"))} />}
          nativeButton={false}
        >
          Continue with GitHub
        </Button>
      </Card>
    </main>
  );
}

/** The GitHub sign-in link, carrying where to return to (the server checks it). */
function signInHref(next: string | null) {
  return next?.startsWith("/") && !next.startsWith("//")
    ? `/api/auth/github?next=${encodeURIComponent(next)}`
    : "/api/auth/github";
}

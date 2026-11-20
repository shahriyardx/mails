import { useOwner } from "@/app/auth-gate";
import { Avatar, Button, toast } from "@/components/kit";
import { errorMessage, useSignOut } from "@/lib/api";
import { CopyValue, DangerZone, PageAction, Section } from "./parts";

/** Who owns this instance (from GitHub), sign out, and how to hand it over. */
export default function Account() {
  const owner = useOwner();
  const signOut = useSignOut();

  return (
    <div className="space-y-10">
      <PageAction>
        <Button
          variant="outline"
          icon="logout"
          title="Ends this browser's session. Mail keeps arriving."
          loading={signOut.isPending}
          onClick={() =>
            signOut.mutate(undefined, { onError: (error) => toast.error(errorMessage(error)) })
          }
        >
          Sign out
        </Button>
      </PageAction>

      <Section title="Signed in as">
        <div className="flex items-center gap-4 rounded-[14px] border border-border bg-surface p-4">
          <Avatar
            name={owner.name || owner.login}
            address={owner.email}
            src={owner.avatar_url}
            className="size-12 text-base"
          />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{owner.name || owner.login}</p>
            <p className="font-mono text-xs break-all text-muted-foreground">
              @{owner.login} · {owner.email || "email not public on GitHub"}
            </p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">From GitHub, updated at each sign-in.</p>
      </Section>

      <DangerZone title="Hand over this instance">
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          Run this on the server to give Mails to another GitHub account. It signs the owner out
          everywhere; the next GitHub sign-in becomes the owner. Mail and settings stay.
        </p>
        <CopyValue value="mails reset-owner" label="Copy command" />
        <p className="text-xs text-muted-foreground">
          With Docker Compose:{" "}
          <span className="font-mono">docker compose exec mails /mails reset-owner</span>
        </p>
      </DangerZone>
    </div>
  );
}

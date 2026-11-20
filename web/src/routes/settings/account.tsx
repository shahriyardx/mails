import { useOwner } from "@/app/auth-gate";
import { Avatar, Button, toast } from "@/components/kit";
import { errorMessage, useSignOut } from "@/lib/api";
import { CopyValue, DangerZone, PageAction, Section } from "./parts";

/** Who owns this instance (from GitHub), sign out, and how to hand it over. */
export default function Account() {
  const owner = useOwner();
  const signOut = useSignOut();
  const rows = [
    ["Name", owner.name || "Not set on GitHub"],
    ["GitHub", `@${owner.login}`],
    ["Email", owner.email || "Not public on GitHub"],
  ];

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

      <Section
        title="Signed in as"
        description="This instance has one owner: the GitHub account that signed in first."
      >
        <div className="rounded-[14px] border border-border bg-surface">
          <div className="flex items-center gap-4 p-4">
            <Avatar
              name={owner.name || owner.login}
              address={owner.email}
              src={owner.avatar_url}
              className="size-12 text-base"
            />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{owner.name || owner.login}</p>
              <p className="truncate font-mono text-xs text-muted-foreground">@{owner.login}</p>
            </div>
          </div>
          <dl>
            {rows.map(([term, value]) => (
              <div
                key={term}
                className="flex flex-wrap gap-x-4 gap-y-0.5 border-t border-border px-4 py-3"
              >
                <dt className="w-20 shrink-0 text-[13px] text-muted-foreground">{term}</dt>
                <dd className="min-w-0 flex-1 break-all font-mono text-[13px]">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
        <p className="text-xs text-muted-foreground">
          Name, email and picture come from GitHub and update when you sign in again.
        </p>
      </Section>

      <DangerZone title="Hand over this instance">
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          To give Mails to another GitHub account, run this on the server. It removes the owner and
          their sessions; the next GitHub sign-in becomes the owner. Mail, domains and settings
          stay.
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

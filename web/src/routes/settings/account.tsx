import { useOwner } from "@/app/auth-gate";
import {
  Avatar,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  toast,
} from "@/components/kit";
import { errorMessage, useSignOut } from "@/lib/api";
import { CopyValue } from "./parts";

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
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Signed in as</CardTitle>
          <CardDescription>
            This instance has one owner: the GitHub account that signed in first.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <Avatar
              name={owner.name || owner.login}
              address={owner.email}
              src={owner.avatar_url}
              className="size-14 text-lg"
            />
            <div className="min-w-0">
              <p className="truncate text-base font-medium">{owner.name || owner.login}</p>
              <p className="truncate font-mono text-[13px] text-muted-foreground">@{owner.login}</p>
            </div>
          </div>
          <dl className="divide-y divide-border rounded-2xl bg-box">
            {rows.map(([term, value]) => (
              <div key={term} className="flex flex-wrap gap-x-4 gap-y-0.5 px-4 py-3">
                <dt className="w-20 shrink-0 text-[13px] text-muted-foreground">{term}</dt>
                <dd className="min-w-0 flex-1 break-all font-mono text-[13px]">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="text-xs text-muted-foreground">
            Name, email and picture come from GitHub and update when you sign in again.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sign out</CardTitle>
          <CardDescription>Ends this browser's session. Mail keeps arriving.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            icon="logout"
            loading={signOut.isPending}
            onClick={() =>
              signOut.mutate(undefined, { onError: (error) => toast.error(errorMessage(error)) })
            }
          >
            Sign out
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Hand over this instance</CardTitle>
          <CardDescription>
            To give Mails to another GitHub account, run this on the server. It removes the owner
            and their sessions; the next GitHub sign-in becomes the owner. Mail, domains and
            settings stay.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CopyValue value="mails reset-owner" label="Copy command" />
          <p className="mt-2 text-xs text-muted-foreground">
            With Docker Compose:{" "}
            <span className="font-mono">docker compose exec mails /mails reset-owner</span>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

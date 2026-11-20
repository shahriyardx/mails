import { Link } from "react-router";
import { useOwner } from "@/app/auth-gate";
import {
  Avatar,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuLinkItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/kit";
import { useSignOut } from "@/lib/api";

/**
 * The owner's avatar, opening sign out and the links the screen around it
 * does not already show (`settings`, `docs`).
 */
export function AccountMenu({
  settings = false,
  docs = true,
}: {
  settings?: boolean;
  docs?: boolean;
}) {
  const owner = useOwner();
  const signOut = useSignOut();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Account"
        className="rounded-full p-1 outline-none hover:bg-tonal focus-visible:outline-2 focus-visible:outline-ring"
      >
        <Avatar name={owner.name || owner.login} address={owner.email} src={owner.avatar_url} />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-64">
        <DropdownMenuLabel>
          <span className="block truncate text-sm font-medium text-foreground">
            {owner.name || owner.login}
          </span>
          <span className="block truncate font-mono text-xs">
            {owner.email || `@${owner.login}`}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {settings && (
          <DropdownMenuLinkItem icon="settings" render={<Link to="/settings" />}>
            Settings
          </DropdownMenuLinkItem>
        )}
        {docs && (
          <DropdownMenuLinkItem icon="menu_book" render={<Link to="/docs" />}>
            Docs
          </DropdownMenuLinkItem>
        )}
        {(settings || docs) && <DropdownMenuSeparator />}
        <DropdownMenuItem icon="logout" onClick={() => signOut.mutate()}>
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

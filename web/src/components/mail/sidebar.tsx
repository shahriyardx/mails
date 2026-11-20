import { type ReactNode, useMemo } from "react";
import { Link } from "react-router";
import { AccountMenu } from "@/components/app/account-menu";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { Button, Count, Icon, Wordmark } from "@/components/kit";
import { useCounts, useLabels, useMailboxes } from "@/lib/api";
import { cn } from "@/lib/cn";
import { FOLDER_META, FOLDERS, mailHref, type Scope, scopeSegment } from "@/lib/mail";
import type { Mailbox, ViewFolder } from "@/lib/types";
import { useComposer } from "./composer-provider";

/**
 * Brand and theme switch, Write message, folders, then mailboxes and labels
 * marked with small coloured squares. Rendered in the fixed column and in
 * the phone drawer.
 */
export function Sidebar({
  scope,
  folder,
  label,
  onNavigate,
}: {
  scope: Scope;
  folder: ViewFolder;
  label: string | null;
  onNavigate?: () => void;
}) {
  const counts = useCounts(
    scope.kind === "mailbox"
      ? { mailbox: scope.id }
      : scope.kind === "domain"
        ? { domain: scope.domain }
        : {},
  );
  const mailboxes = useMailboxes();
  const labels = useLabels();
  const composer = useComposer();
  const segment = scopeSegment(scope);

  const domains = useMemo(() => {
    const map = new Map<string, Mailbox[]>();
    for (const box of mailboxes.data ?? [])
      map.set(box.domain, [...(map.get(box.domain) ?? []), box]);
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [mailboxes.data]);
  const unread = counts.data?.mailboxes ?? {};

  return (
    <SidebarFrame>
      <Button
        variant="primary"
        icon="edit"
        className="h-10 w-full shrink-0 font-semibold"
        onClick={() => {
          onNavigate?.();
          composer.open();
        }}
      >
        Write message
      </Button>

      <nav aria-label="Mail" className="-mx-1 min-h-0 flex-1 space-y-5 overflow-y-auto px-1">
        <ul className="space-y-px">
          {FOLDERS.map((item) => (
            <li key={item}>
              <NavRow
                to={mailHref(segment, item)}
                active={folder === item && !label}
                onClick={onNavigate}
                end={
                  item !== "trash" && item !== "archive" ? (
                    <Count value={counts.data?.folders[item] ?? 0} />
                  ) : null
                }
              >
                {FOLDER_META[item].label}
              </NavRow>
            </li>
          ))}
        </ul>

        <NavGroup title="Mailboxes">
          <li>
            <NavRow
              to={mailHref("all", folder)}
              active={scope.kind === "all"}
              onClick={onNavigate}
              lead={<Square className="border border-muted-foreground" />}
            >
              All mailboxes
            </NavRow>
          </li>
          {domains.map(([domain, boxes]) => (
            <li key={domain}>
              {domains.length > 1 && (
                <NavRow
                  to={mailHref(domain, folder)}
                  active={scope.kind === "domain" && scope.domain === domain}
                  onClick={onNavigate}
                  lead={<Square className="border border-muted-foreground" />}
                >
                  {domain}
                </NavRow>
              )}
              <ul className={cn("space-y-px", domains.length > 1 && "pl-4")}>
                {boxes.map((box) => (
                  <li key={box.id}>
                    <NavRow
                      to={mailHref(box.id, folder)}
                      active={scope.kind === "mailbox" && scope.id === box.id}
                      onClick={onNavigate}
                      lead={<Square color={box.color} />}
                      end={<Count value={unread[box.id] ?? 0} />}
                    >
                      {domains.length > 1 ? `${box.address.split("@")[0]}@` : box.address}
                    </NavRow>
                  </li>
                ))}
              </ul>
            </li>
          ))}
          {mailboxes.data?.length === 0 && (
            <li className="px-2.5 py-1.5 text-[13px] text-muted-foreground">
              None yet.{" "}
              <Link to="/settings/mailboxes" className="text-accent underline" onClick={onNavigate}>
                Add one
              </Link>
            </li>
          )}
        </NavGroup>

        {(labels.data?.length ?? 0) > 0 && (
          <NavGroup title="Labels">
            {labels.data!.map((item) => (
              <li key={item.id}>
                <NavRow
                  to={mailHref(segment, folder, { label: item.id })}
                  active={label === item.id}
                  onClick={onNavigate}
                  lead={<Square color={item.color} />}
                >
                  {item.name}
                </NavRow>
              </li>
            ))}
          </NavGroup>
        )}
      </nav>

      <div className="-mx-1 flex shrink-0 items-center gap-1 px-1">
        <NavRow
          to="/settings"
          active={false}
          onClick={onNavigate}
          lead={<Icon name="settings" size={18} className="text-muted-foreground" />}
          className="flex-1"
        >
          Settings
        </NavRow>
        <AccountMenu />
      </div>
    </SidebarFrame>
  );
}

/** The sidebar's shell, shared with settings: brand and theme switch on top. */
export function SidebarFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-5 px-4 pt-5 pb-3">
      <div className="flex h-8 shrink-0 items-center justify-between pl-2">
        <Link
          to="/mail/all/inbox"
          className="rounded-md outline-none focus-visible:outline-2 focus-visible:outline-ring"
        >
          <Wordmark />
        </Link>
        <ThemeToggle />
      </div>
      {children}
    </div>
  );
}

export function NavGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="px-2.5 pb-1.5 font-sans text-[11px] font-semibold tracking-[0.1em] text-muted-foreground uppercase">
        {title}
      </h2>
      <ul className="space-y-px">{children}</ul>
    </section>
  );
}

function Square({ color, className }: { color?: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("size-2 shrink-0 rounded-[2px]", className)}
      style={color ? { background: color } : undefined}
    />
  );
}

export function NavRow({
  to,
  active,
  lead,
  end,
  onClick,
  className,
  children,
}: {
  to: string;
  active: boolean;
  lead?: ReactNode;
  end?: ReactNode;
  onClick?: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link
      to={to}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-8.5 min-w-0 items-center gap-2.5 rounded-lg px-2.5 font-medium outline-none transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
        active
          ? "bg-surface text-foreground shadow-[inset_0_0_0_1px_var(--border)]"
          : "text-soft-foreground hover:bg-surface hover:text-foreground",
        className,
      )}
    >
      {lead}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {end}
    </Link>
  );
}

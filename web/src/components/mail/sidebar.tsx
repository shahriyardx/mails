import { createContext, type ReactNode, useContext, useMemo } from "react";
import { Link } from "react-router";
import { AccountMenu } from "@/components/app/account-menu";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { Button, Count, Icon, IconButton, Logo, Tooltip, Wordmark } from "@/components/kit";
import { useCounts, useLabels, useMailboxes } from "@/lib/api";
import { cn } from "@/lib/cn";
import { FOLDER_META, FOLDERS, mailHref, type Scope, scopeSegment } from "@/lib/mail";
import { setSidebarCollapsed, useSidebarCollapsed } from "@/lib/sidebar";
import type { Mailbox, ViewFolder } from "@/lib/types";
import { useComposer } from "./composer-provider";

/**
 * Brand and theme switch, Write message, folders, then mailboxes and labels
 * marked with small coloured squares. Rendered in the fixed column (which
 * can fold down to icons) and in the phone drawer (always full).
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

  const write = () => {
    onNavigate?.();
    composer.open();
  };

  return (
    <SidebarFrame collapsible drawer={Boolean(onNavigate)}>
      <WriteButton onClick={write} />

      <nav aria-label="Mail" className="-mx-1 min-h-0 flex-1 space-y-5 overflow-y-auto px-1">
        <ul className="space-y-px">
          {FOLDERS.map((item) => (
            <li key={item}>
              <NavRow
                to={mailHref(segment, item)}
                active={folder === item && !label}
                onClick={onNavigate}
                icon={FOLDER_META[item].icon}
                count={
                  item === "inbox" || item === "drafts" || item === "spam"
                    ? (counts.data?.folders[item] ?? 0)
                    : undefined
                }
              >
                {FOLDER_META[item].label}
              </NavRow>
            </li>
          ))}
        </ul>

        {/* One mailbox is the same as all of them: nothing to pick. */}
        {mailboxes.data?.length !== 1 && (
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
                <ul className={cn("space-y-px", domains.length > 1 && "pl-4 in-data-folded:pl-0")}>
                  {boxes.map((box) => (
                    <li key={box.id}>
                      <NavRow
                        to={mailHref(box.id, folder)}
                        active={scope.kind === "mailbox" && scope.id === box.id}
                        onClick={onNavigate}
                        lead={<Square color={box.color} />}
                        count={unread[box.id] ?? 0}
                        tip={box.address}
                      >
                        {domains.length > 1 ? `${box.address.split("@")[0]}@` : box.address}
                      </NavRow>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
            {mailboxes.data?.length === 0 && (
              <li className="px-2.5 py-1.5 text-[13px] text-muted-foreground in-data-folded:hidden">
                None yet.{" "}
                <Link
                  to="/settings/mailboxes"
                  className="text-accent underline"
                  onClick={onNavigate}
                >
                  Add one
                </Link>
              </li>
            )}
          </NavGroup>
        )}

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

      <div className="-mx-1 flex shrink-0 items-center gap-1 px-1 in-data-folded:flex-col in-data-folded:gap-2">
        <FoldedThemeToggle />
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

const Folded = createContext(false);

/**
 * The desktop column: full width, or icons only when folded. Folded, the
 * expand button sits on the border and shows on hover or keyboard focus.
 */
export function SidebarAside({ children }: { children: ReactNode }) {
  const folded = useSidebarCollapsed();
  return (
    <aside
      className={cn(
        "group/aside relative hidden shrink-0 border-r border-border transition-[width] duration-200 md:block",
        folded ? "w-17" : "w-58",
      )}
    >
      {children}
      {folded && (
        <Tooltip label="Expand sidebar" side="right">
          <IconButton
            icon="chevron_right"
            label="Expand sidebar"
            variant="outline"
            size="xs"
            className="absolute top-6 -right-3.5 z-20 size-7 rounded-full bg-background opacity-0 transition-opacity group-hover/aside:opacity-100 focus-visible:opacity-100"
            onClick={() => setSidebarCollapsed(false)}
          />
        </Tooltip>
      )}
    </aside>
  );
}

/**
 * The sidebar's shell, shared with settings and docs: brand and theme switch
 * on top. `collapsible` adds the fold button; the phone drawer (`drawer`) is
 * never folded.
 */
export function SidebarFrame({
  children,
  collapsible = false,
  drawer = false,
}: {
  children: ReactNode;
  collapsible?: boolean;
  drawer?: boolean;
}) {
  const stored = useSidebarCollapsed();
  const folded = collapsible && !drawer && stored;
  return (
    <div
      data-folded={folded || undefined}
      className={cn(
        "flex h-full min-h-0 flex-col gap-5 pt-5 pb-3",
        folded ? "items-center px-2.5" : "px-4",
      )}
    >
      {folded ? (
        <Link
          to="/mail/all/inbox"
          aria-label="Mails"
          className="grid size-8 shrink-0 place-items-center rounded-md outline-none focus-visible:outline-2 focus-visible:outline-ring"
        >
          <Logo className="size-5" />
        </Link>
      ) : (
        <div className="flex h-8 shrink-0 items-center justify-between gap-1 pl-2">
          <Link
            to="/mail/all/inbox"
            className="mr-auto rounded-md outline-none focus-visible:outline-2 focus-visible:outline-ring"
          >
            <Wordmark />
          </Link>
          <ThemeToggle />
          {collapsible && !drawer && (
            <Tooltip label="Collapse sidebar">
              <IconButton
                icon="chevron_left"
                label="Collapse sidebar"
                variant="outline"
                size="xs"
                onClick={() => setSidebarCollapsed(true)}
              />
            </Tooltip>
          )}
        </div>
      )}
      <Folded.Provider value={folded}>{children}</Folded.Provider>
    </div>
  );
}

/** Folded, the theme switch moves down to the bottom row. */
export function FoldedThemeToggle() {
  return useContext(Folded) ? <ThemeToggle /> : null;
}

function WriteButton({ onClick }: { onClick: () => void }) {
  if (useContext(Folded)) {
    return (
      <Tooltip label="Write message" side="right">
        <IconButton
          icon="edit"
          label="Write message"
          variant="primary"
          className="size-10 shrink-0"
          onClick={onClick}
        />
      </Tooltip>
    );
  }
  return (
    <Button
      variant="primary"
      icon="edit"
      className="h-10 w-full shrink-0 font-semibold"
      onClick={onClick}
    >
      Write message
    </Button>
  );
}

export function NavGroup({ title, children }: { title: string; children: ReactNode }) {
  if (useContext(Folded)) {
    return (
      <section aria-label={title}>
        <div aria-hidden className="mx-auto mb-2 h-px w-6 bg-border" />
        <ul className="flex flex-col items-center gap-px">{children}</ul>
      </section>
    );
  }
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
      className={cn("size-2 shrink-0 rounded-[2px] in-data-folded:size-2.5", className)}
      style={color ? { background: color } : undefined}
    />
  );
}

const rowState = (active: boolean) =>
  active
    ? "bg-surface text-foreground shadow-[inset_0_0_0_1px_var(--border)]"
    : "text-soft-foreground hover:bg-surface hover:text-foreground";

/**
 * One sidebar link. Folded, it shows `icon` (or `lead`) alone with the label
 * as a tooltip, and a dot when `count` is above zero.
 */
export function NavRow({
  to,
  active,
  icon,
  lead,
  end,
  count,
  tip,
  onClick,
  className,
  children,
}: {
  to: string;
  active: boolean;
  /** Material Symbols name, shown only when the sidebar is folded. */
  icon?: string;
  lead?: ReactNode;
  end?: ReactNode;
  count?: number;
  /** Tooltip when folded; defaults to the label. */
  tip?: string;
  onClick?: () => void;
  className?: string;
  children: ReactNode;
}) {
  const focus =
    "outline-none transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring";
  if (useContext(Folded)) {
    const label = tip ?? (typeof children === "string" ? children : undefined);
    return (
      <Tooltip label={tip ?? children} side="right">
        <Link
          to={to}
          onClick={onClick}
          aria-label={label}
          aria-current={active ? "page" : undefined}
          className={cn(
            "relative grid size-10 place-items-center rounded-lg",
            focus,
            rowState(active),
          )}
        >
          {icon ? <Icon name={icon} size={20} /> : lead}
          {(count ?? 0) > 0 && (
            <span aria-hidden className="absolute top-2 right-2 size-1.5 rounded-full bg-primary" />
          )}
        </Link>
      </Tooltip>
    );
  }
  return (
    <Link
      to={to}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-8.5 min-w-0 items-center gap-2.5 rounded-lg px-2.5 font-medium",
        focus,
        rowState(active),
        className,
      )}
    >
      {lead}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {count !== undefined ? <Count value={count} /> : end}
    </Link>
  );
}

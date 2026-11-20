import { motion } from "motion/react";
import { type ReactNode, useMemo, useState } from "react";
import { Link } from "react-router";
import { Button, Count, Icon, Wordmark } from "@/components/kit";
import { spatial } from "@/components/kit/motion";
import { useCounts, useLabels, useMailboxes } from "@/lib/api";
import { cn } from "@/lib/cn";
import { FOLDER_META, FOLDERS, mailHref, type Scope, scopeSegment } from "@/lib/mail";
import type { Mailbox, ViewFolder } from "@/lib/types";
import { useComposer } from "./composer-provider";

/**
 * Folders, mailboxes grouped by domain, and labels. The active item wears a
 * pill that slides between items (shared layout animation). Rendered twice
 * (fixed column and phone drawer), so each copy names its own pill ids.
 */
export function Sidebar({
  scope,
  folder,
  label,
  instance,
  onNavigate,
}: {
  scope: Scope;
  folder: ViewFolder;
  label: string | null;
  instance: string;
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

  const pill = `${instance}-folder`;
  const scopePill = `${instance}-scope`;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-16 shrink-0 items-center px-5">
        <Wordmark />
      </div>

      <div className="px-3 pb-4">
        <Button
          variant="primary"
          size="lg"
          icon="edit"
          className="px-5"
          onClick={() => {
            onNavigate?.();
            composer.open();
          }}
        >
          Compose
        </Button>
      </div>

      <nav aria-label="Mail" className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        <ul className="space-y-0.5">
          {FOLDERS.map((item) => (
            <li key={item}>
              <NavItem
                to={mailHref(segment, item)}
                active={folder === item && !label}
                pill={pill}
                icon={FOLDER_META[item].icon}
                onClick={onNavigate}
                end={
                  item !== "trash" && item !== "archive" ? (
                    <Count value={counts.data?.folders[item] ?? 0} />
                  ) : null
                }
              >
                {FOLDER_META[item].label}
              </NavItem>
            </li>
          ))}
        </ul>

        <Section title="Mailboxes">
          <li>
            <NavItem
              to={mailHref("all", folder)}
              active={scope.kind === "all"}
              pill={scopePill}
              icon="all_inbox"
              onClick={onNavigate}
            >
              All mail
            </NavItem>
          </li>
          {domains.map(([domain, boxes]) => (
            <DomainGroup
              key={domain}
              domain={domain}
              boxes={boxes}
              scope={scope}
              folder={folder}
              unread={counts.data?.mailboxes ?? {}}
              pill={scopePill}
              onNavigate={onNavigate}
            />
          ))}
          {mailboxes.data?.length === 0 && (
            <li className="px-4 py-2 text-[13px] text-muted-foreground">
              None yet.{" "}
              <Link
                to="/settings/mailboxes"
                className="text-foreground underline"
                onClick={onNavigate}
              >
                Add one
              </Link>
            </li>
          )}
        </Section>

        {(labels.data?.length ?? 0) > 0 && (
          <Section title="Labels">
            {labels.data!.map((item) => (
              <li key={item.id}>
                <NavItem
                  to={mailHref(segment, folder, { label: item.id })}
                  active={label === item.id}
                  pill={pill}
                  onClick={onNavigate}
                  lead={
                    <span
                      className="mx-[5px] size-2.5 rounded-full"
                      style={{ background: item.color }}
                      aria-hidden
                    />
                  }
                >
                  {item.name}
                </NavItem>
              </li>
            ))}
          </Section>
        )}
      </nav>

      <div className="shrink-0 space-y-0.5 px-3 pb-3">
        <NavItem to="/settings" active={false} pill={pill} icon="settings" onClick={onNavigate}>
          Settings
        </NavItem>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <h2 className="px-4 pt-6 pb-1.5 text-xs font-medium text-muted-foreground">{title}</h2>
      <ul className="space-y-0.5">{children}</ul>
    </>
  );
}

function NavItem({
  to,
  active,
  pill,
  icon,
  lead,
  end,
  onClick,
  className,
  children,
}: {
  to: string;
  active: boolean;
  pill: string;
  icon?: string;
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
        "relative isolate flex h-10 items-center gap-3 rounded-full px-4 text-sm outline-none transition-colors focus-visible:outline-2 focus-visible:outline-ring",
        active ? "font-semibold" : "text-foreground/90 hover:bg-tonal",
        className,
      )}
    >
      {active && (
        <motion.span
          layoutId={pill}
          transition={spatial}
          className="absolute inset-0 -z-10 rounded-full bg-selected"
        />
      )}
      {icon && <Icon name={icon} filled={active} />}
      {lead}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {end}
    </Link>
  );
}

function DomainGroup({
  domain,
  boxes,
  scope,
  folder,
  unread,
  pill,
  onNavigate,
}: {
  domain: string;
  boxes: Mailbox[];
  scope: Scope;
  folder: ViewFolder;
  unread: Record<string, number>;
  pill: string;
  onNavigate?: () => void;
}) {
  const inside =
    (scope.kind === "domain" && scope.domain === domain) ||
    boxes.some((b) => scope.kind === "mailbox" && scope.id === b.id);
  const [open, setOpen] = useState(inside || boxes.length === 1);
  const total = boxes.reduce((sum, box) => sum + (unread[box.id] ?? 0), 0);

  return (
    <li>
      <div className="relative flex items-center">
        <NavItem
          to={mailHref(domain, folder)}
          active={scope.kind === "domain" && scope.domain === domain}
          pill={pill}
          icon="language"
          onClick={onNavigate}
          className="flex-1 pr-11"
          end={<Count value={open ? 0 : total} />}
        >
          {domain}
        </NavItem>
        <button
          type="button"
          aria-label={open ? `Collapse ${domain}` : `Expand ${domain}`}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="absolute right-1 grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-tonal-hover hover:text-foreground"
        >
          <Icon
            name="expand_more"
            size={18}
            className={cn("transition-transform", open && "rotate-180")}
          />
        </button>
      </div>
      {open && (
        <ul className="mt-0.5 space-y-0.5 pl-4">
          {boxes.map((box) => (
            <li key={box.id}>
              <NavItem
                to={mailHref(box.id, folder)}
                active={scope.kind === "mailbox" && scope.id === box.id}
                pill={pill}
                icon="alternate_email"
                onClick={onNavigate}
                end={<Count value={unread[box.id] ?? 0} />}
              >
                <span className="font-mono text-[13px]">{box.address.split("@")[0]}</span>
              </NavItem>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

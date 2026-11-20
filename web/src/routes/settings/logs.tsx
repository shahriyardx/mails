import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Choice } from "@/components/app/choice";
import { CopyButton } from "@/components/app/copy";
import { Button, Icon, Input, List, Skeleton, Tabs, TabsList, TabsTab } from "@/components/kit";
import { errorMessage, useApiKeys, useLogs, useMessage } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatAddress, formatDateTime, formatStamp, mailHref } from "@/lib/mail";
import type { DeliveryStatus, LogFilter, LogRow } from "@/lib/types";
import { emptyBox, LoadError, Notice, PageAction, StatusDot } from "./parts";

const ANY = "any";

const STATUS: Record<DeliveryStatus, { label: string; tone: "ok" | "pending" | "bad" | "off" }> = {
  queued: { label: "Queued", tone: "pending" },
  sent: { label: "Sent", tone: "ok" },
  delivered: { label: "Delivered", tone: "ok" },
  bounced: { label: "Bounced", tone: "bad" },
  complained: { label: "Complained", tone: "bad" },
  rejected: { label: "Rejected", tone: "bad" },
  delayed: { label: "Delayed", tone: "pending" },
  failed: { label: "Failed", tone: "bad" },
  canceled: { label: "Canceled", tone: "off" },
};

const STATUS_OPTIONS = Object.fromEntries(
  Object.entries(STATUS).map(([status, { label }]) => [status, label]),
);

const EVENTS: Record<string, { label: string; icon: string }> = {
  send: { label: "Sent to SES", icon: "send" },
  delivery: { label: "Delivered", icon: "check_circle" },
  bounce: { label: "Bounced", icon: "error" },
  complaint: { label: "Marked as spam", icon: "report" },
  reject: { label: "Rejected", icon: "block" },
  open: { label: "Opened", icon: "visibility" },
  click: { label: "Link clicked", icon: "link" },
  delivery_delay: { label: "Delayed", icon: "warning" },
  rendering_failure: { label: "Render failed", icon: "error" },
};

const BAD_EVENTS = ["bounce", "complaint", "reject", "rendering_failure"];

const DAYS = { d1: "Last 24 hours", d7: "Last 7 days", d30: "Last 30 days", all: "Any time" };

function Status({ status }: { status: DeliveryStatus | null }) {
  if (!status) return null;
  const s = STATUS[status] ?? { label: status, tone: "off" };
  return <StatusDot tone={s.tone}>{s.label}</StatusDot>;
}

/** Debounces a value (search box -> query). */
function useDebounced<T>(value: T, ms = 300) {
  const [out, setOut] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setOut(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return out;
}

/** /settings/logs: every message sent or received, with its delivery events. */
export default function Logs() {
  const [direction, setDirection] = useState<LogFilter["direction"]>("sending");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState(ANY);
  const [days, setDays] = useState<keyof typeof DAYS>("d30");
  const [apiKey, setApiKey] = useState(ANY);
  const [open, setOpen] = useState<string | null>(null);
  const q = useDebounced(search.trim());
  const keys = useApiKeys();
  const sending = direction === "sending";

  const filter: LogFilter = {
    direction,
    q: q || undefined,
    status: sending && status !== ANY ? status : undefined,
    days: days === "all" ? undefined : Number(days.slice(1)),
    api_key_id: sending && apiKey !== ANY ? apiKey : undefined,
  };
  const logs = useLogs(filter);
  const rows = logs.data?.pages.flatMap((p) => p.data) ?? [];
  const keyList = keys.data?.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      {/* On the title row, like Overview, so the tab line runs the full width. */}
      <PageAction>
        <Button
          variant="outline"
          icon="refresh"
          loading={logs.isRefetching && !logs.isFetchingNextPage}
          onClick={() => logs.refetch()}
        >
          Refresh
        </Button>
      </PageAction>
      <Tabs value={direction} onValueChange={(v) => setDirection(v as LogFilter["direction"])}>
        <TabsList>
          <TabsTab value="sending">Sending</TabsTab>
          <TabsTab value="receiving">Receiving</TabsTab>
        </TabsList>
      </Tabs>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-[1fr_auto_auto_auto]">
        <div className="relative col-span-2 md:col-span-1">
          <Icon
            name="search"
            size={18}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            aria-label="Search"
            placeholder="Subject, address or SES id"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        {sending && (
          <Choice
            label="Status"
            value={status}
            onChange={setStatus}
            options={{ [ANY]: "Any status", ...STATUS_OPTIONS }}
          />
        )}
        <Choice
          label="Time"
          value={days}
          onChange={(v) => setDays(v as keyof typeof DAYS)}
          options={DAYS}
        />
        {sending && keyList.length > 0 && (
          <Choice
            label="API key"
            value={apiKey}
            onChange={setApiKey}
            options={Object.fromEntries([
              [ANY, "Any source"],
              ...keyList.map((k) => [k.id, `Key: ${k.name}`]),
            ])}
          />
        )}
      </div>

      {logs.isPending ? (
        <List aria-busy="true">
          {[0, 1, 2].map((i) => (
            <li key={i} className="px-4 py-3">
              <Skeleton className="h-9" />
            </li>
          ))}
        </List>
      ) : logs.isError ? (
        <LoadError error={logs.error} retry={logs.refetch} />
      ) : rows.length === 0 ? (
        <p className={cn(emptyBox, "text-muted-foreground")}>
          {q || status !== ANY
            ? "Nothing matches."
            : sending
              ? "Nothing sent yet."
              : "Nothing received yet."}
        </p>
      ) : (
        <List>
          {rows.map((row) => {
            const expanded = open === row.id;
            return (
              <li key={row.id}>
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => setOpen(expanded ? null : row.id)}
                  className="flex w-full items-center gap-4 px-4 py-3 text-left outline-none transition-colors hover:bg-box focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-[13px]">
                      {sending
                        ? (row.to ?? []).map((a) => a.address).join(", ") || "(no recipient)"
                        : row.from}
                    </span>
                    <span className="block truncate text-[13px] text-muted-foreground">
                      {row.subject || "(no subject)"}
                      {row.error && <span className="text-destructive"> · {row.error}</span>}
                    </span>
                  </span>
                  <span className="hidden max-w-48 shrink-0 items-center gap-1.5 font-mono text-xs text-muted-foreground md:flex">
                    <span
                      aria-hidden
                      className="size-1.75 shrink-0 rounded-full"
                      style={{ background: row.mailbox_color }}
                    />
                    <span className="truncate">{row.mailbox}</span>
                  </span>
                  {sending && (
                    <span className="w-24 shrink-0">
                      <Status status={row.status} />
                    </span>
                  )}
                  <span className="w-14 shrink-0 text-right font-mono text-xs text-muted-foreground">
                    {formatStamp(row.at)}
                  </span>
                </button>
                {expanded && <MessageDetail row={row} outbound={sending} />}
              </li>
            );
          })}
        </List>
      )}

      {logs.hasNextPage && (
        <Button
          variant="ghost"
          className="self-center"
          loading={logs.isFetchingNextPage}
          onClick={() => logs.fetchNextPage()}
        >
          Load more
        </Button>
      )}
    </div>
  );
}

/** The message under its open row: addresses, ids, checks and delivery events. */
function MessageDetail({ row, outbound }: { row: LogRow; outbound: boolean }) {
  const message = useMessage(row.id);
  const m = message.data;
  const events = m?.events ?? [];

  return (
    <div className="flex flex-col gap-4 border-t border-border px-4 py-4">
      {message.isPending ? (
        <Skeleton className="h-28" />
      ) : message.isError ? (
        <Notice tone="danger">Could not load it. {errorMessage(message.error)}</Notice>
      ) : m ? (
        <>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-[13px]">
            <dt className="text-muted-foreground">Time</dt>
            <dd className="font-mono">{formatDateTime(row.at)}</dd>
            <dt className="text-muted-foreground">From</dt>
            <dd className="min-w-0 font-mono break-all">{formatAddress(m.from)}</dd>
            <dt className="text-muted-foreground">To</dt>
            <dd className="min-w-0 font-mono break-all">
              {(m.to ?? []).map(formatAddress).join(", ") || "—"}
            </dd>
            {m.cc && m.cc.length > 0 && (
              <>
                <dt className="text-muted-foreground">Cc</dt>
                <dd className="min-w-0 font-mono break-all">
                  {m.cc.map(formatAddress).join(", ")}
                </dd>
              </>
            )}
            <dt className="text-muted-foreground">Mailbox</dt>
            <dd className="min-w-0 font-mono break-all">{m.mailbox}</dd>
            {outbound && (
              <>
                <dt className="text-muted-foreground">Opens</dt>
                <dd className="font-mono">{m.open_count}</dd>
              </>
            )}
            <dt className="text-muted-foreground">Id</dt>
            <dd className="flex min-w-0 items-center gap-1 font-mono break-all">
              {m.id}
              <CopyButton text={m.id} label="Copy message id" />
            </dd>
            {m.ses_message_id && (
              <>
                <dt className="text-muted-foreground">SES id</dt>
                <dd className="flex min-w-0 items-center gap-1 font-mono break-all">
                  {m.ses_message_id}
                  <CopyButton text={m.ses_message_id} label="Copy SES id" />
                </dd>
              </>
            )}
            {!outbound && (m.spf || m.dkim || m.dmarc) && (
              <>
                <dt className="text-muted-foreground">Checks</dt>
                <dd className="font-mono">
                  SPF {m.spf ?? "—"} · DKIM {m.dkim ?? "—"} · DMARC {m.dmarc ?? "—"}
                </dd>
              </>
            )}
          </dl>

          {m.error && <Notice tone="danger">{m.error}</Notice>}

          {outbound && (
            <section aria-label="What happened" className="flex flex-col gap-2">
              <h3 className="text-[13px] font-semibold">What happened</h3>
              {events.length === 0 ? (
                <p className="text-[13px] text-muted-foreground">No delivery events yet.</p>
              ) : (
                <ol className="flex flex-col divide-y divide-border rounded-[10px] border border-border">
                  {events.map((e) => {
                    const meta = EVENTS[e.type] ?? { label: e.type, icon: "info" };
                    const bad = BAD_EVENTS.includes(e.type);
                    return (
                      <li key={e.id} className="flex items-start gap-3 px-3 py-2">
                        <Icon
                          name={meta.icon}
                          size={18}
                          className={bad ? "mt-px text-destructive" : "mt-px text-muted-foreground"}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-[13px] font-medium">{meta.label}</div>
                          {(e.recipient || e.detail) && (
                            <div className="text-xs break-words text-muted-foreground">
                              {[e.recipient, e.detail].filter(Boolean).join(" · ")}
                            </div>
                          )}
                        </div>
                        <time
                          dateTime={e.occurred_at}
                          className="shrink-0 font-mono text-xs text-muted-foreground"
                        >
                          {formatDateTime(e.occurred_at)}
                        </time>
                      </li>
                    );
                  })}
                </ol>
              )}
            </section>
          )}

          <Button
            size="sm"
            icon="mail"
            className="self-start"
            render={<Link to={mailHref("all", outbound ? "sent" : "inbox", { t: m.thread_id })} />}
            nativeButton={false}
          >
            Open the thread
          </Button>
        </>
      ) : null}
    </div>
  );
}

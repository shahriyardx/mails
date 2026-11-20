import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Choice } from "@/components/app/choice";
import { CopyButton } from "@/components/app/copy";
import {
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Icon,
  IconButton,
  Input,
  Skeleton,
  Tabs,
  TabsList,
  TabsTab,
} from "@/components/kit";
import { errorMessage, useApiKeys, useLogs, useMessage } from "@/lib/api";
import { formatAddress, formatDateTime, formatStamp, mailHref } from "@/lib/mail";
import type { DeliveryStatus, LogFilter, LogRow } from "@/lib/types";

const ANY = "any";

const STATUS_LABEL: Record<DeliveryStatus, string> = {
  queued: "Queued",
  sent: "Sent",
  delivered: "Delivered",
  bounced: "Bounced",
  complained: "Complained",
  rejected: "Rejected",
  delayed: "Delayed",
  failed: "Failed",
  canceled: "Canceled",
};

const BAD: DeliveryStatus[] = ["bounced", "complained", "rejected", "failed"];

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

const DAYS = { d1: "Last 24 hours", d7: "Last 7 days", d30: "Last 30 days", all: "Any time" };

function StatusBadge({ status }: { status: DeliveryStatus | null }) {
  if (!status) return null;
  return (
    <Badge
      size="sm"
      tone={BAD.includes(status) ? "danger" : status === "delivered" ? "strong" : "neutral"}
    >
      {STATUS_LABEL[status] ?? status}
    </Badge>
  );
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
  const [open, setOpen] = useState<LogRow | null>(null);
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={direction} onValueChange={(v) => setDirection(v as LogFilter["direction"])}>
          <TabsList>
            <TabsTab value="sending">Sending</TabsTab>
            <TabsTab value="receiving">Receiving</TabsTab>
          </TabsList>
        </Tabs>
        <IconButton
          icon="refresh"
          label="Refresh"
          loading={logs.isRefetching && !logs.isFetchingNextPage}
          onClick={() => logs.refetch()}
        />
      </div>

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
            options={{ [ANY]: "Any status", ...STATUS_LABEL }}
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

      <Card size="sm" className="py-1.5">
        <CardContent className="px-1.5">
          {logs.isPending ? (
            <div className="flex flex-col gap-2 p-2">
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
            </div>
          ) : logs.isError ? (
            <EmptyState
              icon="error"
              title="Could not load the log"
              body={errorMessage(logs.error)}
              action={<Button onClick={() => logs.refetch()}>Try again</Button>}
            />
          ) : rows.length === 0 ? (
            <EmptyState
              icon="list_alt"
              title={q || status !== ANY ? "Nothing matches" : "Nothing here yet"}
              body={
                sending
                  ? "Mail you send, from the app or the API, shows up here."
                  : "Mail that arrives shows up here."
              }
            />
          ) : (
            <ul className="flex flex-col gap-0.5">
              {rows.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => setOpen(row)}
                    className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left outline-none hover:bg-box focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <span
                      aria-hidden
                      className="size-2 shrink-0 rounded-full"
                      style={{ background: row.mailbox_color }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate font-mono text-[13px]">
                          {sending
                            ? (row.to ?? []).map((a) => a.address).join(", ") || "(no recipient)"
                            : row.from}
                        </span>
                        <StatusBadge status={row.status} />
                      </span>
                      <span className="block truncate text-[13px] text-muted-foreground">
                        {row.subject || "(no subject)"}
                        {row.error && <span className="text-destructive"> · {row.error}</span>}
                      </span>
                    </span>
                    <span className="hidden max-w-48 shrink-0 truncate font-mono text-xs text-muted-foreground md:block">
                      {row.mailbox}
                    </span>
                    <span className="w-14 shrink-0 text-right text-xs text-muted-foreground">
                      {formatStamp(row.at)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

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

      <MessageDialog row={open} outbound={sending} onClose={() => setOpen(null)} />
    </div>
  );
}

function MessageDialog({
  row,
  outbound,
  onClose,
}: {
  row: LogRow | null;
  outbound: boolean;
  onClose: () => void;
}) {
  const message = useMessage(row?.id);
  const m = message.data;
  const events = m?.events ?? [];

  return (
    <Dialog open={row !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="break-words">{row?.subject || "(no subject)"}</DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-2">
            {row && <StatusBadge status={row.status} />}
            {row && formatDateTime(row.at)}
          </DialogDescription>
        </DialogHeader>

        {message.isPending ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-24" />
            <Skeleton className="h-32" />
          </div>
        ) : message.isError ? (
          <EmptyState icon="error" title="Could not load it" body={errorMessage(message.error)} />
        ) : m ? (
          <>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
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
                  <dd>{m.open_count}</dd>
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

            {m.error && (
              <p className="rounded-2xl bg-destructive-soft px-4 py-3 text-[13px] text-destructive">
                {m.error}
              </p>
            )}

            {outbound && (
              <section aria-labelledby="events-title" className="flex flex-col gap-2">
                <h3 id="events-title" className="text-[13px] font-medium">
                  What happened
                </h3>
                {events.length === 0 ? (
                  <p className="text-[13px] text-muted-foreground">
                    No delivery events yet. They arrive from SES as the mail moves.
                  </p>
                ) : (
                  <ol className="flex flex-col gap-0.5 rounded-2xl bg-box p-1.5">
                    {events.map((e) => {
                      const meta = EVENTS[e.type] ?? { label: e.type, icon: "info" };
                      const bad = ["bounce", "complaint", "reject", "rendering_failure"].includes(
                        e.type,
                      );
                      return (
                        <li key={e.id} className="flex items-start gap-3 rounded-xl px-2.5 py-2">
                          <Icon
                            name={meta.icon}
                            size={18}
                            className={
                              bad ? "mt-px text-destructive" : "mt-px text-muted-foreground"
                            }
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
                            className="shrink-0 text-xs text-muted-foreground"
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
              icon="mail"
              className="self-start"
              render={
                <Link to={mailHref("all", outbound ? "sent" : "inbox", { t: m.thread_id })} />
              }
              nativeButton={false}
            >
              Open the thread
            </Button>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

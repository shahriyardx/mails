import { useState } from "react";
import { Link } from "react-router";
import { Choice } from "@/components/app/choice";
import { CodeBlock, CopyButton, OnceSecret } from "@/components/app/copy";
import {
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Field,
  Icon,
  IconButton,
  Input,
  Label,
  List,
  Skeleton,
  Tabs,
  TabsList,
  TabsPanel,
  TabsTab,
  toast,
} from "@/components/kit";
import {
  errorMessage,
  useCreateWebhook,
  useDeleteWebhook,
  useDomainRefs,
  useMailboxes,
  usePingWebhook,
  useReplayDelivery,
  useUpdateWebhook,
  useWebhookDeliveries,
  useWebhooks,
} from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatDateTime, formatStamp } from "@/lib/mail";
import { toggleId } from "@/lib/scopes";
import type {
  DeliveryFilter,
  DomainRef,
  Mailbox,
  Webhook,
  WebhookDelivery,
  WebhookResult,
} from "@/lib/types";
import {
  emptyBox,
  LoadError,
  PageAction,
  rowActions,
  Section,
  StatusDot,
  SwitchRow,
} from "./parts";

const ALL = "all";

/** Row actions hide until the row is hovered or focused (or its menu is open), on pointer screens. */
const ROW_ACTIONS = cn("flex shrink-0 items-center gap-0.5", rowActions);

const VERIFY_SAMPLE = `import { constructWebhookEvent } from "@shahriyardx/mails";

const event = await constructWebhookEvent({
  secret: process.env.MAILS_WEBHOOK_SECRET!,
  payload: await request.text(), // the raw body, before JSON.parse
  signature: request.headers.get("x-mails-signature"),
});`;

/** "domain:<id>" / "mailbox:<id>" / "all", for the scope select. */
function scopeValue(hook: { mailbox_id: string | null; domain_id: string | null }) {
  if (hook.mailbox_id) return `mailbox:${hook.mailbox_id}`;
  if (hook.domain_id) return `domain:${hook.domain_id}`;
  return ALL;
}

function scopeIds(value: string) {
  const [kind, id = null] = value.split(":");
  return {
    mailbox_id: kind === "mailbox" ? id : null,
    domain_id: kind === "domain" ? id : null,
  };
}

function scopeLabel(hook: Webhook, domains?: DomainRef[], mailboxes?: Mailbox[]) {
  if (hook.mailbox_id)
    return mailboxes?.find((m) => m.id === hook.mailbox_id)?.address ?? "one mailbox";
  if (hook.domain_id)
    return `@${domains?.find((d) => d.id === hook.domain_id)?.name ?? "one domain"}`;
  return "every mailbox";
}

function resultToast(result: WebhookResult) {
  if (result.succeeded) {
    toast.success(`Endpoint answered ${result.status_code} in ${result.duration_ms} ms`);
  } else {
    toast.error(
      result.error ??
        `Endpoint answered ${result.status_code ?? "nothing"} in ${result.duration_ms} ms`,
    );
  }
}

/** /settings/webhooks: endpoints, and every delivery made to them. */
export default function Webhooks() {
  const hooks = useWebhooks();
  const domains = useDomainRefs();
  const mailboxes = useMailboxes();
  const ping = usePingWebhook();
  const update = useUpdateWebhook();
  const remove = useDeleteWebhook();

  const [tab, setTab] = useState("endpoints");
  const [filter, setFilter] = useState<DeliveryFilter>({});
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<Webhook | "new" | null>(null);
  const [fresh, setFresh] = useState<{ url: string; secret: string } | null>(null);
  const [rotating, setRotating] = useState<Webhook | null>(null);
  const [removing, setRemoving] = useState<Webhook | null>(null);

  const list = hooks.data?.data ?? [];
  const events = hooks.data?.events ?? [];

  function toggle(hook: Webhook) {
    update.mutate(
      { id: hook.id, patch: { enabled: !hook.enabled } },
      {
        onSuccess: () => toast.success(hook.enabled ? "Endpoint turned off" : "Endpoint turned on"),
        onError: (error) => toast.error(errorMessage(error)),
      },
    );
  }

  function sendTest(hook: Webhook) {
    ping.mutate(hook.id, {
      onSuccess: resultToast,
      onError: (error) => toast.error(errorMessage(error)),
    });
  }

  const newEndpoint = (
    <Button variant="primary" icon="add" disabled={!hooks.data} onClick={() => setEditing("new")}>
      New endpoint
    </Button>
  );

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(String(v))} className="flex flex-col gap-6">
      <PageAction>{newEndpoint}</PageAction>
      <TabsList>
        <TabsTab value="endpoints">Endpoints</TabsTab>
        <TabsTab value="deliveries">Deliveries</TabsTab>
      </TabsList>

      <TabsPanel value="endpoints" className="flex flex-col gap-10">
        <div className="flex flex-col gap-4">
          {fresh && (
            <OnceSecret
              title={`Signing secret for ${fresh.url}`}
              value={fresh.secret}
              onDismiss={() => setFresh(null)}
            />
          )}
          {hooks.isPending ? (
            <List aria-busy="true">
              {[0, 1].map((i) => (
                <li key={i} className="px-4 py-3">
                  <Skeleton className="h-9" />
                </li>
              ))}
            </List>
          ) : hooks.isError ? (
            <LoadError error={hooks.error} retry={hooks.refetch} />
          ) : list.length === 0 ? (
            <div className={emptyBox}>
              <p className="text-muted-foreground">No endpoints yet.</p>
            </div>
          ) : (
            <List>
              {list.map((hook) => {
                const expanded = open === hook.id;
                const failing = hook.consecutive_failures > 0;
                return (
                  <li key={hook.id} className="group/row">
                    <div className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-box">
                      <button
                        type="button"
                        aria-expanded={expanded}
                        onClick={() => setOpen(expanded ? null : hook.id)}
                        className="flex min-w-0 flex-1 items-center gap-3 rounded-md text-left outline-none focus-visible:outline-2 focus-visible:outline-ring"
                      >
                        <span className="min-w-0 flex-1">
                          <span
                            className={cn(
                              "block truncate text-sm font-semibold",
                              !hook.description && "font-mono",
                            )}
                          >
                            {hook.description || hook.url}
                          </span>
                          <span className="block truncate font-mono text-xs text-muted-foreground">
                            {[
                              hook.description && hook.url,
                              scopeLabel(hook, domains.data, mailboxes.data),
                              hook.events.includes("*") ? "all events" : hook.events.join(", "),
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                          {hook.last_error && failing && (
                            <span className="block truncate text-xs text-destructive">
                              {hook.last_error}
                            </span>
                          )}
                        </span>
                        <HookStatus hook={hook} />
                      </button>
                      <div className={cn(ROW_ACTIONS, expanded && "md:opacity-100")}>
                        <IconButton
                          icon="send"
                          size="sm"
                          label={`Send a test event to ${hook.url}`}
                          disabled={ping.isPending}
                          onClick={() => sendTest(hook)}
                        />
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <IconButton
                                icon="more_vert"
                                size="sm"
                                label={`Actions for ${hook.url}`}
                              />
                            }
                          />
                          <DropdownMenuContent>
                            <DropdownMenuItem
                              icon="list_alt"
                              onClick={() => {
                                setFilter({ webhook_id: hook.id });
                                setTab("deliveries");
                              }}
                            >
                              Deliveries
                            </DropdownMenuItem>
                            <DropdownMenuItem icon="edit" onClick={() => setEditing(hook)}>
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              icon={hook.enabled ? "block" : "check_circle"}
                              onClick={() => toggle(hook)}
                            >
                              {hook.enabled ? "Turn off" : "Turn on"}
                            </DropdownMenuItem>
                            <DropdownMenuItem icon="key" onClick={() => setRotating(hook)}>
                              Replace the secret
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              icon="delete"
                              destructive
                              onClick={() => setRemoving(hook)}
                            >
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                    {expanded && (
                      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 border-t border-border px-4 py-4 text-[13px]">
                        <dt className="text-muted-foreground">URL</dt>
                        <dd className="min-w-0 font-mono break-all">{hook.url}</dd>
                        <dt className="text-muted-foreground">Which mail</dt>
                        <dd className="font-mono">
                          {scopeLabel(hook, domains.data, mailboxes.data)}
                        </dd>
                        <dt className="text-muted-foreground">Events</dt>
                        <dd className="flex flex-wrap gap-1">
                          {hook.events.includes("*")
                            ? "All events, including new ones"
                            : hook.events.map((e) => (
                                <Badge key={e} size="sm" className="font-mono">
                                  {e}
                                </Badge>
                              ))}
                        </dd>
                        <dt className="text-muted-foreground">Last call</dt>
                        <dd className="font-mono">
                          {hook.last_delivered_at
                            ? `${formatDateTime(hook.last_delivered_at)}${hook.last_status ? `, HTTP ${hook.last_status}` : ""}`
                            : "none yet"}
                        </dd>
                        {hook.last_error_at && (
                          <>
                            <dt className="text-muted-foreground">Last error</dt>
                            <dd
                              className={cn("min-w-0 break-words", failing && "text-destructive")}
                            >
                              <span className="font-mono">
                                {formatDateTime(hook.last_error_at)}
                              </span>
                              {hook.last_error && ` · ${hook.last_error}`}
                            </dd>
                          </>
                        )}
                        <dt className="text-muted-foreground">Added</dt>
                        <dd className="font-mono">{formatDateTime(hook.created_at)}</dd>
                      </dl>
                    )}
                  </li>
                );
              })}
            </List>
          )}
        </div>

        <Section
          title="Verifying calls"
          action={
            <Button
              size="sm"
              variant="ghost"
              icon="menu_book"
              render={<Link to="/docs/webhooks/verifying" />}
              nativeButton={false}
            >
              Docs
            </Button>
          }
        >
          <CodeBlock text={VERIFY_SAMPLE} />
        </Section>
      </TabsPanel>

      <TabsPanel value="deliveries">
        <Deliveries hooks={list} events={events} filter={filter} onFilter={setFilter} />
      </TabsPanel>

      {hooks.data && (
        <EndpointDialog
          entry={editing}
          events={events}
          domains={domains.data ?? []}
          mailboxes={mailboxes.data ?? []}
          onClose={() => setEditing(null)}
          onCreated={(hook) => hook.secret && setFresh({ url: hook.url, secret: hook.secret })}
        />
      )}
      <ConfirmDialog
        open={rotating !== null}
        onOpenChange={(open) => !open && setRotating(null)}
        title="Replace the signing secret?"
        description={rotating?.url}
        consequences="The old secret stops working at once. Calls fail verification until your endpoint has the new one."
        confirmLabel="Replace secret"
        onConfirm={async () => {
          if (!rotating) return;
          const hook = await update.mutateAsync({
            id: rotating.id,
            patch: { rotate_secret: true },
          });
          if (hook.secret) setFresh({ url: hook.url, secret: hook.secret });
        }}
      />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title="Delete this endpoint?"
        description={removing?.url}
        consequences="Its delivery history goes with it. To stop calls but keep the history, turn it off instead."
        confirmLabel="Delete endpoint"
        onConfirm={async () => {
          if (!removing) return;
          await remove.mutateAsync(removing.id);
          if (filter.webhook_id === removing.id) setFilter({});
          toast.success("Endpoint deleted");
        }}
      />
    </Tabs>
  );
}

function HookStatus({ hook }: { hook: Webhook }) {
  if (!hook.enabled) return <StatusDot tone="off">Off</StatusDot>;
  if (hook.consecutive_failures > 0)
    return <StatusDot tone="bad">{hook.consecutive_failures} failing</StatusDot>;
  return <StatusDot tone="ok">Live</StatusDot>;
}

function EndpointDialog({
  entry,
  events,
  domains,
  mailboxes,
  onClose,
  onCreated,
}: {
  entry: Webhook | "new" | null;
  events: string[];
  domains: DomainRef[];
  mailboxes: Mailbox[];
  onClose: () => void;
  onCreated: (hook: Webhook) => void;
}) {
  const create = useCreateWebhook();
  const update = useUpdateWebhook();
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [scope, setScope] = useState(ALL);
  const [everything, setEverything] = useState(true);
  const [picked, setPicked] = useState<string[]>([]);
  const [enabled, setEnabled] = useState(true);

  const key = entry === null ? null : entry === "new" ? "new" : entry.id;
  if (key !== loadedFor) {
    setLoadedFor(key);
    const hook = entry && entry !== "new" ? entry : null;
    setUrl(hook?.url ?? "");
    setDescription(hook?.description ?? "");
    setScope(hook ? scopeValue(hook) : ALL);
    setEverything(!hook || hook.events.includes("*"));
    setPicked(hook && !hook.events.includes("*") ? hook.events : []);
    setEnabled(hook?.enabled ?? true);
  }

  const busy = create.isPending || update.isPending;
  const ready = url.trim() !== "" && (everything || picked.length > 0);
  const scopeOptions = Object.fromEntries([
    [ALL, "Every mailbox"],
    ...domains.map((d) => [`domain:${d.id}`, `Domain: ${d.name}`]),
    ...mailboxes.map((m) => [`mailbox:${m.id}`, `Address: ${m.address}`]),
  ]);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!ready || entry === null) return;
    const body = {
      url: url.trim(),
      description: description.trim() || null,
      events: everything ? ["*"] : picked,
      enabled,
      ...scopeIds(scope),
    };
    const done = { onError: (error: unknown) => toast.error(errorMessage(error)) };
    if (entry === "new") {
      create.mutate(body, {
        ...done,
        onSuccess: (hook) => {
          onCreated(hook);
          toast.success("Endpoint added");
          onClose();
        },
      });
    } else {
      update.mutate(
        { id: entry.id, patch: body },
        {
          ...done,
          onSuccess: () => {
            toast.success("Endpoint saved");
            onClose();
          },
        },
      );
    }
  }

  return (
    <Dialog open={entry !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{entry === "new" ? "New endpoint" : "Edit endpoint"}</DialogTitle>
          {entry === "new" && (
            <DialogDescription>
              The signing secret is shown once, right after you add it.
            </DialogDescription>
          )}
        </DialogHeader>
        <form id="endpoint" onSubmit={submit} className="flex flex-col gap-5">
          <Field label="URL" description="Public https URL. Private networks are refused.">
            <Input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/hooks/mails"
              className="font-mono"
              maxLength={2000}
              required
            />
          </Field>
          <Field label="What it is for">
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Support desk"
              maxLength={500}
            />
          </Field>
          <Field
            label="Which mail"
            description="A domain covers every address on it, including new ones."
          >
            <Choice value={scope} onChange={setScope} options={scopeOptions} />
          </Field>
          <fieldset className="flex flex-col gap-3 border-t border-border pt-5">
            <legend className="sr-only">Events</legend>
            <SwitchRow
              label="All events"
              description="Includes events added later."
              checked={everything}
              onCheckedChange={setEverything}
            />
            {!everything && (
              <div className="grid gap-0.5 rounded-[10px] border border-border p-1 sm:grid-cols-2">
                {events.map((name) => (
                  <Label
                    key={name}
                    className="flex h-9 cursor-pointer items-center gap-3 rounded-md px-2.5 font-normal hover:bg-tonal"
                  >
                    <Checkbox
                      checked={picked.includes(name)}
                      onCheckedChange={(on) => setPicked((p) => toggleId(p, name, on))}
                    />
                    <span className="font-mono text-[13px]">{name}</span>
                  </Label>
                ))}
              </div>
            )}
          </fieldset>
          <SwitchRow
            label="Send events"
            description="Turn off to pause calls. The endpoint and its history stay."
            checked={enabled}
            onCheckedChange={setEnabled}
            className="border-t border-border pt-5"
          />
        </form>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
          <Button type="submit" form="endpoint" variant="primary" loading={busy} disabled={!ready}>
            {entry === "new" ? "Add endpoint" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Deliveries({
  hooks,
  events,
  filter,
  onFilter,
}: {
  hooks: Webhook[];
  events: string[];
  filter: DeliveryFilter;
  onFilter: (filter: DeliveryFilter) => void;
}) {
  const deliveries = useWebhookDeliveries(filter);
  const rows = deliveries.data?.pages.flatMap((p) => p.data) ?? [];
  const set = (key: keyof DeliveryFilter, value: string) => {
    const next: Record<string, string> = { ...filter };
    if (value === ALL) delete next[key];
    else next[key] = value;
    onFilter(next);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-3">
          <Choice
            label="Endpoint"
            value={filter.webhook_id ?? ALL}
            onChange={(v) => set("webhook_id", v)}
            options={Object.fromEntries([
              [ALL, "All endpoints"],
              ...hooks.map((h) => [h.id, h.description || h.url]),
            ])}
          />
          <Choice
            label="Event"
            value={filter.event ?? ALL}
            onChange={(v) => set("event", v)}
            options={Object.fromEntries([
              [ALL, "All events"],
              ...[...events, "webhook.test"].map((e) => [e, e]),
            ])}
          />
          <Choice
            label="Result"
            value={filter.succeeded ?? ALL}
            onChange={(v) => set("succeeded", v)}
            options={{ [ALL]: "Any result", true: "Succeeded", false: "Failed" }}
          />
        </div>
        <IconButton
          icon="refresh"
          label="Refresh"
          className="self-start"
          loading={deliveries.isRefetching && !deliveries.isFetchingNextPage}
          onClick={() => deliveries.refetch()}
        />
      </div>

      {deliveries.isPending ? (
        <List aria-busy="true">
          {[0, 1, 2].map((i) => (
            <li key={i} className="px-4 py-3">
              <Skeleton className="h-6" />
            </li>
          ))}
        </List>
      ) : deliveries.isError ? (
        <LoadError error={deliveries.error} retry={deliveries.refetch} />
      ) : rows.length === 0 ? (
        <p className={cn(emptyBox, "text-muted-foreground")}>
          Nothing sent yet. Calls show up here as soon as an endpoint is called.
        </p>
      ) : (
        <List>
          {rows.map((d) => (
            <DeliveryRow key={d.id} delivery={d} />
          ))}
        </List>
      )}

      {deliveries.hasNextPage && (
        <Button
          variant="ghost"
          className="self-center"
          loading={deliveries.isFetchingNextPage}
          onClick={() => deliveries.fetchNextPage()}
        >
          Load more
        </Button>
      )}
    </div>
  );
}

function DeliveryRow({ delivery: d }: { delivery: WebhookDelivery }) {
  const replay = useReplayDelivery();
  const payload = JSON.stringify(d.payload, null, 2);
  return (
    <li>
      <details className="group">
        <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-4 py-2.5 outline-none transition-colors hover:bg-box focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
          <StatusDot tone={d.succeeded ? "ok" : "bad"} className="w-12 font-mono">
            {d.status_code ?? "—"}
          </StatusDot>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-mono text-[13px]">{d.event}</span>
            {d.error && <span className="block truncate text-xs text-destructive">{d.error}</span>}
          </span>
          <span className="hidden shrink-0 font-mono text-xs text-muted-foreground sm:block">
            {d.attempt > 1 ? `try ${d.attempt}` : ""}
            {d.duration_ms !== null && ` ${d.duration_ms} ms`}
          </span>
          <span className="w-14 shrink-0 text-right font-mono text-xs text-muted-foreground">
            {formatStamp(d.created_at)}
          </span>
          <Icon
            name="expand_more"
            size={18}
            className="shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
          />
        </summary>
        <div className="flex flex-col gap-3 border-t border-border px-4 py-4">
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-[13px]">
            <dt className="text-muted-foreground">Event id</dt>
            <dd className="flex min-w-0 items-center gap-1 font-mono break-all">
              {d.event_id}
              <CopyButton text={d.event_id} label="Copy event id" />
            </dd>
            <dt className="text-muted-foreground">Sent</dt>
            <dd className="font-mono">{formatDateTime(d.created_at)}</dd>
            <dt className="text-muted-foreground">Attempt</dt>
            <dd className="font-mono">
              {d.attempt}
              {d.duration_ms !== null && `, ${d.duration_ms} ms`}
              {d.status_code !== null && `, HTTP ${d.status_code}`}
            </dd>
            {d.next_retry_at && (
              <>
                <dt className="text-muted-foreground">Next try</dt>
                <dd className="font-mono">{formatDateTime(d.next_retry_at)}</dd>
              </>
            )}
          </dl>
          <CodeBlock title="Payload" text={payload} />
          {d.response_body && <CodeBlock title="Response" text={d.response_body} />}
          <Button
            size="sm"
            icon="refresh"
            className="self-start"
            loading={replay.isPending}
            onClick={() =>
              replay.mutate(d.id, {
                onSuccess: resultToast,
                onError: (error) => toast.error(errorMessage(error)),
              })
            }
          >
            Replay
          </Button>
        </div>
      </details>
    </li>
  );
}

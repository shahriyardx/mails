import { useState } from "react";
import { Link } from "react-router";
import { Choice } from "@/components/app/choice";
import { CodeBlock, CopyButton, OnceSecret } from "@/components/app/copy";
import {
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
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
  EmptyState,
  Field,
  Icon,
  IconButton,
  Input,
  Label,
  List,
  ListRow,
  Skeleton,
  Switch,
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

const ALL = "all";

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

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(String(v))} className="flex flex-col gap-4">
      <TabsList className="self-start">
        <TabsTab value="endpoints">Endpoints</TabsTab>
        <TabsTab value="deliveries">Deliveries</TabsTab>
      </TabsList>

      <TabsPanel value="endpoints" className="flex flex-col gap-4">
        {fresh && (
          <OnceSecret
            title={`Signing secret for ${fresh.url}`}
            value={fresh.secret}
            onDismiss={() => setFresh(null)}
          />
        )}
        <Card>
          <CardHeader>
            <CardTitle>Endpoints</CardTitle>
            <CardDescription>
              Mails posts a signed JSON body to each URL when something happens to your mail.
            </CardDescription>
            <CardAction>
              <Button
                variant="primary"
                size="sm"
                icon="add"
                disabled={!hooks.data}
                onClick={() => setEditing("new")}
              >
                New endpoint
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            {hooks.isPending ? (
              <div className="flex flex-col gap-2">
                <Skeleton className="h-16" />
                <Skeleton className="h-16" />
              </div>
            ) : hooks.isError ? (
              <EmptyState
                icon="error"
                title="Could not load endpoints"
                body={errorMessage(hooks.error)}
                action={<Button onClick={() => hooks.refetch()}>Try again</Button>}
              />
            ) : list.length === 0 ? (
              <EmptyState
                icon="webhook"
                title="No endpoints yet"
                body="Add a URL and it gets a signed call every time mail arrives, is delivered, bounces or is opened."
              />
            ) : (
              <List className="bg-box">
                {list.map((hook) => (
                  <ListRow
                    key={hook.id}
                    icon="webhook"
                    title={
                      <span className="flex items-center gap-2">
                        <span className="truncate font-mono text-[13px]">{hook.url}</span>
                        <HookStatus hook={hook} />
                      </span>
                    }
                    description={[
                      hook.description,
                      scopeLabel(hook, domains.data, mailboxes.data),
                      hook.events.includes("*") ? "all events" : hook.events.join(", "),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                    action={
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={<IconButton icon="more_vert" label={`Actions for ${hook.url}`} />}
                        />
                        <DropdownMenuContent>
                          <DropdownMenuItem
                            icon="send"
                            disabled={ping.isPending}
                            onClick={() =>
                              ping.mutate(hook.id, {
                                onSuccess: resultToast,
                                onError: (error) => toast.error(errorMessage(error)),
                              })
                            }
                          >
                            Send a test event
                          </DropdownMenuItem>
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
                    }
                  >
                    {hook.last_error && hook.consecutive_failures > 0 && (
                      <p className="truncate text-xs text-destructive">{hook.last_error}</p>
                    )}
                  </ListRow>
                ))}
              </List>
            )}
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardTitle>Checking a call is genuine</CardTitle>
            <CardDescription>
              Each call carries an <code className="font-mono">X-Mails-Signature</code> header, an
              HMAC-SHA256 of the timestamp and body with the endpoint's secret.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button
              size="sm"
              icon="menu_book"
              render={<Link to="/docs/webhooks/verifying" />}
              nativeButton={false}
            >
              Verifying a call
            </Button>
            <Button
              size="sm"
              variant="ghost"
              render={<Link to="/docs/webhooks/events" />}
              nativeButton={false}
            >
              The events
            </Button>
          </CardContent>
        </Card>
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
  if (!hook.enabled)
    return (
      <Badge size="sm" tone="danger">
        Off
      </Badge>
    );
  if (hook.consecutive_failures > 0)
    return (
      <Badge size="sm" tone="danger">
        {hook.consecutive_failures} failing
      </Badge>
    );
  return <Badge size="sm">Live</Badge>;
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
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1.5 text-[13px] font-medium">Events</legend>
            <Label className="flex items-center justify-between gap-3 rounded-2xl bg-box px-4 py-3 font-normal">
              <span className="text-sm">All events, including new ones</span>
              <Switch checked={everything} onCheckedChange={setEverything} />
            </Label>
            {!everything && (
              <div className="grid gap-0.5 rounded-2xl bg-box p-1.5 sm:grid-cols-2">
                {events.map((name) => (
                  <Label
                    key={name}
                    className="flex h-9 cursor-pointer items-center gap-3 rounded-xl px-2.5 font-normal hover:bg-tonal"
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
          <Label className="flex items-center justify-between gap-3 rounded-2xl bg-box px-4 py-3 font-normal">
            <span className="text-sm">On</span>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </Label>
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
    <Card>
      <CardHeader>
        <CardTitle>Deliveries</CardTitle>
        <CardDescription>Every attempt at every endpoint, newest first.</CardDescription>
        <CardAction>
          <IconButton
            icon="refresh"
            label="Refresh"
            loading={deliveries.isRefetching}
            onClick={() => deliveries.refetch()}
          />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="grid gap-2 sm:grid-cols-3">
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

        {deliveries.isPending ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        ) : deliveries.isError ? (
          <EmptyState
            icon="error"
            title="Could not load deliveries"
            body={errorMessage(deliveries.error)}
            action={<Button onClick={() => deliveries.refetch()}>Try again</Button>}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            icon="webhook"
            title="Nothing sent yet"
            body="Attempts show up here as soon as an endpoint is called. Try Send a test event."
          />
        ) : (
          <ul className="flex flex-col gap-0.5 rounded-3xl bg-box p-1.5">
            {rows.map((d) => (
              <DeliveryRow key={d.id} delivery={d} />
            ))}
          </ul>
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
      </CardContent>
    </Card>
  );
}

function DeliveryRow({ delivery: d }: { delivery: WebhookDelivery }) {
  const replay = useReplayDelivery();
  const payload = JSON.stringify(d.payload, null, 2);
  return (
    <li>
      <details className="group rounded-2xl open:bg-surface">
        <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 rounded-2xl px-3 py-2 outline-none hover:bg-tonal focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
          <Badge
            tone={d.succeeded ? "neutral" : "danger"}
            className="w-12 justify-center font-mono"
          >
            {d.status_code ?? "—"}
          </Badge>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-mono text-[13px]">{d.event}</span>
            {d.error && <span className="block truncate text-xs text-destructive">{d.error}</span>}
          </span>
          <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">
            {d.attempt > 1 ? `try ${d.attempt}` : ""}
            {d.duration_ms !== null && ` ${d.duration_ms} ms`}
          </span>
          <span className="w-14 shrink-0 text-right text-xs text-muted-foreground">
            {formatStamp(d.created_at)}
          </span>
          <Icon
            name="expand_more"
            size={18}
            className="shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
          />
        </summary>
        <div className="flex flex-col gap-3 px-3 pt-1 pb-3">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
            <dt className="text-muted-foreground">Event id</dt>
            <dd className="flex min-w-0 items-center gap-1 font-mono break-all">
              {d.event_id}
              <CopyButton text={d.event_id} label="Copy event id" />
            </dd>
            <dt className="text-muted-foreground">Sent</dt>
            <dd>{formatDateTime(d.created_at)}</dd>
            <dt className="text-muted-foreground">Attempt</dt>
            <dd>
              {d.attempt}
              {d.duration_ms !== null && `, ${d.duration_ms} ms`}
              {d.status_code !== null && `, HTTP ${d.status_code}`}
            </dd>
            {d.next_retry_at && (
              <>
                <dt className="text-muted-foreground">Next try</dt>
                <dd>{formatDateTime(d.next_retry_at)}</dd>
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

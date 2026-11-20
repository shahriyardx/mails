import { type FormEvent, useState } from "react";
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
  Field,
  Icon,
  Input,
  List,
  ListEmpty,
  ListRow,
  toast,
} from "@/components/kit";
import { errorMessage, type InboundAction, useInbound, useInboundAction } from "@/lib/api";
import { formatBytes, formatDateTime } from "@/lib/mail";
import type { InboundStatus, ZoneStatus } from "@/lib/types";
import { LoadError, Notice, PageLoading } from "./parts";

const TOKEN_URL = "https://dash.cloudflare.com/profile/api-tokens";

/** The permissions the server's Cloudflare calls need (internal/cloudflare). */
const REQUIRED = [
  ["Account", "Workers Scripts", "Edit", "Upload and remove the inbound worker."],
  ["Account", "Workers R2 Storage", "Edit", "Give the worker its attachments bucket."],
  ["Zone", "Zone", "Read", "List your domains."],
  [
    "Zone",
    "Zone Settings",
    "Edit",
    "Turn Email Routing on. Easy to miss: Cloudflare puts it here.",
  ],
  ["Zone", "Email Routing Rules", "Edit", "Point each domain's catch-all at the worker."],
  ["Zone", "DNS", "Edit", "Publish MX records (Email Routing, and new subdomain mailboxes)."],
] as const;

const OPTIONAL = [
  [
    "Account",
    "Email Routing Addresses",
    "Edit",
    "Forwarding: add and verify the addresses copies go to. The account permission, not the zone one with a similar name.",
  ],
] as const;

/** Cloudflare: the token, the inbound worker and which domains receive. */
export default function Inbound() {
  const inbound = useInbound();
  if (inbound.isPending) return <PageLoading />;
  if (inbound.isError) return <LoadError error={inbound.error} retry={inbound.refetch} />;
  const status = inbound.data;

  return (
    <div className="space-y-4">
      {status.connected ? (
        <>
          {status.error && <Notice tone="danger">{status.error}</Notice>}
          <Worker status={status} />
          <Zones status={status} />
          <Connection status={status} />
        </>
      ) : (
        <Connect />
      )}
    </div>
  );
}

/**
 * call: one inbound call, a toast on success, rejects on failure (for
 * ConfirmDialog, which shows the error and stays open). run: the same, with
 * the error as a toast instead.
 */
function useRun() {
  const action = useInboundAction();
  const call = (input: InboundAction, success: string) =>
    action.mutateAsync(input).then(() => {
      toast.success(success);
    });
  const run = (input: InboundAction, success: string) =>
    call(input, success).catch((error) => {
      toast.error(errorMessage(error));
    });
  return { call, run, pending: action.isPending, variables: action.variables };
}

function Permissions({ list }: { list: readonly (readonly [string, string, string, string])[] }) {
  return (
    <ul className="space-y-1.5">
      {list.map(([scope, name, level, why]) => (
        <li key={name} className="rounded-xl bg-box px-3.5 py-2.5">
          <span className="block font-mono text-[13px]">
            {scope} → {name} → {level}
          </span>
          <span className="block text-xs text-muted-foreground">{why}</span>
        </li>
      ))}
    </ul>
  );
}

function Connect() {
  const [token, setToken] = useState("");
  const { call, pending } = useRun();

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!token.trim()) return;
    call(
      { method: "POST", path: "/connect", body: { token: token.trim() } },
      "Cloudflare connected",
    ).then(
      () => setToken(""),
      (error) => toast.error(errorMessage(error)),
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connect Cloudflare</CardTitle>
        <CardDescription>
          Mail reaches Mails through a Cloudflare Email Worker. With an API token, Mails deploys the
          worker and points your domains at it. No wrangler needed.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <h4 className="text-[13px] font-medium">1. Create a token with these permissions</h4>
          <Permissions list={REQUIRED} />
          <p className="pt-1 text-[13px] font-medium">Optional</p>
          <Permissions list={OPTIONAL} />
          <Button
            size="sm"
            variant="ghost"
            icon="open_in_new"
            render={<a href={TOKEN_URL} target="_blank" rel="noopener noreferrer" />}
            nativeButton={false}
          >
            Create it in Cloudflare
          </Button>
        </div>
        <form onSubmit={submit} className="space-y-2">
          <h4 className="text-[13px] font-medium">2. Paste it here</h4>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
            <Field
              className="flex-1"
              label={<span className="sr-only">API token</span>}
              description="Encrypted before it is stored. Revoke it in Cloudflare any time."
            >
              <Input
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder="Cloudflare API token"
                autoComplete="off"
                className="font-mono"
              />
            </Field>
            <Button type="submit" variant="primary" loading={pending} disabled={!token.trim()}>
              Verify and save
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function Worker({ status }: { status: InboundStatus }) {
  const { call, run, pending, variables } = useRun();
  const [removing, setRemoving] = useState(false);
  const deploying = pending && variables?.path === "/deploy";

  return (
    <Card>
      <CardHeader>
        <CardTitle>The worker</CardTitle>
        <CardDescription>
          Receives your mail at Cloudflare, stores attachments in R2 and hands each message to
          Mails.
        </CardDescription>
        <CardAction>
          <Badge tone={status.deployed ? "strong" : "neutral"}>
            {status.deployed && <Icon name="check" size={14} />}
            {status.deployed ? "Deployed" : "Not deployed"}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid grid-cols-2 gap-3 rounded-2xl bg-box p-4 sm:grid-cols-3">
          <Fact term="Script">{status.script_name}</Fact>
          <Fact term="Size">{formatBytes(status.script_bytes)}</Fact>
          <Fact term="Updated">
            {status.modified_on ? formatDateTime(status.modified_on) : "Never"}
          </Fact>
        </dl>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            icon={status.deployed ? "sync" : "upload"}
            loading={deploying}
            disabled={pending}
            onClick={() =>
              run({ method: "POST", path: "/deploy" }, "Worker uploaded to Cloudflare")
            }
          >
            {status.deployed ? "Redeploy" : "Deploy worker"}
          </Button>
          {status.deployed && (
            <Button icon="delete" disabled={pending} onClick={() => setRemoving(true)}>
              Delete worker
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Redeploy after updating Mails, so the worker matches this version.
        </p>
      </CardContent>
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title="Delete the worker from Cloudflare?"
        description="Nothing can be received on any of your domains until it is deployed again."
        consequences="Senders get a bounce while it is gone; nothing is held for later."
        phrase="delete worker"
        confirmLabel="Delete worker"
        onConfirm={() => call({ method: "DELETE", path: "/worker" }, "Worker deleted")}
      />
    </Card>
  );
}

function Fact({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{term}</dt>
      <dd className="truncate font-mono text-[13px]">{children}</dd>
    </div>
  );
}

function Zones({ status }: { status: InboundStatus }) {
  const receiving = status.zones.filter((z) => z.catch_all_to_worker).length;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Receiving domains</CardTitle>
        <CardDescription>
          {receiving} of {status.zones.length} receive here. Turning a domain on enables Email
          Routing, publishes Cloudflare's MX records and sends every address to the worker.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <List className="bg-box">
          {status.zones.map((zone) => (
            <ZoneRow key={zone.id} zone={zone} deployed={status.deployed} />
          ))}
          {status.zones.length === 0 && <ListEmpty>This token sees no zones.</ListEmpty>}
        </List>
        <Notice>
          Turning a domain on replaces its MX records with Cloudflare's. Anything receiving mail for
          it today stops.
        </Notice>
      </CardContent>
    </Card>
  );
}

function ZoneRow({ zone, deployed }: { zone: ZoneStatus; deployed: boolean }) {
  const { call, run, pending } = useRun();
  const [stopping, setStopping] = useState(false);
  const [disableRouting, setDisableRouting] = useState(false);

  return (
    <ListRow
      title={<span className="font-mono">{zone.name}</span>}
      description={
        zone.catch_all_to_worker
          ? "Receiving here"
          : zone.routing_enabled
            ? "Email Routing on, not sent to the worker"
            : "Email Routing off"
      }
      action={
        zone.catch_all_to_worker ? (
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => setStopping(true)}>
            Stop
          </Button>
        ) : (
          <Button
            size="sm"
            loading={pending}
            disabled={!deployed}
            title={deployed ? undefined : "Deploy the worker first"}
            onClick={() =>
              run(
                { method: "POST", path: `/zones/${zone.id}/route` },
                `${zone.name} now receives here`,
              )
            }
          >
            Receive here
          </Button>
        )
      }
    >
      <ConfirmDialog
        open={stopping}
        onOpenChange={setStopping}
        title={`Stop receiving for ${zone.name}?`}
        consequences="Mail to its addresses no longer reaches Mails. Cloudflare's own rules, if any, still apply."
        confirmLabel="Stop receiving"
        onConfirm={() =>
          call(
            {
              method: "POST",
              path: `/zones/${zone.id}/unroute`,
              query: disableRouting ? { disable_routing: true } : undefined,
            },
            `${zone.name} no longer receives here`,
          )
        }
      >
        <label
          htmlFor={`routing-${zone.id}`}
          className="flex cursor-pointer items-start gap-3 rounded-2xl bg-box px-3.5 py-3"
        >
          <Checkbox
            id={`routing-${zone.id}`}
            checked={disableRouting}
            onCheckedChange={(on) => setDisableRouting(on === true)}
            className="mt-0.5"
          />
          <span className="min-w-0">
            <span className="block text-[13px] font-medium">Also turn Email Routing off</span>
            <span className="block text-xs text-muted-foreground">
              Removes Cloudflare's MX records, so nothing at Cloudflare receives for it.
            </span>
          </span>
        </label>
      </ConfirmDialog>
    </ListRow>
  );
}

function Connection({ status }: { status: InboundStatus }) {
  const { call, pending } = useRun();
  const [disconnecting, setDisconnecting] = useState(false);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Cloudflare connection</CardTitle>
        <CardDescription>
          Token <span className="font-mono">{status.hint}</span>
          {status.label && ` · ${status.label}`}
          {status.account_id && (
            <>
              {" · account "}
              <span className="font-mono">{status.account_id}</span>
            </>
          )}
        </CardDescription>
        <CardAction>
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => setDisconnecting(true)}
          >
            Disconnect
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground">
          Added permissions to this token in Cloudflare? Nothing to do here. To switch to a new
          token, disconnect, then connect the new one.
        </p>
      </CardContent>
      <ConfirmDialog
        open={disconnecting}
        onOpenChange={setDisconnecting}
        title="Disconnect Cloudflare?"
        consequences="Mails forgets the token. The worker and routing stay as they are in Cloudflare, so mail keeps arriving; this page just cannot change them until you connect again."
        confirmLabel="Disconnect"
        onConfirm={() => call({ method: "DELETE", path: "/connect" }, "Cloudflare disconnected")}
      />
    </Card>
  );
}

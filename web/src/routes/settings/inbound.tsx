import { type FormEvent, type ReactNode, useState } from "react";
import {
  Button,
  Checkbox,
  ConfirmDialog,
  Field,
  Input,
  List,
  ListEmpty,
  ListRow,
  toast,
} from "@/components/kit";
import { errorMessage, type InboundAction, useInbound, useInboundAction } from "@/lib/api";
import { formatBytes, formatDateTime } from "@/lib/mail";
import type { InboundStatus, ZoneStatus } from "@/lib/types";
import {
  DangerRow,
  DangerZone,
  LoadError,
  Notice,
  PageAction,
  PageLoading,
  Section,
  StatusDot,
} from "./parts";

const TOKEN_URL = "https://dash.cloudflare.com/profile/api-tokens";

/**
 * The permissions the server's Cloudflare calls need (internal/cloudflare).
 * A note only where the permission is easy to get wrong.
 */
type Permission = { perm: string; note?: string };
const REQUIRED: Permission[] = [
  { perm: "Account → Workers Scripts → Edit" },
  { perm: "Account → Workers R2 Storage → Edit" },
  { perm: "Zone → Zone → Read" },
  { perm: "Zone → Zone Settings → Edit", note: "Easy to miss: it turns Email Routing on." },
  { perm: "Zone → Email Routing Rules → Edit" },
  { perm: "Zone → DNS → Edit" },
];

const OPTIONAL: Permission[] = [
  {
    perm: "Account → Email Routing Addresses → Edit",
    note: "For forwarding. The account one, not the zone one with a similar name.",
  },
];

/** Cloudflare: the token, the inbound worker and which domains receive. */
export default function Inbound() {
  const inbound = useInbound();
  if (inbound.isPending) return <PageLoading />;
  if (inbound.isError) return <LoadError error={inbound.error} retry={inbound.refetch} />;
  const status = inbound.data;

  if (!status.connected) return <Connect />;
  return (
    <div className="space-y-10">
      {status.error && <Notice tone="danger">{status.error}</Notice>}
      <Worker status={status} />
      <Zones status={status} />
      <Connection status={status} />
      <Danger status={status} />
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

function Permissions({ list }: { list: Permission[] }) {
  return (
    <List>
      {list.map(({ perm, note }) => (
        <ListRow
          key={perm}
          className="min-h-0"
          title={
            <span className="font-mono text-[13px] whitespace-normal break-words">{perm}</span>
          }
        >
          {note && <p className="text-xs text-muted-foreground">{note}</p>}
        </ListRow>
      ))}
    </List>
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
    <div className="space-y-10">
      <Section
        title="1. Create a token with these permissions"
        action={
          <Button
            size="sm"
            icon="open_in_new"
            render={<a href={TOKEN_URL} target="_blank" rel="noopener noreferrer" />}
            nativeButton={false}
          >
            Create it in Cloudflare
          </Button>
        }
      >
        <Permissions list={REQUIRED} />
        <h3 className="pt-2 text-[13px] font-medium text-soft-foreground">Optional</h3>
        <Permissions list={OPTIONAL} />
      </Section>
      <Section title="2. Paste it here">
        <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row sm:items-start">
          <Field className="flex-1" description="Stored encrypted.">
            <Input
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="Cloudflare API token"
              aria-label="API token"
              autoComplete="off"
              className="font-mono"
            />
          </Field>
          <Button type="submit" variant="primary" loading={pending} disabled={!token.trim()}>
            Verify and save
          </Button>
        </form>
      </Section>
    </div>
  );
}

function Worker({ status }: { status: InboundStatus }) {
  const { run, pending, variables } = useRun();
  const deploying = pending && variables?.path === "/deploy";

  return (
    <Section title="Worker" description="Redeploy after updating Mails.">
      <PageAction>
        <Button
          variant="primary"
          icon={status.deployed ? "sync" : "upload"}
          loading={deploying}
          disabled={pending}
          onClick={() => run({ method: "POST", path: "/deploy" }, "Worker uploaded to Cloudflare")}
        >
          {status.deployed ? "Redeploy worker" : "Deploy worker"}
        </Button>
      </PageAction>
      <dl className="grid grid-cols-2 gap-4 rounded-[14px] border border-border bg-surface px-5 py-4 sm:grid-cols-3">
        <Fact term="Script">{status.script_name}</Fact>
        <Fact term="Size">{formatBytes(status.script_bytes)}</Fact>
        <Fact term="Updated">
          {status.modified_on ? formatDateTime(status.modified_on) : "Never"}
        </Fact>
      </dl>
    </Section>
  );
}

function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{term}</dt>
      <dd className="truncate font-mono text-[13px]">{children}</dd>
    </div>
  );
}

function Zones({ status }: { status: InboundStatus }) {
  return (
    <Section title="Receiving domains">
      <List>
        {status.zones.map((zone) => (
          <ZoneRow key={zone.id} zone={zone} deployed={status.deployed} />
        ))}
        {status.zones.length === 0 && <ListEmpty>This token sees no zones.</ListEmpty>}
      </List>
      <Notice>
        Turning a domain on replaces its MX records with Cloudflare's. Anything receiving mail for
        it today stops.
      </Notice>
    </Section>
  );
}

function ZoneRow({ zone, deployed }: { zone: ZoneStatus; deployed: boolean }) {
  const { call, run, pending } = useRun();
  const [stopping, setStopping] = useState(false);
  const [disableRouting, setDisableRouting] = useState(false);

  return (
    <ListRow
      title={zone.name}
      action={
        <>
          {zone.catch_all_to_worker ? (
            <StatusDot tone="ok" className="mr-2">
              Receiving
            </StatusDot>
          ) : zone.routing_enabled ? (
            <StatusDot tone="pending" className="mr-2">
              Routing on, not here
            </StatusDot>
          ) : (
            <StatusDot tone="off" className="mr-2">
              Routing off
            </StatusDot>
          )}
          {zone.catch_all_to_worker ? (
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
          )}
        </>
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
          className="flex cursor-pointer items-start gap-3 rounded-[10px] border border-border px-3.5 py-3"
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
  return (
    <Section
      title="Cloudflare connection"
      description="To use a new token, disconnect below, then connect it."
    >
      <dl className="grid grid-cols-2 gap-4 rounded-[14px] border border-border bg-surface px-5 py-4 sm:grid-cols-3">
        <Fact term="Token">{status.hint}</Fact>
        {status.label && <Fact term="Label">{status.label}</Fact>}
        {status.account_id && <Fact term="Account">{status.account_id}</Fact>}
      </dl>
    </Section>
  );
}

function Danger({ status }: { status: InboundStatus }) {
  const { call, pending } = useRun();
  const [removing, setRemoving] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  return (
    <DangerZone>
      {status.deployed && (
        <DangerRow
          title="Delete the worker"
          description="Nothing is received on any of your domains until it is deployed again."
          action={
            <Button
              variant="destructive"
              icon="delete"
              disabled={pending}
              onClick={() => setRemoving(true)}
            >
              Delete worker
            </Button>
          }
        />
      )}
      <DangerRow
        title="Disconnect Cloudflare"
        description="Mails forgets the token. The worker and routing stay as they are."
        action={
          <Button variant="destructive" disabled={pending} onClick={() => setDisconnecting(true)}>
            Disconnect
          </Button>
        }
      />
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
      <ConfirmDialog
        open={disconnecting}
        onOpenChange={setDisconnecting}
        title="Disconnect Cloudflare?"
        consequences="Mails forgets the token. The worker and routing stay as they are in Cloudflare, so mail keeps arriving; this page just cannot change them until you connect again."
        confirmLabel="Disconnect"
        onConfirm={() => call({ method: "DELETE", path: "/connect" }, "Cloudflare disconnected")}
      />
    </DangerZone>
  );
}

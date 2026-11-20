import { type FormEvent, useState } from "react";
import { Link } from "react-router";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  Field,
  Icon,
  IconButton,
  Input,
  List,
  ListEmpty,
  ListRow,
  Switch,
  toast,
} from "@/components/kit";
import {
  errorMessage,
  useAddForwardAddress,
  useAddForwardRule,
  useForwarding,
  useRefreshForwarding,
  useRemoveForwardAddress,
  useRemoveForwardRule,
  useUpdateDomain,
  useUpdateMailbox,
} from "@/lib/api";
import { EMAIL } from "@/lib/mail";
import type { ForwardAddress, ForwardingView, ForwardRule, ForwardScope } from "@/lib/types";
import { LoadError, Notice, PageLoading } from "./parts";

const fail = (error: unknown) => toast.error(errorMessage(error));

/**
 * Copies of inbound mail sent on through Cloudflare Email Routing: the
 * destination addresses, then rules at three widths (everything, a domain,
 * a mailbox). A domain or mailbox can skip the wider rules.
 */
export default function Forwarding() {
  const view = useForwarding();
  if (view.isPending) return <PageLoading />;
  if (view.isError) return <LoadError error={view.error} retry={view.refetch} />;
  const data = view.data;

  if (!data.connected && data.addresses.length === 0) {
    return (
      <Card>
        <EmptyState
          icon="forward_to_inbox"
          title="Connect Cloudflare first"
          body="Forwarding goes through Cloudflare Email Routing, which verifies each address you forward to."
          action={
            <Button render={<Link to="/settings/inbound" />} nativeButton={false}>
              Go to Inbound
            </Button>
          }
        />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Addresses view={data} />
      <Card>
        <CardHeader>
          <CardTitle>Everything</CardTitle>
          <CardDescription>
            A copy of every message this instance receives, whichever mailbox it lands in.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-2xl bg-box p-3">
            <Targets rules={data.instance} view={data} scope={{}} label="everything" />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>By domain</CardTitle>
          <CardDescription>
            Added to the rule above, unless the domain skips wider rules.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <List className="bg-box">
            {data.domains.map((d) => (
              <ScopeRow key={d.id} kind="domain" scope={d} view={data} />
            ))}
            {data.domains.length === 0 && (
              <ListEmpty>
                No domains yet. Add one under <Link to="/settings/domains">Domains</Link>.
              </ListEmpty>
            )}
          </List>
        </CardContent>
      </Card>
      <MailboxRules view={data} />
    </div>
  );
}

function Addresses({ view }: { view: ForwardingView }) {
  const [address, setAddress] = useState("");
  const add = useAddForwardAddress();
  const refresh = useRefreshForwarding();
  const valid = EMAIL.test(address.trim());
  const waiting = view.addresses.filter((a) => !a.verified).length;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid) return;
    add.mutate(address.trim(), {
      onSuccess: (a) => {
        toast.success(
          a.verified
            ? `${a.address} is ready to use`
            : `Cloudflare emailed ${a.address} a link. Rules using it wait until it is clicked.`,
        );
        setAddress("");
      },
      onError: fail,
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Addresses</CardTitle>
        <CardDescription>
          Where copies can go. These are your Cloudflare Email Routing destinations: one added here
          is created there, and Cloudflare emails it a link to confirm.
        </CardDescription>
        <CardAction>
          <IconButton
            icon="refresh"
            label="Refresh from Cloudflare"
            loading={refresh.isPending}
            disabled={!view.connected}
            onClick={() =>
              refresh.mutate(undefined, {
                onSuccess: () => toast.success("Refreshed from Cloudflare"),
                onError: fail,
              })
            }
          />
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-3">
        {!view.connected && (
          <Notice tone="warning">
            Cloudflare is not connected, so addresses cannot be added or checked.{" "}
            <Link to="/settings/inbound" className="underline">
              Connect it
            </Link>
            .
          </Notice>
        )}
        <List className="bg-box">
          {view.addresses.map((a) => (
            <AddressRow key={a.id} address={a} />
          ))}
          {view.addresses.length === 0 && <ListEmpty>Nowhere to forward to yet.</ListEmpty>}
        </List>
        {waiting > 0 && (
          <Notice>
            {waiting === 1 ? "One address is" : `${waiting} addresses are`} waiting for the link in
            Cloudflare's email to be clicked. Rules using {waiting === 1 ? "it do" : "them do"}{" "}
            nothing until then. Clicked it? Refresh.
          </Notice>
        )}
        <form className="flex flex-col gap-2 sm:flex-row sm:items-end" onSubmit={submit}>
          <Field label="Add an address" className="flex-1">
            <Input
              type="email"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              placeholder="me@elsewhere.com"
              autoComplete="off"
              className="font-mono"
              disabled={!view.connected}
            />
          </Field>
          <Button
            type="submit"
            variant="primary"
            loading={add.isPending}
            disabled={!valid || !view.connected}
          >
            Add
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function AddressRow({ address }: { address: ForwardAddress }) {
  const [removing, setRemoving] = useState(false);
  const [inCloudflare, setInCloudflare] = useState(true);
  const remove = useRemoveForwardAddress();
  const state = address.verified ? "Verified" : address.in_cloudflare ? "Waiting" : "Gone";

  return (
    <ListRow
      icon="forward"
      title={<span className="font-mono">{address.address}</span>}
      description={
        !address.in_cloudflare
          ? "Cloudflare no longer has it. Remove it and add it again."
          : address.uses === 0
            ? "No rule uses it yet"
            : `Used by ${address.uses} ${address.uses === 1 ? "rule" : "rules"}`
      }
      action={
        <>
          <Badge tone={address.verified ? "strong" : address.in_cloudflare ? "neutral" : "danger"}>
            {state}
          </Badge>
          <IconButton
            icon="delete"
            label={`Remove ${address.address}`}
            onClick={() => setRemoving(true)}
          />
        </>
      }
    >
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title={`Remove ${address.address}?`}
        consequences={`Every rule that copies mail to it is removed too${address.uses ? ` (${address.uses})` : ""}.`}
        confirmLabel="Remove"
        onConfirm={async () => {
          await remove.mutateAsync({ id: address.id, cloudflare: inCloudflare });
          toast.success("Address removed");
        }}
      >
        {address.in_cloudflare && (
          <label
            htmlFor={`cf-${address.id}`}
            className="flex cursor-pointer items-start gap-3 rounded-2xl bg-box px-3.5 py-3"
          >
            <Checkbox
              id={`cf-${address.id}`}
              checked={inCloudflare}
              onCheckedChange={(on) => setInCloudflare(on === true)}
              className="mt-0.5"
            />
            <span className="min-w-0">
              <span className="block text-[13px] font-medium">Also delete it in Cloudflare</span>
              <span className="block text-xs text-muted-foreground">
                Adding it again later means confirming it again.
              </span>
            </span>
          </label>
        )}
      </ConfirmDialog>
    </ListRow>
  );
}

/** Where one width's mail is copied: a chip per rule and a menu to add one. */
function Targets({
  rules,
  view,
  scope,
  label,
}: {
  rules: ForwardRule[];
  view: ForwardingView;
  scope: { domain_id?: string; mailbox_id?: string };
  label: string;
}) {
  const add = useAddForwardRule();
  const remove = useRemoveForwardRule();
  const used = new Set(rules.map((r) => r.address_id));
  const free = view.addresses.filter((a) => a.verified && !used.has(a.id));

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {rules.map((rule) => {
        const address = view.addresses.find((a) => a.id === rule.address_id);
        return (
          <span
            key={rule.id}
            className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-full bg-tonal pr-1 pl-3 font-mono text-xs"
          >
            <Icon name="forward" size={14} className="text-muted-foreground" />
            <span className="truncate">{address?.address ?? "an address"}</span>
            {address && !address.verified && (
              <span className="text-muted-foreground">(waiting)</span>
            )}
            <IconButton
              icon="close"
              size="sm"
              className="size-6"
              label={`Stop copying ${label} to ${address?.address ?? "this address"}`}
              disabled={remove.isPending}
              onClick={() => remove.mutate(rule.id, { onError: fail })}
            />
          </span>
        );
      })}
      {rules.length === 0 && (
        <span className="px-1 text-xs text-muted-foreground">Not forwarded</span>
      )}
      {free.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button size="sm" variant="ghost" icon="add" loading={add.isPending}>
                Forward
              </Button>
            }
          />
          <DropdownMenuContent>
            {free.map((a) => (
              <DropdownMenuItem
                key={a.id}
                className="font-mono"
                onClick={() =>
                  add.mutate(
                    { address_id: a.id, ...scope },
                    {
                      onSuccess: () =>
                        toast.success(`Mail to ${label} will be copied to ${a.address}`),
                      onError: fail,
                    },
                  )
                }
              >
                {a.address}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

function ScopeRow({
  kind,
  scope,
  view,
}: {
  kind: "domain" | "mailbox";
  scope: ForwardScope;
  view: ForwardingView;
}) {
  const updateDomain = useUpdateDomain();
  const updateMailbox = useUpdateMailbox();
  const setOff = (forward_off: boolean) =>
    kind === "domain"
      ? updateDomain.mutate({ id: scope.id, forward_off }, { onError: fail })
      : updateMailbox.mutate({ id: scope.id, forward_off }, { onError: fail });
  const wider = kind === "domain" ? "the everything rule" : "domain and everything rules";

  return (
    <li className="flex flex-col gap-2 rounded-2xl px-3 py-3 hover:bg-surface">
      <div className="flex items-center gap-3">
        <Icon
          name={kind === "domain" ? "language" : "alternate_email"}
          size={18}
          className="text-muted-foreground"
        />
        <span className="min-w-0 flex-1 truncate font-mono text-[13px] font-medium">
          {scope.name}
        </span>
        <span className="text-xs text-muted-foreground">Skip wider rules</span>
        <Switch
          checked={scope.forward_off}
          onCheckedChange={setOff}
          aria-label={`${scope.name}: skip ${wider}`}
        />
      </div>
      <div className="pl-8">
        <Targets
          rules={scope.rules}
          view={view}
          scope={kind === "domain" ? { domain_id: scope.id } : { mailbox_id: scope.id }}
          label={scope.name}
        />
      </div>
    </li>
  );
}

/**
 * Mailboxes show only once they have a rule or skip the wider ones; any
 * other mailbox is picked from a menu, so a long list stays short.
 */
function MailboxRules({ view }: { view: ForwardingView }) {
  const [opened, setOpened] = useState<string[]>([]);
  const shown = view.mailboxes.filter(
    (m) => m.rules.length > 0 || m.forward_off || opened.includes(m.id),
  );
  const rest = view.mailboxes.filter((m) => !shown.includes(m));

  return (
    <Card>
      <CardHeader>
        <CardTitle>By mailbox</CardTitle>
        <CardDescription>
          The narrowest rule. Also where one address is kept out of the wider copies.
        </CardDescription>
        {rest.length > 0 && (
          <CardAction>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button size="sm" icon="add">
                    Mailbox
                  </Button>
                }
              />
              <DropdownMenuContent className="max-h-72 overflow-y-auto">
                {rest.map((m) => (
                  <DropdownMenuItem
                    key={m.id}
                    className="font-mono"
                    onClick={() => setOpened((ids) => [...ids, m.id])}
                  >
                    {m.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        <List className="bg-box">
          {shown.map((m) => (
            <ScopeRow key={m.id} kind="mailbox" scope={m} view={view} />
          ))}
          {shown.length === 0 && (
            <ListEmpty>
              Every mailbox follows the rules above. Pick one with "Mailbox" to give it its own.
            </ListEmpty>
          )}
        </List>
      </CardContent>
    </Card>
  );
}

import { type FormEvent, useState } from "react";
import { Link } from "react-router";
import {
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
  DropdownMenuTrigger,
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
import {
  emptyBox,
  LoadError,
  Notice,
  PageAction,
  PageLoading,
  rowActions,
  Section,
  StatusDot,
} from "./parts";

const fail = (error: unknown) => toast.error(errorMessage(error));

/** Row actions: always there on touch, shown on hover or focus with a pointer. */
const ROW_ACTIONS = rowActions;

const EMPTY = emptyBox;

/**
 * Copies of inbound mail sent on through Cloudflare Email Routing: the
 * destination addresses, then rules at three widths (everything, a domain,
 * a mailbox). A domain or mailbox can skip the wider rules.
 */
export default function Forwarding() {
  const view = useForwarding();
  const [adding, setAdding] = useState(false);
  if (view.isPending) return <PageLoading />;
  if (view.isError) return <LoadError error={view.error} retry={view.refetch} />;
  const data = view.data;

  if (!data.connected && data.addresses.length === 0) {
    return (
      <div className={EMPTY}>
        <p className="text-muted-foreground">Connect Cloudflare first.</p>
        <Button
          variant="primary"
          icon="arrow_forward"
          className="mt-4"
          render={<Link to="/settings/inbound" />}
          nativeButton={false}
        >
          Go to Inbound
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <PageAction>
        <Button
          variant="primary"
          icon="add"
          disabled={!data.connected}
          onClick={() => setAdding(true)}
        >
          Add address
        </Button>
      </PageAction>
      <Addresses view={data} />
      <Section title="Everything" description="A copy of every message received.">
        <div className="rounded-[14px] border border-border bg-surface px-4 py-3">
          <Targets rules={data.instance} view={data} scope={{}} label="everything" />
        </div>
      </Section>
      <Section
        title="By domain"
        description="Added to the rule above, unless the domain skips wider rules."
      >
        <List>
          {data.domains.map((d) => (
            <ScopeRow key={d.id} kind="domain" scope={d} view={data} />
          ))}
          {data.domains.length === 0 && (
            <ListEmpty>
              No domains yet. Add one under{" "}
              <Link to="/settings/domains" className="underline">
                Domains
              </Link>
              .
            </ListEmpty>
          )}
        </List>
      </Section>
      <MailboxRules view={data} />
      <AddAddress open={adding} onOpenChange={setAdding} />
    </div>
  );
}

function AddAddress({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [address, setAddress] = useState("");
  const add = useAddForwardAddress();
  const valid = EMAIL.test(address.trim());

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
        onOpenChange(false);
      },
      onError: fail,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add an address</DialogTitle>
          <DialogDescription>
            It is created as a Cloudflare Email Routing destination, and Cloudflare emails it a link
            to confirm.
          </DialogDescription>
        </DialogHeader>
        <form id="add-forward-address" onSubmit={submit}>
          <Field label="Address">
            <Input
              type="email"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              placeholder="me@elsewhere.com"
              autoComplete="off"
              className="font-mono"
            />
          </Field>
        </form>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
          <Button
            type="submit"
            form="add-forward-address"
            variant="primary"
            loading={add.isPending}
            disabled={!valid}
          >
            Add address
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Addresses({ view }: { view: ForwardingView }) {
  const refresh = useRefreshForwarding();
  const waiting = view.addresses.filter((a) => !a.verified).length;

  return (
    <Section
      title="Destinations"
      description="Where copies can go."
      action={
        <IconButton
          icon="refresh"
          size="sm"
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
      }
    >
      {!view.connected && (
        <Notice tone="warning">
          Cloudflare is not connected, so addresses cannot be added or checked.{" "}
          <Link to="/settings/inbound" className="underline">
            Connect it
          </Link>
          .
        </Notice>
      )}
      {view.addresses.length === 0 ? (
        <div className={EMPTY}>
          <p className="text-muted-foreground">Nowhere to forward to yet.</p>
        </div>
      ) : (
        <List>
          {view.addresses.map((a) => (
            <AddressRow key={a.id} address={a} />
          ))}
        </List>
      )}
      {waiting > 0 && (
        <Notice>
          {waiting === 1 ? "One address is" : `${waiting} addresses are`} waiting for the link in
          Cloudflare's email to be clicked. Rules using {waiting === 1 ? "it do" : "them do"}{" "}
          nothing until then. Clicked it? Refresh.
        </Notice>
      )}
    </Section>
  );
}

function AddressRow({ address }: { address: ForwardAddress }) {
  const [removing, setRemoving] = useState(false);
  const [inCloudflare, setInCloudflare] = useState(true);
  const remove = useRemoveForwardAddress();

  return (
    <ListRow
      title={address.address}
      description={
        !address.in_cloudflare
          ? "gone from Cloudflare: remove it and add it again"
          : address.uses === 0
            ? "no rule uses it yet"
            : `used by ${address.uses} ${address.uses === 1 ? "rule" : "rules"}`
      }
      action={
        <>
          {/* Only what needs attention is marked. */}
          {address.verified ? null : address.in_cloudflare ? (
            <StatusDot tone="pending">Waiting</StatusDot>
          ) : (
            <StatusDot tone="bad">Gone</StatusDot>
          )}
          <IconButton
            icon="delete"
            size="sm"
            className={`ml-2 ${ROW_ACTIONS}`}
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
            className="flex cursor-pointer items-start gap-3 rounded-[10px] border border-border px-3.5 py-3"
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
            className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-md bg-tonal pr-0.5 pl-2 font-mono text-xs"
          >
            <Icon name="forward" size={14} className="text-muted-foreground" />
            <span className="truncate">{address?.address ?? "an address"}</span>
            {address && !address.verified && (
              <span className="text-muted-foreground">(waiting)</span>
            )}
            <IconButton
              icon="close"
              size="xs"
              className="size-6"
              label={`Stop copying ${label} to ${address?.address ?? "this address"}`}
              disabled={remove.isPending}
              onClick={() => remove.mutate(rule.id, { onError: fail })}
            />
          </span>
        );
      })}
      {rules.length === 0 && <span className="text-xs text-muted-foreground">Not forwarded</span>}
      {free.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button size="xs" variant="ghost" icon="add" loading={add.isPending}>
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
    <li className="space-y-2.5 px-4 py-3.5">
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{scope.name}</span>
        <span className="text-xs text-muted-foreground">Skip wider rules</span>
        <Switch
          checked={scope.forward_off}
          onCheckedChange={setOff}
          aria-label={`${scope.name}: skip ${wider}`}
        />
      </div>
      <Targets
        rules={scope.rules}
        view={view}
        scope={kind === "domain" ? { domain_id: scope.id } : { mailbox_id: scope.id }}
        label={scope.name}
      />
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
    <Section
      title="By mailbox"
      description="The narrowest rule. Also where one address is kept out of the wider copies."
      action={
        rest.length > 0 && (
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
        )
      }
    >
      <List>
        {shown.map((m) => (
          <ScopeRow key={m.id} kind="mailbox" scope={m} view={view} />
        ))}
        {shown.length === 0 && (
          <ListEmpty>
            Every mailbox follows the rules above. Pick one with "Mailbox" to give it its own.
          </ListEmpty>
        )}
      </List>
    </Section>
  );
}

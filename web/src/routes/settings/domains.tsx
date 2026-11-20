import { type FormEvent, useId, useState } from "react";
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
  Field,
  Icon,
  IconButton,
  Input,
  List,
  toast,
} from "@/components/kit";
import {
  errorMessage,
  useAddDomain,
  useDomains,
  useImportDomains,
  useOwnDkim,
  useRemoveDomain,
  useUpdateDomain,
  useVerifyDomain,
} from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/mail";
import {
  canUseOwnDkim,
  type DomainCheck,
  domainChecks,
  domainSummary,
  nestDomains,
  relativeName,
} from "@/lib/settings";
import type { DnsRecord, Domain } from "@/lib/types";
import {
  CopyValue,
  emptyBox,
  LoadError,
  Notice,
  PageAction,
  PageLoading,
  rowActions,
  StatusDot,
  SwitchRow,
  toastResult,
} from "./parts";

/** Row actions: always there on touch, shown on hover or focus with a pointer. */
const ROW_ACTIONS = cn("flex shrink-0 items-center gap-1", rowActions);

/** Sending domains: SES identities, their DNS records and checks. */
export default function Domains() {
  const domains = useDomains();
  const importDomains = useImportDomains();
  const [adding, setAdding] = useState(false);

  if (domains.isPending) return <PageLoading />;
  if (domains.isError) return <LoadError error={domains.error} retry={domains.refetch} />;
  const { data, warning } = domains.data;

  return (
    <div className="space-y-4">
      <PageAction>
        <Button
          icon="download"
          loading={importDomains.isPending}
          onClick={() =>
            toastResult(
              importDomains.mutateAsync(),
              (r) => `${r.imported} imported, ${r.updated} refreshed, ${r.total} found in SES`,
            )
          }
        >
          Import from SES
        </Button>
        <Button variant="primary" icon="add" onClick={() => setAdding(true)}>
          Add domain
        </Button>
      </PageAction>
      {warning && (
        <Notice tone="warning">{warning.replace(/\.$/, "")}. Showing what was last saved.</Notice>
      )}
      {data.length === 0 ? (
        <div className={emptyBox}>
          <p className="text-muted-foreground">No domains yet.</p>
        </div>
      ) : (
        <List>
          {nestDomains(data).flatMap(({ domain, children }) => [
            <DomainItem key={domain.id} domain={domain} />,
            ...children.map((child) => <DomainItem key={child.id} domain={child} nested />),
          ])}
        </List>
      )}
      <AddDomain open={adding} onOpenChange={setAdding} />
    </div>
  );
}

function AddDomain({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = useState("");
  const add = useAddDomain();

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    void toastResult(add.mutateAsync(name.trim()), (d) =>
      d.inherited_from
        ? `${d.name} added. It sends on ${d.inherited_from}'s verification.`
        : `${d.name} added. Publish its DNS records at your DNS host.`,
    ).then((d) => {
      if (!d) return;
      setName("");
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a domain</DialogTitle>
          <DialogDescription>
            A subdomain of a verified domain needs no DNS records.
          </DialogDescription>
        </DialogHeader>
        <form id="add-domain" onSubmit={submit}>
          <Field label="Domain">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="example.com"
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
            />
          </Field>
        </form>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
          <Button
            type="submit"
            form="add-domain"
            variant="primary"
            loading={add.isPending}
            disabled={!name.trim()}
          >
            Add domain
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The one-word status beside a domain that still needs work; a ready one shows none. */
function domainStatus(domain: Domain) {
  const summary = domainSummary(domain);
  if (summary.ready) return null;
  if (summary.danger) return { tone: "bad", text: "Failing" } as const;
  return { tone: "pending", text: "Pending" } as const;
}

function DomainItem({ domain, nested }: { domain: Domain; nested?: boolean }) {
  const summary = domainSummary(domain);
  const status = domainStatus(domain);
  const inherited = Boolean(domain.inherited_from);
  // Open what still needs work; a ready domain stays folded.
  const [open, setOpen] = useState(!summary.ready);
  const [removing, setRemoving] = useState(false);
  const [alsoSes, setAlsoSes] = useState(false);
  const remove = useRemoveDomain();
  const panelId = useId();
  const checkboxId = useId();

  const details = inherited
    ? `sends on ${domain.inherited_from}'s verification`
    : [
        domain.region,
        domain.imported && "imported",
        domain.last_checked_at && `checked ${formatDateTime(domain.last_checked_at)}`,
      ]
        .filter(Boolean)
        .join(" · ");
  const body = (
    <>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{domain.name}</div>
        <div className="truncate font-mono text-xs text-muted-foreground">{details}</div>
      </div>
      {status && <StatusDot tone={status.tone}>{status.text}</StatusDot>}
    </>
  );

  return (
    <li className="group/row">
      <div className="flex items-center gap-1 pr-3 transition-colors hover:bg-box">
        {inherited ? (
          <div
            className={cn("flex min-w-0 flex-1 items-center gap-3 py-3.5 pl-4", nested && "pl-10")}
          >
            <span
              aria-hidden
              className="mb-1.5 size-3 shrink-0 rounded-bl-[4px] border-b-2 border-l-2 border-input"
            />
            {body}
          </div>
        ) : (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen(!open)}
            className={cn(
              "flex min-w-0 flex-1 items-center gap-3 py-3.5 pl-4 text-left outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
              nested && "pl-10",
            )}
          >
            <Icon
              name="expand_more"
              size={18}
              className={cn(
                "shrink-0 text-muted-foreground transition-transform",
                open && "rotate-180",
              )}
            />
            {body}
          </button>
        )}
        <div className={ROW_ACTIONS}>
          <IconButton
            icon="delete"
            size="sm"
            label={`Remove ${domain.name}`}
            onClick={() => setRemoving(true)}
          />
        </div>
      </div>

      {open && !inherited && (
        <div id={panelId} className="border-t border-border px-4 pt-4 pb-5 sm:pl-12">
          <DomainDetails domain={domain} />
        </div>
      )}

      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title={`Remove ${domain.name}?`}
        description="Mail can no longer be sent from any address on it."
        consequences="Mailboxes on this domain and their mail are kept, but they stop sending. API sends from it start failing. Webhooks for this domain are deleted."
        phrase={domain.name}
        confirmLabel="Remove domain"
        onConfirm={async () => {
          const result = await remove.mutateAsync({
            id: domain.id,
            deleteInSes: !inherited && alsoSes,
          });
          toast.success(
            result.deleted_in_ses ? "Domain and SES identity removed" : "Domain removed",
          );
        }}
      >
        {!inherited && (
          <label
            htmlFor={checkboxId}
            className="flex cursor-pointer items-start gap-3 rounded-[10px] border border-border px-3.5 py-3"
          >
            <Checkbox
              id={checkboxId}
              checked={alsoSes}
              onCheckedChange={(on) => setAlsoSes(on === true)}
              className="mt-0.5"
            />
            <span className="min-w-0">
              <span className="block text-[13px] font-medium">Also delete the identity in SES</span>
              <span className="block text-xs text-muted-foreground">
                Verifying it again means publishing new DNS records.
              </span>
            </span>
          </label>
        )}
      </ConfirmDialog>
    </li>
  );
}

/** Which check a DNS record proves, by the purpose the server gives it. */
function recordCheck(record: DnsRecord, checks: DomainCheck[]) {
  const key = record.purpose.startsWith("DKIM")
    ? "dkim"
    : record.purpose.includes("return path")
      ? "mail-from"
      : record.purpose.startsWith("SPF")
        ? "spf"
        : record.purpose.startsWith("DMARC")
          ? "dmarc"
          : undefined;
  return checks.find((c) => c.key === key);
}

function DomainDetails({ domain }: { domain: Domain }) {
  const update = useUpdateDomain();
  const verify = useVerifyDomain();
  const ownDkim = useOwnDkim();
  const checks = domainChecks(domain);
  const summary = domainSummary(domain);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1 basis-60">
          <h3 className="text-sm font-semibold">DNS records</h3>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            {!summary.ready && <span className="text-soft-foreground">{summary.text}. </span>}
            Add these at your DNS host. Names are relative to {domain.name}.
          </p>
        </div>
        {canUseOwnDkim(domain) && (
          <Button
            size="sm"
            variant="ghost"
            loading={ownDkim.isPending}
            onClick={() =>
              toastResult(
                ownDkim.mutateAsync(domain.id),
                "DKIM now uses one TXT record. Publish it, then re-check.",
              )
            }
          >
            Use one TXT record for DKIM
          </Button>
        )}
        <Button
          size="sm"
          icon="refresh"
          loading={verify.isPending}
          onClick={() =>
            toastResult(verify.mutateAsync(domain.id), (d) =>
              domainSummary(d).ready ? `${d.name} is ready` : `${d.name}: ${domainSummary(d).text}`,
            )
          }
        >
          Check again
        </Button>
      </div>

      {domain.records.length > 0 && (
        <ul aria-label={`DNS records for ${domain.name}`} className="divide-y divide-border">
          {domain.records.map((record) => (
            <RecordItem
              key={`${record.kind}-${record.name}-${record.value}`}
              record={record}
              check={recordCheck(record, checks)}
              zone={domain.name}
            />
          ))}
        </ul>
      )}

      <SwitchRow
        label="Capture every address"
        description={`Mail to an unknown address on ${domain.name} creates its mailbox. Off: it is only forwarded, if a rule covers it.`}
        checked={domain.auto_create_mailboxes}
        onCheckedChange={(on) =>
          update.mutate(
            { id: domain.id, auto_create_mailboxes: on },
            { onError: (error) => toast.error(errorMessage(error)) },
          )
        }
        className="border-t border-border pt-4"
      />
    </div>
  );
}

function RecordItem({
  record,
  check,
  zone,
}: {
  record: DnsRecord;
  check: DomainCheck | undefined;
  zone: string;
}) {
  // A verified record needs nothing: one line, values on click.
  const [open, setOpen] = useState(!check?.ok);
  const name = relativeName(record.name, zone);
  return (
    <li className="py-2.5 first:pt-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full min-w-0 items-center gap-2 rounded-md text-left text-xs outline-none focus-visible:outline-2 focus-visible:outline-ring"
      >
        {check?.ok ? (
          <StatusDot tone="ok">Verified</StatusDot>
        ) : record.required ? (
          <StatusDot tone="pending">Pending</StatusDot>
        ) : (
          <StatusDot tone="off">Optional</StatusDot>
        )}
        <Badge size="sm" className="font-mono">
          {record.kind}
        </Badge>
        <span className="min-w-0 truncate text-muted-foreground">{record.purpose}</span>
        <span className="ml-auto max-w-[40%] truncate font-mono text-muted-foreground">{name}</span>
        <Icon
          name="expand_more"
          size={16}
          className={cn("text-muted-foreground transition-transform", open && "rotate-180")}
        />
      </button>
      {open && (
        <div className="mt-2.5 grid gap-1.5 sm:grid-cols-[3rem_1fr] sm:items-center">
          <span className="text-xs text-muted-foreground">Name</span>
          <CopyValue value={name} label="Copy name" />
          <span className="text-xs text-muted-foreground">
            Value
            {record.priority !== undefined && (
              <span className="block font-mono">prio {record.priority}</span>
            )}
          </span>
          {record.informational ? (
            <span className="px-3 py-2 text-[13px] text-muted-foreground italic">
              {record.value}
            </span>
          ) : (
            <CopyValue
              value={record.value}
              label="Copy value"
              className="max-h-24 overflow-y-auto"
            />
          )}
        </div>
      )}
    </li>
  );
}

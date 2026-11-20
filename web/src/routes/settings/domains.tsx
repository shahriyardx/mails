import { useId, useState } from "react";
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
  IconButton,
  Input,
  List,
  ListEmpty,
  Tooltip,
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
  domainChecks,
  domainSummary,
  nestDomains,
  relativeName,
} from "@/lib/settings";
import type { DnsRecord, Domain } from "@/lib/types";
import { CopyValue, LoadError, Notice, PageLoading, SwitchRow, toastResult } from "./parts";

/** Sending domains: SES identities, their DNS records and checks. */
export default function Domains() {
  const domains = useDomains();
  const importDomains = useImportDomains();

  if (domains.isPending) return <PageLoading />;
  if (domains.isError) return <LoadError error={domains.error} retry={domains.refetch} />;
  const { data, warning } = domains.data;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Domains</CardTitle>
          <CardDescription>
            The domains you send from, as Amazon SES identities. Import the ones already in SES, or
            add a new one and publish its DNS records.
          </CardDescription>
          <CardAction>
            <Button
              icon="download"
              size="sm"
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
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-3">
          {warning && <Notice tone="warning">{warning}. Showing what was last saved.</Notice>}
          <List className="bg-box">
            {nestDomains(data).map(({ domain, children }) => (
              <li key={domain.id} className="list-none">
                <ul className="flex flex-col gap-0.5">
                  <DomainItem domain={domain} />
                  {children.map((child) => (
                    <DomainItem key={child.id} domain={child} nested />
                  ))}
                </ul>
              </li>
            ))}
            {data.length === 0 && (
              <ListEmpty>No domains yet. Import from SES or add one below.</ListEmpty>
            )}
          </List>
        </CardContent>
      </Card>
      <AddDomain />
    </div>
  );
}

function AddDomain() {
  const [name, setName] = useState("");
  const add = useAddDomain();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Add a domain</CardTitle>
        <CardDescription>
          A subdomain of a verified domain is added with nothing to publish: it sends on its
          parent's verification. Anything else becomes an SES identity with its own DKIM key and
          return path.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-2 sm:flex-row sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            if (!name.trim()) return;
            void toastResult(add.mutateAsync(name.trim()), (d) =>
              d.inherited_from
                ? `${d.name} added. It sends on ${d.inherited_from}'s verification.`
                : `${d.name} added. Publish its DNS records at your DNS host.`,
            ).then((d) => d && setName(""));
          }}
        >
          <Field label="Domain" className="flex-1">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="example.com"
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
            />
          </Field>
          <Button type="submit" variant="primary" loading={add.isPending} disabled={!name.trim()}>
            Add domain
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function DomainItem({ domain, nested }: { domain: Domain; nested?: boolean }) {
  const summary = domainSummary(domain);
  const inherited = Boolean(domain.inherited_from);
  // Open what still needs work; a ready domain stays folded.
  const [open, setOpen] = useState(!summary.ready);
  const [removing, setRemoving] = useState(false);
  const [alsoSes, setAlsoSes] = useState(false);
  const verify = useVerifyDomain();
  const remove = useRemoveDomain();
  const panelId = useId();
  const checkboxId = useId();

  return (
    <li className={cn("rounded-2xl", open && "bg-surface")}>
      <div className={cn("flex min-h-14 items-center gap-2 px-2 py-2", nested && "pl-6")}>
        {inherited ? (
          <span aria-hidden className="grid size-10 shrink-0 place-items-center">
            <span className="mb-2 ml-1 size-3.5 rounded-bl-md border-b-2 border-l-2 border-input" />
          </span>
        ) : (
          <IconButton
            icon={open ? "expand_less" : "expand_more"}
            label={open ? `Hide records for ${domain.name}` : `Show records for ${domain.name}`}
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen(!open)}
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-[13px] font-medium">{domain.name}</div>
          <div className="truncate text-xs text-muted-foreground">
            {inherited
              ? `Sends on ${domain.inherited_from}'s verification`
              : [
                  domain.region,
                  domain.imported && "imported",
                  domain.last_checked_at && `checked ${formatDateTime(domain.last_checked_at)}`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
          </div>
        </div>
        <Badge
          tone={summary.danger ? "danger" : summary.ready ? "strong" : "neutral"}
          className="hidden sm:inline-flex"
        >
          {summary.ready && <Icon name="check" size={14} />}
          {summary.text}
        </Badge>
        {!inherited && (
          <Tooltip label="Check now">
            <IconButton
              icon="refresh"
              label={`Check ${domain.name} now`}
              loading={verify.isPending}
              onClick={() =>
                toastResult(verify.mutateAsync(domain.id), (d) =>
                  domainSummary(d).ready
                    ? `${d.name} is ready`
                    : `${d.name}: ${domainSummary(d).text}`,
                )
              }
            />
          </Tooltip>
        )}
        <Tooltip label="Remove">
          <IconButton
            icon="delete"
            label={`Remove ${domain.name}`}
            onClick={() => setRemoving(true)}
          />
        </Tooltip>
      </div>
      <Badge
        tone={summary.danger ? "danger" : summary.ready ? "strong" : "neutral"}
        className="mb-2 ml-14 sm:hidden"
      >
        {summary.text}
      </Badge>

      {open && !inherited && (
        <div id={panelId} className="space-y-4 px-3 pt-1 pb-4 sm:px-4">
          <DomainDetails domain={domain} />
        </div>
      )}

      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title={`Remove ${domain.name}?`}
        description="Mail can no longer be sent from any address on it."
        consequences="Mailboxes on this domain and their mail are kept, but they stop sending. API sends from it start failing."
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
            className="flex cursor-pointer items-start gap-3 rounded-2xl bg-box px-3.5 py-3"
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

function DomainDetails({ domain }: { domain: Domain }) {
  const update = useUpdateDomain();
  const ownDkim = useOwnDkim();
  const checks = domainChecks(domain);
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <ul className="flex flex-wrap gap-1.5" aria-label="Checks">
          {checks.map((check) => (
            <li key={check.key}>
              <Badge tone={check.ok ? "strong" : "neutral"} size="sm">
                <Icon name={check.ok ? "check" : "circle"} size={12} />
                {check.label}
                {!check.ok && (check.required ? " pending" : " optional")}
              </Badge>
            </li>
          ))}
        </ul>
        {canUseOwnDkim(domain) && (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
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
      </div>

      <SwitchRow
        label="Capture every address"
        description={`Mail to an address on ${domain.name} that no mailbox claims creates that mailbox and is kept here. Off: it is only forwarded, if a forwarding rule covers it.`}
        checked={domain.auto_create_mailboxes}
        onCheckedChange={(on) =>
          update.mutate(
            { id: domain.id, auto_create_mailboxes: on },
            { onError: (error) => toast.error(errorMessage(error)) },
          )
        }
        className="rounded-2xl bg-box px-3.5 py-3"
      />

      {domain.records.length > 0 && (
        <section aria-label={`DNS records for ${domain.name}`} className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Add these at your DNS host. Names are relative to {domain.name}; the copy button copies
            the name as shown, the value whole.
          </p>
          <ul className="space-y-2">
            {domain.records.map((record) => (
              <RecordItem
                key={`${record.kind}-${record.name}-${record.value}`}
                record={record}
                zone={domain.name}
              />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function RecordItem({ record, zone }: { record: DnsRecord; zone: string }) {
  return (
    <li className="space-y-1.5 rounded-2xl bg-box p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge size="sm" tone="strong" className="font-mono">
          {record.kind}
        </Badge>
        <span className="text-muted-foreground">
          {record.purpose}
          {!record.required && " (optional)"}
        </span>
        {record.priority !== undefined && (
          <span className="ml-auto font-mono text-muted-foreground">
            priority {record.priority}
          </span>
        )}
      </div>
      <div className="grid gap-1.5 sm:grid-cols-[3.5rem_1fr] sm:items-center">
        <span className="text-xs text-muted-foreground">Name</span>
        <CopyValue value={relativeName(record.name, zone)} label="Copy name" />
        <span className="text-xs text-muted-foreground">Value</span>
        {record.informational ? (
          <span className="px-3 py-2 text-[13px] text-muted-foreground italic">{record.value}</span>
        ) : (
          <CopyValue value={record.value} label="Copy value" className="max-h-24 overflow-y-auto" />
        )}
      </div>
    </li>
  );
}
